import { describe, expect, it } from "vitest";
import { cOrderElementIndex, fortranOrderElementIndex } from "../src/host/npyIndex";

describe("NPY indexing", () => {
  it("indexes C-order 2D and 3D arrays", () => {
    expect(cOrderElementIndex([3, 4], 0, 2, 1)).toBe(9);
    expect(cOrderElementIndex([2, 3, 4], 1, 2, 1)).toBe(21);
  });

  it("indexes Fortran-order 2D and 3D arrays", () => {
    expect(fortranOrderElementIndex([3, 4], 0, 2, 1)).toBe(5);
    expect(fortranOrderElementIndex([2, 3, 4], 1, 2, 1)).toBe(11);
  });
});
