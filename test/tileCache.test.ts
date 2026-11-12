import { describe, expect, it } from "vitest";
import type { ImageTile } from "../src/shared/types";
import { LocalTileCache, tileToFloatData, tileDisplayRange } from "../src/webview/tileCache";

describe("transformed rendering data", () => {
  it("transforms float64 before converting to GPU floats", () => {
    const input = { ...tile({ width: 2, height: 1 }), dtype: "float64" as const,
      data: new Float64Array([1e100, 1e200]).buffer };
    const transforms = [{ operation: "log10" } as const];
    expect([...tileToFloatData(input, "scalar", transforms)]).toEqual([100, 200]);
    expect(tileDisplayRange(input, "scalar", transforms)).toEqual([100, 200]);
  });

  it("uploads transformed complex representations as scalar textures", () => {
    const input = { ...tile({ width: 1, height: 1 }), dtype: "complex128" as const,
      data: new Float64Array([3, 4]).buffer };
    const transforms = [{ operation: "add", operand: 2 } as const];
    expect([...tileToFloatData(input, "magnitude", transforms)]).toEqual([7]);
    expect([...tileToFloatData(input, "real", transforms)]).toEqual([5]);
    expect([...tileToFloatData(input)]).toEqual([3, 4]);
  });

  it("transforms straight RGB channels and preserves associated alpha", () => {
    const input = { ...tile({ width: 1, height: 1 }), channelCount: 4 as const,
      alphaMode: "associated" as const, data: new Uint8Array([20, 40, 60, 85]).buffer };
    const transforms = [{ operation: "add", operand: 2 } as const];
    const values = tileToFloatData(input, "scalar", transforms);
    expect([...values.slice(0, 3)]).toEqual([62, 122, 182]);
    expect(values[3]).toBeCloseTo(1 / 3);
    expect(tileDisplayRange(input, "scalar", transforms)).toEqual([62, 182]);
  });
});

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
