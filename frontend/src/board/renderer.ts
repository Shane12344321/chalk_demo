import { opProgress } from "./animation";
import type { ScenePipeline } from "./boardRendererConfig";
import type { NormalizedLesson } from "./decode";
import {
  BoardGeometryStore,
  type BoardGeometry,
  type GeometryBuildResult,
} from "./geometry";
import {
  analyzeBoardOccupancy,
  findReadingOrderConflicts,
  layoutSteps,
  type BoardOccupancyExpectations,
} from "./layout";
import {
  groupLayoutLintIssues,
  lintBoardGeometry,
  type LayoutLintIssue,
} from "./layoutLint";
import {
  buildVisibleBoardSnapshot,
  type VisibleBoardSnapshot,
} from "./manifest";
import { measurableRootsForSteps } from "./premeasureLesson";
import type { PrecommitMeasurementCache, RootMeasurement } from "./precommitMeasurement";
import { compileLegacy } from "./scene/compileLegacy";
import { SceneGeometryStore } from "./scene/render";
import type { Scene } from "./scene/types";

export type BoardRendererKind = "rough-svg" | "tldraw";

export interface PreparedBoard {
  lesson: NormalizedLesson;
  build: GeometryBuildResult;
  layoutIssues: LayoutLintIssue[];
  /** The compiled scene IR on the `scene` pipeline. */
  scene?: Scene;
}

export interface BoardRenderContext {
  /** Validated plan intent translated into browser-owned occupancy expectations. */
  occupancyExpectations?: BoardOccupancyExpectations;
}

export interface BoardRenderer {
  readonly kind: BoardRendererKind;
  readonly pipeline: ScenePipeline;
  prepareLesson(lesson: NormalizedLesson, context?: BoardRenderContext): PreparedBoard;
  geometryProgress(
    prepared: PreparedBoard,
    geometry: BoardGeometry,
    currentStepIndex: number,
    currentStepProgress: number,
  ): number;
  visibleSnapshot(
    prepared: PreparedBoard,
    currentStepIndex: number,
    currentStepProgress: number,
  ): VisibleBoardSnapshot;
}

/**
 * Renderer-neutral model for the accepted SVG/rough.js board. React remains
 * responsible only for painting the prepared geometry; lesson layout, manifest
 * truth and diagnostics now cross one replaceable boundary.
 */
export class RoughSvgBoardRenderer implements BoardRenderer {
  readonly kind = "rough-svg" as const;
  private readonly geometryStore = new BoardGeometryStore();
  private readonly sceneStore = new SceneGeometryStore();

  constructor(
    private readonly measurementCache?: PrecommitMeasurementCache,
    readonly pipeline: ScenePipeline = "legacy",
  ) {}

  prepareLesson(lesson: NormalizedLesson, context: BoardRenderContext = {}): PreparedBoard {
    const measurements = new Map<string, RootMeasurement>();
    for (const root of measurableRootsForSteps(lesson.steps)) {
      const measurement = this.measurementCache?.lookup(root);
      if (measurement) measurements.set(root.id, measurement);
    }
    const layoutWarnings: GeometryBuildResult["warnings"] = [];
    const laidOut = layoutSteps(lesson.steps, {
      measurements,
      occupancyExpectations: context.occupancyExpectations,
      onWarning: ({ id, code }) => {
        // Only closed renderer-owned codes cross this boundary; exception text
        // remains local and cannot leak into continuation evidence.
        layoutWarnings.push({
          id,
          detail: code === "missing_dependency"
            ? "layout:missing_dependency"
            : `construction:${code}`,
        });
      },
    });
    // Schema-1.5 figures exist only in the scene IR, so a lesson that uses
    // them always takes the scene pipeline whatever the flag says.
    const usesScene = this.pipeline === "scene" ||
      lesson.steps.some((step) => step.ops.some((op) => op.op === "figure"));
    const scene = usesScene ? compileLegacy(laidOut) : undefined;
    const geometryBuild = scene ? this.sceneStore.build(scene) : this.geometryStore.build(laidOut);
    const build = {
      ...geometryBuild,
      warnings: [...layoutWarnings, ...geometryBuild.warnings],
    };
    return {
      lesson,
      build,
      ...(scene ? { scene } : {}),
      layoutIssues: groupLayoutLintIssues([
        ...lintBoardGeometry(build.geometries),
        ...analyzeBoardOccupancy(laidOut, context.occupancyExpectations).findings,
        ...findReadingOrderConflicts(laidOut, lesson.steps),
        ...[...measurements.values()]
          .filter((measurement) => measurement.evidence === "estimated")
          .map((measurement): LayoutLintIssue => ({
            code: "measurement_unavailable",
            elementIds: [measurement.id],
          })),
      ]),
    };
  }

  geometryProgress(
    prepared: PreparedBoard,
    geometry: BoardGeometry,
    currentStepIndex: number,
    currentStepProgress: number,
  ): number {
    if (geometry.stepIndex < currentStepIndex) return 1;
    if (geometry.stepIndex > currentStepIndex) return 0;
    const step = prepared.lesson.steps[geometry.stepIndex];
    return step ? opProgress(step.ops, geometry.opIndex, currentStepProgress) : 0;
  }

  visibleSnapshot(
    prepared: PreparedBoard,
    currentStepIndex: number,
    currentStepProgress: number,
  ): VisibleBoardSnapshot {
    const visible = prepared.build.geometries.map((geometry) => ({
      geometry,
      progress: this.geometryProgress(
        prepared,
        geometry,
        currentStepIndex,
        currentStepProgress,
      ),
    }));
    // A transform's source stays listed until the morph commits; a freeze
    // mid-morph therefore publishes the source, never a half-shape.
    const replaced = new Set(
      visible
        .filter(({ geometry, progress }) => geometry.takesOver && progress >= 0.999)
        .map(({ geometry }) => geometry.takesOver!),
    );
    return buildVisibleBoardSnapshot(
      prepared.lesson.title,
      visible.filter(({ geometry }) => !replaced.has(geometry.id)),
    );
  }
}
