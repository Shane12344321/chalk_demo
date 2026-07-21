/**
 * The board model sometimes writes ASCII Greek names in text ops and labels
 * ("theta_c", "delta x") where KaTeX never runs. Rendering those literally
 * reads as broken math on the board, so whole-word Greek names are swapped
 * for their glyphs at decode time. Equation ops are untouched: they carry
 * real LaTeX and render through KaTeX.
 */
const GREEK_GLYPHS: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  phi: "φ",
  omega: "ω",
  Delta: "Δ",
  Theta: "Θ",
  Omega: "Ω",
};

// Letter-only boundaries instead of \b so subscripted forms like "theta_c"
// still match ("_" counts as a word character and defeats \b).
const GREEK_NAME_PATTERN = new RegExp(
  `(?<![A-Za-z])(${Object.keys(GREEK_GLYPHS).join("|")})(?![A-Za-z])`,
  "g",
);

export function substituteGreekNames(text: string): string {
  return text.replace(GREEK_NAME_PATTERN, (name) => GREEK_GLYPHS[name] ?? name);
}
