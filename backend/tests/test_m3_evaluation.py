"""Deterministic coverage for the owner-gated M3 evaluation harness."""

import json
from pathlib import Path

import httpx
import pytest

import app.m3_evaluation as evaluation_module
from app.config import Settings
from app.m3_evaluation import (
    TopicResult,
    _validate_preflight,
    _validated_base_url,
    evaluate_topic,
    main,
    run_batch,
    run_smoke,
)

REQUEST_ID_PATTERN = "783c6081-75a4-4ed2-8be7-4e0f32680a2b"


def test_runtime_default_is_owner_selected_while_m3_stays_pinned(monkeypatch) -> None:
    # The runtime default moved to GPT-6.1 Sol on 2026-10-18. The M3 harness keeps
    # its historical Luna/none qualification so old and new evidence never mix.
    monkeypatch.delenv("BOARD_MODEL", raising=False)
    monkeypatch.delenv("BOARD_REASONING_EFFORT", raising=False)
    assert Settings(_env_file=None).board_model == "gpt-6.1-sol"
    assert Settings(_env_file=None).board_reasoning_effort == "low"
    assert evaluation_module.M3_QUALIFICATION_BOARD_MODEL == "gpt-5.6-luna"
    assert evaluation_module.M3_QUALIFICATION_REASONING_EFFORT == "none"


