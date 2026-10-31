import type { LayoutBox } from "./layout";

export interface FittedBoardText {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  startY: number;
  fits: boolean;
}

export function fitBoardText(text: string, box: LayoutBox): FittedBoardText {
  for (const fontSize of [43, 38, 34, 30, 27, 24, 21, 18]) {
    const maxChars = Math.max(1, Math.floor(box.width / (fontSize * 0.58)));
    // Shrink before splitting a word: "Pythagorea / n theorem" reads worse
    // than a smaller title. Only the last-resort size below may split words.
    if (longestWord(text) > maxChars) continue;
    const lines = wrapBoardText(text, maxChars);
    const lineHeight = fontSize * 1.08;
    if (
      lines.length * lineHeight <= box.height &&
      lines.every((line) => line.length * fontSize * 0.58 <= box.width)
    ) {
      const blockHeight = lines.length * lineHeight;
      return {
        lines,
        fontSize,
        lineHeight,
        startY: box.y + (box.height - blockHeight) / 2 + fontSize * 0.82,
        fits: true,
      };
    }
  }
  const fontSize = 18;
  const lineHeight = fontSize * 1.08;
  const lines = wrapBoardText(text, Math.max(1, Math.floor(box.width / (fontSize * 0.58))));
  return {
    lines,
    fontSize,
    lineHeight,
    startY: box.y + fontSize * 0.82,
    fits:
      lines.length * lineHeight <= box.height &&
      lines.every((line) => line.length * fontSize * 0.58 <= box.width),
  };
}

function longestWord(text: string): number {
  return Math.max(0, ...text.split(/\s+/).map((word) => word.length));
}

function wrapBoardText(text: string, maxChars: number): string[] {
  return text.split("\n").flatMap((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const whole = balancedLines(words, maxChars);
    // A line may also end after a dash inside a word ("68–95–" / "99.7 rule"),
    // as browsers wrap, but only when that saves a line or a stranded last word.
    const pieces = words.flatMap((word) => dashPieces(word).map((piece, index) => (index === 0 ? piece : `${GLUE}${piece}`)));
    if (pieces.length === words.length) return whole;
    const split = balancedLines(pieces, maxChars);
    // At the last-resort size a word wider than the line is cut; after its dash reads better.
    if (words.some((word) => word.length > maxChars)) return split;
    const stranded = (lines: string[]) => lines.length > 1 && lines.at(-1)!.length <= STRANDED_CHARS;
    return split.length < whole.length || (split.length === whole.length && stranded(whole) && !stranded(split))
      ? split
      : whole;
  });
}

/** Marks a piece that continues the previous one with no space (after a dash). */
const GLUE = "\u0000";
/** A last line this short reads as a stranded word. */
const STRANDED_CHARS = 4;

/** A word split after each inner dash, when both sides keep at least two characters. */
function dashPieces(word: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  for (let index = 2; index <= word.length - 2; index += 1) {
    if (/[-–—]/.test(word[index - 1]) && index - start >= 2) {
      pieces.push(word.slice(start, index));
      start = index;
    }
  }
  pieces.push(word.slice(start));
  return pieces;
}

/**
 * Keep the greedy line count but use the narrowest width that still achieves
 * it, so the last line is not a stranded word ("Nodes: x = 0 and x" / "= L"
 * becomes "Nodes: x = 0" / "and x = L").
 */
function balancedLines(words: readonly string[], maxChars: number): string[] {
  const greedy = greedyLines(words, maxChars);
  if (greedy.length < 2) return greedy;
  const totalLength = words.reduce((line, word) => join(line, word), "").length;
  const longest = Math.max(...words.map((word) => unglued(word).length));
  const narrowest = Math.max(Math.ceil(totalLength / greedy.length), Math.min(longest, maxChars));
  for (let width = narrowest; width < maxChars; width += 1) {
    const candidate = greedyLines(words, width);
    if (candidate.length === greedy.length) return candidate;
  }
  return greedy;
}

function greedyLines(words: readonly string[], maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const glued of words) {
    const word = unglued(glued);
    if (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      const chunks = Array.from(
        { length: Math.ceil(word.length / maxChars) },
        (_, index) => word.slice(index * maxChars, (index + 1) * maxChars),
      );
      lines.push(...chunks.slice(0, -1));
      line = chunks.at(-1) ?? "";
      continue;
    }
    if (!line || join(line, glued).length <= maxChars) {
      line = join(line, glued);
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** `line` extended by `word`: a space between them unless `word` continues after a dash. */
function join(line: string, word: string): string {
  if (!line) return unglued(word);
  return word.startsWith(GLUE) ? `${line}${word.slice(GLUE.length)}` : `${line} ${word}`;
}

function unglued(word: string): string {
  return word.startsWith(GLUE) ? word.slice(GLUE.length) : word;
}
