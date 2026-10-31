"""Owner-gated drawing-suite batch for the general-drawing plan (Phase 5).

One `POST /lesson` per topic of `tests/eval/drawing-suite-v1.json` against a
running local backend, with no retries. Each topic is one primary board-model
call plus at most four server-side repair calls. The batch stops before
starting further topics on HTTP rejection, transport failure, a missing
configuration, or an upstream rejection/outage. Never imported by the web
application and never run in CI.

Retained per run directory: `<id>.ndjson` (server-validated stream),
`generation.jsonl` (counters and timings), and `run.json` (model, prompt hash,
suite hash). Token usage is logged by the backend (`lesson_generation_usage`)
and joined later by request ID.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import threading
import time
import uuid
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from app.lesson_validation import validate_envelope

STOP_ERROR_CODES = {"not_configured", "upstream_rejected", "upstream_unavailable"}
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SUITE = REPO_ROOT / "tests/eval/drawing-suite-v1.json"


def load_suite(path: Path) -> tuple[list[dict[str, Any]], str]:
    raw = path.read_bytes()
    suite = json.loads(raw)
    topics = suite["topics"]
    ids = [topic["id"] for topic in topics]
    if len(ids) != len(set(ids)):
        raise ValueError("suite topic IDs must be unique")
    for topic in topics:
        if not 2 <= len(topic["topic"]) <= 80:
            raise ValueError(f"suite topic {topic['id']} exceeds the request topic bounds")
    return topics, hashlib.sha256(raw).hexdigest()


def run_topic(
    client: httpx.Client,
    base_url: str,
    client_id: str,
    topic: dict[str, Any],
    out: Path,
) -> dict[str, Any]:
    """One request, no retry; retains the server-owned NDJSON."""

    request_id = str(uuid.uuid4())
    started = time.perf_counter()
    result: dict[str, Any] = {
        "key": topic["id"],
        "category": topic["category"],
        "request_id": request_id,
        "status": None,
        "first_s": None,
        "total_s": None,
        "terminal": None,
        "steps": 0,
        "repairs": 0,
        "dropped": 0,
        "code": None,
        "upstream_reason": None,
        "ops": "",
    }
    op_summary: list[str] = []
    try:
        with client.stream(
            "POST",
            f"{base_url}/lesson",
            json={
                "request_id": request_id,
                "client_id": client_id,
                "topic": topic["topic"],
                "student_context": "",
                "board_state": "",
            },
            headers={"Content-Type": "application/json"},
        ) as response:
            result["status"] = response.status_code
            result["board_model"] = response.headers.get("x-chalk-board-model")
            result["board_prompt_sha256"] = response.headers.get("x-chalk-board-prompt-sha256")
            if response.status_code != 200:
                result["terminal"] = "http_rejected"
                return result
            with (out / f"{topic['id']}.ndjson").open("x", encoding="utf-8") as raw_file:
                for line in response.iter_lines():
                    if not line.strip():
                        continue
                    raw_file.write(line + "\n")
                    envelope = json.loads(line)
                    validate_envelope(envelope)
                    if envelope["request_id"] != request_id:
                        raise ValueError("lesson response request ID mismatch")
                    kind = envelope["type"]
                    if kind == "lesson.step":
                        result["steps"] += 1
                        if result["first_s"] is None:
                            result["first_s"] = round(time.perf_counter() - started, 1)
                        op_summary.append("+".join(op["op"] for op in envelope["step"]["ops"]))
                    elif kind == "lesson.done":
                        result["terminal"] = "lesson.done"
                        result["repairs"] = envelope["repairs"]
                        result["dropped"] = envelope["dropped_steps"]
                    elif kind == "lesson.error":
                        result["terminal"] = "lesson.error"
                        result["code"] = envelope["code"]
                        result["upstream_reason"] = envelope.get("upstream_reason")
                        result["repairs"] = envelope.get("repair_attempts", 0)
    except httpx.TransportError:
        result["terminal"] = "transport_unavailable"
    result["total_s"] = round(time.perf_counter() - started, 1)
    result["ops"] = " | ".join(op_summary)
    return result


def should_stop(result: dict[str, Any]) -> bool:
    return (
        result["terminal"] in {"http_rejected", "transport_unavailable", None}
        or result["code"] in STOP_ERROR_CODES
    )


def run(args: argparse.Namespace) -> int:
    topics, suite_sha = load_suite(args.suite)
    if args.only:
        wanted = set(args.only.split(","))
        topics = [topic for topic in topics if topic["id"] in wanted]
    out: Path = args.output
    out.mkdir(parents=True, exist_ok=args.append)
    previous = json.loads((out / "run.json").read_text()) if (out / "run.json").exists() else None
    done = (
        {
            json.loads(line)["key"]
            for line in (out / "generation.jsonl").read_text().splitlines()
            if line.strip()
        }
        if (out / "generation.jsonl").exists()
        else set()
    )
    if done & {topic["id"] for topic in topics}:
        raise SystemExit("some topics already ran in this directory; never re-run a topic")
    base_url = args.base_url.rstrip("/")
    client_id = str(uuid.uuid4())
    stop = threading.Event()
    lock = threading.Lock()
    results: list[dict[str, Any]] = []

    with httpx.Client(timeout=httpx.Timeout(120.0, connect=5.0)) as client:
        health = client.get(f"{base_url}/health").json()
        board = health.get("board") if isinstance(health, dict) else None
        if not isinstance(board, dict) or board.get("configured") is not True:
            raise SystemExit("backend has no configured board model")
        run_info = {
            "schema": "chalk.drawing-suite-run.v1",
            "label": args.label,
            "started_at": datetime.now(UTC).isoformat(),
            "suite_sha256": suite_sha,
            "board_model": board.get("model"),
            "board_reasoning_effort": board.get("reasoning_effort"),
            "topics": [topic["id"] for topic in topics],
            "concurrency": args.concurrency,
        }

        def task(topic: dict[str, Any]) -> None:
            if stop.is_set():
                return
            result = run_topic(client, base_url, client_id, topic, out)
            with lock:
                results.append(result)
                with (out / "generation.jsonl").open("a", encoding="utf-8") as summary:
                    summary.write(json.dumps(result) + "\n")
                print(
                    f"{result['key']:<22} {result['terminal']!s:<16} "
                    f"steps={result['steps']} repairs={result['repairs']} "
                    f"first={result['first_s']}s total={result['total_s']}s",
                    flush=True,
                )
                if should_stop(result):
                    stop.set()

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            list(pool.map(task, topics))

    run_info["finished_at"] = datetime.now(UTC).isoformat()
    run_info["completed"] = sum(1 for result in results if result["terminal"] == "lesson.done")
    run_info["attempted"] = len(results)
    run_info["stopped_early"] = stop.is_set()
    hashes = [result.get("board_prompt_sha256") for result in results]
    run_info["board_prompt_sha256"] = next((value for value in hashes if value), None)
    invocations = (previous or {}).get("invocations", [previous] if previous else [])
    record = {"schema": run_info["schema"], "invocations": [*invocations, run_info]}
    (out / "run.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: run_info[k] for k in ("attempted", "completed", "stopped_early")}))
    return 1 if stop.is_set() else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    command = subparsers.add_parser("run", help="run the suite once against a local backend")
    command.add_argument("--approved-by-owner", action="store_true", required=True)
    command.add_argument("--suite", type=Path, default=DEFAULT_SUITE)
    command.add_argument("--output", type=Path, required=True)
    command.add_argument("--label", required=True)
    command.add_argument("--base-url", default="http://127.0.0.1:8000")
    command.add_argument("--concurrency", type=int, choices=[1, 2], default=2)
    command.add_argument("--only", default="")
    command.add_argument(
        "--append",
        action="store_true",
        help="add topics that have not run yet to an existing run directory",
    )
    args = parser.parse_args(argv)
    if not args.approved_by_owner:
        raise SystemExit("owner approval is required for paid calls")
    if urlhost(args.base_url) not in {"127.0.0.1", "localhost"}:
        raise SystemExit("the suite only runs against a local backend")
    return run(args)


def urlhost(url: str) -> str:
    return httpx.URL(url).host


if __name__ == "__main__":
    raise SystemExit(main())
