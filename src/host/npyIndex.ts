export function cOrderElementIndex(
  shape: readonly number[],
  sliceIndex: number,
  y: number,
  x: number,
): number {
  if (shape.length === 0) return 0;
  if (shape.length === 1) return x;
  const width = shape.at(-1)!;
  if (shape.length === 2) return y * width + x;
  if (shape.length === 3) return (sliceIndex * shape[1]! + y) * width + x;
  throw new Error("Image indexing supports at most three NPY dimensions.");
}

export function fortranOrderElementIndex(
  shape: readonly number[],
  sliceIndex: number,
  y: number,
  x: number,
): number {
  if (shape.length === 0) return 0;
  if (shape.length === 1) return x;
  if (shape.length === 2) return y + shape[0]! * x;
  if (shape.length === 3) return sliceIndex + shape[0]! * (y + shape[1]! * x);
  throw new Error("Image indexing supports at most three NPY dimensions.");
}
