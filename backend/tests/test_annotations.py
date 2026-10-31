"""Deterministic tests for bounded annotation overlays."""

import hashlib
import json
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.annotation_validation import AnnotationValidationError, validate_annotation
from app.config import Settings
from app.dependencies import get_openai_http_client
from app.main import create_app

API_KEY = "annotation-api-key-test-sentinel"
CLIENT_ID = "2f2db996-2dcc-4fc8-aa7f-206c7e7a9300"
REQUEST_ID = "783c6081-75a4-4ed2-8be7-4e0f32680a2b"
SALT = "annotation-test-domain-separator"


def settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "openai_api_key": SecretStr(API_KEY),
        "frontend_origin": "http://localhost:5173",
        "safety_identifier_salt": SALT,
        "annotation_whitespace": "bounded",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def client_with_transport(
    handler: Callable[[httpx.Request], httpx.Response],
    *,
    app_settings: Settings | None = None,
) -> TestClient:
    application = create_app(app_settings or settings())
    upstream_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    application.dependency_overrides[get_openai_http_client] = lambda: upstream_client
    return TestClient(application)


def annotation_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "request_id": REQUEST_ID,
        "client_id": CLIENT_ID,
        "question": "Why does this curve peak here?",
        "manifest_version": 3,
        "board_manifest": "Lesson: projectile range. Visible board: rangecurve.",
        "visible_elements": [
            {"id": "rangeaxes", "kind": "axes", "bounds": [0.52, 0.18, 0.42, 0.58]},
            {"id": "rangecurve", "kind": "curve", "bounds": [0.55, 0.22, 0.36, 0.48]},
        ],
    }
    payload.update(overrides)
    return payload


def program(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "schema_version": "1.0",
        "request_id": REQUEST_ID,
        "manifest_version": 3,
        "ops": [
            {
                "op": "circle",
                "id": "peakmark",
                "target_id": "rangecurve",
            }
        ],
    }
    value.update(overrides)
    return value


def completed_output(value: object) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": json.dumps(value, separators=(",", ":")),
                        }
                    ],
                }
            ],
        },
    )


def test_annotation_validator_accepts_only_visible_targets() -> None:
    assert (
        validate_annotation(
            program(),
            request_id=REQUEST_ID,
            manifest_version=3,
            visible_element_ids={"rangeaxes", "rangecurve"},
        )
        == program()
    )
    with pytest.raises(AnnotationValidationError, match="target is not visible"):
        validate_annotation(
            program(ops=[{"op": "circle", "id": "peakmark", "target_id": "future"}]),
            request_id=REQUEST_ID,
            manifest_version=3,
            visible_element_ids={"rangecurve"},
        )


def test_annotation_validator_enforces_renderer_whitespace_for_sided_marks() -> None:
    arrow = program(
        ops=[
            {
                "op": "arrow",
                "id": "peakarrow",
                "target_id": "rangecurve",
                "side": "right",
            }
        ]
    )
    with pytest.raises(AnnotationValidationError, match="whitespace allowlist"):
        validate_annotation(
            arrow,
            request_id=REQUEST_ID,
            manifest_version=3,
            visible_element_ids={"rangecurve"},
            allowed_sides={"rangecurve": {"left", "above"}},
        )
    assert (
        validate_annotation(
            arrow,
            request_id=REQUEST_ID,
            manifest_version=3,
            visible_element_ids={"rangecurve"},
            allowed_sides={"rangecurve": {"right", "below"}},
        )
        == arrow
    )


@pytest.mark.parametrize(
    "invalid",
    [
        program(request_id="00000000-0000-4000-8000-000000000001"),
        program(manifest_version=4),
        program(
            ops=[
                {
                    "op": "equation",
                    "id": "explain",
                    "target_id": "rangecurve",
                    "side": "below",
                    "latex": r"\\href{https://example.com}{x}",
                }
            ]
        ),
        program(ops=[{"op": "circle", "id": "rangecurve", "target_id": "rangecurve"}]),
        program(
            ops=[
                {
                    "op": "axes",
                    "id": "newaxes",
                    "target_id": "rangecurve",
                }
            ]
        ),
    ],
)
def test_annotation_validator_rejects_mismatch_unsafe_latex_duplicates_and_axes(
    invalid: dict[str, object],
) -> None:
    with pytest.raises(AnnotationValidationError):
        validate_annotation(
            invalid,
            request_id=REQUEST_ID,
            manifest_version=3,
            visible_element_ids={"rangeaxes", "rangecurve"},
        )


def test_annotation_endpoint_returns_only_validated_schema_and_safe_headers() -> None:
    captured: httpx.Request | None = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured
        captured = request
        return completed_output(program())

    with client_with_transport(handler) as client:
        response = client.post("/annotate", json=annotation_payload())

    assert response.status_code == 200
    assert response.json() == program()
    assert response.headers["x-chalk-annotation-repairs"] == "0"
    assert response.headers["x-chalk-annotation-whitespace"] == "bounded"
    assert response.headers["cache-control"] == "no-store"
    assert captured is not None
    assert captured.url == "https://api.openai.com/v1/responses"
    assert captured.headers["authorization"] == f"Bearer {API_KEY}"
    assert (
        captured.headers["openai-safety-identifier"]
        == hashlib.sha256(f"{SALT}:{CLIENT_ID}".encode()).hexdigest()
    )
    upstream = json.loads(captured.read())
    assert upstream["model"] == "gpt-6.1-sol"
    assert upstream["reasoning"] == {"effort": "low"}
    assert upstream["max_output_tokens"] == 1_200 + 4_000
    assert upstream["store"] is False
    annotation_input = json.loads(upstream["input"][0]["content"])
    assert annotation_input["annotation_open_sides"] == {
        "rangeaxes": ["below", "left"],
        "rangecurve": ["left", "above"],
    }


