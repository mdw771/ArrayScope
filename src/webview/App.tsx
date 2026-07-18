import { changeSlice } from "./controller";
import { ImageViewport } from "./ImageViewport";
import { LineProfileWindow } from "./LineProfileWindow";
import { MeasurementBar } from "./MeasurementBar";
import { MenuBar } from "./MenuBar";
import { OverlayControls } from "./OverlayControls";
import { SidePanels } from "./SidePanels";
import { useViewerStore } from "./store";
import { Toolbar } from "./Toolbar";

export function App() {
  const metadata = useViewerStore((state) => state.metadata);
  const error = useViewerStore((state) => state.error);
  return (
    <main className="app-shell">
      <MenuBar />
      {metadata ? <Viewer metadata={metadata} /> : <Startup />}
      {error && <ErrorNotice />}
    </main>
  );
}

function Viewer({ metadata }: { metadata: NonNullable<ReturnType<typeof useViewerStore.getState>["metadata"]> }) {
  const dimensionality = metadata.additionalMetadata?.dimensionality;
  const scalar = metadata.format === "npy" && dimensionality === "scalar";
  const unsupported = metadata.format === "npy" && typeof dimensionality === "string" && dimensionality.startsWith("unsupported");
  return (
    <div className="viewer-shell">
      <Toolbar />
      <div className="workspace">
        <section className="viewer-region">
          {scalar ? (
            <div className="unsupported-message"><h2>Scalar NPY value</h2><code>{JSON.stringify(metadata.additionalMetadata?.scalarValue)}</code></div>
          ) : unsupported ? (
            <div className="unsupported-message"><h2>Unsupported dimensionality</h2><p>ArrayScope displays 2D images and 3D stacks. This array has shape [{metadata.shape.join(", ")}].</p></div>
          ) : (
            <>
              <div className={`canvas-grid ${metadata.isComplex ? "complex" : "scalar"}`}>
                {metadata.isComplex ? <><ImageViewport mode="magnitude" /><ImageViewport mode="phase" /></> : <ImageViewport mode="scalar" />}
              </div>
              <MeasurementBar />
            </>
          )}
          {metadata.sliceCount > 1 && !unsupported && <StackControls />}
          {!scalar && !unsupported && <OverlayControls />}
          {!scalar && !unsupported && <LineProfileWindow />}
        </section>
        <SidePanels />
      </div>
    </div>
  );
}

function Startup() {
  return <section className="startup"><div className="large-spinner" /><p>Opening scientific image…</p></section>;
}

function StackControls() {
  const slice = useViewerStore((state) => state.currentSlice);
  const count = useViewerStore((state) => state.metadata?.sliceCount ?? 1);
  return (
    <div className="stack-controls" aria-label="Image stack navigation">
      <button onClick={() => changeSlice(slice - 1)} disabled={slice === 0} aria-label="Previous slice">◀</button>
      <input type="range" min={0} max={count - 1} value={slice} onChange={(event) => changeSlice(event.target.valueAsNumber)} aria-label="Current slice" />
      <label>Slice <input type="number" min={1} max={count} value={slice + 1} onChange={(event) => changeSlice(event.target.valueAsNumber - 1)} /> / {count}</label>
      <button onClick={() => changeSlice(slice + 1)} disabled={slice + 1 >= count} aria-label="Next slice">▶</button>
    </div>
  );
}

function ErrorNotice() {
  const error = useViewerStore((state) => state.error)!;
  return (
    <div className="error-notice" role="alert">
      <div><strong>ArrayScope could not complete the request.</strong><br />{error.message}</div>
      {error.details && <details><summary>Technical details</summary><pre>{error.details}</pre></details>}
      <button aria-label="Dismiss error" onClick={() => useViewerStore.getState().setError(undefined)}>×</button>
    </div>
  );
}
