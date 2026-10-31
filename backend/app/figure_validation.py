"""Semantic rules for schema-1.5 `figure` ops.

Mirrors frontend/src/board/figureValidation.ts and is pinned in both languages
by shared/fixtures/figure-parity.json. Mark IDs share one namespace with
element IDs; a reference may name only a mark drawn earlier in the same
figure frame. Expressions are parsed with the closed AST allowlist for their
one variable and sampled with the browser's sampling contract. Exact
intersections and other geometric truths remain browser renderer truth.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

from app.expression_runtime import CurveSamplingError, longest_visible_run, sample_values

MAX_EXPANDED_FIGURE_MARKS = 64
FUNCTION_SAMPLES = 121
CURVE_SAMPLES = 181
STROKE_KINDS = {
    "segment",
    "polyline",
    "circle",
    "arc",
    "fn",
    "param",
    "polar",
    "tangent",
    "perpendicular",
}
STRAIGHT_KINDS = {"segment", "tangent", "perpendicular"}
_EXPRESSION_CHARACTERS = r"[0-9a-zA-Z_+\-*/^().\s]+"


@dataclass
class FigureMarkInfo:
    root: str
    kind: str
    closed: bool


@dataclass
class FigureState:
    roots: dict[str, str] = field(default_factory=dict)
    windows: dict[str, tuple[tuple[float, float], tuple[float, float]]] = field(
        default_factory=dict
    )
    marks: dict[str, FigureMarkInfo] = field(default_factory=dict)


@dataclass(frozen=True)
class AcceptedFigure:
    root: str
    window: tuple[tuple[float, float], tuple[float, float]]
    marks: list[tuple[str, FigureMarkInfo]]


class FigureIssue(ValueError):
    pass


def validate_figure_op(
    op: dict[str, Any],
    state: FigureState,
    element_ids: set[str],
) -> AcceptedFigure:
    """Return the marks this op adds, or raise FigureIssue with a repair-safe reason."""

    if "frame" in op:
        x_range = tuple(op["frame"]["x"])
        y_range = tuple(op["frame"]["y"])
        if not x_range[0] < x_range[1] or not y_range[0] < y_range[1]:
            raise FigureIssue("figure frame ranges must increase")
        root = op["id"]
        window = (x_range, y_range)
    else:
        parent = state.roots.get(op["on"])
        if parent is None:
            raise FigureIssue("figure `on` must name an accepted figure")
        root = parent
        window = state.windows[parent]
    if _expanded_count(op["marks"]) > MAX_EXPANDED_FIGURE_MARKS:
        raise FigureIssue(f"a figure op may draw at most {MAX_EXPANDED_FIGURE_MARKS} marks")

    known = dict(state.marks)
    added: list[tuple[str, FigureMarkInfo]] = []

    def visit(mark: dict[str, Any], index: str) -> None:
        mark_id = mark.get("id")
        if mark_id is not None and (
            mark_id in element_ids or mark_id in known or mark_id == op["id"]
        ):
            raise FigureIssue(f"mark {index}: id {mark_id} is already used on the board")
        try:
            if mark["kind"] == "group":
                for child_index, child in enumerate(mark["marks"]):
                    visit(child, f"{index}.{child_index}")
            else:
                _leaf_issues(mark, root, window, known)
        except FigureIssue as issue:
            if str(issue).startswith("mark "):
                raise
            raise FigureIssue(f"mark {index}: {issue}") from None
        if mark_id is not None:
            info = FigureMarkInfo(
                root=root,
                kind=mark["kind"],
                closed=mark["kind"] == "circle"
                or (mark["kind"] == "polyline" and bool(mark.get("closed"))),
            )
            known[mark_id] = info
            added.append((mark_id, info))

    for index, mark in enumerate(op["marks"]):
        visit(mark, str(index))
    return AcceptedFigure(root=root, window=window, marks=added)


def _expanded_count(marks: list[dict[str, Any]]) -> int:
    return sum(
        len(mark["marks"]) * mark.get("repeat", 1) if mark["kind"] == "group" else 1
        for mark in marks
    )


def _leaf_issues(
    mark: dict[str, Any],
    root: str,
    window: tuple[tuple[float, float], tuple[float, float]],
    known: dict[str, FigureMarkInfo],
) -> None:
    def reference(mark_id: str, allowed: set[str] | None, what: str) -> None:
        info = known.get(mark_id)
        if info is None or info.root != root:
            raise FigureIssue(f"{mark_id} is not an earlier mark in this figure")
        if allowed is not None and info.kind not in allowed:
            raise FigureIssue(f"{mark_id} is not {what}")

    def closed(mark_id: str) -> None:
        reference(mark_id, None, "a closed shape")
        if not known[mark_id].closed:
            raise FigureIssue(f"{mark_id} is not a closed shape")

    def point(value: Any) -> None:
        if isinstance(value, list):
            return
        if "at" in value:
            reference(value["at"], {"point"}, "a point")
        elif "mid" in value:
            for item in value["mid"]:
                reference(item, {"point"}, "a point")
        elif "on" in value:
            if "x" in value:
                reference(value["on"], {"fn"}, "a function")
            else:
                reference(value["on"], STROKE_KINDS, "a drawn line or curve")
        elif "hit" in value:
            if value["hit"][0] == value["hit"][1]:
                raise FigureIssue("hit needs two different marks")
            for item in value["hit"]:
                reference(item, STROKE_KINDS, "a drawn line or curve")
        else:
            reference(value["foot"], {"point"}, "a point")
            reference(value["onto"], STRAIGHT_KINDS, "a straight line")

    def same_literal(values: list[Any]) -> bool:
        return all(isinstance(value, list) for value in values) and all(
            value == values[0] for value in values
        )

    def sampled(points: list[tuple[float, float]]) -> None:
        if longest_visible_run(points, window[0], window[1]) < 2:
            raise FigureIssue("curve has fewer than two visible samples inside the frame")

    def expression(text: str, variable: str) -> str:
        from app.lesson_validation import validate_curve_expression

        text = text.replace("**", "^")
        if not re.fullmatch(_EXPRESSION_CHARACTERS, text):
            raise FigureIssue("expression contains unsupported characters")
        try:
            validate_curve_expression(text, variable)
        except ValueError as error:
            raise FigureIssue(f"expression: {error}") from None
        return text

    def increasing(values: list[float], what: str) -> None:
        if not values[0] < values[1]:
            raise FigureIssue(f"{what} must increase")

    kind = mark["kind"]
    try:
        if kind in {"point", "text"}:
            point(mark["at"])
        elif kind in {"segment", "measure"}:
            point(mark["from"])
            point(mark["to"])
            if same_literal([mark["from"], mark["to"]]):
                raise FigureIssue("endpoints must differ")
        elif kind == "polyline":
            for item in mark["points"]:
                point(item)
            if same_literal(mark["points"]):
                raise FigureIssue("path has no length")
            if mark.get("arrow") and same_literal(mark["points"][-2:]):
                raise FigureIssue("arrow has no terminal direction")
        elif kind == "circle":
            point(mark["center"])
        elif kind == "arc":
            point(mark["center"])
            if abs(mark["end"] - mark["start"]) < 1:
                raise FigureIssue("arc must span at least one degree")
        elif kind == "angle":
            for name in ("at", "from", "to"):
                point(mark[name])
            corners = [mark["at"], mark["from"], mark["to"]]
            pairs = [(corners[0], corners[1]), (corners[0], corners[2]), (corners[1], corners[2])]
            if any(same_literal([left, right]) for left, right in pairs):
                raise FigureIssue("angle needs a vertex and two distinct rays")
        elif kind == "fn":
            domain = mark.get("domain") or list(window[0])
            increasing(domain, "domain")
            mark["y"] = expression(mark["y"], "x")
            sampled(sample_values(mark["y"], "x", domain[0], domain[1], FUNCTION_SAMPLES))
        elif kind == "param":
            increasing(mark["t"], "t range")
            mark["x"] = expression(mark["x"], "t")
            mark["y"] = expression(mark["y"], "t")
            xs = sample_values(mark["x"], "t", mark["t"][0], mark["t"][1], CURVE_SAMPLES)
            ys = sample_values(mark["y"], "t", mark["t"][0], mark["t"][1], CURVE_SAMPLES)
            sampled([(x[1], y[1]) for x, y in zip(xs, ys, strict=True)])
        elif kind == "polar":
            increasing(mark["theta"], "theta range")
            mark["r"] = expression(mark["r"], "theta")
            theta = mark["theta"]
            radii = sample_values(mark["r"], "theta", theta[0], theta[1], CURVE_SAMPLES)
            sampled([(r * math.cos(angle), r * math.sin(angle)) for angle, r in radii])
        elif kind == "shade":
            if "from" in mark and "to" in mark and not mark["from"] < mark["to"]:
                raise FigureIssue("shade range must increase")
            if "under" in mark:
                reference(mark["under"], {"fn"}, "a function")
            elif "between" in mark:
                if mark["between"][0] == mark["between"][1]:
                    raise FigureIssue("between needs two different functions")
                for item in mark["between"]:
                    reference(item, {"fn"}, "a function")
            else:
                closed(mark["inside"])
                for hole in mark.get("except", []):
                    if hole == mark["inside"]:
                        raise FigureIssue("except cannot name the shape being shaded")
                    closed(hole)
        elif kind == "tangent":
            reference(mark["to"], {"fn"}, "a function")
            if not window[0][0] <= mark["x"] <= window[0][1]:
                raise FigureIssue("tangent x is outside the frame")
        elif kind == "perpendicular":
            reference(mark["to"], STRAIGHT_KINDS, "a straight line")
            point(mark["through"])
    except CurveSamplingError as error:
        raise FigureIssue(str(error)) from None
