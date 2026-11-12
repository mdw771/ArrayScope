import { describe, expect, it } from "vitest";
import { applyPixelTransforms, isPixelTransformList } from "../src/shared/pixelTransforms";
import type { PixelTransform } from "../src/shared/types";

describe("pixel transforms", () => {
  it.each<[number, PixelTransform, number]>([
    [Math.E, { operation: "log" }, 1],
    [100, { operation: "log10" }, 2],
    [1, { operation: "exp" }, Math.E],
    [3, { operation: "add", operand: 4 }, 7],
    [3, { operation: "subtract", operand: 4 }, -1],
    [3, { operation: "multiply", operand: -4 }, -12],
    [3, { operation: "divide", operand: 4 }, 0.75],
  ])("transforms %s with %j", (value, transform, expected) => {
    expect(applyPixelTransforms(value, [transform])).toBeCloseTo(expected);
  });

  it("composes operations in the order applied", () => {
    expect(applyPixelTransforms(2, [
      { operation: "add", operand: 3 }, { operation: "multiply", operand: 4 },
    ])).toBe(20);
  });

  it("preserves invalid domains, overflow, and non-finite values", () => {
    expect(applyPixelTransforms(-1, [{ operation: "log" }])).toBeNaN();
    expect(applyPixelTransforms(0, [{ operation: "log10" }])).toBe(-Infinity);
    expect(applyPixelTransforms(1000, [{ operation: "exp" }])).toBe(Infinity);
    expect(applyPixelTransforms(NaN, [{ operation: "add", operand: 1 }])).toBeNaN();
  });

  it("rejects unsafe or malformed operations at the protocol boundary", () => {
    for (const value of [null, {}, [{ operation: "unknown" }],
      [{ operation: "divide", operand: 0 }], [{ operation: "add", operand: Infinity }],
      [{ operation: "multiply", operand: "2" }], Array(65).fill({ operation: "log" })]) {
      expect(isPixelTransformList(value)).toBe(false);
    }
    expect(isPixelTransformList([{ operation: "divide", operand: -2 }])).toBe(true);
    expect(isPixelTransformList([])).toBe(true);
  });
});
