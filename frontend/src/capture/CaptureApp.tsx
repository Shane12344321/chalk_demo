import { useEffect, useMemo, useState } from "react";
import type { AnnotationOp } from "../annotations";
import { BoardSurface as Board } from "../board/BoardSurface";
import { decodeLesson } from "../board/decode";

type Span = [number, number];

interface CaptureTimeline {
  lesson: unknown;
  typing: { start: number; end: number; text: string; initial?: string };
  createAt: number;
  arriveAt: number;
  steps: Span[];
  freeze?: { at: number; resumeAt: number };
  speaking: Span[];
  listening: Span[];
  annotations?: { at: number; until: number; ops: AnnotationOp[] }[];
  /** Cursor keyframes; `sel` resolves to the centre of that element (plus dx/dy). */
  cursor: { t: number; x?: number; y?: number; sel?: string; dx?: number; dy?: number; down?: boolean }[];
  status?: string;
  /** Render only the board, filling the viewport (montage shots). */
  boardOnly?: boolean;
}

declare global {
  interface Window {
    __TIMELINE?: CaptureTimeline;
    __setTime?: (t: number) => Promise<void>;
    __ready?: boolean;
  }
}

const within = (t: number, spans: Span[]) => spans.some(([a, b]) => t >= a && t < b);
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

function resolveCursor(raw: CaptureTimeline["cursor"]) {
  return raw.map((p) => {
    if (!p.sel) return { t: p.t, x: p.x ?? 0, y: p.y ?? 0, down: p.down };
    const box = document.querySelector(p.sel)?.getBoundingClientRect();
    return {
      t: p.t,
      x: (box ? box.left + box.width / 2 : 0) + (p.dx ?? 0),
      y: (box ? box.top + box.height / 2 : 0) + (p.dy ?? 0),
      down: p.down,
    };
  });
}

function lerpCursor(raw: CaptureTimeline["cursor"], t: number) {
  const points = resolveCursor(raw);
  if (points.length === 0) return { x: -100, y: -100, down: false };
  if (t <= points[0].t) return { ...points[0], down: !!points[0].down };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.t) {
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      const s = k * k * (3 - 2 * k);
      return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, down: !!b.down && k > 0.95 };
    }
  }
  const last = points[points.length - 1];
  return { ...last, down: false };
}

// Pauses every CSS animation and pins it to virtual time so a frame captured
// at time t is identical no matter how long the capture takes.
const births = new WeakMap<Animation, number>();
function pinAnimations(t: number) {
  for (const animation of document.getAnimations()) {
    if (!births.has(animation)) births.set(animation, t);
    animation.pause();
    animation.currentTime = (t - births.get(animation)!) * 1000;
  }
}

