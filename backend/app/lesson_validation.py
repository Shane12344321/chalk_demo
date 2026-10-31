"""Shared-schema and semantic validation for untrusted lesson steps."""

from __future__ import annotations

import ast
import json
import math
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator
from referencing import Registry, Resource

from app.expression_runtime import CurveSamplingError, sample_curve
from app.figure_validation import FigureIssue, FigureState, validate_figure_op
from app.latex_lint import lint_equation_latex
from app.lesson_sanitizer import SanitizationResult, sanitize_step

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LESSON_SCHEMA_PATH = PROJECT_ROOT / "shared/schema/lesson.schema.json"
STREAM_SCHEMA_PATH = PROJECT_ROOT / "shared/schema/lesson-stream.schema.json"
PLAN_SCHEMA_PATH = PROJECT_ROOT / "shared/schema/lesson-plan.schema.json"

ALLOWED_NAMES = {"x", "pi", "e"}
ALLOWED_FUNCTIONS = {"sin", "cos", "tan", "exp", "log", "sqrt", "abs"}
ALLOWED_BINARY_OPERATORS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)
ALLOWED_UNARY_OPERATORS = (ast.UAdd, ast.USub)
MAX_EXPRESSION_NODES = 64
MAX_NUMERIC_LITERAL = 1_000_000
DIAGRAM_OP_TYPES = {"diagram", "line", "arrow", "point", "angle_arc"}

# Mirrors EXPRESSION_CHARACTERS in frontend/src/board/expression.ts so every
# emitted expression is parseable by the locked-down browser mathjs instance.
_EXPRESSION_CHARACTERS = r"[0-9a-zA-Z_+\-*/^().\s]+"


class StepValidationError(ValueError):
    """A bounded, repair-safe description of an invalid model step."""

    def __init__(self, issues: list[str]) -> None:
        self.issues = issues[:12]
        super().__init__("; ".join(self.issues))


@dataclass
class LessonValidationState:
    """References that are safe to expose to the next generated step."""

    accepted_ids: dict[str, str] = field(default_factory=dict)
    accepted_axes: dict[str, dict[str, Any]] = field(default_factory=dict)
    accepted_step_ids: set[str] = field(default_factory=set)
    accepted_steps: int = 0
    checkpoint_accepted: bool = False
    figures: FigureState = field(default_factory=FigureState)

    def inventory(self) -> list[str]:
        return sorted(set(self.accepted_ids) | set(self.figures.marks))


@dataclass(frozen=True)
class ValidatedStep:
    """One accepted normalized step plus bounded sanitization evidence."""

    step: dict[str, Any]
    sanitization: SanitizationResult


@lru_cache(maxsize=1)
def lesson_schema() -> dict[str, Any]:
    return _load_schema(LESSON_SCHEMA_PATH)


@lru_cache(maxsize=1)
def stream_schema() -> dict[str, Any]:
    return _load_schema(STREAM_SCHEMA_PATH)


@lru_cache(maxsize=1)
def step_validator() -> Draft7Validator:
    schema = lesson_schema()
    validator = Draft7Validator(
        {
            "$schema": schema["$schema"],
            "$id": "https://chalk.local/schema/lesson-step.validation.json",
            "$ref": "#/$defs/step",
            "$defs": schema["$defs"],
        }
    )
    validator.check_schema(validator.schema)
    return validator


@lru_cache(maxsize=1)
def checkpoint_validator() -> Draft7Validator:
    schema = lesson_schema()
    return Draft7Validator(
        {"$schema": schema["$schema"], "$ref": "#/$defs/checkpoint", "$defs": schema["$defs"]}
    )


@lru_cache(maxsize=1)
def envelope_validator() -> Draft7Validator:
    lesson = lesson_schema()
    stream = stream_schema()
    plan = _load_schema(PLAN_SCHEMA_PATH)
    registry = Registry().with_resources(
        [
            (lesson["$id"], Resource.from_contents(lesson)),
            (stream["$id"], Resource.from_contents(stream)),
            (plan["$id"], Resource.from_contents(plan)),
        ]
    )
    validator = Draft7Validator(stream, registry=registry)
    validator.check_schema(stream)
    return validator


def validate_step(value: Any, state: LessonValidationState) -> dict[str, Any]:
    """Validate one complete step without mutating accepted state on failure."""

    return validate_step_with_sanitization(value, state).step


