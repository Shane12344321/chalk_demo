import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Board } from "../board/Board";
import type { ScenePipeline } from "../board/boardRendererConfig";
import type { NormalizedLesson } from "../board/decode";
import {
  createBrowserMeasurementRuntime,
  PrecommitMeasurementCache,
} from "../board/precommitMeasurement";
import { premeasureLessonRoots } from "../board/premeasureLesson";
import {
  BOARD_H,
  BOARD_ISSUE_TYPES,
  BOARD_W,
  type BoardIssue,
  type BoardIssueType,
  measureBoardQuality,
} from "./boardQuality";
import { loadGalleryLessons, type LoadedLesson, parseGalleryQuery } from "./lessonLoader";

const KATEX_FONT_PRELOADS = [
  "20px KaTeX_Main",
  "bold 20px KaTeX_Main",
  "italic 20px KaTeX_Main",
  "italic 20px KaTeX_Math",
  "20px KaTeX_AMS",
  "20px KaTeX_Size1",
  "20px KaTeX_Size2",
  "20px KaTeX_Size3",
  "20px KaTeX_Size4",
];

/** Generous budget so every text/equation root is measured, not estimated. */
const PREMEASURE_BUDGET_MS = 60_000;

export interface GalleryResult {
  path: string;
  title: string | null;
  error: string | null;
  steps: number;
  decodeWarnings: number;
  elementCount: number;
  coverage: number;
  issueCounts: Record<BoardIssueType, number>;
  issueTotal: number;
  issues: BoardIssue[];
}

declare global {
  interface Window {
    __chalkGallery?: { ready: boolean; results: GalleryResult[] };
  }
}

const ISSUE_LABELS: Record<BoardIssueType, string> = {
  overlap: "overlap",
  clipped_equation: "clipped eq",
  outside_board: "outside",
  small_text: "small text",
  short_last_line: "short line",
};

function emptyCounts(): Record<BoardIssueType, number> {
  return Object.fromEntries(BOARD_ISSUE_TYPES.map((type) => [type, 0])) as Record<BoardIssueType, number>;
}

