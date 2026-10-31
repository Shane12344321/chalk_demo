/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_BOARD_RENDERER?: "rough-svg" | "tldraw";
  readonly VITE_CHALK_SCENE?: "legacy" | "scene";
  readonly VITE_PARTIAL_INK?: "off" | "pen-prefix";
  readonly VITE_LESSON_GENERATION?: "one-shot" | "resolved-stepwise";
  readonly VITE_QA_DIRECT_DRAW?: "off" | "on";
  readonly VITE_ATTENTION_CHOREOGRAPHY?: "off" | "on";
  readonly VITE_REMOTE_AUDIO_ACTIVITY?: "off" | "on";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
