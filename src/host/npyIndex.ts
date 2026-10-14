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

/** Leading axes are flattened in logical C order for slice navigation in either storage order. */
export function channelElementIndex(
  shape: readonly number[], sliceIndex: number, y: number, x: number, channel: number,
  fortranOrder: boolean,
): number {
  const leading = shape.slice(0, -3);
  const coordinates = new Array<number>(leading.length);
  for (let axis = leading.length - 1; axis >= 0; axis -= 1) {
    coordinates[axis] = sliceIndex % leading[axis]!;
    sliceIndex = Math.floor(sliceIndex / leading[axis]!);
  }
  coordinates.push(y, x, channel);
  let index = 0;
  if (fortranOrder) {
    let stride = 1;
    for (let axis = 0; axis < shape.length; axis += 1) {
      index += coordinates[axis]! * stride;
      stride *= shape[axis]!;
    }
  } else {
    for (let axis = 0; axis < shape.length; axis += 1) index = index * shape[axis]! + coordinates[axis]!;
  }
  return index;
}
