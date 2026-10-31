// Minimal ambient types for the Node built-ins used by the dev-only lesson
// source plugin. The project does not depend on @types/node; these cover only
// the calls made in devtools/lessonSource.ts.

declare module "node:path" {
  export const sep: string;
  export function resolve(...segments: string[]): string;
  export function join(...segments: string[]): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(value: string): boolean;
}

declare module "node:fs/promises" {
  export interface ChalkDirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }
  export interface ChalkStats {
    isFile(): boolean;
    size: number;
  }
  export function readdir(path: string, options: { withFileTypes: true }): Promise<ChalkDirent[]>;
  export function realpath(path: string): Promise<string>;
  export function stat(path: string): Promise<ChalkStats>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
}

declare module "node:fs/promises" {
  export function mkdtemp(prefix: string): Promise<string>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function writeFile(path: string, data: string): Promise<void>;
  export function symlink(target: string, path: string): Promise<void>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module "node:os" {
  export function tmpdir(): string;
}
