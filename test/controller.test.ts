import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HistogramResult,
  ImageMetadata,
  MenuAction,
  WebviewToHostMessage,
} from "../src/shared/types";

const posted: WebviewToHostMessage[] = [];
let controller: typeof import("../src/webview/controller");
let store: typeof import("../src/webview/store");
let caches: typeof import("../src/webview/tileCache");

beforeAll(async () => {
  vi.stubGlobal("acquireVsCodeApi", () => ({
    getState: () => undefined,
    setState: () => undefined,
    postMessage: (message: WebviewToHostMessage) => posted.push(message),
  }));
  store = await import("../src/webview/store");
  controller = await import("../src/webview/controller");
  caches = await import("../src/webview/tileCache");
});

beforeEach(() => {
  posted.length = 0;
  store.useViewerStore.setState({
    metadata,
    currentSlice: 0,
    selection: undefined,
    histogram: undefined,
    histogramStale: true,
    statistics: undefined,
    calculationPending: undefined,
    autoContrastPending: false,
    resetRangePending: false,
    ranges: { scalar: [0, 10] },
    overlay: undefined,
    generation: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    settings: {
      localCacheMB: 256,
      tileSize: 256,
      automaticHistogramPixelLimit: 1_000_000,
    },
  });
});

describe("no-selection analysis behavior", () => {
  it("requests a full-image histogram and full-image statistics", () => {
    controller.requestHistogram();
    controller.requestStatistics();

    const histogramMessage = posted.find((message) => message.type === "computeHistogram");
    const statisticsMessage = posted.find((message) => message.type === "computeStatistics");
    expect(histogramMessage).toMatchObject({
      type: "computeHistogram",
      request: { sliceIndex: 0, selection: undefined },
    });
    expect(statisticsMessage).toMatchObject({
      type: "computeStatistics",
      request: { sliceIndex: 0, selection: undefined },
    });
  });

  it("uses full-image 1st and 99th percentiles for auto contrast", () => {
    store.useViewerStore.setState({
      histogram: fullSliceHistogram,
      histogramStale: false,
    });

    controller.autoContrast();

    expect(store.useViewerStore.getState().ranges.scalar).toEqual([1, 99]);
    expect(posted).toHaveLength(0);
  });

  it("initializes the display range from the full-image minimum and maximum", () => {
    store.useViewerStore.setState({ ranges: {} });

    store.useViewerStore.getState().setHistogram(fullSliceHistogram);

    expect(store.useViewerStore.getState().ranges.scalar).toEqual([0, 100]);
  });

  it("resets the display range to the current scope minimum and maximum", () => {
    store.useViewerStore.setState({
      histogram: fullSliceHistogram,
      histogramStale: false,
      ranges: { scalar: [1, 99] },
    });

    controller.resetDynamicRange();

    expect(store.useViewerStore.getState().ranges.scalar).toEqual([0, 100]);
    expect(posted).toHaveLength(0);
  });

  it("does not reuse a selection histogram after the selection is gone", () => {
    store.useViewerStore.setState({
      histogram: { ...fullSliceHistogram, scope: "selection" },
      histogramStale: false,
    });

    controller.autoContrast();

    expect(store.useViewerStore.getState().autoContrastPending).toBe(true);
    expect(posted.at(-1)?.type).toBe("computeHistogram");
  });

  it("treats a pixel-empty selection gesture as clearing the selection", () => {
    store.useViewerStore.setState({
      selection: { type: "rectangle", x0: 1, y0: 1, x1: 5, y1: 5 },
      histogram: { ...fullSliceHistogram, scope: "selection" },
      histogramStale: false,
    });

    controller.commitSelection({ type: "rectangle", x0: 3, y0: 3, x1: 3, y1: 3 });

    expect(store.useViewerStore.getState().selection).toBeUndefined();
    expect(posted.at(-1)).toMatchObject({
      type: "computeHistogram",
      request: { selection: undefined },
    });
  });

  it("keeps the current range when cached histogram bounds are non-finite", () => {
    store.useViewerStore.setState({
      histogram: {
        ...fullSliceHistogram,
        finiteCount: 0,
        percentile1: Number.NaN,
        percentile99: Number.NaN,
        minimum: Number.NaN,
        maximum: Number.NaN,
      },
      histogramStale: false,
      ranges: { scalar: [0, 10] },
    });

    controller.autoContrast();

    expect(store.useViewerStore.getState().ranges.scalar).toEqual([0, 10]);
    expect(store.useViewerStore.getState().autoContrastPending).toBe(true);
    expect(posted.at(-1)?.type).toBe("computeHistogram");
  });

  it("skips automatic full-slice histograms above the pixel limit", () => {
    store.useViewerStore.setState({
      settings: {
        localCacheMB: 256,
        tileSize: 256,
        automaticHistogramPixelLimit: 99,
      },
    });

    const requested = controller.requestAutomaticHistogram();

    expect(requested).toBe(false);
    expect(posted).toHaveLength(0);
    expect(store.useViewerStore.getState().calculationPending).toBeUndefined();
  });

  it("automatically calculates a selection at or below the pixel limit", () => {
    store.useViewerStore.setState({
      selection: { type: "rectangle", x0: 0, y0: 0, x1: 5, y1: 2 },
      settings: {
        localCacheMB: 256,
        tileSize: 256,
        automaticHistogramPixelLimit: 10,
      },
    });

    const requested = controller.requestAutomaticHistogram();

    expect(requested).toBe(true);
    expect(posted.at(-1)).toMatchObject({
      type: "computeHistogram",
      request: { selection: store.useViewerStore.getState().selection },
    });
  });

  it("skips automatic selection histograms above the pixel limit", () => {
    store.useViewerStore.setState({
      settings: {
        localCacheMB: 256,
        tileSize: 256,
        automaticHistogramPixelLimit: 9,
      },
    });

    controller.commitSelection({ type: "rectangle", x0: 0, y0: 0, x1: 5, y1: 2 });

    expect(store.useViewerStore.getState().selection).toBeDefined();
    expect(posted).toHaveLength(0);
  });

  it("always recalculates explicitly, even above the pixel limit", () => {
    store.useViewerStore.setState({
      settings: {
        localCacheMB: 256,
        tileSize: 256,
        automaticHistogramPixelLimit: 0,
      },
    });

    controller.requestHistogram();

    expect(posted.at(-1)?.type).toBe("computeHistogram");
    expect(store.useViewerStore.getState().calculationPending).toBe("histogram");
  });
});

