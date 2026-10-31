"""Differential fuzz for schema-1.5 figure validation (offline, no network).

Writes seeded random two-step lessons: a valid starting figure in a random
frame, then one `figure ... on` op with random marks of every kind, point form,
and edge value (unknown references, empty ranges, unsupported expressions,
off-window literals, nested groups). Each case carries this backend's verdict;
`frontend/scripts/figure-fuzz.mjs` adds the browser verdict, renders every
accepted case, and reports any disagreement. Never imported by the web
application and never run in CI.

Usage: uv run --project backend python -m app.figure_fuzz --seed 2 --count 6000 --output cases.json
"""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from app.lesson_validation import LessonValidationState, StepValidationError, validate_step

EXPRESSIONS = (
    "x^2/4",
    "sin(x)",
    "2*x+1",
    "sqrt(x)",
    "1/x",
    "log(x)",
    "exp(x)",
    "abs(x)",
    "x^3-x",
    "0.5",
    "cos(t)",
    "sin(2*t)",
    "t/4",
    "theta/8",
    "1+cos(theta)",
    "foo(x)",
    "x +",
    "2^(x*90)",
    "x*y",
    "pi*x",
    "e^x",
    "tan(x)",
)
LEAF_KINDS = (
    "point",
    "segment",
    "polyline",
    "circle",
    "arc",
    "fn",
    "param",
    "polar",
    "shade",
    "angle",
    "tangent",
    "perpendicular",
    "measure",
    "text",
)
LABELLED = {
    "point",
    "segment",
    "polyline",
    "circle",
    "arc",
    "fn",
    "param",
    "polar",
    "shade",
    "angle",
    "tangent",
    "perpendicular",
}
STROKED = {
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


class CaseBuilder:
    """Random marks for one case, tracking which IDs each reference form may use."""

    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self.window: dict[str, list[float]] = {}
        self.points: list[str] = []
        self.functions: list[str] = []
        self.straight: list[str] = []
        self.closed: list[str] = []
        self.named: list[str] = []
        self.serial = 0

    def number(self, low: float, high: float) -> float:
        roll = self.rng.random()
        if roll < 0.88:
            return round(self.rng.uniform(low, high), 3)
        if roll < 0.94:
            return self.rng.choice([low, high, 0, (low + high) / 2])
        span = high - low
        return round(self.rng.uniform(low - span, high + span), 3)

    def frame(self) -> dict[str, Any]:
        x0 = self.rng.choice([-5, -2, -1, 0, -0.5])
        y0 = self.rng.choice([-3, -1, 0, -0.7])
        x1 = x0 + self.rng.choice([1, 2.3, 4, 8, 12])
        y1 = y0 + self.rng.choice([1, 2, 5, 6, 10])
        if self.rng.random() < 0.01:
            x1 = x0
        frame: dict[str, Any] = {"x": [x0, x1], "y": [y0, y1]}
        axes = self.rng.choice(["edge", "origin", "none", None])
        if axes:
            frame["axes"] = axes
        if self.rng.random() < 0.3:
            frame["equal_scale"] = self.rng.random() < 0.5
        if self.rng.random() < 0.2:
            frame["grid"] = True
        if axes in {"edge", "origin"} and self.rng.random() < 0.5:
            frame["x_label"], frame["y_label"] = "x", "y"
        self.window = frame
        return frame

    def base_marks(self) -> list[dict[str, Any]]:
        """A valid starting figure with named marks for later references."""

        (x0, x1), (y0, y1) = self.window["x"], self.window["y"]
        width, height = x1 - x0, y1 - y0
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

        def at(fx: float, fy: float) -> list[float]:
            return [round(x0 + fx * width, 3), round(y0 + fy * height, 3)]

        slope = round(0.2 * height / max(width, 1e-9), 4)
        marks = [
            {"kind": "point", "id": "pa", "at": at(0.2, 0.25), "label": "A"},
            {"kind": "point", "id": "pb", "at": at(0.8, 0.25), "label": "B"},
            {"kind": "point", "id": "pc", "at": at(0.45, 0.8), "label": "C"},
            {"kind": "segment", "id": "sab", "from": {"at": "pa"}, "to": {"at": "pb"}},
            {
                "kind": "polyline",
                "id": "tri",
                "points": [{"at": "pa"}, {"at": "pb"}, {"at": "pc"}],
                "closed": True,
            },
            {"kind": "fn", "id": "fl", "y": f"{round(cy, 3)} + {slope}*(x - {round(cx, 3)})"},
            {
                "kind": "circle",
                "id": "ring",
                "center": [round(cx, 3), round(cy, 3)],
                "r": round(min(width, height) / 6, 3),
            },
        ][: self.rng.choice([3, 4, 5, 6, 7])]
        pools = {
            "pa": self.points,
            "pb": self.points,
            "pc": self.points,
            "sab": self.straight,
            "tri": self.closed,
            "fl": self.functions,
            "ring": self.closed,
        }
        for mark in marks:
            pools[mark["id"]].append(mark["id"])
            self.named.append(mark["id"])
        return marks

    def literal(self) -> list[float]:
        return [self.number(*self.window["x"]), self.number(*self.window["y"])]

    def pick(self, pool: list[str]) -> str:
        if pool and self.rng.random() < 0.93:
            return self.rng.choice(pool)
        return self.rng.choice(["nope", "zz9"])

    def point(self) -> Any:
        roll = self.rng.random()
        lines = self.straight + self.functions
        if roll < 0.45 or not self.named:
            return self.literal()
        if roll < 0.65:
            return {"at": self.pick(self.points)}
        if roll < 0.72:
            return {"mid": [self.pick(self.points), self.pick(self.points)]}
        if roll < 0.8:
            return {"on": self.pick(self.functions), "x": self.number(*self.window["x"])}
        if roll < 0.86:
            return {"on": self.pick(lines), "t": round(self.rng.uniform(-0.1, 1.1), 3)}
        if roll < 0.93:
            return {"hit": [self.pick(lines), self.pick(lines)]}
        return {"foot": self.pick(self.points), "onto": self.pick(self.straight)}

    def name(self, mark: dict[str, Any], pool: list[str] | None = None) -> None:
        if self.rng.random() >= 0.6:
            return
        self.serial += 1
        mark_id = f"{mark['kind'][0]}{self.serial}"
        if self.rng.random() < 0.05 and self.named:
            mark_id = self.rng.choice(self.named)
        mark["id"] = mark_id
        if pool is not None:
            pool.append(mark_id)
        self.named.append(mark_id)

    def mark(self, depth: int = 0) -> dict[str, Any]:
        kind = self.rng.choice(LEAF_KINDS + (("group",) if depth == 0 else ()))
        mark: dict[str, Any] = {"kind": kind}
        rng = self.rng
        (x0, x1), (y0, y1) = self.window["x"], self.window["y"]
        span = max(x1 - x0, y1 - y0, 1e-9)
        if kind == "point":
            mark["at"] = self.point()
            self.name(mark, self.points)
        elif kind in {"segment", "measure"}:
            mark["from"], mark["to"] = self.point(), self.point()
            if kind == "measure":
                mark["label"] = "d"
                self.name(mark)
            else:
                if rng.random() < 0.3:
                    mark["arrow"] = True
                self.name(mark, self.straight)
        elif kind == "polyline":
            mark["points"] = [self.point() for _ in range(rng.choice([1, 2, 3, 4, 5]))]
            for flag in ("closed", "smooth", "fill", "arrow"):
                if rng.random() < 0.25:
                    mark[flag] = True
            self.name(mark, self.closed if mark.get("closed") else None)
        elif kind == "circle":
            mark["center"] = self.point()
            mark["r"] = rng.choice([self.number(0.05, span / 3), 0, -1, span * 3])
            if rng.random() < 0.2:
                mark["fill"] = True
            self.name(mark, self.closed)
        elif kind == "arc":
            mark["center"], mark["r"] = self.point(), self.number(0.05, span / 3)
            mark["start"] = rng.choice([0, 90, 180, -90, 30, 720, 800])
            mark["end"] = rng.choice([0, 90, 270, -180, 45, 359])
            if rng.random() < 0.2:
                mark["arrow"] = True
            self.name(mark)
        elif kind == "fn":
            mark["y"] = rng.choice(EXPRESSIONS)
            if rng.random() < 0.5:
                mark["domain"] = [self.number(x0, x1), self.number(x0, x1)]
            self.name(mark, self.functions)
        elif kind == "param":
            mark["x"], mark["y"] = rng.choice(EXPRESSIONS), rng.choice(EXPRESSIONS)
            mark["t"] = [0, rng.choice([1, 3.14, 6.283, -1])]
            self.name(mark)
        elif kind == "polar":
            mark["r"], mark["theta"] = (
                rng.choice(EXPRESSIONS),
                [0, rng.choice([3.14, 6.283, 12.6, -2])],
            )
            self.name(mark)
        elif kind == "shade":
            form = rng.choice(["under", "between", "inside"])
            if form == "under":
                mark["under"] = self.pick(self.functions)
            elif form == "between":
                mark["between"] = [self.pick(self.functions), self.pick(self.functions)]
            else:
                mark["inside"] = self.pick(self.closed + self.functions)
            if form != "inside" and rng.random() < 0.5:
                mark["from"], mark["to"] = self.number(x0, x1), self.number(x0, x1)
        elif kind == "angle":
            mark["at"], mark["from"], mark["to"] = self.point(), self.point(), self.point()
            if rng.random() < 0.5:
                mark["r"] = rng.choice([0.03, 0.08, 0.2, 0.3, 0.5])
            self.name(mark)
        elif kind == "tangent":
            mark["to"], mark["x"] = self.pick(self.functions), self.number(x0, x1)
            if rng.random() < 0.5:
                mark["length"] = rng.choice([0.05, 0.4, 1, 2])
            self.name(mark, self.straight)
        elif kind == "perpendicular":
            mark["to"], mark["through"] = self.pick(self.straight), self.point()
            if rng.random() < 0.5:
                mark["length"] = rng.choice([0.05, 0.4, 1])
            self.name(mark, self.straight)
        elif kind == "text":
            mark["at"] = self.point()
            mark["text"] = rng.choice(["note", "x = 3", "a much longer note here"])
            if rng.random() < 0.3:
                mark["size"] = rng.choice(["small", "normal", "large"])
        else:
            mark["marks"] = [self.mark(1) for _ in range(rng.choice([1, 2, 3]))]
            if rng.random() < 0.4:
                mark["repeat"] = rng.choice([2, 3, 6, 12])
            for key, value in (
                ("rotate", rng.choice([0, 45, 90, 180, -60])),
                ("scale", rng.choice([0.5, 1, 2])),
                ("mirror", rng.choice(["x", "y"])),
                ("translate", self.literal()),
                ("origin", self.literal()),
            ):
                if rng.random() < 0.3:
                    mark[key] = value
        if kind in LABELLED and rng.random() < 0.25:
            mark["label"] = rng.choice(["A", "P (1, 1)", "θ", "a label"])
        if kind in STROKED and rng.random() < 0.15:
            mark["stroke"] = "dashed"
        if rng.random() < 0.02:
            mark["bogus"] = 1
        return mark


def make_case(rng: random.Random, case_id: str) -> dict[str, Any]:
    builder = CaseBuilder(rng)
    first = {
        "op": "figure",
        "id": "fig",
        "region": rng.choice(["right", "left", "full"]),
        "frame": builder.frame(),
        "marks": builder.base_marks(),
    }
    second = {
        "op": "figure",
        "id": "more",
        "on": "fig",
        "marks": [builder.mark() for _ in range(rng.choice([1, 2, 3, 4]))],
    }
    steps = [
        {"id": "s1", "script": "Draw the figure.", "ops": [first], "checkpoint": None},
        {"id": "s2", "script": "Add to the figure.", "ops": [second], "checkpoint": None},
    ]
    verdict, issues = backend_verdict(steps)
    return {"id": case_id, "steps": steps, "python": verdict, "issues": issues}


def backend_verdict(steps: list[dict[str, Any]]) -> tuple[str, list[str]]:
    state = LessonValidationState()
    try:
        validate_step(steps[0], state)
    except StepValidationError as error:
        return "setup_rejected", [str(issue) for issue in error.issues][:3]
    try:
        validate_step(steps[1], state)
    except StepValidationError as error:
        return "reject", [str(issue) for issue in error.issues][:3]
    return "accept", []


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--count", type=int, default=3000)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    rng = random.Random(args.seed)
    cases = [make_case(rng, f"fz{args.seed}-{index}") for index in range(args.count)]
    args.output.write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
    print(dict(Counter(case["python"] for case in cases)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
