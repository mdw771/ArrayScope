import type { WebviewToHostMessage } from "../shared/types";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscodeApi = acquireVsCodeApi();

export function postMessage(message: WebviewToHostMessage): void {
  vscodeApi.postMessage(message);
}
