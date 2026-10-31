"""Closed, evidence-preserving normalization for near-valid lesson steps."""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from typing import Any, Literal

SanitizationCode = Literal[
    "trimmed_outer_whitespace",
    "normalized_power_operator",
    "clamped_anchor_gap",
    "clamped_normalized_point",
    # Recorded by the step validator, never by `sanitize_step`.
    "dropped_extra_checkpoint",
    "dropped_invalid_checkpoint",
]

CLAMP_TOLERANCE = 0.05
MAX_RECORDED_CORRECTIONS = 64
_STRING_FIELDS = {
    "op",
    "kind",
    "id",
    "script",
    "content",
    "latex",
    "expr",
    "label",
    "meaning",
    "axes_id",
    "canvas_id",
    "region",
    "stroke",
    "side",
    "el",
    "question",
    "expected_gist",
    "element_id",
    "endpoint",
    "line",
    "a",
    "b",
}


@dataclass(frozen=True)
class SanitizationResult:
    value: Any
    corrections: tuple[SanitizationCode, ...]
    correction_count: int

    def with_correction(self, code: SanitizationCode) -> SanitizationResult:
        """The same evidence plus one more correction."""

        return SanitizationResult(
            self.value,
            self.corrections if code in self.corrections else (*self.corrections, code),
            min(MAX_RECORDED_CORRECTIONS, self.correction_count + 1),
        )


class _Recorder:
    def __init__(self) -> None:
        self.codes: list[SanitizationCode] = []
        self.count = 0

    def add(self, code: SanitizationCode) -> None:
        self.count = min(MAX_RECORDED_CORRECTIONS, self.count + 1)
        if code not in self.codes:
            self.codes.append(code)


def sanitize_step(value: Any) -> SanitizationResult:
    """Return a detached candidate with only closed, unambiguous corrections."""

    sanitized = copy.deepcopy(value)
    recorder = _Recorder()
    if not isinstance(sanitized, dict):
        return SanitizationResult(sanitized, (), 0)

    _trim_mapping_strings(sanitized, recorder)
    checkpoint = sanitized.get("checkpoint")
    if isinstance(checkpoint, dict):
        _trim_mapping_strings(checkpoint, recorder)

    ops = sanitized.get("ops")
    if isinstance(ops, list):
        for op in ops:
            if not isinstance(op, dict):
                continue
            _trim_mapping_strings(op, recorder)
            anchor = op.get("anchor")
            if isinstance(anchor, dict):
                _trim_mapping_strings(anchor, recorder)
                if "gap" in anchor:
                    anchor["gap"] = _clamp_near_unit_interval(
                        anchor["gap"], "clamped_anchor_gap", recorder
                    )
            construction = op.get("construct")
            if isinstance(construction, dict):
                _trim_mapping_strings(construction, recorder)
                for reference_name in ("point", "a", "b"):
                    reference = construction.get(reference_name)
                    if isinstance(reference, dict):
                        _trim_mapping_strings(reference, recorder)
            for axis_name in ("x", "y"):
                axis = op.get(axis_name)
                if isinstance(axis, dict):
                    _trim_mapping_strings(axis, recorder)
            expression = op.get("expr")
            if isinstance(expression, str) and "**" in expression:
                op["expr"] = expression.replace("**", "^")
                recorder.add("normalized_power_operator")
            _sanitize_normalized_points(op, recorder)
            primitives = op.get("primitives")
            if isinstance(primitives, list):
                for primitive in primitives:
                    if not isinstance(primitive, dict):
                        continue
                    _trim_mapping_strings(primitive, recorder)
                    _sanitize_normalized_points(primitive, recorder)

    return SanitizationResult(sanitized, tuple(recorder.codes), recorder.count)


def _trim_mapping_strings(value: dict[str, Any], recorder: _Recorder) -> None:
    for key in _STRING_FIELDS & value.keys():
        current = value[key]
        if not isinstance(current, str):
            continue
        trimmed = current.strip()
        if trimmed != current:
            value[key] = trimmed
            recorder.add("trimmed_outer_whitespace")


def _sanitize_normalized_points(op: dict[str, Any], recorder: _Recorder) -> None:
    for key in ("from", "to", "at", "center"):
        point = op.get(key)
        if isinstance(point, list):
            _sanitize_point(point, recorder)
    points = op.get("points")
    if isinstance(points, list):
        for point in points:
            if isinstance(point, list):
                _sanitize_point(point, recorder)
    strokes = op.get("strokes")
    if not isinstance(strokes, list):
        return
    for stroke in strokes:
        if not isinstance(stroke, list):
            continue
        for point in stroke:
            if isinstance(point, list):
                _sanitize_point(point, recorder)


def _sanitize_point(point: list[Any], recorder: _Recorder) -> None:
    for index, coordinate in enumerate(point):
        point[index] = _clamp_near_unit_interval(coordinate, "clamped_normalized_point", recorder)


def _clamp_near_unit_interval(
    value: Any,
    code: Literal["clamped_anchor_gap", "clamped_normalized_point"],
    recorder: _Recorder,
) -> Any:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return value
    if not math.isfinite(value):
        return value
    if -CLAMP_TOLERANCE <= value < 0:
        recorder.add(code)
        return 0
    if 1 < value <= 1 + CLAMP_TOLERANCE:
        recorder.add(code)
        return 1
    return value
