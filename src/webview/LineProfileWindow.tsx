import { FloatingWindow } from "./FloatingWindow";
import { useViewerStore } from "./store";

const SVG_WIDTH = 720;
const SVG_HEIGHT = 380;
const LEFT = 72;
const TOP = 30;
const BOTTOM = 54;

export function LineProfileWindow() {
  const open = useViewerStore((state) => state.lineProfileOpen);
  const pending = useViewerStore((state) => state.lineProfilePending);
  const profile = useViewerStore((state) => state.lineProfile);
  const close = useViewerStore((state) => state.closeLineProfile);
  if (!open) return null;

  return (
    <FloatingWindow
      className="line-profile-window"
      ariaLabel="Line profile plot"
      closeLabel="Close line profile"
      onClose={close}
      title={<>Line Profile{profile ? ` — Slice ${profile.sliceIndex + 1}` : ""}</>}
    >
      <div className="line-profile-content">
        {pending ? (
          <div className="line-profile-loading"><span className="spinner" /> Sampling full-resolution pixels…</div>
        ) : profile ? (
          <LineProfileChart profile={profile} />
        ) : null}
      </div>
    </FloatingWindow>
  );
}

function LineProfileChart({
  profile,
}: {
  profile: NonNullable<ReturnType<typeof useViewerStore.getState>["lineProfile"]>;
}) {
  const complex = profile.magnitudes !== undefined && profile.phases !== undefined;
  const right = complex ? 72 : 24;
  const plotWidth = SVG_WIDTH - LEFT - right;
  const plotHeight = SVG_HEIGHT - TOP - BOTTOM;
  const maximumDistance = Math.max(1, profile.distances.at(-1) ?? 0);
  const leftValues = complex ? profile.magnitudes! : profile.values ?? [];
  const leftRange = valueRange(leftValues, complex);
  const rightRange: readonly [number, number] = [-Math.PI, Math.PI];
  const xAt = (distance: number): number => LEFT + (distance / maximumDistance) * plotWidth;
  const yAt = (value: number, range: readonly [number, number]): number =>
    TOP + ((range[1] - value) / (range[1] - range[0])) * plotHeight;
  const leftTicks = ticks(leftRange, 5);
  const xTicks = ticks([0, maximumDistance], 6);
  const pointCount = profile.distances.length;

  return (
    <div className="line-profile-chart-shell">
      <div className="line-profile-legend" aria-hidden="true">
        <span className="legend-left">{complex ? "Magnitude" : "Pixel value"}</span>
        {complex && <span className="legend-right">Phase</span>}
      </div>
      <svg
        className="line-profile-chart"
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        role="img"
        aria-label={complex ? "Magnitude and phase along the selected line" : "Pixel values along the selected line"}
      >
        {leftTicks.map((value) => {
          const y = yAt(value, leftRange);
          return <g key={`left-${value}`}><line className="profile-grid" x1={LEFT} x2={LEFT + plotWidth} y1={y} y2={y} /><text className="profile-tick" x={LEFT - 8} y={y + 4} textAnchor="end">{formatNumber(value)}</text></g>;
        })}
        {xTicks.map((value) => {
          const x = xAt(value);
          return <g key={`x-${value}`}><line className="profile-grid" x1={x} x2={x} y1={TOP} y2={TOP + plotHeight} /><text className="profile-tick" x={x} y={TOP + plotHeight + 20} textAnchor="middle">{formatNumber(value)}</text></g>;
        })}
        <line className="profile-axis" x1={LEFT} x2={LEFT} y1={TOP} y2={TOP + plotHeight} />
        <line className="profile-axis" x1={LEFT} x2={LEFT + plotWidth} y1={TOP + plotHeight} y2={TOP + plotHeight} />
        <path className="profile-series profile-left-series" d={seriesPath(profile.distances, leftValues, xAt, (value) => yAt(value, leftRange))} />
        {pointCount <= 160 && profile.distances.map((distance, index) => {
          const value = leftValues[index];
          return value !== undefined && Number.isFinite(value)
            ? <circle className="profile-point profile-left-point" key={`lp-${index}`} cx={xAt(distance)} cy={yAt(value, leftRange)} r={2.2} />
            : null;
        })}
        {complex && <>
          <line className="profile-axis" x1={LEFT + plotWidth} x2={LEFT + plotWidth} y1={TOP} y2={TOP + plotHeight} />
          {ticks(rightRange, 5).map((value) => {
            const y = yAt(value, rightRange);
            return <text className="profile-tick profile-right-tick" key={`right-${value}`} x={LEFT + plotWidth + 8} y={y + 4}>{formatNumber(value)}</text>;
          })}
          <path className="profile-series profile-right-series" d={seriesPath(profile.distances, profile.phases!, xAt, (value) => yAt(value, rightRange), Math.PI)} />
          {pointCount <= 160 && profile.distances.map((distance, index) => {
            const value = profile.phases![index];
            return value !== undefined && Number.isFinite(value)
              ? <circle className="profile-point profile-right-point" key={`rp-${index}`} cx={xAt(distance)} cy={yAt(value, rightRange)} r={2.2} />
              : null;
          })}
          <text className="profile-axis-label profile-right-label" transform={`translate(${SVG_WIDTH - 15} ${TOP + plotHeight / 2}) rotate(90)`}>Phase (rad)</text>
        </>}
        <text className="profile-axis-label" transform={`translate(16 ${TOP + plotHeight / 2}) rotate(-90)`}>{complex ? "Magnitude" : "Pixel value"}</text>
        <text className="profile-axis-label" x={LEFT + plotWidth / 2} y={SVG_HEIGHT - 8} textAnchor="middle">Distance along line (pixels)</text>
      </svg>
      <div className="line-profile-summary">{pointCount.toLocaleString()} points · 1 px sampling · linear interpolation</div>
    </div>
  );
}

function seriesPath(
  distances: readonly number[],
  values: readonly number[],
  xAt: (distance: number) => number,
  yAt: (value: number) => number,
  maximumContinuousJump = Number.POSITIVE_INFINITY,
): string {
  let path = "";
  let drawing = false;
  let previous: number | undefined;
  const count = Math.min(distances.length, values.length);
  for (let index = 0; index < count; index += 1) {
    const value = values[index]!;
    if (!Number.isFinite(value)) {
      drawing = false;
      previous = undefined;
      continue;
    }
    if (previous !== undefined && Math.abs(value - previous) > maximumContinuousJump) drawing = false;
    path += `${drawing ? "L" : "M"}${xAt(distances[index]!).toFixed(2)},${yAt(value).toFixed(2)}`;
    drawing = true;
    previous = value;
  }
  return path;
}

function valueRange(values: readonly number[], includeZero: boolean): readonly [number, number] {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (minimum === Number.POSITIVE_INFINITY) return [-1, 1];
  if (includeZero) minimum = Math.min(0, minimum);
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.05, 1e-6);
    minimum -= padding;
    maximum += padding;
  }
  return [minimum, maximum];
}

function ticks(range: readonly [number, number], count: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    range[0] + ((range[1] - range[0]) * index) / (count - 1)
  );
}

function formatNumber(value: number): string {
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return "0";
  const absolute = Math.abs(value);
  return absolute >= 10_000 || absolute < 0.001 ? value.toExponential(2) : Number(value.toPrecision(4)).toString();
}