/**
 * One animation frame. Background/hidden tabs suspend rAF, so fall back to a
 * timer; FittedEquation's layout effects run synchronously before either.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

function errorResult(item: LoadedLesson): GalleryResult {
  return {
    path: item.path,
    title: item.lesson?.title ?? null,
    error: item.error ?? "Unknown error",
    steps: item.lesson?.steps.length ?? 0,
    decodeWarnings: item.warnings,
    elementCount: 0,
    coverage: 0,
    issueCounts: emptyCounts(),
    issueTotal: 0,
    issues: [],
  };
}

export function Gallery() {
  const query = useMemo(() => parseGalleryQuery(window.location.search), []);
  const [lessons, setLessons] = useState<LoadedLesson[]>();
  const [loadError, setLoadError] = useState<string>();
  const [results, setResults] = useState<Record<string, GalleryResult>>({});

  useEffect(() => {
    let cancelled = false;
    window.__chalkGallery = { ready: false, results: [] };
    void (async () => {
      // Fonts first, so pre-commit handwriting measurement is real, not estimated,
      // and FittedEquation fits against KaTeX's real glyphs (KaTeX faces load
      // lazily on first use, which would otherwise happen after the fit).
      await Promise.allSettled(KATEX_FONT_PRELOADS.map((font) => document.fonts.load(font, "x=2\u03c0")));
      await document.fonts.ready;
      try {
        const loaded = await loadGalleryLessons(query.dir);
        if (!cancelled) setLessons(loaded);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query.dir]);

  const report = useCallback((result: GalleryResult) => {
    setResults((previous) => ({ ...previous, [result.path]: result }));
  }, []);

  const ordered = useMemo(() => {
    if (!lessons || lessons.some((item) => !results[item.path])) return undefined;
    return lessons.map((item) => results[item.path]);
  }, [lessons, results]);

  useEffect(() => {
    if (ordered) window.__chalkGallery = { ready: true, results: ordered };
  }, [ordered]);

  const measuredCount = lessons ? lessons.filter((item) => results[item.path]).length : 0;

  return (
    <main className="gallery-shell">
      <header className="gallery-header">
        <h1>Board gallery</h1>
        <p>
          Dev-only drawing-quality review. {query.dir ? <>Filter <code>{query.dir}</code> · </> : null}
          {lessons ? `${measuredCount}/${lessons.length} measured` : loadError ?? "Loading lessons…"}
          {query.scene ? <> · pipeline <code>{query.scene}</code></> : null}
          {" "}· query params <code>?dir=&lt;prefix&gt;&amp;cols=N&amp;scene=legacy|scene</code>
        </p>
      </header>
      {lessons ? <SummaryTable lessons={lessons} results={results} /> : null}
      {lessons ? (
        <section className="gallery-grid" style={{ gridTemplateColumns: `repeat(${query.cols}, minmax(0, 1fr))` }}>
          {lessons.map((item) => (
            <GalleryCard
              key={item.path}
              item={item}
              result={results[item.path]}
              onMeasured={report}
              scenePipeline={query.scene}
            />
          ))}
        </section>
      ) : null}
      {ordered ? (
        <pre id="gallery-json">{JSON.stringify({ ready: true, results: ordered }, null, 2)}</pre>
      ) : null}
    </main>
  );
}

function anchorFor(path: string): string {
  return `lesson-${path.replace(/[^A-Za-z0-9_-]/gu, "-")}`;
}

type SortKey = "path" | "elements" | "coverage" | "total" | BoardIssueType;

function SummaryTable({
  lessons,
  results,
}: {
  lessons: readonly LoadedLesson[];
  results: Readonly<Record<string, GalleryResult>>;
}) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "total", descending: true });
  const rows = useMemo(() => {
    const value = (path: string): number | string => {
      const result = results[path];
      if (sort.key === "path") return path;
      if (!result) return -1;
      if (sort.key === "elements") return result.elementCount;
      if (sort.key === "coverage") return result.coverage;
      if (sort.key === "total") return result.issueTotal;
      return result.issueCounts[sort.key];
    };
    return [...lessons].sort((a, b) => {
      const left = value(a.path);
      const right = value(b.path);
      const order = left < right ? -1 : left > right ? 1 : a.path.localeCompare(b.path);
      return sort.descending && left !== right ? -order : order;
    });
  }, [lessons, results, sort]);
  const header = (key: SortKey, label: string) => (
    <th key={key}>
      <button
        type="button"
        className={sort.key === key ? "active" : undefined}
        onClick={() => setSort((current) => ({ key, descending: current.key === key ? !current.descending : key !== "path" }))}
      >
        {label}{sort.key === key ? (sort.descending ? " ▼" : " ▲") : ""}
      </button>
    </th>
  );
  return (
    <div className="gallery-summary-scroll">
    <table className="gallery-summary">
      <thead>
        <tr>
          {header("path", "Lesson")}
          {header("elements", "Elements")}
          {header("coverage", "Coverage")}
          {header("total", "Issues")}
          {BOARD_ISSUE_TYPES.map((type) => header(type, ISSUE_LABELS[type]))}
        </tr>
      </thead>
      <tbody>
        {rows.map((item) => {
          const result = results[item.path];
          return (
            <tr key={item.path}>
              <td><a href={`#${anchorFor(item.path)}`}>{item.path}</a></td>
              <td>{result?.error ? "error" : result?.elementCount ?? "…"}</td>
              <td>{result && !result.error ? `${Math.round(result.coverage * 100)}%` : ""}</td>
              <td className={result?.issueTotal ? "bad" : undefined}>{result ? result.issueTotal : ""}</td>
              {BOARD_ISSUE_TYPES.map((type) => (
                <td key={type} className={result?.issueCounts[type] ? "bad" : undefined}>
                  {result ? result.issueCounts[type] : ""}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function GalleryCard({
  item,
  result,
  onMeasured,
  scenePipeline,
}: {
  item: LoadedLesson;
  result: GalleryResult | undefined;
  onMeasured: (result: GalleryResult) => void;
  scenePipeline?: ScenePipeline;
}) {
  useEffect(() => {
    if (!item.lesson) onMeasured(errorResult(item));
  }, [item, onMeasured]);

  return (
    <article className="gallery-card" id={anchorFor(item.path)}>
      <header>
        <strong>{item.lesson?.title ?? "Undecodable lesson"}</strong>
        <code>{item.path}</code>
        <div className="gallery-badges">
          {result && !result.error ? (
            <>
              <span className="badge">{result.elementCount} elements</span>
              <span className="badge">{Math.round(result.coverage * 100)}% coverage</span>
              {BOARD_ISSUE_TYPES.filter((type) => result.issueCounts[type] > 0).map((type) => (
                <span key={type} className="badge bad">{result.issueCounts[type]} {ISSUE_LABELS[type]}</span>
              ))}
              {result.issueTotal === 0 ? <span className="badge good">clean</span> : null}
            </>
          ) : null}
          {item.warnings > 0 ? <span className="badge warn">{item.warnings} decode warnings</span> : null}
          {result?.error ? <span className="badge bad">{result.error}</span> : null}
          {!result ? <span className="badge">measuring…</span> : null}
        </div>
      </header>
      {item.lesson ? (
        <ScaledBoard
          path={item.path}
          lesson={item.lesson}
          warnings={item.warnings}
          onMeasured={onMeasured}
          scenePipeline={scenePipeline}
        />
      ) : null}
      {result && result.issues.length > 0 ? (
        <details>
          <summary>{result.issues.length} issue details</summary>
          <ul>{result.issues.map((issue, index) => <li key={index}>{issue.type}: {issue.detail}</li>)}</ul>
        </details>
      ) : null}
    </article>
  );
}

function ScaledBoard({
  path,
  lesson,
  warnings,
  onMeasured,
  scenePipeline,
}: {
  path: string;
  lesson: NormalizedLesson;
  warnings: number;
  onMeasured: (result: GalleryResult) => void;
  scenePipeline?: ScenePipeline;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const [innerHeight, setInnerHeight] = useState(BOARD_H);
  // Mirror the live path: warm the pre-commit measurement cache before the
  // renderer resolves layout, one cache per card for isolation.
  const cache = useMemo(() => {
    const value = new PrecommitMeasurementCache(createBrowserMeasurementRuntime(), PREMEASURE_BUDGET_MS);
    premeasureLessonRoots(value, lesson.steps);
    return value;
  }, [lesson]);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const update = () => {
      if (outer.clientWidth > 0) setScale(outer.clientWidth / BOARD_W);
      setInnerHeight(inner.offsetHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await document.fonts.ready;
      // FittedEquation shrinks equations in a layout effect; let it settle.
      await nextFrame();
      await nextFrame();
      if (cancelled) return;
      const svg = innerRef.current?.querySelector<SVGSVGElement>("svg.chalkboard");
      if (!svg) {
        onMeasured(errorResult({ path, lesson, warnings, error: "Board did not render." }));
        return;
      }
      // Measure at 1:1 (no card scaling) so HTML rects map precisely to board units.
      const inner = innerRef.current!;
      const previousTransform = inner.style.transform;
      inner.style.transform = "none";
      let quality;
      try {
        quality = measureBoardQuality(svg);
      } finally {
        inner.style.transform = previousTransform;
      }
      onMeasured({
        path,
        title: lesson.title,
        error: null,
        steps: lesson.steps.length,
        decodeWarnings: warnings,
        ...quality,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [lesson, onMeasured, path, warnings]);

  return (
    <div ref={outerRef} className="gallery-board" style={{ height: innerHeight * scale }}>
      <div
        ref={innerRef}
        className="gallery-board-inner"
        style={{ width: BOARD_W, transform: `scale(${scale})` }}
      >
        <Board
          lesson={lesson}
          currentStepIndex={lesson.steps.length - 1}
          currentStepProgress={1}
          phase="DONE"
          measurementCache={cache}
          scenePipeline={scenePipeline}
        />
      </div>
    </div>
  );
}
