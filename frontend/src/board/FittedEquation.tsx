import { useLayoutEffect, useRef, useState } from "react";
import { equationFitScale, MIN_FITTED_EQUATION_FONT_PX } from "./equationSizing";

const FIT_TOLERANCE = 0.995;
/** Breathing room after a shrink so sub-pixel rounding cannot clip the last glyph. */
const FIT_MARGIN = 0.96;

/**
 * KaTeX markup that shrinks until it fits its committed box. Only the font
 * changes; the box, and therefore layout, lints, and the manifest, never move.
 * Remount (via `key`) when the markup, base font, or box changes.
 */
export function FittedEquation({
  html,
  fontSize,
  className,
}: {
  html: string;
  fontSize?: number;
  className: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fittedFontSize, setFittedFontSize] = useState<number>();
  const renderedFontSize = fittedFontSize ?? fontSize;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const currentFontSize = renderedFontSize ?? Number.parseFloat(getComputedStyle(host).fontSize);
    if (!(currentFontSize > MIN_FITTED_EQUATION_FONT_PX)) return;
    const scale = equationFitScale(renderedInkBounds(host), host.getBoundingClientRect());
    if (scale >= FIT_TOLERANCE) return;
    // KaTeX sizes everything in em, so one proportional step fits exactly.
    setFittedFontSize(Math.max(MIN_FITTED_EQUATION_FONT_PX, currentFontSize * scale * FIT_MARGIN));
  }, [renderedFontSize]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={renderedFontSize === undefined ? undefined : { fontSize: `${renderedFontSize}px` }}
      // This markup is produced by KaTeX with trust disabled after a CHALK
      // command allowlist; raw model HTML never reaches this sink.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Union of KaTeX's laid-out `.base` runs, which include any overflowing ink. */
function renderedInkBounds(host: HTMLElement): { width: number; height: number } {
  const runs = host.querySelectorAll<HTMLElement>(".katex-html .base");
  const elements = runs.length > 0 ? Array.from(runs) : Array.from(host.children);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return right > left && bottom > top
    ? { width: right - left, height: bottom - top }
    : { width: 0, height: 0 };
}
