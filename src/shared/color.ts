import type { NumericDType } from "./types";

/** Integer colors use their positive dtype range; float colors conventionally use 0–1. */
export function colorRange(dtype: NumericDType): [number, number] {
  switch (dtype) {
    case "uint8": return [0, 255];
    case "uint16": return [0, 65535];
    case "uint32": return [0, 4294967295];
    case "int8": return [0, 127];
    case "int16": return [0, 32767];
    case "int32": return [0, 2147483647];
    default: return [0, 1];
  }
}

/** Luminance in the original sample units, with alpha excluded. */
export function luminance(channels: readonly number[]): number {
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
