import { describe, expect, it } from "vitest";
import { percentile, updateMoments } from "../src/host/baseDataSource";
import { transformComplex, normalizeDynamicRange } from "../src/shared/transform";

describe("numerical calculations", () => {
  it("computes stable population moments and ordinary kurtosis", () => {
    const moments = { count: 0, mean: 0, m2: 0, m3: 0, m4: 0 };
    for (const value of [1, 2, 3, 4]) updateMoments(moments, value);
    expect(moments.mean).toBeCloseTo(2.5);
    expect(moments.m2 / moments.count).toBeCloseTo(1.25);
    expect((moments.count * moments.m4) / (moments.m2 * moments.m2)).toBeCloseTo(1.64);
  });

  it("interpolates percentiles", () => {
    expect(percentile([0, 10, 20, 30], 0.5)).toBe(15);
    expect(percentile([], 0.5)).toBeNaN();
  });

  it("supports every complex transform", () => {
    const value = { real: 3, imaginary: 4 };
    expect(transformComplex(value, "magnitude")).toBe(5);
    expect(transformComplex(value, "magnitudeSquared")).toBe(25);
    expect(transformComplex(value, "real")).toBe(3);
    expect(transformComplex(value, "imaginary")).toBe(4);
    expect(transformComplex(value, "phase")).toBeCloseTo(Math.atan2(4, 3));
    expect(transformComplex(value, "logMagnitude")).toBeCloseTo(Math.log(6));
  });

  it("normalizes and clips dynamic range without dividing by zero", () => {
    expect(normalizeDynamicRange(5, 0, 10)).toBe(0.5);
    expect(normalizeDynamicRange(-2, 0, 10)).toBe(0);
    expect(normalizeDynamicRange(12, 0, 10)).toBe(1);
    expect(normalizeDynamicRange(5, 5, 5)).toBe(1);
  });
});
