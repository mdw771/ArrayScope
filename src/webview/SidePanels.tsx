import { useState } from "react";
import type { ComplexDisplayMode } from "../shared/types";
import { autoContrast, COMPLEX_MODES, requestHistogram, resetDynamicRange } from "./controller";
import { DEFAULT_RANGE, stableRange, useViewerStore } from "./store";

const COLORMAPS = [
  ["gray", "Gray"],
  ["invertedGray", "Inverted gray"],
  ["viridis", "Viridis"],
  ["plasma", "Plasma"],
  ["inferno", "Inferno"],
  ["magma", "Magma"],
  ["cividis", "Cividis"],
  ["turbo", "Turbo"],
  ["coolwarm", "Coolwarm"],
] as const;

export function SidePanels() {
  return (
    <aside className="side-panels" aria-label="Image information and analysis">
      <InfoPanel />
      <StatsPanel />
      <HistogramPanel />
    </aside>
  );
}

function InfoPanel() {
  const metadata = useViewerStore((state) => state.metadata);
  const currentSlice = useViewerStore((state) => state.currentSlice);
  const complexMode = useViewerStore((state) => state.complexMode);
  if (!metadata) return null;
  return (
    <details className="panel" open>
      <summary>Info</summary>
      <dl className="properties">
        <Property label="File" value={metadata.fileName} />
        <Property label="Format" value={metadata.format.toUpperCase()} />
        <Property label="File size" value={formatBytes(metadata.fileSizeBytes)} />
        <Property label="Shape" value={`[${metadata.shape.join(", ")}]`} />
        {metadata.sliceCount > 1 && <Property label="Current slice" value={`${currentSlice + 1} / ${metadata.sliceCount}`} />}
        <Property label="Dimensions" value={`${metadata.width.toLocaleString()} × ${metadata.height.toLocaleString()}`} />
        <Property label="Pixels / slice" value={(metadata.width * metadata.height).toLocaleString()} />
        <Property label="Total elements" value={metadata.totalElementCount.toLocaleString()} />
        <Property label="Data type" value={metadata.dtype} />
        <Property label="Byte order" value={metadata.byteOrder} />
        {metadata.format === "npy" && <Property label="Memory order" value={metadata.fortranOrder ? "Fortran" : "C"} />}
        <Property label="Complex" value={metadata.isComplex ? "Yes" : "No"} />
        {metadata.isComplex && <Property label="Analysis mode" value={modeLabel(complexMode)} />}
        {metadata.format === "tiff" && <Property label="TIFF pages" value={metadata.sliceCount.toLocaleString()} />}
      </dl>
      {metadata.additionalMetadata && (
        <details className="nested-details">
          <summary>Additional metadata</summary>
          <pre>{JSON.stringify(metadata.additionalMetadata, null, 2)}</pre>
        </details>
      )}
    </details>
  );
}

function StatsPanel() {
  const result = useViewerStore((state) => state.statistics);
  const stale = useViewerStore((state) => state.statisticsStale);
  const pending = useViewerStore((state) => state.calculationPending === "statistics");
  return (
    <details className="panel" open>
      <summary>Statistics {pending && <span className="spinner" />}</summary>
      {!result ? (
        <p className="empty-state">No statistics calculated.<br />Select a region or calculate statistics for the entire current slice.</p>
      ) : (
        <>
          {stale && <div className="stale-badge">Result belongs to slice {result.sliceIndex + 1} or an earlier selection.</div>}
          <dl className="properties">
            <Property label="Scope" value={scopeLabel(result.scope)} />
            <Property label="Slice" value={(result.sliceIndex + 1).toLocaleString()} />
            <Property label="Geometric pixels" value={result.geometricPixelCount.toLocaleString()} />
            <Property label="Finite pixels" value={result.finitePixelCount.toLocaleString()} />
            <Property label="NaN" value={result.nanCount.toLocaleString()} />
            <Property label="+Infinity" value={result.positiveInfinityCount.toLocaleString()} />
            <Property label="−Infinity" value={result.negativeInfinityCount.toLocaleString()} />
            <Property label="Mean" value={formatNumber(result.mean)} />
            <Property label="Minimum" value={formatNumber(result.minimum)} />
            <Property label="Maximum" value={formatNumber(result.maximum)} />
            <Property label={`Median${result.approximateMedian ? " (approx.)" : ""}`} value={formatNumber(result.median)} />
            <Property label="Std. deviation" value={formatNumber(result.standardDeviation)} />
            <Property label="Variance" value={formatNumber(result.variance)} />
            <Property label="Kurtosis" value={formatNumber(result.kurtosis)} />
            {result.complexMode && <Property label="Transform" value={modeLabel(result.complexMode)} />}
          </dl>
        </>
      )}
    </details>
  );
}

