"""Tighten long pauses in the generated voice clips without touching the speech.

Silences longer than MAX_GAP are shortened to MAX_GAP by removing their middle,
leading/trailing silence is trimmed, and the manifest's word timings and
durations are shifted to match. Originals are kept in audio/raw/.

Usage: python3 video/audio/tighten.py [--max-gap 0.3]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
AUDIO = ROOT / "video" / "remotion" / "public" / "audio"
SR = 44100


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ac", "1",
                          "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def encode(x: np.ndarray, path: Path) -> None:
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                    "-b:a", "192k", str(path)], input=x.astype(np.float32).tobytes(), check=True)


def silent_runs(x: np.ndarray, thresh_db: float = -40, min_len: float = 0.12) -> list[tuple[int, int]]:
    win = int(0.01 * SR)
    n = len(x) // win
    rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    quiet = 20 * np.log10(rms) < thresh_db
    runs, start = [], None
    for i, q in enumerate(quiet):
        if q and start is None:
            start = i
        if not q and start is not None:
            runs.append((start * win, i * win))
            start = None
    if start is not None:
        runs.append((start * win, n * win))
    return [(a, b) for a, b in runs if (b - a) / SR >= min_len]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-gap", type=float, default=0.3)
    ap.add_argument("--lead", type=float, default=0.04)
    ap.add_argument("--tail", type=float, default=0.12)
    args = ap.parse_args()
    manifest = json.loads((AUDIO / "manifest.json").read_text())
    raw_dir = AUDIO / "raw"
    raw_dir.mkdir(exist_ok=True)
    for key, entry in manifest.items():
        if "words" not in entry:
            continue
        src = AUDIO / Path(entry["file"]).name
        keep = raw_dir / src.name
        if not keep.exists() or keep.stat().st_mtime < src.stat().st_mtime:
            shutil.copy2(src, keep)
        x = decode(keep)
        cuts: list[tuple[int, int]] = []  # sample ranges to delete
        for a, b in silent_runs(x):
            if a == 0:
                cuts.append((0, max(0, b - int(args.lead * SR))))
            elif b >= len(x) - int(0.011 * SR):
                cuts.append((min(len(x), a + int(args.tail * SR)), len(x)))
            elif (b - a) / SR > args.max_gap:
                excess = (b - a) - int(args.max_gap * SR)
                mid = (a + b) // 2
                cuts.append((mid - excess // 2, mid - excess // 2 + excess))
        keep_mask = np.ones(len(x), dtype=bool)
        for a, b in cuts:
            keep_mask[a:b] = False
        y = x[keep_mask]
        # crossfade-free cuts land in silence, so only a tiny fade at the ends
        f = int(0.004 * SR)
        y[:f] *= np.linspace(0, 1, f)
        y[-f:] *= np.linspace(1, 0, f)

        def shift(t: float) -> float:
            s = int(t * SR)
            removed = sum(min(b, s) - a for a, b in cuts if a < s)
            return max(0.0, (s - removed) / SR)

        for w in entry["words"]:
            w["s"] = round(shift(w["s"]), 3)
            w["e"] = round(shift(w["e"]), 3)
        encode(y, src)
        before = len(x) / SR
        entry["duration"] = len(y) / SR
        print(f"{key:9} {before:5.2f}s -> {entry['duration']:5.2f}s")
    (AUDIO / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
