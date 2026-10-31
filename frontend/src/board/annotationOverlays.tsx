import rough from "roughjs/bin/rough";
import type { AnnotationOp } from "../annotations";
import { stableSeed } from "./geometry";
import { renderSafeLatex } from "./latex";
import { BOARD_HEIGHT, BOARD_WIDTH, type LayoutBox } from "./layout";
import type { VisibleBoardElement } from "./manifest";
import { fitBoardText } from "./textLayout";
import { FittedEquation } from "./FittedEquation";

export function AnnotationOverlayLayer({
  ops,
  elements,
}: {
  ops: readonly AnnotationOp[];
  elements: readonly VisibleBoardElement[];
}) {
  const targets = new Map(elements.map((element) => [element.id, element]));
  return (
    <g className="board-annotation-layer" aria-label="Explanatory board annotations">
      {ops.map((op) => {
        const target = targets.get(op.target_id);
        if (!target) return null;
        let equationHtml: string | undefined;
        try {
          if (op.op === "equation") equationHtml = renderSafeLatex(op.latex);
        } catch {
          return null;
        }
        return (
          <AnnotationMark
            key={op.id}
            op={op}
            target={target}
            equationHtml={equationHtml}
          />
        );
      })}
    </g>
  );
}

function AnnotationMark({
  op,
  target,
  equationHtml,
}: {
  op: AnnotationOp;
  target: VisibleBoardElement;
  equationHtml?: string;
}) {
  const data = {
    "data-annotation-id": op.id,
    "data-annotation-kind": op.op,
    "data-target-id": target.id,
  };
  if (!("side" in op)) {
    const drawable =
      op.op === "circle"
        ? rough.generator().ellipse(
            target.box.x + target.box.width / 2,
            target.box.y + target.box.height / 2,
            target.box.width + 32,
            target.box.height + 32,
            { seed: stableSeed(op.id), roughness: 1.2 },
          )
        : rough.generator().line(
            target.box.x - 5,
            target.box.y + target.box.height + 12,
            target.box.x + target.box.width + 5,
            target.box.y + target.box.height + 12,
            { seed: stableSeed(op.id), roughness: 1.2 },
          );
    return (
      <g className="board-annotation" {...data}>
        {rough.generator().toPaths(drawable).map((path, index) => (
          <path
            key={`${op.id}-${index}`}
            d={path.d}
            fill="none"
            stroke="#3a6fd8"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="5"
          />
        ))}
      </g>
    );
  }

  const box = annotationBox(target.box, op.side, op.op === "arrow" ? 110 : 290, op.op === "equation" ? 88 : 72);
  if (op.op === "arrow") {
    const [fromX, fromY, toX, toY] = arrowCoordinates(box, target.box, op.side);
    const drawable = rough.generator().line(fromX, fromY, toX, toY, {
      seed: stableSeed(op.id),
      roughness: 1.1,
    });
    return (
      <g className="board-annotation" {...data}>
        {rough.generator().toPaths(drawable).map((path, index) => (
          <path
            key={`${op.id}-${index}`}
            d={path.d}
            fill="none"
            markerEnd="url(#annotation-arrowhead)"
            stroke="#3a6fd8"
            strokeLinecap="round"
            strokeWidth="5"
          />
        ))}
      </g>
    );
  }
  if (op.op === "text") {
    const fitted = fitBoardText(op.content, box);
    return (
      <text
        className="board-hand-text board-annotation-text"
        style={{ fontSize: `${fitted.fontSize}px` }}
        x={box.x}
        y={fitted.startY}
        {...data}
      >
        {fitted.lines.map((line, index) => (
          <tspan key={`${op.id}-${index}`} x={box.x} dy={index === 0 ? 0 : fitted.lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    );
  }
  if (op.op !== "equation") return null;
  if (!equationHtml) return null;
  return (
    <foreignObject x={box.x} y={box.y} width={box.width} height={box.height} {...data}>
      <FittedEquation
        key={`${equationHtml}|${box.width}x${box.height}`}
        className="board-equation board-annotation-equation"
        html={equationHtml}
      />
    </foreignObject>
  );
}

function annotationBox(
  target: LayoutBox,
  side: "above" | "below" | "left" | "right",
  width: number,
  height: number,
): LayoutBox {
  const gap = 18;
  const preferred =
    side === "above"
      ? { x: target.x + (target.width - width) / 2, y: target.y - height - gap }
      : side === "below"
        ? { x: target.x + (target.width - width) / 2, y: target.y + target.height + gap }
        : side === "left"
          ? { x: target.x - width - gap, y: target.y + (target.height - height) / 2 }
          : { x: target.x + target.width + gap, y: target.y + (target.height - height) / 2 };
  return {
    x: clamp(preferred.x, 24, BOARD_WIDTH - width - 24),
    y: clamp(preferred.y, 24, BOARD_HEIGHT - height - 24),
    width,
    height,
  };
}

function arrowCoordinates(
  box: LayoutBox,
  target: LayoutBox,
  side: "above" | "below" | "left" | "right",
): [number, number, number, number] {
  if (side === "above") {
    return [box.x + box.width / 2, box.y, target.x + target.width / 2, target.y - 8];
  }
  if (side === "below") {
    return [box.x + box.width / 2, box.y + box.height, target.x + target.width / 2, target.y + target.height + 8];
  }
  if (side === "left") {
    return [box.x, box.y + box.height / 2, target.x - 8, target.y + target.height / 2];
  }
  return [box.x + box.width, box.y + box.height / 2, target.x + target.width + 8, target.y + target.height / 2];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
