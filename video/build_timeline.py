"""Build the whole edit from the voice manifest.

Writes:
  video/capture/lessons/app.timeline.json      board capture timeline (app-local seconds)
  video/capture/lessons/montage-*.timeline.json one per montage lesson
  video/remotion/public/edit.json              shot list, audio placements, captions, camera
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LESSONS = ROOT / "capture" / "lessons"
PUBLIC = ROOT / "remotion" / "public"
M = json.loads((PUBLIC / "audio" / "manifest.json").read_text())
FPS = 30


def D(key: str) -> float:
    return M[key]["duration"]


def lesson_from_ndjson(name: str) -> dict:
    steps, title = [], None
    for line in (LESSONS / f"{name}.ndjson").read_text().splitlines():
        e = json.loads(line)
        if e["type"] == "lesson.started":
            title = e["title"]
        elif e["type"] == "lesson.step":
            steps.append(e["step"])
    return {"schema_version": "1.5", "title": title, "steps": steps}


def word_time(key: str, needle: str) -> float:
    for w in M[key]["words"]:
        if needle.lower() in w["w"].lower():
            return w["s"]
    return 0.0


audio: list[dict] = []
captions: list[dict] = []


def place(key: str, start: float, volume: float = 1.0, cut: float | None = None, caption: bool = False) -> float:
    entry = {"src": M[key]["file"], "start": round(start, 3), "volume": volume}
    if cut is not None:
        entry["cut"] = round(cut, 3)
    audio.append(entry)
    if caption:
        words = [w for w in M[key]["words"] if cut is None or w["s"] < cut]
        captions.append({"speaker": M[key]["role"], "start": round(start, 3),
                         "end": round(start + (cut if cut is not None else D(key)), 3),
                         "words": [{"w": w["w"], "s": round(start + w["s"], 3)} for w in words]})
    return start + (cut if cut is not None else D(key))


# ---------------------------------------------------------------- global plan
OPENER = 6.4
place("n_open", 0.9)
meet_start = OPENER
n_meet_end = place("n_meet", meet_start + 0.35)
app_start = n_meet_end + 0.2

# ------------------------------------------------- app clip (app-local time)
typing = {"start": 0.9, "end": 3.0, "text": "Why a projectile flies farthest at 45 degrees", "initial": ""}
create_at = 3.5
arrive_at = 5.0
place("n_ask", app_start + 0.45)

speaking, listening, steps = [], [], []
t = arrive_at + 0.4
for key in ("t_s1", "t_s2", "t_s3"):
    end = place(key, app_start + t, caption=True) - app_start
    speaking.append([t, end])
    steps.append([t, end + 0.25])
    t = end + 0.25

t4 = t
freeze_at = t4 + D("t_s4a") - 0.4
wait_start = freeze_at - 0.2
place("t_s4a", app_start + t4, cut=freeze_at + 0.12 - t4, caption=True)
speaking.append([t4, freeze_at + 0.12])
wait_end = place("s_wait", app_start + wait_start, caption=True) - app_start
listening.append([wait_start - 0.15, wait_end + 0.1])
ans_start = wait_end + 0.45
ans_end = place("t_answer", app_start + ans_start, caption=True) - app_start
speaking.append([ans_start, ans_end])
circle_at = ans_start + word_time("t_answer", "range")
ok_start = ans_end + 0.3
ok_end = place("s_ok", app_start + ok_start, caption=True) - app_start
listening.append([ok_start - 0.1, ok_end + 0.1])
resume_click = ok_end + 0.3
resume_at = resume_click + 0.25
s4b_end = place("t_s4b", app_start + resume_at, caption=True) - app_start
speaking.append([resume_at, s4b_end])
step4_len = (freeze_at - t4) + (s4b_end - resume_at) + 0.3
steps.append([t4, t4 + step4_len])
app_len = s4b_end + 1.2

cursor = [
    {"t": 0.0, "x": 1100, "y": 640},
    {"t": 0.75, "sel": "#lesson-topic", "dx": 120, "down": True},
    {"t": 3.05, "sel": "#lesson-topic", "dx": 140, "dy": 6},
    {"t": 3.5, "sel": ".topic-form button.primary", "down": True},
    {"t": 5.6, "x": 1240, "y": 760},
    {"t": resume_click - 0.75, "x": 1240, "y": 760},
    {"t": resume_click, "sel": ".lesson-actions button.secondary", "down": True},
    {"t": resume_click + 1.2, "x": 1180, "y": 700},
]

app_timeline = {
    "lesson": lesson_from_ndjson("projectile"),
    "duration": round(app_len, 3),
    "typing": typing,
    "createAt": create_at,
    "arriveAt": arrive_at,
    "steps": [[round(a, 3), round(b, 3)] for a, b in steps],
    "freeze": {"at": round(freeze_at, 3), "resumeAt": round(resume_at, 3)},
    "speaking": [[round(a, 3), round(b, 3)] for a, b in speaking],
    "listening": [[round(a, 3), round(b, 3)] for a, b in listening],
    "annotations": [{"at": round(circle_at, 3), "until": round(resume_at + 1.2, 3),
                     "ops": [{"op": "circle", "id": "q1", "target_id": "range"}]}],
    "cursor": cursor,
}
(LESSONS / "app.timeline.json").write_text(json.dumps(app_timeline, indent=1))

# ------------------------------------------------------------ montage lessons
MONTAGE = ["pythagoras", "tangent", "spring", "lens"]
SLOT = 1.55
for name in MONTAGE:
    lesson = lesson_from_ndjson(name)
    n = len(lesson["steps"])
    per = 3.2 / n
    tl = {
        "lesson": lesson, "duration": 3.6, "typing": {"start": -2, "end": -1, "text": lesson["title"][:80]},
        "createAt": -1, "arriveAt": -0.5,
        "steps": [[round(0.1 + i * per, 3), round(0.1 + (i + 1) * per, 3)] for i in range(n)],
        "speaking": [[0, 3.6]], "listening": [], "cursor": [{"t": 0, "x": -100, "y": -100}], "boardOnly": True,
    }
    (LESSONS / f"montage-{name}.timeline.json").write_text(json.dumps(tl, indent=1))

app_end = app_start + app_len
montage_start = app_end
n_any_end = place("n_any", montage_start + 0.35)
montage_len = max(len(MONTAGE) * SLOT, n_any_end - montage_start + 0.3)
how_start = montage_start + montage_len
n_how_end = place("n_how", how_start + 0.4)
how_len = n_how_end - how_start + 0.45
end_start = how_start + how_len
n_end_end = place("n_end", end_start + 0.5)
total = n_end_end + 1.7

# camera keyframes for the app clip, in page CSS px of the 1600x1000 viewport
cam = [
    {"t": 0.0, "x": 800, "y": 500, "z": 1.0},
    {"t": 1.0, "x": 640, "y": 260, "z": 1.55},
    {"t": 3.2, "x": 760, "y": 260, "z": 1.55},
    {"t": 4.2, "x": 800, "y": 500, "z": 1.0},
    {"t": steps[0][0] + 0.3, "x": 800, "y": 520, "z": 1.0},
    {"t": steps[0][0] + 1.6, "x": 1080, "y": 430, "z": 1.45},
    {"t": steps[1][0] - 0.2, "x": 1080, "y": 430, "z": 1.45},
    {"t": steps[1][0] + 1.0, "x": 420, "y": 560, "z": 1.5},
    {"t": steps[2][0] + 0.8, "x": 520, "y": 640, "z": 1.5},
    {"t": t4 + 0.4, "x": 640, "y": 720, "z": 1.45},
    {"t": freeze_at + 0.3, "x": 560, "y": 720, "z": 1.75},
    {"t": ans_start + 0.2, "x": 560, "y": 720, "z": 1.75},
    {"t": circle_at, "x": 420, "y": 640, "z": 1.6},
    {"t": resume_at - 0.2, "x": 700, "y": 600, "z": 1.25},
    {"t": s4b_end - 0.6, "x": 600, "y": 700, "z": 1.4},
    {"t": app_len, "x": 800, "y": 520, "z": 1.0},
]

edit = {
    "fps": FPS,
    "duration": round(total, 3),
    "shots": {
        "opener": [0, OPENER],
        "meet": [meet_start, app_start],
        "app": [app_start, app_end],
        "montage": [montage_start, how_start],
        "how": [how_start, end_start],
        "end": [end_start, total],
    },
    "app": {
        "freezeAt": round(freeze_at, 3), "resumeAt": round(resume_at, 3), "createAt": create_at,
        "arriveAt": arrive_at, "circleAt": round(circle_at, 3), "cam": cam,
        "viewport": [1600, 1000],
    },
    "montage": {"names": MONTAGE, "slot": SLOT,
                "titles": [lesson_from_ndjson(n)["title"] for n in MONTAGE]},
    "audio": audio,
    "captions": captions,
}
(PUBLIC / "edit.json").write_text(json.dumps(edit, indent=1))
print(f"total {total:.2f}s  app {app_start:.2f}->{app_end:.2f} (len {app_len:.2f})  "
      f"freeze {freeze_at:.2f} resume {resume_at:.2f}  montage {montage_start:.2f}  how {how_start:.2f}  end {end_start:.2f}")
