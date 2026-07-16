import { SelectionRasterizer } from "../shared/geometry";
import type { ImageMetadata, Selection } from "../shared/types";

export function exceedsAutomaticHistogramPixelLimit(
  metadata: Pick<ImageMetadata, "width" | "height">,
  selection: Selection | undefined,
  configuredLimit: number,
): boolean {
  const limit = Math.max(0, Math.floor(configuredLimit));
  if (!selection) {
    return metadata.height > 0 && metadata.width > limit / metadata.height;
  }

  const rasterizer = new SelectionRasterizer(metadata.width, metadata.height, selection);
  const [startY, endY] = rasterizer.rows();
  let pixelCount = 0;
  for (let y = startY; y <= endY; y += 1) {
    for (const [startX, endX] of rasterizer.runsForRow(y)) {
      pixelCount += endX - startX + 1;
      if (pixelCount > limit) return true;
    }
  }
  return false;
}
