"""Validated live lesson streaming over CHALK-owned NDJSON envelopes."""

from __future__ import annotations

import asyncio
import codecs
import hashlib
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings, get_settings
from app.continuation_contract import (
    ContinuationContractError,
    ContinuationReceiptError,
    canonical_sha256,
    derive_receipt_key,
    issue_continuation_receipt,
    validate_continuation_request,
    validate_continuation_response,
    verify_continuation_receipt,
)
from app.dependencies import get_openai_http_client
from app.lesson_sanitizer import SanitizationResult
from app.lesson_validation import (
    LessonValidationState,
    StepValidationError,
    validate_envelope,
    validate_step_with_sanitization,
)
from app.prompt_contract import (
    LESSON_WIRE_CONTRACT_MARKER,
    ContractVersion,
    expand_prompt_contract,
)
from app.renderer_identity import drawing_contract_identity
from app.resolved_scene import validate_lesson_plan, validate_resolved_scene
from app.sessions import CanonicalUuid4, _safety_identifier

logger = logging.getLogger(__name__)
router = APIRouter(tags=["lessons"])

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
MAX_MODEL_LINE_BYTES = 16 * 1024
MAX_MODEL_OUTPUT_BYTES = 128 * 1024
MAX_UPSTREAM_STREAM_BYTES = 2 * 1024 * 1024
MAX_REPAIR_OUTPUT_BYTES = 32 * 1024
MAX_REPAIR_ATTEMPTS = 2
MAX_REPAIR_CALLS_PER_LESSON = 4
MAX_OUTPUT_TOKENS = 3_200
PROMPT_DIR = Path(__file__).resolve().parent / "prompts"

type LessonErrorCode = Literal[
    "not_configured",
    "upstream_rejected",
    "upstream_failed",
    "upstream_incomplete",
    "upstream_error",
    "upstream_unavailable",
    "generation_timeout",
    "invalid_stream",
    "no_valid_steps",
]
type UpstreamReason = Literal[
    "max_output_tokens",
    "content_filter",
    "rate_limit",
    "authentication",
    "permission",
    "server_error",
    "invalid_request",
    "unknown",
]
type FailureOrigin = Literal["generation", "repair"]
type ContinuationTerminalReason = Literal[
    "prefix_mismatch",
    "invalid_prefix",
    "invalid_scene",
    "invalid_receipt",
    "receipt_replayed",
    "plan_complete",
    "not_configured",
    "continuation_unavailable",
    "continuation_invalid",
    "recovery_abandoned",
]

_UPSTREAM_REASON_CODES: dict[str, UpstreamReason] = {
    "max_output_tokens": "max_output_tokens",
    "max_tokens": "max_output_tokens",
    "content_filter": "content_filter",
    "rate_limit": "rate_limit",
    "rate_limit_exceeded": "rate_limit",
    "authentication": "authentication",
    "authentication_error": "authentication",
    "invalid_api_key": "authentication",
    "invalid_authentication": "authentication",
    "permission": "permission",
    "permission_denied": "permission",
    "insufficient_permissions": "permission",
    "model_not_found": "permission",
    "server_error": "server_error",
    "invalid_request": "invalid_request",
    "invalid_request_error": "invalid_request",
    "invalid_prompt": "invalid_request",
}


