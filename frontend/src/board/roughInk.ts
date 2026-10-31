import rough from "roughjs/bin/rough";
import type { PathInfo } from "roughjs/bin/core";
import type { BoardLabel, BoardPath } from "./geometry";
import type { LayoutBox } from "./layout";

/**
 * Shared rough.js stroke helpers. Both board pipelines (legacy ops and the
 * scene IR) draw through these, so a stroke with the same seed key and the
 * same points is the same ink on either path.
 */

export type InkGenerator = ReturnType<typeof rough.generator>;

export const DIAGRAM_FILL = "rgba(217, 122, 41, 0.12)";

export function inkGenerator(): InkGenerator {
  return rough.generator({
    options: {
      roughness: 1.25,
      bowing: 1.1,
      stroke: "#2b2e36",
      strokeWidth: 4,
      disableMultiStroke: false,
    },
  });
}

export function styledLinePaths(
  generator: InkGenerator,
  from: [number, number],
  to: [number, number],
  stroke: "solid" | "dashed",
  seedId: string,
  revealGroup?: number,
): BoardPath[] {
  if (stroke === "solid") return roughLinePaths(generator, from, to, seedId, revealGroup ?? 0);
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const count = Math.max(2, Math.ceil(distance / 42));
  return Array.from({ length: count }, (_, index) => {
    const start = index / count;
    const end = Math.min(1, start + 0.58 / count);
    const dashFrom: [number, number] = [
      from[0] + (to[0] - from[0]) * start,
      from[1] + (to[1] - from[1]) * start,
    ];
    const dashTo: [number, number] = [
      from[0] + (to[0] - from[0]) * end,
      from[1] + (to[1] - from[1]) * end,
    ];
    return roughLinePaths(
      generator,
      dashFrom,
      dashTo,
      `${seedId}:dash-${index}`,
      revealGroup ?? index,
    );
  }).flat();
}

export function styledPolylinePaths(
  generator: InkGenerator,
  points: readonly [number, number][],
  stroke: "solid" | "dashed",
  seedId: string,
  revealGroup?: number,
): BoardPath[] {
  if (stroke === "solid") {
    return normalizePaths(
      generator.toPaths(
        generator.linearPath([...points], { seed: stableSeed(`${seedId}:arc`) }),
      ),
      revealGroup ?? 0,
      polylineLength(points),
    );
  }
  return points.slice(1).flatMap((to, index) =>
    styledLinePaths(
      generator,
      points[index],
      to,
      "dashed",
      `${seedId}:arc-${index}`,
      revealGroup,
    ),
  );
}

export function roughLinePaths(
  generator: InkGenerator,
  from: [number, number],
  to: [number, number],
  seedId: string,
  revealGroup: number,
): BoardPath[] {
  return normalizePaths(
    generator.toPaths(
      generator.line(from[0], from[1], to[0], to[1], {
        seed: stableSeed(seedId),
      }),
    ),
    revealGroup,
    Math.max(1, Math.hypot(to[0] - from[0], to[1] - from[1])),
  );
}

export function normalizePaths(
  paths: PathInfo[],
  revealGroup?: number,
  revealWeight?: number,
): BoardPath[] {
  return paths.map((path) => ({
    d: path.d,
    stroke: path.stroke || "#2b2e36",
    strokeWidth: path.strokeWidth || 4,
    fill: path.fill && path.fill !== "none" ? path.fill : "none",
    ...(revealGroup === undefined ? {} : { revealGroup }),
    ...(revealWeight === undefined ? {} : { revealWeight }),
  }));
}

export function ellipseCircumference(radiusX: number, radiusY: number): number {
  return Math.PI * (3 * (radiusX + radiusY) - Math.sqrt((3 * radiusX + radiusY) * (radiusX + 3 * radiusY)));
}

export function polylineLength(points: readonly [number, number][]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [previousX, previousY] = points[index - 1];
    const [x, y] = points[index];
    length += Math.hypot(x - previousX, y - previousY);
  }
  return Math.max(1, length);
}

export function paddedPointBounds(points: readonly [number, number][], padding = 18): LayoutBox {
  const left = Math.min(...points.map(([x]) => x));
  const top = Math.min(...points.map(([, y]) => y));
  const right = Math.max(...points.map(([x]) => x));
  const bottom = Math.max(...points.map(([, y]) => y));
  return {
    x: left - padding,
    y: top - padding,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2,
  };
}

export function padBox(box: LayoutBox, padding: number): LayoutBox {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
}

export function segmentLabel(
  text: string,
  from: [number, number],
  to: [number, number],
): BoardLabel {
  const length = Math.max(1, Math.hypot(to[0] - from[0], to[1] - from[1]));
  return {
    text,
    x: (from[0] + to[0]) / 2 - ((to[1] - from[1]) / length) * 20,
    y: (from[1] + to[1]) / 2 + ((to[0] - from[0]) / length) * 20,
    anchor: "middle",
    autoPlace: true,
  };
}

export function stableSeed(id: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) || 1;
}
