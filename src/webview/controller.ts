import type {
  ComplexDisplayMode,
  HostToWebviewMessage,
  ImageTileRequest,
  SamplePixelResult,
  Selection,
  ViewerCommand,
} from "../shared/types";
import { SelectionRasterizer } from "../shared/geometry";
import { postMessage } from "./api";
import { exceedsAutomaticHistogramPixelLimit } from "./histogramGate";
import { stableRange, useViewerStore } from "./store";
import { sampleTile, tileCache } from "./tileCache";

let requestId = 1;
let latestHistogramRequest = 0;
let latestStatisticsRequest = 0;
let latestSampleRequest = 0;
const pendingTiles = new Map<number, string>();
const pendingTileKeys = new Set<string>();

function nextRequestId(): number {
  return requestId++;
}

export function initializeController(): () => void {
  const listener = (event: MessageEvent<HostToWebviewMessage>): void => {
    handleHostMessage(event.data);
  };
  window.addEventListener("message", listener);
  postMessage({ type: "ready" });
  return () => {
    window.removeEventListener("message", listener);
    pendingTiles.clear();
    pendingTileKeys.clear();
    tileCache.clear();
  };
}

function handleHostMessage(message: HostToWebviewMessage): void {
  const state = useViewerStore.getState();
  switch (message.type) {
    case "metadata": {
      tileCache.configure(message.settings.localCacheMB);
      state.setMetadata(message.metadata, message.settings);
      const dimensionality = message.metadata.additionalMetadata?.dimensionality;
      if (message.metadata.format !== "npy" || dimensionality === "image") {
        requestSliceData(0);
      }
      break;
    }
    case "overview":
      pendingTileKeys.delete(pendingTiles.get(message.tile.requestId) ?? "");
      pendingTiles.delete(message.tile.requestId);
      tileCache.set(message.tile);
      if (Math.abs(message.tile.sliceIndex - state.currentSlice) <= 1) state.bumpTiles();
      break;
    case "tile":
      pendingTileKeys.delete(pendingTiles.get(message.tile.requestId) ?? "");
      pendingTiles.delete(message.tile.requestId);
      if (message.tile.generation !== state.generation || message.tile.sliceIndex !== state.currentSlice) {
        return;
      }
      tileCache.set(message.tile);
      state.bumpTiles();
      break;
    case "histogram":
      if (message.result.requestId !== latestHistogramRequest) return;
      if (
        message.result.sliceIndex !== state.currentSlice ||
        (state.metadata?.isComplex && message.result.complexMode !== state.complexMode)
      ) {
        return;
      }
      state.setHistogram(message.result);
      if (state.autoContrastPending) {
        if (hasFiniteRange(message.result.percentile1, message.result.percentile99)) {
          const mode = state.metadata?.isComplex ? state.complexMode : "scalar";
          state.setRange(mode, stableRange(message.result.percentile1, message.result.percentile99));
        }
        state.setAutoContrastPending(false);
      } else if (state.resetRangePending) {
        if (hasFiniteRange(message.result.minimum, message.result.maximum)) {
          const mode = state.metadata?.isComplex ? state.complexMode : "scalar";
          state.setRange(mode, stableRange(message.result.minimum, message.result.maximum));
        }
        state.setResetRangePending(false);
      }
      break;
    case "statistics":
      if (message.result.requestId === latestStatisticsRequest) state.setStatistics(message.result);
      break;
    case "sample":
      if (
        message.result.requestId === latestSampleRequest &&
        message.result.sliceIndex === state.currentSlice
      ) {
        state.setSample(message.result);
      }
      break;
    case "command":
      executeViewerCommand(message.command);
      break;
    case "error": {
      if (message.requestId !== undefined) {
        const key = pendingTiles.get(message.requestId);
        if (key) pendingTileKeys.delete(key);
        pendingTiles.delete(message.requestId);
      }
      state.setError({ message: message.message, details: message.details });
      break;
    }
  }
}

export function requestSliceData(sliceIndex: number): void {
  const state = useViewerStore.getState();
  const generation = state.generation;
  requestOverview(sliceIndex, generation);
  if (sliceIndex > 0) requestOverview(sliceIndex - 1, generation);
  if (state.metadata && sliceIndex + 1 < state.metadata.sliceCount) {
    requestOverview(sliceIndex + 1, generation);
  }
  requestAutomaticHistogram();
  tileCache.clearSliceExcept(sliceIndex);
}

function requestOverview(sliceIndex: number, generation: number): void {
  const id = nextRequestId();
  postMessage({ type: "getOverview", sliceIndex, generation, requestId: id });
}

export function requestHistogram(): void {
  requestCurrentHistogram();
}

export function requestAutomaticHistogram(): boolean {
  const state = useViewerStore.getState();
  if (!state.metadata || state.metadata.width < 1 || state.metadata.height < 1) return false;
  if (
    exceedsAutomaticHistogramPixelLimit(
      state.metadata,
      state.selection,
      state.settings.automaticHistogramPixelLimit,
    )
  ) {
    latestHistogramRequest = nextRequestId();
    if (state.calculationPending === "histogram") state.markCalculation();
    return false;
  }
  requestCurrentHistogram();
  return true;
}

