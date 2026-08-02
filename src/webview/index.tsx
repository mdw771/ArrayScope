import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { vscodeApi } from "./api";
import { initializeController } from "./controller";
import { useViewerStore } from "./store";
import "./styles.css";

const restored = vscodeApi.getState();
if (restored && typeof restored === "object") {
  const value = restored as Partial<ReturnType<typeof useViewerStore.getState>>;
  useViewerStore.setState({
    activeTool: value.activeTool ?? "pan",
    colormap: value.colormap ?? "gray",
    complexMode: value.complexMode ?? "magnitude",
    selection: value.selection,
    zoom: value.zoom ?? 1,
    panX: value.panX ?? 0,
    panY: value.panY ?? 0,
    ranges: value.ranges ?? { phase: [-Math.PI, Math.PI] },
  });
}

const disposeController = initializeController();
const disposeInputFocusTracking = initializeInputFocusTracking();
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("ArrayScope webview root is missing.");
const reactRoot = createRoot(rootElement);
let disposed = false;

function disposeWebview(): void {
  if (disposed) return;
  disposed = true;
  const state = useViewerStore.getState();
  vscodeApi.setState({
    activeTool: state.activeTool,
    colormap: state.colormap,
    complexMode: state.complexMode,
    selection: state.selection,
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    ranges: state.ranges,
  });
  disposeInputFocusTracking();
  disposeController();
  reactRoot.unmount();
  window.removeEventListener("pagehide", disposeWebview);
  window.removeEventListener("beforeunload", disposeWebview);
}

window.addEventListener("pagehide", disposeWebview);
window.addEventListener("beforeunload", disposeWebview);
reactRoot.render(<StrictMode><App /></StrictMode>);

function initializeInputFocusTracking(): () => void {
  let reportedFocused = false;
  const report = (focused: boolean): void => {
    if (focused === reportedFocused) return;
    reportedFocused = focused;
    vscodeApi.postMessage({ type: "inputFocus", focused });
  };
  const onFocusIn = (event: FocusEvent): void => {
    if (isEditableTarget(event.target)) report(true);
  };
  const onFocusOut = (event: FocusEvent): void => {
    if (isEditableTarget(event.target) && !isEditableTarget(event.relatedTarget)) report(false);
  };
  const onWindowFocus = (): void => report(isEditableTarget(document.activeElement));
  const onWindowBlur = (): void => report(false);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  window.addEventListener("focus", onWindowFocus);
  window.addEventListener("blur", onWindowBlur);
  return () => {
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    window.removeEventListener("focus", onWindowFocus);
    window.removeEventListener("blur", onWindowBlur);
    report(false);
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest("input, select, textarea, [contenteditable]:not([contenteditable='false'])"),
  );
}