export function CaptureApp() {
  const timeline = window.__TIMELINE;
  const [t, setT] = useState(0);

  const lesson = useMemo(() => {
    if (!timeline) return undefined;
    const decoded = decodeLesson(timeline.lesson);
    if (!decoded.lesson) throw new Error(`lesson did not decode: ${JSON.stringify(decoded.warnings)}`);
    return decoded.lesson;
  }, [timeline]);

  useEffect(() => {
    window.__setTime = (next: number) =>
      new Promise<void>((resolve) => {
        setT(next);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            pinAnimations(next);
            requestAnimationFrame(() => resolve());
          }),
        );
      });
    window.__ready = true;
  }, []);

  if (!timeline || !lesson) return <p>Waiting for timeline…</p>;

  // Ink progress follows the step spans; a freeze holds ink exactly in place.
  const frozen = !!timeline.freeze && t >= timeline.freeze.at && t < timeline.freeze.resumeAt;
  const clock = timeline.freeze && t >= timeline.freeze.resumeAt
    ? t - (timeline.freeze.resumeAt - timeline.freeze.at)
    : frozen ? timeline.freeze!.at : t;
  let stepIndex = 0;
  let stepProgress = 0;
  const arrived = t >= timeline.arriveAt;
  for (let i = 0; i < timeline.steps.length; i++) {
    const [a, b] = timeline.steps[i];
    if (clock >= a) {
      stepIndex = i;
      stepProgress = ease((clock - a) / (b - a));
    }
  }
  const started = arrived && clock >= timeline.steps[0][0];
  const done = clock >= timeline.steps[timeline.steps.length - 1][1];
  const phase = !started ? "IDLE" : frozen ? "QA" : done ? "DONE" : "TEACHING";

  const typed = timeline.typing;
  const typedCount = Math.round(
    ease((t - typed.start) / (typed.end - typed.start)) * typed.text.length,
  );
  const inputValue = t < typed.start ? (typed.initial ?? "") : typed.text.slice(0, typedCount);
  const preparing = t >= timeline.createAt && !arrived;
  const speaking = within(t, timeline.speaking);
  const listening = within(t, timeline.listening);
  const annotations = (timeline.annotations ?? [])
    .filter((a) => t >= a.at && t < a.until)
    .flatMap((a) => a.ops);
  const cursor = lerpCursor(timeline.cursor, t);
  const visibleLesson = arrived ? lesson : { ...lesson, steps: lesson.steps.slice(0, 1) };

  if (timeline.boardOnly) {
    return (
      <div style={{ padding: 0, background: "var(--paper, #f6f5f1)", minHeight: "100vh" }}>
        <Board
          lesson={lesson}
          currentStepIndex={stepIndex}
          currentStepProgress={started ? stepProgress : 0}
          phase={phase}
        />
      </div>
    );
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Live visual tutoring</p>
          <h1>CHALK</h1>
          <p className="tagline">Live voice tutoring on an intelligent whiteboard.</p>
        </div>
        <div className={`status-pill status-${timeline.status ?? "connected"}`}>
          <span aria-hidden="true" />
          {timeline.status ?? "connected"}
        </div>
      </header>

      <div className="teaching-console">
        <section className="lesson-stage" aria-labelledby="lesson-title">
          <form className="topic-form" onSubmit={(e) => e.preventDefault()}>
            <label htmlFor="lesson-topic">Ask Chalk to teach</label>
            <div>
              <input
                id="lesson-topic"
                value={inputValue}
                readOnly
                placeholder="A math or physics topic"
                className={t >= typed.start && t < timeline.createAt ? "capture-focus" : ""}
              />
              <button className="primary" type="submit" disabled={preparing || (started && !done)}>
                {preparing ? "Preparing…" : "Create lesson"}
              </button>
              <button className="secondary" type="button">Use demo lesson</button>
            </div>
          </form>

          <div className="lesson-heading">
            <div>
              <p className="eyebrow">{arrived ? "Live generated lesson" : "New lesson"}</p>
              <h2 id="lesson-title">{arrived ? lesson.title : preparing ? "Generating your lesson…" : "What should we learn today?"}</h2>
            </div>
            <div className="lesson-actions">
              <button className="primary" type="button" disabled>
                {done ? "Replay lesson" : "Start lesson"}
              </button>
              <button className="secondary" type="button" disabled={!frozen}>
                Resume frozen step
              </button>
            </div>
          </div>
          <div style={{ visibility: arrived ? "visible" : "hidden" }}>
            <Board
              lesson={visibleLesson}
              currentStepIndex={arrived ? stepIndex : 0}
              currentStepProgress={started ? stepProgress : 0}
              phase={phase}
              annotations={annotations}
            />
          </div>
          {phase === "TEACHING" ? (
            <p className="lesson-hint lesson-hint-live">Interrupt while a stroke is moving. The ink should remain exactly where it stopped.</p>
          ) : phase === "QA" ? (
            <p className="lesson-hint lesson-hint-frozen">Ink frozen. Ask your question, then use “Resume frozen step” when ready.</p>
          ) : null}
        </section>

        <section className="voice-stage" aria-labelledby="voice-title">
          <button className="orb-control" type="button" aria-label="Talk to Chalk">
            <span className={`orb ${speaking ? "orb-speaking" : ""} ${listening ? "orb-listening" : ""}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
          <div className="voice-copy">
            <h2 id="voice-title">
              {speaking ? "Chalk is speaking" : listening ? "Listening to you" : "Microphone paused"}
            </h2>
            <p>
              {listening
                ? "Speak now. The microphone pauses automatically when your turn ends."
                : "Click the orb or press Space when you want to answer or interrupt Chalk."}
            </p>
          </div>
        </section>
      </div>

      <div
        className={`capture-cursor ${cursor.down ? "down" : ""}`}
        style={{ left: cursor.x, top: cursor.y }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </div>
      <style>{`
        .capture-cursor{position:fixed;z-index:9999;pointer-events:none;transform:translate(-3px,-2px);
          filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
        .capture-cursor.down{transform:translate(-3px,-2px) scale(.85)}
        .capture-focus{border-color:var(--accent)!important;box-shadow:0 0 0 3px rgba(214,104,40,.18)}
      `}</style>
    </main>
  );
}
