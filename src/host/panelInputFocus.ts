export class PanelInputFocusTracker<T> {
  readonly #focusedPanels = new Set<T>();

  update(panel: T, focused: boolean): void {
    if (focused) this.#focusedPanels.add(panel);
    else this.#focusedPanels.delete(panel);
  }

  delete(panel: T): void {
    this.#focusedPanels.delete(panel);
  }

  hasFocus(panel: T): boolean {
    return this.#focusedPanels.has(panel);
  }
}
