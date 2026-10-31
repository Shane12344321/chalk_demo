import type { LayoutBox } from "./layout";
import type { AxesOp } from "./lesson.generated";
import type { Frame } from "./scene/types";

/**
 * One renderer-owned mapping for the drawable interior of axes. Curves and
 * construction relations must share this exact box or conceptual contact can
 * drift when axis labels or margins change.
 */
export function axesPlotBox(box: LayoutBox): LayoutBox {
  return {
    x: box.x + 58,
    y: box.y + 24,
    width: box.width - 82,
    height: box.height - 76,
  };
}

/** The plot frame of schema axes: data window on the plot interior, axes on its edges. */
export function axesFrame(axes: Pick<AxesOp, "id" | "x" | "y">, box: LayoutBox): Frame {
  return {
    id: axes.id,
    box: axesPlotBox(box),
    window: { x: [axes.x.min, axes.x.max], y: [axes.y.min, axes.y.max] },
    axes: "edge",
    grid: false,
    equalScale: false,
    titles: { x: axes.x.label, y: axes.y.label },
  };
}
