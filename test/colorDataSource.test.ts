import { afterEach, describe, expect, it, vi } from "vitest";
import { writeArrayBuffer } from "geotiff";
import type * as vscode from "vscode";
import { NpyImageDataSource } from "../src/host/npyDataSource";
import { TiffImageDataSource } from "../src/host/tiffDataSource";
import { channelElementIndex } from "../src/host/npyIndex";
import { sampleTile, tileToFloatData } from "../src/webview/tileCache";

const files = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("vscode", () => ({
  workspace: { fs: {
    stat: async (uri: { path: string }) => ({ size: files.get(uri.path)!.length, mtime: 1 }),
    readFile: async (uri: { path: string }) => files.get(uri.path)!,
  } },
}));

const sources: Array<NpyImageDataSource | TiffImageDataSource> = [];
afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.dispose()));
  files.clear();
});

function uri(name: string): vscode.Uri {
  return { scheme: "test", path: name, toString: () => `test:${name}` } as vscode.Uri;
}
function npy(shape: number[], fortran = false, bigEndian = false): number[] {
  const values = Array.from({ length: shape.reduce((a, b) => a * b, 1) }, (_, i) => i + 1);
  const dictionary = `{'descr': '${bigEndian ? ">" : "<"}u2', 'fortran_order': ${fortran ? "True" : "False"}, 'shape': (${shape.join(", ")},), }`;
  const header = new TextEncoder().encode(dictionary + "\n");
  const output = new Uint8Array(10 + header.length + values.length * 2);
  output.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]);
  new DataView(output.buffer).setUint16(8, header.length, true);
  output.set(header, 10);
  const view = new DataView(output.buffer);
  values.forEach((value, i) => view.setUint16(10 + header.length + i * 2, value, !bigEndian));
  files.set("image.npy", output);
  return values;
}
function tiff(channels: 3 | 4, alphaMode = 2): number[] {
  const values = channels === 3 ? [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]
    : [128, 0, 0, 128, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255];
  files.set("image.tiff", new Uint8Array(writeArrayBuffer(new Uint8Array(values), {
    width: 2, height: 2, BitsPerSample: Array(channels).fill(8),
    SamplesPerPixel: channels, PhotometricInterpretation: 2,
    SampleFormat: Array(channels).fill(1), ...(channels === 4 ? { ExtraSamples: [alphaMode] } : {}),
  })));
  return values;
}

async function overview(source: NpyImageDataSource | TiffImageDataSource, slice = 0) {
  sources.push(source);
  return source.getOverview(slice);
}