function HistogramPanel() {
  const [logCounts, setLogCounts] = useState(false);
  const metadata = useViewerStore((state) => state.metadata);
  const histogram = useViewerStore((state) => state.histogram);
  const stale = useViewerStore((state) => state.histogramStale);
  const pending = useViewerStore((state) => state.calculationPending === "histogram");
  const complexMode = useViewerStore((state) => state.complexMode);
  const colormap = useViewerStore((state) => state.colormap);
  const mode = metadata?.isComplex ? complexMode : "scalar";
  const range = useViewerStore((state) => state.ranges[mode] ?? DEFAULT_RANGE);
  const bounds: [number, number] = histogram
    ? stableRange(histogram.minimum, histogram.maximum)
    : range;
  const updateRange = (index: 0 | 1, value: number): void => {
    if (!Number.isFinite(value)) return;
    const next: [number, number] = [range[0], range[1]];
    next[index] = value;
    const padding = Math.max(Math.abs(value) * 1e-6, 1e-6);
    if (next[1] <= next[0]) {
      if (index === 0) next[1] = value + padding;
      else next[0] = value - padding;
    }
    useViewerStore.getState().setRange(mode, next);
  };
  return (
    <details className="panel histogram-panel" open>
      <summary>Histogram &amp; Dynamic Range {pending && <span className="spinner" />}</summary>
      {metadata?.isComplex && (
        <label className="control-row"><span>Analysis transform</span>
          <select value={complexMode} onChange={(event) => { useViewerStore.getState().setComplexMode(event.target.value as ComplexDisplayMode); requestHistogram(); }}>
            {COMPLEX_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
      )}
      <label className="control-row"><span>Colormap</span>
        <select value={colormap} onChange={(event) => useViewerStore.getState().setColormap(event.target.value)}>
          {COLORMAPS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <div className="histogram-header">
        <span>{histogram?.scope === "selection" ? "Selection" : "Entire current slice"}</span>
        {stale && <span className="stale-badge">Stale</span>}
        {histogram?.approximate && <span className="approx-badge">Approximate</span>}
      </div>
      <HistogramChart counts={histogram?.counts ?? []} logarithmic={logCounts} />
      <div className="histogram-axis"><span>{formatNumber(histogram?.minimum)}</span><span>{formatNumber(histogram?.maximum)}</span></div>
      <label className="checkbox-row"><input type="checkbox" checked={logCounts} onChange={(event) => setLogCounts(event.target.checked)} />Log count scale</label>
      <div className="range-inputs">
        <label>Lower<input type="number" value={range[0]} step="any" onChange={(event) => updateRange(0, event.target.valueAsNumber)} /></label>
        <label>Upper<input type="number" value={range[1]} step="any" onChange={(event) => updateRange(1, event.target.valueAsNumber)} /></label>
      </div>
      <label className="slider-label">Lower limit
        <input type="range" min={bounds[0]} max={bounds[1]} step="any" value={Math.max(bounds[0], Math.min(bounds[1], range[0]))} onChange={(event) => updateRange(0, event.target.valueAsNumber)} />
      </label>
      <label className="slider-label">Upper limit
        <input type="range" min={bounds[0]} max={bounds[1]} step="any" value={Math.max(bounds[0], Math.min(bounds[1], range[1]))} onChange={(event) => updateRange(1, event.target.valueAsNumber)} />
      </label>
      <div className="button-row">
        <button onClick={autoContrast}>Auto Contrast</button>
        <button onClick={resetDynamicRange}>Reset</button>
        <button onClick={requestHistogram}>Recalculate</button>
      </div>
      {histogram && <dl className="properties compact-properties">
        <Property label="1st percentile" value={formatNumber(histogram.percentile1)} />
        <Property label="99th percentile" value={formatNumber(histogram.percentile99)} />
        <Property label="Finite" value={histogram.finiteCount.toLocaleString()} />
        <Property label="NaN / +Inf / −Inf" value={`${histogram.nanCount} / ${histogram.positiveInfinityCount} / ${histogram.negativeInfinityCount}`} />
      </dl>}
    </details>
  );
}

function HistogramChart({ counts, logarithmic }: { counts: number[]; logarithmic: boolean }) {
  const transformed = counts.map((count) => logarithmic ? Math.log1p(count) : count);
  const maximum = Math.max(1, ...transformed);
  const width = 280;
  const height = 112;
  const path = transformed.map((count, index) => {
    const x = (index / Math.max(1, transformed.length - 1)) * width;
    const y = height - (count / maximum) * (height - 4);
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return <svg className="histogram-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="Histogram plot"><path d={path} /></svg>;
}

function Property({ label, value }: { label: string; value: string }) {
  return <><dt>{label}</dt><dd title={value}>{value}</dd></>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let index = -1;
  do { value /= 1024; index += 1; } while (value >= 1024 && index < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : 2)} ${units[index]}`;
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) return "—";
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  return Math.abs(value) >= 1e6 || Math.abs(value) < 1e-4 ? value.toExponential(6) : value.toPrecision(8);
}

function modeLabel(mode: ComplexDisplayMode): string {
  return COMPLEX_MODES.find((item) => item.value === mode)?.label ?? mode;
}

function scopeLabel(scope: string): string {
  return scope === "full-slice" ? "Entire slice" : `${scope[0]?.toUpperCase()}${scope.slice(1)} selection`;
}
