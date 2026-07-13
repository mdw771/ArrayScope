import { describe, expect, it } from "vitest";
import { imageToScreen, screenToImage, SelectionRasterizer } from "../src/shared/geometry";

function points(rasterizer: SelectionRasterizer): string[] {
  const result: string[] = [];
  const [start, end] = rasterizer.rows();
  for (let y = start; y <= end; y += 1) {
    for (const [x0, x1] of rasterizer.runsForRow(y)) {
      for (let x = x0; x <= x1; x += 1) result.push(`${x},${y}`);
    }
  }
  return result;
}

describe("selection rasterization", () => {
  it("handles rectangles drawn in either direction", () => {
    const forward = points(new SelectionRasterizer(10, 10, { type: "rectangle", x0: 1, y0: 1, x1: 4, y1: 3 }));
    const reverse = points(new SelectionRasterizer(10, 10, { type: "rectangle", x0: 4, y0: 3, x1: 1, y1: 1 }));
    expect(reverse).toEqual(forward);
    expect(forward).toHaveLength(6);
  });

  it("includes pixels whose centers lie in an ellipse", () => {
    const included = points(new SelectionRasterizer(7, 7, {
      type: "ellipse", centerX: 3.5, centerY: 3.5, radiusX: 2, radiusY: 1,
    }));
    expect(included).toEqual(["3,2", "1,3", "2,3", "3,3", "4,3", "5,3", "3,4"]);
  });

  it("uses even-odd polygon scan conversion", () => {
    const included = points(new SelectionRasterizer(6, 6, {
      type: "polygon",
      vertices: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 4 }, { x: 1, y: 4 }],
    }));
    expect(included).toHaveLength(12);
    expect(included).toContain("1,1");
    expect(included).toContain("4,3");
  });

  it("rasterizes a one-pixel Bresenham line", () => {
    expect(points(new SelectionRasterizer(8, 8, {
      type: "line", x0: 1, y0: 1, x1: 5, y1: 3, widthPixels: 1,
    }))).toEqual(["1,1", "2,2", "3,2", "4,3", "5,3"]);
  });
});

describe("view transforms", () => {
  it("round trips image and screen coordinates", () => {
    const transform = { zoom: 2.5, panX: -11, panY: 7 };
    const image = { x: 12.25, y: 8.5 };
    expect(screenToImage(imageToScreen(image, transform), transform)).toEqual(image);
  });
});