def validate_step_with_sanitization(value: Any, state: LessonValidationState) -> ValidatedStep:
    """Validate one step and expose corrections made to the accepted candidate."""

    sanitization = sanitize_step(value)
    value = sanitization.value
    # A checkpoint is optional. One that breaks its schema is dropped and
    # recorded: a repair round trip almost always dropped it too.
    if (
        isinstance(value, dict)
        and value.get("checkpoint") is not None
        and _schema_issues(checkpoint_validator(), value["checkpoint"])
    ):
        value = {**value, "checkpoint": None}
        sanitization = sanitization.with_correction("dropped_invalid_checkpoint")

    issues = _schema_issues(step_validator(), value)
    if issues:
        raise StepValidationError(issues)
    assert isinstance(value, dict)

    # JSON round-tripping up front gives a detached, JSON-only value that
    # normalization below may safely rewrite without touching caller input.
    normalized = json.loads(json.dumps(value, ensure_ascii=False))

    semantic_issues: list[str] = []
    if state.accepted_steps >= 8:
        semantic_issues.append("lesson step budget exceeded")

    step_id = normalized["id"]
    if step_id in state.accepted_step_ids:
        semantic_issues.append("duplicate step id")
    script_words = len(normalized["script"].strip().split())
    if script_words > 30:
        semantic_issues.append("script exceeds 30 words")
    if script_words == 0:
        semantic_issues.append("script has no spoken words")
    if normalized["checkpoint"] is not None and state.checkpoint_accepted:
        # A lesson has one checkpoint. A later one is dropped here, which is
        # all a repair round trip would ask the model to do.
        normalized["checkpoint"] = None
        sanitization = sanitization.with_correction("dropped_extra_checkpoint")

    visible_types = dict(state.accepted_ids)
    pending_types: dict[str, str] = {}
    pending_axes: dict[str, dict[str, Any]] = {}
    pending_figures = FigureState(
        roots=dict(state.figures.roots),
        windows=dict(state.figures.windows),
        marks=dict(state.figures.marks),
    )
    for index, op in enumerate(normalized["ops"]):
        op_id = op["id"]
        op_type = op["op"]
        if op_id in visible_types or op_id in pending_types or op_id in pending_figures.marks:
            semantic_issues.append(f"op {index} has a duplicate element id")
            continue

        anchor = op.get("anchor")
        if isinstance(anchor, dict):
            anchor_id = anchor.get("el")
            if anchor_id not in visible_types and anchor_id not in pending_types:
                semantic_issues.append(f"op {index} anchor is not already accepted")

        canvas_id = op.get("canvas_id")
        if isinstance(canvas_id, str):
            canvas_type = pending_types.get(canvas_id, visible_types.get(canvas_id))
            if canvas_type not in DIAGRAM_OP_TYPES:
                semantic_issues.append(
                    f"op {index} canvas reference is not an accepted diagram element"
                )

        if op_type in {"line", "arrow"} and "construct" not in op and op["from"] == op["to"]:
            semantic_issues.append(f"op {index} line endpoints must differ")
        if "construct" in op:
            semantic_issues.extend(
                _construction_reference_issues(index, op["construct"], visible_types)
            )
        if op_type == "angle_arc" and abs(op["end_deg"] - op["start_deg"]) < 1:
            semantic_issues.append(f"op {index} angle arc must span at least one degree")
        if op_type == "diagram":
            for primitive_index, primitive in enumerate(op["primitives"]):
                kind = primitive["kind"]
                if kind in {"line", "smooth"}:
                    points = primitive["points"]
                    if all(point == points[0] for point in points[1:]):
                        semantic_issues.append(
                            f"op {index} diagram primitive {primitive_index} path has no length"
                        )
                    if primitive.get("arrow") and points[-1] == points[-2]:
                        semantic_issues.append(
                            f"op {index} diagram primitive {primitive_index} "
                            "arrow has no terminal direction"
                        )
                elif kind == "rect":
                    if (
                        primitive["from"][0] == primitive["to"][0]
                        or primitive["from"][1] == primitive["to"][1]
                    ):
                        semantic_issues.append(
                            f"op {index} diagram primitive {primitive_index} rectangle has no area"
                        )
                elif kind == "arc" and abs(primitive["end_deg"] - primitive["start_deg"]) < 1:
                    semantic_issues.append(
                        f"op {index} diagram primitive {primitive_index} "
                        "arc must span at least one degree"
                    )

        if op_type == "axes":
            if op["x"]["min"] >= op["x"]["max"] or op["y"]["min"] >= op["y"]["max"]:
                semantic_issues.append(f"op {index} axes bounds do not increase")
            else:
                pending_axes[op_id] = {"x": op["x"], "y": op["y"]}
        elif op_type == "curve":
            axes_id = op["axes_id"]
            axes_type = pending_types.get(axes_id, visible_types.get(axes_id))
            if axes_type != "axes":
                semantic_issues.append(f"op {index} axes reference is not already accepted")
            domain = op.get("domain")
            if domain is not None and domain[0] >= domain[1]:
                semantic_issues.append(f"op {index} curve domain does not increase")
            # The browser mathjs grammar has no ** operator; emit ^ instead.
            expression = op["expr"].replace("**", "^")
            op["expr"] = expression
            expression_valid = True
            if not re.fullmatch(_EXPRESSION_CHARACTERS, expression):
                semantic_issues.append(f"op {index} expression contains unsupported characters")
                expression_valid = False
            else:
                try:
                    validate_curve_expression(expression)
                except ValueError as error:
                    semantic_issues.append(f"op {index} expression: {error}")
                    expression_valid = False
            axes_spec = pending_axes.get(axes_id) or state.accepted_axes.get(axes_id)
            if expression_valid and axes_spec is not None:
                try:
                    sample_curve(
                        expression,
                        tuple(domain) if domain is not None else None,
                        axes_spec["x"],
                        axes_spec["y"],
                    )
                except CurveSamplingError as error:
                    semantic_issues.append(f"op {index} expression: {error}")
        elif op_type == "equation":
            for issue in lint_equation_latex(op["latex"]):
                semantic_issues.append(f"op {index} {issue}")
        elif op_type == "figure":
            try:
                figure = validate_figure_op(
                    op, pending_figures, set(visible_types) | set(pending_types)
                )
            except FigureIssue as issue:
                semantic_issues.append(f"op {index} {issue}")
            else:
                pending_figures.roots[op_id] = figure.root
                if "frame" in op:
                    pending_figures.windows[op_id] = figure.window
                pending_figures.marks.update(figure.marks)

        pending_types[op_id] = op_type

    op_order = {op["id"]: index for index, op in enumerate(normalized["ops"])}
    movable_ids = {
        op["id"]
        for op in normalized["ops"]
        if op["op"] != "curve"
        and "canvas_id" not in op
        and "construct" not in op
        and "on" not in op
    }
    for relation_index, relation in enumerate(normalized.get("layout", [])):
        moving_ids = [relation["id"]] if relation["kind"] == "place" else relation["ids"]
        if any(
            element_id not in pending_types or element_id not in movable_ids
            for element_id in moving_ids
        ):
            semantic_issues.append(
                f"layout {relation_index} may move only independent operations in the current step"
            )
            continue
        if relation["kind"] == "place":
            reference_id = relation["relative_to"]
            moving_index = op_order[relation["id"]]
            reference_index = op_order.get(reference_id)
            if reference_id not in visible_types and (
                reference_index is None or reference_index >= moving_index
            ):
                semantic_issues.append(
                    f"layout {relation_index} place target is not already accepted"
                )

    if semantic_issues:
        raise StepValidationError(semantic_issues)

    state.accepted_ids.update(pending_types)
    state.accepted_axes.update(pending_axes)
    state.figures = pending_figures
    state.accepted_step_ids.add(step_id)
    state.accepted_steps += 1
    if normalized["checkpoint"] is not None:
        state.checkpoint_accepted = True
    return ValidatedStep(step=normalized, sanitization=sanitization)


