import type {
  ComplexDisplayMode,
  Selection,
  ViewerTool,
} from "../shared/types";
import type { ViewerState } from "./store";

const PERSISTED_VIEWER_STATE_VERSION = 1;

type RangeMode = ComplexDisplayMode | "scalar";
type PersistedStateFields = Pick<
  ViewerState,
  | "activeTool"
  | "currentSlice"
  | "selection"
  | "zoom"
  | "panX"
  | "panY"
  | "colormap"
  | "complexMode"
  | "ranges"
>;

export interface PersistedViewerState extends PersistedStateFields {
  version: typeof PERSISTED_VIEWER_STATE_VERSION;
}

export function createPersistedViewerState(state: ViewerState): PersistedViewerState {
  return {
    version: PERSISTED_VIEWER_STATE_VERSION,
    activeTool: state.activeTool,
    currentSlice: state.currentSlice,
    selection: state.selection,
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    colormap: state.colormap,
    complexMode: state.complexMode,
    ranges: state.ranges,
  };
}

export function restorePersistedViewerState(value: unknown): PersistedStateFields | undefined {
  if (!isRecord(value)) return undefined;
  if (value.version !== undefined && value.version !== PERSISTED_VIEWER_STATE_VERSION) return undefined;

  return {
    activeTool: isViewerTool(value.activeTool) ? value.activeTool : "pan",
    currentSlice: nonNegativeInteger(value.currentSlice) ? value.currentSlice : 0,
    selection: isSelection(value.selection) ? value.selection : undefined,
    zoom: positiveFiniteNumber(value.zoom) ? value.zoom : 1,
    panX: finiteNumber(value.panX) ? value.panX : 0,
    panY: finiteNumber(value.panY) ? value.panY : 0,
    colormap: typeof value.colormap === "string" ? value.colormap : "gray",
    complexMode: isComplexDisplayMode(value.complexMode) ? value.complexMode : "magnitude",
    ranges: parseRanges(value.ranges),
  };
}

export function persistedViewerStateChanged(
  state: ViewerState,
  previousState: ViewerState,
): boolean {
  return state.activeTool !== previousState.activeTool ||
    state.currentSlice !== previousState.currentSlice ||
    state.selection !== previousState.selection ||
    state.zoom !== previousState.zoom ||
    state.panX !== previousState.panX ||
    state.panY !== previousState.panY ||
    state.colormap !== previousState.colormap ||
    state.complexMode !== previousState.complexMode ||
    state.ranges !== previousState.ranges;
}

function parseRanges(value: unknown): PersistedStateFields["ranges"] {
  const ranges: PersistedStateFields["ranges"] = { phase: [-Math.PI, Math.PI] };
  if (!isRecord(value)) return ranges;
  for (const mode of RANGE_MODES) {
    const range = value[mode];
    if (
      Array.isArray(range) &&
      range.length === 2 &&
      finiteNumber(range[0]) &&
      finiteNumber(range[1]) &&
      range[1] > range[0]
    ) {
      ranges[mode] = [range[0], range[1]];
    }
  }
  return ranges;
}

function isSelection(value: unknown): value is Selection {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "polygon") {
    return Array.isArray(value.vertices) && value.vertices.every(isPoint);
  }
  if (value.type === "rectangle") {
    return finiteNumber(value.x0) && finiteNumber(value.y0) &&
      finiteNumber(value.x1) && finiteNumber(value.y1);
  }
  if (value.type === "ellipse") {
    return finiteNumber(value.centerX) && finiteNumber(value.centerY) &&
      finiteNumber(value.radiusX) && finiteNumber(value.radiusY);
  }
  if (value.type === "line") {
    return finiteNumber(value.x0) && finiteNumber(value.y0) &&
      finiteNumber(value.x1) && finiteNumber(value.y1) && finiteNumber(value.widthPixels);
  }
  return false;
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && finiteNumber(value.x) && finiteNumber(value.y);
}

function isViewerTool(value: unknown): value is ViewerTool {
  return VIEWER_TOOLS.includes(value as ViewerTool);
}

function isComplexDisplayMode(value: unknown): value is ComplexDisplayMode {
  return COMPLEX_DISPLAY_MODES.includes(value as ComplexDisplayMode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveFiniteNumber(value: unknown): value is number {
  return finiteNumber(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value) && value >= 0;
}

const VIEWER_TOOLS: ViewerTool[] = [
  "pan",
  "magnifier",
  "rectangle",
  "ellipse",
  "line",
  "polygon",
  "sampler",
];

const COMPLEX_DISPLAY_MODES: ComplexDisplayMode[] = [
  "magnitude",
  "phase",
  "real",
  "imaginary",
  "logMagnitude",
  "magnitudeSquared",
];

const RANGE_MODES: RangeMode[] = ["scalar", ...COMPLEX_DISPLAY_MODES];
