import { useCallback, useRef, useState } from "react";
import { Board } from "../board/Board";
import type { NormalizedLesson } from "../board/decode";

export interface ScratchWindowProps {
  lesson: NormalizedLesson;
  onClose: () => void;
}

/**
 * Floating, draggable, resizable card that paints one validated scratch step
 * with the standard board renderer. It owns only window chrome: the content is
 * static (fully revealed) and never touches lesson or manifest state.
 */
export function ScratchWindow({ lesson, onClose }: ScratchWindowProps) {
  const [position, setPosition] = useState({ x: 24, y: 96 });
  const dragRef = useRef<{ pointerId: number; dx: number; dy: number }>();

  const onHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("button")) return;
      dragRef.current = {
        pointerId: event.pointerId,
        dx: event.clientX - position.x,
        dy: event.clientY - position.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [position.x, position.y],
  );

  const onHeaderPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition({
      x: Math.max(0, event.clientX - drag.dx),
      y: Math.max(0, event.clientY - drag.dy),
    });
  }, []);

  const onHeaderPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
  }, []);

  return (
    <section
      className="scratch-window"
      style={{ left: position.x, top: position.y }}
      aria-label={`Scratch card: ${lesson.title}`}
    >
      <div
        className="scratch-window-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerEnd}
        onPointerCancel={onHeaderPointerEnd}
      >
        <span className="scratch-window-title">{lesson.title}</span>
        <button
          className="scratch-window-close"
          type="button"
          onClick={onClose}
          aria-label="Close scratch card"
        >
          ×
        </button>
      </div>
      <div className="scratch-window-body">
        <Board
          lesson={lesson}
          currentStepIndex={0}
          currentStepProgress={1}
          phase="SCRATCH"
        />
      </div>
    </section>
  );
}
