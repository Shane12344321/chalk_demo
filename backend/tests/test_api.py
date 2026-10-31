"""Deterministic tests for health and Realtime client-secret minting."""

import asyncio
import hashlib
import json
import logging
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.dependencies import get_openai_http_client
from app.main import create_app
from app.middleware import SESSION_BODY_MAX_BYTES, SessionBodyLimitMiddleware

API_KEY = "standard-api-key-test-sentinel"
CLIENT_SECRET = "ephemeral-secret-test-sentinel"
CLIENT_ID = "2f2db996-2dcc-4fc8-aa7f-206c7e7a9300"
REQUEST_ID = "783c6081-75a4-4ed2-8be7-4e0f32680a2b"
SALT = "test-domain-separator"


def settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "openai_api_key": SecretStr(API_KEY),
        "realtime_model": "gpt-realtime-2.1-mini",
        "realtime_voice": "marin",
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
    upstream_client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
    )
    application.dependency_overrides[get_openai_http_client] = lambda: upstream_client
    return TestClient(application)


def session_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "request_id": REQUEST_ID,
        "client_id": CLIENT_ID,
    }
    payload.update(overrides)
    return payload


def test_health_reports_configuration_without_secret_values() -> None:
    app = create_app(settings())

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "chalk-backend",
        "realtime": {
            "configured": True,
            "model": "gpt-realtime-2.1-mini",
            "voice": "marin",
            "sync_mode": "fixed",
        },
        "board": {
            "configured": True,
            "model": "gpt-6.1-sol",
            "reasoning_effort": "low",
        },
        "renderer": {
            "tldraw_license_configured": False,
        },
    }
    assert API_KEY not in response.text


def test_renderer_runtime_config_is_no_store_and_omitted_when_unconfigured() -> None:
    app = create_app(settings())
    with TestClient(app) as client:
        response = client.get("/runtime-config/renderer")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {}


def test_renderer_runtime_config_projects_configured_key_without_health_leak() -> None:
    license_key = "tldraw-license-test-sentinel"
    app = create_app(settings(tldraw_license_key=SecretStr(license_key)))
    with TestClient(app) as client:
        health = client.get("/health")
        response = client.get("/runtime-config/renderer")

    assert health.json()["renderer"]["tldraw_license_configured"] is True
    assert license_key not in health.text
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"tldraw_license_key": license_key}


def test_untrusted_host_is_rejected_before_a_paid_lesson_call() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500)

    with client_with_transport(handler) as client:
        response = client.post(
            "/lesson",
            headers={"Host": "attacker.example", "Content-Type": "application/json"},
            json={
                "request_id": REQUEST_ID,
                "client_id": CLIENT_ID,
                "topic": "Synthetic derivative topic",
                "student_context": "",
                "board_state": "",
            },
        )

    assert response.status_code == 400
    assert response.text == "Invalid host header"
    assert called is False


def test_session_fails_cleanly_when_api_key_is_missing() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500)

    with client_with_transport(handler, app_settings=settings(openai_api_key=None)) as client:
        health_response = client.get("/health")
        response = client.post("/session", json=session_payload())

    assert health_response.json()["realtime"]["configured"] is False
    assert health_response.json()["board"]["configured"] is False
    assert response.status_code == 503
    assert response.json() == {
        "detail": {
            "code": "openai_not_configured",
            "message": "Realtime sessions are not configured on this server.",
            "request_id": REQUEST_ID,
        }
    }
    assert called is False
    assert API_KEY not in response.text


def test_session_sends_explicit_payload_and_salted_safety_identifier(
    caplog: pytest.LogCaptureFixture,
) -> None:
    captured_request: httpx.Request | None = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_request
        captured_request = request
        return httpx.Response(
            200,
            json={
                "value": CLIENT_SECRET,
                "expires_at": 1_800_000_000,
                "ignored_upstream_field": "must-not-be-forwarded",
            },
        )

    caplog.set_level(logging.INFO)
    with client_with_transport(handler) as client:
        response = client.post("/session", json=session_payload())

    assert response.status_code == 201
    assert response.json() == {
        "request_id": REQUEST_ID,
        "client_secret": CLIENT_SECRET,
        "expires_at": 1_800_000_000,
        "model": "gpt-realtime-2.1-mini",
        "voice": "marin",
        "sync_mode": "fixed",
    }
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    assert captured_request is not None
    assert captured_request.url == "https://api.openai.com/v1/realtime/client_secrets"
    assert captured_request.headers["authorization"] == f"Bearer {API_KEY}"
    expected_identifier = hashlib.sha256(f"{SALT}:{CLIENT_ID}".encode()).hexdigest()
    assert captured_request.headers["openai-safety-identifier"] == expected_identifier
    assert CLIENT_ID not in captured_request.headers["openai-safety-identifier"]
    assert captured_request.read().decode() == (
        '{"session":{"type":"realtime","model":"gpt-realtime-2.1-mini",'
        '"audio":{"output":{"voice":"marin"}}}}'
    )
    assert REQUEST_ID in caplog.text
    assert API_KEY not in caplog.text
    assert CLIENT_SECRET not in caplog.text
    assert CLIENT_ID not in caplog.text


