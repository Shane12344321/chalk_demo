import type { ScenePipeline } from "../board/boardRendererConfig";
import { decodeLesson, type NormalizedLesson } from "../board/decode";
import { decodeLessonNdjson } from "../lessonStream";

export const LESSON_SOURCE = "/__chalk/lessons/";

export interface LoadedLesson {
  path: string;
  lesson?: NormalizedLesson;
  error?: string;
  warnings: number;
}

export interface GalleryQuery {
  dir: string;
  cols: number;
  /** Geometry pipeline to review; unset follows `VITE_CHALK_SCENE`. */
  scene?: ScenePipeline;
}

export function parseGalleryQuery(search: string): GalleryQuery {
  const params = new URLSearchParams(search);
  const cols = Number.parseInt(params.get("cols") ?? "", 10);
  return {
    dir: (params.get("dir") ?? "").replace(/^\/+/u, ""),
    cols: Number.isFinite(cols) ? Math.min(8, Math.max(1, cols)) : 3,
    ...(params.get("scene") === "scene" || params.get("scene") === "legacy"
      ? { scene: params.get("scene") as ScenePipeline }
      : {}),
  };
}

/** Decode saved lesson text with the production decoders. */
export function decodeLessonText(path: string, text: string): LoadedLesson {
  try {
    if (path.endsWith(".ndjson")) {
      const result = decodeLessonNdjson(text);
      if (result.lesson.steps.length === 0) return { path, error: "No accepted steps.", warnings: result.warnings };
      return { path, lesson: result.lesson, warnings: result.warnings };
    }
    const result = decodeLesson(JSON.parse(text));
    if (!result.lesson || result.lesson.steps.length === 0) {
      return { path, error: result.warnings[0]?.detail ?? "No accepted steps.", warnings: result.warnings.length };
    }
    return { path, lesson: result.lesson, warnings: result.warnings.length };
  } catch (error) {
    return { path, error: error instanceof Error ? error.message : String(error), warnings: 0 };
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function loadGalleryLessons(dir: string): Promise<LoadedLesson[]> {
  const response = await fetch(`${LESSON_SOURCE}index.json`);
  if (!response.ok) throw new Error(`Lesson index unavailable (${response.status}); run the Vite dev server.`);
  const paths = ((await response.json()) as string[])
    .filter((path) => path.startsWith(dir))
    .sort();
  return Promise.all(paths.map(async (path) => {
    try {
      const file = await fetch(`${LESSON_SOURCE}${encodePath(path)}`);
      if (!file.ok) return { path, error: `HTTP ${file.status}`, warnings: 0 };
      return decodeLessonText(path, await file.text());
    } catch (error) {
      return { path, error: error instanceof Error ? error.message : String(error), warnings: 0 };
    }
  }));
}
