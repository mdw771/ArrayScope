export function parseRangeInput(draft: string): number | undefined {
  const normalized = draft.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

export function updateDynamicRange(
  range: [number, number],
  index: 0 | 1,
  value: number,
): [number, number] {
  const next: [number, number] = [range[0], range[1]];
  next[index] = value;
  const padding = Math.max(Math.abs(value) * 1e-6, 1e-6);
  if (next[1] <= next[0]) {
    if (index === 0) next[1] = value + padding;
    else next[0] = value - padding;
  }
  return next;
}
