import { measureSelection, type SelectionBounds } from "../shared/measurements";
import type { Selection } from "../shared/types";
import { useViewerStore } from "./store";

export function MeasurementBar() {
  const draftSelection = useViewerStore((state) => state.draftSelection);
  const draftPolygon = useViewerStore((state) => state.draftPolygon);
  const committedSelection = useViewerStore((state) => state.selection);
  const selection: Selection | undefined = draftSelection ?? (draftPolygon
    ? {
        type: "polygon",
        vertices: [
          ...draftPolygon.vertices,
          ...(draftPolygon.pointer ? [draftPolygon.pointer] : []),
        ],
      }
    : committedSelection);
  const measurement = measureSelection(selection);

  return (
    <div className="measurement-bar" aria-label="Selection measurements">
      {!measurement ? (
        <span className="measurement-empty">No measurable selection</span>
      ) : measurement.type === "line" ? (
        <>
          <MeasurementKind>Line</MeasurementKind>
          <MeasurementItem label="Start" value={formatPoint(measurement.start)} />
          <MeasurementItem label="End" value={formatPoint(measurement.end)} />
          <MeasurementItem label="Length" value={formatNumber(measurement.length)} />
          <MeasurementItem label="Angle" value={`${formatNumber(measurement.angleDegrees)}°`} />
        </>
      ) : (
        <>
          <MeasurementKind>{selectionLabel(selection)}</MeasurementKind>
          <BoundsItems bounds={measurement.bounds} />
          {measurement.type === "ellipse" && (
            <MeasurementItem label="Center" value={formatPoint(measurement.center)} />
          )}
        </>
      )}
    </div>
  );
}

function BoundsItems({ bounds }: { bounds: SelectionBounds }) {
  return (
    <>
      <MeasurementItem label="Top left" value={formatPoint(bounds.topLeft)} />
      <MeasurementItem label="Bottom right" value={formatPoint(bounds.bottomRight)} />
      <MeasurementItem label="Width" value={formatNumber(bounds.width)} />
      <MeasurementItem label="Height" value={formatNumber(bounds.height)} />
    </>
  );
}

function MeasurementKind({ children }: { children: string }) {
  return <strong className="measurement-kind">{children}</strong>;
}

function MeasurementItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="measurement-item">
      <span className="measurement-label">{label}</span>
      <code>{value}</code>
    </span>
  );
}

function selectionLabel(selection: Selection | undefined): string {
  if (selection?.type === "polygon") return "Polygon";
  if (selection?.type === "ellipse") {
    return Math.abs(selection.radiusX - selection.radiusY) < 1e-9 ? "Circle" : "Ellipse";
  }
  return "Rectangle";
}

function formatPoint(point: { x: number; y: number }): string {
  return `(${formatNumber(point.x)}, ${formatNumber(point.y)})`;
}

function formatNumber(value: number): string {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(2);
}
