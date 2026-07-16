export type NumericDType =
  | "bool"
  | "uint8"
  | "uint16"
  | "uint32"
  | "int8"
  | "int16"
  | "int32"
  | "float32"
  | "float64"
  | "complex64"
  | "complex128";

export type ComplexDisplayMode =
  | "magnitude"
  | "phase"
  | "real"
  | "imaginary"
  | "logMagnitude"
  | "magnitudeSquared";

export interface ImageMetadata {
  uri: string;
  fileName: string;
  format: "npy" | "tiff";
  shape: number[];
  width: number;
  height: number;
  sliceCount: number;
  dtype: NumericDType;
  byteOrder: "little" | "big" | "native";
  fortranOrder?: boolean;
  fileSizeBytes: number;
  totalElementCount: number;
  isComplex: boolean;
  additionalMetadata?: Record<string, unknown>;
}

export interface RectangleSelection {
  type: "rectangle";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface EllipseSelection {
  type: "ellipse";
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
}

export interface LineSelection {
  type: "line";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  widthPixels: number;
}

export interface PolygonSelection {
  type: "polygon";
  vertices: Array<{ x: number; y: number }>;
}

export type Selection =
  | RectangleSelection
  | EllipseSelection
  | LineSelection
  | PolygonSelection;

export interface ImageTileRequest {
  requestId: number;
  generation: number;
  sliceIndex: number;
  level: number;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: "immediate" | "visible" | "prefetch";
}

export interface ImageTile extends Omit<ImageTileRequest, "priority"> {
  dtype: NumericDType;
  data: ArrayBuffer;
}

export interface HistogramRequest {
  requestId: number;
  sliceIndex: number;
  selection?: Selection;
  complexMode?: ComplexDisplayMode;
  binCount: number;
  approximateAllowed: boolean;
}

export interface HistogramResult {
  requestId: number;
  sliceIndex: number;
  complexMode?: ComplexDisplayMode;
  scope: "full-slice" | "selection";
  binEdges: number[];
  counts: number[];
  finiteCount: number;
  nanCount: number;
  positiveInfinityCount: number;
  negativeInfinityCount: number;
  percentile1: number;
  percentile99: number;
  minimum: number;
  maximum: number;
  approximate: boolean;
}

export interface StatisticsRequest {
  requestId: number;
  sliceIndex: number;
  selection?: Selection;
  complexMode?: ComplexDisplayMode;
}

export interface StatisticsResult {
  requestId: number;
  sliceIndex: number;
  scope: "full-slice" | Selection["type"];
  complexMode?: ComplexDisplayMode;
  geometricPixelCount: number;
  finitePixelCount: number;
  nanCount: number;
  positiveInfinityCount: number;
  negativeInfinityCount: number;
  mean: number;
  minimum: number;
  maximum: number;
  median: number;
  standardDeviation: number;
  variance: number;
  kurtosis: number;
  approximateMedian: boolean;
}

export interface SamplePixelRequest {
  requestId: number;
  sliceIndex: number;
  x: number;
  y: number;
}

export interface SamplePixelResult {
  requestId: number;
  sliceIndex: number;
  x: number;
  y: number;
  value?: number;
  real?: number;
  imaginary?: number;
  magnitude?: number;
  phase?: number;
}

export type ViewerTool =
  | "rectangle"
  | "ellipse"
  | "line"
  | "polygon"
  | "sampler"
  | "magnifier"
  | "pan";

export type ViewerCommand =
  | `tool.${ViewerTool}`
  | "computeStatistics"
  | "autoContrast"
  | "clearSelection"
  | "fitToWindow"
  | "actualPixels"
  | "zoomIn"
  | "zoomOut"
  | "nextSlice"
  | "previousSlice";

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "getOverview"; sliceIndex: number; generation: number; requestId: number }
  | { type: "getTiles"; requests: ImageTileRequest[] }
  | { type: "computeHistogram"; request: HistogramRequest }
  | { type: "computeStatistics"; request: StatisticsRequest }
  | { type: "samplePixel"; request: SamplePixelRequest };

export interface ViewerSettings {
  localCacheMB: number;
  tileSize: number;
  automaticHistogramPixelLimit: number;
}

export type HostToWebviewMessage =
  | { type: "metadata"; metadata: ImageMetadata; settings: ViewerSettings }
  | { type: "overview"; tile: ImageTile }
  | { type: "tile"; tile: ImageTile }
  | { type: "histogram"; result: HistogramResult }
  | { type: "statistics"; result: StatisticsResult }
  | { type: "sample"; result: SamplePixelResult }
  | { type: "command"; command: ViewerCommand }
  | { type: "error"; requestId?: number; message: string; details?: string };

export interface ScientificImageDataSource {
  getMetadata(): Promise<ImageMetadata>;
  getOverview(sliceIndex: number): Promise<ImageTile>;
  getTile(request: ImageTileRequest): Promise<ImageTile>;
  computeHistogram(request: HistogramRequest): Promise<HistogramResult>;
  computeStatistics(request: StatisticsRequest): Promise<StatisticsResult>;
  samplePixel(request: SamplePixelRequest): Promise<SamplePixelResult>;
  dispose(): Promise<void>;
}

export const DTYPE_BYTES: Record<NumericDType, number> = {
  bool: 1,
  uint8: 1,
  uint16: 2,
  uint32: 4,
  int8: 1,
  int16: 2,
  int32: 4,
  float32: 4,
  float64: 8,
  complex64: 8,
  complex128: 16,
};

export function isComplexDType(dtype: NumericDType): boolean {
  return dtype === "complex64" || dtype === "complex128";
}
