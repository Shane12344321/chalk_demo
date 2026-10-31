"""Shared-fixture parity between backend validation and the browser renderer.

These fixtures pin the browser's acceptance truth (F2/F3 in the natural-drawing
plan). Every case the browser rejects must be rejected here too, so the repair
budget fires server-side instead of costing a browser-dropped op.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from app.latex_lint import lint_equation_latex
from app.lesson_sanitizer import sanitize_step
from app.lesson_validation import (
    LessonValidationState,
    StepValidationError,
    validate_step,
    validate_step_with_sanitization,
)

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "shared/fixtures"
CURVE_CASES: list[dict[str, Any]] = json.loads(
    (FIXTURE_DIR / "curve-parity.json").read_text(encoding="utf-8")
)["cases"]
LATEX_CASES: list[dict[str, Any]] = json.loads(
    (FIXTURE_DIR / "latex-parity.json").read_text(encoding="utf-8")
)["cases"]
SANITIZER_CASES: list[dict[str, Any]] = json.loads(
    (FIXTURE_DIR / "sanitizer-parity.json").read_text(encoding="utf-8")
)["cases"]


def curve_step(case: dict[str, Any]) -> dict[str, Any]:
    axes = case["axes"]
    curve: dict[str, Any] = {
        "op": "curve",
        "id": "curve1",
        "axes_id": "axes1",
        "expr": case["expr"],
    }
    if case["domain"] is not None:
        curve["domain"] = case["domain"]
    return {
        "id": "s1",
        "script": "Sample this curve against its axes.",
        "ops": [
            {
                "op": "axes",
                "id": "axes1",
                "region": "right",
                "x": axes["x"],
                "y": axes["y"],
            },
            curve,
        ],
        "checkpoint": None,
    }


@pytest.mark.parametrize("case", CURVE_CASES, ids=lambda case: case["name"])
def test_curve_parity_matches_the_browser_sampler(case: dict[str, Any]) -> None:
    state = LessonValidationState()
    step = curve_step(case)
    backend_expect = case.get("backend_expect", case.get("expect"))
    assert backend_expect in {"accept", "reject"}
    if backend_expect == "accept":
        accepted = validate_step(step, state)
        assert accepted["ops"][1]["expr"] == case.get("emitted_expr", case["expr"])
    else:
        with pytest.raises(StepValidationError):
            validate_step(step, state)
        assert state.accepted_ids == {}


@pytest.mark.parametrize("case", LATEX_CASES, ids=lambda case: case["name"])
def test_latex_parity_matches_the_browser_renderer(case: dict[str, Any]) -> None:
    issues = lint_equation_latex(case["latex"])
    if case["expect"] == "accept":
        assert issues == []
    else:
        assert issues != []


@pytest.mark.parametrize("case", SANITIZER_CASES, ids=lambda case: case["name"])
def test_safe_sanitizer_matches_the_shared_fixture(case: dict[str, Any]) -> None:
    result = sanitize_step(case["input"])
    assert result.value == case["expected"]
    assert list(result.corrections) == case["corrections"]
    assert result.correction_count == case["correction_count"]

    second = sanitize_step(result.value)
    assert second.value == result.value
    assert second.corrections == ()
    assert second.correction_count == 0


def test_safe_sanitizer_correction_evidence_is_bounded() -> None:
    step = {
        "id": "s1",
        "script": "Draw many near-boundary points.",
        "ops": [
            {
                "op": "sketch",
                "id": "sketch1",
                "region": "left",
                "strokes": [[[-0.01, 1.01] for _ in range(40)]],
            }
        ],
        "checkpoint": None,
    }
    assert sanitize_step(step).correction_count == 64


def test_equation_steps_run_the_latex_lint() -> None:
    state = LessonValidationState()
    step = {
        "id": "s1",
        "script": "Write the identity on the board.",
        "ops": [{"op": "equation", "id": "eq1", "region": "A1", "latex": "\\foo{2}"}],
        "checkpoint": None,
    }
    with pytest.raises(StepValidationError, match="unknown latex command"):
        validate_step(step, state)


def test_checkpoint_budget_drops_a_later_checkpoint_without_a_repair() -> None:
    state = LessonValidationState()
    checkpoint = {"question": "Ready?", "expected_gist": "yes"}
    first = {
        "id": "s1",
        "script": "First step with the lesson checkpoint.",
        "ops": [{"op": "text", "id": "t1", "region": "A1", "content": "One"}],
        "checkpoint": checkpoint,
    }
    second = {
        "id": "s2",
        "script": "Second step must not add another checkpoint.",
        "ops": [{"op": "text", "id": "t2", "region": "A2", "content": "Two"}],
        "checkpoint": checkpoint,
    }
    assert validate_step(first, state)["checkpoint"] == checkpoint
    accepted = validate_step_with_sanitization(second, state)
    assert accepted.step["checkpoint"] is None
    assert accepted.step["ops"] == second["ops"]
    assert accepted.sanitization.corrections == ("dropped_extra_checkpoint",)
    assert accepted.sanitization.correction_count == 1
    assert second["checkpoint"] == checkpoint


def test_whitespace_script_is_rejected() -> None:
    state = LessonValidationState()
    step = {
        "id": "s1",
        "script": "   ",
        "ops": [{"op": "text", "id": "t1", "region": "A1", "content": "One"}],
        "checkpoint": None,
    }
    with pytest.raises(StepValidationError, match=r"non-empty|no spoken words"):
        validate_step(step, state)


def test_giant_float_power_fails_fast_instead_of_hanging() -> None:
    state = LessonValidationState()
    case = {
        "expr": "1000000^1000000",
        "domain": None,
        "axes": {
            "x": {"min": -2, "max": 2, "label": "x"},
            "y": {"min": 0, "max": 4, "label": "y"},
        },
    }
    with pytest.raises(StepValidationError):
        validate_step(curve_step(case), state)


def test_nested_power_is_rejected_before_materializing_the_exponent() -> None:
    state = LessonValidationState()
    case = {
        "expr": "2^(1000000^1000000)",
        "domain": None,
        "axes": {
            "x": {"min": -2, "max": 2, "label": "x"},
            "y": {"min": 0, "max": 4, "label": "y"},
        },
    }
    with pytest.raises(StepValidationError, match="exponent exceeds"):
        validate_step(curve_step(case), state)


@pytest.mark.parametrize(
    ("latex", "category"),
    [
        ("\\foo{2}", "latex_command"),
        ("\\begin{tabular}{c} a \\end{tabular}", "latex_environment"),
        ("\\frac{1}{2", "latex_braces"),
        ("$x$", "latex_dollar"),
        ("\\left(\\frac{1}{2}", "latex_left_right"),
        ("\\def\\x{1}x", "latex_forbidden"),
    ],
)
def test_latex_repairs_are_logged_by_cause(latex: str, category: str) -> None:
    from app.lessons import _issue_category

    issues = lint_equation_latex(latex)
    assert issues
    assert _issue_category(issues[0]) == category


@pytest.mark.parametrize(
    "checkpoint",
    [
        {"question": "Is it rising?", "expected_gist": "x" * 81},
        {"question": "Q" * 121, "expected_gist": "rising"},
        {"question": "Is it rising?", "expected_gist": "rising", "answer": "yes"},
        "Is it rising?",
    ],
)
def test_invalid_checkpoint_is_dropped_without_a_repair(checkpoint: object) -> None:
    step = {
        "id": "s1",
        "script": "Watch the curve rise.",
        "ops": [{"op": "text", "id": "t1", "region": "A1", "content": "Rising"}],
        "checkpoint": checkpoint,
    }
    accepted = validate_step_with_sanitization(step, LessonValidationState())
    assert accepted.step["checkpoint"] is None
    assert accepted.sanitization.corrections == ("dropped_invalid_checkpoint",)
    assert step["checkpoint"] == checkpoint
