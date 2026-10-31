import { isLiteral, markDependencies } from "./refs";
import type { LineSpec, Mark, PointRef, RegionSpec, Transform, Vec2 } from "./types";

/**
 * Group expansion: groups become plain marks carrying the affine map from
 * group-local to frame coordinates. Repeats copy their children with fresh
 * IDs (`id~k`), and references between children of one copy follow the copy.
 * References to marks outside the group keep naming rendered ink, untouched.
 */

/** x' = a·x + c·y + e, y' = b·x + d·y + f (frame coordinates). */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function isIdentity(m: Affine): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

/** Only a shift: shapes keep their exact rough.js primitives. */
export function isTranslation(m: Affine): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
}

export function applyAffine(m: Affine, [x, y]: Vec2): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/** `outer ∘ inner`: apply `inner`, then `outer`. */
export function compose(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/** Scale, then rotate, then mirror (all about `origin`), then translate. */
export function transformMatrix(transform: Transform): Affine {
  const [ox, oy] = transform.origin ?? [0, 0];
  const [sx, sy] = typeof transform.scale === "number"
    ? [transform.scale, transform.scale]
    : transform.scale ?? [1, 1];
  const radians = ((transform.rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const mx = transform.mirror === "x" ? -1 : 1;
  const my = transform.mirror === "y" ? -1 : 1;
  const linear: Affine = {
    a: mx * cos * sx,
    b: my * sin * sx,
    c: mx * -sin * sy,
    d: my * cos * sy,
    e: 0,
    f: 0,
  };
  const [tx, ty] = transform.translate ?? [0, 0];
  const shifted = applyAffine(linear, [-ox, -oy]);
  return { ...linear, e: shifted[0] + ox + tx, f: shifted[1] + oy + ty };
}

export type LeafMark = Exclude<Mark, { kind: "group" }>;

export interface PlacedMark {
  /** Scene-unique ID (repeat copies are suffixed `~k`). */
  id: string;
  mark: LeafMark;
  affine: Affine;
  /** Reveal group: the mark's own, else its outermost group's. */
  group?: number;
  /** Index of the top-level mark this came from (manifest part). */
  top: number;
  dependencies: string[];
}

const MAX_EXPANDED_MARKS = 256;

export function expandMarks(marks: readonly Mark[]): PlacedMark[] {
  const placed: PlacedMark[] = [];
  const visit = (mark: Mark, affine: Affine, group: number | undefined, top: number) => {
    if (placed.length >= MAX_EXPANDED_MARKS) {
      throw new Error("Scene group expansion exceeds the mark budget.");
    }
    const ownGroup = mark.group ?? group;
    if (mark.kind !== "group") {
      placed.push({
        id: mark.id,
        mark,
        affine,
        ...(ownGroup === undefined ? {} : { group: ownGroup }),
        top,
        dependencies: markDependencies(mark),
      });
      return;
    }
    const base = mark.transform ? compose(affine, transformMatrix(mark.transform)) : affine;
    const count = Math.max(1, Math.min(32, Math.floor(mark.repeat?.count ?? 1)));
    const step = mark.repeat ? transformMatrix(mark.repeat.transform) : IDENTITY;
    let copy = base;
    for (let k = 0; k < count; k += 1) {
      const children = k === 0 ? mark.marks : renameCopy(mark.marks, k);
      for (const child of children) visit(child, copy, ownGroup, top);
      copy = compose(copy, step);
    }
  };
  marks.forEach((mark, index) => visit(mark, IDENTITY, undefined, index));
  return placed;
}

function renameCopy(marks: readonly Mark[], k: number): Mark[] {
  const ids = new Map<string, string>();
  const collect = (mark: Mark) => {
    ids.set(mark.id, `${mark.id}~${k}`);
    if (mark.kind === "group") mark.marks.forEach(collect);
  };
  marks.forEach(collect);
  const id = (value: string) => ids.get(value) ?? value;
  return marks.map((mark) => renameMark(mark, id, k));
}

function renameMark(source: Mark, id: (value: string) => string, k: number): Mark {
  // Each copy draws with its own seeds, so repeats are not identical strokes.
  const mark = source.seed ? { ...source, seed: `${source.seed}~${k}` } as Mark : source;
  const ref = (value: PointRef): PointRef => renameRef(value, id);
  const base = { ...mark, id: id(mark.id) };
  switch (mark.kind) {
    case "point":
      return { ...mark, id: id(mark.id), at: ref(mark.at) };
    case "path":
      return { ...mark, id: id(mark.id), points: mark.points.map(ref) };
    case "line":
      return { ...mark, id: id(mark.id), line: renameLine(mark.line, id) };
    case "vector":
    case "measure":
      return { ...mark, id: id(mark.id), from: ref(mark.from), to: ref(mark.to) };
    case "circle":
    case "ellipse":
    case "arc":
      return { ...mark, id: id(mark.id), center: ref(mark.center) };
    case "angle":
      return {
        ...mark,
        id: id(mark.id),
        vertex: ref(mark.vertex),
        angle: "rays" in mark.angle
          ? { rays: [ref(mark.angle.rays[0]), ref(mark.angle.rays[1])] }
          : mark.angle,
      };
    case "label":
      return { ...mark, id: id(mark.id), at: ref(mark.at) };
    case "region":
      return { ...mark, id: id(mark.id), region: renameRegion(mark.region, id) };
    case "group":
      return { ...mark, id: id(mark.id), marks: mark.marks.map((child) => renameMark(child, id, k)) };
    default:
      return base;
  }
}

function renameRef(ref: PointRef, id: (value: string) => string): PointRef {
  if (isLiteral(ref)) return ref;
  if ("at" in ref) return { at: id(ref.at) };
  if ("end" in ref) return { end: id(ref.end), which: ref.which };
  if ("mid" in ref) return { mid: [renameRef(ref.mid[0], id), renameRef(ref.mid[1], id)] };
  if ("on" in ref) return "t" in ref ? { on: id(ref.on), t: ref.t } : { on: id(ref.on), x: ref.x };
  if ("hit" in ref) return { hit: [id(ref.hit[0]), id(ref.hit[1])] };
  if ("foot" in ref) return { foot: renameRef(ref.foot, id), onto: id(ref.onto) };
  return { ...ref, beside: id(ref.beside) };
}

function renameLine(line: LineSpec, id: (value: string) => string): LineSpec {
  if ("from" in line) return { from: renameRef(line.from, id), to: renameRef(line.to, id) };
  if ("slope" in line) return { ...line, through: renameRef(line.through, id) };
  if ("tangentTo" in line) return { ...line, tangentTo: id(line.tangentTo) };
  return { ...line, normalTo: id(line.normalTo), through: renameRef(line.through, id) };
}

function renameRegion(region: RegionSpec, id: (value: string) => string): RegionSpec {
  if ("under" in region) return { ...region, under: id(region.under) };
  if ("between" in region) return { ...region, between: [id(region.between[0]), id(region.between[1])] };
  return { inside: id(region.inside) };
}
