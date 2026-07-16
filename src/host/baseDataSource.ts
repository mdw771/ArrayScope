import { SelectionRasterizer } from "../shared/geometry";
import {
  DTYPE_BYTES,
  type HistogramRequest,
  type HistogramResult,
  type ImageMetadata,
  type ImageTile,
  type ImageTileRequest,
  type SamplePixelRequest,
  type SamplePixelResult,
  type ScientificImageDataSource,
  type StatisticsRequest,
  type StatisticsResult,
} from "../shared/types";
import { ByteLruCache } from "./lru";
import { decodeBuffer, decodeValue } from "./numeric";

interface RunningMoments {
  count: number;
  mean: number;
  m2: number;
  m3: number;
  m4: number;
}

class Reservoir {
  readonly values: number[] = [];
  seen = 0;
  #state = 0x9e3779b9;

  constructor(readonly limit: number) {}

  add(value: number): void {
    this.seen += 1;
    if (this.values.length < this.limit) {
      this.values.push(value);
      return;
    }
    this.#state ^= this.#state << 13;
    this.#state ^= this.#state >>> 17;
    this.#state ^= this.#state << 5;
    const index = (this.#state >>> 0) % this.seen;
    if (index < this.limit) this.values[index] = value;
  }

  sorted(): number[] {
    return this.values.sort((a, b) => a - b);
  }

  get approximate(): boolean {
    return this.seen > this.limit;
  }
}

export abstract class BaseImageDataSource implements ScientificImageDataSource {
  readonly #tileCache: ByteLruCache<ImageTile>;
  #disposed = false;

  protected constructor(
    protected readonly metadata: ImageMetadata,
    remoteCacheBytes: number,
  ) {
    this.#tileCache = new ByteLruCache(remoteCacheBytes);
  }

  protected abstract readRegion(
    sliceIndex: number,
    sourceX: number,
    sourceY: number,
    outputWidth: number,
    outputHeight: number,
    step: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer>;

  protected abstract assertSourceUnchanged(): Promise<void>;

  protected abstract closeSource(): Promise<void>;

  async getMetadata(): Promise<ImageMetadata> {
    this.assertOpen();
    return this.metadata;
  }

  async getOverview(sliceIndex: number, signal?: AbortSignal): Promise<ImageTile> {
    throwIfCancelled(signal);
    const maximumDimension = Math.max(this.metadata.width, this.metadata.height);
    const level = Math.max(0, Math.ceil(Math.log2(Math.max(1, maximumDimension / 1024))));
    const factor = 2 ** level;
    return this.getTile({
      requestId: 0,
      generation: 0,
      sliceIndex,
      level,
      x: 0,
      y: 0,
      width: Math.ceil(this.metadata.width / factor),
      height: Math.ceil(this.metadata.height / factor),
      priority: "immediate",
    }, signal);
  }

  async getTile(request: ImageTileRequest, signal?: AbortSignal): Promise<ImageTile> {
    throwIfCancelled(signal);
    this.assertOpen();
    this.validateSlice(request.sliceIndex);
    await this.assertSourceUnchanged();
    throwIfCancelled(signal);
    this.assertOpen();
    const level = Math.max(0, Math.floor(request.level));
    const factor = 2 ** level;
    const levelWidth = Math.ceil(this.metadata.width / factor);
    const levelHeight = Math.ceil(this.metadata.height / factor);
    const x = Math.max(0, Math.floor(request.x));
    const y = Math.max(0, Math.floor(request.y));
    const width = Math.min(Math.max(0, Math.floor(request.width)), levelWidth - x);
    const height = Math.min(Math.max(0, Math.floor(request.height)), levelHeight - y);
    if (width > 2048 || height > 2048) {
      throw new Error("Requested image tile exceeds the maximum safe tile dimensions.");
    }
    if (width <= 0 || height <= 0 || x >= levelWidth || y >= levelHeight) {
      throw new Error("Requested image tile is outside the image bounds.");
    }
    const cacheKey = `${request.sliceIndex}:${level}:${x}:${y}:${width}:${height}`;
    const cached = this.#tileCache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        requestId: request.requestId,
        generation: request.generation,
      };
    }
    const data = await this.readRegion(
      request.sliceIndex,
      x * factor,
      y * factor,
      width,
      height,
      factor,
      signal,
    );
    throwIfCancelled(signal);
    this.assertOpen();
    const tile: ImageTile = {
      requestId: request.requestId,
      generation: request.generation,
      sliceIndex: request.sliceIndex,
      level,
      x,
      y,
      width,
      height,
      dtype: this.metadata.dtype,
      data,
    };
    this.#tileCache.set(cacheKey, tile);
    return tile;
  }

