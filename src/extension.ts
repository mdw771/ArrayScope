import * as vscode from "vscode";
import type {
  HostToWebviewMessage,
  MenuAction,
  ScientificImageDataSource,
  ViewerCommand,
  WebviewToHostMessage,
} from "./shared/types";
import { NpyImageDataSource } from "./host/npyDataSource";
import { RequestScheduler, ScheduledTaskCancelledError } from "./host/scheduler";
import { TiffImageDataSource } from "./host/tiffDataSource";

const VIEW_TYPE = "scientificImageViewer.viewer";
const SOURCE_CODE_URL = "https://github.com/mdw771/ArrayScope";
const ISSUE_TRACKER_URL = `${SOURCE_CODE_URL}/issues`;

class ScientificImageDocument implements vscode.CustomDocument {
  private constructor(
    readonly uri: vscode.Uri,
    readonly dataSource?: ScientificImageDataSource,
    readonly openError?: unknown,
  ) {}

  static async create(uri: vscode.Uri): Promise<ScientificImageDocument> {
    try {
      const dataSource = await createImageDataSource(uri);
      return new ScientificImageDocument(uri, dataSource);
    } catch (error) {
      return new ScientificImageDocument(uri, undefined, error);
    }
  }

  dispose(): void {
    const disposal = this.dataSource?.dispose();
    if (!disposal) return;
    void disposal.catch((error: unknown) => {
      console.error(`ArrayScope failed to close ${this.uri.toString()}:`, error);
    });
  }
}

interface OverlaySession {
  id: number;
  dataSource: ScientificImageDataSource;
  abortController: AbortController;
}