describe("channel interpretation and color data", () => {
  it.each([false, true])("reads RGB NPY in Fortran order %s, including endian normalization", async (fortran) => {
    const shape = [2, 3, 3];
    const values = npy(shape, fortran, true);
    const choose = vi.fn(async () => true);
    const source = await NpyImageDataSource.create(uri("image.npy"), 1024 * 1024, choose);
    const tile = await overview(source);
    expect(choose).toHaveBeenCalledWith(shape);
    expect(await source.getMetadata()).toMatchObject({ width: 3, height: 2, sliceCount: 1, channelCount: 3 });
    const expected = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) for (let c = 0; c < 3; c++) {
      expected.push(values[channelElementIndex(shape, 0, y, x, c, fortran)]);
    }
    expect([...new Uint16Array(tile.data)]).toEqual(expected);
    const sample = await source.samplePixel({ requestId: 2, sliceIndex: 0, x: 1, y: 1 });
    expect(sample.channels).toEqual(expected.slice(12, 15));
    expect(sampleTile(tile, 1, 1).channels).toEqual(sample.channels);
  });

  it.each([false, true])("flattens leading color axes and downsamples RGBA (%s)", async (fortran) => {
    const shape = [2, 2, 3, 5, 4];
    const values = npy(shape, fortran);
    const source = await NpyImageDataSource.create(uri("image.npy"), 1024 * 1024, async () => true);
    sources.push(source);
    expect(await source.getMetadata()).toMatchObject({ width: 5, height: 3, sliceCount: 4, channelCount: 4 });
    const tile = await source.getTile({ requestId: 1, generation: 1, sliceIndex: 3, level: 1, x: 0, y: 0, width: 3, height: 2, priority: "visible" });
    const expected = [];
    for (const y of [0, 2]) for (const x of [0, 2, 4]) for (let c = 0; c < 4; c++) {
      expected.push(values[channelElementIndex(shape, 3, y, x, c, fortran)]);
    }
    expect([...new Uint16Array(tile.data)]).toEqual(expected);
  });

  it("keeps ambiguous NPY dimensions when declined and does not prompt 2D", async () => {
    npy([2, 2, 3]);
    const source = await NpyImageDataSource.create(uri("image.npy"), 1024 * 1024, async () => false);
    const tile = await overview(source, 1);
    expect(await source.getMetadata()).toMatchObject({ width: 3, height: 2, sliceCount: 2, channelCount: undefined });
    expect([...new Uint16Array(tile.data)]).toEqual([7, 8, 9, 10, 11, 12]);
    npy([2, 3]);
    const choose = vi.fn(async () => true);
    sources.push(await NpyImageDataSource.create(uri("image.npy"), 1024 * 1024, choose));
    expect(choose).not.toHaveBeenCalled();
  });

  it.each([3, 4] as const)("decodes real %s-channel TIFF and analyzes one luminance value per pixel", async (channels) => {
    const values = tiff(channels);
    const choose = vi.fn(async () => true);
    const source = await TiffImageDataSource.create(uri("image.tiff"), 1024 * 1024, choose);
    const tile = await overview(source);
    expect(choose).toHaveBeenCalledWith([2, 2, channels]);
    expect(tile.channelCount).toBe(channels);
    expect([...new Uint8Array(tile.data)]).toEqual(values);
    expect((await source.samplePixel({ requestId: 1, sliceIndex: 0, x: 0, y: 0 })).channels).toEqual(values.slice(0, channels));
    const stats = await source.computeStatistics({ requestId: 2, sliceIndex: 0 });
    expect(stats.geometricPixelCount).toBe(4);
    expect(stats.finitePixelCount).toBe(4);
    const hist = await source.computeHistogram({ requestId: 3, sliceIndex: 0, binCount: 4, approximateAllowed: false });
    expect(hist.finiteCount).toBe(4);
    expect(hist.counts.reduce((a, b) => a + b)).toBe(4);
    const profile = await source.computeLineProfile({ requestId: 4, sliceIndex: 0, line: { type: "line", x0: 0, y0: 0, x1: 1, y1: 0, widthPixels: 1 } });
    expect(profile.values).toEqual([0.2126 * values[0]!, 0.7152 * 255]);
  });

  it("retains scalar TIFF dimensions when declined", async () => {
    tiff(3);
    const source = await TiffImageDataSource.create(uri("image.tiff"), 1024 * 1024, async () => false);
    const tile = await overview(source, 1);
    expect(await source.getMetadata()).toMatchObject({ width: 3, height: 2, sliceCount: 2, channelCount: undefined });
    expect([...new Uint8Array(tile.data)]).toEqual([0, 0, 255, 255, 255, 255]);
  });

  it("normalizes alpha independently and unpremultiplies associated TIFF only for display", async () => {
    tiff(4, 1);
    const tile = await overview(await TiffImageDataSource.create(uri("image.tiff"), 1024 * 1024));
    const floats = tileToFloatData(tile);
    expect(tile.alphaMode).toBe("associated");
    expect(floats[0]).toBeCloseTo(255);
    expect(floats[3]).toBeCloseTo(128 / 255);
    expect([...floats.slice(8, 12)]).toEqual([0, 0, 0, 0]);
    expect(sampleTile(tile, 0, 0).channels).toEqual([128, 0, 0, 128]);
  });
});

