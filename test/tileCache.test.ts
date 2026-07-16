import { describe, expect, it } from "vitest";
import type { ImageTile } from "../src/shared/types";
import { LocalTileCache } from "../src/webview/tileCache";

describe("local tile cache coverage", () => {
  it("releases all tiles when cleared", () => {
    const cache = new LocalTileCache();
    cache.set(tile({ level: 0, x: 0, y: 0, width: 256, height: 256 }));

    cache.clear();

    expect(cache.values(0)).toEqual([]);
  });

  it("uses a larger same-level overview for contained visible tiles", () => {
    const cache = new LocalTileCache();
    cache.set(tile({ level: 0, x: 0, y: 0, width: 1024, height: 1024 }));

    expect(cache.covers(region({ level: 0, x: 256, y: 512, width: 256, height: 256 })))
      .toBe(true);
  });

  it("uses finer cached data for a coarser request", () => {
    const cache = new LocalTileCache();
    cache.set(tile({ level: 0, x: 256, y: 256, width: 512, height: 512 }));

    expect(cache.covers(region({ level: 1, x: 128, y: 128, width: 256, height: 256 })))
      .toBe(true);
  });

  it("combines multiple finer tiles to cover one coarser request", () => {
    const cache = new LocalTileCache();
    cache.set(tile({ level: 0, x: 0, y: 0, width: 256, height: 256 }));
    cache.set(tile({ level: 0, x: 256, y: 0, width: 256, height: 256 }));
    cache.set(tile({ level: 0, x: 0, y: 256, width: 256, height: 256 }));
    cache.set(tile({ level: 0, x: 256, y: 256, width: 256, height: 256 }));

    expect(cache.covers(region({ level: 1, x: 0, y: 0, width: 256, height: 256 })))
      .toBe(true);
  });

  it("does not report aggregate coverage when the finer tiles leave a gap", () => {
    const cache = new LocalTileCache();
    cache.set(tile({ level: 0, x: 0, y: 0, width: 256, height: 256 }));
    cache.set(tile({ level: 0, x: 256, y: 0, width: 256, height: 256 }));
    cache.set(tile({ level: 0, x: 0, y: 256, width: 256, height: 256 }));

    expect(cache.covers(region({ level: 1, x: 0, y: 0, width: 256, height: 256 })))
      .toBe(false);
  });

  it("clamps aggregate coverage to the source image edges", () => {
    const cache = new LocalTileCache();
    cache.set(tile({ level: 0, x: 0, y: 0, width: 1025, height: 1025 }));

    expect(cache.covers(
      region({ level: 1, x: 0, y: 0, width: 513, height: 513 }),
      1025,
      1025,
    )).toBe(true);
  });

  it("does not use coarser cached data for a finer request", () => {
    const cache = new LocalTileCache();
    cache.set(tile({ level: 1, x: 0, y: 0, width: 256, height: 256 }));

    expect(cache.covers(region({ level: 0, x: 0, y: 0, width: 256, height: 256 })))
      .toBe(false);
  });

  it("requires complete coverage on the same slice", () => {
    const cache = new LocalTileCache();
    cache.set(tile({ level: 0, x: 0, y: 0, width: 256, height: 256 }));

    expect(cache.covers(region({ level: 0, x: 128, y: 0, width: 256, height: 256 })))
      .toBe(false);
    expect(cache.covers(region({ sliceIndex: 1, level: 0, x: 0, y: 0, width: 128, height: 128 })))
      .toBe(false);
  });
});

type TileOverrides = Partial<Pick<ImageTile, "sliceIndex" | "level" | "x" | "y" | "width" | "height">>;

function tile(overrides: TileOverrides): ImageTile {
  const value = region(overrides);
  return {
    ...value,
    requestId: 1,
    generation: 1,
    dtype: "uint8",
    data: new ArrayBuffer(value.width * value.height),
  };
}

function region(overrides: TileOverrides): Pick<ImageTile, "sliceIndex" | "level" | "x" | "y" | "width" | "height"> {
  return {
    sliceIndex: 0,
    level: 0,
    x: 0,
    y: 0,
    width: 256,
    height: 256,
    ...overrides,
  };
}
