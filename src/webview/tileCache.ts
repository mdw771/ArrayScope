import {
  DTYPE_BYTES,
  type ComplexDisplayMode,
  type ImageTile,
  type NumericDType,
} from "../shared/types";
import { decodeValue } from "../host/numeric";

function keyFor(tile: Pick<ImageTile, "sliceIndex" | "level" | "x" | "y" | "width" | "height">): string {
  return `${tile.sliceIndex}:${tile.level}:${tile.x}:${tile.y}:${tile.width}:${tile.height}`;
}

type TileRegion = Pick<ImageTile, "sliceIndex" | "level" | "x" | "y" | "width" | "height">;

export class LocalTileCache {
  readonly #tiles = new Map<string, ImageTile>();
  #maximumBytes = 256 * 1024 * 1024;
  #bytes = 0;

  configure(maximumMB: number): void {
    this.#maximumBytes = Math.max(32, maximumMB) * 1024 * 1024;
    this.evict();
  }

  set(tile: ImageTile): void {
    const key = keyFor(tile);
    const existing = this.#tiles.get(key);
    if (existing) this.#bytes -= existing.data.byteLength;
    this.#tiles.delete(key);
    this.#tiles.set(key, tile);
    this.#bytes += tile.data.byteLength;
    this.evict();
  }

  values(sliceIndex: number): ImageTile[] {
    return [...this.#tiles.values()].filter((tile) => tile.sliceIndex === sliceIndex);
  }

  has(query: TileRegion): boolean {
    return this.#tiles.has(keyFor(query));
  }

  covers(
    query: TileRegion,
    imageWidth = Number.POSITIVE_INFINITY,
    imageHeight = Number.POSITIVE_INFINITY,
  ): boolean {
    const queryRect = sourceRect(query, imageWidth, imageHeight);
    if (queryRect.right <= queryRect.left || queryRect.bottom <= queryRect.top) return false;

    const candidates = [...this.#tiles.entries()].flatMap(([key, tile]) => {
      // Lower level numbers contain finer data. A coarser cached tile is useful
      // as a fallback, but must not suppress a finer visible-tile request.
      if (tile.sliceIndex !== query.sliceIndex || tile.level > query.level) return [];
      const rect = sourceRect(tile, imageWidth, imageHeight);
      const clipped = {
        left: Math.max(queryRect.left, rect.left),
        top: Math.max(queryRect.top, rect.top),
        right: Math.min(queryRect.right, rect.right),
        bottom: Math.min(queryRect.bottom, rect.bottom),
      };
      return clipped.right > clipped.left && clipped.bottom > clipped.top
        ? [{ key, tile, rect: clipped }]
        : [];
    });
    if (candidates.length === 0) return false;

    const xBoundaries = [...new Set([
      queryRect.left,
      queryRect.right,
      ...candidates.flatMap(({ rect }) => [rect.left, rect.right]),
    ])].sort((a, b) => a - b);

    for (let index = 0; index + 1 < xBoundaries.length; index += 1) {
      const left = xBoundaries[index]!;
      const right = xBoundaries[index + 1]!;
      if (right <= left) continue;
      const intervals = candidates
        .filter(({ rect }) => rect.left <= left && rect.right >= right)
        .map(({ rect }) => [rect.top, rect.bottom] as const)
        .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
      let coveredTo = queryRect.top;
      for (const [top, bottom] of intervals) {
        if (top > coveredTo) break;
        coveredTo = Math.max(coveredTo, bottom);
        if (coveredTo >= queryRect.bottom) break;
      }
      if (coveredTo < queryRect.bottom) return false;
    }

    // Treat all intersecting contributors as recently used. This keeps the
    // coverage that suppressed the request from being the next cache eviction.
    for (const { key, tile } of candidates) {
      this.#tiles.delete(key);
      this.#tiles.set(key, tile);
    }
    return true;
  }

