import type { ViewerTool } from "../shared/types";
import { autoContrast, commitSelection, executeViewerCommand, requestStatistics } from "./controller";
import { useViewerStore } from "./store";

const tools: Array<{ tool: ViewerTool; label: string; command: string }> = [
  { tool: "rectangle", label: "Rectangle selection", command: "scientificImageViewer.tool.rectangle" },
  { tool: "ellipse", label: "Ellipse selection", command: "scientificImageViewer.tool.ellipse" },
  { tool: "line", label: "Line selection", command: "scientificImageViewer.tool.line" },
  { tool: "polygon", label: "Polygon selection", command: "scientificImageViewer.tool.polygon" },
  { tool: "sampler", label: "Sampler", command: "scientificImageViewer.tool.sampler" },
  { tool: "magnifier", label: "Magnifier", command: "scientificImageViewer.tool.magnifier" },
  { tool: "pan", label: "Pan", command: "scientificImageViewer.tool.pan" },
];

export function Toolbar() {
  const activeTool = useViewerStore((state) => state.activeTool);
  return (
    <header className="toolbar" role="toolbar" aria-label="Scientific image tools">
      <div className="tool-group">
        {tools.slice(0, 5).map((item) => (
          <ToolButton key={item.tool} {...item} active={activeTool === item.tool} />
        ))}
      </div>
      <div className="tool-separator" />
      <button
        className="tool-button action"
        title="Calculate Statistics (scientificImageViewer.computeStatistics)"
        aria-label="Calculate statistics"
        onClick={requestStatistics}
      ><ToolbarIcon name="statistics" /><span>Stats</span></button>
      <div className="tool-separator" />
      <div className="tool-group">
        {tools.slice(5).map((item) => (
          <ToolButton key={item.tool} {...item} active={activeTool === item.tool} />
        ))}
      </div>
      <div className="tool-separator" />
      <button className="tool-button compact" title="Fit to window (scientificImageViewer.fitToWindow)" aria-label="Fit to window" onClick={() => executeViewerCommand("fitToWindow")}>Fit</button>
      <button className="tool-button compact" title="Actual pixels (scientificImageViewer.actualPixels)" aria-label="Actual pixels" onClick={() => executeViewerCommand("actualPixels")}>1:1</button>
      <button className="tool-button compact" title="Clear selection (scientificImageViewer.clearSelection)" aria-label="Clear selection" onClick={() => commitSelection()}>Clear</button>
      <button className="tool-button compact" title="Auto Contrast (scientificImageViewer.autoContrast)" aria-label="Auto contrast" onClick={autoContrast}>Auto</button>
      <div className="zoom-readout">{formatZoom(useViewerStore((state) => state.zoom))}</div>
    </header>
  );
}

function ToolButton({
  tool,
  label,
  command,
  active,
}: {
  tool: ViewerTool;
  label: string;
  command: string;
  active: boolean;
}) {
  return (
    <button
      className={`tool-button ${active ? "active" : ""}`}
      title={`${label} (${command})`}
      aria-label={label}
      aria-pressed={active}
      onClick={() => useViewerStore.getState().setTool(tool)}
    >
      <ToolbarIcon name={tool} />
    </button>
  );
}

function ToolbarIcon({ name }: { name: ViewerTool | "statistics" }) {
  return (
    <span className="tool-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" focusable="false">
        {name === "rectangle" && <rect x="4" y="4" width="16" height="16" rx="0.75" />}
        {name === "ellipse" && <circle cx="12" cy="12" r="8" />}
        {name === "line" && <path d="M5 19 19 5" />}
        {name === "polygon" && <path d="m12 3.5 8.5 6.25L17.25 20H6.75L3.5 9.75 12 3.5Z" />}
        {name === "sampler" && (
          <>
            <circle cx="12" cy="12" r="5.5" />
            <path d="M12 2.75v4M12 17.25v4M2.75 12h4M17.25 12h4" />
          </>
        )}
        {name === "magnifier" && (
          <>
            <circle cx="10.5" cy="10.5" r="6.75" />
            <path d="m15.5 15.5 5 5" />
          </>
        )}
        {name === "pan" && (
          <>
            {/* Adapted from Tabler Icons' hand-stop icon (MIT). */}
            <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12" />
            <path d="M11 5.5v-2a1.5 1.5 0 1 1 3 0V12" />
            <path d="M14 5.5a1.5 1.5 0 0 1 3 0V12" />
            <path d="M17 7.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-1.8a6 6 0 0 1-5-2.7L3.7 13.27a1.5 1.5 0 0 1 .55-2.02 1.87 1.87 0 0 1 2.28.28L8 13" />
          </>
        )}
        {name === "statistics" && <path d="M18.5 4H5.5l7 8-7 8h13" />}
      </svg>
    </span>
  );
}

function formatZoom(zoom: number): string {
  return zoom >= 1 ? `${zoom.toFixed(zoom >= 10 ? 0 : 2)}×` : `${(zoom * 100).toFixed(1)}%`;
}