class ScientificImageEditorProvider
  implements vscode.CustomReadonlyEditorProvider<ScientificImageDocument>
{
  readonly #panels = new Set<vscode.WebviewPanel>();
  readonly #scheduler = new RequestScheduler(4);
  readonly #computeScheduler = new RequestScheduler(1);
  readonly #overlays = new Map<vscode.WebviewPanel, OverlaySession>();
  #nextOverlayId = 1;
  #activePanel?: vscode.WebviewPanel;

  constructor(readonly context: vscode.ExtensionContext) {}

  openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<ScientificImageDocument> {
    return ScientificImageDocument.create(uri);
  }

  async resolveCustomEditor(
    document: ScientificImageDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.#panels.add(webviewPanel);
    if (webviewPanel.active) this.#activePanel = webviewPanel;
    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };
    webview.html = this.getHtml(webview);
    let disposed = false;
    const requestAbortController = new AbortController();
    let histogramAbortController: AbortController | undefined;
    let statisticsAbortController: AbortController | undefined;
    let latestHistogramRequest = 0;
    let latestStatisticsRequest = 0;
    webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) this.#activePanel = webviewPanel;
    });
    webviewPanel.onDidDispose(() => {
      disposed = true;
      requestAbortController.abort();
      histogramAbortController?.abort();
      statisticsAbortController?.abort();
      this.#panels.delete(webviewPanel);
      if (this.#activePanel === webviewPanel) {
        this.#activePanel = [...this.#panels].find((panel) => panel.active);
      }
      void this.disposeOverlay(webviewPanel).catch((error: unknown) => {
        console.error("ArrayScope failed to close an overlay:", error);
      });
    });

    webview.onDidReceiveMessage((raw: unknown) => {
      if (!isWebviewMessage(raw)) {
        void this.post(webview, { type: "error", message: "The webview sent an invalid request." });
        return;
      }
      const message = raw;
      const send = async (response: HostToWebviewMessage): Promise<void> => {
        if (!disposed) await this.post(webview, response);
      };
      if (message.type === "menuAction") {
        void this.handleMenuAction(message.action, webviewPanel, document.uri)
          .catch((error) => send(errorMessage(error)));
        return;
      }
      if (message.type === "removeOverlay") {
        void this.disposeOverlay(webviewPanel, message.overlayId)
          .catch((error) => send(errorMessage(error)));
        return;
      }
      if (message.type === "getOverlayOverview") {
        const overlay = this.#overlays.get(webviewPanel);
        if (!overlay || overlay.id !== message.overlayId) return;
        void this.#scheduler
          .enqueue(
            0,
            () => overlay.dataSource.getOverview(message.sliceIndex, overlay.abortController.signal),
            overlay.abortController.signal,
          )
          .then((tile) => send({
            type: "overlayOverview",
            overlayId: overlay.id,
            tile: { ...tile, requestId: message.requestId, generation: message.generation },
          }))
          .catch((error) => {
            if (!isCancellationError(error) && this.#overlays.get(webviewPanel) === overlay) {
              return send(errorMessage(error, message.requestId));
            }
          });
        return;
      }
      if (message.type === "getOverlayTiles") {
        const overlay = this.#overlays.get(webviewPanel);
        if (!overlay || overlay.id !== message.overlayId) return;
        if (message.requests.length > 128) {
          void send({ type: "error", message: "An overlay tile batch may contain at most 128 requests." });
          return;
        }
        for (const request of message.requests) {
          const priority = request.priority === "immediate" ? 0 : request.priority === "visible" ? 1 : 4;
          void this.#scheduler
            .enqueue(
              priority,
              () => overlay.dataSource.getTile(request, overlay.abortController.signal),
              overlay.abortController.signal,
            )
            .then((tile) => send({ type: "overlayTile", overlayId: overlay.id, tile }))
            .catch((error) => {
              if (!isCancellationError(error) && this.#overlays.get(webviewPanel) === overlay) {
                return send(errorMessage(error, request.requestId));
              }
            });
        }
        return;
      }
      const dataSource = document.dataSource;
      if (!dataSource) {
        void send(errorMessage(document.openError ?? new Error("The image could not be opened.")));
        return;
      }
      switch (message.type) {
        case "ready":
          void this.#scheduler
            .enqueue(0, () => dataSource.getMetadata(), requestAbortController.signal)
            .then((metadata) => {
              const configuration = vscode.workspace.getConfiguration("scientificImageViewer");
              return send({
                type: "metadata",
                metadata,
                settings: {
                  localCacheMB: configuration.get<number>("localCacheMB", 256),
                  tileSize: configuration.get<number>("tileSize", 256),
                  automaticHistogramPixelLimit: configuration.get<number>(
                    "automaticHistogramPixelLimit",
                    1_000_000,
                  ),
                },
              });
            })
            .catch((error) => send(errorMessage(error)));
          break;
        case "getOverview":
          void this.#scheduler
            .enqueue(
              0,
              () => dataSource.getOverview(message.sliceIndex, requestAbortController.signal),
              requestAbortController.signal,
            )
            .then((tile) =>
              send({
                type: "overview",
                tile: {
                  ...tile,
                  requestId: message.requestId,
                  generation: message.generation,
                },
              }),
            )
            .catch((error) => send(errorMessage(error, message.requestId)));
          break;
        case "getTiles": {
          if (message.requests.length > 128) {
            void send({ type: "error", message: "A tile batch may contain at most 128 requests." });
            break;
          }
          for (const request of message.requests) {
            const priority = request.priority === "immediate" ? 0 : request.priority === "visible" ? 1 : 4;
            void this.#scheduler
              .enqueue(
                priority,
                () => dataSource.getTile(request, requestAbortController.signal),
                requestAbortController.signal,
              )
              .then((tile) => send({ type: "tile", tile }))
              .catch((error) => send(errorMessage(error, request.requestId)));
          }
          break;
        }
        case "computeHistogram": {
          histogramAbortController?.abort();
          histogramAbortController = new AbortController();
          const calculationController = histogramAbortController;
          latestHistogramRequest = message.request.requestId;
          void this.#computeScheduler
            .enqueue(0, () => {
              if (message.request.requestId !== latestHistogramRequest) {
                throw new SupersededRequestError();
              }
              return dataSource.computeHistogram(message.request, calculationController.signal);
            }, calculationController.signal)
            .then((result) => send({ type: "histogram", result }))
            .catch((error) =>
              error instanceof SupersededRequestError || isCancellationError(error)
                ? undefined
                : send(errorMessage(error, message.request.requestId)),
            )
            .finally(() => {
              if (histogramAbortController === calculationController) {
                histogramAbortController = undefined;
              }
            });
          break;
        }
        case "computeStatistics": {
          statisticsAbortController?.abort();
          statisticsAbortController = new AbortController();
          const calculationController = statisticsAbortController;
          latestStatisticsRequest = message.request.requestId;
          void this.#computeScheduler
            .enqueue(0, () => {
              if (message.request.requestId !== latestStatisticsRequest) {
                throw new SupersededRequestError();
              }
              return dataSource.computeStatistics(message.request, calculationController.signal);
            }, calculationController.signal)
            .then((result) => send({ type: "statistics", result }))
            .catch((error) =>
              error instanceof SupersededRequestError || isCancellationError(error)
                ? undefined
                : send(errorMessage(error, message.request.requestId)),
            )
            .finally(() => {
              if (statisticsAbortController === calculationController) {
                statisticsAbortController = undefined;
              }
            });
          break;
        }
        case "samplePixel":
          void this.#scheduler
            .enqueue(
              0,
              () => dataSource.samplePixel(message.request, requestAbortController.signal),
              requestAbortController.signal,
            )
            .then((result) => send({ type: "sample", result }))
            .catch((error) => send(errorMessage(error, message.request.requestId)));
          break;
      }
    });
  }

  execute(command: ViewerCommand): void {
    if (this.#activePanel && this.#panels.has(this.#activePanel)) {
      void this.post(this.#activePanel.webview, { type: "command", command });
    }
  }

  private async handleMenuAction(
    action: MenuAction,
    webviewPanel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
  ): Promise<void> {
    switch (action) {
      case "open":
        await this.openImage(webviewPanel, documentUri, true);
        break;
      case "openInNewTab":
        await this.openImage(webviewPanel, documentUri, false);
        break;
      case "addOverlay":
        await this.addOverlay(webviewPanel, documentUri);
        break;
      case "settings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          `@ext:${this.context.extension.id}`,
        );
        break;
      case "close":
        webviewPanel.dispose();
        break;
      case "sourceCode":
        await openExternal(SOURCE_CODE_URL);
        break;
      case "reportIssue":
        await openExternal(ISSUE_TRACKER_URL);
        break;
    }
  }

  private async addOverlay(
    webviewPanel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
  ): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      title: "Add Image Overlay",
      openLabel: "Add Overlay",
      defaultUri: vscode.Uri.joinPath(documentUri, ".."),
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "Scientific images": ["npy", "tif", "tiff"] },
    });
    const uri = selected?.[0];
    if (!uri) return;

    const dataSource = await createImageDataSource(uri);
    try {
      const metadata = await dataSource.getMetadata();
      if (metadata.format === "npy" && metadata.additionalMetadata?.dimensionality !== "image") {
        throw new Error("The overlay must be a 2D image or a 3D image stack.");
      }
      if (!this.#panels.has(webviewPanel)) {
        await dataSource.dispose();
        return;
      }
      const previous = this.#overlays.get(webviewPanel);
      const overlay: OverlaySession = {
        id: this.#nextOverlayId++,
        dataSource,
        abortController: new AbortController(),
      };
      this.#overlays.set(webviewPanel, overlay);
      previous?.abortController.abort();
      if (previous) {
        void previous.dataSource.dispose().catch((error: unknown) => {
          console.error("ArrayScope failed to dispose a replaced overlay:", error);
        });
      }
      await this.post(webviewPanel.webview, {
        type: "overlayMetadata",
        overlayId: overlay.id,
        metadata,
      });
    } catch (error) {
      const installed = this.#overlays.get(webviewPanel);
      if (installed?.dataSource === dataSource) {
        this.#overlays.delete(webviewPanel);
        installed.abortController.abort();
      }
      await dataSource.dispose();
      throw error;
    }
  }

  private async disposeOverlay(
    webviewPanel: vscode.WebviewPanel,
    expectedId?: number,
  ): Promise<void> {
    const overlay = this.#overlays.get(webviewPanel);
    if (!overlay || (expectedId !== undefined && overlay.id !== expectedId)) return;
    this.#overlays.delete(webviewPanel);
    overlay.abortController.abort();
    await overlay.dataSource.dispose();
  }

  private async openImage(
    webviewPanel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    replaceCurrent: boolean,
  ): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      title: "Open Scientific Image",
      openLabel: "Open",
      defaultUri: vscode.Uri.joinPath(documentUri, ".."),
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "Scientific images": ["npy", "tif", "tiff"] },
    });
    const uri = selected?.[0];
    if (!uri || (replaceCurrent && uri.toString() === documentUri.toString())) return;
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      VIEW_TYPE,
      {
        viewColumn: webviewPanel.viewColumn ?? vscode.ViewColumn.Active,
        preserveFocus: false,
        preview: false,
      } satisfies vscode.TextDocumentShowOptions,
    );
    if (replaceCurrent) webviewPanel.dispose();
  }

  private post(webview: vscode.Webview, message: HostToWebviewMessage): Thenable<boolean> {
    return webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
    );
    const nonce = createNonce();
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}'; worker-src blob:;">
    <link rel="stylesheet" href="${styleUri}">
    <title>ArrayScope Scientific Image Viewer</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