/** Minimal uncompressed TIFF fixture with independent page/channel layouts. */
function colorStack(pages: Array<{ channels: 3 | 4; values: number[]; separate?: boolean; alpha?: 1 | 2 }>): Uint8Array {
  const entryCount = 12;
  const directoryBytes = 2 + entryCount * 12 + 4;
  const storage: number[] = Array(8 + pages.length * directoryBytes).fill(0);
  const put16 = (offset: number, value: number) => { storage[offset] = value & 255; storage[offset + 1] = value >>> 8 & 255; };
  const put32 = (offset: number, value: number) => { for (let i = 0; i < 4; i++) storage[offset + i] = value >>> (8 * i) & 255; };
  const append = (values: number[], bytes: number) => {
    const offset = storage.length;
    for (const value of values) for (let i = 0; i < bytes; i++) storage.push(value >>> (8 * i) & 255);
    return offset;
  };
  storage[0] = storage[1] = 0x49;
  put16(2, 42); put32(4, 8);
  pages.forEach((page, index) => {
    const channels = page.channels;
    const offsets: number[] = [];
    if (page.separate) {
      for (let channel = 0; channel < channels; channel++) {
        offsets.push(append(page.values.filter((_, i) => i % channels === channel), 1));
      }
    } else offsets.push(append(page.values, 1));
    const tags: Array<[number, number, number[]]> = [
      [256, 4, [2]], [257, 4, [2]], [258, 3, Array(channels).fill(8)],
      [259, 3, [1]], [262, 3, [2]], [273, 4, offsets], [277, 3, [channels]],
      [278, 4, [2]], [279, 4, offsets.map(() => page.separate ? 4 : 4 * channels)],
      [284, 3, [page.separate ? 2 : 1]], [338, 3, [channels === 4 ? page.alpha ?? 2 : 0]],
      [339, 3, Array(channels).fill(1)],
    ];
    const directory = 8 + index * directoryBytes;
    put16(directory, entryCount);
    tags.forEach(([tag, type, values], i) => {
      const entry = directory + 2 + i * 12;
      const bytes = type === 3 ? 2 : 4;
      put16(entry, tag); put16(entry + 2, type); put32(entry + 4, values.length);
      if (values.length * bytes <= 4) {
        values.forEach((value, j) => (bytes === 2 ? put16 : put32)(entry + 8 + j * bytes, value));
      } else put32(entry + 8, append(values, bytes));
    });
    put32(directory + 2 + entryCount * 12, index + 1 < pages.length ? directory + directoryBytes : 0);
  });
  return new Uint8Array(storage);
}

describe("TIFF color stacks", () => {
  it("reads planar and interleaved pages as the same RGB layout", async () => {
    const first = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255];
    const second = [...first].reverse();
    files.set("image.tiff", colorStack([
      { channels: 3, values: first }, { channels: 3, values: second, separate: true },
    ]));
    const source = await TiffImageDataSource.create(uri("image.tiff"), 1024 * 1024, async () => true);
    sources.push(source);
    expect(await source.getMetadata()).toMatchObject({ shape: [2, 2, 2, 3], sliceCount: 2, channelCount: 3 });
    expect([...new Uint8Array((await source.getOverview(0)).data)]).toEqual(first);
    expect([...new Uint8Array((await source.getOverview(1)).data)]).toEqual(second);
  });

  it("rejects a page with a different channel count", async () => {
    files.set("image.tiff", colorStack([
      { channels: 3, values: Array(12).fill(1) }, { channels: 4, values: Array(16).fill(2) },
    ]));
    const source = await TiffImageDataSource.create(uri("image.tiff"), 1024 * 1024);
    sources.push(source);
    await expect(source.getOverview(1)).rejects.toThrow("incompatible");
  });

  it("rejects mismatched alpha modes and preserves unsupported dimensions when declined", async () => {
    files.set("image.tiff", colorStack([
      { channels: 4, values: Array(16).fill(1), alpha: 1 },
      { channels: 4, values: Array(16).fill(2), alpha: 2 },
    ]));
    const source = await TiffImageDataSource.create(uri("image.tiff"), 1024 * 1024);
    sources.push(source);
    await expect(source.getOverview(1)).rejects.toThrow("incompatible");
    const declined = await TiffImageDataSource.create(uri("image.tiff"), 1024 * 1024, async () => false);
    sources.push(declined);
    expect((await declined.getMetadata()).additionalMetadata?.dimensionality).toBe("unsupported-high-dimensional");
  });
});
