"""Deterministic lesson wire contract rendered from the shared JSON Schema."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LESSON_SCHEMA_PATH = PROJECT_ROOT / "shared/schema/lesson.schema.json"
LESSON_PLAN_SCHEMA_PATH = PROJECT_ROOT / "shared/schema/lesson-plan.schema.json"
LESSON_WIRE_CONTRACT_MARKER = "{{LESSON_WIRE_CONTRACT}}"
LESSON_PLAN_CONTRACT_MARKER = "{{LESSON_PLAN_CONTRACT}}"
# Schema 1.4 adds the bounded tangent-at construction. Keep a deliberately
# small fixed headroom above the measured generated contract (4,707 chars),
# so a later schema expansion still fails loudly rather than silently bloating
# every board-model request.
MAX_LESSON_WIRE_CONTRACT_CHARS = 4_720
# Prompt v4 shows only text, equation, and the schema-1.5 figure vocabulary.
MAX_FIGURE_WIRE_CONTRACT_CHARS = 3_700
MAX_LESSON_PLAN_CONTRACT_CHARS = 1_000
ContractVersion = Literal["v3", "v4"]
# Prompts v1-v3 keep the schema-1.4 vocabulary byte for byte; figures are v4-only.
LEGACY_CONTRACT_OPS = frozenset(
    {
        "text",
        "equation",
        "sketch",
        "axes",
        "curve",
        "diagram",
        "line",
        "arrow",
        "point",
        "angle_arc",
    }
)
FIGURE_CONTRACT_OPS = ("text", "equation", "figure")


@lru_cache(maxsize=2)
def lesson_wire_contract(version: ContractVersion = "v3") -> str:
    """Return a compact, stable model-facing contract derived from the schema."""

    if version == "v4":
        return _figure_wire_contract()
    schema = json.loads(LESSON_SCHEMA_PATH.read_text(encoding="utf-8"))
    definitions = schema["$defs"]
    step = definitions["step"]
    element_id = definitions["elementId"]
    region = definitions["region"]
    anchor = definitions["anchor"]
    normalized_point = definitions["normalizedPoint"]
    geometry_point_reference = definitions["geometryPointReference"]
    point_construction = definitions["pointConstruction"]
    perpendicular_construction = definitions["perpendicularConstruction"]
    tangent_construction = definitions["tangentConstruction"]
    line_construction = definitions["lineConstruction"]
    axis_spec = definitions["axisSpec"]
    stroke_style = definitions["strokeStyle"]
    diagram_primitive = definitions["diagramPrimitive"]

    lines = [
        "Wire contract (generated from shared/schema/lesson.schema.json):",
        (
            f"- A lesson accepts at most {schema['properties']['steps']['maxItems']} steps. "
            f"Each step is exactly {_object_shape(step, definitions)}."
        ),
        f"- elementId = string matching `{element_id['pattern']}`.",
        f"- region = {_enum(region['enum'])}.",
        f"- anchor = {_object_shape(anchor, definitions)}.",
        f"- normalizedPoint = {_describe(normalized_point, definitions)}.",
        (
            "- geometryPointReference = "
            + " OR ".join(
                _object_shape(_resolve(item, definitions), definitions)
                for item in geometry_point_reference["oneOf"]
            )
            + "."
        ),
        (
            "- pointConstruction = "
            + " OR ".join(
                _object_shape(_resolve(item, definitions), definitions)
                for item in point_construction["oneOf"]
            )
            + "."
        ),
        f"- perpendicularConstruction = {_object_shape(perpendicular_construction, definitions)}.",
        f"- tangentConstruction = {_object_shape(tangent_construction, definitions)}.",
        (
            "- lineConstruction = "
            + " OR ".join(
                _object_shape(_resolve(item, definitions), definitions)
                for item in line_construction["oneOf"]
            )
            + "."
        ),
        f"- axisSpec = {_object_shape(axis_spec, definitions)}.",
        f"- strokeStyle = {_enum(stroke_style['enum'])}.",
        (
            "- diagramPrimitive = "
            + " OR ".join(
                _object_shape(_resolve(item, definitions), definitions)
                for item in diagram_primitive["oneOf"]
            )
            + "."
        ),
        "- Ops are exact JSON objects (a `?` suffix marks an optional key):",
    ]

    for op_name, variants in _op_variants(definitions):
        if op_name not in LEGACY_CONTRACT_OPS:
            continue
        shapes = " OR ".join(_object_shape(variant, definitions) for variant in variants)
        lines.append(f"  - {op_name}: {shapes}")

    contract = "\n".join(lines)
    if len(contract) > MAX_LESSON_WIRE_CONTRACT_CHARS:
        raise ValueError("generated lesson wire contract exceeds prompt budget")
    return contract


def _figure_wire_contract() -> str:
    """Schema-1.5 contract: one coordinate convention (figure frames, y up)."""

    schema = json.loads(LESSON_SCHEMA_PATH.read_text(encoding="utf-8"))
    definitions = schema["$defs"]

    def variants(name: str) -> str:
        return " OR ".join(
            "[x,y]"
            if item.get("$ref") == "#/$defs/figureRange"
            else _object_shape(_resolve(item, definitions), definitions)
            for item in definitions[name]["oneOf"]
        )

    leaf = " OR ".join(
        _object_shape(_resolve(item, definitions), definitions)
        for item in definitions["figureLeafMark"]["oneOf"]
    )
    lines = [
        "Wire contract (generated from shared/schema/lesson.schema.json, schema 1.5):",
        (
            f"- A lesson accepts at most {schema['properties']['steps']['maxItems']} steps. "
            f"Each step is exactly {_object_shape(definitions['step'], definitions)}."
        ),
        f"- elementId = string matching `{definitions['elementId']['pattern']}`.",
        f"- region = {_enum(definitions['region']['enum'])}.",
        f"- anchor = {_object_shape(definitions['anchor'], definitions)}.",
        f"- strokeStyle = {_enum(definitions['strokeStyle']['enum'])}.",
        "- figureRange = [number,number] with the first below the second.",
        f"- figureFrame = {_object_shape(definitions['figureFrame'], definitions)}.",
        f"- figurePoint = {variants('figurePoint')}.",
        f"- figureLeafMark = {leaf}.",
        "- figureMark = figureLeafMark OR "
        f"{_object_shape(definitions['figureGroupMark'], definitions)}.",
        "- Ops are exact JSON objects (a `?` suffix marks an optional key):",
    ]
    by_name = dict(_op_variants(definitions))
    for op_name in FIGURE_CONTRACT_OPS:
        shapes = " OR ".join(_object_shape(variant, definitions) for variant in by_name[op_name])
        lines.append(f"  - {op_name}: {shapes}")
    contract = (
        "\n".join(lines)
        # Spelled out here: an undefined `checkpoint` hid its length limits.
        .replace(
            "checkpoint:null|checkpoint",
            f"checkpoint:null|{_object_shape(definitions['checkpoint'], definitions)}",
        )
        .replace("figureNumber", "number")
        .replace("number[-∞..1000000]", "number>0")
    )
    if len(contract) > MAX_FIGURE_WIRE_CONTRACT_CHARS:
        raise ValueError("generated figure wire contract exceeds prompt budget")
    return contract


@lru_cache(maxsize=1)
def lesson_plan_contract() -> str:
    """Return the exact bounded plan shape derived from its shared schema."""

    schema = json.loads(LESSON_PLAN_SCHEMA_PATH.read_text(encoding="utf-8"))
    contract = "\n".join(
        [
            "Lesson-plan contract (generated from shared/schema/lesson-plan.schema.json):",
            f"- Emit exactly {_object_shape(schema, {})}.",
            "- Optional composition_archetype selects browser-owned named zones only; "
            "never emit rectangles, coordinates, bounds, percentages, or custom zones.",
        ]
    )
    if len(contract) > MAX_LESSON_PLAN_CONTRACT_CHARS:
        raise ValueError("generated lesson-plan contract exceeds prompt budget")
    return contract


def expand_prompt_contract(template: str, version: ContractVersion = "v3") -> str:
    """Expand the required lesson marker and optional lesson-plan marker."""

    count = template.count(LESSON_WIRE_CONTRACT_MARKER)
    if count != 1:
        raise ValueError("schema-derived prompt must contain exactly one contract marker")
    plan_count = template.count(LESSON_PLAN_CONTRACT_MARKER)
    if plan_count > 1:
        raise ValueError("schema-derived prompt must contain at most one lesson-plan marker")
    expanded = template.replace(LESSON_WIRE_CONTRACT_MARKER, lesson_wire_contract(version))
    if plan_count == 1:
        expanded = expanded.replace(LESSON_PLAN_CONTRACT_MARKER, lesson_plan_contract())
    if LESSON_WIRE_CONTRACT_MARKER in expanded or LESSON_PLAN_CONTRACT_MARKER in expanded:
        raise ValueError("schema-derived prompt contract marker was not resolved")
    return expanded


def _op_variants(definitions: dict[str, Any]) -> list[tuple[str, list[dict[str, Any]]]]:
    result: list[tuple[str, list[dict[str, Any]]]] = []
    for op_ref in definitions["op"]["oneOf"]:
        op_schema = _resolve(op_ref, definitions)
        variants = [_resolve(item, definitions) for item in op_schema.get("oneOf", [op_schema])]
        names = {
            variant["properties"]["op"]["const"]
            for variant in variants
            if "op" in variant.get("properties", {})
        }
        if len(names) != 1:
            raise ValueError("lesson op variants do not share one discriminator")
        result.append((names.pop(), variants))
    return result


def _object_shape(schema: dict[str, Any], definitions: dict[str, Any]) -> str:
    schema = _resolve(schema, definitions)
    required = set(schema.get("required", []))
    properties = schema.get("properties", {})
    fields = []
    for name, field_schema in properties.items():
        suffix = "" if name in required else "?"
        fields.append(f"{name}{suffix}:{_describe(field_schema, definitions)}")
    return "{" + ",".join(fields) + "}"


def _describe(schema: dict[str, Any], definitions: dict[str, Any]) -> str:
    if "$ref" in schema:
        return schema["$ref"].rsplit("/", 1)[-1]
    if "const" in schema:
        return json.dumps(schema["const"], ensure_ascii=False)
    if "enum" in schema:
        return _enum(schema["enum"])
    if "oneOf" in schema:
        return "|".join(_describe(item, definitions) for item in schema["oneOf"])
    schema_type = schema.get("type")
    if schema_type == "object":
        return _object_shape(schema, definitions)
    if schema_type == "array":
        items = schema.get("items")
        if isinstance(items, list):
            return "[" + ",".join(_describe(item, definitions) for item in items) + "]"
        item = _describe(items, definitions) if isinstance(items, dict) else "value"
        minimum = schema.get("minItems")
        maximum = schema.get("maxItems")
        bounds = f"[{minimum}..{maximum}]" if minimum is not None or maximum is not None else ""
        return f"array<{item}>{bounds}"
    if schema_type == "string":
        minimum = schema.get("minLength")
        maximum = schema.get("maxLength")
        if minimum is not None or maximum is not None:
            return f"string[{minimum or 0}..{maximum or '∞'}]"
        return "string"
    if schema_type in {"number", "integer"}:
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if minimum is not None or maximum is not None:
            lower = minimum if minimum is not None else "-∞"
            upper = maximum if maximum is not None else "∞"
            return f"{schema_type}[{lower}..{upper}]"
        return schema_type
    if schema_type == "null":
        return "null"
    return str(schema_type or "value")


def _resolve(schema: dict[str, Any], definitions: dict[str, Any]) -> dict[str, Any]:
    reference = schema.get("$ref")
    if not isinstance(reference, str):
        return schema
    prefix = "#/$defs/"
    if not reference.startswith(prefix):
        raise ValueError(f"unsupported prompt-contract reference: {reference}")
    return definitions[reference.removeprefix(prefix)]


def _enum(values: list[Any]) -> str:
    return "|".join(json.dumps(value, ensure_ascii=False) for value in values)
