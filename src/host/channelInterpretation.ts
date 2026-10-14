export type ChooseChannelInterpretation = (shape: readonly number[]) => Promise<boolean>;

export function hasChannelDimension(shape: readonly number[]): boolean {
  return shape.length >= 3 && (shape.at(-1) === 3 || shape.at(-1) === 4);
}
