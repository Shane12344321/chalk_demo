import { describe, expect, it } from "vitest";
import { substituteGreekNames } from "./mathGlyphs";

describe("substituteGreekNames", () => {
  it("replaces whole-word Greek names including subscripted forms", () => {
    expect(substituteGreekNames("sin(theta_c) = n_rar / n_den")).toBe(
      "sin(θ_c) = n_rar / n_den",
    );
    expect(substituteGreekNames("total reflection when theta_i > theta_c")).toBe(
      "total reflection when θ_i > θ_c",
    );
    expect(substituteGreekNames("area = pi r^2")).toBe("area = π r^2");
    expect(substituteGreekNames("Delta x over Delta t")).toBe("Δ x over Δ t");
  });

  it("leaves embedded fragments and ordinary prose alone", () => {
    expect(substituteGreekNames("the spinning ball")).toBe("the spinning ball");
    expect(substituteGreekNames("alphabet soup")).toBe("alphabet soup");
    expect(substituteGreekNames("a topic sentence")).toBe("a topic sentence");
  });
});