describe("menu behavior", () => {
  it("sends native host actions to the extension", () => {
    const actions: MenuAction[] = [
      "open",
      "openInNewTab",
      "addOverlay",
      "settings",
      "close",
      "sourceCode",
      "reportIssue",
    ];
    actions.forEach(controller.requestMenuAction);

    expect(posted).toEqual(actions.map((action) => ({ type: "menuAction", action })));
  });

  it("uses the same zoom commands as the keyboard shortcuts", () => {
    store.useViewerStore.setState({
      zoom: 1,
      panX: 0,
      panY: 0,
      viewportWidth: 100,
      viewportHeight: 100,
    });

    controller.executeViewerCommand("zoomIn");
    expect(store.useViewerStore.getState().zoom).toBe(1.5);
    controller.executeViewerCommand("zoomOut");
    expect(store.useViewerStore.getState().zoom).toBe(1);
  });

  it("requests zoom-adaptive tiles in overlay coordinates", () => {
    store.useViewerStore.getState().setOverlay(7, { ...metadata, width: 1_000, height: 1_000 });
    store.useViewerStore.setState({
      viewportWidth: 100,
      viewportHeight: 100,
      zoom: 1,
      panX: 0,
      panY: 0,
      generation: 12,
      overlay: {
        ...store.useViewerStore.getState().overlay!,
        offsetX: -300,
      },
    });

    controller.requestVisibleTiles();

    const message = posted.find((candidate) => candidate.type === "getOverlayTiles");
    expect(message).toMatchObject({
      type: "getOverlayTiles",
      overlayId: 7,
      requests: [{ x: 256, y: 0, level: 0, generation: 12 }],
    });
  });

  it("removes overlay state and releases its local numeric tiles", () => {
    store.useViewerStore.getState().setOverlay(9, metadata);
    caches.overlayTileCache.set({
      requestId: 1,
      generation: 1,
      sliceIndex: 0,
      level: 0,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      dtype: "uint8",
      data: new ArrayBuffer(1),
    });

    controller.removeOverlay();

    expect(store.useViewerStore.getState().overlay).toBeUndefined();
    expect(caches.overlayTileCache.values(0)).toEqual([]);
    expect(posted.at(-1)).toEqual({ type: "removeOverlay", overlayId: 9 });
  });

  it("starts overlays at 50% transparency and updates the rendered setting", () => {
    store.useViewerStore.getState().setOverlay(10, metadata);

    expect(store.useViewerStore.getState().overlay?.transparency).toBe(50);
    store.useViewerStore.getState().setOverlayTransparency(82);
    expect(store.useViewerStore.getState().overlay?.transparency).toBe(82);
  });
});

const metadata: ImageMetadata = {
  uri: "memory:image",
  fileName: "image.npy",
  format: "npy",
  shape: [10, 10],
  width: 10,
  height: 10,
  sliceCount: 1,
  dtype: "float32",
  byteOrder: "little",
  fileSizeBytes: 400,
  totalElementCount: 100,
  isComplex: false,
};

const fullSliceHistogram: HistogramResult = {
  requestId: 1,
  sliceIndex: 0,
  scope: "full-slice",
  binEdges: [0, 50, 100],
  counts: [50, 50],
  finiteCount: 100,
  nanCount: 0,
  positiveInfinityCount: 0,
  negativeInfinityCount: 0,
  percentile1: 1,
  percentile99: 99,
  minimum: 0,
  maximum: 100,
  approximate: false,
};
