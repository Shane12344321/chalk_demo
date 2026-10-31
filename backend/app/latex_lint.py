"""Conservative structural lint for untrusted equation LaTeX.

The browser (KaTeX strict mode with trust disabled) remains the rendering
authority; this lint exists so the classes of equation KaTeX rejects —
unknown commands, unbalanced groups, unpaired ``\\left``, math-mode dollars,
and forbidden commands — trigger repair on the backend instead of a dropped
op in the browser. The contract is pinned by
``shared/fixtures/latex-parity.json``. A false reject only costs a repair
rewrite; a false accept only costs one browser-dropped op.
"""

from __future__ import annotations

import re

# Mirrors FORBIDDEN_LATEX_COMMAND in frontend/src/board/latex.ts.
_FORBIDDEN_COMMAND = re.compile(
    r"\\(?:href|url|includegraphics|html[a-z]*|class|style|gdef|def|newcommand|renewcommand)\b",
    re.IGNORECASE,
)
_COMMAND = re.compile(r"\\([a-zA-Z]+)")
_LEFT_RIGHT = re.compile(r"\\(left|right)(?![a-zA-Z])")

_ALLOWED_COMMANDS = frozenset(
    {
        # Structure and spacing
        "frac",
        "dfrac",
        "tfrac",
        "sqrt",
        "left",
        "right",
        "quad",
        "qquad",
        "text",
        "mathrm",
        "mathbf",
        "mathbb",
        "mathcal",
        "operatorname",
        "overline",
        "underline",
        "overbrace",
        "underbrace",
        "boxed",
        # Functions
        "sin",
        "cos",
        "tan",
        "sec",
        "csc",
        "cot",
        "arcsin",
        "arccos",
        "arctan",
        "sinh",
        "cosh",
        "tanh",
        "ln",
        "log",
        "exp",
        "lim",
        "max",
        "min",
        "sum",
        "prod",
        "int",
        "oint",
        # Greek letters
        "alpha",
        "beta",
        "gamma",
        "delta",
        "epsilon",
        "varepsilon",
        "zeta",
        "eta",
        "theta",
        "vartheta",
        "iota",
        "kappa",
        "lambda",
        "mu",
        "nu",
        "xi",
        "pi",
        "rho",
        "sigma",
        "tau",
        "upsilon",
        "phi",
        "varphi",
        "chi",
        "psi",
        "omega",
        "Gamma",
        "Delta",
        "Theta",
        "Lambda",
        "Xi",
        "Pi",
        "Sigma",
        "Upsilon",
        "Phi",
        "Psi",
        "Omega",
        # Accents and vectors
        "vec",
        "hat",
        "bar",
        "dot",
        "ddot",
        "tilde",
        "overrightarrow",
        "overleftarrow",
        # Relations and operators
        "cdot",
        "times",
        "div",
        "pm",
        "mp",
        "leq",
        "geq",
        "neq",
        "approx",
        "sim",
        "simeq",
        "equiv",
        "propto",
        "infty",
        "partial",
        "nabla",
        "degree",
        "circ",
        "prime",
        "perp",
        "parallel",
        "angle",
        # Arrows and dots
        "to",
        "rightarrow",
        "Rightarrow",
        "leftarrow",
        "Leftarrow",
        "leftrightarrow",
        "Leftrightarrow",
        "mapsto",
        "implies",
        "iff",
        "dots",
        "ldots",
        "cdots",
        "vdots",
        "ddots",
        # Every name below renders under the browser's exact KaTeX options
        # (shared/fixtures/latex-parity.json pins a sample of each group).
        # Relations, sets, and logic
        "le",
        "ge",
        "ne",
        "lt",
        "gt",
        "leqslant",
        "geqslant",
        "ll",
        "gg",
        "cong",
        "approxeq",
        "lesssim",
        "mid",
        "nmid",
        "not",
        "in",
        "notin",
        "ni",
        "subset",
        "subseteq",
        "supset",
        "supseteq",
        "cap",
        "cup",
        "bigcap",
        "bigcup",
        "setminus",
        "emptyset",
        "varnothing",
        "complement",
        "forall",
        "exists",
        "nexists",
        "neg",
        "lnot",
        "land",
        "lor",
        "wedge",
        "vee",
        "therefore",
        "because",
        "impliedby",
        "top",
        "intercal",
        # Delimiters and sizes
        "langle",
        "rangle",
        "lvert",
        "rvert",
        "lVert",
        "rVert",
        "vert",
        "Vert",
        "lfloor",
        "rfloor",
        "lceil",
        "rceil",
        "big",
        "Big",
        "bigg",
        "Bigg",
        "bigl",
        "bigr",
        "Bigl",
        "Bigr",
        "biggl",
        "biggr",
        "Biggl",
        "Biggr",
        # More functions
        "coth",
        "det",
        "gcd",
        "deg",
        "arg",
        "sup",
        "inf",
        "Pr",
        "bmod",
        "pmod",
        "iint",
        "iiint",
        "oiint",
        "coprod",
        # Structure and type
        "begin",
        "end",
        "binom",
        "dbinom",
        "tbinom",
        "choose",
        "over",
        "overset",
        "underset",
        "stackrel",
        "substack",
        "xrightarrow",
        "xleftarrow",
        "cancel",
        "bcancel",
        "displaystyle",
        "textstyle",
        "limits",
        "nolimits",
        "colon",
        "mathit",
        "mathsf",
        "mathtt",
        "mathfrak",
        "textbf",
        "textit",
        "textrm",
        "boldsymbol",
        "widehat",
        "widetilde",
        "overleftrightarrow",
        "mathring",
        "enspace",
        "thinspace",
        "medspace",
        "thickspace",
        "negthinspace",
        # More symbols
        "ell",
        "hbar",
        "imath",
        "jmath",
        "Re",
        "Im",
        "aleph",
        "ast",
        "star",
        "bullet",
        "oplus",
        "otimes",
        "odot",
        "dagger",
        "cdotp",
        "centerdot",
        "triangle",
        "square",
        "measuredangle",
        "checkmark",
        "varrho",
        "varsigma",
        "varpi",
        "varkappa",
        # More arrows
        "uparrow",
        "downarrow",
        "Uparrow",
        "Downarrow",
        "longrightarrow",
        "Longrightarrow",
        "longleftarrow",
        "Longleftarrow",
        "longleftrightarrow",
        "Longleftrightarrow",
        "rightleftharpoons",
        "leftrightarrows",
        "rightrightarrows",
        "hookrightarrow",
        "nearrow",
        "searrow",
        "nwarrow",
        "swarrow",
    }
)

