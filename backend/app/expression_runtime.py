"""Bounded numeric sampling of already-validated curve expressions.

This mirrors the browser sampling contract in
``frontend/src/board/expression.ts`` and the shared fixture file
``shared/fixtures/curve-parity.json`` so repair can fire before the browser
ever receives an unrenderable curve. It interprets only CHALK's own closed
AST node set — the one ``validate_curve_expression`` has already accepted —
and therefore never evaluates model-produced code paths.
"""

from __future__ import annotations

import ast
import math
from typing import Any

SAMPLE_COUNT = 121
MAX_ABS_SAMPLE = 1_000_000.0
DISCONTINUITY_ABSOLUTE = 10_000.0
DISCONTINUITY_RELATIVE = 100.0
MIN_VISIBLE_RUN = 2
MAX_ABS_EXPONENT = 32.0

_FUNCTIONS = {
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "exp": math.exp,
    "log": math.log,
    "sqrt": math.sqrt,
    "abs": abs,
}
_NAMES = {"pi": math.pi, "e": math.e}


class CurveSamplingError(ValueError):
    """A bounded, repair-safe reason a curve cannot render in the browser."""


def sample_curve(
    expression: str,
    domain: tuple[float, float] | None,
    axes_x: dict[str, Any],
    axes_y: dict[str, Any],
) -> None:
    """Raise CurveSamplingError when the browser sampler would reject the curve."""

    start, end = domain if domain is not None else (axes_x["min"], axes_x["max"])
    if not (math.isfinite(start) and math.isfinite(end)) or start >= end:
        raise CurveSamplingError("curve domain must be finite and increasing")

    try:
        tree = ast.parse(expression.replace("^", "**"), mode="eval")
    except (SyntaxError, ValueError):
        raise CurveSamplingError("expression syntax is outside the restricted grammar") from None

    previous_y: float | None = None
    visible_run = 0
    longest_visible_run = 0
    for index in range(SAMPLE_COUNT):
        x = start + ((end - start) * index) / (SAMPLE_COUNT - 1)
        y = _evaluate(tree.body, x)
        if abs(y) > MAX_ABS_SAMPLE:
            raise CurveSamplingError(
                "expression output exceeds the rendering budget; restrict the domain"
            )
        if previous_y is not None and abs(y - previous_y) > max(
            DISCONTINUITY_ABSOLUTE, abs(previous_y) * DISCONTINUITY_RELATIVE
        ):
            raise CurveSamplingError("expression has a pathological sampled discontinuity")
        if axes_x["min"] <= x <= axes_x["max"] and axes_y["min"] <= y <= axes_y["max"]:
            visible_run += 1
            longest_visible_run = max(longest_visible_run, visible_run)
        else:
            visible_run = 0
        previous_y = y

    if longest_visible_run < MIN_VISIBLE_RUN:
        raise CurveSamplingError(
            "curve has fewer than two contiguous samples inside the axes ranges"
        )


def sample_values(
    expression: str,
    variable: str,
    start: float,
    end: float,
    count: int,
) -> list[tuple[float, float]]:
    """Samples `(variable, value)` exactly as the browser's compiled sampler does."""

    if not (math.isfinite(start) and math.isfinite(end)) or start >= end:
        raise CurveSamplingError("sample range must be finite and increasing")
    try:
        tree = ast.parse(expression.replace("^", "**"), mode="eval")
    except (SyntaxError, ValueError):
        raise CurveSamplingError("expression syntax is outside the restricted grammar") from None
    count = min(241, max(16, count))
    samples: list[tuple[float, float]] = []
    previous: float | None = None
    for index in range(count):
        value_in = start + ((end - start) * index) / (count - 1)
        value = _evaluate(tree.body, value_in, variable)
        if abs(value) > MAX_ABS_SAMPLE:
            raise CurveSamplingError(
                "expression output exceeds the rendering budget; restrict the range"
            )
        if previous is not None and abs(value - previous) > max(
            DISCONTINUITY_ABSOLUTE, abs(previous) * DISCONTINUITY_RELATIVE
        ):
            raise CurveSamplingError("expression has a pathological sampled discontinuity")
        samples.append((value_in, value))
        previous = value
    return samples


def longest_visible_run(
    points: list[tuple[float, float]],
    window_x: tuple[float, float],
    window_y: tuple[float, float],
) -> int:
    run = 0
    longest = 0
    for x, y in points:
        if window_x[0] <= x <= window_x[1] and window_y[0] <= y <= window_y[1]:
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    return longest


def _evaluate(node: ast.expr, x: float, variable: str = "x") -> float:
    result = _evaluate_node(node, x, variable)
    if isinstance(result, complex) or not math.isfinite(result):
        raise CurveSamplingError("expression produced a non-finite sample; restrict the domain")
    return float(result)


def _evaluate_node(node: ast.expr, x: float, variable: str = "x") -> float:
    try:
        if isinstance(node, ast.Constant):
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id == variable:
                return x
            return _NAMES[node.id]
        if isinstance(node, ast.UnaryOp):
            operand = _evaluate_node(node.operand, x, variable)
            return operand if isinstance(node.op, ast.UAdd) else -operand
        if isinstance(node, ast.BinOp):
            left = _evaluate_node(node.left, x, variable)
            right = _evaluate_node(node.right, x, variable)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if not math.isfinite(right) or abs(right) > MAX_ABS_EXPONENT:
                raise CurveSamplingError("expression exponent exceeds the rendering budget")
            result = left**right
            if isinstance(result, complex):
                raise CurveSamplingError(
                    "expression produced a non-finite sample; restrict the domain"
                )
            return result
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            return float(_FUNCTIONS[node.func.id](_evaluate_node(node.args[0], x, variable)))
    except CurveSamplingError:
        raise
    except (ZeroDivisionError, OverflowError, ValueError, KeyError, TypeError):
        raise CurveSamplingError(
            "expression produced a non-finite sample; restrict the domain"
        ) from None
    raise CurveSamplingError("expression syntax is outside the restricted grammar")
