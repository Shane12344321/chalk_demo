// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeLesson } from "../board/decode";
import { ScratchWindow } from "./ScratchWindow";

const CARD = decodeLesson({
  schema_version: "1.4",
  title: "a labeled right triangle",
  steps: [
    {
      id: "s1",
      script: "A right triangle with the hypotenuse labeled.",
      ops: [{ op: "text", id: "title", region: "A1", content: "Right triangle" }],
      checkpoint: null,
    },
  ],
}).lesson!;

afterEach(cleanup);

describe("ScratchWindow", () => {
  it("renders the card content fully revealed with its title", () => {
    render(<ScratchWindow lesson={CARD} onClose={() => {}} />);
    expect(screen.getByLabelText("Scratch card: a labeled right triangle")).toBeTruthy();
    expect(screen.getByText("Right triangle")).toBeTruthy();
  });

  it("closes through the close control", () => {
    const onClose = vi.fn();
    render(<ScratchWindow lesson={CARD} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close scratch card"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
