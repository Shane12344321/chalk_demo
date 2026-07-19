"""Deterministic tests for the bounded scratch-card endpoint."""

import json
from collections.abc import Callable

import httpx
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.dependencies import get_openai_http_client
from app.main import create_app

API_KEY = "scratch-api-key-test-sentinel"
CLIENT_ID = "2f2db996-2dcc-4fc8-aa7f-206c7e7a9300"
REQUEST_ID = "783c6081-75a4-4ed2-8be7-4e0f32680a2b"
SALT = "scratch-test-domain-separator"

VALID_STEP = {
    "id": "s1",
    "script": "A right triangle with the hypotenuse labeled.",
    "ops": [
        {
            "op": "text",
            "id": "title",
            "region": "A1",
            "content": "Right triangle",
        }
    ],
    "checkpoint": None,
}


def settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "openai_api_key": SecretStr(API_KEY),
        "frontend_origin": "http://localhost:5173",
        "safety_identifier_salt": SALT,
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


def scratch_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "request_id": REQUEST_ID,
        "client_id": CLIENT_ID,
        "description": "a labeled right triangle",
    }
    payload.update(overrides)
    return payload


def model_response(text: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": text}],
                }
            ],
        },
    )


def test_valid_scratch_step_is_returned_with_bounded_headers() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["store"] is False
        return model_response(json.dumps(VALID_STEP))

    with client_with_transport(handler) as client:
        response = client.post("/scratch", json=scratch_payload())
    assert response.status_code == 200
    payload = response.json()
    assert payload["request_id"] == REQUEST_ID
    assert payload["step"]["id"] == "s1"
    assert payload["step"]["checkpoint"] is None
    assert response.headers["X-Chalk-Scratch-Repairs"] == "0"
    assert response.headers["Cache-Control"] == "no-store"


def test_invalid_step_is_repaired_once() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append(body["instructions"][:40])
        if len(calls) == 1:
            return model_response("this is not json")
        user_payload = json.loads(body["input"][0]["content"])
        assert user_payload["accepted_element_ids"] == []
        return model_response(json.dumps(VALID_STEP))

    with client_with_transport(handler) as client:
        response = client.post("/scratch", json=scratch_payload())
    assert response.status_code == 200
    assert response.headers["X-Chalk-Scratch-Repairs"] == "1"
    assert len(calls) == 2


def test_checkpoint_and_erase_steps_are_outside_the_scratch_contract() -> None:
    checkpoint_step = {
        **VALID_STEP,
        "checkpoint": {"question": "Ready to continue?", "expected_gist": "yes"},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return model_response(json.dumps(checkpoint_step))

    with client_with_transport(handler) as client:
        response = client.post("/scratch", json=scratch_payload())
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_scratch"
    assert detail["repair_attempts"] == 2


def test_missing_api_key_is_not_configured() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no upstream call may happen without a key")

    with client_with_transport(handler, app_settings=settings(openai_api_key=None)) as client:
        response = client.post("/scratch", json=scratch_payload())
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "not_configured"


def test_upstream_rejection_maps_to_bounded_reason() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "secret upstream text"}})

    with client_with_transport(handler) as client:
        response = client.post("/scratch", json=scratch_payload())
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["code"] == "upstream_rejected"
    assert "secret" not in json.dumps(detail)


def test_description_bounds_are_enforced_before_any_call() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("invalid payloads may not reach the model")

    with client_with_transport(handler) as client:
        assert client.post("/scratch", json=scratch_payload(description="ab")).status_code == 422
        assert (
            client.post("/scratch", json=scratch_payload(description="x" * 201)).status_code == 422
        )
        assert client.post("/scratch", json=scratch_payload(extra="field")).status_code == 422
