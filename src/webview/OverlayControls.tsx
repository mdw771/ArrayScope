import { useRef, useState, type PointerEvent } from "react";
import { removeOverlay } from "./controller";
import { useViewerStore } from "./store";

interface WindowDrag {
  pointerId: number;
  clientX: number;
  clientY: number;
  left: number;
  top: number;
}

export function OverlayControls() {
  const overlay = useViewerStore((state) => state.overlay);
  const setTransparency = useViewerStore((state) => state.setOverlayTransparency);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<WindowDrag | undefined>(undefined);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  if (!overlay) return null;

  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      left: position.left,
      top: position.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveWindow = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const root = rootRef.current;
    const parent = root?.parentElement;
    if (!drag || !root || !parent || drag.pointerId !== event.pointerId) return;
    const left = drag.left + event.clientX - drag.clientX;
    const top = drag.top + event.clientY - drag.clientY;
    setPosition({
      left: Math.max(0, Math.min(parent.clientWidth - root.offsetWidth, left)),
      top: Math.max(0, Math.min(parent.clientHeight - root.offsetHeight, top)),
    });
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
  };

  return (
    <div
      ref={rootRef}
      className="overlay-controls"
      role="dialog"
      aria-label="Image overlay controls"
      style={position}
    >
      <div
        className="overlay-controls-title"
        onPointerDown={startDrag}
        onPointerMove={moveWindow}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <span title={overlay.metadata.fileName}>{overlay.metadata.fileName}</span>
        <button
          type="button"
          aria-label="Remove image overlay"
          title="Remove image overlay"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={removeOverlay}
        >×</button>
      </div>
      <label className="overlay-transparency">
        <span>Transparency</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={overlay.transparency}
          onChange={(event) => setTransparency(event.target.valueAsNumber)}
        />
        <output>{Math.round(overlay.transparency)}%</output>
      </label>
      <div className="overlay-position" aria-label="Overlay top-left position">
        <span>Top-left relative to bottom image</span>
        <code>x: {formatCoordinate(overlay.offsetX)} px</code>
        <code>y: {formatCoordinate(overlay.offsetY)} px</code>
      </div>
    </div>
  );
}

function formatCoordinate(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