def _construction_reference_issues(
    index: int,
    relation: dict[str, Any],
    accepted_before_step: dict[str, str],
) -> list[str]:
    """Validate only stable prior-step construction references.

    Exact intersection, curve sampling, coordinate-space and board-boundary
    decisions remain browser renderer truth. The backend intentionally checks
    the closed relation vocabulary and type inventory without claiming browser
    geometry that it cannot observe.
    """

    def accepted_as(element_id: str, allowed: set[str]) -> bool:
        return accepted_before_step.get(element_id) in allowed

    def point_reference_issue(reference: dict[str, Any]) -> str | None:
        element_id = reference["element_id"]
        allowed = {"point"} if reference["kind"] == "point" else {"line", "arrow"}
        if accepted_as(element_id, allowed):
            return None
        return f"op {index} construction point reference is not accepted prior-step geometry"

    kind = relation["kind"]
    if kind == "tangent_at":
        if accepted_as(relation["curve"], {"curve"}):
            return []
        return [f"op {index} tangent curve is not accepted prior-step geometry"]
    if kind == "perpendicular_through":
        issues = []
        if not accepted_as(relation["line"], {"line", "arrow"}):
            issues.append(f"op {index} perpendicular line is not accepted prior-step geometry")
        point_issue = point_reference_issue(relation["point"])
        if point_issue:
            issues.append(point_issue)
        return issues
    if kind == "along":
        if accepted_as(relation["element_id"], {"line", "arrow", "curve"}):
            return []
        return [f"op {index} along target is not accepted prior-step geometry"]
    if kind == "midpoint_of":
        return [
            issue
            for reference in (relation["a"], relation["b"])
            if (issue := point_reference_issue(reference)) is not None
        ]
    if kind == "intersection_of":
        if relation["a"] == relation["b"]:
            return [f"op {index} intersection inputs must be distinct"]
        return [
            f"op {index} intersection input is not accepted prior-step geometry"
            for element_id in (relation["a"], relation["b"])
            if not accepted_as(element_id, {"line", "arrow", "curve"})
        ]
    if accepted_as(relation["element_id"], {"point", "line", "arrow", "curve"}):
        return []
    return [f"op {index} offset target is not accepted prior-step geometry"]