def test_session_omits_absent_expiry_from_safe_projection() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"value": CLIENT_SECRET, "private": "discarded"})

    with client_with_transport(handler) as client:
        response = client.post("/session", json=session_payload())

    assert response.status_code == 201
    assert response.json() == {
        "request_id": REQUEST_ID,
        "client_secret": CLIENT_SECRET,
        "model": "gpt-realtime-2.1-mini",
        "voice": "marin",
        "sync_mode": "fixed",
    }


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"request_id": REQUEST_ID},
        {"request_id": 1234, "client_id": CLIENT_ID},
        {"request_id": "request-one", "client_id": CLIENT_ID},
        {"request_id": REQUEST_ID, "client_id": 1234},
        {"request_id": REQUEST_ID, "client_id": "00000000"},
        {"request_id": REQUEST_ID, "client_id": "chalk-local-client"},
        {"request_id": REQUEST_ID, "client_id": "person@example.com"},
        {
            "request_id": REQUEST_ID,
            "client_id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        },
        {
            "request_id": "886313e1-3b8a-5372-9b90-0c9aee199e5d",
            "client_id": CLIENT_ID,
        },
        {"request_id": REQUEST_ID.upper(), "client_id": CLIENT_ID},
        {"request_id": REQUEST_ID, "client_id": CLIENT_ID, "name": "student"},
    ],
)
def test_session_rejects_missing_pii_like_or_extra_identifiers(
    payload: dict[str, object],
) -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500)

    with client_with_transport(handler) as client:
        response = client.post("/session", json=payload)

    assert response.status_code == 422
    assert called is False


