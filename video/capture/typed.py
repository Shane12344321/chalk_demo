"""Type a topic into the real CHALK app, let it generate a live lesson, and keep
both the screen recording and the lesson stream the backend returned.

Usage: uv run --with playwright python video/capture/typed.py "topic" --name proj
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import time
from pathlib import Path

from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("topic")
    ap.add_argument("--name", default=time.strftime("typed-%H%M%S"))
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--scale", type=float, default=2.0)
    args = ap.parse_args()

    out = HERE / "runs" / args.name
    frames = out / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    frame_log: list[tuple[int, float]] = []
    marks: list[dict] = []
    bodies: list[dict] = []

    def mark(label: str, **extra) -> None:
        marks.append({"t": time.time(), "label": label, **extra})
        print(time.strftime("%H:%M:%S"), label, extra or "", flush=True)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False, args=["--hide-scrollbars", "--mute-audio"])
        ctx = await browser.new_context(
            viewport={"width": args.width, "height": args.height}, device_scale_factor=args.scale)
        await ctx.add_init_script(path=str(HERE / "inject.js"))
        page = await ctx.new_page()

        async def on_response(resp) -> None:
            if "/lesson" in resp.url and resp.request.method == "POST":
                mark("lesson_response_headers", status=resp.status)
                try:
                    body = await resp.text()
                except Exception as exc:  # noqa: BLE001
                    body = f"<unavailable {exc}>"
                bodies.append({"url": resp.url, "status": resp.status, "t": time.time(), "body": body})
                mark("lesson_response_done", bytes=len(body))

        page.on("response", lambda r: asyncio.ensure_future(on_response(r)))
        await page.goto("http://localhost:5173/")
        await page.wait_for_selector("#lesson-topic")
        await page.mouse.move(args.width * 0.55, args.height * 0.6)
        await asyncio.sleep(0.8)

        cdp = await ctx.new_cdp_session(page)
        loop = asyncio.get_running_loop()
        pending: set = set()

        def on_frame(params: dict) -> None:
            n = len(frame_log)
            frame_log.append((n, params["metadata"]["timestamp"]))
            fut = loop.run_in_executor(None, (frames / f"{n:06d}.jpg").write_bytes,
                                       base64.b64decode(params["data"]))
            pending.add(fut)
            fut.add_done_callback(pending.discard)
            asyncio.ensure_future(cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]}))

        cdp.on("Page.screencastFrame", on_frame)
        await cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92})
        mark("record_start")
        await asyncio.sleep(1.0)

        field = page.locator("#lesson-topic")
        box = await field.bounding_box()
        await page.mouse.move(box["x"] + box["width"] * 0.6, box["y"] + box["height"] / 2, steps=30)
        await asyncio.sleep(0.2)
        await page.mouse.click(box["x"] + box["width"] * 0.6, box["y"] + box["height"] / 2, click_count=3)
        await page.keyboard.press("Meta+A")
        await page.keyboard.press("Backspace")
        mark("typing_start")
        await page.keyboard.type(args.topic, delay=55)
        mark("typing_end")
        await asyncio.sleep(0.5)
        btn = page.locator("button:has-text('Create lesson')")
        b = await btn.bounding_box()
        await page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, steps=22)
        await asyncio.sleep(0.2)
        mark("create_click")
        await page.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)

        end = time.time() + 150
        while time.time() < end and not bodies:
            await asyncio.sleep(0.25)
        await asyncio.sleep(3.0)
        mark("record_stop")
        await cdp.send("Page.stopScreencast")
        await asyncio.sleep(0.4)
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        await page.screenshot(path=str(out / "final.png"))
        await browser.close()

    (out / "lesson_responses.json").write_text(json.dumps(bodies, indent=1))
    (out / "marks.json").write_text(json.dumps(marks, indent=1))
    (out / "frames.json").write_text(json.dumps({"frames": frame_log}))
    print("saved", out)


if __name__ == "__main__":
    asyncio.run(main())
