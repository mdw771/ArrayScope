import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { clampImagePoint, imageToScreen, screenToImage } from "../shared/geometry";
import type { ComplexDisplayMode, Selection } from "../shared/types";
import {
  fitToWindow,
  requestHistogram,
  requestVisibleTiles,
  samplePixel,
  zoomAbout,
} from "./controller";
import { useViewerStore } from "./store";
import { WebGLImage } from "./WebGLImage";

interface DragState {
  kind: "selection" | "pan" | "magnifier" | "sampler";
  startImage: { x: number; y: number };
  startScreen: { x: number; y: number };
  startPan: { x: number; y: number };
  button: number;
  altKey: boolean;
}

export function ImageViewport({ mode }: { mode: ComplexDisplayMode | "scalar" }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | undefined>(undefined);
  const fittedUriRef = useRef<string | undefined>(undefined);
  const state = useViewerStore();
  const metadata = state.metadata;

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      state.setViewport(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [state.setViewport]);

  useEffect(() => {
    if (
      metadata &&
      state.viewportWidth > 0 &&
      state.viewportHeight > 0 &&
      fittedUriRef.current !== metadata.uri
    ) {
      fittedUriRef.current = metadata.uri;
      fitToWindow();
    }
  }, [metadata, state.viewportHeight, state.viewportWidth]);

  useEffect(() => {
    const timer = window.setTimeout(requestVisibleTiles, 100);
    return () => window.clearTimeout(timer);
  }, [state.currentSlice, state.zoom, state.panX, state.panY, state.viewportWidth, state.viewportHeight]);

  if (!metadata) return <div className="viewport loading">Loading metadata…</div>;

  const transform = { zoom: state.zoom, panX: state.panX, panY: state.panY };
  const localPoint = (event: PointerEvent): { screen: { x: number; y: number }; image: { x: number; y: number } } => {
    const rect = wrapperRef.current!.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return {
      screen,
      image: clampImagePoint(
        screenToImage(screen, transform).x,
        screenToImage(screen, transform).y,
        metadata.width,
        metadata.height,
      ),
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    wrapperRef.current?.focus();
    const point = localPoint(event);
    const temporaryPan = event.currentTarget.dataset.spaceHeld === "true";
    const kind = temporaryPan || state.activeTool === "pan"
      ? "pan"
      : state.activeTool === "magnifier"
        ? "magnifier"
        : state.activeTool === "sampler"
          ? "sampler"
          : "selection";
    if (state.activeTool === "polygon" && !temporaryPan) {
      addPolygonVertex(point.image, point.screen);
      return;
    }
    dragRef.current = {
      kind,
      startImage: point.image,
      startScreen: point.screen,
      startPan: { x: state.panX, y: state.panY },
      button: event.button,
      altKey: event.altKey,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (kind === "selection") {
      state.setDraftSelection(selectionFromDrag(state.activeTool, point.image, point.image, event));
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const point = localPoint(event);
    if (!drag) {
      if (state.draftPolygon) state.setDraftPolygon({ ...state.draftPolygon, pointer: point.image });
      return;
    }
    if (drag.kind === "pan") {
      state.setView({
        panX: drag.startPan.x + point.screen.x - drag.startScreen.x,
        panY: drag.startPan.y + point.screen.y - drag.startScreen.y,
      });
    } else if (drag.kind === "selection") {
      state.setDraftSelection(selectionFromDrag(state.activeTool, drag.startImage, point.image, event));
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = localPoint(event);
    dragRef.current = undefined;
    if (drag.kind === "selection" && state.draftSelection) {
      state.setSelection(state.draftSelection);
      requestHistogram();
    } else if (drag.kind === "sampler") {
      samplePixel(point.image.x, point.image.y);
    } else if (drag.kind === "magnifier") {
      zoomAbout(point.screen.x, point.screen.y, drag.altKey || drag.button === 2 ? 1 / 1.5 : 1.5);
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (state.activeTool !== "magnifier") return;
    event.preventDefault();
    const rect = wrapperRef.current!.getBoundingClientRect();
    zoomAbout(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.2 : 1 / 1.2);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === " ") event.currentTarget.dataset.spaceHeld = "true";
    if (event.key === "Escape") {
      if (state.draftPolygon || state.draftSelection) {
        state.setDraftPolygon(undefined);
        state.setDraftSelection(undefined);
      }
    } else if (event.key === "Enter" && state.draftPolygon) {
      closePolygon();
    } else if (event.key === "Backspace" && state.draftPolygon) {
      event.preventDefault();
      const vertices = state.draftPolygon.vertices.slice(0, -1);
      state.setDraftPolygon(vertices.length > 0 ? { vertices } : undefined);
    } else if ((event.key === "Delete" || event.key === "Backspace") && state.selection) {
      event.preventDefault();
      state.setSelection(undefined);
      requestHistogram();
    }
  };

  const addPolygonVertex = (image: { x: number; y: number }, screen: { x: number; y: number }): void => {
    const polygon = useViewerStore.getState().draftPolygon;
    if (polygon && polygon.vertices.length >= 3) {
      const first = imageToScreen(polygon.vertices[0]!, transform);
      if (Math.hypot(first.x - screen.x, first.y - screen.y) <= 8) {
        closePolygon();
        return;
      }
    }
    state.setDraftPolygon({ vertices: [...(polygon?.vertices ?? []), image] });
  };

  const closePolygon = (): void => {
    const polygon = useViewerStore.getState().draftPolygon;
    if (!polygon || polygon.vertices.length < 3) return;
    state.setSelection({ type: "polygon", vertices: polygon.vertices });
    requestHistogram();
  };

  return (
    <div className="panel-viewport">
      {metadata.isComplex && <div className="canvas-label">{mode === "magnitude" ? "Magnitude" : "Phase"}</div>}
      <div
        ref={wrapperRef}
        className={`viewport tool-${state.activeTool}`}
        tabIndex={0}
        role="application"
        aria-label={`${mode} scientific image viewport`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = undefined;
          state.setDraftSelection(undefined);
        }}
        onDoubleClick={() => {
          if (state.activeTool !== "polygon") return;
          const polygon = useViewerStore.getState().draftPolygon;
          if (polygon && polygon.vertices.length >= 4) {
            const last = polygon.vertices.at(-1)!;
            const previous = polygon.vertices.at(-2)!;
            if (Math.hypot(last.x - previous.x, last.y - previous.y) * state.zoom <= 8) {
              state.setDraftPolygon({ vertices: polygon.vertices.slice(0, -1) });
            }
          }
          closePolygon();
        }}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (event.key === " ") event.currentTarget.dataset.spaceHeld = "false";
        }}
      >
        <WebGLImage mode={mode} />
        <SelectionOverlay mode={mode} />
      </div>
    </div>
  );
}

function selectionFromDrag(
  tool: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  event: { shiftKey: boolean; altKey: boolean },
): Selection | undefined {
  if (tool === "rectangle") return { type: "rectangle", x0: start.x, y0: start.y, x1: end.x, y1: end.y };
  if (tool === "line") return { type: "line", x0: start.x, y0: start.y, x1: end.x, y1: end.y, widthPixels: 1 };
  if (tool !== "ellipse") return undefined;
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (event.shiftKey) {
    const radius = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * radius;
    dy = Math.sign(dy || 1) * radius;
  }
  if (event.altKey) {
    return { type: "ellipse", centerX: start.x, centerY: start.y, radiusX: Math.abs(dx), radiusY: Math.abs(dy) };
  }
  return {
    type: "ellipse",
    centerX: (start.x + start.x + dx) / 2,
    centerY: (start.y + start.y + dy) / 2,
    radiusX: Math.abs(dx) / 2,
    radiusY: Math.abs(dy) / 2,
  };
}

function SelectionOverlay({ mode: _mode }: { mode: ComplexDisplayMode | "scalar" }) {
  const state = useViewerStore();
  const selection = state.draftSelection ?? state.selection;
  const transform = { zoom: state.zoom, panX: state.panX, panY: state.panY };
  const point = (x: number, y: number) => imageToScreen({ x, y }, transform);
  const polygon = state.draftPolygon;
  const sample = state.sample;
  const loading = state.sampleLoading;
  return (
    <div className="overlay">
      <svg width="100%" height="100%" aria-hidden="true">
        {selection?.type === "rectangle" && (() => {
          const a = point(selection.x0, selection.y0);
          const b = point(selection.x1, selection.y1);
          return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} />;
        })()}
        {selection?.type === "ellipse" && (() => {
          const center = point(selection.centerX, selection.centerY);
          return <ellipse cx={center.x} cy={center.y} rx={selection.radiusX * state.zoom} ry={selection.radiusY * state.zoom} />;
        })()}
        {selection?.type === "line" && (() => {
          const a = point(selection.x0, selection.y0);
          const b = point(selection.x1, selection.y1);
          return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })()}
        {selection?.type === "polygon" && <polygon points={selection.vertices.map((vertex) => { const p = point(vertex.x, vertex.y); return `${p.x},${p.y}`; }).join(" ")} />}
        {polygon && <polyline points={[...polygon.vertices, ...(polygon.pointer ? [polygon.pointer] : [])].map((vertex) => { const p = point(vertex.x, vertex.y); return `${p.x},${p.y}`; }).join(" ")} />}
        {polygon?.vertices.map((vertex, index) => { const p = point(vertex.x, vertex.y); return <circle key={index} cx={p.x} cy={p.y} r={4} />; })}
        {(sample || loading) && (() => {
          const marker = point((sample ?? loading)!.x + 0.5, (sample ?? loading)!.y + 0.5);
          return <g className={loading ? "sample-marker loading-marker" : "sample-marker"}><line x1={marker.x - 7} y1={marker.y} x2={marker.x + 7} y2={marker.y} /><line x1={marker.x} y1={marker.y - 7} x2={marker.x} y2={marker.y + 7} /></g>;
        })()}
      </svg>
      {sample && <SampleAnnotation sample={sample} />}
      {loading && <div className="sample-loading">Loading exact value…</div>}
    </div>
  );
}

