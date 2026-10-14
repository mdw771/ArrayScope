import { endianness } from "node:os";
import path from "node:path";
import type * as vscode from "vscode";
import { isComplexDType, type ImageMetadata } from "../shared/types";
import { hasChannelDimension, type ChooseChannelInterpretation } from "./channelInterpretation";
import { BaseImageDataSource } from "./baseDataSource";
import { decodeValue, swapElementBytes } from "./numeric";
import { cOrderElementIndex, fortranOrderElementIndex, channelElementIndex } from "./npyIndex";
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

  static async create(uri: vscode.Uri, remoteCacheBytes: number, chooseChannels?: ChooseChannelInterpretation): Promise<NpyImageDataSource> {
    const reader = await openRandomAccessReader(uri);
    try {
      const header = await parseNpyHeader(reader);
      const useChannels = hasChannelDimension(header.shape) && !!(await chooseChannels?.(header.shape));
      if (useChannels && isComplexDType(header.dtype)) {
        throw new Error("RGB/RGBA interpretation requires a real-valued NPY dtype.");
      }
      const channelCount = useChannels ? header.shape.at(-1)! as 3 | 4 : undefined;
      const imageShape = useChannels ? header.shape.slice(0, -1) : header.shape;
      const dimensionality =
        header.shape.some((dimension) => dimension === 0)
          ? "unsupported-empty"
          : header.shape.length === 0
          ? "scalar"
          : header.shape.length === 1
            ? "unsupported-1d"
            : useChannels || header.shape.length <= 3
              ? "image"
              : "unsupported-high-dimensional";
      const width = imageShape.at(-1) ?? 1;
      const height = imageShape.at(-2) ?? 1;
      const sliceCount = useChannels
        ? imageShape.slice(0, -2).reduce((count, dimension) => count * dimension, 1)
        : header.shape.length === 3 ? header.shape[0]! : 1;
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
        channelCount,
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
    const output = new Uint8Array(outputWidth * outputHeight * bytesPerElement * (this.metadata.channelCount ?? 1));
    if (output.byteLength === 0) return output.buffer;
    if (this.metadata.channelCount) {
      await this.readColorRegion(output, sliceIndex, sourceX, sourceY, outputWidth, outputHeight, step, signal);
    } else if (this.header.fortranOrder) {
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

  private async readColorRegion(
    output: Uint8Array, sliceIndex: number, sourceX: number, sourceY: number,
    outputWidth: number, outputHeight: number, step: number, signal?: AbortSignal,
  ): Promise<void> {
    const channels = this.metadata.channelCount!;
    const bytes = this.header.bytesPerElement;
    const pixelBytes = bytes * channels;
    if (!this.header.fortranOrder) {
      for (let y = 0; y < outputHeight; y += 1) {
        signal?.throwIfAborted();
        const first = channelElementIndex(this.header.shape, sliceIndex, sourceY + y * step, sourceX, 0, false);
        const spanBytes = ((outputWidth - 1) * step + 1) * pixelBytes;
        if (spanBytes <= MAX_CONTIGUOUS_READ_BYTES) {
          const row = await this.reader.read(this.checkedOffset(first), spanBytes, signal);
          for (let x = 0; x < outputWidth; x += 1) {
            output.set(row.subarray(x * step * pixelBytes, x * step * pixelBytes + pixelBytes), (y * outputWidth + x) * pixelBytes);
          }
        } else {
          for (let x = 0; x < outputWidth; x += 1) {
            signal?.throwIfAborted();
            output.set(await this.reader.read(this.checkedOffset(first + x * step * channels), pixelBytes, signal), (y * outputWidth + x) * pixelBytes);
          }
        }
      }
      return;
    }
    const yStride = this.metadata.sliceCount;
    for (let channel = 0; channel < channels; channel += 1) {
      for (let x = 0; x < outputWidth; x += 1) {
        signal?.throwIfAborted();
        const first = channelElementIndex(this.header.shape, sliceIndex, sourceY, sourceX + x * step, channel, true);
        const spanBytes = ((outputHeight - 1) * step * yStride + 1) * bytes;
        const column = spanBytes <= MAX_CONTIGUOUS_READ_BYTES
          ? await this.reader.read(this.checkedOffset(first), spanBytes, signal) : undefined;
        for (let y = 0; y < outputHeight; y += 1) {
          signal?.throwIfAborted();
          const sourceOffset = y * step * yStride * bytes;
          const value = column ? column.subarray(sourceOffset, sourceOffset + bytes)
            : await this.reader.read(this.checkedOffset(first + y * step * yStride), bytes, signal);
          output.set(value, ((y * outputWidth + x) * channels + channel) * bytes);
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
