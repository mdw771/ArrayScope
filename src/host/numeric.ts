import { DTYPE_BYTES, type ComplexDisplayMode, type NumericDType } from "../shared/types";
import { transformComplex } from "../shared/transform";

export interface DecodedValue {
  scalar?: number;
  real?: number;
  imaginary?: number;
}

export function decodeValue(
  view: DataView,
  offset: number,
  dtype: NumericDType,
  littleEndian = true,
): DecodedValue {
  switch (dtype) {
    case "bool":
      return { scalar: view.getUint8(offset) === 0 ? 0 : 1 };
    case "uint8":
      return { scalar: view.getUint8(offset) };
    case "int8":
      return { scalar: view.getInt8(offset) };
    case "uint16":
      return { scalar: view.getUint16(offset, littleEndian) };
    case "int16":
      return { scalar: view.getInt16(offset, littleEndian) };
    case "uint32":
      return { scalar: view.getUint32(offset, littleEndian) };
    case "int32":
      return { scalar: view.getInt32(offset, littleEndian) };
    case "float32":
      return { scalar: view.getFloat32(offset, littleEndian) };
    case "float64":
      return { scalar: view.getFloat64(offset, littleEndian) };
    case "complex64":
      return {
        real: view.getFloat32(offset, littleEndian),
        imaginary: view.getFloat32(offset + 4, littleEndian),
      };
    case "complex128":
      return {
        real: view.getFloat64(offset, littleEndian),
        imaginary: view.getFloat64(offset + 8, littleEndian),
      };
  }
}

export function transformedValue(
  decoded: DecodedValue,
  mode?: ComplexDisplayMode,
): number {
  if (decoded.scalar !== undefined) return decoded.scalar;
  return transformComplex(
    { real: decoded.real ?? Number.NaN, imaginary: decoded.imaginary ?? Number.NaN },
    mode,
  );
}

export function* decodeBuffer(
  data: ArrayBuffer,
  dtype: NumericDType,
  mode?: ComplexDisplayMode,
): Generator<number> {
  const bytes = DTYPE_BYTES[dtype];
  const view = new DataView(data);
  for (let offset = 0; offset + bytes <= view.byteLength; offset += bytes) {
    yield transformedValue(decodeValue(view, offset, dtype, true), mode);
  }
}

export function swapElementBytes(data: Uint8Array, dtype: NumericDType): void {
  const componentBytes =
    dtype === "complex64" ? 4 : dtype === "complex128" ? 8 : DTYPE_BYTES[dtype];
  if (componentBytes === 1) return;
  for (let offset = 0; offset < data.byteLength; offset += componentBytes) {
    for (let left = 0, right = componentBytes - 1; left < right; left += 1, right -= 1) {
      const value = data[offset + left]!;
      data[offset + left] = data[offset + right]!;
      data[offset + right] = value;
    }
  }
}