function SampleAnnotation({ sample }: { sample: NonNullable<ReturnType<typeof useViewerStore.getState>["sample"]> }) {
  const state = useViewerStore();
  const marker = imageToScreen({ x: sample.x + 0.5, y: sample.y + 0.5 }, state);
  const style = {
    left: Math.max(4, Math.min(state.viewportWidth - 210, marker.x + 10)),
    top: Math.max(4, Math.min(state.viewportHeight - 118, marker.y + 10)),
  };
  return (
    <div className="sample-annotation" style={style}>
      <button
        type="button"
        className="sample-dismiss"
        aria-label="Dismiss pixel value"
        title="Dismiss pixel value"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          useViewerStore.getState().setSample(undefined);
        }}
      >×</button>
      <div>x: {sample.x}</div><div>y: {sample.y}</div><div>slice: {sample.sliceIndex + 1}</div>
      {sample.value !== undefined ? <div>value: {formatValue(sample.value)}</div> : <>
        <div>real: {formatValue(sample.real)}</div><div>imag: {formatValue(sample.imaginary)}</div>
        <div>magnitude: {formatValue(sample.magnitude)}</div><div>phase: {formatValue(sample.phase)} rad</div>
      </>}
    </div>
  );
}

function formatValue(value: number | undefined): string {
  if (value === undefined) return "—";
  return Number.isFinite(value) ? value.toPrecision(7) : String(value);
}
