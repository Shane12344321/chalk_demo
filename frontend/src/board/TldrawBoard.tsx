import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createShapeId,
  Tldraw,
  type Editor,
  type TLShapeId,
} from "tldraw";
import "tldraw/tldraw.css";
import type { AnnotationOp } from "../annotations";
import { AnnotationOverlayLayer } from "./annotationOverlays";
import type { BoardProps } from "./Board";
import { BOARD_HEIGHT, BOARD_WIDTH } from "./layout";
import { OverlayLayer } from "./overlays";
import { configuredScenePipeline } from "./boardRendererConfig";
import { RoughSvgBoardRenderer } from "./renderer";
import { resolveLocalApiBaseUrl } from "../realtime/localApi";
import { loadTldrawLicenseKey } from "./tldrawLicense";
import {
  ChalkBoardShapeUtil,
  CHALK_SHAPE_TYPE,
  registerTldrawGeometry,
} from "./tldrawShape";

const SHAPE_UTILS = [ChalkBoardShapeUtil];
const API_BASE_URL = resolveLocalApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

export default function TldrawBoard({
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
  measurementCache,
  renderContext,
  scenePipeline,
}: BoardProps) {
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
  const visibleSnapshot = useMemo(
    () => renderer.visibleSnapshot(prepared, currentStepIndex, currentStepProgress),
    [currentStepIndex, currentStepProgress, prepared, renderer],
  );
  const [editor, setEditor] = useState<Editor>();
  const [licenseKey, setLicenseKey] = useState<string>();
  const [licenseLoaded, setLicenseLoaded] = useState(false);
  const visibleVersionRef = useRef(0);
  const visibleFingerprintRef = useRef<string>();
  const measuredRef = useRef<string>();

  const handleMount = useCallback((mounted: Editor) => {
    setEditor(mounted);
  }, []);

  useEffect(() => {
    let active = true;
    void loadTldrawLicenseKey(API_BASE_URL).then((key) => {
      if (!active) return;
      setLicenseKey(key);
      setLicenseLoaded(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!editor) return;
    registerTldrawGeometry(prepared.build.geometries);
    const expectedIds = new Set(prepared.build.geometries.map((geometry) => chalkShapeId(geometry.id)));
    const existing = editor.getCurrentPageShapes()
      .filter((shape) => shape.type === CHALK_SHAPE_TYPE);
    const existingIds = new Set(existing.map((shape) => shape.id));
    const staleIds = existing
      .filter((shape) => !expectedIds.has(shape.id))
      .map((shape) => shape.id);
    editor.run(() => {
      if (staleIds.length > 0) editor.deleteShapes(staleIds);
      editor.createShapes(prepared.build.geometries
        .filter((geometry) => !existingIds.has(chalkShapeId(geometry.id)))
        .map((geometry) => ({
        id: chalkShapeId(geometry.id),
        type: CHALK_SHAPE_TYPE,
        x: geometry.box.x,
        y: geometry.box.y,
        isLocked: true,
        props: {
          w: Math.max(1, geometry.box.width),
          h: Math.max(1, geometry.box.height),
          elementId: geometry.id,
          progress: 0,
        },
        meta: {
          chalkElementId: geometry.id,
          chalkStepIndex: geometry.stepIndex,
          semanticSummary: geometry.manifestSummary,
        },
      })));
      editor.updateShapes(prepared.build.geometries
        .filter((geometry) => existingIds.has(chalkShapeId(geometry.id)))
        .map((geometry) => ({
          id: chalkShapeId(geometry.id),
          type: CHALK_SHAPE_TYPE,
          x: geometry.box.x,
          y: geometry.box.y,
          props: {
            w: Math.max(1, geometry.box.width),
            h: Math.max(1, geometry.box.height),
            elementId: geometry.id,
          },
          meta: {
            chalkElementId: geometry.id,
            chalkStepIndex: geometry.stepIndex,
            semanticSummary: geometry.manifestSummary,
          },
        })));
    }, { history: "ignore", ignoreShapeLock: true });
    editor.zoomToBounds(
      { x: 0, y: 0, w: BOARD_WIDTH, h: BOARD_HEIGHT },
      { animation: { duration: 0 }, inset: 0 },
    );
  }, [editor, prepared, renderer]);

  useEffect(() => {
    if (!editor) return;
    editor.run(() => {
      editor.updateShapes(prepared.build.geometries.map((geometry) => ({
        id: chalkShapeId(geometry.id),
        type: CHALK_SHAPE_TYPE,
        props: {
          progress: renderer.geometryProgress(
            prepared,
            geometry,
            currentStepIndex,
            currentStepProgress,
          ),
        },
      })));
    }, { history: "ignore", ignoreShapeLock: true });
  }, [currentStepIndex, currentStepProgress, editor, prepared, renderer]);

  useEffect(() => {
    if (visibleFingerprintRef.current === visibleSnapshot.fingerprint) return;
    visibleFingerprintRef.current = visibleSnapshot.fingerprint;
    visibleVersionRef.current += 1;
    onManifestChange?.(visibleSnapshot.manifest);
    onVisibleStateChange?.({ ...visibleSnapshot, version: visibleVersionRef.current });
  }, [onManifestChange, onVisibleStateChange, visibleSnapshot]);

  useEffect(() => {
    if (!measurementId || measuredRef.current === measurementId) return;
    if (!prepared.build.geometries.some((geometry) =>
      renderer.geometryProgress(
        prepared,
        geometry,
        currentStepIndex,
        currentStepProgress,
      ) > 0)) return;
    measuredRef.current = measurementId;
    onFirstVisibleInk?.(measurementId, performance.now());
  }, [
    currentStepIndex,
    currentStepProgress,
    measurementId,
    onFirstVisibleInk,
    prepared,
    renderer,
  ]);

  return (
    <section
      className="chalkboard-shell tldraw-board-shell"
      aria-label={`Experimental tldraw lesson board: ${lesson.title}`}
      data-board-renderer="tldraw"
    >
      <div className="board-toolbar">
        <div><span className="board-live-dot" aria-hidden="true" /><strong>{lesson.title}</strong></div>
        <span>{phase.toLowerCase()} · step {Math.min(currentStepIndex + 1, lesson.steps.length)}/{lesson.steps.length}</span>
      </div>
      <div className="tldraw-board-stage">
        {licenseLoaded ? (
          <Tldraw
            hideUi
            shapeUtils={SHAPE_UTILS}
            onMount={handleMount}
            licenseKey={licenseKey}
          />
        ) : null}
        <svg
          className="tldraw-board-overlays"
          viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
          aria-hidden="true"
        >
          <AnnotationOverlayLayer
            ops={annotations as readonly AnnotationOp[]}
            elements={visibleSnapshot.elements}
          />
          <OverlayLayer
            overlays={overlays}
            elements={visibleSnapshot.elements}
            geometries={prepared.build.geometries}
          />
        </svg>
      </div>
    </section>
  );
}

function chalkShapeId(elementId: string): TLShapeId {
  return createShapeId(`chalk-${elementId}`);
}
