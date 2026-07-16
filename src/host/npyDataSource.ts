import { endianness } from "node:os";
import path from "node:path";
import type * as vscode from "vscode";
import { isComplexDType, type ImageMetadata } from "../shared/types";
import { BaseImageDataSource } from "./baseDataSource";
import { decodeValue, swapElementBytes } from "./numeric";
import { cOrderElementIndex, fortranOrderElementIndex } from "./npyIndex";
import { parseNpyHeader, type ParsedNpyHeader } from "./npyParser";
import { openRandomAccessReader, type RandomAccessReader } from "./randomAccess";

const MAX_CONTIGUOUS_READ_BYTES = 32 * 1024 * 1024;

export class NpyImageDataSource extends BaseImageDataSource {
  private constructor(
    metadata: ImageMetadata,
    readonly header: ParsedNpyHeader,
    readonly reader: RandomAccessReader,
    remoteCacheBytes: number,
  ) {
    super(metadata, remoteCacheBytes);
  }

  static async create(uri: vscode.Uri, remoteCacheBytes: number): Promise<NpyImageDataSource> {
    const reader = await openRandomAccessReader(uri);
    try {
      const header = await parseNpyHeader(reader);
      const dimensionality =
        header.shape.some((dimension) => dimension === 0)
          ? "unsupported-empty"
          : header.shape.length === 0
          ? "scalar"
          : header.shape.length === 1
            ? "unsupported-1d"
            : header.shape.length <= 3
              ? "image"
              : "unsupported-high-dimensional";
      const width = header.shape.length >= 1 ? header.shape.at(-1)! : 1;
      const height = header.shape.length >= 2 ? header.shape.at(-2)! : 1;
      const sliceCount = header.shape.length === 3 ? header.shape[0]! : 1;
      const metadata: ImageMetadata = {
        uri: uri.toString(),
        fileName: path.basename(uri.path),
        format: "npy",
        shape: header.shape,
        width,
        height,
        sliceCount,
        dtype: header.dtype,
        byteOrder: header.byteOrder,
        fortranOrder: header.fortranOrder,
        fileSizeBytes: reader.size,
        totalElementCount: header.totalElementCount,
        isComplex: isComplexDType(header.dtype),
        additionalMetadata: {
          npyVersion: `${header.version[0]}.${header.version[1]}`,
          descriptor: header.descriptor,
          dataOffset: header.dataOffset,
          dimensionality,
        },
      };
      const source = new NpyImageDataSource(metadata, header, reader, remoteCacheBytes);
      if (dimensionality === "scalar") {
        const data = await source.readRegion(0, 0, 0, 1, 1, 1);
        const value = decodeValue(new DataView(data), 0, header.dtype, true);
        metadata.additionalMetadata = {
          ...metadata.additionalMetadata,
          scalarValue:
            value.scalar !== undefined
              ? value.scalar
              : { real: value.real, imaginary: value.imaginary },
        };
      }
      return source;
    } catch (error) {
      await reader.dispose();
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
    const bytesPerElement = this.header.bytesPerElement;
    const output = new Uint8Array(outputWidth * outputHeight * bytesPerElement);
    if (output.byteLength === 0) return output.buffer;
    if (this.header.fortranOrder) {
      await this.readFortranRegion(
        output,
        sliceIndex,
        sourceX,
        sourceY,
        outputWidth,
        outputHeight,
        step,
        signal,
      );
    } else {
      await this.readCRegion(
        output,
        sliceIndex,
        sourceX,
        sourceY,
        outputWidth,
        outputHeight,
        step,
        signal,
      );
    }
    const sourceIsLittle =
      this.header.byteOrder === "little" ||
      (this.header.byteOrder === "native" && endianness() === "LE");
    if (!sourceIsLittle) swapElementBytes(output, this.header.dtype);
    return output.buffer;
  }

  private async readCRegion(
    output: Uint8Array,
    sliceIndex: number,
    sourceX: number,
    sourceY: number,
    outputWidth: number,
    outputHeight: number,
    step: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const bytes = this.header.bytesPerElement;
    const spanElements = (outputWidth - 1) * step + 1;
    for (let outputY = 0; outputY < outputHeight; outputY += 1) {
      signal?.throwIfAborted();
      const sourceRow = sourceY + outputY * step;
      const firstElement = cOrderElementIndex(
        this.header.shape,
        sliceIndex,
        sourceRow,
        sourceX,
      );
      const destinationRow = outputY * outputWidth * bytes;
      if (spanElements * bytes <= MAX_CONTIGUOUS_READ_BYTES) {
        const row = await this.reader.read(
          this.checkedOffset(firstElement),
          spanElements * bytes,
          signal,
        );
        if (step === 1) {
          output.set(row, destinationRow);
          continue;
        }
        for (let outputX = 0; outputX < outputWidth; outputX += 1) {
          const sourceOffset = outputX * step * bytes;
          output.set(
            row.subarray(sourceOffset, sourceOffset + bytes),
            destinationRow + outputX * bytes,
          );
        }
      } else if (step === 1) {
        const row = await this.reader.read(this.checkedOffset(firstElement), outputWidth * bytes, signal);
        output.set(row, destinationRow);
      } else {
        for (let outputX = 0; outputX < outputWidth; outputX += 1) {
          signal?.throwIfAborted();
          const element = firstElement + outputX * step;
          const value = await this.reader.read(this.checkedOffset(element), bytes, signal);
          output.set(
            value,
            destinationRow + outputX * bytes,
          );
        }
      }
    }
  }

  private async readFortranRegion(
    output: Uint8Array,
    sliceIndex: number,
    sourceX: number,
    sourceY: number,
    outputWidth: number,
    outputHeight: number,
    step: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const bytes = this.header.bytesPerElement;
    const slices = this.header.shape.length === 3 ? this.metadata.sliceCount : 1;
    const yStride = slices;
    for (let outputX = 0; outputX < outputWidth; outputX += 1) {
      signal?.throwIfAborted();
      const sourceColumn = sourceX + outputX * step;
      const firstElement = fortranOrderElementIndex(
        this.header.shape,
        sliceIndex,
        sourceY,
        sourceColumn,
      );
      const spanElements = (outputHeight - 1) * step * yStride + 1;
      if (spanElements * bytes <= MAX_CONTIGUOUS_READ_BYTES) {
        const column = await this.reader.read(
          this.checkedOffset(firstElement),
          spanElements * bytes,
          signal,
        );
        for (let outputY = 0; outputY < outputHeight; outputY += 1) {
          const sourceOffset = outputY * step * yStride * bytes;
          const destinationOffset = (outputY * outputWidth + outputX) * bytes;
          output.set(column.subarray(sourceOffset, sourceOffset + bytes), destinationOffset);
        }
      } else {
        for (let outputY = 0; outputY < outputHeight; outputY += 1) {
          signal?.throwIfAborted();
          const element = firstElement + outputY * step * yStride;
          const value = await this.reader.read(this.checkedOffset(element), bytes, signal);
          output.set(value, (outputY * outputWidth + outputX) * bytes);
        }
      }
    }
  }

  private checkedOffset(elementIndex: number): number {
    const offset = this.header.dataOffset + elementIndex * this.header.bytesPerElement;
    if (!Number.isSafeInteger(offset)) throw new Error("NPY byte offset exceeds the safe range.");
    return offset;
  }

  protected override assertSourceUnchanged(): Promise<void> {
    return this.reader.assertUnchanged();
  }

  protected override closeSource(): Promise<void> {
    return this.reader.dispose();
  }
}
