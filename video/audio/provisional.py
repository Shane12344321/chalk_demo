"""Provisional voices with macOS `say` so the edit can be built before the
ElevenLabs pass. Same manifest format as eleven.py (word timings estimated)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "video" / "remotion" / "public" / "audio"
VOICES = {"narrator": ("Daniel", 180), "tutor": ("Samantha", 185), "student": ("Fred", 190)}


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                          str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def main() -> None:
    script = json.loads((ROOT / "video" / "audio" / "script.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for line in script["lines"]:
        voice, rate = VOICES[line["role"]]
        aiff = OUT / f"{line['id']}.aiff"
        mp3 = OUT / f"{line['id']}.mp3"
        subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", str(aiff), line["text"]], check=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(aiff), "-ar", "44100", "-b:a", "192k",
                        str(mp3)], check=True)
        aiff.unlink()
        d = duration(mp3)
        tokens = line["text"].split()
        weights = [len(t) + 2 for t in tokens]
        total, acc, words = sum(weights), 0.0, []
        for tok, w in zip(tokens, weights):
            s = d * 0.96 * acc / total
            acc += w
            words.append({"w": tok, "s": round(s, 3), "e": round(d * 0.96 * acc / total, 3)})
        manifest[line["id"]] = {"file": f"audio/{mp3.name}", "duration": d, "role": line["role"],
                                "text": line["text"], "words": words, "provisional": True}
        print(f"{line['id']}: {d:.2f}s")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