  async samplePixel(request: SamplePixelRequest, signal?: AbortSignal): Promise<SamplePixelResult> {
    throwIfCancelled(signal);
    this.assertOpen();
    this.validateSlice(request.sliceIndex);
    const x = Math.max(0, Math.min(this.metadata.width - 1, Math.round(request.x)));
    const y = Math.max(0, Math.min(this.metadata.height - 1, Math.round(request.y)));
    const data = await this.readRegion(request.sliceIndex, x, y, 1, 1, 1, signal);
    throwIfCancelled(signal);
    this.assertOpen();
    const decoded = decodeValue(new DataView(data), 0, this.metadata.dtype, true);
    if (decoded.scalar !== undefined) {
      return { ...request, x, y, value: decoded.scalar };
    }
    const real = decoded.real ?? Number.NaN;
    const imaginary = decoded.imaginary ?? Number.NaN;
    return {
      ...request,
      x,
      y,
      real,
      imaginary,
      magnitude: Math.hypot(real, imaginary),
      phase: Math.atan2(imaginary, real),
    };
  }

  async computeStatistics(request: StatisticsRequest, signal?: AbortSignal): Promise<StatisticsResult> {
    throwIfCancelled(signal);
    this.assertOpen();
    this.validateSlice(request.sliceIndex);
    const reservoir = new Reservoir(500_000);
    const moments: RunningMoments = { count: 0, mean: 0, m2: 0, m3: 0, m4: 0 };
    const counts = { geometric: 0, nan: 0, positiveInfinity: 0, negativeInfinity: 0 };
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;

    await this.forEachSelectionRun(request.sliceIndex, request.selection, async (data, length) => {
      counts.geometric += length;
      for (const value of decodeBuffer(data, this.metadata.dtype, request.complexMode)) {
        if (Number.isNaN(value)) counts.nan += 1;
        else if (value === Number.POSITIVE_INFINITY) counts.positiveInfinity += 1;
        else if (value === Number.NEGATIVE_INFINITY) counts.negativeInfinity += 1;
        else {
          updateMoments(moments, value);
          reservoir.add(value);
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
        }
      }
    }, signal);

    const sorted = reservoir.sorted();
    const median = percentile(sorted, 0.5);
    const variance = moments.count > 0 ? moments.m2 / moments.count : Number.NaN;
    return {
      requestId: request.requestId,
      sliceIndex: request.sliceIndex,
      scope: request.selection?.type ?? "full-slice",
      complexMode: request.complexMode,
      geometricPixelCount: counts.geometric,
      finitePixelCount: moments.count,
      nanCount: counts.nan,
      positiveInfinityCount: counts.positiveInfinity,
      negativeInfinityCount: counts.negativeInfinity,
      mean: moments.count > 0 ? moments.mean : Number.NaN,
      minimum: moments.count > 0 ? minimum : Number.NaN,
      maximum: moments.count > 0 ? maximum : Number.NaN,
      median,
      standardDeviation: Math.sqrt(variance),
      variance,
      kurtosis:
        moments.count > 0 && moments.m2 > 0
          ? (moments.count * moments.m4) / (moments.m2 * moments.m2)
          : Number.NaN,
      approximateMedian: reservoir.approximate,
    };
  }

