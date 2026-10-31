import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import "katex/dist/katex.min.css";
import type { NormalizedLesson } from "./decode";
import { configuredScenePipeline, type ScenePipeline } from "./boardRendererConfig";
import { type BoardGeometry } from "./geometry";
import { BOARD_HEIGHT, BOARD_WIDTH } from "./layout";
import {
  type VisibleBoardState,
} from "./manifest";
import { OverlayLayer, type DeixisOverlay } from "./overlays";
import { AnnotationOverlayLayer } from "./annotationOverlays";
import type { AnnotationOp } from "../annotations";
import { fitBoardText } from "./textLayout";
import { FittedEquation } from "./FittedEquation";
import { type LayoutLintIssue } from "./layoutLint";
import { revealGroupProgress, strokeRevealProgress } from "./reveal";
import { RoughSvgBoardRenderer, type BoardRenderContext } from "./renderer";
import { morphAt } from "./scene/morph";
import { interpolate } from "./scene/motion";
import { measureRenderedBoard } from "./measuredLayout";
import type { PrecommitMeasurementCache } from "./precommitMeasurement";

export interface BoardProps {
  lesson: NormalizedLesson;
  currentStepIndex: number;
  currentStepProgress: number;
  phase: string;
  onManifestChange?: (manifest: string) => void;
  onVisibleStateChange?: (state: VisibleBoardState) => void;
  overlays?: readonly DeixisOverlay[];
  annotations?: readonly AnnotationOp[];
  measurementId?: string;
  onFirstVisibleInk?: (measurementId: string, observedAtMs: number) => void;
  showDiagnostics?: boolean;
  onMeasuredLayoutFindings?: (findings: readonly LayoutLintIssue[]) => void;
  measurementCache?: PrecommitMeasurementCache;
  renderContext?: BoardRenderContext;
  /** Geometry pipeline; defaults to `VITE_CHALK_SCENE` (legacy unless set to `scene`). */
  scenePipeline?: ScenePipeline;
}

export function Board({
  lesson,
  currentStepIndex,
  currentStepProgress,
  phase,
  onManifestChange,
  onVisibleStateChange,
  overlays = [],
  annotations = [],
  measurementId,
  onFirstVisibleInk,
  showDiagnostics = false,
  onMeasuredLayoutFindings,
  measurementCache,
  renderContext,
  scenePipeline,
}: BoardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pipeline = scenePipeline ?? configuredScenePipeline(import.meta.env.VITE_CHALK_SCENE);
  const rendererRef = useRef<RoughSvgBoardRenderer>();
  if (rendererRef.current?.pipeline !== pipeline) {
    rendererRef.current = new RoughSvgBoardRenderer(measurementCache, pipeline);
  }
  const renderer = rendererRef.current;
  const prepared = useMemo(
    () => renderer.prepareLesson(lesson, renderContext),
    [lesson, renderContext, renderer],
  );
  const { build, layoutIssues } = prepared;
  const visibleSnapshot = useMemo(
    () => renderer.visibleSnapshot(prepared, currentStepIndex, currentStepProgress),
    [currentStepIndex, currentStepProgress, prepared, renderer],
  );
  const visibleVersionRef = useRef(0);
  const visibleFingerprintRef = useRef<string>();
  useEffect(() => {
    if (visibleFingerprintRef.current === visibleSnapshot.fingerprint) return;
    visibleFingerprintRef.current = visibleSnapshot.fingerprint;
    visibleVersionRef.current += 1;
    onManifestChange?.(visibleSnapshot.manifest);
    onVisibleStateChange?.({ ...visibleSnapshot, version: visibleVersionRef.current });
  }, [onManifestChange, onVisibleStateChange, visibleSnapshot]);
  useLayoutEffect(() => {
    if (!onMeasuredLayoutFindings || !svgRef.current) return;
    onMeasuredLayoutFindings(measureRenderedBoard(svgRef.current, build.geometries));
  }, [build.geometries, onMeasuredLayoutFindings]);
  const measuredRef = useRef<string>();
  useEffect(() => {
    if (!measurementId || measuredRef.current === measurementId) return;
    const hasVisibleInk = build.geometries.some(
      (geometry) =>
        renderer.geometryProgress(
          prepared,
          geometry,
          currentStepIndex,
          currentStepProgress,
        ) > 0,
    );
    if (!hasVisibleInk) return;
    measuredRef.current = measurementId;
    onFirstVisibleInk?.(measurementId, performance.now());
  }, [
    build.geometries,
    currentStepIndex,
    currentStepProgress,
    lesson,
    measurementId,
    onFirstVisibleInk,
    prepared,
    renderer,
  ]);

  return (
    <section className="chalkboard-shell" aria-label={`Animated lesson board: ${lesson.title}`}>
      <div className="board-toolbar">
        <div>
          <span className="board-live-dot" aria-hidden="true" />
          <strong>{lesson.title}</strong>
        </div>
        <span>{phase.toLowerCase()} · step {Math.min(currentStepIndex + 1, lesson.steps.length)}/{lesson.steps.length}</span>
      </div>
      <svg
        ref={svgRef}
        className="chalkboard"
        viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        role="img"
        aria-label={`A hand-drawn lesson about ${lesson.title}`}
      >
        <defs>
          <filter id="chalk-softness">
            <feGaussianBlur stdDeviation="0.16" />
          </filter>
          <marker
            id="annotation-arrowhead"
            markerHeight="8"
            markerWidth="8"
            orient="auto-start-reverse"
            refX="7"
            refY="4"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="#3a6fd8" />
          </marker>
        </defs>
        <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} rx="36" fill="transparent" />
        <path className="board-ghost-line" d="M48 300 H1552 M48 576 H1552" />
        <BoardInk
          geometries={build.geometries}
          progressOf={(geometry) =>
            renderer.geometryProgress(prepared, geometry, currentStepIndex, currentStepProgress)}
        />
        <AnnotationOverlayLayer ops={annotations} elements={visibleSnapshot.elements} />
        <OverlayLayer
          overlays={overlays}
          elements={visibleSnapshot.elements}
          geometries={build.geometries}
        />
      </svg>
      {build.warnings.length > 0 || (showDiagnostics && layoutIssues.length > 0) ? (
        <p
          className="board-warning"
          data-layout-lint-count={layoutIssues.length}
          role="status"
        >
          {build.warnings.length > 0
            ? `${build.warnings.length} invalid board operation${build.warnings.length === 1 ? "" : "s"} skipped safely.`
            : null}
          {build.warnings.length > 0 && showDiagnostics && layoutIssues.length > 0
            ? " "
            : null}
          {showDiagnostics && layoutIssues.length > 0
            ? `${layoutIssues.length} deterministic layout lint${layoutIssues.length === 1 ? "" : "s"}: ${layoutIssueSummary(layoutIssues)}.`
            : null}
        </p>
      ) : null}
    </section>
  );
}