function requestCurrentHistogram(): void {
  const state = useViewerStore.getState();
  if (!state.metadata || state.metadata.width < 1 || state.metadata.height < 1) return;
  const selection = state.selection ?? undefined;
  latestHistogramRequest = nextRequestId();
  state.markCalculation("histogram");
  postMessage({
    type: "computeHistogram",
    request: {
      requestId: latestHistogramRequest,
      sliceIndex: state.currentSlice,
      selection,
      complexMode: state.metadata.isComplex ? state.complexMode : undefined,
      binCount: 512,
      approximateAllowed: true,
    },
  });
}

export function requestStatistics(): void {
  const state = useViewerStore.getState();
  if (!state.metadata) return;
  const selection = state.selection ?? undefined;
  latestStatisticsRequest = nextRequestId();
  state.markCalculation("statistics");
  postMessage({
    type: "computeStatistics",
    request: {
      requestId: latestStatisticsRequest,
      sliceIndex: state.currentSlice,
      selection,
      complexMode: state.metadata.isComplex ? state.complexMode : undefined,
    },
  });
}

export function commitSelection(selection?: Selection): void {
  const state = useViewerStore.getState();
  const metadata = state.metadata;
  const committed = metadata && selectionContainsPixels(metadata.width, metadata.height, selection)
    ? selection
    : undefined;
  state.setSelection(committed);
  requestAutomaticHistogram();
}

export function autoContrast(): void {
  const state = useViewerStore.getState();
  const mode = state.metadata?.isComplex ? state.complexMode : "scalar";
  if (
    state.histogram &&
    !state.histogramStale &&
    state.histogram.sliceIndex === state.currentSlice &&
    state.histogram.scope === (state.selection ? "selection" : "full-slice") &&
    (!state.metadata?.isComplex || state.histogram.complexMode === state.complexMode) &&
    hasFiniteRange(state.histogram.percentile1, state.histogram.percentile99)
  ) {
    state.setRange(mode, stableRange(state.histogram.percentile1, state.histogram.percentile99));
    return;
  }
  state.setResetRangePending(false);
  state.setAutoContrastPending(requestAutomaticHistogram());
}

export function resetDynamicRange(): void {
  const state = useViewerStore.getState();
  const mode = state.metadata?.isComplex ? state.complexMode : "scalar";
  if (
    state.histogram &&
    !state.histogramStale &&
    state.histogram.sliceIndex === state.currentSlice &&
    state.histogram.scope === (state.selection ? "selection" : "full-slice") &&
    (!state.metadata?.isComplex || state.histogram.complexMode === state.complexMode) &&
    hasFiniteRange(state.histogram.minimum, state.histogram.maximum)
  ) {
    state.setRange(mode, stableRange(state.histogram.minimum, state.histogram.maximum));
    return;
  }
  state.setAutoContrastPending(false);
  state.setResetRangePending(requestAutomaticHistogram());
}

export function samplePixel(x: number, y: number): void {
  const state = useViewerStore.getState();
  const metadata = state.metadata;
  if (!metadata) return;
  const pixelX = Math.max(0, Math.min(metadata.width - 1, Math.floor(x)));
  const pixelY = Math.max(0, Math.min(metadata.height - 1, Math.floor(y)));
  const tile = tileCache.findExactPixel(state.currentSlice, pixelX, pixelY);
  latestSampleRequest = nextRequestId();
  if (tile) {
    const decoded = sampleTile(tile, pixelX, pixelY);
    let result: SamplePixelResult;
    if (decoded.scalar !== undefined) {
      result = {
        requestId: latestSampleRequest,
        sliceIndex: state.currentSlice,
        x: pixelX,
        y: pixelY,
        value: decoded.scalar,
      };
    } else {
      const real = decoded.real ?? Number.NaN;
      const imaginary = decoded.imaginary ?? Number.NaN;
      result = {
        requestId: latestSampleRequest,
        sliceIndex: state.currentSlice,
        x: pixelX,
        y: pixelY,
        real,
        imaginary,
        magnitude: Math.hypot(real, imaginary),
        phase: Math.atan2(imaginary, real),
      };
    }
    state.setSample(result);
    return;
  }
  state.setSampleLoading({ x: pixelX, y: pixelY });
  postMessage({
    type: "samplePixel",
    request: {
      requestId: latestSampleRequest,
      sliceIndex: state.currentSlice,
      x: pixelX,
      y: pixelY,
    },
  });
}

