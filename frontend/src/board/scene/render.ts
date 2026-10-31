import { EQUATION_BASE_FONT_PX } from "../equationSizing";
import type { BoardGeometry, BoardPath, GeometryBuildResult } from "../geometry";
import { renderSafeLatex } from "../latex";
import type { LayoutBox } from "../layout";
import { manifestPartId } from "../opDescriptions";
import { inkGenerator, padBox, paddedPointBounds, stableSeed, type InkGenerator } from "../roughInk";
import { expandMarks, type PlacedMark } from "./expand";
import { frameTransform, type FrameTransform } from "./frame";
import { placeBoardLabels } from "./labelSolver";
import { renderFrame, renderMark, type RenderedMark } from "./marks";
import { alignInk, cubicSubpaths } from "./morph";
import { closedOutlines, withOutwardLabels } from "./outward";
import { GeometryReferenceError, orderMarks, RefResolver, type MarkHandle, type Pixel } from "./refs";
import type { Frame, Scene, SceneElement } from "./types";

/**
 * Scene → board geometry. Elements render in commit order; an element's
 * marks render in dependency order and are assembled in authoring order, so
 * a stroke's position in the SVG never depends on how its references were
 * resolved. A failing mark is skipped with its dependents (structured
 * warning); an element with nothing left to draw is dropped. Geometry is
 * cached per element signature, so streaming a later step reuses earlier
 * ink unchanged (stable rough seeds, no re-roughening).
 */

type Warning = GeometryBuildResult["warnings"][number];

interface CacheEntry {
  signature: string;
  geometry: BoardGeometry | undefined;
  handles: MarkHandle[];
  warnings: Warning[];
}

export class SceneGeometryStore {
  private readonly cache = new Map<string, CacheEntry>();

  build(scene: Scene): GeometryBuildResult {
    const frames = new Map(scene.frames.map((frame) => [frame.id, frame]));
    const transforms = new Map<string, FrameTransform>();
    const handles = new Map<string, MarkHandle>();
    const signatures = new Map<string, string>();
    const owners = new Map<string, string>();
    const built = new Map<string, BoardGeometry>();
    // Ideal centre-lines each element drew, and each frame's elements so far:
    // outward labels read the whole figure drawn before them.
    const inkByElement = new Map<string, Pixel[][]>();
    const frameMembers = new Map<string, string[]>();
    const geometries: BoardGeometry[] = [];
    const warnings: Warning[] = [];
    const generator = inkGenerator();
    const placedByElement = scene.elements.map((element) => {
      try {
        return expandMarks(element.marks);
      } catch {
        return undefined;
      }
    });
    const pendingIds = new Map<string, number>();
    for (const placed of placedByElement) {
      for (const mark of placed ?? []) pendingIds.set(mark.id, (pendingIds.get(mark.id) ?? 0) + 1);
    }

    scene.elements.forEach((element, index) => {
      const placed = placedByElement[index];
      for (const mark of placed ?? []) {
        const left = (pendingIds.get(mark.id) ?? 1) - 1;
        if (left > 0) pendingIds.set(mark.id, left);
        else pendingIds.delete(mark.id);
      }
      if (!placed) {
        warnings.push({ id: element.id, detail: "scene:mark_budget" });
        return;
      }
      const frame = element.frame === undefined ? undefined : frames.get(element.frame);
      const priorInFrame = frame?.labelSide ? frameMembers.get(frame.id) ?? [] : [];
      // An element whose labels read earlier figure ink re-renders when that ink changes.
      const signature = elementSignature(element, frame, placed, owners, signatures, priorInFrame);
      // Dependents key on a short digest so signatures do not grow along reference chains.
      signatures.set(element.id, `${stableSeed(signature).toString(36)}:${signature.length}`);
      for (const mark of placed) owners.set(mark.id, element.id);

      let entry = this.cache.get(element.id);
      if (entry?.signature !== signature) {
        entry = {
          signature,
          ...renderElement(element, placed, {
            frame,
            transforms,
            handles,
            later: new Set(pendingIds.keys()),
            generator,
            earlier: built,
            priorInk: priorInFrame.flatMap((id) => inkByElement.get(id) ?? []),
          }),
        };
        this.cache.set(element.id, entry);
      }
      inkByElement.set(element.id, entry.handles.flatMap((handle) => handle.polylines));
      if (frame) frameMembers.set(frame.id, [...(frameMembers.get(frame.id) ?? []), element.id]);
      for (const handle of entry.handles) handles.set(handle.id, handle);
      warnings.push(...entry.warnings);
      if (entry.geometry) {
        geometries.push(entry.geometry);
        built.set(element.id, entry.geometry);
      }
    });

    const live = new Set(scene.elements.map((element) => element.id));
    for (const id of this.cache.keys()) if (!live.has(id)) this.cache.delete(id);
    return { geometries: placeBoardLabels(geometries), warnings };
  }
}

