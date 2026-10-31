import type { Frame, Vec2 } from "./types";

/**
 * The one mapping from frame coordinates (math orientation, y up) to board
 * pixels. Every mark, axis, tick, and point reference goes through it, so a
 * graph's data units and a diagram's unit square are the same mechanism.
 */
export interface FrameTransform {
  readonly frame: Frame;
  toPixel(point: Vec2): [number, number];
  toFrame(pixel: Vec2): [number, number];
  /** Pixels per frame unit along x and y (both positive). */
  readonly unit: readonly [number, number];
  /** The frame's shorter pixel side: the unit of screen-sized lengths. */
  readonly minSide: number;
}

export function frameTransform(frame: Frame): FrameTransform {
  const [a, b] = frame.window.x;
  const [c, d] = frame.window.y;
  if (!(b > a) || !(d > c) || ![a, b, c, d].every(Number.isFinite)) {
    throw new Error(`Frame ${frame.id} has an empty or non-finite window.`);
  }
  let originX = frame.box.x;
  let originY = frame.box.y;
  let spanX = frame.box.width;
  let spanY = frame.box.height;
  if (frame.equalScale) {
    const unit = Math.min(frame.box.width / (b - a), frame.box.height / (d - c));
    spanX = unit * (b - a);
    spanY = unit * (d - c);
    originX = frame.box.x + (frame.box.width - spanX) / 2;
    originY = frame.box.y + (frame.box.height - spanY) / 2;
  }
  return {
    frame,
    // Written as fraction-of-window × span so a plot frame reproduces the
    // historical axes mapping bit for bit.
    toPixel: ([x, y]) => [
      originX + ((x - a) / (b - a)) * spanX,
      originY + spanY - ((y - c) / (d - c)) * spanY,
    ],
    toFrame: ([px, py]) => [
      a + ((px - originX) / spanX) * (b - a),
      c + ((originY + spanY - py) / spanY) * (d - c),
    ],
    unit: [spanX / (b - a), spanY / (d - c)],
    minSide: Math.min(frame.box.width, frame.box.height),
  };
}
