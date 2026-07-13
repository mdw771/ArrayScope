import { describe, expect, it } from "vitest";
import { parseNpyHeader } from "../src/host/npyParser";

class MemoryReader {
  readonly size: number;
  constructor(readonly bytes: Uint8Array) { this.size = bytes.byteLength; }
  async read(position: number, length: number): Promise<Uint8Array> {
    return this.bytes.slice(position, position + length);
  }
}

function npy(
  version: 1 | 2 | 3,
  options: { descriptor: string; shape: number[]; fortran?: boolean; payloadBytes: number },
): Uint8Array {
  const lengthBytes = version === 1 ? 2 : 4;
  const shape = options.shape.length === 0
    ? "()"
    : `(${options.shape.join(", ")}${options.shape.length === 1 ? "," : ""})`;
  const dictionary = `{'descr': '${options.descriptor}', 'fortran_order': ${options.fortran ? "True" : "False"}, 'shape': ${shape}, }`;
  const preambleLength = 8 + lengthBytes;
  const padding = (64 - ((preambleLength + dictionary.length + 1) % 64)) % 64;
  const header = `${dictionary}${" ".repeat(padding)}\n`;
  const encoded = new TextEncoder().encode(header);
  const output = new Uint8Array(preambleLength + encoded.length + options.payloadBytes);
  output.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, version, 0]);
  const view = new DataView(output.buffer);
  if (version === 1) view.setUint16(8, encoded.length, true);
  else view.setUint32(8, encoded.length, true);
  output.set(encoded, preambleLength);
  return output;
}

describe("parseNpyHeader", () => {
  it.each([1, 2, 3] as const)("parses NPY version %i", async (version) => {
    const result = await parseNpyHeader(new MemoryReader(npy(version, {
      descriptor: "<f4",
      shape: [2, 3],
      payloadBytes: 24,
    })));
    expect(result.version).toEqual([version, 0]);
    expect(result.dtype).toBe("float32");
    expect(result.shape).toEqual([2, 3]);
    expect(result.totalElementCount).toBe(6);
  });

  it("maps big-endian complex values and Fortran order", async () => {
    const result = await parseNpyHeader(new MemoryReader(npy(2, {
      descriptor: ">c16",
      shape: [4, 2, 3],
      fortran: true,
      payloadBytes: 4 * 2 * 3 * 16,
    })));
    expect(result).toMatchObject({
      dtype: "complex128",
      byteOrder: "big",
      fortranOrder: true,
      bytesPerElement: 16,
    });
  });

  it("supports scalar and boolean arrays", async () => {
    const result = await parseNpyHeader(new MemoryReader(npy(1, {
      descriptor: "|b1",
      shape: [],
      payloadBytes: 1,
    })));
    expect(result.dtype).toBe("bool");
    expect(result.shape).toEqual([]);
    expect(result.totalElementCount).toBe(1);
  });

  it("rejects object arrays", async () => {
    await expect(parseNpyHeader(new MemoryReader(npy(1, {
      descriptor: "|O8",
      shape: [1],
      payloadBytes: 8,
    })))).rejects.toThrow(/Object/);
  });

  it("rejects payloads shorter than the declared shape", async () => {
    await expect(parseNpyHeader(new MemoryReader(npy(3, {
      descriptor: "<u2",
      shape: [100, 100],
      payloadBytes: 10,
    })))).rejects.toThrow(/shape requires/);
  });
});
