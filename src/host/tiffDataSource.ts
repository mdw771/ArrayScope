import path from "node:path";
import * as vscode from "vscode";
import {
  fromArrayBuffer,
  fromFile,
  type GeoTIFF,
  type TypedArray,
} from "geotiff";
import type { ImageMetadata, NumericDType } from "../shared/types";
import { BaseImageDataSource } from "./baseDataSource";
import { tiffDtype } from "./tiffMetadata";

interface TiffPageDescription {
  width: number;
  height: number;
  dtype: NumericDType;
  samplesPerPixel: number;
}

type GeoTIFFImage = Awaited<ReturnType<GeoTIFF["getImage"]>>;

export class TiffImageDataSource extends BaseImageDataSource {
  readonly #images = new Map<number, GeoTIFFImage>();

  private constructor(
    metadata: ImageMetadata,
    readonly uri: vscode.Uri,
    readonly tiff: GeoTIFF,
    readonly initialStat: vscode.FileStat,
    firstImage: GeoTIFFImage,
    remoteCacheBytes: number,
  ) {
    super(metadata, remoteCacheBytes);
    this.#images.set(0, firstImage);
  }

  static async create(uri: vscode.Uri, remoteCacheBytes: number): Promise<TiffImageDataSource> {
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
      const metadata: ImageMetadata = {
        uri: uri.toString(),
        fileName: path.basename(uri.path),
        format: "tiff",
        shape: pageCount > 1 ? [pageCount, first.height, first.width] : [first.height, first.width],
        width: first.width,
        height: first.height,
        sliceCount: pageCount,
        dtype: first.dtype,
        byteOrder: tiff.littleEndian ? "little" : "big",
        fileSizeBytes: stat.size,
        totalElementCount: pageCount * first.width * first.height,
        isComplex: false,
        additionalMetadata: {
          pageCount,
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
  ): Promise<ArrayBuffer> {
    const image = await this.getCompatibleImage(sliceIndex);
    const sourceRight = Math.min(this.metadata.width, sourceX + (outputWidth - 1) * step + 1);
    const sourceBottom = Math.min(this.metadata.height, sourceY + (outputHeight - 1) * step + 1);
    let raster: TypedArray;
    try {
      raster = await image.readRasters({
        window: [sourceX, sourceY, sourceRight, sourceBottom],
        samples: [0],
        width: outputWidth,
        height: outputHeight,
        resampleMethod: "nearest",
        interleave: true,
      });
    } catch (error) {
      throw new Error(
        `TIFF decoder failed for page ${sliceIndex + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return new Uint8Array(raster.buffer, raster.byteOffset, raster.byteLength).slice().buffer;
  }

  private async getCompatibleImage(index: number): Promise<GeoTIFFImage> {
    let image = this.#images.get(index);
    if (!image) {
      image = await this.tiff.getImage(index);
      const page = describePage(image);
      if (
        page.width !== this.metadata.width ||
        page.height !== this.metadata.height ||
        page.dtype !== this.metadata.dtype ||
        page.samplesPerPixel !== 1
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
    this.#images.clear();
    await Promise.resolve(this.tiff.close());
  }
}

function describePage(image: GeoTIFFImage): TiffPageDescription {
  const samplesPerPixel = image.getSamplesPerPixel();
  if (samplesPerPixel !== 1) {
    throw new Error(
      `Unsupported TIFF sample layout: expected one grayscale sample per pixel, found ${samplesPerPixel}.`,
    );
  }
  const bits = image.getBitsPerSample(0);
  const format = image.getSampleFormat(0);
  const dtype = tiffDtype(bits, format);
  if (!dtype) {
    throw new Error(`Unsupported TIFF sample type: SampleFormat=${format}, BitsPerSample=${bits}.`);
  }
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    dtype,
    samplesPerPixel,
  };
}
