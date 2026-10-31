import { parse, type MathNode } from "mathjs/number";

const ALLOWED_FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "exp",
  "log",
  "sqrt",
  "abs",
]);
/** The one free variable an expression may use: `x` for y(x), `t` for x(t)/y(t), `theta` for r(θ). */
export type ExpressionVariable = "x" | "t" | "theta";
const CONSTANT_SYMBOLS = ["pi", "e"] as const;
const ALLOWED_OPERATORS = new Set(["+", "-", "*", "/", "^"]);
const EXPRESSION_CHARACTERS = /^[0-9a-zA-Z_+\-*/^().\s]+$/;

type InspectableNode = MathNode & {
  op?: string;
  args?: MathNode[];
  name?: string;
  value?: unknown;
  fn?: MathNode;
  content?: MathNode;
};

export interface CompiledCurve {
  evaluate: (x: number) => number;
  sample: (domain: readonly [number, number], sampleCount?: number) => Array<[number, number]>;
}

export function compileSafeCurve(expression: string): CompiledCurve {
  return compileSafeExpression(expression, "x");
}

/**
 * Compile an allowlisted expression in exactly one free variable. Sampling
 * returns `[variable, value]` pairs; callers decide what the pair means.
 */
export function compileSafeExpression(
  expression: string,
  variable: ExpressionVariable,
): CompiledCurve {
  if (
    expression.length === 0 ||
    expression.length > 120 ||
    !EXPRESSION_CHARACTERS.test(expression)
  ) {
    throw new Error("Expression contains unsupported characters or exceeds its budget.");
  }

  const node = parse(expression);
  inspectNode(node as InspectableNode, 0, new Set([variable, ...CONSTANT_SYMBOLS]));
  const compiled = node.compile();

  const evaluate = (x: number): number => {
    const value: unknown = compiled.evaluate({ [variable]: x });
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Expression produced a non-finite number.");
    }
    return value;
  };

  return {
    evaluate,
    sample: (domain, sampleCount = 121) => {
      const [start, end] = domain;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        throw new Error("Curve domain must be finite and increasing.");
      }
      const count = Math.min(241, Math.max(16, Math.floor(sampleCount)));
      const points: Array<[number, number]> = [];
      let previousY: number | undefined;
      for (let index = 0; index < count; index += 1) {
        const x = start + ((end - start) * index) / (count - 1);
        const y = evaluate(x);
        if (Math.abs(y) > 1_000_000) {
          throw new Error("Expression output exceeds the rendering budget.");
        }
        if (
          previousY !== undefined &&
          Math.abs(y - previousY) > Math.max(10_000, Math.abs(previousY) * 100)
        ) {
          throw new Error("Expression has a pathological sampled discontinuity.");
        }
        points.push([x, y]);
        previousY = y;
      }
      return points;
    },
  };
}

function inspectNode(
  node: InspectableNode,
  depth: number,
  allowedSymbols: ReadonlySet<string>,
): void {
  if (depth > 24) throw new Error("Expression nesting exceeds the allowed budget.");

  switch (node.type) {
    case "ConstantNode":
      if (typeof node.value !== "number" || !Number.isFinite(node.value)) {
        throw new Error("Only finite numeric literals are allowed.");
      }
      return;
    case "SymbolNode":
      if (!node.name || !allowedSymbols.has(node.name)) {
        throw new Error(`Unsupported symbol: ${node.name ?? "unknown"}.`);
      }
      return;
    case "ParenthesisNode":
      if (!node.content) throw new Error("Malformed parenthesized expression.");
      inspectNode(node.content as InspectableNode, depth + 1, allowedSymbols);
      return;
    case "OperatorNode":
      if (!node.op || !ALLOWED_OPERATORS.has(node.op) || !node.args) {
        throw new Error(`Unsupported operator: ${node.op ?? "unknown"}.`);
      }
      for (const argument of node.args) {
        inspectNode(argument as InspectableNode, depth + 1, allowedSymbols);
      }
      return;
    case "FunctionNode": {
      const functionNode = node.fn as InspectableNode | undefined;
      if (
        functionNode?.type !== "SymbolNode" ||
        !functionNode.name ||
        !ALLOWED_FUNCTIONS.has(functionNode.name) ||
        node.args?.length !== 1
      ) {
        throw new Error("Only allowlisted one-argument functions are allowed.");
      }
      inspectNode(node.args[0] as InspectableNode, depth + 1, allowedSymbols);
      return;
    }
    default:
      throw new Error(`Unsupported expression node: ${node.type}.`);
  }
}