def test_annotation_whitespace_flag_off_preserves_existing_model_input() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.read()))
        return completed_output(program())

    with client_with_transport(
        handler,
        app_settings=settings(annotation_whitespace="off"),
    ) as client:
        response = client.post("/annotate", json=annotation_payload())

    assert response.status_code == 200
    annotation_input = json.loads(captured["input"][0]["content"])
    assert "annotation_open_sides" not in annotation_input
    assert response.headers["x-chalk-annotation-whitespace"] == "off"


def test_annotation_repairs_once_and_preserves_request_identity() -> None:
    calls: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.read()))
        if len(calls) == 1:
            return completed_output(program(ops=[]))
        return completed_output(program())

    with client_with_transport(handler) as client:
        response = client.post("/annotate", json=annotation_payload())

    assert response.status_code == 200
    assert response.json() == program()
    assert response.headers["x-chalk-annotation-repairs"] == "1"
    assert len(calls) == 2
    repair_input = json.loads(calls[1]["input"][0]["content"])
    assert repair_input["request_id"] == REQUEST_ID
    assert repair_input["manifest_version"] == 3
    assert repair_input["visible_elements"] == annotation_payload()["visible_elements"]
    assert repair_input["annotation_open_sides"] == {
        "rangeaxes": ["below", "left"],
        "rangecurve": ["left", "above"],
    }


def test_annotation_stops_after_two_counted_repairs() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return completed_output(program(ops=[]))

    with client_with_transport(handler) as client:
        response = client.post("/annotate", json=annotation_payload())

    assert calls == 3
    assert response.status_code == 502
    assert response.json() == {
        "detail": {
            "code": "invalid_annotation",
            "request_id": REQUEST_ID,
            "failure_origin": "repair",
            "repair_attempts": 2,
        }
    }


@pytest.mark.parametrize(
    ("upstream", "status", "code", "reason"),
    [
        (httpx.Response(429), 502, "upstream_rejected", "rate_limit"),
        (httpx.ReadTimeout("timeout"), 503, "upstream_unavailable", None),
        (httpx.Response(200, text="not-json"), 502, "upstream_invalid_response", None),
    ],
)
def test_annotation_contains_upstream_failures(
    upstream: httpx.Response | Exception,
    status: int,
    code: str,
    reason: str | None,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if isinstance(upstream, Exception):
            raise upstream
        return upstream

    with client_with_transport(handler) as client:
        response = client.post("/annotate", json=annotation_payload())

    assert response.status_code == status
    detail = response.json()["detail"]
    assert detail["code"] == code
    assert detail["repair_attempts"] == 0
    assert detail.get("upstream_reason") == reason
    assert API_KEY not in response.text


def test_annotation_rejects_missing_key_invalid_request_and_untrusted_host_before_call() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return completed_output(program())

    with client_with_transport(handler, app_settings=settings(openai_api_key=None)) as client:
        missing = client.post("/annotate", json=annotation_payload())
        invalid = client.post(
            "/annotate",
            json=annotation_payload(
                visible_elements=[
                    {"id": "duplicate", "kind": "text", "bounds": [0.1, 0.1, 0.2, 0.1]},
                    {"id": "duplicate", "kind": "text", "bounds": [0.4, 0.1, 0.2, 0.1]},
                ]
            ),
        )
        hostile = client.post(
            "/annotate",
            headers={"Host": "attacker.example"},
            json=annotation_payload(),
        )

    assert missing.status_code == 503
    assert missing.json()["detail"]["code"] == "not_configured"
    assert invalid.status_code == 422
    assert hostile.status_code == 400
    assert called is False


def test_annotation_body_limit_rejects_before_upstream_call() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return completed_output(program())

    with client_with_transport(handler) as client:
        response = client.post(
            "/annotate",
            content=b"x" * (6 * 1024 + 1),
            headers={"Content-Type": "application/json"},
        )

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "request_too_large"
    assert called is False


@pytest.mark.parametrize(
    "bounds",
    [
        [-0.001, 0.1, 0.2, 0.2],
        [0.1, 0.1, 0.0, 0.2],
        [0.9, 0.1, 0.2, 0.2],
        [0.1, 0.9, 0.2, 0.2],
    ],
)
def test_annotation_rejects_invalid_structured_bounds(bounds: list[float]) -> None:
    payload = annotation_payload(
        visible_elements=[{"id": "rangecurve", "kind": "curve", "bounds": bounds}]
    )
    with client_with_transport(lambda _request: completed_output(program())) as client:
        response = client.post("/annotate", json=payload)
    assert response.status_code == 422


def test_thirty_structured_elements_fit_the_existing_six_kib_request_budget() -> None:
    visible_elements = [
        {
            "id": f"element{index}",
            "kind": "text",
            "bounds": [0.02 * (index % 10), 0.03 * (index // 10), 0.015, 0.02],
        }
        for index in range(30)
    ]
    payload = annotation_payload(visible_elements=visible_elements)
    encoded = json.dumps(payload, separators=(",", ":")).encode()
    assert len(encoded) <= 6 * 1024

    accepted_program = program(ops=[{"op": "circle", "id": "mark", "target_id": "element0"}])
    with client_with_transport(lambda _request: completed_output(accepted_program)) as client:
        response = client.post(
            "/annotate", content=encoded, headers={"Content-Type": "application/json"}
        )
    assert response.status_code == 200
