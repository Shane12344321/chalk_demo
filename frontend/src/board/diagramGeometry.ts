import type { DiagramPrimitive } from "./lesson.generated";
import type { LayoutBox } from "./layout";

export type DiagramPoint = [number, number];

export interface CubicSegment {
  from: DiagramPoint;
  control1: DiagramPoint;
  control2: DiagramPoint;
  to: DiagramPoint;
}

const ARROW_LENGTH = 24;
const ARROW_SPREAD = Math.PI / 6;

export function mapDiagramPoint(
  point: readonly [number, number],
  canvas: LayoutBox,
): DiagramPoint {
  return [canvas.x + point[0] * canvas.width, canvas.y + point[1] * canvas.height];
}

export function smoothThroughPoints(
  points: readonly DiagramPoint[],
  tension = 0.55,
): CubicSegment[] {
  if (points.length < 3) return [];
  const strength = Math.max(0, Math.min(1, tension)) / 6;
  return points.slice(0, -1).map((from, index) => {
    const to = points[index + 1];
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 2)];
    return {
      from,
      control1: [
        from[0] + (to[0] - previous[0]) * strength,
        from[1] + (to[1] - previous[1]) * strength,
      ],
      control2: [
        to[0] - (next[0] - from[0]) * strength,
        to[1] - (next[1] - from[1]) * strength,
      ],
      to,
    };
  });
}

export function cubicPath(segments: readonly CubicSegment[]): string {
  if (!segments.length) return "";
  const first = segments[0].from;
  return [
    `M ${first[0]} ${first[1]}`,
    ...segments.map(
      ({ control1, control2, to }) =>
        `C ${control1[0]} ${control1[1]} ${control2[0]} ${control2[1]} ${to[0]} ${to[1]}`,
    ),
  ].join(" ");
}

export function sampleCubicSegments(
  segments: readonly CubicSegment[],
  samplesPerSegment = 12,
): DiagramPoint[] {
  if (!segments.length) return [];
  const result: DiagramPoint[] = [segments[0].from];
  for (const segment of segments) {
    for (let sample = 1; sample <= samplesPerSegment; sample += 1) {
      const t = sample / samplesPerSegment;
      result.push([
        cubicAt(segment.from[0], segment.control1[0], segment.control2[0], segment.to[0], t),
        cubicAt(segment.from[1], segment.control1[1], segment.control2[1], segment.to[1], t),
      ]);
    }
  }
  return result;
}

export function diagramArcPoints(
  primitive: Extract<DiagramPrimitive, { kind: "arc" }>,
  canvas: LayoutBox,
): DiagramPoint[] {
  return arcSamplePoints(
    mapDiagramPoint(primitive.center, canvas),
    primitive.radius[0] * canvas.width,
    primitive.radius[1] * canvas.height,
    primitive.start_deg,
    primitive.end_deg,
  );
}

/**
 * Samples of an elliptical arc in board pixels. Angles are screen degrees
 * (clockwise, y down), one sample per 8° and at least eight segments.
 */
export function arcSamplePoints(
  center: readonly [number, number],
  radiusX: number,
  radiusY: number,
  startDeg: number,
  endDeg: number,
): DiagramPoint[] {
  const sweep = endDeg - startDeg;
  const samples = Math.max(8, Math.ceil(Math.abs(sweep) / 8));
  return Array.from({ length: samples + 1 }, (_, index) => {
    const angle = ((startDeg + (sweep * index) / samples) * Math.PI) / 180;
    return [
      center[0] + Math.cos(angle) * radiusX,
      center[1] + Math.sin(angle) * radiusY,
    ];
  });
}

export function diagramPrimitiveBounds(
  primitive: DiagramPrimitive,
  canvas: LayoutBox,
  tension = 0.55,
): LayoutBox {
  const points: DiagramPoint[] = [];
  if (primitive.kind === "line" || primitive.kind === "smooth") {
    const mapped = primitive.points.map((point) => mapDiagramPoint(point, canvas));
    if (primitive.kind === "smooth") {
      const segments = smoothThroughPoints(mapped, tension);
      const bounds = cubicBounds(segments);
      points.push([bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y + bounds.height]);
      if (primitive.arrow) points.push(...arrowHeadPoints(segments.at(-1)!.to, segments.at(-1)!.control2));
    } else {
      points.push(...mapped);
      if (primitive.arrow) points.push(...arrowHeadPoints(mapped.at(-1)!, mapped.at(-2)!));
    }
  } else if (primitive.kind === "rect") {
    const from = mapDiagramPoint(primitive.from, canvas);
    const to = mapDiagramPoint(primitive.to, canvas);
    points.push(from, to);
  } else if (primitive.kind === "ellipse") {
    const center = mapDiagramPoint(primitive.center, canvas);
    points.push(
      [center[0] - primitive.radius[0] * canvas.width, center[1] - primitive.radius[1] * canvas.height],
      [center[0] + primitive.radius[0] * canvas.width, center[1] + primitive.radius[1] * canvas.height],
    );
  } else if (primitive.kind === "arc") {
    points.push(...diagramArcExtrema(primitive, canvas));
    if (primitive.arrow) {
      const arc = diagramArcPoints(primitive, canvas);
      points.push(...arrowHeadPoints(arc.at(-1)!, arc.at(-2)!));
    }
  } else if (primitive.kind === "text") {
    return diagramTextBounds(primitive, canvas);
  } else {
    const point = mapDiagramPoint(primitive.at, canvas);
    points.push([point[0] - 8, point[1] - 8], [point[0] + 8, point[1] + 8]);
  }
  return boundsOfPoints(points);
}