  async computeHistogram(request: HistogramRequest, signal?: AbortSignal): Promise<HistogramResult> {
    throwIfCancelled(signal);
    this.assertOpen();
    this.validateSlice(request.sliceIndex);
    const binCount = Math.max(2, Math.min(4096, Math.floor(request.binCount)));
    const reservoir = new Reservoir(request.approximateAllowed ? 1_000_000 : 5_000_000);
    const counts = { finite: 0, nan: 0, positiveInfinity: 0, negativeInfinity: 0 };
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;

    await this.forEachSelectionRun(request.sliceIndex, request.selection, async (data) => {
      for (const value of decodeBuffer(data, this.metadata.dtype, request.complexMode)) {
        if (Number.isNaN(value)) counts.nan += 1;
        else if (value === Number.POSITIVE_INFINITY) counts.positiveInfinity += 1;
        else if (value === Number.NEGATIVE_INFINITY) counts.negativeInfinity += 1;
        else {
          counts.finite += 1;
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
          reservoir.add(value);
        }
      }
    }, signal);

    const sorted = reservoir.sorted();
    const actualMinimum = counts.finite > 0 ? minimum : Number.NaN;
    const actualMaximum = counts.finite > 0 ? maximum : Number.NaN;
    let edgeMinimum = actualMinimum;
    let edgeMaximum = actualMaximum;
    if (counts.finite === 0) {
      edgeMinimum = -0.5;
      edgeMaximum = 0.5;
    } else if (edgeMinimum === edgeMaximum) {
      const padding = Math.max(Math.abs(edgeMinimum) * 1e-6, 1e-6);
      edgeMinimum -= padding;
      edgeMaximum += padding;
    }
    const binEdges = Array.from(
      { length: binCount + 1 },
      (_, index) => edgeMinimum + ((edgeMaximum - edgeMinimum) * index) / binCount,
    );
    const histogramCounts = new Array<number>(binCount).fill(0);
    if (counts.finite > 0) {
      for (const value of sorted) {
        const index = Math.min(
          binCount - 1,
          Math.max(0, Math.floor(((value - edgeMinimum) / (edgeMaximum - edgeMinimum)) * binCount)),
        );
        histogramCounts[index]! += 1;
      }
    }
    return {
      requestId: request.requestId,
      sliceIndex: request.sliceIndex,
      complexMode: request.complexMode,
      scope: request.selection ? "selection" : "full-slice",
      binEdges,
      counts: histogramCounts,
      finiteCount: counts.finite,
      nanCount: counts.nan,
      positiveInfinityCount: counts.positiveInfinity,
      negativeInfinityCount: counts.negativeInfinity,
      percentile1: percentile(sorted, 0.01),
      percentile99: percentile(sorted, 0.99),
      minimum: actualMinimum,
      maximum: actualMaximum,
      approximate: reservoir.approximate,
    };
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#tileCache.clear();
    await this.closeSource();
  }

  private async forEachSelectionRun(
    sliceIndex: number,
    selection: StatisticsRequest["selection"],
    callback: (data: ArrayBuffer, pixelCount: number) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.assertSourceUnchanged();
    throwIfCancelled(signal);
    this.assertOpen();
    const rasterizer = new SelectionRasterizer(
      this.metadata.width,
      this.metadata.height,
      selection,
    );
    const [startY, endY] = rasterizer.rows();
    for (let y = startY; y <= endY; y += 1) {
      throwIfCancelled(signal);
      for (const [startX, endX] of rasterizer.runsForRow(y)) {
        throwIfCancelled(signal);
        const pixelCount = endX - startX + 1;
        const data = await this.readRegion(sliceIndex, startX, y, pixelCount, 1, 1, signal);
        throwIfCancelled(signal);
        this.assertOpen();
        if (data.byteLength !== pixelCount * DTYPE_BYTES[this.metadata.dtype]) {
          throw new Error("Decoder returned an unexpected amount of image data.");
        }
        await callback(data, pixelCount);
      }
    }
  }

  private validateSlice(sliceIndex: number): void {
    if (!Number.isInteger(sliceIndex) || sliceIndex < 0 || sliceIndex >= this.metadata.sliceCount) {
      throw new Error(`Slice ${sliceIndex + 1} is outside the image stack.`);
    }
  }

  protected assertOpen(): void {
    if (this.#disposed) throw new Error("The image data source is already closed.");
  }
}

export class DataSourceCancelledError extends Error {
  constructor() {
    super("The image operation was cancelled.");
    this.name = "AbortError";
  }
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DataSourceCancelledError();
}

export function updateMoments(moments: RunningMoments, value: number): void {
  const previousCount = moments.count;
  moments.count += 1;
  const delta = value - moments.mean;
  const deltaN = delta / moments.count;
  const deltaN2 = deltaN * deltaN;
  const term1 = delta * deltaN * previousCount;
  moments.m4 +=
    term1 * deltaN2 * (moments.count * moments.count - 3 * moments.count + 3) +
    6 * deltaN2 * moments.m2 -
    4 * deltaN * moments.m3;
  moments.m3 += term1 * deltaN * (moments.count - 2) - 3 * deltaN * moments.m2;
  moments.m2 += term1;
  moments.mean += deltaN;
}

export function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const position = Math.max(0, Math.min(1, fraction)) * (sortedValues.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower]!;
  const weight = position - lower;
  return sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight;
}
