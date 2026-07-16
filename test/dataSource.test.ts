import { describe, expect, it } from "vitest";
import { BaseImageDataSource } from "../src/host/baseDataSource";
import type { ImageMetadata } from "../src/shared/types";

class MemoryDataSource extends BaseImageDataSource {
  constructor(readonly values: number[], width: number, height: number) {
    const metadata: ImageMetadata = {
      uri: "memory:test", fileName: "test", format: "npy", shape: [height, width],
      width, height, sliceCount: 1, dtype: "float64", byteOrder: "little",
      fileSizeBytes: values.length * 8, totalElementCount: values.length, isComplex: false,
    };
    super(metadata, 1024 * 1024);
  }

  protected async readRegion(
    _slice: number, x: number, y: number, outputWidth: number, outputHeight: number, step: number,
  ): Promise<ArrayBuffer> {
    const output = new Float64Array(outputWidth * outputHeight);
    for (let oy = 0; oy < outputHeight; oy += 1) {
      for (let ox = 0; ox < outputWidth; ox += 1) {
        output[oy * outputWidth + ox] = this.values[(y + oy * step) * this.metadata.width + x + ox * step]!;
      }
    }
    return output.buffer;
  }
  protected async assertSourceUnchanged(): Promise<void> {}
  protected async closeSource(): Promise<void> {}
}

class DelayedDataSource extends BaseImageDataSource {
  readonly readStarted: Promise<void>;
  readonly #readPending: Promise<void>;
  #markReadStarted!: () => void;
  #releaseRead!: () => void;

  constructor() {
    super({
      uri: "memory:delayed", fileName: "delayed", format: "npy", shape: [1, 1],
      width: 1, height: 1, sliceCount: 1, dtype: "float64", byteOrder: "little",
      fileSizeBytes: 8, totalElementCount: 1, isComplex: false,
    }, 1024 * 1024);
    this.readStarted = new Promise<void>((resolve) => {
      this.#markReadStarted = resolve;
    });
    this.#readPending = new Promise<void>((resolve) => {
      this.#releaseRead = resolve;
    });
  }

  releaseRead(): void {
    this.#releaseRead();
  }

  protected async readRegion(): Promise<ArrayBuffer> {
    this.#markReadStarted();
    await this.#readPending;
    return new Float64Array([1]).buffer;
  }

  protected async assertSourceUnchanged(): Promise<void> {}
  protected async closeSource(): Promise<void> {}
}

describe("format-independent data source calculations", () => {
  it("uses the entire image when no selection is supplied", async () => {
    const source = new MemoryDataSource([1, 2, 3, 4, 5, 6], 3, 2);
    const histogram = await source.computeHistogram({
      requestId: 1,
      sliceIndex: 0,
      binCount: 4,
      approximateAllowed: true,
    });
    const statistics = await source.computeStatistics({ requestId: 2, sliceIndex: 0 });

    expect(histogram).toMatchObject({
      scope: "full-slice",
      finiteCount: 6,
      percentile1: 1.05,
      percentile99: 5.95,
    });
    expect(statistics).toMatchObject({
      scope: "full-slice",
      geometricPixelCount: 6,
      finitePixelCount: 6,
      mean: 3.5,
    });
  });

  it("reports finite and nonfinite counts", async () => {
    const source = new MemoryDataSource([0, 1, 2, 3, 4, Number.NaN, Infinity, -Infinity], 4, 2);
    const result = await source.computeStatistics({ requestId: 1, sliceIndex: 0 });
    expect(result).toMatchObject({
      geometricPixelCount: 8,
      finitePixelCount: 5,
      nanCount: 1,
      positiveInfinityCount: 1,
      negativeInfinityCount: 1,
      mean: 2,
      variance: 2,
    });
    expect(result.median).toBe(2);
    expect(result.kurtosis).toBeCloseTo(1.7);
  });

  it("restricts statistics and histograms to a selection", async () => {
    const source = new MemoryDataSource([1, 2, 3, 4, 5, 6], 3, 2);
    const selection = { type: "rectangle" as const, x0: 0, y0: 0, x1: 2, y1: 1 };
    const statistics = await source.computeStatistics({ requestId: 2, sliceIndex: 0, selection });
    const histogram = await source.computeHistogram({
      requestId: 3, sliceIndex: 0, selection, binCount: 4, approximateAllowed: true,
    });
    expect(statistics.geometricPixelCount).toBe(2);
    expect(statistics.mean).toBe(1.5);
    expect(histogram.finiteCount).toBe(2);
    expect(histogram.scope).toBe("selection");
    expect(histogram.counts.reduce((sum, count) => sum + count, 0)).toBe(2);
  });

  it("serves downsampled tiles and exact samples", async () => {
    const source = new MemoryDataSource(Array.from({ length: 16 }, (_, index) => index), 4, 4);
    const tile = await source.getTile({
      requestId: 4, generation: 1, sliceIndex: 0, level: 1,
      x: 0, y: 0, width: 2, height: 2, priority: "visible",
    });
    expect([...new Float64Array(tile.data)]).toEqual([0, 2, 8, 10]);
    await expect(source.samplePixel({ requestId: 5, sliceIndex: 0, x: 2, y: 1 }))
      .resolves.toMatchObject({ value: 6 });
  });

  it("does not cache a tile whose read finishes after disposal", async () => {
    const source = new DelayedDataSource();
    const tile = source.getTile({
      requestId: 6, generation: 1, sliceIndex: 0, level: 0,
      x: 0, y: 0, width: 1, height: 1, priority: "visible",
    });
    await source.readStarted;
    await source.dispose();
    source.releaseRead();

    await expect(tile).rejects.toThrow("already closed");
  });
});
