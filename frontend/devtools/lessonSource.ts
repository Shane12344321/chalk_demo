/**
 * Dev-only lesson source for the board gallery (frontend/gallery.html).
 *
 * Serves saved lessons from fixed repository roots over the Vite dev server:
 *   GET /__chalk/lessons/index.json   -> JSON array of repo-relative paths
 *   GET /__chalk/lessons/<relpath>    -> file text
 *
 * The plugin is `apply: "serve"` only, so it never reaches a production build.
 * Every request path is validated lexically (pure, unit-tested) and then again
 * after `realpath`, so symlinks cannot escape the allowed roots.
 */
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

export const LESSON_ROUTE = "/__chalk/lessons/";
const MAX_LESSON_BYTES = 2 * 1024 * 1024;
const MAX_INDEX_ENTRIES = 2000;

export interface LessonRoot {
  /** Repo-relative POSIX directory, without leading or trailing slash. */
  dir: string;
  /** Allowed file suffix, including the dot. */
  extension: string;
}

export const LESSON_ROOTS: readonly LessonRoot[] = [
  { dir: "artifacts/evidence", extension: ".ndjson" },
  { dir: "tests/golden", extension: ".lesson.json" },
  { dir: "demo/cached_lessons", extension: ".lesson.json" },
];

export type LessonPathValidation =
  | { ok: true; relPath: string; root: LessonRoot }
  | { ok: false; reason: string };

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * Pure lexical validation of a request path (already stripped of the route
 * prefix and query string). Accepts only repo-relative POSIX paths made of
 * plain segments under one allowed root with that root's extension.
 */
export function validateLessonRequestPath(
  rawPath: string,
  roots: readonly LessonRoot[] = LESSON_ROOTS,
): LessonPathValidation {
  if (rawPath.length === 0 || rawPath.length > 512) return { ok: false, reason: "length" };
  let decoded: string;
  try {
    decoded = rawPath
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return { ok: false, reason: "encoding" };
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return { ok: false, reason: "character" };
  if (decoded.startsWith("/") || /^[A-Za-z]:/u.test(decoded)) {
    return { ok: false, reason: "absolute" };
  }
  const segments = decoded.split("/");
  // Decoding must not introduce new separators (e.g. %2F).
  if (segments.length !== rawPath.split("/").length) return { ok: false, reason: "encoding" };
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return { ok: false, reason: "segment" };
    }
    if (!SAFE_SEGMENT.test(segment)) return { ok: false, reason: "segment" };
  }
  const relPath = segments.join("/");
  const root = roots.find((candidate) => relPath.startsWith(`${candidate.dir}/`));
  if (!root) return { ok: false, reason: "root" };
  if (!relPath.endsWith(root.extension) || relPath.length <= root.dir.length + 1 + root.extension.length) {
    return { ok: false, reason: "extension" };
  }
  return { ok: true, relPath, root };
}

/**
 * Pure containment check on already-resolved absolute paths: `candidate` must
 * be strictly inside `rootDir` (not equal to it) using the given separator.
 */
export function isPathInside(candidate: string, rootDir: string, separator = "/"): boolean {
  const root = rootDir.endsWith(separator) ? rootDir : `${rootDir}${separator}`;
  return candidate.startsWith(root) && candidate.length > root.length;
}

async function realRoot(repoRoot: string, root: LessonRoot): Promise<string | undefined> {
  try {
    return await realpath(resolve(repoRoot, ...root.dir.split("/")));
  } catch {
    return undefined;
  }
}

/** Resolve a validated path to a real file path inside its root, or undefined. */
export async function resolveLessonFile(
  repoRoot: string,
  rawPath: string,
  roots: readonly LessonRoot[] = LESSON_ROOTS,
): Promise<string | undefined> {
  const validation = validateLessonRequestPath(rawPath, roots);
  if (!validation.ok) return undefined;
  const rootReal = await realRoot(repoRoot, validation.root);
  if (!rootReal) return undefined;
  const lexical = resolve(repoRoot, ...validation.relPath.split("/"));
  let fileReal: string;
  try {
    fileReal = await realpath(lexical);
  } catch {
    return undefined;
  }
  if (!isPathInside(fileReal, rootReal, sep)) return undefined;
  if (!fileReal.endsWith(validation.root.extension)) return undefined;
  const info = await stat(fileReal);
  if (!info.isFile() || info.size > MAX_LESSON_BYTES) return undefined;
  return fileReal;
}

/** List lesson files (repo-relative POSIX paths, sorted). Symlinks are skipped. */
export async function listLessonFiles(
  repoRoot: string,
  roots: readonly LessonRoot[] = LESSON_ROOTS,
): Promise<string[]> {
  const found: string[] = [];
  for (const root of roots) {
    const rootReal = await realRoot(repoRoot, root);
    if (!rootReal) continue;
    const pending = [rootReal];
    while (pending.length > 0 && found.length < MAX_INDEX_ENTRIES) {
      const directory = pending.pop()!;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const absolute = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          pending.push(absolute);
        } else if (entry.isFile() && entry.name.endsWith(root.extension)) {
          const inner = relative(rootReal, absolute);
          if (isAbsolute(inner) || inner.startsWith("..")) continue;
          const relPath = `${root.dir}/${inner.split(sep).join("/")}`;
          if (validateLessonRequestPath(relPath, roots).ok) found.push(relPath);
        }
      }
    }
  }
  return [...new Set(found)].sort();
}

interface MiddlewareRequest {
  method?: string;
  url?: string;
}
interface MiddlewareResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function send(res: MiddlewareResponse, status: number, type: string, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}

/** Vite dev-server plugin exposing saved lessons to the board gallery. */
export function chalkLessonSourcePlugin(): Plugin {
  let repoRoot = "";
  return {
    name: "chalk-lesson-source",
    apply: "serve",
    configResolved(config) {
      repoRoot = resolve(config.root, "..");
    },
    configureServer(server) {
      server.middlewares.use(LESSON_ROUTE, (rawReq, rawRes, next) => {
        // Node's http types are not installed; use the narrow shape we need.
        const req = rawReq as unknown as MiddlewareRequest;
        const res = rawRes as unknown as MiddlewareResponse;
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const path = (req.url ?? "").split("?")[0].replace(/^\/+/u, "");
        void (async () => {
          try {
            if (path === "index.json") {
              send(res, 200, "application/json; charset=utf-8", JSON.stringify(await listLessonFiles(repoRoot)));
              return;
            }
            const file = await resolveLessonFile(repoRoot, path);
            if (!file) {
              send(res, 404, "text/plain; charset=utf-8", "Not found");
              return;
            }
            send(res, 200, "text/plain; charset=utf-8", await readFile(file, "utf8"));
          } catch {
            send(res, 500, "text/plain; charset=utf-8", "Lesson source error");
          }
        })();
      });
    },
  };
}