  findExactPixel(sliceIndex: number, x: number, y: number): ImageTile | undefined {
    for (const [key, tile] of [...this.#tiles.entries()].reverse()) {
      if (
        tile.sliceIndex === sliceIndex &&
        tile.level === 0 &&
        x >= tile.x &&
        y >= tile.y &&
        x < tile.x + tile.width &&
        y < tile.y + tile.height
      ) {
        this.#tiles.delete(key);
        this.#tiles.set(key, tile);
        return tile;
      }
    }
    return undefined;
  }

  clearSliceExcept(sliceIndex: number): void {
    // Keep neighboring slices useful for stack prefetch; eviction enforces the
    // configured global bound.
    for (const [key, tile] of this.#tiles) {
      if (Math.abs(tile.sliceIndex - sliceIndex) > 2) {
        this.#tiles.delete(key);
        this.#bytes -= tile.data.byteLength;
      }
    }
  }

  clear(): void {
    this.#tiles.clear();
    this.#bytes = 0;
  }

  private evict(): void {
    while (this.#bytes > this.#maximumBytes) {
      const key = this.#tiles.keys().next().value as string | undefined;
      if (!key) break;
      const tile = this.#tiles.get(key)!;
      this.#tiles.delete(key);
      this.#bytes -= tile.data.byteLength;
    }
  }
}

export const tileCache = new LocalTileCache();
export const overlayTileCache = new LocalTileCache();

function sourceRect(tile: TileRegion, imageWidth: number, imageHeight: number) {
  const factor = 2 ** tile.level;
  return {
    left: tile.x * factor,
    top: tile.y * factor,
    right: Math.min((tile.x + tile.width) * factor, imageWidth),
    bottom: Math.min((tile.y + tile.height) * factor, imageHeight),
  };
}

export function sampleTile(
  tile: ImageTile,
  x: number,
  y: number,
): ReturnType<typeof decodeValue> {
  const localX = x - tile.x;
  const localY = y - tile.y;
  const offset = (localY * tile.width + localX) * DTYPE_BYTES[tile.dtype];
  return decodeValue(new DataView(tile.data), offset, tile.dtype, true);
}

export function tileToFloatData(tile: ImageTile): Float32Array {
  const components = tile.dtype === "complex64" || tile.dtype === "complex128" ? 2 : 1;
  const output = new Float32Array(tile.width * tile.height * components);
  const view = new DataView(tile.data);
  const bytes = DTYPE_BYTES[tile.dtype];
  for (let index = 0; index < tile.width * tile.height; index += 1) {
    const decoded = decodeValue(view, index * bytes, tile.dtype as NumericDType, true);
    if (components === 1) output[index] = decoded.scalar ?? Number.NaN;
    else {
      output[index * 2] = decoded.real ?? Number.NaN;
      output[index * 2 + 1] = decoded.imaginary ?? Number.NaN;
    }
  }
  return output;
}

export function tileDisplayRange(
  tile: ImageTile,
  mode: ComplexDisplayMode | "scalar",
): [number, number] | undefined {
  const view = new DataView(tile.data);
  const bytes = DTYPE_BYTES[tile.dtype];
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < tile.width * tile.height; index += 1) {
    const decoded = decodeValue(view, index * bytes, tile.dtype as NumericDType, true);
    let value = decoded.scalar;
    if (value === undefined) {
      const real = decoded.real ?? Number.NaN;
      const imaginary = decoded.imaginary ?? Number.NaN;
      const magnitudeSquared = real * real + imaginary * imaginary;
      switch (mode) {
        case "phase": value = Math.atan2(imaginary, real); break;
        case "real": value = real; break;
        case "imaginary": value = imaginary; break;
        case "logMagnitude": value = Math.log1p(Math.sqrt(magnitudeSquared)); break;
        case "magnitudeSquared": value = magnitudeSquared; break;
        default: value = Math.sqrt(magnitudeSquared); break;
      }
    }
    if (Number.isFinite(value)) {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  return minimum <= maximum ? [minimum, maximum] : undefined;
}
