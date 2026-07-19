"""Bounded one-step scratch-card generation for QA side drawings.

A scratch card is a disposable mini board rendered in a floating window. Its
content is one lesson-schema step validated against a fresh empty state, so it
can never reference, move, or erase committed lesson ink. The endpoint mirrors
the annotation service's bounded call/repair/failure contract.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from pathlib import Path
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings, get_settings
from app.dependencies import get_openai_http_client
from app.lesson_validation import (
    LessonValidationState,
    StepValidationError,
    validate_step_with_sanitization,
)
from app.lessons import OPENAI_RESPONSES_URL, _extract_output_text, _http_upstream_reason
from app.prompt_contract import expand_prompt_contract
from app.sessions import CanonicalUuid4, _safety_identifier

logger = logging.getLogger(__name__)
router = APIRouter(tags=["scratch"])
PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
MAX_SCRATCH_OUTPUT_BYTES = 32 * 1024
MAX_SCRATCH_OUTPUT_TOKENS = 1_200
MAX_SCRATCH_REPAIRS = 2
MAX_SCRATCH_OPS = 4

ScratchFailureCode = Literal[
    "not_configured",
    "cancelled",
    "generation_timeout",
    "upstream_rejected",
    "upstream_unavailable",
    "upstream_invalid_response",
    "invalid_scratch",
]


class ScratchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: CanonicalUuid4
    client_id: CanonicalUuid4
    description: str = Field(min_length=3, max_length=200)


class _ScratchFailure(Exception):
    def __init__(
        self,
        code: ScratchFailureCode,
        *,
        upstream_reason: str | None = None,
        origin: Literal["generation", "repair"] = "generation",
    ) -> None:
        super().__init__(code)
        self.code = code
        self.upstream_reason = upstream_reason
        self.origin = origin


@router.post("/scratch")
async def create_scratch(
    payload: ScratchRequest,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[httpx.AsyncClient, Depends(get_openai_http_client)],
) -> JSONResponse:
    """Return one validated scratch step for a fresh disposable side card."""

    if not settings.has_openai_api_key:
        _raise_safe_failure("not_configured", payload.request_id, repair_attempts=0)

    repair_attempts = 0
    origin: Literal["generation", "repair"] = "generation"
    semaphore: asyncio.Semaphore = request.app.state.annotation_generation_semaphore
    try:
        async with asyncio.timeout(settings.annotation_generation_timeout_seconds):
            async with semaphore:
                if await request.is_disconnected():
                    raise _ScratchFailure("cancelled")
                candidate_text = await _request_model_output(
                    payload,
                    settings,
                    client,
                    prompt_name="scratch.md",
                    input_value={
                        "request_id": payload.request_id,
                        "description": payload.description,
                    },
                    origin="generation",
                )
                while True:
                    issues: list[str]
                    try:
                        candidate = json.loads(candidate_text)
                        validated = validate_step_with_sanitization(
                            candidate, LessonValidationState()
                        )
                        step = validated.step
                        _enforce_scratch_bounds(step)
                        return JSONResponse(
                            content={
                                "request_id": payload.request_id,
                                "step": step,
                                "sanitized_fields": validated.sanitization.correction_count,
                            },
                            headers={
                                "Cache-Control": "no-store",
                                "X-Content-Type-Options": "nosniff",
                                "X-Chalk-Scratch-Repairs": str(repair_attempts),
                                "X-Chalk-Board-Model": settings.board_model,
                                "X-Chalk-Scratch-Prompt-SHA256": _prompt_sha256("scratch.md"),
                            },
                        )
                    except json.JSONDecodeError:
                        issues = ["response is not one complete JSON object"]
                    except StepValidationError as error:
                        issues = error.issues
                    if repair_attempts >= MAX_SCRATCH_REPAIRS:
                        raise _ScratchFailure("invalid_scratch", origin=origin)
                    repair_attempts += 1
                    origin = "repair"
                    if await request.is_disconnected():
                        raise _ScratchFailure("cancelled", origin="repair")
                    candidate_text = await _request_model_output(
                        payload,
                        settings,
                        client,
                        prompt_name="repair.md",
                        input_value={
                            "invalid_step": candidate_text,
                            "validation_errors": issues[:12],
                            "accepted_element_ids": [],
                            "topic": payload.description,
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
    except _ScratchFailure as error:
        _raise_safe_failure(
            error.code,
            payload.request_id,
            upstream_reason=error.upstream_reason,
            origin=error.origin,
            repair_attempts=repair_attempts,
        )
    raise AssertionError("scratch failure did not terminate the request")


def _enforce_scratch_bounds(step: dict[str, Any]) -> None:
    """Reject validated steps that are still outside the scratch-card contract."""

    issues: list[str] = []
    ops = step.get("ops", [])
    if not 1 <= len(ops) <= MAX_SCRATCH_OPS:
        issues.append(f"scratch step must contain 1..{MAX_SCRATCH_OPS} ops")
    for op in ops:
        if op.get("op") in {"erase", "clear"}:
            issues.append("scratch step cannot erase or clear")
    if step.get("checkpoint") is not None:
        issues.append("scratch step cannot carry a checkpoint")
    if issues:
        raise StepValidationError(issues)


async def _request_model_output(
    payload: ScratchRequest,
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
        "instructions": _prompt(prompt_name),
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
        "max_output_tokens": MAX_SCRATCH_OUTPUT_TOKENS,
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
        raise _ScratchFailure("upstream_unavailable", origin=origin) from None
    if response.is_error:
        raise _ScratchFailure(
            "upstream_rejected",
            upstream_reason=_http_upstream_reason(response.status_code),
            origin=origin,
        )
    if len(response.content) > MAX_SCRATCH_OUTPUT_BYTES:
        raise _ScratchFailure("upstream_invalid_response", origin=origin)
    try:
        return _extract_output_text(response.json())
    except (ValueError, TypeError, json.JSONDecodeError):
        raise _ScratchFailure("upstream_invalid_response", origin=origin) from None


def _raise_safe_failure(
    code: ScratchFailureCode,
    request_id: str,
    *,
    upstream_reason: str | None = None,
    origin: Literal["generation", "repair"] = "generation",
    repair_attempts: int,
) -> None:
    logger.warning(
        "scratch_failed code=%s origin=%s repairs=%s request_id=%s",
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
        "invalid_scratch": 502,
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


def _prompt(name: str) -> str:
    template = (PROMPT_DIR / name).read_text(encoding="utf-8")
    return expand_prompt_contract(template)


def _prompt_sha256(name: str) -> str:
    return hashlib.sha256(_prompt(name).encode("utf-8")).hexdigest()
