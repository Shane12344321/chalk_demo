"""Schema-derived board prompt contract stays deterministic and complete."""

import hashlib
import json

import pytest

from app import lessons
from app.prompt_contract import (
    LESSON_PLAN_CONTRACT_MARKER,
    LESSON_PLAN_SCHEMA_PATH,
    LESSON_SCHEMA_PATH,
    LESSON_WIRE_CONTRACT_MARKER,
    MAX_FIGURE_WIRE_CONTRACT_CHARS,
    MAX_LESSON_PLAN_CONTRACT_CHARS,
    MAX_LESSON_WIRE_CONTRACT_CHARS,
    expand_prompt_contract,
    lesson_plan_contract,
    lesson_wire_contract,
)

LEGACY_PROMPT_SHA256 = {
    "board_engine_v1.md": "c5fff01c27bdafc44397f2d641723638a609d0f02d486a3feb2b146822f86af9",
    "board_engine_v2.md": "bdcb2d54250af75cec3877a684f46292e79f52b54bca4705302885275aeaaa5c",
}
PRE_COMPOSITION_V3_SHA256 = "1ef5b74244e997ba58e3040ae9861f3186d430a7cde78780afd957bc6c9396e6"


def test_generated_contract_is_bounded_deterministic_and_covers_every_op() -> None:
    contract = lesson_wire_contract()
    assert contract == lesson_wire_contract()
    assert len(contract) <= MAX_LESSON_WIRE_CONTRACT_CHARS

    schema = json.loads(LESSON_SCHEMA_PATH.read_text(encoding="utf-8"))
    definitions = schema["$defs"]
    figure_contract = lesson_wire_contract("v4")
    for reference in definitions["op"]["oneOf"]:
        op_schema = definitions[reference["$ref"].rsplit("/", 1)[-1]]
        variant_ref = op_schema.get("oneOf", [reference])[0]["$ref"]
        variant = definitions[variant_ref.rsplit("/", 1)[-1]]
        op_name = variant["properties"]["op"]["const"]
        assert f"- {op_name}:" in contract or f"- {op_name}:" in figure_contract
    # Prompts v1-v3 keep the schema-1.4 vocabulary byte for byte.
    assert "figure" not in contract
    assert hashlib.sha256(contract.encode()).hexdigest().startswith("589b4d285bfb9eb1")

    assert "[1..4]" in contract
    assert definitions["elementId"]["pattern"] in contract
    assert "diagramPrimitive =" in contract
    for primitive in ("line", "smooth", "rect", "ellipse", "arc", "point"):
        assert f'kind:"{primitive}"' in contract


def test_current_prompts_expand_one_marker_and_hash_the_expanded_bytes() -> None:
    for name in ("board_engine.md", "repair.md", "continue.md"):
        template = (lessons.PROMPT_DIR / name).read_text(encoding="utf-8")
        assert template.count(LESSON_WIRE_CONTRACT_MARKER) == 1
        expanded = lessons._prompt(name)
        assert LESSON_WIRE_CONTRACT_MARKER not in expanded
        assert lesson_wire_contract() in expanded
        assert lessons._prompt_sha256(name) == hashlib.sha256(expanded.encode()).hexdigest()


def test_generated_lesson_plan_contract_is_bounded_and_covers_closed_archetypes() -> None:
    contract = lesson_plan_contract()
    assert contract == lesson_plan_contract()
    assert len(contract) <= MAX_LESSON_PLAN_CONTRACT_CHARS

    schema = json.loads(LESSON_PLAN_SCHEMA_PATH.read_text(encoding="utf-8"))
    archetypes = schema["properties"]["composition_archetype"]["enum"]
    for archetype in archetypes:
        assert f'"{archetype}"' in contract
    assert "never emit rectangles" in contract


def test_only_board_v3_and_continuation_receive_the_plan_contract() -> None:
    for name in ("board_engine.md", "continue.md"):
        template = (lessons.PROMPT_DIR / name).read_text(encoding="utf-8")
        assert template.count(LESSON_PLAN_CONTRACT_MARKER) == 1
        assert lesson_plan_contract() in lessons._prompt(name)

    repair_template = (lessons.PROMPT_DIR / "repair.md").read_text(encoding="utf-8")
    assert LESSON_PLAN_CONTRACT_MARKER not in repair_template
    assert lesson_plan_contract() not in lessons._prompt("repair.md")
    assert lessons._prompt_sha256("board_engine.md") != PRE_COMPOSITION_V3_SHA256


def test_board_prompt_teaches_visual_patterns_and_the_word_removal_test() -> None:
    prompt = lessons._prompt("board_engine.md")
    assert "comparison -> side-by-side panels" in prompt
    assert "rate of change -> a curve with the local tangent" in prompt
    assert "Apply the word-removal test" in prompt
    assert "n1 = 1.5" in prompt


def test_legacy_prompts_are_returned_byte_for_byte() -> None:
    for name, expected_hash in LEGACY_PROMPT_SHA256.items():
        raw = (lessons.PROMPT_DIR / name).read_text(encoding="utf-8")
        assert lessons._prompt(name) == raw
        assert hashlib.sha256(raw.encode()).hexdigest() == expected_hash


@pytest.mark.parametrize(
    "template",
    ["missing", f"{LESSON_WIRE_CONTRACT_MARKER}\n{LESSON_WIRE_CONTRACT_MARKER}"],
)
def test_prompt_contract_rejects_missing_or_duplicate_markers(template: str) -> None:
    with pytest.raises(ValueError, match="exactly one"):
        expand_prompt_contract(template)


def test_prompt_contract_rejects_duplicate_plan_markers() -> None:
    template = (
        f"{LESSON_WIRE_CONTRACT_MARKER}\n"
        f"{LESSON_PLAN_CONTRACT_MARKER}\n{LESSON_PLAN_CONTRACT_MARKER}"
    )
    with pytest.raises(ValueError, match="at most one lesson-plan"):
        expand_prompt_contract(template)


def test_figure_contract_shows_one_coordinate_convention() -> None:
    contract = lesson_wire_contract("v4")
    assert contract == lesson_wire_contract("v4")
    assert len(contract) <= MAX_FIGURE_WIRE_CONTRACT_CHARS
    for op_name in ("text", "equation", "figure"):
        assert f"- {op_name}:" in contract
    for legacy in ("sketch", "axes", "curve", "diagram", "line", "arrow", "point", "angle_arc"):
        assert f"- {legacy}:" not in contract
    assert "normalizedPoint" not in contract
    for kind in (
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
        "group",
    ):
        assert f'kind:"{kind}"' in contract
    assert "figurePoint = [x,y] OR {at:elementId}" in contract
    # The checkpoint's limits are visible, so the model stops overrunning them.
    assert "checkpoint:null|{question:string[1..120],expected_gist:string[1..80]}" in contract


def test_v4_prompts_expand_the_figure_contract() -> None:
    for name in ("board_engine_v4.md", "repair.md", "continue.md"):
        expanded = lessons._prompt(name, "v4")
        assert lesson_wire_contract("v4") in expanded
        assert lesson_wire_contract() not in expanded
        assert lessons._prompt_sha256(name, "v4") == hashlib.sha256(expanded.encode()).hexdigest()
