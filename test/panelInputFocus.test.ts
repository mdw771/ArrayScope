import { describe, expect, it } from "vitest";
import { PanelInputFocusTracker } from "../src/host/panelInputFocus";

describe("viewer input focus", () => {
  it("tracks focused inputs independently for each editor panel", () => {
    const tracker = new PanelInputFocusTracker<object>();
    const firstPanel = {};
    const secondPanel = {};

    tracker.update(firstPanel, true);
    expect(tracker.hasFocus(firstPanel)).toBe(true);
    expect(tracker.hasFocus(secondPanel)).toBe(false);

    tracker.update(firstPanel, false);
    expect(tracker.hasFocus(firstPanel)).toBe(false);
  });

  it("clears focus state when an editor panel is disposed", () => {
    const tracker = new PanelInputFocusTracker<object>();
    const panel = {};
    tracker.update(panel, true);

    tracker.delete(panel);

    expect(tracker.hasFocus(panel)).toBe(false);
  });
});