/** Advance of the monospace label font (`.board-axis-label`: SF Mono, Menlo) per pixel of size. */
export const LABEL_CHARACTER_EM = 0.6;

export function diagramTextFontSize(
  primitive: Extract<DiagramPrimitive, { kind: "text" }>,
): number {
  return primitive.size === "small" ? 24 : primitive.size === "large" ? 40 : 31;
}

export function diagramTextBounds(
  primitive: Extract<DiagramPrimitive, { kind: "text" }>,
  canvas: LayoutBox,
): LayoutBox {
  const [x, baseline] = mapDiagramPoint(primitive.at, canvas);
  const fontSize = diagramTextFontSize(primitive);
  const width = Math.max(fontSize * 0.65, primitive.content.length * fontSize * LABEL_CHARACTER_EM);
  const left = primitive.align === "right"
    ? x - width
    : primitive.align === "center"
      ? x - width / 2
      : x;
  return { x: left, y: baseline - fontSize, width, height: fontSize * 1.25 };
}

export function diagramBounds(
  primitives: readonly DiagramPrimitive[],
  canvas: LayoutBox,
  tension = 0.55,
  padding = 30,
): LayoutBox {
  const boxes = primitives.map((primitive) => diagramPrimitiveBounds(primitive, canvas, tension));
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    x: left - padding,
    y: top - padding,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2,
  };
}

export function arrowHeadPoints(end: DiagramPoint, tangentFrom: DiagramPoint): DiagramPoint[] {
  const angle = Math.atan2(end[1] - tangentFrom[1], end[0] - tangentFrom[0]);
  return [
    end,
    [
      end[0] - Math.cos(angle - ARROW_SPREAD) * ARROW_LENGTH,
      end[1] - Math.sin(angle - ARROW_SPREAD) * ARROW_LENGTH,
    ],
    [
      end[0] - Math.cos(angle + ARROW_SPREAD) * ARROW_LENGTH,
      end[1] - Math.sin(angle + ARROW_SPREAD) * ARROW_LENGTH,
    ],
  ];
}

export function cubicBounds(segments: readonly CubicSegment[]): LayoutBox {
  const points: DiagramPoint[] = [];
  for (const segment of segments) {
    points.push(segment.from, segment.to);
    const roots = new Set([
      ...cubicExtrema(segment.from[0], segment.control1[0], segment.control2[0], segment.to[0]),
      ...cubicExtrema(segment.from[1], segment.control1[1], segment.control2[1], segment.to[1]),
    ]);
    for (const t of roots) {
      points.push([
        cubicAt(segment.from[0], segment.control1[0], segment.control2[0], segment.to[0], t),
        cubicAt(segment.from[1], segment.control1[1], segment.control2[1], segment.to[1], t),
      ]);
    }
  }
  return boundsOfPoints(points);
}

function cubicAt(start: number, control1: number, control2: number, end: number, t: number): number {
  const inverse = 1 - t;
  return (
    inverse ** 3 * start +
    3 * inverse ** 2 * t * control1 +
    3 * inverse * t ** 2 * control2 +
    t ** 3 * end
  );
}

function cubicExtrema(start: number, control1: number, control2: number, end: number): number[] {
  const a = -start + 3 * control1 - 3 * control2 + end;
  const b = 2 * (start - 2 * control1 + control2);
  const c = control1 - start;
  if (Math.abs(a) < 1e-9) return Math.abs(b) < 1e-9 ? [] : validRoots([-c / b]);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return validRoots([(-b + root) / (2 * a), (-b - root) / (2 * a)]);
}

function validRoots(values: readonly number[]): number[] {
  return values.filter((value) => value > 0 && value < 1);
}

function diagramArcExtrema(
  primitive: Extract<DiagramPrimitive, { kind: "arc" }>,
  canvas: LayoutBox,
): DiagramPoint[] {
  return arcExtremaPoints(
    mapDiagramPoint(primitive.center, canvas),
    primitive.radius[0] * canvas.width,
    primitive.radius[1] * canvas.height,
    primitive.start_deg,
    primitive.end_deg,
  );
}

/** The arc's endpoints and every axis extreme on its sweep (screen degrees), for exact bounds. */
export function arcExtremaPoints(
  center: readonly [number, number],
  radiusX: number,
  radiusY: number,
  startDeg: number,
  endDeg: number,
): DiagramPoint[] {
  const start = (startDeg * Math.PI) / 180;
  const sweep = ((endDeg - startDeg) * Math.PI) / 180;
  const candidates = [start, start + sweep, 0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  return candidates
    .filter((angle) => angleOnSweep(angle, start, sweep))
    .map((angle) => [center[0] + Math.cos(angle) * radiusX, center[1] + Math.sin(angle) * radiusY]);
}

function angleOnSweep(angle: number, start: number, sweep: number): boolean {
  if (Math.abs(sweep) >= Math.PI * 2) return true;
  const normalize = (value: number) => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const distance = sweep >= 0 ? normalize(angle - start) : normalize(start - angle);
  return distance <= Math.abs(sweep) + 1e-9;
}

function boundsOfPoints(points: readonly DiagramPoint[]): LayoutBox {
  const left = Math.min(...points.map((point) => point[0]));
  const top = Math.min(...points.map((point) => point[1]));
  const right = Math.max(...points.map((point) => point[0]));
  const bottom = Math.max(...points.map((point) => point[1]));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