def test_evaluation_retains_validated_raw_ndjson_and_redacted_metrics(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        request_id = json.loads(request.content)["request_id"]
        step = {
            "id": "s1",
            "script": "A short valid explanation.",
            "ops": [{"op": "text", "id": "label", "region": "A1", "content": "Slope"}],
            "checkpoint": None,
        }
        lines = [
            {"type": "lesson.started", "request_id": request_id, "title": "Synthetic topic"},
            {"type": "lesson.step", "request_id": request_id, "step": step},
            {
                "type": "lesson.done",
                "request_id": request_id,
                "accepted_steps": 1,
                "repairs": 0,
                "dropped_steps": 0,
            },
        ]
        return httpx.Response(
            200,
            text="\n".join(json.dumps(line) for line in lines) + "\n",
            headers={
                "Content-Type": "application/x-ndjson",
                "X-Chalk-Board-Model": "gpt-5.6-luna",
                "X-Chalk-Board-Reasoning-Effort": "none",
                "X-Chalk-Board-Prompt-SHA256": "a" * 64,
                "X-Chalk-Repair-Prompt-SHA256": "b" * 64,
            },
        )

    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = evaluate_topic(
            client,
            base_url="http://127.0.0.1:8000",
            client_id=REQUEST_ID_PATTERN,
            key="derivative",
            topic="Derivative as slope at a point",
            raw_dir=raw_dir,
        )

    assert result.status == "complete"
    assert result.accepted_steps == 1
    assert result.first_valid_step_ms is not None
    assert result.board_model == "gpt-5.6-luna"
    assert result.board_reasoning_effort == "none"
    assert result.evidence()["human_reviewer_note"] is None
    retained = (raw_dir / "derivative.ndjson").read_text(encoding="utf-8")
    assert "lesson.step" in retained
    assert "authorization" not in retained.lower()


def test_evaluation_retains_only_the_allowlisted_terminal_reason(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        request_id = json.loads(request.content)["request_id"]
        lines = [
            {"type": "lesson.started", "request_id": request_id, "title": "Synthetic topic"},
            {
                "type": "lesson.step",
                "request_id": request_id,
                "step": {
                    "id": "s1",
                    "script": "A short valid explanation.",
                    "ops": [{"op": "text", "id": "label", "region": "A1", "content": "Slope"}],
                    "checkpoint": None,
                },
            },
            {
                "type": "lesson.error",
                "request_id": request_id,
                "code": "upstream_incomplete",
                "upstream_reason": "max_output_tokens",
                "failure_origin": "repair",
                "repair_attempts": 2,
                "fallback_available": True,
            },
        ]
        return httpx.Response(
            200,
            text="\n".join(json.dumps(line) for line in lines) + "\n",
            headers={
                "Content-Type": "application/x-ndjson",
                "X-Chalk-Board-Model": "gpt-5.6-luna",
                "X-Chalk-Board-Reasoning-Effort": "none",
                "X-Chalk-Board-Prompt-SHA256": "a" * 64,
                "X-Chalk-Repair-Prompt-SHA256": "b" * 64,
            },
        )

    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = evaluate_topic(
            client,
            base_url="http://127.0.0.1:8000",
            client_id=REQUEST_ID_PATTERN,
            key="derivative",
            topic="Derivative as slope at a point",
            raw_dir=raw_dir,
        )

    assert result.status == "error"
    assert result.terminal_error == "upstream_incomplete"
    assert result.terminal_reason == "max_output_tokens"
    assert result.failure_origin == "repair"
    assert result.repairs == 2
    assert result.evidence()["terminal_reason"] == "max_output_tokens"
    assert result.evidence()["failure_origin"] == "repair"


@pytest.mark.parametrize(
    "value",
    [
        "https://127.0.0.1:8000",
        "http://example.com",
        "http://user:password@localhost:8000",
        "http://localhost:8000/path",
    ],
)
def test_evaluation_rejects_nonlocal_or_credentialed_endpoints(value: str) -> None:
    with pytest.raises(ValueError):
        _validated_base_url(value)


def test_batch_stops_after_first_unexpected_model(monkeypatch, tmp_path: Path) -> None:
    calls = 0

    def unexpected_model(*_args, **_kwargs) -> TopicResult:
        nonlocal calls
        calls += 1
        return TopicResult(
            key="derivative",
            status="complete",
            first_valid_step_ms=100.0,
            terminal_ms=200.0,
            accepted_steps=1,
            repairs=0,
            dropped_steps=0,
            terminal_error=None,
            raw_ndjson_file="raw/derivative.ndjson",
            board_model="gpt-5.6-terra",
            board_reasoning_effort="none",
            board_prompt_sha256="a" * 64,
            repair_prompt_sha256="b" * 64,
        )

    monkeypatch.setattr(evaluation_module, "evaluate_topic", unexpected_model)
    monkeypatch.setattr(evaluation_module, "_validate_preflight", lambda *_args: None)
    summary, stopped_early = run_batch("http://127.0.0.1:8000", tmp_path / "unexpected-model")

    assert calls == 1
    assert stopped_early is True
    assert summary["attempted_topics"] == 1
    assert summary["expected_board_model"] == "gpt-5.6-luna"
    assert summary["expected_reasoning_effort"] == "none"
    assert summary["board_models"] == ["gpt-5.6-terra"]
    assert summary["board_reasoning_efforts"] == ["none"]


@pytest.mark.parametrize("terminal_reason", ["max_output_tokens", "content_filter"])
def test_batch_continues_only_for_topic_scoped_reason_without_retrying_topic(
    monkeypatch,
    tmp_path: Path,
    terminal_reason: str,
) -> None:
    calls: list[str] = []

    def topic_result(*_args, **kwargs) -> TopicResult:
        key = kwargs["key"]
        calls.append(key)
        failed = len(calls) == 1
        return TopicResult(
            key=key,
            status="error" if failed else "complete",
            first_valid_step_ms=100.0,
            terminal_ms=200.0,
            accepted_steps=1,
            repairs=0,
            dropped_steps=0,
            terminal_error="upstream_incomplete" if failed else None,
            terminal_reason=terminal_reason if failed else None,
            raw_ndjson_file=f"raw/{key}.ndjson",
            board_model="gpt-5.6-luna",
            board_reasoning_effort="none",
            board_prompt_sha256="a" * 64,
            repair_prompt_sha256="b" * 64,
        )

    monkeypatch.setattr(evaluation_module, "evaluate_topic", topic_result)
    monkeypatch.setattr(evaluation_module, "_validate_preflight", lambda *_args: None)
    summary, stopped_early = run_batch(
        "http://127.0.0.1:8000", tmp_path / f"continue-{terminal_reason}"
    )

    assert calls == [key for key, _topic in evaluation_module.TOPICS]
    assert calls.count("derivative") == 1
    assert stopped_early is False
    assert summary["attempted_topics"] == 10
    assert summary["stop_reason"] is None
    assert summary["topics"][0]["terminal_error"] == "upstream_incomplete"
    assert summary["topics"][0]["terminal_reason"] == terminal_reason


@pytest.mark.parametrize(
    "terminal_reason",
    [
        "authentication",
        "permission",
        "rate_limit",
        "invalid_request",
        "server_error",
        "unknown",
        None,
    ],
)
def test_batch_stops_on_non_topic_scoped_upstream_reason(
    monkeypatch,
    tmp_path: Path,
    terminal_reason: str | None,
) -> None:
    calls = 0

    def access_failure(*_args, **kwargs) -> TopicResult:
        nonlocal calls
        calls += 1
        return TopicResult(
            key=kwargs["key"],
            status="error",
            first_valid_step_ms=None,
            terminal_ms=100.0,
            accepted_steps=0,
            repairs=0,
            dropped_steps=0,
            terminal_error="upstream_failed",
            terminal_reason=terminal_reason,
            raw_ndjson_file="raw/derivative.ndjson",
            board_model="gpt-5.6-luna",
            board_reasoning_effort="none",
            board_prompt_sha256="a" * 64,
            repair_prompt_sha256="b" * 64,
        )

    monkeypatch.setattr(evaluation_module, "evaluate_topic", access_failure)
    monkeypatch.setattr(evaluation_module, "_validate_preflight", lambda *_args: None)
    output_name = terminal_reason or "missing"
    summary, stopped_early = run_batch("http://127.0.0.1:8000", tmp_path / f"stop-{output_name}")

    assert calls == 1
    assert stopped_early is True
    assert summary["attempted_topics"] == 1
    assert summary["stop_reason"] == f"upstream_reason:{terminal_reason or 'missing'}"


@pytest.mark.parametrize(
    ("terminal_error", "terminal_reason"),
    [
        ("upstream_incomplete", "max_output_tokens"),
        ("upstream_error", "content_filter"),
        ("invalid_stream", None),
        ("generation_timeout", None),
        ("no_valid_steps", None),
    ],
)
def test_batch_stops_when_third_machine_failure_makes_gate_unreachable(
    monkeypatch,
    tmp_path: Path,
    terminal_error: str,
    terminal_reason: str | None,
) -> None:
    calls: list[str] = []

    def failed_topic(*_args, **kwargs) -> TopicResult:
        key = kwargs["key"]
        calls.append(key)
        return TopicResult(
            key=key,
            status="error",
            first_valid_step_ms=100.0,
            terminal_ms=200.0,
            accepted_steps=1,
            repairs=0,
            dropped_steps=0,
            terminal_error=terminal_error,
            terminal_reason=terminal_reason,
            raw_ndjson_file=f"raw/{key}.ndjson",
            board_model="gpt-5.6-luna",
            board_reasoning_effort="none",
            board_prompt_sha256="a" * 64,
            repair_prompt_sha256="b" * 64,
        )

    monkeypatch.setattr(evaluation_module, "evaluate_topic", failed_topic)
    monkeypatch.setattr(evaluation_module, "_validate_preflight", lambda *_args: None)
    summary, stopped_early = run_batch(
        "http://127.0.0.1:8000",
        tmp_path / f"gate-{terminal_error}-{terminal_reason or 'none'}",
    )

    assert calls == [key for key, _topic in evaluation_module.TOPICS[:3]]
    assert stopped_early is True
    assert summary["attempted_topics"] == 3
    assert summary["machine_complete_topics"] == 0
    assert summary["stop_reason"] == "gate_unreachable:3_machine_failures"


def test_batch_writes_redacted_summary_when_harness_raises(monkeypatch, tmp_path: Path) -> None:
    private_message = "private-harness-message"

    def broken_topic(*_args, **kwargs) -> TopicResult:
        raw_path = kwargs["raw_dir"] / f"{kwargs['key']}.ndjson"
        envelopes = [
            {
                "type": "lesson.started",
                "request_id": REQUEST_ID_PATTERN,
                "title": "Synthetic topic",
            },
            {
                "type": "lesson.step",
                "request_id": REQUEST_ID_PATTERN,
                "step": {
                    "id": "s1",
                    "script": "A short valid explanation.",
                    "ops": [{"op": "text", "id": "label", "region": "A1", "content": "Slope"}],
                    "checkpoint": None,
                },
            },
        ]
        raw_path.write_text(
            "\n".join(json.dumps(envelope) for envelope in envelopes) + "\n",
            encoding="utf-8",
        )
        raise ValueError(private_message)

    monkeypatch.setattr(evaluation_module, "evaluate_topic", broken_topic)
    monkeypatch.setattr(evaluation_module, "_validate_preflight", lambda *_args: None)
    output_dir = tmp_path / "harness-error"
    summary, stopped_early = run_batch("http://127.0.0.1:8000", output_dir)

    retained = (output_dir / "summary.json").read_text(encoding="utf-8")
    assert stopped_early is True
    assert summary["attempted_topics"] == 1
    assert summary["stop_reason"] == "harness_error:invalid_protocol"
    assert summary["topics"][0]["status"] == "harness_error"
    assert summary["topics"][0]["harness_error"] == "invalid_protocol"
    assert summary["topics"][0]["accepted_steps"] == 1
    assert private_message not in retained


@pytest.mark.parametrize(
    ("board", "message"),
    [
        ({"configured": False, "model": "gpt-5.6-luna"}, "no configured board model"),
        ({"configured": True, "model": "gpt-5.6-terra"}, "restart with BOARD_MODEL"),
        (
            {"configured": True, "model": "gpt-5.6-luna", "reasoning_effort": "low"},
            "restart with BOARD_REASONING_EFFORT",
        ),
    ],
)
def test_preflight_rejects_before_lesson_spend(board: dict[str, object], message: str) -> None:
    lesson_called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal lesson_called
        if request.url.path == "/health":
            return httpx.Response(200, json={"board": board})
        lesson_called = True
        return httpx.Response(500)

    with (
        httpx.Client(transport=httpx.MockTransport(handler)) as client,
        pytest.raises(ValueError, match=message),
    ):
        _validate_preflight(client, "http://127.0.0.1:8000")

    assert lesson_called is False


def test_preflight_accepts_exact_luna_reasoning_configuration() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/health"
        return httpx.Response(
            200,
            json={
                "board": {
                    "configured": True,
                    "model": "gpt-5.6-luna",
                    "reasoning_effort": "none",
                }
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        _validate_preflight(client, "http://127.0.0.1:8000")


def test_smoke_is_structurally_limited_to_one_lesson_call(monkeypatch, tmp_path: Path) -> None:
    calls: list[str] = []

    def one_result(*_args, **kwargs) -> TopicResult:
        calls.append(kwargs["key"])
        return TopicResult(
            key=kwargs["key"],
            status="complete",
            first_valid_step_ms=100.0,
            terminal_ms=200.0,
            accepted_steps=2,
            repairs=0,
            dropped_steps=0,
            terminal_error=None,
            raw_ndjson_file="raw/projectile-smoke.ndjson",
            board_model="gpt-5.6-luna",
            board_reasoning_effort="none",
            board_prompt_sha256="a" * 64,
            repair_prompt_sha256="b" * 64,
        )

    monkeypatch.setattr(evaluation_module, "_validate_preflight", lambda *_args: None)
    monkeypatch.setattr(evaluation_module, "evaluate_topic", one_result)
    output_dir = tmp_path / "smoke"
    summary, passed = run_smoke("http://127.0.0.1:8000", output_dir)

    assert calls == ["projectile-smoke"]
    assert passed is True
    assert summary["schema"] == "chalk.m3-live-smoke.v2"
    assert summary["execution"] == "one_topic_no_retry"
    assert summary["expected_topics"] == 1
    assert summary["attempted_topics"] == 1
    assert summary["smoke_pass"] is True
    assert json.loads((output_dir / "summary.json").read_text(encoding="utf-8")) == summary


@pytest.mark.parametrize("mode", ["repair-smoke", "smoke", "batch"])
def test_cli_refuses_each_live_mode_without_separate_approval(
    monkeypatch, tmp_path: Path, mode: str
) -> None:
    called = False

    def forbidden(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("live runner must not be called")

    monkeypatch.setattr(evaluation_module, "run_smoke", forbidden)
    monkeypatch.setattr(evaluation_module, "run_repair_smoke", forbidden)
    monkeypatch.setattr(evaluation_module, "run_batch", forbidden)

    with pytest.raises(SystemExit) as captured:
        main([mode, "--output-dir", str(tmp_path / mode)])

    assert captured.value.code == 2
    assert called is False


def test_repair_smoke_is_structurally_one_call_and_retains_no_content(
    monkeypatch, tmp_path: Path
) -> None:
    calls = 0

    async def repaired(_settings) -> str:
        nonlocal calls
        calls += 1
        return json.dumps(
            {
                "id": "probe_step",
                "script": "Show one short label for a unit circle.",
                "ops": [
                    {
                        "op": "text",
                        "id": "probe_label",
                        "region": "A1",
                        "content": "Unit circle",
                    }
                ],
                "checkpoint": None,
            }
        )

    monkeypatch.setattr(evaluation_module, "_run_repair_probe", repaired)
    monkeypatch.setattr(evaluation_module, "_prompt_sha256", lambda _name: "a" * 64)
    test_settings = evaluation_module.Settings(
        _env_file=None,
        openai_api_key="test-api-key",
        board_model=evaluation_module.M3_QUALIFICATION_BOARD_MODEL,
        board_reasoning_effort=evaluation_module.M3_QUALIFICATION_REASONING_EFFORT,
    )
    monkeypatch.setattr(evaluation_module, "Settings", lambda: test_settings)
    output_dir = tmp_path / "repair-smoke"
    summary, passed = evaluation_module.run_repair_smoke(output_dir)

    assert calls == 1
    assert passed is True
    assert summary["schema"] == "chalk.m3-repair-smoke.v1"
    assert summary["execution"] == "one_repair_call_no_retry"
    assert summary["attempted_repair_calls"] == 1
    assert summary["repair_pass"] is True
    serialized = (output_dir / "summary.json").read_text(encoding="utf-8")
    assert "Unit circle" not in serialized
    assert "repair-probe" not in serialized


def test_approved_repair_smoke_cli_cannot_route_to_other_modes(monkeypatch, tmp_path: Path) -> None:
    calls: list[str] = []
    output_dir = tmp_path / "repair-smoke"

    def repair_runner(received_output_dir: Path):
        calls.append("repair-smoke")
        assert received_output_dir == output_dir
        return {"attempted_repair_calls": 1}, True

    def forbidden(*_args, **_kwargs):
        raise AssertionError("repair-smoke approval must not route to another mode")

    monkeypatch.setattr(evaluation_module, "run_repair_smoke", repair_runner)
    monkeypatch.setattr(evaluation_module, "run_smoke", forbidden)
    monkeypatch.setattr(evaluation_module, "run_batch", forbidden)

    exit_code = main(["repair-smoke", "--approved-by-owner", "--output-dir", str(output_dir)])

    assert exit_code == 0
    assert calls == ["repair-smoke"]


def test_approved_smoke_cli_cannot_route_to_batch(monkeypatch, tmp_path: Path) -> None:
    calls: list[str] = []
    output_dir = tmp_path / "smoke"

    def smoke_runner(base_url: str, received_output_dir: Path):
        calls.append("smoke")
        assert base_url == "http://127.0.0.1:8000"
        assert received_output_dir == output_dir
        return {"attempted_topics": 1}, True

    def batch_runner(*_args, **_kwargs):
        calls.append("batch")
        raise AssertionError("smoke approval must never route to batch")

    monkeypatch.setattr(evaluation_module, "run_smoke", smoke_runner)
    monkeypatch.setattr(evaluation_module, "run_batch", batch_runner)

    exit_code = main(["smoke", "--approved-by-owner", "--output-dir", str(output_dir)])

    assert exit_code == 0
    assert calls == ["smoke"]


def test_approved_batch_cli_reports_machine_outcome(monkeypatch, tmp_path: Path, capsys) -> None:
    output_dir = tmp_path / "batch"

    def batch_runner(base_url: str, received_output_dir: Path):
        assert base_url == "http://127.0.0.1:8000"
        assert received_output_dir == output_dir
        return {
            "attempted_topics": 3,
            "machine_complete_topics": 0,
            "stop_reason": "gate_unreachable:3_machine_failures",
        }, True

    monkeypatch.setattr(evaluation_module, "run_batch", batch_runner)
    exit_code = main(["batch", "--approved-by-owner", "--output-dir", str(output_dir)])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 2
    assert output["machine_complete_topics"] == 0
    assert output["stop_reason"] == "gate_unreachable:3_machine_failures"
