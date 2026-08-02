import { describe, expect, it } from "vitest";
import { parseRangeInput, updateDynamicRange } from "../src/webview/rangeInput";

describe("dynamic range input", () => {
  it("accepts complete finite decimal and scientific-notation values", () => {
    expect(parseRangeInput("-12.5")).toBe(-12.5);
    expect(parseRangeInput("+.5")).toBe(0.5);
    expect(parseRangeInput(" 1e-3 ")).toBe(0.001);
  });

  it("rejects empty, incomplete, and non-finite drafts at commit time", () => {
    expect(parseRangeInput("")).toBeUndefined();
    expect(parseRangeInput("-")).toBeUndefined();
    expect(parseRangeInput("1e")).toBeUndefined();
    expect(parseRangeInput("Infinity")).toBeUndefined();
    expect(parseRangeInput("0x10")).toBeUndefined();
  });

  it("keeps the committed dynamic range ordered", () => {
    expect(updateDynamicRange([0, 10], 0, 20)).toEqual([20, 20.00002]);
    expect(updateDynamicRange([0, 10], 1, -5)).toEqual([-5.000005, -5]);
  });
});