@pytest.mark.parametrize(
    ("upstream_response", "expected_code"),
    [
        (httpx.Response(200, text="not-json"), "openai_invalid_response"),
        (httpx.Response(200, json={"expires_at": 123}), "openai_invalid_response"),
        (httpx.Response(200, json={"value": "", "expires_at": 123}), "openai_invalid_response"),
        (
            httpx.Response(200, json={"value": CLIENT_SECRET, "expires_at": "soon"}),
            "openai_invalid_response",
        ),
        (
            httpx.Response(
                401,
                json={"error": {"message": f"bad key {API_KEY} and token {CLIENT_SECRET}"}},
            ),
            "openai_rejected_session",
        ),
        (
            httpx.Response(429, text=f"rate limited key={API_KEY} secret={CLIENT_SECRET}"),
            "openai_rejected_session",
        ),
    ],
)
def test_session_redacts_malformed_and_upstream_errors(
    upstream_response: httpx.Response,
    expected_code: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return upstream_response

    caplog.set_level(logging.WARNING)
    with client_with_transport(handler) as client:
        response = client.post("/session", json=session_payload())

    assert response.status_code == 502
    assert response.json() == {
        "detail": {
            "code": expected_code,
            "message": "Unable to create a Realtime session.",
            "request_id": REQUEST_ID,
        }
    }
    combined_output = response.text + caplog.text
    assert API_KEY not in combined_output
    assert CLIENT_SECRET not in combined_output
    assert CLIENT_ID not in combined_output


def test_session_redacts_network_exceptions(caplog: pytest.LogCaptureFixture) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(
            f"connection failed with {API_KEY} {CLIENT_SECRET}",
            request=request,
        )

    caplog.set_level(logging.WARNING)
    with client_with_transport(handler) as client:
        response = client.post("/session", json=session_payload())

    assert response.status_code == 502
    assert response.json() == {
        "detail": {
            "code": "openai_unavailable",
            "message": "Unable to create a Realtime session.",
            "request_id": REQUEST_ID,
        }
    }
    combined_output = response.text + caplog.text
    assert API_KEY not in combined_output
    assert CLIENT_SECRET not in combined_output
    assert CLIENT_ID not in combined_output


def test_cors_is_bound_to_the_explicit_frontend_origin() -> None:
    app = create_app(settings())

    with TestClient(app) as client:
        allowed = client.options(
            "/session",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        denied = client.options(
            "/session",
            headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


@pytest.mark.parametrize(
    "origin",
    ["*", "https://frontend.example", "http://localhost:5173/path"],
)
def test_settings_reject_nonlocal_or_nonorigin_cors_values(origin: str) -> None:
    with pytest.raises(ValidationError):
        settings(frontend_origin=origin)


@pytest.mark.parametrize(
    "base_url",
    [
        "https://attacker.example/v1",
        "http://api.openai.com/v1",
        "https://api.openai.com/v1/",
        "https://api.openai.com/v1?redirect=https://attacker.example",
    ],
)
def test_settings_prevent_api_key_destination_override(base_url: str) -> None:
    with pytest.raises(ValidationError):
        settings(openai_api_base_url=base_url)


def test_settings_prevent_api_key_destination_environment_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_BASE_URL", "https://attacker.example/v1")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("realtime_model", "sk-secret-placed-in-wrong-variable"),
        ("realtime_voice", "sk-secret-placed-in-wrong-variable"),
        ("board_model", "sk-secret-placed-in-wrong-variable"),
        ("board_reasoning_effort", "sk-secret-placed-in-wrong-variable"),
        ("realtime_model", "unreviewed-realtime-model"),
        ("realtime_voice", "unreviewed-voice"),
        ("board_model", "unreviewed-board-model"),
        ("board_reasoning_effort", "high"),
    ],
)
def test_settings_reject_secret_like_or_unreviewed_public_configuration(
    field: str,
    value: str,
) -> None:
    with pytest.raises(ValidationError):
        settings(**{field: value})


@pytest.mark.parametrize("model", ["gpt-6.1-sol", "gpt-6-astra"])
def test_settings_reject_no_reasoning_for_models_that_require_it(model: str) -> None:
    with pytest.raises(ValidationError):
        settings(board_model=model, board_reasoning_effort="none")


def test_reasoning_effort_adds_output_token_headroom() -> None:
    assert (
        settings(
            board_model="gpt-6-luna", board_reasoning_effort="none"
        ).board_output_token_headroom
        == 0
    )
    assert (
        settings(
            board_model="gpt-6.1-sol", board_reasoning_effort="low"
        ).board_output_token_headroom
        == 4_000
    )
    assert (
        settings(
            board_model="gpt-6.1-sol", board_reasoning_effort="medium"
        ).board_output_token_headroom
        == 12_000
    )


def test_session_rejects_oversized_content_length_before_json_parsing() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500)

    oversized_body = b"private-body-sentinel" + b"x" * SESSION_BODY_MAX_BYTES
    with client_with_transport(handler) as client:
        response = client.post(
            "/session",
            content=oversized_body,
            headers={"Content-Type": "application/json"},
        )

    assert response.status_code == 413
    assert response.json() == {
        "detail": {
            "code": "request_too_large",
            "message": f"Request body exceeds {SESSION_BODY_MAX_BYTES} bytes.",
        }
    }
    assert response.headers["cache-control"] == "no-store"
    assert "private-body-sentinel" not in response.text
    assert called is False


def test_session_rejects_oversized_chunked_body_before_downstream() -> None:
    downstream_completed = False
    sent_messages: list[dict[str, object]] = []
    request_messages: list[dict[str, object]] = [
        {
            "type": "http.request",
            "body": b"a" * 3_000,
            "more_body": True,
        },
        {
            "type": "http.request",
            "body": b"b" * 2_000,
            "more_body": False,
        },
    ]

    async def downstream(scope: object, receive: Callable, send: Callable) -> None:
        nonlocal downstream_completed
        while True:
            message = await receive()
            if not message.get("more_body", False):
                break
        downstream_completed = True
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def exercise_middleware() -> None:
        messages = iter(request_messages)

        async def receive() -> dict[str, object]:
            return next(messages)

        async def send(message: dict[str, object]) -> None:
            sent_messages.append(message)

        middleware = SessionBodyLimitMiddleware(downstream)
        await middleware(
            {
                "type": "http",
                "method": "POST",
                "path": "/session",
                "headers": [(b"transfer-encoding", b"chunked")],
            },
            receive,
            send,
        )

    asyncio.run(exercise_middleware())

    start = next(message for message in sent_messages if message["type"] == "http.response.start")
    body = next(message for message in sent_messages if message["type"] == "http.response.body")
    assert start["status"] == 413
    assert json.loads(body["body"]) == {
        "detail": {
            "code": "request_too_large",
            "message": f"Request body exceeds {SESSION_BODY_MAX_BYTES} bytes.",
        }
    }
    assert downstream_completed is False
