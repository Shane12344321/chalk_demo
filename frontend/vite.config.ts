import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { chalkLessonSourcePlugin } from "./devtools/lessonSource";

export default defineConfig(({ mode }) => ({
  // The lesson source is dev-server only (`apply: "serve"`); it backs the
  // board gallery at /gallery.html and never reaches a production build.
  plugins: [react(), chalkLessonSourcePlugin()],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    // Retained model output is evidence, not an application asset. Permit the
    // evidence directory only while Vitest replays it (offline rescore and
    // the scene-pipeline parity test); never in dev or build.
    ...(mode === "test" ? {
      fs: {
        allow: ["../artifacts/evidence"],
      },
    } : {}),
  },
  test: {
    environment: "jsdom",
  },
}));