# `\begin`/`\end` name an environment; KaTeX knows only some of them.
_ENVIRONMENT = re.compile(r"\\(?:begin|end)\s*\{([^{}]*)\}")
_ALLOWED_ENVIRONMENTS = frozenset(
    {
        "cases",
        "dcases",
        "rcases",
        "aligned",
        "align",
        "gathered",
        "matrix",
        "pmatrix",
        "bmatrix",
        "vmatrix",
        "Vmatrix",
        "smallmatrix",
        "array",
    }
)


def lint_equation_latex(latex: str) -> list[str]:
    """Return bounded repair-safe issues; an empty list means lint passes."""

    issues: list[str] = []
    if _FORBIDDEN_COMMAND.search(latex):
        issues.append("equation uses a forbidden latex command")
    if _contains_unescaped_dollar(latex):
        issues.append("equation must not contain $; it is already rendered in math mode")
    if not _braces_balanced(latex):
        issues.append("equation braces are unbalanced")
    if not _left_right_paired(latex):
        issues.append("equation \\left has no matching \\right")
    for command in _COMMAND.findall(latex):
        if command not in _ALLOWED_COMMANDS:
            issues.append(f"unknown latex command \\{command}")
            break
    for environment in _ENVIRONMENT.findall(latex):
        if environment not in _ALLOWED_ENVIRONMENTS:
            issues.append("unknown latex environment; use cases, aligned, or a matrix")
            break
    return issues


def _contains_unescaped_dollar(latex: str) -> bool:
    previous_was_escape = False
    for character in latex:
        if previous_was_escape:
            previous_was_escape = False
            continue
        if character == "\\":
            previous_was_escape = True
            continue
        if character == "$":
            return True
    return False


def _braces_balanced(latex: str) -> bool:
    depth = 0
    previous_was_escape = False
    for character in latex:
        if previous_was_escape:
            previous_was_escape = False
            continue
        if character == "\\":
            previous_was_escape = True
            continue
        if character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def _left_right_paired(latex: str) -> bool:
    depth = 0
    for match in _LEFT_RIGHT.finditer(latex):
        depth += 1 if match.group(1) == "left" else -1
        if depth < 0:
            return False
    return depth == 0