class SupersededRequestError extends Error {}

function isCancellationError(error: unknown): boolean {
  return error instanceof ScheduledTaskCancelledError ||
    (error instanceof Error && error.name === "AbortError");
}

function isWebviewMessage(value: unknown): value is WebviewToHostMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "ready":
      return true;
    case "menuAction":
      return isMenuAction(value.action);
    case "removeOverlay":
      return integer(value.overlayId);
    case "getOverlayOverview":
      return integer(value.overlayId) &&
        integer(value.sliceIndex) &&
        integer(value.generation) &&
        integer(value.requestId);
    case "getOverlayTiles":
      return integer(value.overlayId) &&
        Array.isArray(value.requests) &&
        value.requests.every(isTileRequest);
    case "getOverview":
      return integer(value.sliceIndex) && integer(value.generation) && integer(value.requestId);
    case "getTiles":
      return Array.isArray(value.requests) && value.requests.every(isTileRequest);
    case "computeHistogram":
      return isRecord(value.request) &&
        integer(value.request.requestId) &&
        integer(value.request.sliceIndex) &&
        finiteNumber(value.request.binCount) &&
        typeof value.request.approximateAllowed === "boolean" &&
        optionalSelection(value.request.selection) &&
        optionalComplexMode(value.request.complexMode);
    case "computeStatistics":
      return isRecord(value.request) &&
        integer(value.request.requestId) &&
        integer(value.request.sliceIndex) &&
        optionalSelection(value.request.selection) &&
        optionalComplexMode(value.request.complexMode);
    case "samplePixel":
      return isRecord(value.request) &&
        integer(value.request.requestId) &&
        integer(value.request.sliceIndex) &&
        finiteNumber(value.request.x) &&
        finiteNumber(value.request.y);
    default:
      return false;
  }
}

