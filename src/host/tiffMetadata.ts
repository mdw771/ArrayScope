import type { NumericDType } from "../shared/types";

export function tiffDtype(bits: number, format: number): NumericDType | undefined {
  if (bits === 1 && format === 1) return "bool";
  if (format === 1 && (bits === 8 || bits === 16 || bits === 32)) {
    return `uint${bits}` as NumericDType;
  }
  if (format === 2 && (bits === 8 || bits === 16 || bits === 32)) {
    return `int${bits}` as NumericDType;
  }
  if (format === 3 && (bits === 32 || bits === 64)) {
    return `float${bits}` as NumericDType;
  }
  return undefined;
}
