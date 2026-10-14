import path from "node:path";
import * as vscode from "vscode";
import {
  fromArrayBuffer,
  fromFile,
  type GeoTIFF,
  type TypedArray,
} from "geotiff";
import { DTYPE_BYTES, type ImageMetadata, type NumericDType } from "../shared/types";
import type { ChooseChannelInterpretation } from "./channelInterpretation";
import { BaseImageDataSource } from "./baseDataSource";
import { tiffDtype } from "./tiffMetadata";

interface TiffPageDescription {
  width: number;
  height: number;
  dtype: NumericDType;
  samplesPerPixel: number;
  alphaMode: "straight" | "associated";
}

type GeoTIFFImage = Awaited<ReturnType<GeoTIFF["getImage"]>>;

export class TiffImageDataSource extends BaseImageDataSource {
  readonly #images = new Map<number, GeoTIFFImage>();
  private tiff?: GeoTIFF;

  private constructor(
    metadata: ImageMetadata,
    readonly uri: vscode.Uri,
    tiff: GeoTIFF,
    readonly initialStat: vscode.FileStat,
    firstImage: GeoTIFFImage,
    remoteCacheBytes: number,
    readonly nativePage: TiffPageDescription,
  ) {
    super(metadata, remoteCacheBytes);
    this.tiff = tiff;
    this.#images.set(0, firstImage);
  }

