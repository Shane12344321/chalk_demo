"""Bounded model-generated overlays for board-grounded QA."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
from pathlib import Path
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.annotation_validation import AnnotationValidationError, validate_annotation
from app.annotation_whitespace import annotation_open_sides
from app.config import Settings, get_settings
from app.dependencies import get_openai_http_client
from app.lessons import OPENAI_RESPONSES_URL, _extract_output_text, _http_upstream_reason
from app.sessions import CanonicalUuid4, _safety_identifier

logger = logging.getLogger(__name__)
router = APIRouter(tags=["annotations"])
PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
MAX_ANNOTATION_OUTPUT_BYTES = 32 * 1024
MAX_ANNOTATION_OUTPUT_TOKENS = 1_200
MAX_ANNOTATION_REPAIRS = 2

ElementId = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,15}$")]
ElementKind = Literal[
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
]
AnnotationFailureCode = Literal[
    "not_configured",
    "cancelled",
    "generation_timeout",
    "upstream_rejected",
    "upstream_unavailable",
    "upstream_invalid_response",
    "invalid_annotation",
]


class VisibleElement(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: ElementId
    kind: ElementKind
    bounds: list[float] = Field(min_length=4, max_length=4, repr=False)

    @field_validator("bounds")
    @classmethod
    def valid_normalized_bounds(cls, value: list[float]) -> list[float]:
        if not all(math.isfinite(component) and 0 <= component <= 1 for component in value):
            raise ValueError("visible element bounds must be finite normalized values")
        x, y, width, height = value
        if width <= 0 or height <= 0:
            raise ValueError("visible element bounds must have positive dimensions")
        if x + width > 1.001 or y + height > 1.001:
            raise ValueError("visible element bounds must remain on the board")
        return value


class AnnotationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)

    request_id: CanonicalUuid4
    client_id: CanonicalUuid4 = Field(repr=False)
    question: str = Field(min_length=2, max_length=400, repr=False)
    manifest_version: int = Field(ge=1, le=2_147_483_647)
    board_manifest: str = Field(min_length=1, max_length=1_000, repr=False)
    visible_elements: list[VisibleElement] = Field(min_length=1, max_length=30, repr=False)

    @field_validator("visible_elements")
    @classmethod
    def unique_visible_ids(cls, value: list[VisibleElement]) -> list[VisibleElement]:
        ids = [element.id for element in value]
        if len(ids) != len(set(ids)):
            raise ValueError("visible element IDs must be unique")
        return value


class _AnnotationFailure(Exception):
    def __init__(
        self,
        code: AnnotationFailureCode,
        *,
        upstream_reason: str | None = None,
        origin: Literal["generation", "repair"] = "generation",
    ) -> None:
        self.code = code
        self.upstream_reason = upstream_reason
        self.origin = origin
        super().__init__(code)


@router.post("/annotate")
async def create_annotation(
    payload: AnnotationRequest,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[httpx.AsyncClient, Depends(get_openai_http_client)],
) -> JSONResponse:
    """Return only a validated overlay batch tied to one visible manifest version."""

    if not settings.has_openai_api_key:
        _raise_safe_failure("not_configured", payload.request_id, repair_attempts=0)

    repair_attempts = 0
    origin: Literal["generation", "repair"] = "generation"
    visible_elements = [element.model_dump() for element in payload.visible_elements]
    visible_element_ids = {element.id for element in payload.visible_elements}
    open_sides = (
        annotation_open_sides(visible_elements)
        if settings.annotation_whitespace == "bounded"
        else None
    )
    whitespace_context = {"annotation_open_sides": open_sides} if open_sides is not None else {}
    semaphore: asyncio.Semaphore = request.app.state.annotation_generation_semaphore
    try:
        async with asyncio.timeout(settings.annotation_generation_timeout_seconds):
            async with semaphore:
                if await request.is_disconnected():
                    raise _AnnotationFailure("cancelled")
                candidate_text = await _request_annotation_output(
                    payload,
                    settings,
                    client,
                    prompt_name="annotation.md",
                    input_value={
                        "request_id": payload.request_id,
                        "manifest_version": payload.manifest_version,
                        "question": payload.question,
                        "visible_board": payload.board_manifest,
                        "visible_elements": visible_elements,
                        **whitespace_context,
                    },
                    origin="generation",
                )
                while True:
                    try:
                        candidate = json.loads(candidate_text)
                        accepted = validate_annotation(
                            candidate,
                            request_id=payload.request_id,
                            manifest_version=payload.manifest_version,
                            visible_element_ids=visible_element_ids,
                            allowed_sides=(
                                {target_id: set(sides) for target_id, sides in open_sides.items()}
                                if open_sides is not None
                                else None
                            ),
                        )
                        return JSONResponse(
                            content=accepted,
                            headers={
                                "Cache-Control": "no-store",
                                "X-Content-Type-Options": "nosniff",
                                "X-Chalk-Annotation-Repairs": str(repair_attempts),
                                "X-Chalk-Board-Model": settings.board_model,
                                "X-Chalk-Annotation-Prompt-SHA256": _prompt_sha256("annotation.md"),
                                "X-Chalk-Annotation-Whitespace": settings.annotation_whitespace,
                            },
                        )
                    except json.JSONDecodeError:
                        issues = ["response is not one complete JSON object"]
                    except AnnotationValidationError as error:
                        issues = error.issues
                    if repair_attempts >= MAX_ANNOTATION_REPAIRS:
                        raise _AnnotationFailure("invalid_annotation", origin=origin)
                    repair_attempts += 1
                    origin = "repair"
                    if await request.is_disconnected():
                        raise _AnnotationFailure("cancelled", origin="repair")
                    candidate_text = await _request_annotation_output(
                        payload,
                        settings,
                        client,
                        prompt_name="annotation_repair.md",
                        input_value={
                            "invalid_annotation": candidate_text,
                            "validation_errors": issues[:12],
                            "request_id": payload.request_id,
                            "manifest_version": payload.manifest_version,
                            "visible_elements": visible_elements,
                            **whitespace_context,
                        },
                        origin="repair",
                    )
    except TimeoutError:
        _raise_safe_failure(
            "generation_timeout",
            payload.request_id,
            origin=origin,
            repair_attempts=repair_attempts,
        )
    except _AnnotationFailure as error:
        _raise_safe_failure(
            error.code,
            payload.request_id,
            upstream_reason=error.upstream_reason,
            origin=error.origin,
            repair_attempts=repair_attempts,
        )
    raise AssertionError("annotation failure did not terminate the request")


async def _request_annotation_output(
    payload: AnnotationRequest,
    settings: Settings,
    client: httpx.AsyncClient,
    *,
    prompt_name: str,
    input_value: dict[str, Any],
    origin: Literal["generation", "repair"],
) -> str:
    api_key = settings.openai_api_key
    assert api_key is not None
    headers = {
        "Authorization": f"Bearer {api_key.get_secret_value()}",
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": _safety_identifier(settings, payload.client_id),
    }
    body = {
        "model": settings.board_model,
        "instructions": (PROMPT_DIR / prompt_name).read_text(encoding="utf-8"),
        "input": [
            {
                "role": "user",
                "content": json.dumps(
                    input_value,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            }
        ],
        "reasoning": {"effort": settings.board_reasoning_effort},
        "max_output_tokens": MAX_ANNOTATION_OUTPUT_TOKENS + settings.board_output_token_headroom,
        "store": False,
    }
    try:
        response = await client.post(
            OPENAI_RESPONSES_URL,
            headers=headers,
            json=body,
            timeout=httpx.Timeout(settings.annotation_generation_timeout_seconds),
        )
    except (httpx.TimeoutException, httpx.RequestError):
        raise _AnnotationFailure("upstream_unavailable", origin=origin) from None
    if response.is_error:
        raise _AnnotationFailure(
            "upstream_rejected",
            upstream_reason=_http_upstream_reason(response.status_code),
            origin=origin,
        )
    if len(response.content) > MAX_ANNOTATION_OUTPUT_BYTES:
        raise _AnnotationFailure("upstream_invalid_response", origin=origin)
    try:
        return _extract_output_text(response.json())
    except (ValueError, TypeError, json.JSONDecodeError):
        raise _AnnotationFailure("upstream_invalid_response", origin=origin) from None


def _raise_safe_failure(
    code: AnnotationFailureCode,
    request_id: str,
    *,
    upstream_reason: str | None = None,
    origin: Literal["generation", "repair"] = "generation",
    repair_attempts: int,
) -> None:
    logger.warning(
        "annotation_failed code=%s origin=%s repairs=%s request_id=%s",
        code,
        origin,
        repair_attempts,
        request_id,
    )
    status_code = {
        "not_configured": 503,
        "cancelled": 499,
        "generation_timeout": 504,
        "upstream_rejected": 502,
        "upstream_unavailable": 503,
        "upstream_invalid_response": 502,
        "invalid_annotation": 502,
    }[code]
    raise HTTPException(
        status_code=status_code,
        detail={
            "code": code,
            "request_id": request_id,
            "failure_origin": origin,
            "repair_attempts": repair_attempts,
            **({"upstream_reason": upstream_reason} if upstream_reason is not None else {}),
        },
    )


def _prompt_sha256(name: str) -> str:
    return hashlib.sha256((PROMPT_DIR / name).read_bytes()).hexdigest()