interface RenderEnvironment {
  frame: Frame | undefined;
  transforms: Map<string, FrameTransform>;
  handles: ReadonlyMap<string, MarkHandle>;
  later: ReadonlySet<string>;
  generator: InkGenerator;
  earlier: ReadonlyMap<string, BoardGeometry>;
  /** Ideal centre-lines drawn earlier in this element's frame (figure frames only). */
  priorInk: readonly Pixel[][];
}

function renderElement(
  element: SceneElement,
  placed: readonly PlacedMark[],
  environment: RenderEnvironment,
): Omit<CacheEntry, "signature"> {
  const warnings: Warning[] = [];
  const ownHandles: MarkHandle[] = [];
  const base: BoardGeometry = {
    id: element.id,
    kind: element.kind,
    box: element.box,
    ...(element.canvasBox ? { canvasBox: element.canvasBox } : {}),
    paths: [],
    labels: [],
    manifestSummary: element.summary,
    stepIndex: element.stepIndex,
    opIndex: element.opIndex,
  };
  if (element.note) {
    const geometry = "text" in element.note
      ? { ...base, text: element.note.text }
      : {
          ...base,
          equationHtml: renderSafeLatex(element.note.tex),
          equationFontSize: EQUATION_BASE_FONT_PX,
        };
    return { geometry, handles: ownHandles, warnings };
  }
  try {
    const frame = environment.frame;
    if (!frame) throw new Error(`Element ${element.id} has no frame.`);
    let transform = environment.transforms.get(frame.id);
    if (!transform) {
      transform = frameTransform(frame);
      environment.transforms.set(frame.id, transform);
    }
    const handles = new Map(environment.handles);
    const resolver = new RefResolver(handles);
    const order = orderMarks(placed, new Set(environment.handles.keys()), environment.later);
    for (const { code } of order.failed) warnings.push({ id: element.id, detail: `scene:${code}` });
    const rendered = new Map<string, RenderedMark>();
    for (const item of order.ordered) {
      try {
        const mark = renderMark(item, {
          elementId: element.id,
          frame: transform,
          resolver,
          generator: environment.generator,
        });
        rendered.set(item.id, mark);
        handles.set(item.id, mark.handle);
        ownHandles.push(mark.handle);
      } catch (error) {
        warnings.push({
          id: element.id,
          detail: error instanceof GeometryReferenceError ? `scene:${error.code}` : "scene:mark_failed",
        });
      }
    }
    if (rendered.size === 0 && !element.drawsFrame) {
      throw new Error(`Element ${element.id} has no drawable marks.`);
    }
    const labelSide = frame.labelSide;
    const figureInk = labelSide
      ? [...environment.priorInk, ...[...rendered.values()].flatMap((mark) => mark.handle.polylines)]
      : [];
    const outlines = closedOutlines(figureInk);
    const marks = placed.flatMap((item) => {
      const mark = rendered.get(item.id);
      if (!mark) return [];
      return labelSide ? [withOutwardLabels(item, mark, { ink: figureInk, outlines }, transform, labelSide)] : [mark];
    });
    const decoration = element.drawsFrame
      ? renderFrame(transform, environment.generator, element.parts ? -2 : 0)
      : { paths: [], labels: [] };
    const extent = marks.flatMap((mark) => mark.extent).map(([x, y]) => [x, y] as [number, number]);
    if (element.sizing === "ink" && extent.length === 0) {
      throw new Error(`Element ${element.id} has no ink to size.`);
    }
    let geometry: BoardGeometry = {
      ...base,
      box: element.sizing === "slot" ? element.box : paddedPointBounds(extent),
      paths: withSubpaths([...decoration.paths, ...marks.flatMap((mark) => mark.paths)]),
      labels: [...decoration.labels, ...marks.flatMap((mark) => mark.labels)],
    };
    if (element.parts) geometry = { ...geometry, ...manifestParts(element, placed, rendered) };
    if (element.motion) {
      geometry = withMotion(geometry, element, environment.earlier, warnings);
    }
    return { geometry, handles: ownHandles, warnings };
  } catch (error) {
    warnings.push({
      id: element.id,
      detail: error instanceof GeometryReferenceError
        ? `scene:${error.code}`
        : error instanceof Error ? error.message : "Geometry generation failed.",
    });
    return { geometry: undefined, handles: [], warnings };
  }
}

