import type { PixelTransform } from "./types";

export const MAX_PIXEL_TRANSFORMS = 64;

/** Apply operations in order, preserving IEEE NaN/infinity results. */
export function applyPixelTransforms(value: number, transforms: readonly PixelTransform[] = []): number {
  for (const transform of transforms) {
    switch (transform.operation) {
      case "log": value = Math.log(value); break;
      case "log10": value = Math.log10(value); break;
      case "exp": value = Math.exp(value); break;
      case "add": value += transform.operand; break;
      case "subtract": value -= transform.operand; break;
      case "multiply": value *= transform.operand; break;
      case "divide": value /= transform.operand; break;
    }
  }
  return value;
}

export function isPixelTransform(value: unknown): value is PixelTransform {
  if (typeof value !== "object" || value === null) return false;
  const transform = value as Record<string, unknown>;
  switch (transform.operation) {
    case "log": case "log10": case "exp": return true;
    case "add": case "subtract": case "multiply": case "divide":
      return typeof transform.operand === "number" && Number.isFinite(transform.operand) &&
        (transform.operation !== "divide" || transform.operand !== 0);
    default: return false;
  }
}

export function isPixelTransformList(value: unknown): value is PixelTransform[] {
  return Array.isArray(value) && value.length <= MAX_PIXEL_TRANSFORMS && value.every(isPixelTransform);
}
