import { describe, expect, it } from "vitest";
import { tiffDtype } from "../src/host/tiffMetadata";

describe("TIFF metadata mapping", () => {
  it("maps supported grayscale sample formats", () => {
    expect(tiffDtype(8, 1)).toBe("uint8");
    expect(tiffDtype(16, 2)).toBe("int16");
    expect(tiffDtype(32, 3)).toBe("float32");
    expect(tiffDtype(64, 3)).toBe("float64");
  });

  it("rejects unsupported sample formats", () => {
    expect(tiffDtype(64, 1)).toBeUndefined();
    expect(tiffDtype(32, 6)).toBeUndefined();
  });
});
