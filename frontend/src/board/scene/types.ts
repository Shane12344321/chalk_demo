import type { LayoutBox } from "../layout";
import type { LessonOp } from "../lesson.generated";
import type { LabelMobility } from "./labelSolver";
import type { Motion } from "./motion";

/**
 * The browser-side scene IR (general-drawing plan, Phase 2).
 *
 * A board is a list of elements in commit order. Elements that draw place
 * their marks in a frame: a pixel box with one coordinate window
 * `x:[a,b] × y:[c,d]` in math orientation (y up). A plot and a diagram are the
 * same thing with different frame options, so any mark can sit on a graph in
 * data units. Nothing here is wire format: `compileLegacy.ts` builds it from
 * validated ops, and Phase 3 will build it from schema 1.5.
 *
 * Units: positions and radii are frame units. Screen-sized quantities (angle
 * marker radius, constructed line length) are fractions of the frame's
 * shorter pixel side, so they stay circular and readable in any window.
 */

export type Vec2 = readonly [number, number];

export interface CoordinateWindow {
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
}

export type FrameAxes = "edge" | "origin" | "none";

export interface Frame {
  id: string;
  /** Drawable interior in board pixels. Axes, ticks, and titles sit on or outside it. */
  box: LayoutBox;
  window: CoordinateWindow;
  axes: FrameAxes;
  grid: boolean;
  /** One frame unit is the same number of pixels on both axes (the window is centred). */
  equalScale: boolean;
  /** Axis titles, drawn only when the frame has axes. */
  titles?: { x: string; y: string };
  /**
   * Where point and side labels start (see `outward.ts`): `outside` names a
   * point on a closed outline outside it; `away` also turns every other point
   * or side label away from the window's centre. Legacy frames keep their
   * natural anchors.
   */
  labelSide?: "outside" | "away";
}

export type Side = "above" | "below" | "left" | "right";
export type StrokeStyle = "solid" | "dashed";
export type Tone = "ink" | "accent" | "faint";

/**
 * A point in frame coordinates, given literally or derived from earlier marks.
 * Derived points resolve against rendered geometry (renderer truth), never a
 * guess; see `refs.ts`.
 */
export type PointRef =
  | Vec2
  | { at: string }
  | { end: string; which: "start" | "end" }
  | { mid: readonly [PointRef, PointRef] }
  /** Fraction of arc length along a one-piece path, line, or function. */
  | { on: string; t: number }
  /** The point of a function mark at data x. */
  | { on: string; x: number }
  /** The unique intersection of two marks. */
  | { hit: readonly [string, string] }
  /** Foot of the perpendicular from a point onto a straight mark. */
  | { foot: PointRef; onto: string }
  /** Beside a mark's bounds by `gap` frame-size fractions. */
  | { beside: string; side: Side; gap: number };

export interface MarkLabel {
  text: string;
  mobility?: LabelMobility;
}

interface MarkBase {
  /** Unique within the scene; references use it. */
  id: string;
  /** rough.js seed key; each mark kind derives its stroke seeds from it. */
  seed?: string;
  stroke?: StrokeStyle;
  tone?: Tone;
  label?: MarkLabel;
  /**
   * Reveal stagger group inside the element. Omitted, the mark keeps its own
   * sub-grouping (each dash or curve piece in turn).
   */
  group?: number;
  /** Manifest description when the element exposes marks as parts. */
  meaning?: string;
}

export interface PointMark extends MarkBase {
  kind: "point";
  at: PointRef;
}

export interface PathMark extends MarkBase {
  kind: "path";
  points: readonly PointRef[];
  closed?: boolean;
  /** Smooth through the points with this tension (0..1); omitted is straight. */
  smooth?: number;
  arrow?: boolean;
  /**
   * `segments`: the pen lifts at every vertex; `stroke`: one continuous
   * stroke. Defaults to `segments` when open and `stroke` when closed.
   */
  draw?: "segments" | "stroke";
  fill?: boolean;
}

export type LineSpec =
  | { from: PointRef; to: PointRef }
  | { through: PointRef; slope: number; length: number }
  | { tangentTo: string; x: number; length: number }
  /**
   * Perpendicular to a straight mark through a point. Without `length`, a
   * point off the line gets the segment down to its foot (an altitude) and a
   * point on the line a centred segment of 0.4.
   */
  | { normalTo: string; through: PointRef; length?: number };

