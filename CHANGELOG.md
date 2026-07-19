# Changelog

## 0.1.0

- Initial read-only NPY and grayscale TIFF custom editor.
- Progressive extension-host overview/tile protocol and bounded local/remote caches.
- WebGL2 scalar and synchronized complex rendering.
- Selection, sampling, stack navigation, histograms, auto contrast, and statistics.
- Unit, browser-harness, and VS Code extension-host smoke tests.

## 0.2.0

- Added a VS Code-themed menu bar with File, View, Tools, and Help actions.
- Added manual image registration using draggable, progressively tiled NPY/TIFF overlays with transparency and position controls.
- Added full-resolution line profile plots with one-pixel sampling and linear interpolation; complex images display both magnitude and phase. Use `Ctrl+K` (`Cmd+K` on macOS).
- Added live selection measurements, including bounds and dimensions for areas, ellipse centers, and line endpoints, length, and angle.
- Added more keyboard shortcuts.
- Added a Help item to show all available keyboard shortcuts. 