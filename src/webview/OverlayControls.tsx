import { removeOverlay } from "./controller";
import { FloatingWindow } from "./FloatingWindow";
import { useViewerStore } from "./store";

export function OverlayControls() {
  const overlay = useViewerStore((state) => state.overlay);
  const setTransparency = useViewerStore((state) => state.setOverlayTransparency);
  if (!overlay) return null;

  return (
    <FloatingWindow
      className="overlay-controls"
      ariaLabel="Image overlay controls"
      closeLabel="Remove image overlay"
      onClose={removeOverlay}
      title={overlay.metadata.fileName}
      titleTooltip={overlay.metadata.fileName}
    >
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
    </FloatingWindow>
  );
}

function formatCoordinate(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