export interface LineMark extends MarkBase {
  kind: "line";
  line: LineSpec;
  /** Clip a constructed line to its frame instead of rejecting it when it runs past the edge. */
  clip?: boolean;
}

export interface VectorMark extends MarkBase {
  kind: "vector";
  from: PointRef;
  to: PointRef;
}

export interface CircleMark extends MarkBase {
  kind: "circle";
  center: PointRef;
  r: number;
  fill?: boolean;
}

export interface EllipseMark extends MarkBase {
  kind: "ellipse";
  center: PointRef;
  rx: number;
  ry: number;
  fill?: boolean;
}

/** Degrees, counter-clockwise from +x in math orientation. */
export interface ArcMark extends MarkBase {
  kind: "arc";
  center: PointRef;
  rx: number;
  ry: number;
  start: number;
  end: number;
  arrow?: boolean;
}

export interface FnMark extends MarkBase {
  kind: "fn";
  expr: string;
  /** Defaults to the frame's x-range. */
  domain?: readonly [number, number];
}

export interface ParamMark extends MarkBase {
  kind: "param";
  x: string;
  y: string;
  t: readonly [number, number];
}

export interface PolarMark extends MarkBase {
  kind: "polar";
  r: string;
  theta: readonly [number, number];
}

export type RegionSpec =
  | { under: string; from?: number; to?: number }
  | { between: readonly [string, string]; from?: number; to?: number }
  /** Inside a closed shape, leaving the closed shapes in `except` clear (a Venn complement). */
  | { inside: string; except?: readonly string[] };

export interface RegionMark extends MarkBase {
  kind: "region";
  region: RegionSpec;
}

export type AngleSpec =
  | { start: number; end: number }
  | { rays: readonly [PointRef, PointRef] };

export interface AngleMark extends MarkBase {
  kind: "angle";
  vertex: PointRef;
  angle: AngleSpec;
  /** Fraction of the frame's shorter pixel side. */
  radius: number;
  /** An angle that looks right (within a degree on screen) draws as the square corner mark. */
  square?: boolean;
}

export interface MeasureMark extends MarkBase {
  kind: "measure";
  from: PointRef;
  to: PointRef;
  /** Pixels between the measured span and its dimension line, on the left of from→to. */
  offset?: number;
}

export interface LabelMark extends MarkBase {
  kind: "label";
  text: string;
  at: PointRef;
  /** `on` writes at the point itself; a side offsets the text from it. */
  side: "on" | Side;
  align?: "left" | "center" | "right";
  size?: "small" | "normal" | "large";
  mobility?: LabelMobility;
}

export interface Transform {
  translate?: Vec2;
  /** Degrees counter-clockwise about `origin`. */
  rotate?: number;
  scale?: number | Vec2;
  /** Reflect across the vertical (`x`) or horizontal (`y`) line through `origin`. */
  mirror?: "x" | "y";
  origin?: Vec2;
}

export interface GroupMark extends MarkBase {
  kind: "group";
  marks: readonly Mark[];
  transform?: Transform;
  /** Draw the group `count` times, applying `transform` once more each time. */
  repeat?: { count: number; transform: Transform };
}

export type Mark =
  | PointMark
  | PathMark
  | LineMark
  | VectorMark
  | CircleMark
  | EllipseMark
  | ArcMark
  | FnMark
  | ParamMark
  | PolarMark
  | RegionMark
  | AngleMark
  | MeasureMark
  | LabelMark
  | GroupMark;

export type Note = { text: string } | { tex: string };

export interface SceneElement {
  id: string;
  /** Manifest kind (the op kind until schema 1.5 adds its own). */
  kind: LessonOp["op"];
  stepIndex: number;
  opIndex: number;
  /** The layout slot the element was given. */
  box: LayoutBox;
  /** `slot`: the geometry box is the layout slot; `ink`: padded bounds of the marks. */
  sizing: "slot" | "ink";
  /** Frame the marks live in. */
  frame?: string;
  /** This element draws its frame's axes, grid, ticks, and titles. */
  drawsFrame?: boolean;
  /** Boundary used by measured label checks (legacy `canvasBox`). */
  canvasBox?: LayoutBox;
  note?: Note;
  marks: readonly Mark[];
  /** Each top-level mark is its own manifest part and reveal group. */
  parts?: boolean;
  summary: string;
  motion?: Motion;
}

export interface Scene {
  frames: readonly Frame[];
  elements: readonly SceneElement[];
}