export function requestVisibleTiles(): void {
  const state = useViewerStore.getState();
  const metadata = state.metadata;
  if (!metadata || state.zoom <= 0 || state.viewportWidth <= 0 || state.viewportHeight <= 0) return;
  const level = Math.max(0, Math.min(30, Math.floor(Math.log2(Math.max(1, 1 / state.zoom)))));
  const factor = 2 ** level;
  const levelWidth = Math.ceil(metadata.width / factor);
  const levelHeight = Math.ceil(metadata.height / factor);
  const tileSize = state.settings.tileSize;
  const left = Math.max(0, Math.floor((-state.panX / state.zoom) / factor));
  const top = Math.max(0, Math.floor((-state.panY / state.zoom) / factor));
  const right = Math.min(
    levelWidth,
    Math.ceil(((state.viewportWidth - state.panX) / state.zoom) / factor),
  );
  const bottom = Math.min(
    levelHeight,
    Math.ceil(((state.viewportHeight - state.panY) / state.zoom) / factor),
  );
  if (right <= left || bottom <= top) return;
  const requests: ImageTileRequest[] = [];
  const firstX = Math.floor(left / tileSize) * tileSize;
  const firstY = Math.floor(top / tileSize) * tileSize;
  for (let y = firstY; y < bottom; y += tileSize) {
    for (let x = firstX; x < right; x += tileSize) {
      const width = Math.min(tileSize, levelWidth - x);
      const height = Math.min(tileSize, levelHeight - y);
      const key = `${state.currentSlice}:${level}:${x}:${y}:${width}:${height}`;
      const query = { sliceIndex: state.currentSlice, level, x, y, width, height };
      if (tileCache.covers(query, metadata.width, metadata.height) || pendingTileKeys.has(key)) {
        continue;
      }
      const id = nextRequestId();
      pendingTileKeys.add(key);
      pendingTiles.set(id, key);
      requests.push({
        ...query,
        requestId: id,
        generation: state.generation,
        priority: "visible",
      });
      if (requests.length === 128) break;
    }
    if (requests.length === 128) break;
  }
  if (requests.length > 0) postMessage({ type: "getTiles", requests });
}

export function executeViewerCommand(command: ViewerCommand): void {
  const state = useViewerStore.getState();
  if (command.startsWith("tool.")) {
    state.setTool(command.slice(5) as Parameters<typeof state.setTool>[0]);
    return;
  }
  switch (command) {
    case "computeStatistics":
      requestStatistics();
      break;
    case "autoContrast":
      autoContrast();
      break;
    case "clearSelection":
      commitSelection();
      break;
    case "fitToWindow":
      fitToWindow();
      break;
    case "actualPixels":
      centerAtZoom(1);
      break;
    case "zoomIn":
      zoomAbout(state.viewportWidth / 2, state.viewportHeight / 2, 1.5);
      break;
    case "zoomOut":
      zoomAbout(state.viewportWidth / 2, state.viewportHeight / 2, 1 / 1.5);
      break;
    case "nextSlice":
      changeSlice(state.currentSlice + 1);
      break;
    case "previousSlice":
      changeSlice(state.currentSlice - 1);
      break;
  }
}

function selectionContainsPixels(width: number, height: number, selection?: Selection): boolean {
  if (!selection) return false;
  const rasterizer = new SelectionRasterizer(width, height, selection);
  const [startY, endY] = rasterizer.rows();
  for (let y = startY; y <= endY; y += 1) {
    if (rasterizer.runsForRow(y).length > 0) return true;
  }
  return false;
}

function hasFiniteRange(lower: number, upper: number): boolean {
  return Number.isFinite(lower) && Number.isFinite(upper);
}

export function changeSlice(slice: number): void {
  const state = useViewerStore.getState();
  state.setSlice(slice);
  requestSliceData(useViewerStore.getState().currentSlice);
}

export function fitToWindow(): void {
  const state = useViewerStore.getState();
  const metadata = state.metadata;
  if (!metadata || state.viewportWidth <= 0 || state.viewportHeight <= 0) return;
  const zoom = Math.min(
    state.viewportWidth / metadata.width,
    state.viewportHeight / metadata.height,
  );
  state.setView({
    zoom,
    panX: (state.viewportWidth - metadata.width * zoom) / 2,
    panY: (state.viewportHeight - metadata.height * zoom) / 2,
  });
}

export function centerAtZoom(zoom: number): void {
  const state = useViewerStore.getState();
  const metadata = state.metadata;
  if (!metadata) return;
  state.setView({
    zoom,
    panX: (state.viewportWidth - metadata.width * zoom) / 2,
    panY: (state.viewportHeight - metadata.height * zoom) / 2,
  });
}

export function zoomAbout(screenX: number, screenY: number, factor: number): void {
  const state = useViewerStore.getState();
  const oldZoom = state.zoom;
  const zoom = Math.max(1e-6, Math.min(1024, oldZoom * factor));
  const imageX = (screenX - state.panX) / oldZoom;
  const imageY = (screenY - state.panY) / oldZoom;
  state.setView({
    zoom,
    panX: screenX - imageX * zoom,
    panY: screenY - imageY * zoom,
  });
}

export const COMPLEX_MODES: Array<{ value: ComplexDisplayMode; label: string }> = [
  { value: "magnitude", label: "Magnitude" },
  { value: "phase", label: "Phase" },
  { value: "real", label: "Real" },
  { value: "imaginary", label: "Imaginary" },
  { value: "logMagnitude", label: "Log magnitude" },
  { value: "magnitudeSquared", label: "Magnitude squared" },
];
