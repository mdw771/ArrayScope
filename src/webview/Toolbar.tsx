import type { ViewerTool } from "../shared/types";
import { autoContrast, executeViewerCommand, requestHistogram, requestStatistics } from "./controller";
import { useViewerStore } from "./store";

const tools: Array<{ tool: ViewerTool; icon: string; label: string; command: string }> = [
  { tool: "rectangle", icon: "▭", label: "Rectangle selection", command: "scientificImageViewer.tool.rectangle" },
  { tool: "ellipse", icon: "◯", label: "Ellipse selection", command: "scientificImageViewer.tool.ellipse" },
  { tool: "line", icon: "╱", label: "Line selection", command: "scientificImageViewer.tool.line" },
  { tool: "polygon", icon: "⬠", label: "Polygon selection", command: "scientificImageViewer.tool.polygon" },
  { tool: "sampler", icon: "⌖", label: "Sampler", command: "scientificImageViewer.tool.sampler" },
  { tool: "magnifier", icon: "⌕", label: "Magnifier", command: "scientificImageViewer.tool.magnifier" },
  { tool: "pan", icon: "✋", label: "Pan", command: "scientificImageViewer.tool.pan" },
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
      ><span aria-hidden="true">∑</span><span>Stats</span></button>
      <div className="tool-separator" />
      <div className="tool-group">
        {tools.slice(5).map((item) => (
          <ToolButton key={item.tool} {...item} active={activeTool === item.tool} />
        ))}
      </div>
      <div className="tool-separator" />
      <button className="tool-button compact" title="Fit to window (scientificImageViewer.fitToWindow)" aria-label="Fit to window" onClick={() => executeViewerCommand("fitToWindow")}>Fit</button>
      <button className="tool-button compact" title="Actual pixels (scientificImageViewer.actualPixels)" aria-label="Actual pixels" onClick={() => executeViewerCommand("actualPixels")}>1:1</button>
      <button className="tool-button compact" title="Clear selection (scientificImageViewer.clearSelection)" aria-label="Clear selection" onClick={() => { useViewerStore.getState().setSelection(undefined); requestHistogram(); }}>Clear</button>
      <button className="tool-button compact" title="Auto Contrast (scientificImageViewer.autoContrast)" aria-label="Auto contrast" onClick={autoContrast}>Auto</button>
      <div className="zoom-readout">{formatZoom(useViewerStore((state) => state.zoom))}</div>
    </header>
  );
}

function ToolButton({
  tool,
  icon,
  label,
  command,
  active,
}: {
  tool: ViewerTool;
  icon: string;
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
      <span className="tool-icon" aria-hidden="true">{icon}</span>
    </button>
  );
}

function formatZoom(zoom: number): string {
  return zoom >= 1 ? `${zoom.toFixed(zoom >= 10 ? 0 : 2)}×` : `${(zoom * 100).toFixed(1)}%`;
}
