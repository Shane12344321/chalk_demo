"""Generate the demo's voices, sound effects and music with ElevenLabs.

Reads ELEVENLABS_API_KEY from the repo's .env (never printed). Writes into
video/remotion/public/audio/ plus a manifest with durations and word timings.

Usage: python3 video/audio/eleven.py [--only id1,id2] [--skip-music]
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "video" / "remotion" / "public" / "audio"
API = "https://api.elevenlabs.io"


def api_key() -> str:
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("ELEVENLABS_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")
            if key:
                return key
    sys.exit("ELEVENLABS_API_KEY is missing from .env")


KEY = api_key()


def call(method: str, path: str, body: dict | None = None, accept: str = "application/json") -> bytes:
    req = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"xi-api-key": KEY, "Content-Type": "application/json", "Accept": accept},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {detail}") from None


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def resolve_voices(spec: dict) -> dict:
    try:
        listing = json.loads(call("GET", "/v1/voices"))["voices"]
    except RuntimeError as exc:
        print("voice listing failed, using fallbacks:", exc)
        listing = []
    by_name = {v["name"].split(" ")[0].lower(): v["voice_id"] for v in listing}
    resolved = {}
    for role, v in spec.items():
        resolved[role] = by_name.get(v["name"].lower(), v["fallback"])
        print(f"{role}: {v['name']} -> {resolved[role]}")
    return resolved


def words_from_alignment(al: dict) -> list[dict]:
    words, cur, start = [], "", None
    for ch, s, e in zip(al["characters"], al["character_start_times_seconds"],
                        al["character_end_times_seconds"]):
        if ch.isspace():
            if cur and not (cur.startswith("[") and cur.endswith("]")):
                words.append({"w": cur, "s": start, "e": prev_end})
            cur, start = "", None
            continue
        if start is None:
            start = s
        cur += ch
        prev_end = e
    if cur and not (cur.startswith("[") and cur.endswith("]")):
        words.append({"w": cur, "s": start, "e": prev_end})
    return words


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--skip-music", action="store_true")
    ap.add_argument("--model")
    args = ap.parse_args()
    only = set(filter(None, args.only.split(",")))
    script = json.loads((ROOT / "video" / "audio" / "script.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    voices = resolve_voices(script["voices"])
    model = args.model or script.get("model", "eleven_multilingual_v2")
    for line in script["lines"]:
        if only and line["id"] not in only:
            continue
        v = script["voices"][line["role"]]
        body = {
            "text": line["text"],
            "model_id": model,
            "voice_settings": ({"stability": v["stability"], "similarity_boost": v["similarity_boost"]}
                               if model == "eleven_v3" else
                               {"stability": v["stability"], "similarity_boost": v["similarity_boost"],
                                "style": v["style"], "use_speaker_boost": True}),
        }
        res = json.loads(call("POST", f"/v1/text-to-speech/{voices[line['role']]}/with-timestamps"
                                      "?output_format=mp3_44100_128", body))
        path = OUT / f"{line['id']}.mp3"
        path.write_bytes(base64.b64decode(res["audio_base64"]))
        words = words_from_alignment(res.get("normalized_alignment") or res["alignment"])
        manifest[line["id"]] = {"file": f"audio/{path.name}", "duration": duration(path),
                                "role": line["role"], "text": line["text"], "words": words, "model": model}
        print(f"voice {line['id']}: {manifest[line['id']]['duration']:.2f}s")
        manifest_path.write_text(json.dumps(manifest, indent=1))

    for fx in script["sfx"]:
        if only and fx["id"] not in only:
            continue
        audio = call("POST", "/v1/sound-generation?output_format=mp3_44100_128",
                     {"text": fx["text"], "duration_seconds": fx["seconds"], "prompt_influence": 0.6},
                     accept="audio/mpeg")
        path = OUT / f"{fx['id']}.mp3"
        path.write_bytes(audio)
        manifest[fx["id"]] = {"file": f"audio/{path.name}", "duration": duration(path)}
        print(f"sfx {fx['id']}: {manifest[fx['id']]['duration']:.2f}s")
        manifest_path.write_text(json.dumps(manifest, indent=1))

    m = script["music"]
    if not args.skip_music and (not only or m["id"] in only):
        try:
            audio = call("POST", "/v1/music?output_format=mp3_44100_128",
                         {"prompt": m["prompt"], "music_length_ms": int(m["seconds"] * 1000)},
                         accept="audio/mpeg")
            path = OUT / f"{m['id']}.mp3"
            path.write_bytes(audio)
            manifest[m["id"]] = {"file": f"audio/{path.name}", "duration": duration(path)}
            print(f"music: {manifest[m['id']]['duration']:.2f}s")
        except RuntimeError as exc:
            print("music generation failed:", exc)
        manifest_path.write_text(json.dumps(manifest, indent=1))
    print("manifest:", manifest_path)


if __name__ == "__main__":
    main()
