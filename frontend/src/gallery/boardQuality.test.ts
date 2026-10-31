import { describe, expect, it } from "vitest";
import {
  analyzeBoardSnapshot,
  type Box,
  type BoardMeasurer,
  type ElementSnapshot,
  measureBoardQuality,
  unionArea,
} from "./boardQuality";

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

function element(partial: Partial<ElementSnapshot> & { id: string; kind: string }): ElementSnapshot {
  return { ink: [], inkBounds: [], texts: [], ...partial };
}

describe("unionArea", () => {
  it("counts overlapping rectangles once", () => {
    expect(unionArea([box(0, 0, 10, 10), box(5, 5, 10, 10)])).toBe(175);
    expect(unionArea([box(0, 0, 10, 10), box(2, 2, 2, 2)])).toBe(100);
    expect(unionArea([box(0, 0, 10, 10), box(20, 0, 10, 10)])).toBe(200);
    expect(unionArea([])).toBe(0);
  });
});

describe("analyzeBoardSnapshot", () => {
  it("reports a clean board with coverage", () => {
    const result = analyzeBoardSnapshot({
      elements: [
        element({ id: "title", kind: "text", texts: [{ role: "text", box: box(0, 0, 800, 90), fontSize: 43, lines: ["Hello world"] }] }),
        element({ id: "eq", kind: "equation", equation: { host: box(800, 0, 800, 450), ink: box(900, 100, 400, 100), fontSize: 37 } }),
      ],
    });
    expect(result.issueTotal).toBe(0);
    expect(result.elementCount).toBe(2);
    expect(result.coverage).toBeCloseTo((800 * 90 + 800 * 450) / (1600 * 900), 4);
  });

  it("flags text overlapping another element's ink above 12% of the smaller area", () => {
    const text = element({ id: "t", kind: "text", texts: [{ role: "text", box: box(100, 100, 100, 50), fontSize: 40, lines: ["abc"] }] });
    const blob = element({ id: "b", kind: "sketch", ink: [box(150, 100, 100, 50)], inkBounds: [box(150, 100, 100, 50)] });
    const result = analyzeBoardSnapshot({ elements: [text, blob] });
    expect(result.issueCounts.overlap).toBe(1);
    expect(result.issues[0]).toMatchObject({ type: "overlap", elementIds: ["t", "b"], value: 0.5 });
  });

  it("ignores small grazes and an element's own labels", () => {
    const text = element({ id: "t", kind: "text", texts: [{ role: "text", box: box(0, 0, 100, 100), fontSize: 40, lines: ["x"] }] });
    const graze = element({ id: "g", kind: "line", ink: [box(95, 0, 10, 100)], inkBounds: [box(95, 0, 10, 100)] });
    const self = element({
      id: "s",
      kind: "point",
      ink: [box(500, 500, 20, 20)],
      inkBounds: [box(500, 500, 20, 20)],
      texts: [{ role: "label", box: box(500, 500, 20, 20), fontSize: 24, lines: ["P"] }],
    });
    // graze: 5x100 of the 10x100 line = 0.5 of the line -> flagged; shrink to 1px.
    const thin = { ...graze, ink: [box(99, 0, 10, 100)] };
    expect(analyzeBoardSnapshot({ elements: [text, thin, self] }).issueCounts.overlap).toBe(0);
  });

  it("does not flag curves plotted inside their own axes, but flags foreign text there", () => {
    const axes = element({
      id: "ax",
      kind: "axes",
      ink: [box(0, 400, 800, 4), box(0, 0, 4, 400)],
      inkBounds: [box(0, 0, 800, 404)],
      texts: [{ role: "label", box: box(700, 410, 60, 24), fontSize: 24, lines: ["x"] }],
    });
    const curve = element({
      id: "c",
      kind: "curve",
      ink: [box(690, 400, 80, 30)],
      inkBounds: [box(10, 10, 780, 420)],
      texts: [{ role: "label", box: box(0, 395, 30, 20), fontSize: 24, lines: ["f"] }],
    });
    const note = element({ id: "n", kind: "text", texts: [{ role: "text", box: box(0, 380, 200, 40), fontSize: 43, lines: ["note"] }] });
    const result = analyzeBoardSnapshot({ elements: [axes, curve, note] });
    const pairs = result.issues
      .filter((issue) => issue.type === "overlap")
      .map((issue) => [...issue.elementIds].sort().join("+"));
    expect(pairs.sort()).toEqual(["ax+n", "c+n"]);
  });

  it("flags clipped equations, out-of-board elements, small text, and short last lines", () => {
    const result = analyzeBoardSnapshot({
      elements: [
        element({ id: "eq", kind: "equation", equation: { host: box(0, 0, 300, 100), ink: box(0, 20, 320, 60), fontSize: 9.7 } }),
        element({ id: "fine", kind: "equation", equation: { host: box(0, 200, 300, 100), ink: box(0, 200, 300.8, 60), fontSize: 20 } }),
        element({ id: "off", kind: "line", ink: [box(1500, 800, 120, 10)], inkBounds: [box(1500, 800, 120, 10)] }),
        element({
          id: "wrap",
          kind: "text",
          texts: [{ role: "text", box: box(400, 400, 500, 100), fontSize: 43, lines: ["Velocity is the", "rate"] }],
        }),
        element({
          id: "lab",
          kind: "axes",
          texts: [{ role: "label", box: box(1000, 100, 40, 12), fontSize: 12, lines: ["Fx"] }],
        }),
      ],
    });
    expect(result.issueCounts).toEqual({
      overlap: 0,
      clipped_equation: 1,
      outside_board: 1,
      small_text: 2,
      short_last_line: 1,
    });
    expect(result.issues.find((issue) => issue.type === "clipped_equation")).toMatchObject({ elementIds: ["eq"], value: 20 });
    expect(result.issues.find((issue) => issue.type === "outside_board")).toMatchObject({ elementIds: ["off"], value: 20 });
    expect(result.issues.find((issue) => issue.type === "short_last_line")).toMatchObject({ elementIds: ["wrap"], value: 4 });
  });
});

