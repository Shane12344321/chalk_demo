// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPathInside,
  listLessonFiles,
  resolveLessonFile,
  validateLessonRequestPath,
} from "./lessonSource";

describe("validateLessonRequestPath", () => {
  it.each([
    "artifacts/evidence/batch/raw/standing-waves.ndjson",
    "artifacts/evidence/a.ndjson",
    "tests/golden/01-derivative-slope.lesson.json",
    "demo/cached_lessons/projectile-range.lesson.json",
    "tests/golden/with%5Funderscore.lesson.json",
  ])("accepts %s", (path) => {
    expect(validateLessonRequestPath(path).ok).toBe(true);
  });

  it.each([
    ["", "length"],
    ["../etc/passwd", "segment"],
    ["artifacts/evidence/../../secret.ndjson", "segment"],
    ["artifacts/evidence/%2e%2e/x.ndjson", "segment"],
    ["artifacts/evidence/a%2F..%2F..%2Fb.ndjson", "encoding"],
    ["artifacts/evidence/%E0%A4%A.ndjson", "encoding"],
    ["/artifacts/evidence/a.ndjson", "absolute"],
    ["C:/artifacts/evidence/a.ndjson", "absolute"],
    ["artifacts\\evidence\\a.ndjson", "character"],
    ["artifacts/evidence/a.ndjson%00", "character"],
    ["artifacts/evidence//a.ndjson", "segment"],
    ["artifacts/evidence/./a.ndjson", "segment"],
    ["artifacts/evidence/.hidden.ndjson", "segment"],
    ["artifacts/evidence/summary.json", "extension"],
    ["artifacts/evidence/a.lesson.json", "extension"],
    ["tests/golden/a.ndjson", "extension"],
    ["tests/golden/.lesson.json", "segment"],
    ["artifacts/evidence.ndjson", "root"],
    ["artifacts/evidencex/a.ndjson", "root"],
    ["backend/app/main.ndjson", "root"],
    ["tests/goldenx/a.lesson.json", "root"],
  ])("rejects %s (%s)", (path, reason) => {
    expect(validateLessonRequestPath(path)).toEqual({ ok: false, reason });
  });
});

describe("isPathInside", () => {
  it("requires strict containment on a separator boundary", () => {
    expect(isPathInside("/repo/tests/golden/a.lesson.json", "/repo/tests/golden")).toBe(true);
    expect(isPathInside("/repo/tests/golden", "/repo/tests/golden")).toBe(false);
    expect(isPathInside("/repo/tests/goldenx/a.lesson.json", "/repo/tests/golden")).toBe(false);
    expect(isPathInside("/etc/passwd", "/repo/tests/golden/")).toBe(false);
    expect(isPathInside("C:\\r\\g\\a", "C:\\r\\g", "\\")).toBe(true);
  });
});

describe("filesystem resolution", () => {
  let repo = "";
  let outside = "";
  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), "chalk-gallery-repo-"));
    outside = await mkdtemp(join(tmpdir(), "chalk-gallery-outside-"));
    await mkdir(join(repo, "artifacts", "evidence", "batch"), { recursive: true });
    await mkdir(join(repo, "tests", "golden"), { recursive: true });
    await writeFile(join(repo, "artifacts", "evidence", "batch", "ok.ndjson"), "{}\n");
    await writeFile(join(repo, "artifacts", "evidence", "notes.txt"), "x");
    await writeFile(join(repo, "tests", "golden", "a.lesson.json"), "{}");
    await writeFile(join(outside, "secret.ndjson"), "secret");
    await mkdir(join(outside, "dir"));
    await writeFile(join(outside, "dir", "deep.ndjson"), "secret");
    await symlink(join(outside, "secret.ndjson"), join(repo, "artifacts", "evidence", "escape.ndjson"));
    await symlink(join(outside, "dir"), join(repo, "artifacts", "evidence", "linkdir"));
  });
  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("lists only allowed files and skips symlinks", async () => {
    expect(await listLessonFiles(repo)).toEqual([
      "artifacts/evidence/batch/ok.ndjson",
      "tests/golden/a.lesson.json",
    ]);
  });

  it("resolves real files and rejects symlinks escaping the root", async () => {
    expect(await resolveLessonFile(repo, "artifacts/evidence/batch/ok.ndjson")).toMatch(/ok\.ndjson$/u);
    expect(await resolveLessonFile(repo, "artifacts/evidence/escape.ndjson")).toBeUndefined();
    expect(await resolveLessonFile(repo, "artifacts/evidence/linkdir/deep.ndjson")).toBeUndefined();
    expect(await resolveLessonFile(repo, "artifacts/evidence/missing.ndjson")).toBeUndefined();
    expect(await resolveLessonFile(repo, "artifacts/evidence/notes.txt")).toBeUndefined();
  });
});
