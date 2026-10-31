import { describe, expect, it } from "vitest";
import { decodeLesson } from "./decode";
import { diagramTextBounds } from "./diagramGeometry";
import { BoardGeometryStore, formatAxisValue } from "./geometry";
import { layoutSteps } from "./layout";

function build(lesson: unknown) {
  const decoded = decodeLesson(lesson).lesson!;
  const laidOut = layoutSteps(decoded.steps);
  return { laidOut, geometries: new BoardGeometryStore().build(laidOut).geometries };
}

function snellDiagram(airAt: [number, number]) {
  return {
    schema_version: "1.4",
    title: "Refraction",
    steps: [{
      id: "s1",
      script: "Two media meet at a flat interface with a dashed normal.",
      ops: [{
        op: "diagram",
        id: "optics",
        region: "right",
        primitives: [
          { kind: "line", points: [[0.08, 0.5], [0.92, 0.5]], stroke: "solid" },
          { kind: "line", points: [[0.5, 0.1], [0.5, 0.9]], stroke: "dashed" },
          { kind: "text", at: airAt, content: "air: n = 1.00" },
        ],
      }],
      checkpoint: null,
    }],
  };
}

function sineAxes() {
  return {
    schema_version: "1.0",
    title: "Sine",
    steps: [{
      id: "s1",
      script: "Plot one period of the sine wave.",
      ops: [
        {
          op: "axes",
          id: "plot",
          region: "right",
          x: { min: 0, max: 2 * Math.PI, label: "θ" },
          y: { min: -1.3, max: 1.3, label: "y" },
        },
        { op: "curve", id: "wave", axes_id: "plot", expr: "sin(x)", domain: [0, 2 * Math.PI] },
      ],
      checkpoint: null,
    }],
  };
}

describe("drawing quality regressions", () => {
  it("gives diagram canvases a uniform scale so circles stay round", () => {
    const { laidOut } = build(snellDiagram([0.7, 0.2]));
    const canvas = laidOut.find((item) => item.op.id === "optics")!.canvasBox!;
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.width).toBe(canvas.height);
  });

  it("keeps axes on the plot edges and marks zero with a faint reference line", () => {
    const { geometries } = build(sineAxes());
    const axes = geometries.find((geometry) => geometry.id === "plot")!;
    const reference = axes.paths.filter((path) => path.stroke === "#b4bac4");
    expect(reference).toHaveLength(1);
    expect(reference[0].d).toMatch(/^M [\d.]+ ([\d.]+) L [\d.]+ \1$/);
    const labels = axes.labels.map((label) => label.text);
    expect(labels).toEqual(expect.arrayContaining(["2π", "1.3", "-1.3", "0"]));
    expect(labels).not.toContain(String(2 * Math.PI));
    // The y-axis zero tick (right-aligned), not the x-range minimum below the plot.
    const zero = axes.labels.find((label) => label.text === "0" && label.anchor === "end")!;
    const top = axes.labels.find((label) => label.text === "1.3")!;
    const bottom = axes.labels.find((label) => label.text === "-1.3")!;
    expect(zero.y).toBeGreaterThan(top.y);
    expect(zero.y).toBeLessThan(bottom.y);
  });

  it("formats axis values as integers, simple multiples of π, or three significant figures", () => {
    expect(formatAxisValue(4)).toBe("4");
    expect(formatAxisValue(Math.PI)).toBe("π");
    expect(formatAxisValue(Math.PI / 2)).toBe("π/2");
    expect(formatAxisValue(-Math.PI)).toBe("-π");
    expect(formatAxisValue(3 * Math.PI / 4)).toBe("3π/4");
    expect(formatAxisValue(1.23456)).toBe("1.23");
  });

  it("moves authored diagram text off a line that crosses it, keeping clear text in place", () => {
    const crossing = build(snellDiagram([0.18, 0.18]));
    const diagram = crossing.geometries.find((geometry) => geometry.id === "optics")!;
    const canvas = crossing.laidOut.find((item) => item.op.id === "optics")!.canvasBox!;
    const air = diagram.labels.find((label) => label.text === "air: n = 1.00")!;
    const normalX = canvas.x + 0.5 * canvas.width;
    const fontSize = air.fontSize ?? 31;
    const width = air.text.length * fontSize * 0.58;
    const normalTop = canvas.y + 0.1 * canvas.height;
    const clearOfNormal = air.x + width < normalX || air.x > normalX || air.y + fontSize * 0.25 < normalTop;
    expect(clearOfNormal).toBe(true);

    const clear = build(snellDiagram([0.62, 0.2]));
    const clearCanvas = clear.laidOut.find((item) => item.op.id === "optics")!.canvasBox!;
    const untouched = clear.geometries.find((geometry) => geometry.id === "optics")!
      .labels.find((label) => label.text === "air: n = 1.00")!;
    const authored = diagramTextBounds(
      { kind: "text", at: [0.62, 0.2], content: "air: n = 1.00" },
      clearCanvas,
    );
    expect(untouched.x).toBeCloseTo(authored.x, 5);
    expect(untouched.fontSize).toBe(31);
  });
});

describe("board text wrapping", () => {
  it("balances wrapped lines instead of stranding a short last word", async () => {
    const { fitBoardText } = await import("./textLayout");
    const fitted = fitBoardText("Nodes: x = 0 and x = L", { x: 0, y: 0, width: 420, height: 120 });
    expect(fitted.lines.length).toBeGreaterThan(1);
    const shortest = Math.min(...fitted.lines.map((line) => line.length));
    const longest = Math.max(...fitted.lines.map((line) => line.length));
    expect(shortest / longest).toBeGreaterThan(0.6);
  });
});

describe("board titles never split a word while a smaller size fits it whole", () => {
  it("shrinks instead of breaking a word or orphaning punctuation", async () => {
    const { fitBoardText } = await import("./textLayout");
    for (const [text, width] of [
      ["Pythagorean theorem", 250],
      ["Perpendicular bisector", 250],
      ["Block on a frictionless incline", 250],
      ["The 68-95-99.7 rule", 220],
      ["Butterfly: mirror symmetry", 230],
    ] as const) {
      const fitted = fitBoardText(text, { x: 0, y: 0, width, height: 130 });
      // The one break allowed inside a word is right after a dash.
      expect(fitted.lines.join(" ").replace(/([-–—]) /gu, "$1"), text).toBe(text);
      expect(fitted.fits, text).toBe(true);
    }
  });

  it("breaks after a dash only when that saves a line or a stranded last word", async () => {
    const { fitBoardText } = await import("./textLayout");
    const box = (width: number) => ({ x: 0, y: 0, width, height: 157 });
    expect(fitBoardText("The 68–95–99.7 rule", box(263))).toMatchObject({
      fontSize: 43,
      lines: ["The 68–95–", "99.7 rule"],
    });
    expect(fitBoardText("Mass-spring system", box(200)).lines).toEqual(["Mass-spring", "system"]);
    expect(fitBoardText("Normal: 68–95–99.7", box(300)).lines).toEqual(["Normal:", "68–95–99.7"]);
    expect(fitBoardText("A well-known result", box(330)).lines).toEqual(["A well-known", "result"]);
  });
});
