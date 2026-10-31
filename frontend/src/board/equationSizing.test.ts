import { describe, expect, it } from "vitest";
import { EQUATION_BASE_FONT_PX, equationFitScale } from "./equationSizing";

describe("shared equation sizing", () => {
  it("paints every equation from one base size and only ever shrinks it", () => {
    expect(EQUATION_BASE_FONT_PX).toBe(31);
    expect(equationFitScale({ width: 600, height: 60 }, { width: 300, height: 120 })).toBe(0.5);
  });
});
