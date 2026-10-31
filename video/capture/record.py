"""Drive a real, live CHALK session and record it for the demo video.

The student's voice is played into a virtual microphone, the tutor's real
Realtime audio is recorded from the WebRTC track, the page is captured with a
CDP screencast, and every Realtime event is logged with wall-clock time.

Usage: uv run --with playwright python video/capture/record.py --ask ask.wav --interrupt why.wav
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import re
import time
from pathlib import Path

from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
APP_URL = "http://localhost:5173/"


def now_ms() -> int:
    return int(time.time() * 1000)


class Run:
    def __init__(self, out: Path) -> None:
        self.out = out
        self.frames = out / "frames"
        self.frames.mkdir(parents=True, exist_ok=True)
        self.frame_log: list[tuple[int, float]] = []
        self.marks: list[dict] = []
        self.states: list[dict] = []

    def mark(self, label: str, **extra) -> None:
        entry = {"t": now_ms(), "label": label, **extra}
        self.marks.append(entry)
        print(f"[{time.strftime('%H:%M:%S')}] {label} {extra if extra else ''}", flush=True)


STATE_JS = """() => {
  const q = (s) => document.querySelector(s);
  const txt = document.body.innerText;
  const step = txt.match(/step (\\d+)\\s*\\/\\s*(\\d+)/);
  const btn = [...document.querySelectorAll('button')];
  const resume = btn.find(b => b.innerText.trim() === 'Resume frozen step');
  const start = btn.find(b => /^(Start|Replay) lesson$/.test(b.innerText.trim()));
  return {
    voice: q('#voice-title')?.innerText || '',
    eyebrow: q('.lesson-heading .eyebrow')?.innerText || '',
    title: q('#lesson-title')?.innerText || '',
    orb: q('.orb-control')?.getAttribute('aria-label') || '',
    step: step ? [+step[1], +step[2]] : null,
    hints: [...document.querySelectorAll('.lesson-hint')].map(h => h.innerText),
    resumeEnabled: !!resume && !resume.disabled,
    startLabel: start ? start.innerText.trim() : '',
    note: q('.stream-note')?.innerText || '',
    errors: [...document.querySelectorAll('[role=alert]')].map(e => e.innerText),
  };
}"""


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ask", required=True, help="student request audio (wav/mp3)")
    ap.add_argument("--interrupt", help="student interruption audio")
    ap.add_argument("--interrupt-step", type=int, default=2, help="interrupt during this step (1-based)")
    ap.add_argument("--interrupt-delay", type=float, default=2.5, help="seconds into that step's speech")
    ap.add_argument("--followup", help="optional audio said after the answer instead of clicking Resume")
    ap.add_argument("--name", default=time.strftime("run-%Y%m%d-%H%M%S"))
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--scale", type=float, default=2.0)
    ap.add_argument("--max-seconds", type=float, default=240)
    ap.add_argument("--audible", action="store_true", help="do not mute the browser")
    args = ap.parse_args()

    run = Run(HERE / "runs" / args.name)
    say = {k: base64.b64encode(Path(v).read_bytes()).decode() for k, v in
           (("ask", args.ask), ("interrupt", args.interrupt), ("followup", args.followup)) if v}

    async with async_playwright() as pw:
        launch_args = [
            "--autoplay-policy=no-user-gesture-required",
            "--use-fake-ui-for-media-stream",
            "--hide-scrollbars",
            f"--window-size={args.width},{args.height + 120}",
        ]
        if not args.audible:
            launch_args.append("--mute-audio")
        browser = await pw.chromium.launch(headless=False, args=launch_args)
        ctx = await browser.new_context(
            viewport={"width": args.width, "height": args.height},
            device_scale_factor=args.scale,
            permissions=["microphone"],
        )
        await ctx.add_init_script(path=str(HERE / "inject.js"))
        page = await ctx.new_page()
        page.on("console", lambda m: m.type == "error" and print("console:", m.text[:200]))
        await page.goto(APP_URL)
        await page.wait_for_selector(".orb-control")
        await page.mouse.move(args.width * 0.5, args.height * 0.55)
        await asyncio.sleep(1.0)

        cdp = await ctx.new_cdp_session(page)
        loop = asyncio.get_running_loop()
        pending: set[asyncio.Future] = set()

        def on_frame(params: dict) -> None:
            n = len(run.frame_log)
            run.frame_log.append((n, params["metadata"]["timestamp"]))
            data = base64.b64decode(params["data"])
            fut = loop.run_in_executor(None, (run.frames / f"{n:06d}.jpg").write_bytes, data)
            pending.add(fut)
            fut.add_done_callback(pending.discard)
            asyncio.ensure_future(cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]}))

        cdp.on("Page.screencastFrame", on_frame)
        await cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "everyNthFrame": 1})
        rec_t0 = await page.evaluate("window.__recStart()")
        run.mark("record_start", rec_t0=rec_t0)

        async def state() -> dict:
            s = await page.evaluate(STATE_JS)
            s["t"] = now_ms()
            run.states.append(s)
            return s

        async def wait_for(pred, timeout: float, label: str, poll: float = 0.2) -> dict:
            end = time.time() + timeout
            while time.time() < end:
                s = await state()
                if pred(s):
                    return s
                await asyncio.sleep(poll)
            raise TimeoutError(label)

        async def quiet(seconds: float, timeout: float = 60) -> None:
            """Wait until Chalk has not been speaking for `seconds`."""
            end = time.time() + timeout
            since = None
            while time.time() < end:
                s = await state()
                if s["voice"] == "Chalk is speaking":
                    since = None
                else:
                    since = since or time.time()
                    if time.time() - since >= seconds:
                        return
                await asyncio.sleep(0.15)

        async def glide_click(selector: str) -> None:
            box = await page.locator(selector).first.bounding_box()
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            await page.mouse.move(x, y, steps=28)
            await asyncio.sleep(0.25)
            run.mark("click", selector=selector)
            await page.mouse.down()
            await asyncio.sleep(0.08)
            await page.mouse.up()

        async def speak(key: str) -> float:
            run.mark("student_say_begin", clip=key)
            dur = await page.evaluate("b => window.__chalkSay(b)", say[key])
            await asyncio.sleep(dur)
            run.mark("student_say_end", clip=key, duration=dur)
            return dur

        deadline = time.time() + args.max_seconds
        try:
            # 1. connect
            await glide_click(".orb-control")
            await wait_for(lambda s: s["orb"] in ("Talk to Chalk", "Stop listening"), 30, "connect")
            run.mark("connected")
            await quiet(1.2, 20)

            # 2. ask for a topic by voice
            await glide_click(".orb-control")
            await wait_for(lambda s: s["orb"] == "Stop listening", 5, "mic on")
            await asyncio.sleep(0.4)
            await speak("ask")
            s = await wait_for(lambda s: s["eyebrow"].lower().startswith("live"), 90, "live lesson")
            run.mark("live_lesson", title=s["title"])

            # 3. interrupt mid-stroke on the chosen step
            if "interrupt" in say:
                target = args.interrupt_step
                await wait_for(
                    lambda s: s["step"] and s["step"][0] >= target and s["voice"] == "Chalk is speaking",
                    120, "target step speaking")
                run.mark("target_step_speaking", step=target)
                await asyncio.sleep(args.interrupt_delay)
                run.mark("interrupt_press")
                await page.keyboard.down("Space")
                await page.keyboard.up("Space")
                await asyncio.sleep(0.25)
                await speak("interrupt")
                await wait_for(lambda s: s["voice"] == "Chalk is speaking", 30, "answer starts")
                run.mark("answer_start")
                await quiet(1.6, 90)
                run.mark("answer_done")
                await asyncio.sleep(0.6)
                if "followup" in say:
                    await glide_click(".orb-control")
                    await asyncio.sleep(0.3)
                    await speak("followup")
                else:
                    await wait_for(lambda s: s["resumeEnabled"], 20, "resume enabled")
                    await glide_click("button:has-text('Resume frozen step')")
                run.mark("resumed")

            # 4. let the lesson finish
            await wait_for(lambda s: s["startLabel"] == "Replay lesson", max(5, deadline - time.time()), "lesson done")
            run.mark("lesson_done")
            await quiet(2.0, 40)
            await asyncio.sleep(1.5)
        except TimeoutError as exc:
            run.mark("timeout", where=str(exc))
            print("state at timeout:", json.dumps(run.states[-1], indent=1))
        finally:
            run.mark("record_stop")
            audio = await page.evaluate("window.__recStop()")
            await cdp.send("Page.stopScreencast")
            await asyncio.sleep(0.5)
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
            for name, b64 in audio.items():
                (run.out / f"{name}.webm").write_bytes(base64.b64decode(b64))
            events = await page.evaluate("window.__cap.events")
            (run.out / "events.json").write_text(json.dumps(events, indent=1))
            (run.out / "marks.json").write_text(json.dumps(run.marks, indent=1))
            (run.out / "states.json").write_text(json.dumps(run.states))
            (run.out / "frames.json").write_text(json.dumps(
                {"rec_t0": rec_t0, "frames": run.frame_log}))
            await page.screenshot(path=str(run.out / "final.png"))
            await browser.close()
    print("saved", run.out)


if __name__ == "__main__":
    asyncio.run(main())
