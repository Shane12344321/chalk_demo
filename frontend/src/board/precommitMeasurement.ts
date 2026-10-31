import { renderSafeLatex } from "./latex";
import { EQUATION_BASE_FONT_PX } from "./equationSizing";

export type MeasurableRootKind = "text" | "equation";
export type MeasurementEvidence = "measured" | "estimated";

export interface MeasurableRoot {
  id: string;
  kind: MeasurableRootKind;
  content: string;
  maxWidth: number;
}

export interface RootMeasurement {
  id: string;
  width: number;
  height: number;
  evidence: MeasurementEvidence;
}

export interface MeasurementBatch {
  measurements: ReadonlyMap<string, RootMeasurement>;
  unavailableIds: readonly string[];
  timedOut: boolean;
}

export interface MeasurementRuntime {
  now(): number;
  handwritingFontReady(): boolean;
  measureHandwriting(content: string, maxWidth: number): { width: number; height: number } | undefined;
  measureEquation(content: string, maxWidth: number): { width: number; height: number } | undefined;
}

const DEFAULT_BUDGET_MS = 24;
const CACHE_LIMIT = 256;
const TEXT_MIN_WIDTH = 180;
const EQUATION_MIN_WIDTH = 220;

/**
 * A synchronous, bounded cache used before a streamed root enters React state.
 * Measurements never update an already committed root: callers warm this cache,
 * then pass the immutable result into one resolver transaction.
 */
export class PrecommitMeasurementCache {
  private readonly values = new Map<string, Omit<RootMeasurement, "id">>();
  private readonly pins = new Map<string, { key: string; value: Omit<RootMeasurement, "id"> }>();

  constructor(
    private readonly runtime: MeasurementRuntime,
    private readonly budgetMs = DEFAULT_BUDGET_MS,
  ) {}

  measure(roots: readonly MeasurableRoot[]): MeasurementBatch {
    const startedAt = this.runtime.now();
    const measurements = new Map<string, RootMeasurement>();
    const unavailableIds: string[] = [];
    let timedOut = false;

    for (const root of roots) {
      const normalized = normalizeRoot(root);
      const key = measurementKey(normalized);
      const pinned = this.pins.get(root.id);
      if (pinned?.key === key) {
        measurements.set(root.id, { id: root.id, ...pinned.value });
        if (pinned.value.evidence === "estimated") unavailableIds.push(root.id);
        continue;
      }
      const cached = this.values.get(key);
      if (cached) {
        this.pin(root.id, key, cached);
        measurements.set(root.id, { id: root.id, ...cached });
        continue;
      }

      if (this.runtime.now() - startedAt >= this.budgetMs) {
        timedOut = true;
        const estimated = estimateRoot(normalized);
        this.pin(root.id, key, estimated);
        measurements.set(root.id, { id: root.id, ...estimated });
        unavailableIds.push(root.id);
        continue;
      }

      let measured: { width: number; height: number } | undefined;
      try {
        measured = normalized.kind === "text"
          ? this.measureText(normalized)
          : this.runtime.measureEquation(normalized.content, normalized.maxWidth);
      } catch {
        measured = undefined;
      }
      if (this.runtime.now() - startedAt >= this.budgetMs) timedOut = true;
      const value = measured && validSize(measured)
        ? {
            width: clamp(measured.width, minimumWidth(normalized.kind), normalized.maxWidth),
            height: clamp(measured.height, 48, 260),
            evidence: "measured" as const,
          }
        : estimateRoot(normalized);
      if (value.evidence === "estimated") unavailableIds.push(root.id);
      if (value.evidence === "measured") this.remember(key, value);
      this.pin(root.id, key, value);
      measurements.set(root.id, { id: root.id, ...value });
    }

    return { measurements, unavailableIds, timedOut };
  }

  lookup(root: MeasurableRoot): RootMeasurement | undefined {
    const normalized = normalizeRoot(root);
    const key = measurementKey(normalized);
    const pinned = this.pins.get(root.id);
    const value = pinned?.key === key ? pinned.value : undefined;
    return value ? { id: root.id, ...value } : undefined;
  }

  /** Start a new lesson identity while retaining safe content measurements. */
  beginLesson(): void {
    this.pins.clear();
  }

  clear(): void {
    this.values.clear();
    this.pins.clear();
  }

  private measureText(root: MeasurableRoot): { width: number; height: number } | undefined {
    if (!this.runtime.handwritingFontReady()) return undefined;
    return this.runtime.measureHandwriting(root.content, root.maxWidth);
  }

  private remember(key: string, value: Omit<RootMeasurement, "id">): void {
    if (this.values.size >= CACHE_LIMIT) {
      const oldest = this.values.keys().next().value;
      if (typeof oldest === "string") this.values.delete(oldest);
    }
    this.values.set(key, value);
  }

