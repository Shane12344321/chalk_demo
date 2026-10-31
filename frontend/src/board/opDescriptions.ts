import type { DiagramPrimitive } from "./lesson.generated";
import { stableSeed } from "./roughInk";

/** Manifest and axis wording for schema ops, shared by both board pipelines. */

export function describeDiagramPrimitive(primitive: DiagramPrimitive): string {
  if (primitive.meaning) return primitive.meaning;
  const name = primitive.kind !== "text" && primitive.label ? `${primitive.label}: ` : "";
  if (primitive.kind === "line" || primitive.kind === "smooth") {
    const from = primitive.points[0];
    const to = primitive.points.at(-1)!;
    return `${name}${primitive.stroke}${primitive.arrow ? " arrow" : ` ${primitive.kind}`} from ${qualitativePoint(from)} to ${qualitativePoint(to)}`;
  }
  if (primitive.kind === "rect") {
    return `${name}${primitive.fill ? "filled " : ""}rectangle from ${qualitativePoint(primitive.from)} to ${qualitativePoint(primitive.to)}`;
  }
  if (primitive.kind === "ellipse") {
    return `${name}${primitive.fill ? "filled " : ""}ellipse at ${qualitativePoint(primitive.center)}`;
  }
  if (primitive.kind === "arc") {
    return `${name}${primitive.stroke} arc at ${qualitativePoint(primitive.center)} from ${primitive.start_deg}° to ${primitive.end_deg}°${primitive.arrow ? " with arrow" : ""}`;
  }
  if (primitive.kind === "text") {
    return `writing "${primitive.content}" at ${qualitativePoint(primitive.at)}`;
  }
  return `${name}point at ${qualitativePoint(primitive.at)}`;
}

export function qualitativePoint([x, y]: readonly [number, number]): string {
  const horizontal = x < 0.34 ? "left" : x > 0.66 ? "right" : "center";
  const vertical = y < 0.34 ? "upper" : y > 0.66 ? "lower" : "middle";
  return vertical === "middle" && horizontal === "center"
    ? "center"
    : vertical === "middle"
      ? horizontal
      : horizontal === "center"
        ? `${vertical} center`
        : `${vertical}-${horizontal}`;
}

export function manifestPartId(parentId: string, index: number): string {
  return `p${stableSeed(parentId).toString(36).slice(0, 7)}_${index}`;
}

export function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Axis range labels: integers as-is, simple multiples of π as π, else 3 significant figures. */
export function formatAxisValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  for (const denominator of [1, 2, 3, 4, 6]) {
    const multiple = (value * denominator) / Math.PI;
    const rounded = Math.round(multiple);
    if (rounded !== 0 && Math.abs(multiple - rounded) < 1e-4) {
      const coefficient = rounded === 1 ? "" : rounded === -1 ? "-" : String(rounded);
      return `${coefficient}π${denominator === 1 ? "" : `/${denominator}`}`;
    }
  }
  return String(Number(value.toPrecision(3)));
}
