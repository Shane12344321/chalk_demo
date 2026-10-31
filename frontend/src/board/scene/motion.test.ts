import { describe, expect, it } from "vitest";
import {
  groupRevealProgress,
  interpolate,
  rate,
  RATE_NAMES,
  staggerProgress,
  strokeRevealProgress,
  type StaggeredPath,
} from "./motion";

/** Deterministic pseudo-random stream for property tests. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

// The timing formulas the board used before the motion core existed.
function historicalOpProgress(weights: number[], index: number, progress: number): number {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const before = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0);
  return clamp((clamp(progress) * total - before) / (weights[index] ?? 1));
}

function historicalReveal(paths: StaggeredPath[], group: number, progress: number): number {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const ease = (value: number) => (value < 0.5 ? 4 * value * value * value : 1 - (-2 * value + 2) ** 3 / 2);
  const groups = new Map<number, number>();
  for (const path of paths) {
    if (path.revealGroup === undefined) continue;
    groups.set(path.revealGroup, Math.max(groups.get(path.revealGroup) ?? 0, path.revealWeight ?? 1));
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a - b);
  const total = ordered.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return clamp(progress);
  const before = ordered.filter(([g]) => g < group).reduce((sum, [, weight]) => sum + weight, 0);
  return ease(clamp((progress * total - before) / (groups.get(group) ?? 1)));
}

describe("rate functions", () => {
  it("keeps exact endpoints and Manim's smooth values", () => {
    for (const name of RATE_NAMES) {
      expect(rate(name)(0)).toBe(0);
      expect(rate(name)(1)).toBe(name === "there_and_back" ? 0 : 1);
    }
    expect(rate("smooth")(0.5)).toBe(0.5);
    expect(rate("smooth")(0.25)).toBeCloseTo(0.103515625, 12);
    expect(rate("there_and_back")(0.5)).toBe(1);
    expect(rate("rush_into")(1)).toBeCloseTo(1, 12);
    expect(rate("rush_from")(0)).toBeCloseTo(0, 12);
  });

  it("is monotone for every rate except there_and_back", () => {
    for (const name of RATE_NAMES.filter((value) => value !== "there_and_back")) {
      let previous = 0;
      for (let step = 1; step <= 200; step += 1) {
        const value = rate(name)(step / 200);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = value;
      }
    }
  });
});

describe("stagger mapped onto weights", () => {
  it("reproduces the historical op timing exactly with lag 1", () => {
    const next = random(7);
    for (let trial = 0; trial < 500; trial += 1) {
      const weights = Array.from({ length: 1 + Math.floor(next() * 5) }, () => 0.5 + next() * 3.5);
      const index = Math.floor(next() * (weights.length + 1));
      const progress = next() * 1.2 - 0.1;
      expect(staggerProgress(weights, index, progress)).toBe(historicalOpProgress(weights, index, progress));
    }
  });

  it("reproduces the historical stroke-group reveal exactly", () => {
    const next = random(11);
    for (let trial = 0; trial < 500; trial += 1) {
      const paths: StaggeredPath[] = Array.from({ length: 1 + Math.floor(next() * 8) }, () => ({
        ...(next() < 0.85 ? { revealGroup: Math.floor(next() * 5) } : {}),
        ...(next() < 0.8 ? { revealWeight: 1 + next() * 200 } : {}),
      }));
      const group = Math.floor(next() * 6);
      const progress = next();
      expect(groupRevealProgress(paths, group, progress)).toBe(historicalReveal(paths, group, progress));
    }
  });

  it("overlaps parts with lag < 1 the way Manim's lag_ratio does", () => {
    const weights = [1, 1, 1];
    expect([0, 1, 2].map((index) => staggerProgress(weights, index, 0.5, 0))).toEqual([0.5, 0.5, 0.5]);
    // lag 0.5: parts start at 0, 0.5, 1 of a whole spanning 2 units.
    expect([0, 1, 2].map((index) => staggerProgress(weights, index, 0.5, 0.5))).toEqual([1, 0.5, 0]);
    expect(strokeRevealProgress([{}], {}, 0.5, "linear")).toBe(0.5);
  });
});

describe("interpolate(alpha)", () => {
  it("is a pure function of alpha for every motion", () => {
    const motions = [
      undefined,
      { kind: "create" as const, rate: "smooth" as const },
      { kind: "fade_in" as const },
      { kind: "indicate" as const, scale: 1.5 },
      { kind: "transform" as const, from: "src" },
    ];
    const next = random(3);
    const alphas = Array.from({ length: 50 }, () => next());
    for (const motion of motions) {
      const forward = alphas.map((alpha) => interpolate(motion, alpha));
      const backward = [...alphas].reverse().map((alpha) => interpolate(motion, alpha)).reverse();
      expect(backward).toEqual(forward);
    }
  });

  it("gives each motion its Manim meaning", () => {
    expect(interpolate(undefined, 0.3)).toEqual({ draw: 0.3, opacity: 1, scale: 1 });
    expect(interpolate({ kind: "fade_in" }, 0.5).opacity).toBe(0.5);
    expect(interpolate({ kind: "indicate" }, 0.5).scale).toBeCloseTo(1.2);
    expect(interpolate({ kind: "indicate" }, 1).scale).toBe(1);
    expect(interpolate({ kind: "transform", from: "a" }, 0.5).morph).toBe(0.5);
    // At 1 the target's own strokes take over; no morph frame remains.
    expect(interpolate({ kind: "transform", from: "a" }, 1)).toEqual({ draw: 1, opacity: 1, scale: 1 });
  });
});
