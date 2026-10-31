"""Compose the demo's score in code, arranged to the edit's cue points.

Felt-piano motif and pads under the opener, a warm plucked groove once the app
appears, a drop to suspended pads while the student interrupts, the groove
back on resume, a lift for the montage, and a resolved final chord.

Usage: python3 video/audio/music.py  ->  video/remotion/public/audio/music_bed.wav
"""

from __future__ import annotations

import json
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "video" / "remotion" / "public"
SR = 44100
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(11)

edit = json.loads((PUBLIC / "edit.json").read_text())
TOTAL = edit["duration"] + 0.5
shots = edit["shots"]
app0 = shots["app"][0]
FREEZE = app0 + edit["app"]["freezeAt"]
RESUME = app0 + edit["app"]["resumeAt"]
GROOVE_IN = app0 + edit["app"]["arriveAt"]
MONTAGE = shots["montage"][0]
HOW = shots["how"][0]
END = shots["end"][0]

N = int(TOTAL * SR)
L = np.zeros(N)
R = np.zeros(N)


def midi(n: float) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)


def add(sig: np.ndarray, t0: float, pan: float = 0.0, gain: float = 1.0) -> None:
    i = int(t0 * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    lg, rg = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * lg
    R[i:i + len(sig)] += sig * rg


def env(n: int, a: float, d: float, s: float, r: float, hold: float) -> np.ndarray:
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), 1.0)
    dec = np.clip((t - a) / max(d, 1e-4), 0, 1)
    e = np.where(t >= a, 1 - (1 - s) * dec, e)
    rel = np.clip((t - hold) / max(r, 1e-4), 0, 1)
    return e * (1 - rel)


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def lp_fast(x: np.ndarray, cutoff: float, passes: int = 2) -> np.ndarray:
    # FFT brick-ish lowpass with a soft knee; fast for long buffers
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / (1 + (f / cutoff) ** (2 * passes))
    return np.fft.irfft(X, len(x))


def hp_fast(x: np.ndarray, cutoff: float) -> np.ndarray:
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 - 1 / (1 + (f / cutoff) ** 4)
    return np.fft.irfft(X, len(x))


def saw(freq: float, n: int, detune: float = 0.0) -> np.ndarray:
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in (-1, 0, 1):
        f = freq * (1 + k * detune)
        ph = (t * f + rng.random()) % 1.0
        out += 2 * ph - 1
    return out / 3


def piano(note: float, dur: float, vel: float = 1.0) -> np.ndarray:
    n = int((dur + 2.5) * SR)
    t = np.arange(n) / SR
    f = midi(note)
    sig = np.zeros(n)
    for h, amp in ((1, 1.0), (2, 0.42), (3, 0.18), (4, 0.09), (5, 0.04)):
        inh = 1 + 0.0004 * h * h
        sig += amp * np.sin(2 * np.pi * f * h * inh * t) * np.exp(-t * (1.6 + 0.9 * h))
    hammer = np.exp(-t * 60) * rng.normal(0, 0.15, n)
    e = np.minimum(1, t / 0.004) * np.where(t > dur, np.exp(-(t - dur) * 6), 1)
    return lp_fast((sig + hammer) * e * vel, 2600) * 0.32


def pad(notes: list[float], dur: float, bright: float = 1400) -> np.ndarray:
    n = int((dur + 2.0) * SR)
    sig = sum(saw(midi(x), n, 0.006) for x in notes) / len(notes)
    sig = lp_fast(sig, bright)
    return sig * env(n, 1.2, 0.5, 0.85, 1.8, dur) * 0.22


def pluck(note: float, vel: float = 1.0) -> np.ndarray:
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    sig = saw(midi(note), n, 0.003)
    # filter envelope approximated by mixing bright and dark copies
    bright = lp_fast(sig, 3800)
    dark = lp_fast(sig, 700)
    mixk = np.exp(-t * 14)
    out = (bright * mixk + dark * (1 - mixk)) * np.exp(-t * 6.5) * np.minimum(1, t / 0.002)
    return out * 0.16 * vel


def sub(note: float, dur: float) -> np.ndarray:
    n = int((dur + 0.2) * SR)
    t = np.arange(n) / SR
    sig = np.sin(2 * np.pi * midi(note) * t) + 0.25 * np.sin(4 * np.pi * midi(note) * t)
    return sig * env(n, 0.01, 0.2, 0.8, 0.15, dur) * 0.30


def kick() -> np.ndarray:
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 48 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) * np.exp(-t * 7.5) + 0.3 * np.exp(-t * 300) * rng.normal(0, 1, n)) * 0.75


def snare() -> np.ndarray:
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    noise = hp_fast(rng.normal(0, 1, n), 1500) * np.exp(-t * 18)
    return (body * 0.5 + noise * 0.55) * 0.42


def hat(open_: bool = False) -> np.ndarray:
    n = int((0.25 if open_ else 0.06) * SR)
    t = np.arange(n) / SR
    noise = hp_fast(rng.normal(0, 1, n), 7500)
    return noise * np.exp(-t * (14 if open_ else 70)) * 0.16