  private pin(id: string, key: string, value: Omit<RootMeasurement, "id">): void {
    if (this.pins.size >= CACHE_LIMIT * 2 && !this.pins.has(id)) {
      const oldest = this.pins.keys().next().value;
      if (typeof oldest === "string") this.pins.delete(oldest);
    }
    this.pins.set(id, { key, value });
  }
}

export function createBrowserMeasurementRuntime(
  documentValue: Document = document,
): MeasurementRuntime {
  return {
    now: () => performance.now(),
    handwritingFontReady: () => {
      const fonts = documentValue.fonts;
      if (!fonts) return true;
      return fonts.status === "loaded" && fonts.check(
        '700 43px "Chalkboard SE", "Comic Sans MS", "Bradley Hand", cursive',
      );
    },
    measureHandwriting: (content, maxWidth) => {
      const canvas = documentValue.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.font = '700 43px "Chalkboard SE", "Comic Sans MS", "Bradley Hand", cursive';
      const words = content.replace(/\s+/gu, " ").trim().split(" ").filter(Boolean);
      if (words.length === 0) return undefined;
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        if (context.measureText(word).width > maxWidth) {
          if (line) {
            lines.push(line);
            line = "";
          }
          let chunk = "";
          for (const character of Array.from(word)) {
            const candidate = `${chunk}${character}`;
            if (chunk && context.measureText(candidate).width > maxWidth) {
              lines.push(chunk);
              chunk = character;
            } else {
              chunk = candidate;
            }
          }
          line = chunk;
          continue;
        }
        const candidate = line ? `${line} ${word}` : word;
        if (!line || context.measureText(candidate).width <= maxWidth) line = candidate;
        else {
          lines.push(line);
          line = word;
        }
      }
      if (line) lines.push(line);
      const width = Math.max(...lines.map((value) => context.measureText(value).width));
      return { width: Math.min(maxWidth, width + 12), height: lines.length * 47 };
    },
    measureEquation: (content, maxWidth) => {
      const host = documentValue.createElement("div");
      host.className = "board-equation";
      host.setAttribute("aria-hidden", "true");
      Object.assign(host.style, {
        position: "fixed",
        visibility: "hidden",
        pointerEvents: "none",
        left: "-10000px",
        top: "-10000px",
        display: "inline-block",
        width: "max-content",
        maxWidth: "none",
        height: "auto",
      });
      // KaTeX generated this markup with trust disabled and the CHALK command
      // allowlist; raw model HTML is never accepted by this runtime.
      host.innerHTML = renderSafeLatex(content);
      documentValue.body.append(host);
      try {
        // Measure natural ink at the base size. The painter shrinks an equation
        // that is wider than its box, so the reserved height shrinks with it.
        host.style.fontSize = `${EQUATION_BASE_FONT_PX}px`;
        const box = host.getBoundingClientRect();
        if (!validSize(box)) return undefined;
        const naturalWidth = box.width + 12;
        const scale = Math.min(1, maxWidth / naturalWidth);
        return { width: Math.min(maxWidth, naturalWidth), height: box.height * scale + 12 };
      } finally {
        host.remove();
      }
    },
  };
}

function normalizeRoot(root: MeasurableRoot): MeasurableRoot {
  return {
    ...root,
    content: root.content.replace(/\s+/gu, " ").trim(),
    maxWidth: clamp(root.maxWidth, minimumWidth(root.kind), 700),
  };
}

function measurementKey(root: MeasurableRoot): string {
  return `${root.kind}\u0000${root.maxWidth.toFixed(2)}\u0000${root.content}`;
}

function estimateRoot(root: MeasurableRoot): Omit<RootMeasurement, "id"> {
  if (root.kind === "text") {
    const width = clamp(root.content.length * 25, TEXT_MIN_WIDTH, root.maxWidth);
    const lineCount = Math.max(1, Math.ceil((root.content.length * 25) / root.maxWidth));
    return { width, height: clamp(lineCount * 47, 64, 260), evidence: "estimated" };
  }
  const visibleLength = root.content
    .replace(/\\[a-zA-Z]+/gu, "x")
    .replace(/[{}\\_^|]/gu, "").length;
  return {
    width: clamp(160 + visibleLength * 12, EQUATION_MIN_WIDTH, root.maxWidth),
    height: 92,
    evidence: "estimated",
  };
}

function minimumWidth(kind: MeasurableRootKind): number {
  return kind === "text" ? TEXT_MIN_WIDTH : EQUATION_MIN_WIDTH;
}

function validSize(value: { width: number; height: number }): boolean {
  return Number.isFinite(value.width) && Number.isFinite(value.height) &&
    value.width > 0 && value.height > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
