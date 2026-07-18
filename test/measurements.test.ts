import { describe, expect, it } from "vitest";
import { measureSelection } from "../src/shared/measurements";

describe("selection measurements", () => {
  it("normalizes rectangle bounds drawn in reverse", () => {
    expect(measureSelection({ type: "rectangle", x0: 8, y0: 9, x1: 2, y1: 3 })).toEqual({
      type: "rectangle",
      bounds: {
        topLeft: { x: 2, y: 3 },
        bottomRight: { x: 8, y: 9 },
        width: 6,
        height: 6,
      },
    });
  });

  it("reports ellipse bounds and center", () => {
    expect(measureSelection({
      type: "ellipse",
      centerX: 6,
      centerY: 5,
      radiusX: 4,
      radiusY: 2,
    })).toEqual({
      type: "ellipse",
      bounds: {
        topLeft: { x: 2, y: 3 },
        bottomRight: { x: 10, y: 7 },
        width: 8,
        height: 4,
      },
      center: { x: 6, y: 5 },
    });
  });

  it("reports directed line endpoints, length, and angle", () => {
    expect(measureSelection({
      type: "line",
      x0: 1,
      y0: 2,
      x1: 4,
      y1: 6,
      widthPixels: 1,
    })).toEqual({
      type: "line",
      start: { x: 1, y: 2 },
      end: { x: 4, y: 6 },
      length: 5,
      angleDegrees: 53.13010235415598,
    });
  });

  it("reports polygon bounds regardless of vertex order", () => {
    expect(measureSelection({
      type: "polygon",
      vertices: [{ x: 7, y: 2 }, { x: 3, y: 9 }, { x: 5, y: 4 }],
    })).toEqual({
      type: "polygon",
      bounds: {
        topLeft: { x: 3, y: 2 },
        bottomRight: { x: 7, y: 9 },
        width: 4,
        height: 7,
      },
    });
  });

  it("does not report an empty polygon", () => {
    expect(measureSelection({ type: "polygon", vertices: [] })).toBeUndefined();
  });
});