def riser(dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    out = np.zeros(n)
    seg = SR // 20
    for i in range(0, n, seg):
        k = i / n
        out[i:i + seg] = hp_fast(noise[i:i + seg], 400 + 6000 * k) if len(noise[i:i + seg]) > 64 else 0
    return out * (t / dur) ** 2 * 0.18


# Fmaj9 - Am7 - Dm9 - Bbmaj9, two bars each? one bar each at 100 bpm
CHORDS = [
    ([53, 57, 60, 64, 67], 41),   # Fmaj9   (bass F2)
    ([52, 57, 60, 64, 67], 45),   # Am7/E   (bass A2)
    ([53, 57, 60, 62, 65], 38),   # Dm9     (bass D2)
    ([50, 55, 58, 62, 65], 46),   # Bbmaj9  (bass Bb2)
]
MOTIF = [72, 69, 67, 69, 72, 74, 72, 67]  # felt piano figure, 8ths over a bar


def chord_at(t: float):
    return CHORDS[int(t // BAR) % 4]


def section(t: float) -> str:
    if t < GROOVE_IN - BAR * 0.5:
        return "intro"
    if FREEZE <= t < RESUME:
        return "freeze"
    if t >= END + 0.5:
        return "outro"
    if MONTAGE <= t < END:
        return "lift"
    return "groove"


# --- pads and piano across the whole piece, bar by bar --------------------
bar = 0
while bar * BAR < TOTAL:
    t0 = bar * BAR
    notes, bass = chord_at(t0)
    sec = section(t0 + 0.01)
    if sec == "outro":
        break
    add(pad(notes, BAR, 900 if sec in ("intro", "freeze") else 1500), t0, gain=1.0 if sec != "freeze" else 1.25)
    add(pad([n + 12 for n in notes[1:4]], BAR, 2200), t0, pan=0.3, gain=0.35)
    if sec in ("intro", "freeze", "lift"):
        for i, m in enumerate(MOTIF):
            tt = t0 + i * BEAT / 2
            if section(tt) in ("intro", "freeze", "lift"):
                add(piano(m - (0 if sec != "freeze" else 12), BEAT / 2, 0.8 if i % 2 == 0 else 0.6),
                    tt, pan=-0.2 + 0.4 * (i % 2), gain=0.9 if sec != "lift" else 0.6)
    bar += 1

# --- groove: plucks, sub, drums (only where the edit wants energy) ---------
step = BEAT / 4
i = 0
while i * step < TOTAL:
    t = i * step
    sec = section(t)
    sixteenth = i % 16
    if sec in ("groove", "lift"):
        notes, bass = chord_at(t)
        arp = [notes[1] + 12, notes[2] + 12, notes[3] + 12, notes[2] + 12]
        if sixteenth % 2 == 0:
            add(pluck(arp[(sixteenth // 2) % 4], 1.0 if sixteenth % 4 == 0 else 0.7), t,
                pan=-0.35 if (sixteenth // 2) % 2 else 0.35, gain=0.9)
        if sixteenth in (0, 6, 10):
            add(sub(bass - 12 + 12, BEAT * (1.4 if sixteenth == 0 else 0.9)), t, gain=0.9)
        if sixteenth in (0, 7, 10):
            add(kick(), t, gain=0.85 if sec == "groove" else 1.0)
        if sixteenth in (4, 12):
            add(snare(), t, gain=0.8)
        if sixteenth % 2 == 1 or sec == "lift":
            add(hat(open_=(sixteenth == 14)), t, pan=0.25, gain=0.8 if sixteenth % 2 else 0.5)
    i += 1

# --- transitions -----------------------------------------------------------
add(riser(2.0), max(0, GROOVE_IN - 2.0), gain=1.0)
add(riser(1.5), max(0, MONTAGE - 1.5), gain=1.0)
# freeze: a reverse-swell into the stop, then a soft low "held breath"
add(riser(0.8)[::-1], FREEZE - 0.05, gain=0.7)
add(riser(1.4), RESUME - 1.4, gain=0.8)

# --- ending: resolved Fmaj9 with piano spread ----------------------------
fin = END + 0.5
add(pad([41, 48, 53, 57, 60, 64, 67], 4.5, 1600), fin, gain=1.4)
for k, m in enumerate([53, 60, 64, 67, 72, 76]):
    add(piano(m, 3.5, 0.9), fin + k * 0.06, pan=-0.3 + 0.12 * k, gain=1.0)
add(sub(41, 3.0), fin, gain=1.0)
add(kick(), fin, gain=0.9)

# --- space: simple stereo reverb by convolution --------------------------
ir_len = int(2.4 * SR)
tt = np.arange(ir_len) / SR
ir_l = rng.normal(0, 1, ir_len) * np.exp(-tt * 2.6)
ir_r = rng.normal(0, 1, ir_len) * np.exp(-tt * 2.6)
ir_l, ir_r = lp_fast(ir_l, 5000), lp_fast(ir_r, 5000)


def convolve(x: np.ndarray, h: np.ndarray) -> np.ndarray:
    n = len(x) + len(h)
    size = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(h, size), size)[: len(x)]


wet_l = convolve(L, ir_l) * 0.018
wet_r = convolve(R, ir_r) * 0.018
L, R = L + wet_l, R + wet_r

# gentle bus compression + fade
mix = np.stack([L, R], axis=1)
peak = np.max(np.abs(mix))
mix = np.tanh(mix / peak * 1.6) / np.tanh(1.6)
fade = int(1.5 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
mix[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
mix *= 0.89

out = PUBLIC / "audio" / "music_bed.wav"
with wave.open(str(out), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
print(f"wrote {out} ({TOTAL:.1f}s) freeze {FREEZE:.2f} resume {RESUME:.2f} groove {GROOVE_IN:.2f}")
