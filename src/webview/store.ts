import { create } from "zustand";
import type {
  ComplexDisplayMode,
  HistogramResult,
  ImageMetadata,
  SamplePixelResult,
  Selection,
  StatisticsResult,
  ViewerSettings,
  ViewerTool,
} from "../shared/types";

export interface DraftPolygon {
  vertices: Array<{ x: number; y: number }>;
  pointer?: { x: number; y: number };
}

export const DEFAULT_RANGE: [number, number] = [0, 1];

export interface ViewerOverlay {
  id: number;
  metadata: ImageMetadata;
  sliceIndex: number;
  offsetX: number;
  offsetY: number;
  transparency: number;
  ranges: Partial<Record<ComplexDisplayMode | "scalar", [number, number]>>;
  tileRevision: number;
}

export interface ViewerState {
  metadata?: ImageMetadata;
  settings: ViewerSettings;
  activeTool: ViewerTool;
  currentSlice: number;
  selection?: Selection;
  draftSelection?: Selection;
  draftPolygon?: DraftPolygon;
  sample?: SamplePixelResult;
  sampleLoading?: { x: number; y: number };
  zoom: number;
  panX: number;
  panY: number;
  viewportWidth: number;
  viewportHeight: number;
  colormap: string;
  complexMode: ComplexDisplayMode;
  ranges: Partial<Record<ComplexDisplayMode | "scalar", [number, number]>>;
  histogram?: HistogramResult;
  histogramStale: boolean;
  statistics?: StatisticsResult;
  statisticsStale: boolean;
  calculationPending?: "histogram" | "statistics";
  autoContrastPending: boolean;
  resetRangePending: boolean;
  generation: number;
  tileRevision: number;
  overlay?: ViewerOverlay;
  error?: { message: string; details?: string };
  setMetadata(metadata: ImageMetadata, settings: ViewerSettings): void;
  setTool(tool: ViewerTool): void;
  setSlice(slice: number): void;
  setSelection(selection?: Selection): void;
  setDraftSelection(selection?: Selection): void;
  setDraftPolygon(polygon?: DraftPolygon): void;
  setSample(sample?: SamplePixelResult): void;
  setSampleLoading(point?: { x: number; y: number }): void;
  setView(view: Partial<Pick<ViewerState, "zoom" | "panX" | "panY">>): void;
  setViewport(width: number, height: number): void;
  setColormap(colormap: string): void;
  setComplexMode(mode: ComplexDisplayMode): void;
  setRange(mode: ComplexDisplayMode | "scalar", range: [number, number]): void;
  setHistogram(histogram: HistogramResult): void;
  setStatistics(statistics: StatisticsResult): void;
  markCalculation(type?: "histogram" | "statistics"): void;
  setAutoContrastPending(pending: boolean): void;
  setResetRangePending(pending: boolean): void;
  bumpTiles(): void;
  setOverlay(id: number, metadata: ImageMetadata): void;
  removeOverlay(): void;
  setOverlayOffset(offsetX: number, offsetY: number): void;
  setOverlayTransparency(transparency: number): void;
  setOverlayRange(mode: ComplexDisplayMode | "scalar", range: [number, number]): void;
  bumpOverlayTiles(): void;
  setError(error?: { message: string; details?: string }): void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  settings: { localCacheMB: 256, tileSize: 256, automaticHistogramPixelLimit: 1_000_000 },
  activeTool: "pan",
  currentSlice: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  viewportWidth: 0,
  viewportHeight: 0,
  colormap: "gray",
  complexMode: "magnitude",
  ranges: { phase: [-Math.PI, Math.PI] },
  histogramStale: true,
  statisticsStale: false,
  autoContrastPending: false,
  resetRangePending: false,
  generation: 1,
  tileRevision: 0,
  setMetadata: (metadata, settings) =>
    set({ metadata, settings, currentSlice: 0, error: undefined, histogramStale: true }),
  setTool: (activeTool) => set({ activeTool, draftSelection: undefined, draftPolygon: undefined }),
  setSlice: (slice) => {
    const metadata = get().metadata;
    const currentSlice = metadata
      ? Math.max(0, Math.min(metadata.sliceCount - 1, Math.round(slice)))
      : 0;
    if (currentSlice === get().currentSlice) return;
    set((state) => ({
      currentSlice,
      sample: undefined,
      sampleLoading: undefined,
      histogramStale: true,
      statisticsStale: Boolean(state.statistics),
      generation: state.generation + 1,
    }));
  },
  setSelection: (selection) =>
    set((state) => ({
      selection,
      draftSelection: undefined,
      draftPolygon: undefined,
      histogramStale: true,
      statisticsStale: Boolean(state.statistics),
    })),
  setDraftSelection: (draftSelection) => set({ draftSelection }),
  setDraftPolygon: (draftPolygon) => set({ draftPolygon }),
  setSample: (sample) => set({ sample, sampleLoading: undefined }),
  setSampleLoading: (sampleLoading) => set({ sampleLoading }),
  setView: (view) => set((state) => ({ ...view, generation: state.generation + 1 })),
  setViewport: (viewportWidth, viewportHeight) => {
    const state = get();
    if (state.viewportWidth === viewportWidth && state.viewportHeight === viewportHeight) return;
    set({ viewportWidth, viewportHeight, generation: state.generation + 1 });
  },
  setColormap: (colormap) => set({ colormap }),
  setComplexMode: (complexMode) =>
    set({ complexMode, histogramStale: true, statisticsStale: Boolean(get().statistics) }),
  setRange: (mode, range) => set((state) => ({ ranges: { ...state.ranges, [mode]: range } })),
  setHistogram: (histogram) => {
    const mode = get().metadata?.isComplex ? get().complexMode : "scalar";
    const existing = get().ranges[mode];
    const range = stableRange(histogram.minimum, histogram.maximum);
    set((state) => ({
      histogram,
      histogramStale: false,
      calculationPending: state.calculationPending === "histogram" ? undefined : state.calculationPending,
      ranges: existing ? state.ranges : { ...state.ranges, [mode]: range },
    }));
  },
  setStatistics: (statistics) =>
    set({ statistics, statisticsStale: false, calculationPending: undefined }),
  markCalculation: (calculationPending) => set({ calculationPending }),
  setAutoContrastPending: (autoContrastPending) => set({ autoContrastPending }),
  setResetRangePending: (resetRangePending) => set({ resetRangePending }),
  bumpTiles: () => set((state) => ({ tileRevision: state.tileRevision + 1 })),
  setOverlay: (id, metadata) =>
    set((state) => ({
      overlay: {
        id,
        metadata,
        sliceIndex: 0,
        offsetX: 0,
        offsetY: 0,
        transparency: 50,
        ranges: {},
        tileRevision: 0,
      },
      generation: state.generation + 1,
    })),
  removeOverlay: () => set((state) => ({ overlay: undefined, generation: state.generation + 1 })),
  setOverlayOffset: (offsetX, offsetY) =>
    set((state) => ({
      overlay: state.overlay ? { ...state.overlay, offsetX, offsetY } : undefined,
      generation: state.generation + 1,
    })),
  setOverlayTransparency: (transparency) =>
    set((state) => ({
      overlay: state.overlay
        ? { ...state.overlay, transparency: Math.max(0, Math.min(100, transparency)) }
        : undefined,
    })),
  setOverlayRange: (mode, range) =>
    set((state) => ({
      overlay: state.overlay
        ? { ...state.overlay, ranges: { ...state.overlay.ranges, [mode]: range } }
        : undefined,
    })),
  bumpOverlayTiles: () =>
    set((state) => ({
      overlay: state.overlay
        ? { ...state.overlay, tileRevision: state.overlay.tileRevision + 1 }
        : undefined,
    })),
  setError: (error) => set({ error, calculationPending: undefined, sampleLoading: undefined }),
}));

export function stableRange(lower: number, upper: number): [number, number] {
  if (Number.isFinite(lower) && Number.isFinite(upper) && upper > lower) return [lower, upper];
  const center = Number.isFinite(lower) ? lower : Number.isFinite(upper) ? upper : 0;
  const padding = Math.max(Math.abs(center) * 1e-6, 1e-6);
  return [center - padding, center + padding];
}