function layoutIssueSummary(
  issues: readonly LayoutLintIssue[],
): string {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, count]) => `${code.replaceAll("_", " ")} ${count}`)
    .join(", ");
}

/**
 * Every element at its progress. A transform's source is hidden once the
 * morph starts; until then it stays on the board as committed ink.
 */
export function BoardInk({
  geometries,
  progressOf,
}: {
  geometries: readonly BoardGeometry[];
  progressOf: (geometry: BoardGeometry) => number;
}) {
  const progress = geometries.map(progressOf);
  const replaced = new Set(
    geometries.flatMap((geometry, index) =>
      geometry.takesOver && progress[index] > 0 ? [geometry.takesOver] : []),
  );
  return (
    <>
      {geometries.map((geometry, index) =>
        replaced.has(geometry.id) ? null : (
          <BoardGeometryLayer
            key={geometry.id}
            geometry={geometry}
            progress={progress[index]}
            labels="layer"
          />
        ))}
      {/* Labels sit above every stroke, with a halo in the board colour, so ink
          drawn by a later step passes behind a label instead of through it. */}
      <g data-board-layer="labels">
        {geometries.map((geometry, index) =>
          replaced.has(geometry.id) ? null : (
            <BoardLabelLayer key={geometry.id} geometry={geometry} progress={progress[index]} />
          ))}
      </g>
    </>
  );
}

/** Everything a label needs to render at this progress, shared by both label placements. */
function labelFrame(geometry: BoardGeometry, progress: number) {
  const frame = interpolate(geometry.motion, progress);
  const motionCreate = geometry.motion?.kind === "create" ? geometry.motion : undefined;
  const drawn = geometry.motion ? frame.draw : progress;
  // A hand writes labels after drawing the axes, not during the strokes.
  const isDiagram = ["diagram", "line", "arrow", "point", "angle_arc", "figure"].includes(geometry.kind);
  const labelsVisible = geometry.kind === "axes"
    ? drawn >= AXIS_LABEL_REVEAL_PROGRESS
    : !isDiagram || drawn >= DIAGRAM_LABEL_REVEAL_PROGRESS;
  const center = [geometry.box.x + geometry.box.width / 2, geometry.box.y + geometry.box.height / 2];
  const motionAttributes = {
    ...(frame.opacity === 1 ? {} : { opacity: frame.opacity }),
    ...(frame.scale === 1
      ? {}
      : {
          transform: `translate(${center[0]} ${center[1]}) scale(${frame.scale}) translate(${-center[0]} ${-center[1]})`,
        }),
  };
  return { frame, motionCreate, drawn, isDiagram, labelsVisible, motionAttributes };
}

function GeometryLabels({ geometry, progress }: { geometry: BoardGeometry; progress: number }) {
  const { motionCreate, drawn, isDiagram, labelsVisible } = labelFrame(geometry, progress);
  const clipId = `reveal-${geometry.id}`;
  return (
    <>
      {geometry.labels.map((label, index) => {
        const visible = label.revealGroup === undefined
          ? labelsVisible
          : revealGroupProgress(geometry.paths, label.revealGroup, drawn, motionCreate?.rate, motionCreate?.lag) >= 0.55;
        return visible ? (
            <text
              data-auto-place={label.autoPlace ? "true" : "false"}
              data-board-mark="label"
              key={`${geometry.id}-label-${index}`}
              className="board-axis-label"
              clipPath={isDiagram ? undefined : `url(#${clipId})`}
              style={label.fontSize ? { fontSize: `${label.fontSize}px` } : undefined}
              textAnchor={label.anchor ?? "start"}
              x={label.x}
              y={label.y}
            >
              {label.text}
            </text>
          ) : null;
      })}
    </>
  );
}