describe("measureBoardQuality (DOM)", () => {
  // jsdom has no SVG layout; boxes come from data-test-box attributes.
  const parse = (element: Element): Box | undefined => {
    const raw = element.getAttribute("data-test-box");
    if (!raw) return undefined;
    const [x, y, width, height] = raw.split(" ").map(Number);
    return { x, y, width, height };
  };
  const measurer: BoardMeasurer = {
    box: parse,
    fontSize: (element) => {
      const raw = element.getAttribute("data-test-font");
      return raw ? Number(raw) : undefined;
    },
    inkCells: (path) => {
      const bounds = parse(path);
      return bounds ? [bounds] : [];
    },
  };

  it("counts only visible ink: not reveal-timing paths, not a light tint text sits on", () => {
    document.body.innerHTML = `
      <svg viewBox="0 0 1600 900">
        <g data-element-id="note" data-kind="text">
          <text class="board-hand-text" data-test-box="100 300 400 100" data-test-font="43"><tspan>Shaded part</tspan></text>
        </g>
        <g data-element-id="fig" data-kind="figure">
          <path stroke="transparent" fill="none" data-test-box="100 300 400 100"></path>
          <path stroke="none" fill="rgba(217, 122, 41, 0.12)" data-test-box="0 250 800 300"></path>
          <path stroke="#2b2e36" fill="none" data-test-box="1000 300 50 50"></path>
        </g>
        <g data-element-id="solid" data-kind="figure">
          <path stroke="none" fill="#2b2e36" data-test-box="420 330 60 40"></path>
        </g>
      </svg>`;
    const result = measureBoardQuality(document.querySelector("svg")!, measurer);
    expect(result.issues.filter((issue) => issue.type === "overlap").map((issue) => issue.elementIds))
      .toEqual([["note", "solid"]]);
  });

  it("reads element groups, labels, wrapped text, and KaTeX runs", () => {
    document.body.innerHTML = `
      <svg viewBox="0 0 1600 900">
        <g data-element-id="t" data-kind="text">
          <clipPath id="c"><rect x="0" y="0" width="10" height="10"/></clipPath>
          <text class="board-hand-text" data-test-box="100 100 400 100" data-test-font="43" data-text-line-count="2">
            <tspan>Hello there</tspan><tspan>you</tspan>
          </text>
        </g>
        <g data-element-id="ax" data-kind="axes">
          <path data-board-mark="ink" data-test-box="300 120 400 20"></path>
          <text data-board-mark="label" data-test-box="1590 850 40 20" data-test-font="24">x</text>
        </g>
        <g data-element-id="eq" data-kind="equation">
          <foreignObject x="800" y="400" width="200" height="100">
            <div class="board-equation" data-test-font="10">
              <span class="katex" data-test-font="12.1"><span class="katex-html">
                <span class="base" data-test-box="790 420 110 40"></span>
                <span class="base" data-test-box="900 420 110 40"></span>
                <svg><path data-test-box="111 80 400890 2400"></path></svg>
              </span></span>
            </div>
          </foreignObject>
        </g>
      </svg>`;
    const svg = document.querySelector("svg")!;
    const result = measureBoardQuality(svg, measurer);
    expect(result.elementCount).toBe(3);
    expect(result.issueCounts).toEqual({
      overlap: 1,
      clipped_equation: 1,
      outside_board: 1,
      small_text: 1,
      short_last_line: 1,
    });
    expect(result.issues.find((issue) => issue.type === "overlap")?.elementIds).toEqual(["t", "ax"]);
    expect(result.issues.find((issue) => issue.type === "clipped_equation")?.value).toBe(20);
    expect(result.issues.find((issue) => issue.type === "small_text")).toMatchObject({ elementIds: ["eq"], value: 12.1 });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
