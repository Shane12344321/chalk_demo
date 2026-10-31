import { axesPlotBox } from "../axesGeometry";
import type { LaidOutOp, LayoutBox } from "../layout";
import type {
  FigureLeafMark,
  FigureMark,
  FigureOp,
  FigurePoint,
  FigureRegionOp,
} from "../lesson.generated";
import type { Frame, Mark, PointRef, SceneElement, Transform } from "./types";

/**
 * Schema-1.5 `figure` ops → scene IR. A figure is a frame (one coordinate
 * window, math y-up) plus marks; `figure … on` adds marks to an earlier
 * figure's frame. Wire marks map one-to-one onto IR marks, so everything the
 * renderer can draw in a frame is reachable from the wire.
 */

const RIGHT_ANGLE_LABEL = /^\s*90\s*°?\s*$/;

/** Frame insets inside a figure's layout slot: plot frames leave room for ticks and titles. */
const PLAIN_INSET = 12;

export function figureFrame(op: FigureRegionOp, slot: LayoutBox): Frame {
  const axes = op.frame.axes ?? "none";
  const box = axes === "none"
    ? {
        x: slot.x + PLAIN_INSET,
        y: slot.y + PLAIN_INSET,
        width: Math.max(1, slot.width - PLAIN_INSET * 2),
        height: Math.max(1, slot.height - PLAIN_INSET * 2),
      }
    : axesPlotBox(slot);
  return {
    id: op.id,
    box,
    window: { x: [op.frame.x[0], op.frame.x[1]], y: [op.frame.y[0], op.frame.y[1]] },
    axes,
    grid: op.frame.grid ?? false,
    equalScale: op.frame.equal_scale ?? axes === "none",
    // In a plot "away from the centre" means nothing (shading and drop lines
    // go under a curve, secants along it); closed outlines still label outside.
    labelSide: axes === "none" ? "away" : "outside",
    ...(axes !== "none" && (op.frame.x_label || op.frame.y_label)
      ? { titles: { x: op.frame.x_label ?? "", y: op.frame.y_label ?? "" } }
      : {}),
  };
}

export function compileFigure(
  item: LaidOutOp & { op: FigureOp },
  frameId: string | undefined,
): SceneElement {
  const { op } = item;
  const marks = op.marks.map((mark, index) => ({
    ...compileMark(mark, `${op.id}#${index}`),
    group: index,
    meaning: describeMark(mark),
  }) as Mark);
  return {
    id: op.id,
    kind: "figure",
    stepIndex: item.stepIndex,
    opIndex: item.opIndex,
    box: item.box,
    sizing: "frame" in op ? "slot" : "ink",
    ...(frameId ? { frame: frameId } : {}),
    ...("frame" in op ? { drawsFrame: true } : {}),
    parts: true,
    marks,
    summary: op.meaning ?? figureSummary(op),
  };
}

