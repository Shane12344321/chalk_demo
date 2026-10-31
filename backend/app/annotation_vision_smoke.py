"""Owner-gated two-call A/B spike for supplementary annotation screenshot context."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import time
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from app.annotation_validation import validate_annotation
from app.annotations import MAX_ANNOTATION_OUTPUT_TOKENS, PROMPT_DIR
from app.config import Settings
from app.lessons import OPENAI_RESPONSES_URL, _extract_output_text
from app.sessions import _safety_identifier

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURE_PATH = PROJECT_ROOT / "shared/fixtures/annotation-vision-smoke.json"
MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024
SUPPORTED_IMAGE_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def run_annotation_vision_smoke(
    settings: Settings,
    output_dir: Path,
    *,
    fixture_path: Path = DEFAULT_FIXTURE_PATH,
    client: httpx.Client | None = None,
) -> tuple[dict[str, Any], bool]:
    """Run one structured control and one structured-plus-image variant, without retry."""

    if not settings.has_openai_api_key:
        raise ValueError("annotation vision smoke has no configured API key")
    fixture = _load_fixture(fixture_path)
    screenshot_path = PROJECT_ROOT / fixture["screenshot"]
    image_data_url, image_hash = _image_data_url(screenshot_path)
    output_dir.mkdir(parents=True, exist_ok=False)

    request_id = str(uuid.uuid4())
    client_id = str(uuid.uuid4())
    text_context = json.dumps(
        {
            "request_id": request_id,
            "manifest_version": fixture["manifest_version"],
            "question": fixture["question"],
            "visible_board": fixture["board_manifest"],
            "visible_elements": fixture["visible_elements"],
            "context_rule": (
                "Structured IDs and bounds are authoritative; the image is supplementary."
            ),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    owns_client = client is None
    http_client = client or httpx.Client(follow_redirects=False, trust_env=False)
    results: list[dict[str, Any]] = []
    try:
        for mode in ("structured", "structured_plus_image"):
            content: list[dict[str, Any]] = [{"type": "input_text", "text": text_context}]
            if mode == "structured_plus_image":
                content.append(
                    {
                        "type": "input_image",
                        "image_url": image_data_url,
                        "detail": "low",
                    }
                )
            started_at = time.perf_counter()
            response = http_client.post(
                OPENAI_RESPONSES_URL,
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key.get_secret_value()}",
                    "Content-Type": "application/json",
                    "OpenAI-Safety-Identifier": _safety_identifier(settings, client_id),
                },
                json={
                    "model": settings.board_model,
                    "instructions": (PROMPT_DIR / "annotation.md").read_text(encoding="utf-8"),
                    "input": [{"role": "user", "content": content}],
                    "reasoning": {"effort": settings.board_reasoning_effort},
                    "max_output_tokens": MAX_ANNOTATION_OUTPUT_TOKENS
                    + settings.board_output_token_headroom,
                    "store": False,
                },
                timeout=httpx.Timeout(settings.annotation_generation_timeout_seconds),
            )
            response.raise_for_status()
            candidate = json.loads(_extract_output_text(response.json()))
            accepted = validate_annotation(
                candidate,
                request_id=request_id,
                manifest_version=fixture["manifest_version"],
                visible_element_ids={item["id"] for item in fixture["visible_elements"]},
            )
            results.append(
                {
                    "mode": mode,
                    "latency_ms": round((time.perf_counter() - started_at) * 1_000, 1),
                    "usage": _closed_usage(response.json().get("usage")),
                    "target_valid": True,
                    "annotation": _redacted_annotation(accepted),
                    "human_placement_pass": None,
                    "human_note": None,
                }
            )
    finally:
        if owns_client:
            http_client.close()

    summary = {
        "schema": "chalk.annotation-vision-smoke.v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "owner_approved": True,
        "execution": "structured_then_structured_plus_image_no_retry",
        "attempted_calls": len(results),
        "board_model": settings.board_model,
        "board_reasoning_effort": settings.board_reasoning_effort,
        "image_detail": "low",
        "image_sha256": image_hash,
        "image_bytes_retained": False,
        "structured_context_authoritative": True,
        "results": results,
        "vision_materially_better": None,
    }
    (output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return summary, len(results) == 2


def _load_fixture(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(value, dict)
        or value.get("schema") != "chalk.annotation-vision-smoke-fixture.v1"
    ):
        raise ValueError("invalid annotation vision fixture")
    required = {"screenshot", "question", "manifest_version", "board_manifest", "visible_elements"}
    if not required.issubset(value):
        raise ValueError("annotation vision fixture is incomplete")
    if not isinstance(value["visible_elements"], list) or not value["visible_elements"]:
        raise ValueError("annotation vision fixture has no visible elements")
    return value


def _image_data_url(path: Path) -> tuple[str, str]:
    media_type = SUPPORTED_IMAGE_TYPES.get(path.suffix.lower())
    if media_type is None:
        raise ValueError("annotation vision screenshot must be PNG, JPEG, or WEBP")
    data = path.read_bytes()
    if not data or len(data) > MAX_SCREENSHOT_BYTES:
        raise ValueError("annotation vision screenshot exceeds its byte budget")
    data_url = f"data:{media_type};base64,{base64.b64encode(data).decode('ascii')}"
    return data_url, hashlib.sha256(data).hexdigest()


def _closed_usage(value: Any) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None
    result: dict[str, int] = {}
    for key in ("input_tokens", "output_tokens", "total_tokens"):
        item = value.get(key)
        if isinstance(item, int) and not isinstance(item, bool) and item >= 0:
            result[key] = item
    return result or None


def _redacted_annotation(value: dict[str, Any]) -> dict[str, Any]:
    ops = []
    for op in value["ops"]:
        ops.append(
            {key: item for key, item in op.items() if key in {"op", "id", "target_id", "side"}}
        )
    return {"op_count": len(ops), "ops": ops}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--approved-by-owner", action="store_true")
    args = parser.parse_args(argv)
    if not args.approved_by_owner:
        parser.error("refusing annotation vision smoke without --approved-by-owner")
    summary, passed = run_annotation_vision_smoke(
        Settings(), args.output_dir, fixture_path=args.fixture
    )
    print(
        json.dumps(
            {
                "mode": "annotation-vision-smoke",
                "summary": str(args.output_dir / "summary.json"),
                "attempted_calls": summary["attempted_calls"],
                "pass": passed,
            }
        )
    )
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
