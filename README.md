# ArrayScope Scientific Image Viewer

ArrayScope is a read-only VS Code custom editor for scientific NPY and TIFF images. It runs entirely in TypeScript, JavaScript, and WebGL—no Python, Conda, Jupyter kernel, or project runtime is started.

## Features

- NPY 1.0, 2.0, and 3.0 headers; boolean, signed/unsigned integer, `float32`, `float64`, `complex64`, and `complex128` values.
- C-order and correctness-first Fortran-order region reads, including big-endian conversion.
- Grayscale integer and floating-point TIFF through a replaceable `TiffImageDataSource` backed by `geotiff`.
- 2D images and 3D/multipage stacks with overview prefetch and slice navigation.
- Progressive numeric tiles; files are decoded on the extension host while numeric rendering and interaction stay in the local webview.
- WebGL2 display-range and colormap changes without re-decoding source data.
- Synchronized magnitude and phase panels for complex arrays, with magnitude, phase, real, imaginary, log-magnitude, and magnitude-squared analysis modes.
- Rectangle, ellipse, line, polygon, sampler, magnifier, and pan tools.
- Selection-aware histogram, 1st/99th percentile auto contrast, and remote statistics.
- Exact click sampling from a cached full-resolution tile or one high-priority extension-host request.
- VS Code theme colors, accessible controls, commands, and configurable keyboard shortcuts.

## Use

Open a `.npy`, `.tif`, or `.tiff` file. If VS Code does not select ArrayScope automatically, run **Reopen Editor With… → ArrayScope Scientific Image Viewer**.

The viewer never writes to the source. A selection scopes histogram, auto contrast, and the next explicit statistics calculation. Without a selection, all three operations use the entire current slice. The initial dynamic range uses the finite minimum and maximum; **Auto Contrast** applies the active scope's 1st and 99th percentiles, and **Reset** restores its finite minimum and maximum. Changing slices preserves selection geometry and clears the current sample marker.

Complex images always show synchronized Magnitude and Phase panels. The **Analysis transform** selector controls which representation is used by the histogram, auto contrast, and statistics.

## Remote workspaces

The extension declares itself as a workspace extension. Under Remote SSH, WSL, and dev containers:

- the extension host opens and decodes the file near remote storage;
- NPY data use positional row/column reads for requested levels and tiles;
- the webview receives progressive numeric tiles and renders them locally;
- the complete source array is not transferred by default.

Remote SSH files normally use a `file` URI on the remote extension host and therefore retain positional reads. Non-file VS Code file systems fall back to `workspace.fs`; to avoid unsafe allocations, that fallback refuses files larger than 256 MiB when the provider cannot expose range reads.

## Settings

```json
{
  "scientificImageViewer.localCacheMB": 256,
  "scientificImageViewer.remoteCacheMB": 512,
  "scientificImageViewer.tileSize": 256
}
```

The local limit applies to numeric tiles in each webview. The remote limit applies to decoded tiles held by an open data source.

## Supported data and current boundaries

NPY arrays are scalar scientific data; dimensions of size 3 or 4 are not inferred as RGB/RGBA. Scalars show their value, 1D arrays and arrays above 3D show an explicit dimensionality message, and `[slice, y, x]` is used for 3D stacks. Object and variable-length dtypes are rejected.

TIFF support is intentionally grayscale-only in this release. Pages must match the first page's dimensions and sample type to participate in a stack. Compression support is the set decoded by the packaged `geotiff` build. The source file is never used as a cache target.

The current implementation keeps TIFF strip/tile caching in memory. A persistent, invalidation-keyed remote TIFF pyramid cache and exhaustive performance qualification on multi-gigabyte Remote SSH fixtures remain release-hardening work.

## Development

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run typecheck
npm test
npm run build
```

Press `F5` from VS Code after building to launch an Extension Development Host, or run:

```bash
npm run test:integration
npm run package
```

`test:integration` downloads a matching VS Code test build on first use. `package` produces a VSIX after type checking, unit tests, and bundling.

## Architecture

- `src/extension.ts`: read-only custom editor, request scheduling, commands, and webview lifecycle.
- `src/host/`: validated readers, NPY/TIFF data sources, selection scan conversion consumers, caches, histogram, and statistics.
- `src/shared/`: format-independent protocol, data model, geometry, and transforms.
- `src/webview/`: React state, progressive tile controller, WebGL2 renderer, overlays, tools, and analysis panels.
- `test/`: deterministic parser/geometry/numerical tests, a browser webview harness, and VS Code extension-host smoke tests.

Every tile response carries a request ID and viewport generation. The webview rejects stale visible-tile responses after slice or selection-generation changes. Calculations operate on scanline runs so large selections do not require a complete Boolean mask.

## Numerical definitions

Statistics use population variance and standard deviation. Ordinary kurtosis is reported (a normal distribution has kurtosis 3). Mean, variance, and fourth central moment use online updates. NaN, positive infinity, and negative infinity are excluded from finite statistics and reported separately. Median and histogram samples are marked approximate after their bounded reservoir thresholds.

Polygon selection uses the even-odd fill rule. One-pixel lines use Bresenham rasterization.

## Security and failure behavior

NPY headers, shapes, payload sizes, offsets, tile bounds, and request batch sizes are validated before allocation or reading. Source size and modification time are checked while an editor is open. Decoder and parsing errors are posted into the custom editor with expandable technical details instead of crashing the extension host.
