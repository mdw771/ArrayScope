import { describe, expect, it } from "vitest";
import {
  createPersistedViewerState,
  persistedViewerStateChanged,
  restorePersistedViewerState,
} from "../src/webview/persistence";
import { useViewerStore } from "../src/webview/store";

describe("viewer state persistence", () => {
  it("round-trips the current slice and display range", () => {
    useViewerStore.setState({
      currentSlice: 7,
      ranges: { scalar: [-12, 34] },
      zoom: 2,
      panX: 10,
      panY: -5,
    });

    const persisted = createPersistedViewerState(useViewerStore.getState());
    const restored = restorePersistedViewerState(persisted);

    expect(persisted.version).toBe(1);
    expect(restored).toMatchObject({
      currentSlice: 7,
      ranges: { scalar: [-12, 34] },
      zoom: 2,
      panX: 10,
      panY: -5,
    });
  });

  it("restores legacy state and supplies defaults for the newly persisted slice", () => {
    expect(restorePersistedViewerState({ ranges: { scalar: [1, 9] } })).toMatchObject({
      currentSlice: 0,
      ranges: { scalar: [1, 9] },
    });
  });

  it("restores each persisted selection shape", () => {
    const selections = [
      { type: "rectangle", x0: 1, y0: 2, x1: 3, y1: 4 },
      { type: "ellipse", centerX: 5, centerY: 6, radiusX: 2, radiusY: 3 },
      { type: "line", x0: 1, y0: 2, x1: 3, y1: 4, widthPixels: 1 },
      { type: "polygon", vertices: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    ];

    for (const selection of selections) {
      expect(restorePersistedViewerState({ selection })?.selection).toEqual(selection);
    }
  });

  it("only reports changes to durable viewer state", () => {
    const before = useViewerStore.getState();
    useViewerStore.setState({ tileRevision: before.tileRevision + 1 });
    expect(persistedViewerStateChanged(useViewerStore.getState(), before)).toBe(false);

    const afterTile = useViewerStore.getState();
    useViewerStore.setState({ currentSlice: afterTile.currentSlice + 1 });
    expect(persistedViewerStateChanged(useViewerStore.getState(), afterTile)).toBe(true);
  });
});
