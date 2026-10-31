"""Render the capture page frame by frame from a timeline JSON.

Usage:
  uv run --with playwright python video/capture/render_frames.py timeline.json out_dir --fps 30
  uv run --with playwright python video/capture/render_frames.py timeline.json out_dir --at 5 12.5 20
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
from pathlib import Path

from playwright.async_api import async_playwright


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("timeline")
    ap.add_argument("out")
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--end", type=float)
    ap.add_argument("--at", type=float, nargs="*")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--scale", type=float, default=2)
    args = ap.parse_args()

    timeline = json.loads(Path(args.timeline).read_text())
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    end = args.end if args.end is not None else timeline["duration"]
    times = args.at if args.at else [args.start + i / args.fps
                                     for i in range(int(math.floor((end - args.start) * args.fps)) + 1)]

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=["--hide-scrollbars", "--force-color-profile=srgb"])
        page = await browser.new_page(viewport={"width": args.width, "height": args.height},
                                      device_scale_factor=args.scale)
        await page.add_init_script(f"window.__TIMELINE = {json.dumps(timeline)};")
        page.on("pageerror", lambda e: print("pageerror:", e))
        await page.goto("http://localhost:5173/capture.html")
        await page.wait_for_function("window.__ready === true")
        await page.evaluate("document.fonts.ready")
        await page.evaluate("window.__setTime(0)")
        await asyncio.sleep(1.0)
        for i, t in enumerate(times):
            await page.evaluate("t => window.__setTime(t)", t)
            name = f"t{t:07.3f}.png" if args.at else f"{i:06d}.jpg"
            if args.at:
                await page.screenshot(path=str(out / name))
            else:
                await page.screenshot(path=str(out / name), type="jpeg", quality=93)
            if i % 150 == 0:
                print(f"frame {i}/{len(times)} t={t:.2f}", flush=True)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
