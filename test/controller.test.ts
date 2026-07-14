import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistogramResult, ImageMetadata, WebviewToHostMessage } from "../src/shared/types";

const posted: WebviewToHostMessage[] = [];
let controller: typeof import("../src/webview/controller");
let store: typeof import("../src/webview/store");

beforeAll(async () => {
  vi.stubGlobal("acquireVsCodeApi", () => ({
    getState: () => undefined,
    setState: () => undefined,
    postMessage: (message: WebviewToHostMessage) => posted.push(message),
  }));
  store = await import("../src/webview/store");
  controller = await import("../src/webview/controller");
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