  static async create(uri: vscode.Uri, remoteCacheBytes: number, chooseChannels?: ChooseChannelInterpretation): Promise<TiffImageDataSource> {
    const stat = await vscode.workspace.fs.stat(uri);
    let tiff: GeoTIFF;
    if (uri.scheme === "file") {
      tiff = await fromFile(uri.fsPath);
    } else {
      if (stat.size > 256 * 1024 * 1024) {
        throw new Error(
          `The ${uri.scheme} file system cannot be range-read by the TIFF decoder, and this file is too large for the safe fallback.`,
        );
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      const copy = bytes.slice().buffer;
      tiff = await fromArrayBuffer(copy);
    }

    try {
      const pageCount = await tiff.getImageCount();
      if (pageCount < 1) throw new Error("Corrupt TIFF file: no image directories were found.");
      const firstImage = await tiff.getImage(0);
      const first = describePage(firstImage);
      const shape = pageCount > 1 ? [pageCount, first.height, first.width] : [first.height, first.width];
      if (first.samplesPerPixel > 1) shape.push(first.samplesPerPixel);
      const useChannels = first.samplesPerPixel > 1 && (chooseChannels ? await chooseChannels(shape) : true);
      const channelCount = useChannels ? first.samplesPerPixel as 3 | 4 : undefined;
      const scalarColor = first.samplesPerPixel > 1 && !useChannels;
      const metadata: ImageMetadata = {
        uri: uri.toString(),
        fileName: path.basename(uri.path),
        format: "tiff",
        shape,
        width: scalarColor ? first.samplesPerPixel : first.width,
        height: scalarColor ? first.width : first.height,
        sliceCount: scalarColor && pageCount === 1 ? first.height : pageCount,
        dtype: first.dtype,
        byteOrder: tiff.littleEndian ? "little" : "big",
        fileSizeBytes: stat.size,
        totalElementCount: pageCount * first.width * first.height * first.samplesPerPixel,
        isComplex: false,
        channelCount,
        alphaMode: channelCount === 4 ? first.alphaMode : undefined,
        additionalMetadata: {
          pageCount,
          dimensionality: scalarColor && pageCount > 1 ? "unsupported-high-dimensional" : "image",
          bigTiff: tiff.bigTiff,
          tiled: firstImage.isTiled,
          tileWidth: firstImage.getTileWidth(),
          tileHeight: firstImage.getTileHeight(),
          bitsPerSample: firstImage.getBitsPerSample(0),
          sampleFormat: firstImage.getSampleFormat(0),
          compression: firstImage.getFileDirectory().getValue("Compression"),
        },
      };
      if (!Number.isSafeInteger(metadata.totalElementCount)) {
        throw new Error("TIFF element count exceeds JavaScript's safe integer range.");
      }
      return new TiffImageDataSource(
        metadata,
        uri,
        tiff,
        stat,
        firstImage,
        remoteCacheBytes,
        first,
      );
    } catch (error) {
      await Promise.resolve(tiff.close());
      throw error;
    }
  }

  protected override async readRegion(
    sliceIndex: number,
    sourceX: number,
    sourceY: number,
    outputWidth: number,
    outputHeight: number,
    step: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    signal?.throwIfAborted();
    if (this.nativePage.samplesPerPixel > 1 && !this.metadata.channelCount) {
      // A single [H,W,C] page declined as channels retains the scalar [slice,y,x] interpretation.
      const image = await this.getCompatibleImage(0, signal);
      const raster = await image.readRasters({
        window: [sourceY, sliceIndex, Math.min(this.nativePage.width, sourceY + (outputHeight - 1) * step + 1), sliceIndex + 1],
        samples: Array.from({ length: this.nativePage.samplesPerPixel }, (_, channel) => channel),
        width: outputHeight, height: 1, interleave: true, resampleMethod: "nearest", signal,
      });
      const bytes = DTYPE_BYTES[this.metadata.dtype];
      const raw = new Uint8Array(raster.buffer, raster.byteOffset, raster.byteLength);
      const output = new Uint8Array(outputWidth * outputHeight * bytes);
      for (let y = 0; y < outputHeight; y += 1) {
        for (let x = 0; x < outputWidth; x += 1) {
          const offset = (y * this.nativePage.samplesPerPixel + sourceX + x * step) * bytes;
          output.set(raw.subarray(offset, offset + bytes), (y * outputWidth + x) * bytes);
        }
      }
      return output.buffer;
    }
    const image = await this.getCompatibleImage(sliceIndex, signal);
    const sourceRight = Math.min(this.metadata.width, sourceX + (outputWidth - 1) * step + 1);
    const sourceBottom = Math.min(this.metadata.height, sourceY + (outputHeight - 1) * step + 1);
    let raster: TypedArray;
    try {
      raster = await image.readRasters({
        window: [sourceX, sourceY, sourceRight, sourceBottom],
        samples: Array.from({ length: this.metadata.channelCount ?? 1 }, (_, channel) => channel),
        width: outputWidth,
        height: outputHeight,
        resampleMethod: "nearest",
        interleave: true,
        signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new Error(
        `TIFF decoder failed for page ${sliceIndex + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return new Uint8Array(raster.buffer, raster.byteOffset, raster.byteLength).slice().buffer;
  }

  private async getCompatibleImage(index: number, signal?: AbortSignal): Promise<GeoTIFFImage> {
    let image = this.#images.get(index);
    if (!image) {
      const tiff = this.tiff;
      if (!tiff) throw new Error("The TIFF data source is already closed.");
      image = await tiff.getImage(index);
      signal?.throwIfAborted();
      this.assertOpen();
      const page = describePage(image);
      if (
        page.width !== this.nativePage.width ||
        page.height !== this.nativePage.height ||
        page.dtype !== this.metadata.dtype ||
        page.samplesPerPixel !== this.nativePage.samplesPerPixel ||
        page.alphaMode !== this.nativePage.alphaMode
      ) {
        throw new Error(
          `TIFF page ${index + 1} is incompatible with the first page and cannot be used in this stack.`,
        );
      }
      this.#images.set(index, image);
    }
    return image;
  }

  protected override async assertSourceUnchanged(): Promise<void> {
    const stat = await vscode.workspace.fs.stat(this.uri);
    if (stat.size !== this.initialStat.size || stat.mtime !== this.initialStat.mtime) {
      throw new Error("The source file changed while it was open. Reopen the editor to reload it safely.");
    }
  }

  protected override async closeSource(): Promise<void> {
    const tiff = this.tiff;
    this.tiff = undefined;
    this.#images.clear();
    if (tiff) await Promise.resolve(tiff.close());
  }
}

function describePage(image: GeoTIFFImage): TiffPageDescription {
  const samplesPerPixel = image.getSamplesPerPixel();
  const photometric = image.getFileDirectory().getValue("PhotometricInterpretation");
  if (samplesPerPixel !== 1 && !((samplesPerPixel === 3 || samplesPerPixel === 4) && photometric === 2)) {
    throw new Error(
      `Unsupported TIFF sample layout: expected grayscale, RGB, or RGBA samples, found ${samplesPerPixel}.`,
    );
  }
  const bits = image.getBitsPerSample(0);
  const format = image.getSampleFormat(0);
  const dtype = tiffDtype(bits, format);
  if (!dtype) {
    throw new Error(`Unsupported TIFF sample type: SampleFormat=${format}, BitsPerSample=${bits}.`);
  }
  for (let channel = 1; channel < samplesPerPixel; channel += 1) {
    if (image.getBitsPerSample(channel) !== bits || image.getSampleFormat(channel) !== format) {
      throw new Error("Unsupported TIFF sample layout: all color channels must have the same sample type.");
    }
  }
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    dtype,
    samplesPerPixel,
    alphaMode: samplesPerPixel === 4 && image.getFileDirectory().getValue("ExtraSamples")?.[0] === 1
      ? "associated" : "straight",
  };
}
