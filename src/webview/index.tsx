import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { vscodeApi } from "./api";
import { initializeController } from "./controller";
import {
  createPersistedViewerState,
  persistedViewerStateChanged,
  restorePersistedViewerState,
} from "./persistence";
import { useViewerStore } from "./store";
import "./styles.css";

const restored = restorePersistedViewerState(vscodeApi.getState());
if (restored) useViewerStore.setState(restored);

function persistViewerState(): void {
  vscodeApi.setState(createPersistedViewerState(useViewerStore.getState()));
}

persistViewerState();
const disposeStatePersistence = useViewerStore.subscribe((state, previousState) => {
  if (persistedViewerStateChanged(state, previousState)) persistViewerState();
});

const disposeController = initializeController();
const disposeInputFocusTracking = initializeInputFocusTracking();
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("ArrayScope webview root is missing.");
const reactRoot = createRoot(rootElement);
let disposed = false;

function disposeWebview(): void {
  if (disposed) return;
  disposed = true;
  persistViewerState();
  disposeStatePersistence();
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