function manifestParts(
  element: SceneElement,
  placed: readonly PlacedMark[],
  rendered: ReadonlyMap<string, RenderedMark>,
): Pick<BoardGeometry, "inkBounds" | "manifestParts"> {
  const parts = element.marks.flatMap((mark, index) => {
    const boxes = placed
      .filter((item) => item.top === index)
      .flatMap((item) => rendered.get(item.id)?.bounds ?? []);
    return boxes.length === 0 ? [] : [{ mark, index, bounds: unionBoxes(boxes) }];
  });
  return {
    inkBounds: parts.map(({ bounds }) => bounds),
    manifestParts: parts.map(({ mark, index, bounds }) => ({
      id: manifestPartId(element.id, index),
      kind: element.kind,
      box: padBox(bounds, 18),
      summary: mark.meaning ?? mark.kind,
      revealGroup: mark.group ?? index,
    })),
  };
}

function withMotion(
  geometry: BoardGeometry,
  element: SceneElement,
  earlier: ReadonlyMap<string, BoardGeometry>,
  warnings: Warning[],
): BoardGeometry {
  const motion = element.motion!;
  if (motion.kind !== "transform") return { ...geometry, motion };
  const source = earlier.get(motion.from);
  if (!source) {
    warnings.push({ id: element.id, detail: "scene:unknown_reference" });
    return geometry;
  }
  const strokes = (paths: readonly BoardPath[]) =>
    paths.filter((path) => path.fill === "none" && path.stroke !== "transparent").map((path) => path.d);
  const lead = geometry.paths.find((path) => path.fill === "none" && path.stroke !== "transparent");
  return {
    ...geometry,
    motion,
    // Aligned once here (Manim's `begin`); every frame only interpolates.
    morph: {
      ...alignInk(strokes(source.paths), strokes(geometry.paths)),
      stroke: lead?.stroke ?? "#2b2e36",
      strokeWidth: lead?.strokeWidth ?? 4,
    },
    takesOver: source.id,
  };
}

function withSubpaths(paths: readonly BoardPath[]): BoardPath[] {
  return paths.map((path) => {
    if (path.stroke === "transparent") return path;
    try {
      return { ...path, subpaths: cubicSubpaths(path.d) };
    } catch {
      return path;
    }
  });
}

function elementSignature(
  element: SceneElement,
  frame: Frame | undefined,
  placed: readonly PlacedMark[],
  owners: ReadonlyMap<string, string>,
  signatures: ReadonlyMap<string, string>,
  priorInFrame: readonly string[],
): string {
  const own = new Set(placed.map((item) => item.id));
  const dependencies = [...new Set(
    placed.flatMap((item) => item.dependencies).filter((id) => !own.has(id)),
  )].map((id) => {
    const owner = owners.get(id);
    return owner ? signatures.get(owner) ?? "" : `missing:${id}`;
  });
  if (element.motion?.kind === "transform") dependencies.push(signatures.get(element.motion.from) ?? "");
  dependencies.push(...priorInFrame.map((id) => signatures.get(id) ?? ""));
  return JSON.stringify([element, frame, dependencies]);
}

function unionBoxes(boxes: readonly LayoutBox[]): LayoutBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
