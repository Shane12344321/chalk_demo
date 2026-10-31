/**
 * Every equation paints at this size and shrinks only when its measured ink
 * overflows its box (see `FittedEquation`). A length-based guess used to pick the
 * font instead; it assumed ~0.9em per character, roughly twice KaTeX's real
 * width, and precommit measurement fed each shrunken box back into the guess,
 * so long equations collapsed to the 10px floor.
 */
export const EQUATION_BASE_FONT_PX = 31;

/** Legibility floor; below this an equation is clipped rather than shrunk further. */
export const MIN_FITTED_EQUATION_FONT_PX = 8;

/**
 * Scale (<= 1) that makes rendered content fit its box. The length-based font
 * heuristic cannot see KaTeX spacing such as `\quad` or relation gaps, so the
 * painter measures the real ink. Both sizes must share one unit; screen pixels
 * work because the board's viewBox scale cancels out.
 */
export function equationFitScale(
  content: { width: number; height: number },
  box: { width: number; height: number },
): number {
  if (!(content.width > 0) || !(content.height > 0) || !(box.width > 0) || !(box.height > 0)) {
    return 1;
  }
  return Math.min(1, box.width / content.width, box.height / content.height);
}