function compileMark(mark: FigureMark, fallbackId: string): Mark {
  const id = mark.id ?? fallbackId;
  const label = "label" in mark && mark.label && mark.kind !== "measure" ? { label: { text: mark.label } } : {};
  const stroke = "stroke" in mark && mark.stroke ? { stroke: mark.stroke } : {};
  switch (mark.kind) {
    case "point":
      return { kind: "point", id, at: point(mark.at), ...label };
    case "segment":
      return mark.arrow
        ? { kind: "vector", id, from: point(mark.from), to: point(mark.to), ...stroke, ...label }
        : { kind: "line", id, line: { from: point(mark.from), to: point(mark.to) }, ...stroke, ...label };
    case "polyline":
      return {
        kind: "path",
        id,
        points: mark.points.map(point),
        ...(mark.closed ? { closed: true } : {}),
        ...(mark.smooth ? { smooth: 0.55 } : {}),
        ...(mark.arrow ? { arrow: true } : {}),
        ...(mark.fill ? { fill: true } : {}),
        ...stroke,
        ...label,
      };
    case "circle":
      return { kind: "circle", id, center: point(mark.center), r: mark.r, ...(mark.fill ? { fill: true } : {}), ...stroke, ...label };
    case "arc":
      return {
        kind: "arc",
        id,
        center: point(mark.center),
        rx: mark.r,
        ry: mark.r,
        start: mark.start,
        end: mark.end,
        ...(mark.arrow ? { arrow: true } : {}),
        ...stroke,
        ...label,
      };
    case "fn":
      return { kind: "fn", id, expr: mark.y, ...(mark.domain ? { domain: mark.domain } : {}), ...stroke, ...label };
    case "param":
      return { kind: "param", id, x: mark.x, y: mark.y, t: mark.t, ...stroke, ...label };
    case "polar":
      return { kind: "polar", id, r: mark.r, theta: mark.theta, ...stroke, ...label };
    case "shade":
      return {
        kind: "region",
        id,
        region: "under" in mark
          ? { under: mark.under, ...range(mark) }
          : "between" in mark
            ? { between: [mark.between[0], mark.between[1]], ...range(mark) }
            : { inside: mark.inside, ...(mark.except ? { except: [...mark.except] } : {}) },
        ...label,
      };
    case "angle":
      return {
        kind: "angle",
        id,
        vertex: point(mark.at),
        angle: { rays: [point(mark.from), point(mark.to)] },
        radius: mark.r ?? 0.08,
        // The square corner says "right angle"; a named angle (θ) keeps its arc even at 90°.
        ...(mark.label === undefined || RIGHT_ANGLE_LABEL.test(mark.label) ? { square: true } : {}),
        ...label,
      };
    case "tangent":
      return {
        kind: "line",
        id,
        line: { tangentTo: mark.to, x: mark.x, length: mark.length ?? 0.4 },
        clip: true,
        ...stroke,
        ...label,
      };
    case "perpendicular":
      return {
        kind: "line",
        id,
        line: {
          normalTo: mark.to,
          through: point(mark.through),
          ...(mark.length === undefined ? {} : { length: mark.length }),
        },
        clip: true,
        ...stroke,
        ...label,
      };
    case "measure":
      return { kind: "measure", id, from: point(mark.from), to: point(mark.to), label: { text: mark.label } };
    case "text":
      return {
        kind: "label",
        id,
        text: mark.text,
        at: point(mark.at),
        side: "on",
        ...(mark.align ? { align: mark.align } : {}),
        ...(mark.size ? { size: mark.size } : {}),
        mobility: "nudge",
      };
    case "group": {
      const transform: Transform = {
        ...(mark.translate ? { translate: mark.translate } : {}),
        ...(mark.rotate !== undefined ? { rotate: mark.rotate } : {}),
        ...(mark.scale !== undefined ? { scale: mark.scale } : {}),
        ...(mark.mirror ? { mirror: mark.mirror } : {}),
        ...(mark.origin ? { origin: mark.origin } : {}),
      };
      return {
        kind: "group",
        id,
        marks: mark.marks.map((child: FigureLeafMark, index) => compileMark(child, `${id}.${index}`)),
        // Without repeat the transform moves the group once; with repeat the
        // first copy stays put and each further copy applies it once more.
        ...(mark.repeat ? { repeat: { count: mark.repeat, transform } } : { transform }),
      };
    }
  }
}

function range(mark: { from?: number; to?: number }): { from?: number; to?: number } {
  return {
    ...(mark.from !== undefined ? { from: mark.from } : {}),
    ...(mark.to !== undefined ? { to: mark.to } : {}),
  };
}

export function point(value: FigurePoint): PointRef {
  if (Array.isArray(value)) return [value[0], value[1]];
  if ("at" in value) return { at: value.at };
  if ("mid" in value) return { mid: [{ at: value.mid[0] }, { at: value.mid[1] }] };
  if ("on" in value) return "x" in value ? { on: value.on, x: value.x } : { on: value.on, t: value.t };
  if ("hit" in value) return { hit: [value.hit[0], value.hit[1]] };
  return { foot: { at: value.foot }, onto: value.onto };
}

function describeMark(mark: FigureMark): string {
  const named = (noun: string) => ("label" in mark && mark.label ? `${noun} ${mark.label}` : noun);
  switch (mark.kind) {
    case "fn":
      return named(`curve y = ${mark.y}`);
    case "param":
      return named(`curve (${mark.x}, ${mark.y})`);
    case "polar":
      return named(`polar curve r = ${mark.r}`);
    case "shade":
      return named("shaded region");
    case "text":
      return `writing "${mark.text}"`;
    case "polyline":
      return named(mark.closed ? "polygon" : mark.smooth ? "smooth path" : "path");
    case "segment":
      return named(mark.arrow ? "arrow" : "segment");
    case "group":
      return mark.repeat ? `${mark.repeat} copies of ${mark.marks.length} marks` : `group of ${mark.marks.length} marks`;
    default:
      return named(mark.kind);
  }
}

function figureSummary(op: FigureOp): string {
  const parts = op.marks.map(describeMark).slice(0, 6).join(", ");
  if (!("frame" in op)) return `adds to ${op.on}: ${parts}`;
  const { frame } = op;
  const axes = (frame.axes ?? "none") === "none"
    ? "figure"
    : `plot ${frame.x_label ?? "x"} ${frame.x[0]} to ${frame.x[1]}; ${frame.y_label ?? "y"} ${frame.y[0]} to ${frame.y[1]}`;
  return `${axes}: ${parts}`;
}