/** One element's labels in the board's top label layer. */
export function BoardLabelLayer({ geometry, progress }: { geometry: BoardGeometry; progress: number }) {
  if (progress <= 0 || geometry.labels.length === 0) return null;
  const { frame, motionAttributes } = labelFrame(geometry, progress);
  // Mid-morph the morph stroke stands in for the element; labels wait for it to land.
  if (geometry.morph && frame.morph !== undefined) return null;
  return (
    <g data-label-for={geometry.id} {...motionAttributes}>
      <GeometryLabels geometry={geometry} progress={progress} />
    </g>
  );
}

const AXIS_LABEL_REVEAL_PROGRESS = 0.85;
const DIAGRAM_LABEL_REVEAL_PROGRESS = 0.72;

export function BoardGeometryLayer({
  geometry,
  progress,
  labels = "inline",
}: {
  geometry: BoardGeometry;
  progress: number;
  /** `layer`: labels render in the board's top label layer instead (see BoardInk). */
  labels?: "inline" | "layer";
}) {
  // Board-unique: a page may show several boards that reuse element IDs.
  const maskPrefix = `holes-${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`;
  if (progress <= 0) return null;
  // Motion is a pure function of op progress (Manim's interpolate(alpha)), so
  // a frozen board shows exactly the frame it will resume from.
  const frame = interpolate(geometry.motion, progress);
  if (geometry.morph && frame.morph !== undefined) {
    return (
      <g data-element-id={geometry.id} data-kind={geometry.kind} data-progress={progress.toFixed(3)} data-motion="transform">
        <path
          data-board-mark="ink"
          d={morphAt(geometry.morph, frame.morph)}
          fill="none"
          filter="url(#chalk-softness)"
          stroke={geometry.morph.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={geometry.morph.strokeWidth}
        />
      </g>
    );
  }
  const { motionCreate, drawn, motionAttributes } = labelFrame(geometry, progress);
  const clipId = `reveal-${geometry.id}`;
  const fittedText = geometry.text ? fitBoardText(geometry.text, geometry.box) : undefined;
  return (
    <g
      data-element-id={geometry.id}
      data-kind={geometry.kind}
      data-progress={progress.toFixed(3)}
      {...motionAttributes}
    >
      <clipPath id={clipId}>
        <rect
          x={geometry.box.x - 8}
          y={geometry.box.y - 8}
          width={(geometry.box.width + 16) * drawn}
          height={geometry.box.height + 16}
        />
      </clipPath>
      {geometry.paths.map((path, index) => {
    const revealProgress = strokeRevealProgress(
      geometry.paths,
      path,
      drawn,
      motionCreate?.rate,
      motionCreate?.lag,
    );
    const maskId = `${maskPrefix}-${index}`;
        return (
        <Fragment key={`${geometry.id}-path-${index}`}>
          {path.holes ? (
            <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT}>
              <rect x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="white" />
              {path.holes.map((hole, holeIndex) => <path key={holeIndex} d={hole} fill="black" />)}
            </mask>
          ) : null}
          <path
            data-board-mark="ink"
            d={path.d}
            fill={path.fill}
            filter="url(#chalk-softness)"
            mask={path.holes ? `url(#${maskId})` : undefined}
            pathLength={1}
            stroke={path.stroke}
            strokeDasharray="1"
            strokeDashoffset={1 - revealProgress}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={path.strokeWidth}
          />
        </Fragment>
        );
      })}
      {labels === "inline" ? <GeometryLabels geometry={geometry} progress={progress} /> : null}
      {fittedText ? (
        <text
          className="board-hand-text"
          clipPath={`url(#${clipId})`}
          data-text-line-count={fittedText.lines.length}
          style={{ fontSize: `${fittedText.fontSize}px` }}
          x={geometry.box.x}
          y={fittedText.startY}
        >
          {fittedText.lines.map((line, index) => (
            <tspan
              key={`${geometry.id}-text-line-${index}`}
              x={geometry.box.x}
              dy={index === 0 ? 0 : fittedText.lineHeight}
            >
              {line}
            </tspan>
          ))}
        </text>
      ) : null}
      {geometry.equationHtml ? (
        <foreignObject
          clipPath={`url(#${clipId})`}
          x={geometry.box.x}
          y={geometry.box.y}
          width={geometry.box.width}
          height={geometry.box.height}
        >
          <FittedEquation
            key={`${geometry.equationHtml}|${geometry.equationFontSize ?? 31}|${geometry.box.width}x${geometry.box.height}`}
            className="board-equation"
            fontSize={geometry.equationFontSize ?? 31}
            html={geometry.equationHtml}
          />
        </foreignObject>
      ) : null}
    </g>
  );
}
