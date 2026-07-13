import type { NumericDType } from "../shared/types";

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59] as const;
const MAX_HEADER_BYTES = 16 * 1024 * 1024;

export interface ParsedNpyHeader {
  version: readonly [major: number, minor: number];
  headerLength: number;
  dataOffset: number;
  descriptor: string;
  dtype: NumericDType;
  byteOrder: "little" | "big" | "native";
  fortranOrder: boolean;
  shape: number[];
  totalElementCount: number;
  bytesPerElement: number;
}

export interface NpyHeaderReader {
  readonly size: number;
  read(position: number, length: number): Promise<Uint8Array>;
}

export async function parseNpyHeader(reader: NpyHeaderReader): Promise<ParsedNpyHeader> {
  if (reader.size < 10) throw new Error("Corrupt NPY file: the preamble is incomplete.");
  const preamble = await reader.read(0, Math.min(12, reader.size));
  if (!MAGIC.every((value, index) => preamble[index] === value)) {
    throw new Error("Corrupt NPY file: the magic signature is missing.");
  }
  const major = preamble[6]!;
  const minor = preamble[7]!;
  if (major !== 1 && major !== 2 && major !== 3) {
    throw new Error(`Unsupported NPY format version ${major}.${minor}.`);
  }
  const lengthBytes = major === 1 ? 2 : 4;
  const minimumPreamble = 8 + lengthBytes;
  if (preamble.byteLength < minimumPreamble) {
    throw new Error("Corrupt NPY file: the header length is incomplete.");
  }
  const preambleView = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);
  const headerLength =
    lengthBytes === 2
      ? preambleView.getUint16(8, true)
      : preambleView.getUint32(8, true);
  if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES) {
    throw new Error(`Corrupt NPY file: unreasonable header length ${headerLength}.`);
  }
  const dataOffset = minimumPreamble + headerLength;
  if (dataOffset > reader.size) throw new Error("Corrupt NPY file: the header exceeds the file size.");
  const bytes = await reader.read(minimumPreamble, headerLength);
  const encoding = major === 3 ? "utf-8" : "latin1";
  const header = new TextDecoder(encoding, { fatal: true }).decode(bytes).trim();

  const descriptor = readStringField(header, "descr");
  const fortranText = readBareField(header, "fortran_order");
  if (fortranText !== "True" && fortranText !== "False") {
    throw new Error("Corrupt NPY header: fortran_order must be True or False.");
  }
  const shape = readShape(header);
  const dtypeInfo = parseDescriptor(descriptor);
  const totalElementCount = checkedElementCount(shape);
  const expectedBytes = BigInt(totalElementCount) * BigInt(dtypeInfo.bytesPerElement);
  const availableBytes = BigInt(reader.size - dataOffset);
  if (expectedBytes > availableBytes) {
    throw new Error(
      `Corrupt NPY file: shape requires ${expectedBytes.toString()} data bytes, but only ${availableBytes.toString()} remain.`,
    );
  }

  return {
    version: [major, minor],
    headerLength,
    dataOffset,
    descriptor,
    dtype: dtypeInfo.dtype,
    byteOrder: dtypeInfo.byteOrder,
    fortranOrder: fortranText === "True",
    shape,
    totalElementCount,
    bytesPerElement: dtypeInfo.bytesPerElement,
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readStringField(header: string, name: string): string {
  const expression = new RegExp(`["']${escapeRegex(name)}["']\\s*:\\s*["']([^"']+)["']`);
  const match = expression.exec(header);
  if (!match?.[1]) throw new Error(`Corrupt NPY header: missing ${name}.`);
  return match[1];
}

function readBareField(header: string, name: string): string {
  const expression = new RegExp(`["']${escapeRegex(name)}["']\\s*:\\s*([^,}]+)`);
  const match = expression.exec(header);
  if (!match?.[1]) throw new Error(`Corrupt NPY header: missing ${name}.`);
  return match[1].trim();
}

function readShape(header: string): number[] {
  const match = /["']shape["']\s*:\s*\(([^)]*)\)/.exec(header);
  if (!match) throw new Error("Corrupt NPY header: missing shape tuple.");
  const contents = match[1]!.trim();
  if (contents === "") return [];
  const parts = contents.split(",").map((part) => part.trim()).filter(Boolean);
  const shape = parts.map((part) => {
    if (!/^\d+$/.test(part)) throw new Error(`Corrupt NPY header: invalid shape entry ${part}.`);
    const value = Number(part);
    if (!Number.isSafeInteger(value)) throw new Error("NPY dimension exceeds JavaScript's safe range.");
    return value;
  });
  if (shape.length > 64) throw new Error("Corrupt NPY header: unreasonable dimension count.");
  return shape;
}

function checkedElementCount(shape: number[]): number {
  let count = 1n;
  for (const dimension of shape) count *= BigInt(dimension);
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("NPY element count exceeds JavaScript's safe integer range.");
  }
  return Number(count);
}

function parseDescriptor(descriptor: string): {
  dtype: NumericDType;
  byteOrder: "little" | "big" | "native";
  bytesPerElement: number;
} {
  const match = /^([<>=|])([?buiIfc])(1|2|4|8|16)$/.exec(descriptor);
  if (!match) {
    if (/[OV]/.test(descriptor)) {
      throw new Error("Object and variable-length NPY dtypes are not supported for safety.");
    }
    throw new Error(`Unsupported NPY dtype descriptor ${descriptor}.`);
  }
  const marker = match[1]!;
  const kind = match[2]!;
  const size = Number(match[3]);
  let dtype: NumericDType | undefined;
  if ((kind === "?" || kind === "b") && size === 1) dtype = "bool";
  else if (kind === "u" && (size === 1 || size === 2 || size === 4)) dtype = `uint${size * 8}` as NumericDType;
  else if (kind === "i" && (size === 1 || size === 2 || size === 4)) dtype = `int${size * 8}` as NumericDType;
  else if (kind === "f" && (size === 4 || size === 8)) dtype = `float${size * 8}` as NumericDType;
  else if (kind === "c" && (size === 8 || size === 16)) dtype = `complex${size * 8}` as NumericDType;
  if (!dtype) throw new Error(`Unsupported NPY dtype descriptor ${descriptor}.`);
  const byteOrder = marker === "<" ? "little" : marker === ">" ? "big" : "native";
  return { dtype, byteOrder, bytesPerElement: size };
}
