import type { Selection } from "./types";

export interface SelectionBounds {
  topLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
  width: number;
  height: number;
}

export type SelectionMeasurement =
  | {
      type: "rectangle";
      bounds: SelectionBounds;
    }
  | {
      type: "ellipse";
      bounds: SelectionBounds;
      center: { x: number; y: number };
    }
  | {
      type: "polygon";
      bounds: SelectionBounds;
    }
  | {
      type: "line";
      start: { x: number; y: number };
      end: { x: number; y: number };
      length: number;
      angleDegrees: number;
    };

export function measureSelection(selection?: Selection): SelectionMeasurement | undefined {
  if (!selection) return undefined;

  if (selection.type === "line") {
    const dx = selection.x1 - selection.x0;
    const dy = selection.y1 - selection.y0;
    const angleDegrees = Math.atan2(dy, dx) * 180 / Math.PI;
    return {
      type: "line",
      start: { x: selection.x0, y: selection.y0 },
      end: { x: selection.x1, y: selection.y1 },
      length: Math.hypot(dx, dy),
      angleDegrees: Object.is(angleDegrees, -0) ? 0 : angleDegrees,
    };
  }

  if (selection.type === "rectangle") {
    return {
      type: "rectangle",
      bounds: boundsFromCorners(selection.x0, selection.y0, selection.x1, selection.y1),
    };
  }

  if (selection.type === "polygon") {
    if (selection.vertices.length === 0) return undefined;
    const xs = selection.vertices.map((vertex) => vertex.x);
    const ys = selection.vertices.map((vertex) => vertex.y);
    return {
      type: "polygon",
      bounds: boundsFromCorners(
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      ),
    };
  }

  const radiusX = Math.abs(selection.radiusX);
  const radiusY = Math.abs(selection.radiusY);
  return {
    type: "ellipse",
    bounds: boundsFromCorners(
      selection.centerX - radiusX,
      selection.centerY - radiusY,
      selection.centerX + radiusX,
      selection.centerY + radiusY,
    ),
    center: { x: selection.centerX, y: selection.centerY },
  };
}

function boundsFromCorners(x0: number, y0: number, x1: number, y1: number): SelectionBounds {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const right = Math.max(x0, x1);
  const bottom = Math.max(y0, y1);
  return {
    topLeft: { x: left, y: top },
    bottomRight: { x: right, y: bottom },
    width: right - left,
    height: bottom - top,
  };
}