def validate_envelope(value: Any) -> None:
    issues = _schema_issues(envelope_validator(), value)
    if issues:
        raise ValueError("invalid CHALK lesson stream envelope: " + "; ".join(issues))


def validate_curve_expression(expression: str, variable: str = "x") -> None:
    """Parse the CHALK expression subset (one free variable) without evaluating it."""

    try:
        tree = ast.parse(expression.replace("^", "**"), mode="eval")
    except (SyntaxError, ValueError, TypeError):
        raise ValueError("syntax is outside the restricted grammar") from None

    nodes = list(ast.walk(tree))
    if len(nodes) > MAX_EXPRESSION_NODES:
        raise ValueError("expression is too complex")

    for node in nodes:
        if isinstance(node, (ast.Load, ast.Expression)):
            continue
        if isinstance(node, ast.BinOp):
            if not isinstance(node.op, ALLOWED_BINARY_OPERATORS):
                raise ValueError("operator is not allowed")
            continue
        if isinstance(node, ast.UnaryOp):
            if not isinstance(node.op, ALLOWED_UNARY_OPERATORS):
                raise ValueError("unary operator is not allowed")
            continue
        if isinstance(node, ALLOWED_BINARY_OPERATORS + ALLOWED_UNARY_OPERATORS):
            continue
        if isinstance(node, ast.Name):
            allowed_names = (ALLOWED_NAMES - {"x"}) | {variable}
            if node.id not in allowed_names and node.id not in ALLOWED_FUNCTIONS:
                raise ValueError("name is not allowed")
            continue
        if isinstance(node, ast.Call):
            if (
                not isinstance(node.func, ast.Name)
                or node.func.id not in ALLOWED_FUNCTIONS
                or len(node.args) != 1
                or node.keywords
            ):
                raise ValueError("function call is not allowed")
            continue
        if isinstance(node, ast.Constant):
            if (
                isinstance(node.value, bool)
                or not isinstance(node.value, (int, float))
                or not math.isfinite(float(node.value))
                or abs(float(node.value)) > MAX_NUMERIC_LITERAL
            ):
                raise ValueError("numeric literal is outside the budget")
            continue
        raise ValueError("syntax node is not allowed")


def _load_schema(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise RuntimeError(f"Schema at {path.name} is not an object")
    Draft7Validator.check_schema(value)
    return value


def _schema_issues(validator: Draft7Validator, value: Any) -> list[str]:
    errors = sorted(validator.iter_errors(value), key=lambda error: list(error.absolute_path))
    issues: list[str] = []
    for error in errors[:12]:
        path = "/" + "/".join(str(part) for part in error.absolute_path)
        issues.append(f"{path or '/'} {error.message}")
    return issues
