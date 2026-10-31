import { describe, expect, it } from "vitest";
import curveParity from "../../../shared/fixtures/curve-parity.json";
import latexParity from "../../../shared/fixtures/latex-parity.json";
import sanitizerParity from "../../../shared/fixtures/sanitizer-parity.json";
import { sampleVisibleCurveSegments } from "./scene/sample";
import { renderSafeLatex } from "./latex";
import { sanitizeStep, type SanitizationCode } from "./sanitize";

interface CurveParityCase {
  name: string;
  expr: string;
  emitted_expr?: string;
  domain: number[] | null;
  axes: {
    x: { min: number; max: number; label: string };
    y: { min: number; max: number; label: string };
  };
  expect?: "accept" | "reject";
  browser_expect?: "accept" | "reject";
  backend_expect?: "accept" | "reject";
  reason: string;
}

interface LatexParityCase {
  name: string;
  latex: string;
  expect: "accept" | "reject";
}

interface SanitizerParityCase {
  name: string;
  input: unknown;
  expected: unknown;
  corrections: SanitizationCode[];
  correction_count: number;
}

describe("shared curve parity fixtures encode browser truth", () => {
  for (const parityCase of curveParity.cases as CurveParityCase[]) {
    const browserExpectation = parityCase.browser_expect ?? parityCase.expect;
    it(`${parityCase.name} is ${browserExpectation}ed by the browser`, () => {
      expect(browserExpectation).toMatch(/^(accept|reject)$/);
      const expr = parityCase.emitted_expr ?? parityCase.expr;
      const sample = () =>
        sampleVisibleCurveSegments(
          {
            expr,
            ...(parityCase.domain
              ? { domain: [parityCase.domain[0], parityCase.domain[1]] as [number, number] }
              : {}),
          },
          parityCase.axes,
        );
      if (browserExpectation === "accept") {
        expect(sample().length).toBeGreaterThan(0);
      } else {
        expect(() => {
          if (sample().length === 0) throw new Error("Curve has no visible segments.");
        }).toThrow();
      }
    });
  }

  it("rejects the raw pre-normalization power operator", () => {
    expect(() =>
      sampleVisibleCurveSegments(
        { expr: "x**2" },
        {
          x: { min: -2, max: 2, label: "x" },
          y: { min: 0, max: 4, label: "y" },
        },
      ),
    ).toThrow();
  });
});

describe("shared latex parity fixtures encode browser truth", () => {
  for (const parityCase of latexParity.cases as LatexParityCase[]) {
    it(`${parityCase.name} is ${parityCase.expect}ed`, () => {
      if (parityCase.expect === "accept") {
        expect(renderSafeLatex(parityCase.latex)).toContain("katex");
      } else {
        expect(() => renderSafeLatex(parityCase.latex)).toThrow();
      }
    });
  }
});

describe("shared sanitizer parity fixtures pin safe-only corrections", () => {
  for (const parityCase of sanitizerParity.cases as SanitizerParityCase[]) {
    it(parityCase.name, () => {
      const result = sanitizeStep(parityCase.input);
      expect(result.value).toEqual(parityCase.expected);
      expect(result.corrections).toEqual(parityCase.corrections);
      expect(result.correctionCount).toBe(parityCase.correction_count);

      expect(sanitizeStep(result.value)).toEqual({
        value: result.value,
        corrections: [],
        correctionCount: 0,
      });
    });
  }

  it("caps correction evidence even when many coordinates are safely clamped", () => {
    const result = sanitizeStep({
      id: "s1",
      script: "Draw many near-boundary points.",
      ops: [
        {
          op: "sketch",
          id: "sketch1",
          region: "left",
          strokes: [Array.from({ length: 40 }, () => [-0.01, 1.01])],
        },
      ],
      checkpoint: null,
    });
    expect(result.correctionCount).toBe(64);
  });
});
