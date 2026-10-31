export type ConfiguredBoardRenderer = "rough-svg" | "tldraw";

export function configuredBoardRenderer(value: unknown): ConfiguredBoardRenderer {
  return value === "tldraw" ? "tldraw" : "rough-svg";
}

/**
 * Geometry pipeline behind the board painter. `legacy` draws schema ops
 * directly (the known-good path); `scene` compiles them into the scene IR
 * (`scene/`) first. Both paint identical ink; `legacy` stays the default
 * until the scene path passes its gate.
 */
export type ScenePipeline = "legacy" | "scene";

export function configuredScenePipeline(value: unknown): ScenePipeline {
  return value === "scene" ? "scene" : "legacy";
}