function isMenuAction(value: unknown): value is MenuAction {
  return value === "open" ||
    value === "openInNewTab" ||
    value === "addOverlay" ||
    value === "settings" ||
    value === "close" ||
    value === "sourceCode" ||
    value === "reportIssue";
}

function isTileRequest(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    integer(value.requestId) &&
    integer(value.generation) &&
    integer(value.sliceIndex) &&
    integer(value.level) &&
    finiteNumber(value.x) &&
    finiteNumber(value.y) &&
    finiteNumber(value.width) &&
    finiteNumber(value.height) &&
    (value.priority === "immediate" || value.priority === "visible" || value.priority === "prefetch")
  );
}

function optionalSelection(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "rectangle":
      return finiteNumbers(value, ["x0", "y0", "x1", "y1"]);
    case "ellipse":
      return finiteNumbers(value, ["centerX", "centerY", "radiusX", "radiusY"]);
    case "line":
      return finiteNumbers(value, ["x0", "y0", "x1", "y1", "widthPixels"]);
    case "polygon":
      return Array.isArray(value.vertices) &&
        value.vertices.length >= 3 &&
        value.vertices.length <= 10_000 &&
        value.vertices.every((vertex) =>
          isRecord(vertex) && finiteNumber(vertex.x) && finiteNumber(vertex.y),
        );
    default:
      return false;
  }
}

function optionalComplexMode(value: unknown): boolean {
  return value === undefined ||
    value === "magnitude" ||
    value === "phase" ||
    value === "real" ||
    value === "imaginary" ||
    value === "logMagnitude" ||
    value === "magnitudeSquared";
}

function finiteNumbers(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => finiteNumber(value[field]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value);
}

function errorMessage(error: unknown, requestId?: number): HostToWebviewMessage {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof Error ? error.stack : undefined;
  return { type: "error", requestId, message, details };
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]!,
  ).join("");
}

async function openExternal(url: string): Promise<void> {
  const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
  if (!opened) throw new Error(`VS Code could not open ${url}.`);
}

async function createImageDataSource(uri: vscode.Uri): Promise<ScientificImageDataSource> {
  const cacheMB = vscode.workspace
    .getConfiguration("scientificImageViewer")
    .get<number>("remoteCacheMB", 512);
  const cacheBytes = cacheMB * 1024 * 1024;
  const extension = uri.path.toLowerCase();
  if (extension.endsWith(".npy")) return NpyImageDataSource.create(uri, cacheBytes);
  if (extension.endsWith(".tif") || extension.endsWith(".tiff")) {
    return TiffImageDataSource.create(uri, cacheBytes);
  }
  throw new Error(`Unsupported scientific image extension for ${uri.path}.`);
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ScientificImageEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: true,
    }),
  );

  const commands: Record<string, ViewerCommand> = {
    "scientificImageViewer.tool.rectangle": "tool.rectangle",
    "scientificImageViewer.tool.ellipse": "tool.ellipse",
    "scientificImageViewer.tool.line": "tool.line",
    "scientificImageViewer.tool.polygon": "tool.polygon",
    "scientificImageViewer.tool.sampler": "tool.sampler",
    "scientificImageViewer.computeStatistics": "computeStatistics",
    "scientificImageViewer.tool.magnifier": "tool.magnifier",
    "scientificImageViewer.tool.pan": "tool.pan",
    "scientificImageViewer.autoContrast": "autoContrast",
    "scientificImageViewer.clearSelection": "clearSelection",
    "scientificImageViewer.fitToWindow": "fitToWindow",
    "scientificImageViewer.actualPixels": "actualPixels",
    "scientificImageViewer.zoomIn": "zoomIn",
    "scientificImageViewer.zoomOut": "zoomOut",
    "scientificImageViewer.nextSlice": "nextSlice",
    "scientificImageViewer.previousSlice": "previousSlice",
  };
  for (const [identifier, command] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(identifier, () => provider.execute(command)));
  }
}

export function deactivate(): void {}
