import type { ComplexDisplayMode } from "./types";

export interface ComplexValue {
  real: number;
  imaginary: number;
}

export function transformComplex(
  value: ComplexValue,
  mode: ComplexDisplayMode = "magnitude",
): number {
  const magnitudeSquared = value.real * value.real + value.imaginary * value.imaginary;
  switch (mode) {
    case "real":
      return value.real;
    case "imaginary":
      return value.imaginary;
    case "phase":
      return Math.atan2(value.imaginary, value.real);
    case "logMagnitude":
      return Math.log1p(Math.sqrt(magnitudeSquared));
    case "magnitudeSquared":
      return magnitudeSquared;
    case "magnitude":
      return Math.sqrt(magnitudeSquared);
  }
}

export function normalizeDynamicRange(value: number, lower: number, upper: number): number {
  if (Number.isNaN(value)) return Number.NaN;
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (!(upper > lower)) return value >= upper ? 1 : 0;
  return Math.max(0, Math.min(1, (value - lower) / (upper - lower)));
}
