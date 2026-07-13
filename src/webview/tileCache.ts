import { DTYPE_BYTES, type ImageTile, type NumericDType } from "../shared/types";
import { decodeValue } from "../host/numeric";

function keyFor(tile: Pick<ImageTile, "sliceIndex" | "level" | "x" | "y" | "width" | "height">): string {
  return `${tile.sliceIndex}:${tile.level}:${tile.x}:${tile.y}:${tile.width}:${tile.height}`;
}

class LocalTileCache {
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

  has(query: Pick<ImageTile, "sliceIndex" | "level" | "x" | "y" | "width" | "height">): boolean {
    return this.#tiles.has(keyFor(query));
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
