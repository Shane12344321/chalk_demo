import json
from pathlib import Path

import pytest

from app import lessons
from app.lesson_validation import LessonValidationState, StepValidationError, validate_step

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "shared/fixtures/figure-parity.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["id"])
def test_shared_figure_cases(case: dict) -> None:
    state = LessonValidationState()
    *setup, last = case["steps"]
    for step in setup:
        validate_step(step, state)
    if case["expect"] == "accept":
        validate_step(last, state)
        return
    with pytest.raises(StepValidationError):
        validate_step(last, state)


def test_prompt_v4_worked_examples_validate() -> None:
    template = (lessons.PROMPT_DIR / "board_engine_v4.md").read_text(encoding="utf-8")
    examples = [json.loads(line) for line in template.splitlines() if line.startswith('{"id"')]
    assert len(examples) >= 6
    state = LessonValidationState()
    for step in examples:
        if step["id"] == "s1":
            state = LessonValidationState()
        validate_step(step, state)
    assert any(op["op"] == "figure" for step in examples for op in step["ops"])


def test_figure_marks_join_the_repair_inventory() -> None:
    state = LessonValidationState()
    validate_step(FIXTURE["cases"][0]["steps"][0], state)
    assert "parab" in state.inventory()
    assert "plot" in state.inventory()