class LessonRequest(BaseModel):
    """Bounded student request; raw content is never written to logs."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)

    request_id: CanonicalUuid4
    client_id: CanonicalUuid4 = Field(repr=False)
    topic: str = Field(min_length=2, max_length=80, repr=False)
    student_context: str = Field(default="", max_length=500, repr=False)
    board_state: str = Field(default="", max_length=1_000, repr=False)
    generation_mode: Literal["one_shot", "resolved_stepwise"] = "one_shot"


class _GenerationFailure(Exception):
    def __init__(
        self,
        code: LessonErrorCode,
        upstream_reason: UpstreamReason | None = None,
        *,
        origin: FailureOrigin = "generation",
    ) -> None:
        self.code = code
        self.upstream_reason = upstream_reason
        self.origin = origin
        super().__init__(code)


@dataclass
class _RepairBudget:
    limit: int = MAX_REPAIR_CALLS_PER_LESSON
    attempts: int = 0
    in_flight: bool = False

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.attempts)

    def record_attempt(self) -> None:
        if self.remaining == 0:
            raise RuntimeError("repair budget exhausted")
        self.attempts += 1
        self.in_flight = True

    def finish_attempt(self) -> None:
        self.in_flight = False


@router.post("/lesson", response_class=StreamingResponse)
async def create_lesson(
    payload: LessonRequest,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[httpx.AsyncClient, Depends(get_openai_http_client)],
) -> StreamingResponse:
    """Stream only accepted lesson steps; upstream SSE never reaches the browser."""

    continuation_metadata = _continuation_metadata(settings)
    return StreamingResponse(
        _lesson_envelopes(payload, request, settings, client),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Chalk-Board-Model": settings.board_model,
            "X-Chalk-Board-Reasoning-Effort": settings.board_reasoning_effort,
            "X-Chalk-Board-Prompt-SHA256": _prompt_sha256(
                settings.board_prompt_name, settings.board_contract_version
            ),
            "X-Chalk-Repair-Prompt-SHA256": _prompt_sha256(
                "repair.md", settings.board_contract_version
            ),
            "X-Chalk-Continuation-Prompt-SHA256": continuation_metadata[
                "continuation_prompt_sha256"
            ],
            "X-Chalk-Configuration-SHA256": continuation_metadata["configuration_sha256"],
        },
    )


@router.post("/lesson/continue", response_class=JSONResponse)
async def continue_lesson(
    payload: dict[str, Any],
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[httpx.AsyncClient, Depends(get_openai_http_client)],
) -> JSONResponse:
    """Generate one validated future step from a replayed prefix and renderer truth."""

    try:
        continuation = validate_continuation_request(payload)
    except ContinuationContractError:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_continuation_contract"},
        ) from None

    metadata = _continuation_metadata(settings)
    if continuation["prefix_version"] != len(continuation["accepted_prefix"]):
        return _continuation_terminal(continuation, "prefix_mismatch", metadata=metadata)
    try:
        plan = validate_lesson_plan(continuation["plan"])
        state = LessonValidationState()
        accepted_prefix: list[dict[str, Any]] = []
        for step in continuation["accepted_prefix"]:
            accepted_prefix.append(validate_step_with_sanitization(step, state).step)
        receipt_state = LessonValidationState()
        receipt_prefix: list[dict[str, Any]] = []
        for step in continuation["receipt_prefix"]:
            receipt_prefix.append(validate_step_with_sanitization(step, receipt_state).step)
    except (ValueError, StepValidationError):
        return _continuation_terminal(continuation, "invalid_prefix", metadata=metadata)
    try:
        scene = validate_resolved_scene(
            continuation["resolved_scene"],
            request_id=continuation["request_id"],
            prefix_version=continuation["prefix_version"],
        )
        _reconcile_scene_with_prefix(scene, state)
    except ValueError:
        return _continuation_terminal(continuation, "invalid_scene", metadata=metadata)
    try:
        _validate_browser_prefix_projection(receipt_prefix, accepted_prefix, scene)
    except ValueError:
        return _continuation_terminal(continuation, "invalid_receipt", metadata=metadata)

    if not settings.has_openai_api_key:
        return _continuation_terminal(continuation, "not_configured", metadata=metadata)

    assert settings.openai_api_key is not None
    signing_key = derive_receipt_key(settings.openai_api_key.get_secret_value())
    try:
        verify_continuation_receipt(
            continuation["continuation_receipt"],
            signing_key=signing_key,
            request_id=continuation["request_id"],
            client_id=continuation["client_id"],
            prefix=receipt_prefix,
            plan=plan,
            topic=continuation["topic"],
            student_context=continuation["student_context"],
            repairs_used=continuation["repairs_used"],
            configuration_sha256=metadata["configuration_sha256"],
        )
    except ContinuationReceiptError:
        return _continuation_terminal(continuation, "invalid_receipt", metadata=metadata)

    replay_guard = request.app.state.continuation_replay_guard
    if not await replay_guard.consume(continuation["continuation_receipt"]):
        return _continuation_terminal(continuation, "receipt_replayed", metadata=metadata)

    recovery_pending = any(
        finding["status"] == "pending" for finding in scene.get("recovery_findings", [])
    )
    if (
        len(accepted_prefix) >= len(plan["progression"]) and not recovery_pending
    ) or state.accepted_steps >= 8:
        return _continuation_terminal(continuation, "plan_complete", metadata=metadata)

    repair_budget = _RepairBudget(attempts=continuation["repairs_used"])
    lesson_payload = LessonRequest(
        request_id=continuation["request_id"],
        client_id=continuation["client_id"],
        topic=continuation["topic"],
        student_context=continuation["student_context"],
        board_state="",
    )
    try:
        async with asyncio.timeout(settings.lesson_generation_timeout_seconds):
            async with request.app.state.lesson_generation_semaphore:
                candidate = await _request_continuation_step(
                    lesson_payload,
                    plan,
                    accepted_prefix,
                    scene,
                    settings,
                    client,
                )
                accepted, _, sanitization = await _accept_or_repair(
                    candidate,
                    state,
                    lesson_payload,
                    settings,
                    client,
                    repair_budget=repair_budget,
                )
    except asyncio.CancelledError:
        raise
    except (TimeoutError, _GenerationFailure):
        return _continuation_terminal(
            continuation,
            "recovery_abandoned" if recovery_pending else "continuation_unavailable",
            repairs=repair_budget.attempts,
            metadata=metadata,
        )
    if accepted is None:
        return _continuation_terminal(
            continuation,
            "recovery_abandoned" if recovery_pending else "continuation_invalid",
            repairs=repair_budget.attempts,
            metadata=metadata,
        )
    unavailable_ids = _unavailable_recovery_ids(scene)
    if _contains_unavailable_structured_value(accepted, unavailable_ids):
        return _continuation_terminal(
            continuation,
            "recovery_abandoned" if recovery_pending else "continuation_invalid",
            repairs=repair_budget.attempts,
            metadata=metadata,
        )
    next_prefix = [*accepted_prefix, accepted]
    next_receipt = issue_continuation_receipt(
        signing_key=signing_key,
        request_id=continuation["request_id"],
        client_id=continuation["client_id"],
        prefix=next_prefix,
        plan=plan,
        topic=continuation["topic"],
        student_context=continuation["student_context"],
        repairs_used=repair_budget.attempts,
        configuration_sha256=metadata["configuration_sha256"],
    )
    return _continuation_response(
        {
            "request_id": continuation["request_id"],
            "prefix_version": continuation["prefix_version"],
            "done": False,
            "step": accepted,
            "repairs": repair_budget.attempts,
            "sanitized_fields": sanitization.correction_count if sanitization else 0,
            "continuation_receipt": next_receipt,
            **metadata,
        }
    )


def _continuation_terminal(
    payload: dict[str, Any],
    reason: ContinuationTerminalReason,
    *,
    repairs: int | None = None,
    metadata: dict[str, str],
) -> JSONResponse:
    return _continuation_response(
        {
            "request_id": payload["request_id"],
            "prefix_version": payload["prefix_version"],
            "done": True,
            "reason": reason,
            "repairs": payload["repairs_used"] if repairs is None else repairs,
            **metadata,
        },
    )


def _continuation_response(value: dict[str, Any]) -> JSONResponse:
    validated = validate_continuation_response(value)
    return JSONResponse(
        validated,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


def _continuation_metadata(settings: Settings) -> dict[str, str]:
    metadata = {
        "board_model": settings.board_model,
        "board_reasoning_effort": settings.board_reasoning_effort,
        "board_prompt_sha256": _prompt_sha256(
            settings.board_prompt_name, settings.board_contract_version
        ),
        "repair_prompt_sha256": _prompt_sha256("repair.md", settings.board_contract_version),
        "continuation_prompt_sha256": _prompt_sha256(
            "continue.md", settings.board_contract_version
        ),
    }
    configuration_identity = {
        **metadata,
        **drawing_contract_identity(),
    }
    return {
        **metadata,
        "configuration_sha256": canonical_sha256(configuration_identity),
    }


def _validate_browser_prefix_projection(
    receipt_prefix: list[dict[str, Any]],
    accepted_prefix: list[dict[str, Any]],
    scene: dict[str, Any],
) -> None:
    """Allow only browser-documented filtering of authenticated server output.

    The browser may remove an op or complete step that its stricter runtime could
    not accept. It may never rewrite a script, operation, checkpoint, relation, or
    reorder history. Closed recovery findings identify every removed operation.
    """

    findings = scene.get("recovery_findings", [])
    receipt_step_ids = {step["id"] for step in receipt_prefix}
    coverage: dict[str, set[int]] = {}
    layout_failure_steps: set[str] = set()
    for finding in findings:
        source_step_id = finding.get("source_step_id")
        if source_step_id is None:
            continue
        if source_step_id not in receipt_step_ids:
            raise ValueError("recovery finding source is outside authenticated prefix")
        coverage.setdefault(source_step_id, set()).update(finding["affected_op_indexes"])
        if finding["code"] in {
            "browser_invalid_step",
            "browser_invalid_op",
            "browser_unknown_reference",
        }:
            layout_failure_steps.add(source_step_id)

    accepted_index = 0
    for receipt_step in receipt_prefix:
        accepted_step = (
            accepted_prefix[accepted_index] if accepted_index < len(accepted_prefix) else None
        )
        if accepted_step is None or accepted_step["id"] != receipt_step["id"]:
            required = set(range(len(receipt_step["ops"])))
            if not required.issubset(coverage.get(receipt_step["id"], set())):
                raise ValueError("browser removed an unauthenticated lesson step")
            continue
        _validate_projected_step(
            receipt_step,
            accepted_step,
            coverage.get(receipt_step["id"], set()),
            receipt_step["id"] in layout_failure_steps,
        )
        accepted_index += 1
    if accepted_index != len(accepted_prefix):
        raise ValueError("browser inserted or reordered an accepted lesson step")


def _validate_projected_step(
    receipt_step: dict[str, Any],
    accepted_step: dict[str, Any],
    covered_op_indexes: set[int],
    layout_failure_documented: bool,
) -> None:
    for field in ("id", "script", "checkpoint"):
        if accepted_step.get(field) != receipt_step.get(field):
            raise ValueError("browser mutated authenticated lesson history")

    accepted_ops = accepted_step["ops"]
    accepted_op_index = 0
    omitted: set[int] = set()
    for receipt_op_index, receipt_op in enumerate(receipt_step["ops"]):
        if accepted_op_index < len(accepted_ops) and accepted_ops[accepted_op_index] == receipt_op:
            accepted_op_index += 1
        else:
            omitted.add(receipt_op_index)
    if accepted_op_index != len(accepted_ops):
        raise ValueError("browser inserted, mutated, or reordered an operation")
    if not omitted.issubset(covered_op_indexes):
        raise ValueError("browser removed an operation without closed recovery evidence")

    receipt_layout = receipt_step.get("layout", [])
    accepted_layout = accepted_step.get("layout", [])
    if receipt_layout == accepted_layout:
        return
    if not layout_failure_documented or not _is_ordered_subset(accepted_layout, receipt_layout):
        raise ValueError("browser mutated layout relations without closed recovery evidence")


def _is_ordered_subset(subset: list[Any], full: list[Any]) -> bool:
    cursor = 0
    for value in full:
        if cursor < len(subset) and subset[cursor] == value:
            cursor += 1
    return cursor == len(subset)


def _unavailable_recovery_ids(scene: dict[str, Any]) -> set[str]:
    return {
        element_id
        for finding in scene.get("recovery_findings", [])
        for element_id in finding["affected_element_ids"]
    }


_RECOVERY_CONTENT_KEYS = {
    "script",
    "content",
    "latex",
    "label",
    "meaning",
    "question",
    "expected_gist",
}


def _contains_unavailable_structured_value(
    value: Any,
    unavailable_ids: set[str],
    key: str | None = None,
) -> bool:
    if isinstance(value, str):
        return key not in _RECOVERY_CONTENT_KEYS and value in unavailable_ids
    if isinstance(value, list):
        return any(
            _contains_unavailable_structured_value(item, unavailable_ids, key) for item in value
        )
    if isinstance(value, dict):
        return any(
            _contains_unavailable_structured_value(child, unavailable_ids, child_key)
            for child_key, child in value.items()
        )
    return False


def _reconcile_scene_with_prefix(
    scene: dict[str, Any],
    state: LessonValidationState,
) -> None:
    """Reject missing roots and non-renderer IDs before they reach the model.

    Composite diagram primitives currently use renderer-owned virtual IDs that
    cannot be mapped back to an individual root by scene schema 1.0. They remain
    bounded here only when a composite diagram root exists; a later scene schema
    version must carry the explicit root identity.
    """

    accepted_ids = set(state.accepted_ids)
    scene_ids = {element["id"] for element in scene["elements"]}
    composite_roots = {
        element_id
        for element_id, element_type in state.accepted_ids.items()
        if element_type == "diagram"
    }
    unavailable_ids = _unavailable_recovery_ids(scene)
    required_roots = accepted_ids - composite_roots - unavailable_ids
    if not required_roots.issubset(scene_ids):
        raise ValueError("resolved scene omits an accepted non-composite element")
    for element in scene["elements"]:
        element_id = element["id"]
        if element_id in accepted_ids:
            continue
        if (
            composite_roots
            and element["kind"] == "diagram"
            and re.fullmatch(r"p[0-9a-z]{1,7}_[0-9]{1,2}", element_id)
        ):
            continue
        raise ValueError("resolved scene contains an element outside the accepted prefix")


async def _request_continuation_step(
    payload: LessonRequest,
    plan: dict[str, Any],
    accepted_prefix: list[dict[str, Any]],
    scene: dict[str, Any],
    settings: Settings,
    client: httpx.AsyncClient,
) -> str:
    api_key = settings.openai_api_key
    assert api_key is not None
    try:
        response = await client.post(
            OPENAI_RESPONSES_URL,
            headers={
                "Authorization": f"Bearer {api_key.get_secret_value()}",
                "Content-Type": "application/json",
                "OpenAI-Safety-Identifier": _safety_identifier(settings, payload.client_id),
            },
            json={
                "model": settings.board_model,
                "instructions": _prompt("continue.md", settings.board_contract_version),
                "input": [
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "topic": payload.topic,
                                "student_context": payload.student_context,
                                "plan": plan,
                                "accepted_prefix": accepted_prefix,
                                "resolved_board": scene,
                                "next_progression_index": min(
                                    len(accepted_prefix), len(plan["progression"]) - 1
                                ),
                                "recovery_required": any(
                                    finding["status"] == "pending"
                                    for finding in scene.get("recovery_findings", [])
                                ),
                            },
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ),
                    }
                ],
                "reasoning": {"effort": settings.board_reasoning_effort},
                "max_output_tokens": 1_600 + settings.board_output_token_headroom,
                "store": False,
            },
            timeout=httpx.Timeout(settings.lesson_generation_timeout_seconds),
        )
    except (httpx.TimeoutException, httpx.RequestError):
        raise _GenerationFailure("upstream_unavailable") from None
    if response.is_error:
        raise _GenerationFailure("upstream_rejected", _http_upstream_reason(response.status_code))
    if len(response.content) > MAX_REPAIR_OUTPUT_BYTES:
        raise _GenerationFailure("invalid_stream")
    try:
        return _extract_output_text(response.json())
    except (ValueError, TypeError, json.JSONDecodeError):
        raise _GenerationFailure("invalid_stream") from None


async def _lesson_envelopes(
    payload: LessonRequest,
    request: Request,
    settings: Settings,
    client: httpx.AsyncClient,
) -> AsyncIterator[bytes]:
    request_id = payload.request_id
    started_at = time.monotonic()
    first_valid_step_recorded = False
    logger.info(
        "lesson_generation_started request_id=%s model=%s reasoning_effort=%s",
        request_id,
        settings.board_model,
        settings.board_reasoning_effort,
    )
    yield _encode_envelope(
        {"type": "lesson.started", "request_id": request_id, "title": payload.topic}
    )

    if not settings.has_openai_api_key:
        logger.warning("lesson_generation_failed reason=not_configured request_id=%s", request_id)
        yield _error_envelope(request_id, "not_configured", repair_attempts=0)
        return

    semaphore: asyncio.Semaphore = request.app.state.lesson_generation_semaphore
    state = LessonValidationState()
    repair_budget = _RepairBudget()
    dropped_steps = 0
    sanitized_steps = 0
    sanitized_fields = 0
    processed_steps = 0
    plan: dict[str, Any] | None = None
    accepted_prefix: list[dict[str, Any]] = []

    try:
        async with asyncio.timeout(settings.lesson_generation_timeout_seconds):
            async with semaphore:
                async for raw_line in _stream_model_lines(payload, settings, client):
                    if await request.is_disconnected():
                        logger.info("lesson_generation_cancelled request_id=%s", request_id)
                        return
                    if payload.generation_mode == "resolved_stepwise" and plan is None:
                        try:
                            plan = validate_lesson_plan(json.loads(raw_line))
                        except (json.JSONDecodeError, ValueError):
                            yield _error_envelope(request_id, "invalid_stream", repair_attempts=0)
                            return
                        yield _encode_envelope(
                            {
                                "type": "lesson.plan",
                                "request_id": request_id,
                                "plan": plan,
                            }
                        )
                        continue
                    if state.accepted_steps >= 8 or processed_steps >= 8:
                        break
                    processed_steps += 1

                    accepted, repair_attempts, sanitization = await _accept_or_repair(
                        raw_line,
                        state,
                        payload,
                        settings,
                        client,
                        repair_budget=repair_budget,
                    )
                    if accepted is None:
                        dropped_steps += 1
                        yield _encode_envelope(
                            {
                                "type": "lesson.warning",
                                "request_id": request_id,
                                "code": "step_dropped",
                                **_step_hint(raw_line),
                            }
                        )
                        continue
                    if repair_attempts:
                        yield _encode_envelope(
                            {
                                "type": "lesson.warning",
                                "request_id": request_id,
                                "code": "step_repaired",
                                "step_hint": accepted["id"],
                            }
                        )
                    if sanitization is not None and sanitization.correction_count:
                        sanitized_steps += 1
                        sanitized_fields += sanitization.correction_count
                        yield _encode_envelope(
                            {
                                "type": "lesson.warning",
                                "request_id": request_id,
                                "code": "step_sanitized",
                                "step_hint": accepted["id"],
                                "corrections": list(sanitization.corrections),
                                "correction_count": sanitization.correction_count,
                            }
                        )
                    if not first_valid_step_recorded:
                        first_valid_step_recorded = True
                        logger.info(
                            "lesson_generation_first_valid_step request_id=%s latency_ms=%.1f",
                            request_id,
                            (time.monotonic() - started_at) * 1_000,
                        )
                    accepted_prefix.append(accepted)
                    yield _encode_envelope(
                        {
                            "type": "lesson.step",
                            "request_id": request_id,
                            "step": accepted,
                        }
                    )
                    if payload.generation_mode == "resolved_stepwise" and state.accepted_steps >= 2:
                        break
    except TimeoutError:
        logger.warning("lesson_generation_failed reason=timeout request_id=%s", request_id)
        yield _error_envelope(
            request_id,
            "generation_timeout",
            failure_origin="repair" if repair_budget.in_flight else "generation",
            repair_attempts=repair_budget.attempts,
        )
        return
    except _GenerationFailure as error:
        logger.warning(
            "lesson_generation_failed reason=%s upstream_reason=%s origin=%s repairs=%s "
            "request_id=%s",
            error.code,
            error.upstream_reason or "none",
            error.origin,
            repair_budget.attempts,
            request_id,
        )
        yield _error_envelope(
            request_id,
            error.code,
            error.upstream_reason,
            failure_origin=error.origin,
            repair_attempts=repair_budget.attempts,
        )
        return
    except asyncio.CancelledError:
        logger.info("lesson_generation_cancelled request_id=%s", request_id)
        raise

    if state.accepted_steps == 0:
        logger.warning("lesson_generation_failed reason=no_valid_steps request_id=%s", request_id)
        yield _error_envelope(
            request_id,
            "no_valid_steps",
            repair_attempts=repair_budget.attempts,
        )
        return

    logger.info(
        "lesson_generation_succeeded request_id=%s accepted=%s repairs=%s dropped=%s "
        "sanitized_steps=%s sanitized_fields=%s",
        request_id,
        state.accepted_steps,
        repair_budget.attempts,
        dropped_steps,
        sanitized_steps,
        sanitized_fields,
    )
    continuation_fields: dict[str, Any] = {}
    if (
        payload.generation_mode == "resolved_stepwise"
        and plan is not None
        and state.accepted_steps < len(plan["progression"])
    ):
        assert settings.openai_api_key is not None
        metadata = _continuation_metadata(settings)
        continuation_fields = {
            "continuation_available": True,
            "continuation_receipt": issue_continuation_receipt(
                signing_key=derive_receipt_key(settings.openai_api_key.get_secret_value()),
                request_id=str(request_id),
                client_id=str(payload.client_id),
                prefix=accepted_prefix,
                plan=plan,
                topic=payload.topic,
                student_context=payload.student_context,
                repairs_used=repair_budget.attempts,
                configuration_sha256=metadata["configuration_sha256"],
            ),
        }
    yield _encode_envelope(
        {
            "type": "lesson.done",
            "request_id": request_id,
            "accepted_steps": state.accepted_steps,
            "repairs": repair_budget.attempts,
            "dropped_steps": dropped_steps,
            "sanitized_steps": sanitized_steps,
            "sanitized_fields": sanitized_fields,
            **continuation_fields,
        }
    )


async def _stream_model_lines(
    payload: LessonRequest,
    settings: Settings,
    client: httpx.AsyncClient,
) -> AsyncIterator[str]:
    api_key = settings.openai_api_key
    assert api_key is not None
    headers = {
        "Authorization": f"Bearer {api_key.get_secret_value()}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "OpenAI-Safety-Identifier": _safety_identifier(settings, payload.client_id),
    }
    body = {
        "model": settings.board_model,
        "instructions": _prompt(settings.board_prompt_name, settings.board_contract_version),
        "input": [
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "topic": payload.topic,
                        "student_context": payload.student_context,
                        "visible_board": payload.board_state,
                        "generation_contract": (
                            {
                                "mode": "resolved_stepwise",
                                "opening_steps": {"minimum": 1, "target": 2, "maximum": 2},
                                "first_line": "lesson_plan",
                            }
                            if payload.generation_mode == "resolved_stepwise"
                            else {"mode": "one_shot"}
                        ),
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            }
        ],
        "reasoning": {"effort": settings.board_reasoning_effort},
        "max_output_tokens": MAX_OUTPUT_TOKENS + settings.board_output_token_headroom,
        "store": False,
        "stream": True,
    }
    timeout = httpx.Timeout(settings.lesson_generation_timeout_seconds)
    try:
        async with client.stream(
            "POST",
            OPENAI_RESPONSES_URL,
            headers=headers,
            json=body,
            timeout=timeout,
        ) as response:
            if response.is_error:
                raise _GenerationFailure(
                    "upstream_rejected",
                    _http_upstream_reason(response.status_code),
                )
            sse = _SseParser()
            lines = _JsonlBuffer()
            completed = False
            try:
                async for chunk in response.aiter_bytes():
                    for event_data in sse.feed(chunk):
                        event = _parse_sse_event(event_data)
                        event_type = event.get("type")
                        if completed and event_type != "done.sentinel":
                            raise _GenerationFailure("invalid_stream")
                        if event_type == "response.output_text.delta":
                            delta = event.get("delta")
                            if not isinstance(delta, str):
                                raise _GenerationFailure("invalid_stream")
                            for line in lines.feed(delta):
                                yield line
                        elif event_type == "response.completed":
                            completed = True
                            _log_usage(payload.request_id, settings, event)
                        else:
                            failure = _terminal_failure(event)
                            if failure is not None:
                                raise failure
                for event_data in sse.finish():
                    event = _parse_sse_event(event_data)
                    event_type = event.get("type")
                    if completed and event_type != "done.sentinel":
                        raise _GenerationFailure("invalid_stream")
                    if event_type == "response.output_text.delta":
                        delta = event.get("delta")
                        if not isinstance(delta, str):
                            raise _GenerationFailure("invalid_stream")
                        for line in lines.feed(delta):
                            yield line
                    elif event_type == "response.completed":
                        completed = True
                        _log_usage(payload.request_id, settings, event)
                    else:
                        failure = _terminal_failure(event)
                        if failure is not None:
                            raise failure
                final_line = lines.finish()
                if final_line is not None:
                    yield final_line
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
                raise _GenerationFailure("invalid_stream") from None
            if not completed:
                raise _GenerationFailure("invalid_stream")
    except _GenerationFailure:
        raise
    except (httpx.TimeoutException, httpx.RequestError):
        raise _GenerationFailure("upstream_unavailable") from None


async def _accept_or_repair(
    raw_line: str,
    state: LessonValidationState,
    payload: LessonRequest,
    settings: Settings,
    client: httpx.AsyncClient,
    *,
    repair_budget: _RepairBudget,
) -> tuple[dict[str, Any] | None, int, SanitizationResult | None]:
    candidate_text = raw_line
    issues: list[str]
    repair_attempts = 0
    allowed_repairs = min(MAX_REPAIR_ATTEMPTS, repair_budget.remaining)
    while True:
        try:
            candidate = json.loads(candidate_text)
            validated = validate_step_with_sanitization(candidate, state)
            return validated.step, repair_attempts, validated.sanitization
        except json.JSONDecodeError:
            issues = ["line is not one complete JSON object"]
        except StepValidationError as error:
            issues = error.issues
        # Closed categories only (never issue text, IDs, or model content), so
        # repair causes can be measured without retaining what the model wrote.
        logger.info(
            "lesson_step_invalid request_id=%s categories=%s",
            payload.request_id,
            ",".join(sorted({_issue_category(issue) for issue in issues})),
        )
        if repair_attempts >= allowed_repairs:
            return None, repair_attempts, None
        repair_attempts += 1
        repair_budget.record_attempt()
        try:
            candidate_text = await _repair_step(
                candidate_text,
                issues,
                state,
                payload,
                settings,
                client,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            repair_budget.finish_attempt()
            raise
        repair_budget.finish_attempt()


async def _repair_step(
    invalid_line: str,
    issues: list[str],
    state: LessonValidationState,
    payload: LessonRequest,
    settings: Settings,
    client: httpx.AsyncClient,
) -> str:
    api_key = settings.openai_api_key
    assert api_key is not None
    body = {
        "model": settings.board_model,
        "instructions": _prompt("repair.md", settings.board_contract_version),
        "input": [
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "invalid_step": invalid_line,
                        "validation_errors": issues[:12],
                        "accepted_element_ids": state.inventory(),
                        "topic": payload.topic,
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            }
        ],
        # Keep repair generation on the same broadly supported plain-text
        # Responses surface as primary generation. The prompt requests one
        # JSON object, but the checked-in schema and semantic validator—not an
        # upstream formatting mode—remain the authority for every repair.
        "reasoning": {"effort": settings.board_reasoning_effort},
        "max_output_tokens": 1_200 + settings.board_output_token_headroom,
        "store": False,
    }
    headers = {
        "Authorization": f"Bearer {api_key.get_secret_value()}",
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": _safety_identifier(settings, payload.client_id),
    }
    try:
        response = await client.post(
            OPENAI_RESPONSES_URL,
            headers=headers,
            json=body,
            timeout=httpx.Timeout(settings.lesson_generation_timeout_seconds),
        )
    except (httpx.TimeoutException, httpx.RequestError):
        raise _GenerationFailure("upstream_unavailable", origin="repair") from None
    if response.is_error:
        raise _GenerationFailure(
            "upstream_rejected",
            _http_upstream_reason(response.status_code),
            origin="repair",
        )
    if len(response.content) > MAX_REPAIR_OUTPUT_BYTES:
        raise _GenerationFailure("invalid_stream", origin="repair")
    try:
        repaired = response.json()
        # Token counts only, so repairs show up in per-lesson cost evidence.
        _log_usage(payload.request_id, settings, {"response": repaired})
        return _extract_output_text(repaired)
    except (ValueError, TypeError, json.JSONDecodeError):
        raise _GenerationFailure("invalid_stream", origin="repair") from None


def _extract_output_text(value: Any) -> str:
    if not isinstance(value, dict) or value.get("status") != "completed":
        raise ValueError("repair response did not complete")
    output = value.get("output")
    if not isinstance(output, list):
        raise ValueError("repair response has no output")
    texts: list[str] = []
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, dict) and part.get("type") == "output_text":
                text = part.get("text")
                if isinstance(text, str):
                    texts.append(text)
            elif isinstance(part, dict) and part.get("type") == "refusal":
                raise ValueError("repair was refused")
    if len(texts) != 1 or not texts[0].strip():
        raise ValueError("repair response must contain exactly one text output")
    return texts[0]


class _SseParser:
    def __init__(self) -> None:
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="strict")
        self._buffer = ""
        self._data_lines: list[str] = []
        self._observed_bytes = 0

    def feed(self, chunk: bytes) -> list[str]:
        self._observed_bytes += len(chunk)
        if self._observed_bytes > MAX_UPSTREAM_STREAM_BYTES:
            raise ValueError("upstream stream exceeds byte budget")
        self._buffer += self._decoder.decode(chunk)
        return self._drain_complete_lines()

    def finish(self) -> list[str]:
        self._buffer += self._decoder.decode(b"", final=True)
        events = self._drain_complete_lines()
        if self._buffer:
            self._consume_line(self._buffer.rstrip("\r"), events)
            self._buffer = ""
        if self._data_lines:
            events.append("\n".join(self._data_lines))
            self._data_lines = []
        return events

    def _drain_complete_lines(self) -> list[str]:
        events: list[str] = []
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._consume_line(line.rstrip("\r"), events)
        return events

    def _consume_line(self, line: str, events: list[str]) -> None:
        if line == "":
            if self._data_lines:
                events.append("\n".join(self._data_lines))
                self._data_lines = []
            return
        if line.startswith("data:"):
            self._data_lines.append(line[5:].lstrip(" "))


class _JsonlBuffer:
    def __init__(self) -> None:
        self._buffer = ""
        self._observed_bytes = 0

    def feed(self, delta: str) -> list[str]:
        self._observed_bytes += len(delta.encode("utf-8"))
        if self._observed_bytes > MAX_MODEL_OUTPUT_BYTES:
            raise ValueError("model output exceeds byte budget")
        self._buffer += delta
        if len(self._buffer.encode("utf-8")) > MAX_MODEL_LINE_BYTES and "\n" not in self._buffer:
            raise ValueError("model line exceeds byte budget")
        lines: list[str] = []
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            line = line.strip()
            if line:
                if len(line.encode("utf-8")) > MAX_MODEL_LINE_BYTES:
                    raise ValueError("model line exceeds byte budget")
                lines.append(line)
        return lines

    def finish(self) -> str | None:
        line = self._buffer.strip()
        self._buffer = ""
        if not line:
            return None
        if len(line.encode("utf-8")) > MAX_MODEL_LINE_BYTES:
            raise ValueError("model line exceeds byte budget")
        return line


def _parse_sse_event(data: str) -> dict[str, Any]:
    if data == "[DONE]":
        return {"type": "done.sentinel"}
    value = json.loads(data)
    if not isinstance(value, dict) or not isinstance(value.get("type"), str):
        raise ValueError("invalid upstream SSE event")
    return value


def _encode_envelope(value: dict[str, Any]) -> bytes:
    validate_envelope(value)
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def _error_envelope(
    request_id: str,
    code: LessonErrorCode,
    upstream_reason: UpstreamReason | None = None,
    *,
    failure_origin: FailureOrigin = "generation",
    repair_attempts: int,
) -> bytes:
    return _encode_envelope(
        {
            "type": "lesson.error",
            "request_id": request_id,
            "code": code,
            "fallback_available": True,
            "failure_origin": failure_origin,
            "repair_attempts": repair_attempts,
            **({"upstream_reason": upstream_reason} if upstream_reason is not None else {}),
        }
    )


_ISSUE_CATEGORIES: tuple[tuple[str, str], ...] = (
    ("not an earlier mark", "figure_reference"),
    ("is not a ", "figure_mark_kind"),
    ("is not an accepted figure", "figure_on"),
    ("visible samples", "curve_invisible"),
    ("expression", "expression"),
    ("already used on the board", "duplicate_id"),
    ("duplicate", "duplicate_id"),
    ("at most", "budget"),
    ("must increase", "range"),
    ("not one complete JSON object", "json"),
    # Equation lint (latex_lint.py), split by cause so repairs can be traced
    # to the allowlist, the environment list, or malformed input.
    ("unknown latex command", "latex_command"),
    ("unknown latex environment", "latex_environment"),
    ("forbidden latex", "latex_forbidden"),
    ("braces are unbalanced", "latex_braces"),
    ("must not contain $", "latex_dollar"),
    ("has no matching \\right", "latex_left_right"),
    ("anchor", "reference"),
    ("not already accepted", "reference"),
    ("latex", "latex"),
    ("script", "script"),
    ("checkpoint", "checkpoint"),
    ("layout", "layout"),
    ("is not valid under any of the given schemas", "schema"),
    ("Additional properties", "schema"),
    ("is a required property", "schema"),
)


def _issue_category(issue: str) -> str:
    for needle, category in _ISSUE_CATEGORIES:
        if needle in issue:
            return category
    return "schema" if issue.startswith("/") else "other"


def _log_usage(request_id: str, settings: Settings, event: dict[str, Any]) -> None:
    """Log token counts only, so per-lesson cost can be measured without content."""

    response = event.get("response")
    usage = response.get("usage") if isinstance(response, dict) else None
    if not isinstance(usage, dict):
        return

    def count(key: str, detail_key: str | None = None) -> int:
        value = usage.get(key)
        if detail_key is not None:
            value = value.get(detail_key) if isinstance(value, dict) else None
        return value if isinstance(value, int) and not isinstance(value, bool) else 0

    logger.info(
        "lesson_generation_usage request_id=%s model=%s input_tokens=%d cached_input_tokens=%d "
        "output_tokens=%d reasoning_tokens=%d",
        request_id,
        settings.board_model,
        count("input_tokens"),
        count("input_tokens_details", "cached_tokens"),
        count("output_tokens"),
        count("output_tokens_details", "reasoning_tokens"),
    )


def _terminal_failure(event: dict[str, Any]) -> _GenerationFailure | None:
    event_type = event.get("type")
    if event_type == "response.incomplete":
        return _GenerationFailure(
            "upstream_incomplete",
            _normalized_upstream_reason(
                _nested_string(event, "response", "incomplete_details", "reason")
            ),
        )
    if event_type == "response.failed":
        return _GenerationFailure(
            "upstream_failed",
            _normalized_upstream_reason(_nested_string(event, "response", "error", "code")),
        )
    if event_type == "error":
        raw_code = event.get("code")
        if not isinstance(raw_code, str):
            raw_code = _nested_string(event, "error", "code")
        return _GenerationFailure(
            "upstream_error",
            _normalized_upstream_reason(raw_code),
        )
    return None


def _nested_string(value: dict[str, Any], *path: str) -> str | None:
    current: Any = value
    for part in path:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current if isinstance(current, str) else None


def _normalized_upstream_reason(value: str | None) -> UpstreamReason:
    if value is None:
        return "unknown"
    return _UPSTREAM_REASON_CODES.get(value.lower(), "unknown")


def _http_upstream_reason(status_code: int) -> UpstreamReason:
    if status_code == 401:
        return "authentication"
    if status_code in {403, 404}:
        return "permission"
    if status_code == 429:
        return "rate_limit"
    if 400 <= status_code < 500:
        return "invalid_request"
    if status_code >= 500:
        return "server_error"
    return "unknown"


def _step_hint(raw_line: str) -> dict[str, str]:
    try:
        value = json.loads(raw_line)
    except json.JSONDecodeError:
        return {}
    if not isinstance(value, dict):
        return {}
    step_id = value.get("id")
    if (
        isinstance(step_id, str)
        and len(step_id) <= 16
        and step_id
        and step_id[0].islower()
        and all(
            character.islower() or character.isdigit() or character in "_-" for character in step_id
        )
    ):
        return {"step_hint": step_id}
    return {}


def _prompt(name: str, contract_version: ContractVersion = "v3") -> str:
    template = (PROMPT_DIR / name).read_text(encoding="utf-8")
    if name in {"board_engine.md", "board_engine_v4.md", "repair.md", "continue.md"}:
        return expand_prompt_contract(template, contract_version)
    if LESSON_WIRE_CONTRACT_MARKER in template:
        raise ValueError("legacy prompt unexpectedly contains a schema contract marker")
    return template


def _prompt_sha256(name: str, contract_version: ContractVersion = "v3") -> str:
    return hashlib.sha256(_prompt(name, contract_version).encode()).hexdigest()
