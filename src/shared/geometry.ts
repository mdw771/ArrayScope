import type { LineSelection, Selection } from "./types";

export type PixelRun = readonly [startX: number, endXInclusive: number];

function clampRun(run: PixelRun, width: number): PixelRun | undefined {
  const start = Math.max(0, Math.ceil(run[0]));
  const end = Math.min(width - 1, Math.floor(run[1]));
  return start <= end ? [start, end] : undefined;
}

function linePixels(line: LineSelection): Map<number, PixelRun[]> {
  let x0 = Math.round(line.x0);
  let y0 = Math.round(line.y0);
  const x1 = Math.round(line.x1);
  const y1 = Math.round(line.y1);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  const rows = new Map<number, number[]>();

  // Bresenham rasterization is the documented initial one-pixel line rule.
  for (;;) {
    const row = rows.get(y0) ?? [];
    row.push(x0);
    rows.set(y0, row);
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x0 += sx;
    }
    if (twice <= dx) {
      error += dx;
      y0 += sy;
    }
  }

  const result = new Map<number, PixelRun[]>();
  for (const [y, xs] of rows) {
    const sorted = [...new Set(xs)].sort((a, b) => a - b);
    const runs: PixelRun[] = [];
    let start = sorted[0];
    let previous = start;
    if (start === undefined) continue;
    for (let index = 1; index < sorted.length; index += 1) {
      const x = sorted[index]!;
      if (x > previous! + 1) {
        runs.push([start, previous!]);
        start = x;
      }
      previous = x;
    }
    runs.push([start, previous!]);
    result.set(y, runs);
  }
  return result;
}

export class SelectionRasterizer {
  readonly #lineRows?: Map<number, PixelRun[]>;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly selection?: Selection,
  ) {
    if (selection?.type === "line") this.#lineRows = linePixels(selection);
  }

  rows(): readonly [startY: number, endYInclusive: number] {
    const selection = this.selection;
    if (!selection) return [0, this.height - 1];
    switch (selection.type) {
      case "rectangle":
        return [
          Math.max(0, Math.ceil(Math.min(selection.y0, selection.y1) - 0.5)),
          Math.min(this.height - 1, Math.floor(Math.max(selection.y0, selection.y1) - 0.5)),
        ];
      case "ellipse":
        return [
          Math.max(0, Math.ceil(selection.centerY - selection.radiusY - 0.5)),
          Math.min(this.height - 1, Math.floor(selection.centerY + selection.radiusY - 0.5)),
        ];
      case "line": {
        const ys = [...(this.#lineRows?.keys() ?? [])];
        return ys.length === 0
          ? [0, -1]
          : [Math.max(0, Math.min(...ys)), Math.min(this.height - 1, Math.max(...ys))];
      }
      case "polygon": {
        if (selection.vertices.length < 3) return [0, -1];
        const ys = selection.vertices.map((vertex) => vertex.y);
        return [
          Math.max(0, Math.ceil(Math.min(...ys) - 0.5)),
          Math.min(this.height - 1, Math.floor(Math.max(...ys) - 0.5)),
        ];
      }
    }
  }

  runsForRow(y: number): PixelRun[] {
    if (y < 0 || y >= this.height) return [];
    const selection = this.selection;
    if (!selection) return this.width > 0 ? [[0, this.width - 1]] : [];

    switch (selection.type) {
      case "rectangle": {
        const minimumY = Math.min(selection.y0, selection.y1);
        const maximumY = Math.max(selection.y0, selection.y1);
        const centerY = y + 0.5;
        if (centerY < minimumY || centerY > maximumY) return [];
        const run = clampRun(
          [
            Math.ceil(Math.min(selection.x0, selection.x1) - 0.5),
            Math.floor(Math.max(selection.x0, selection.x1) - 0.5),
          ],
          this.width,
        );
        return run ? [run] : [];
      }
      case "ellipse": {
        if (selection.radiusX <= 0 || selection.radiusY <= 0) return [];
        const dy = (y + 0.5 - selection.centerY) / selection.radiusY;
        if (Math.abs(dy) > 1) return [];
        const halfWidth = selection.radiusX * Math.sqrt(1 - dy * dy);
        const run = clampRun(
          [
            Math.ceil(selection.centerX - halfWidth - 0.5),
            Math.floor(selection.centerX + halfWidth - 0.5),
          ],
          this.width,
        );
        return run ? [run] : [];
      }
      case "line":
        return (this.#lineRows?.get(y) ?? [])
          .map((run) => clampRun(run, this.width))
          .filter((run): run is PixelRun => run !== undefined);
      case "polygon": {
        if (selection.vertices.length < 3) return [];
        const scanY = y + 0.5;
        const intersections: number[] = [];
        for (let index = 0; index < selection.vertices.length; index += 1) {
          const a = selection.vertices[index]!;
          const b = selection.vertices[(index + 1) % selection.vertices.length]!;
          if ((a.y > scanY) === (b.y > scanY)) continue;
          intersections.push(a.x + ((scanY - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
        intersections.sort((a, b) => a - b);
        const runs: PixelRun[] = [];
        // Pairing crossings implements the even-odd fill rule, including for
        // self-intersecting polygons.
        for (let index = 0; index + 1 < intersections.length; index += 2) {
          const run = clampRun(
            [
              Math.ceil(intersections[index]! - 0.5),
              Math.floor(intersections[index + 1]! - 0.5),
            ],
            this.width,
          );
          if (run) runs.push(run);
        }
        return runs;
      }
    }
  }
}

export function clampImagePoint(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(width, x)),
    y: Math.max(0, Math.min(height, y)),
  };
}

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export function imageToScreen(
  point: { x: number; y: number },
  transform: ViewTransform,
): { x: number; y: number } {
  return {
    x: point.x * transform.zoom + transform.panX,
    y: point.y * transform.zoom + transform.panY,
  };
}

export function screenToImage(
  point: { x: number; y: number },
  transform: ViewTransform,
): { x: number; y: number } {
  return {
    x: (point.x - transform.panX) / transform.zoom,
    y: (point.y - transform.panY) / transform.zoom,
  };
}
