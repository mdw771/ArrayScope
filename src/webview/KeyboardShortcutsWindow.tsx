import { FloatingWindow } from "./FloatingWindow";
import { useViewerStore } from "./store";

interface Shortcut {
  keys: string[];
  action: string;
  gesture?: string;
}

interface ShortcutGroup {
  label: string;
  shortcuts: Shortcut[];
}

export function keyboardShortcutGroups(isMac: boolean): ShortcutGroup[] {
  const primaryModifier = isMac ? "⌘" : "Ctrl";
  return [
    {
      label: "Selection tools",
      shortcuts: [
        { keys: ["R"], action: "Rectangle selection" },
        { keys: ["E"], action: "Ellipse selection" },
        { keys: ["L"], action: "Line selection" },
        { keys: ["P"], action: "Polygon selection" },
        { keys: ["I"], action: "Sample a pixel" },
        { keys: ["Z"], action: "Magnifier tool" },
        { keys: ["H"], action: "Pan tool" },
      ],
    },
    {
      label: "View and navigation",
      shortcuts: [
        { keys: ["Space"], gesture: "drag", action: "Pan temporarily without changing tools" },
        { keys: ["-"], action: "Zoom out" },
        { keys: ["="], action: "Zoom in" },
        { keys: ["F"], action: "Fit image to window" },
        { keys: ["1"], action: "Show actual pixels (1:1)" },
        { keys: ["["], action: "Previous slice" },
        { keys: ["]"], action: "Next slice" },
      ],
    },
    {
      label: "Analysis",
      shortcuts: [
        { keys: [primaryModifier, "T"], action: "Calculate statistics" },
        { keys: [primaryModifier, "K"], action: "Plot the current line selection's pixel profile" },
        { keys: [primaryModifier, "Alt", "Backspace"], action: "Clear selection" },
      ],
    },
  ];
}

export function KeyboardShortcutsWindow() {
  const open = useViewerStore((state) => state.keyboardShortcutsOpen);
  const close = useViewerStore((state) => state.closeKeyboardShortcuts);
  if (!open) return null;

  const groups = keyboardShortcutGroups(navigator.userAgent.includes("Mac"));
  return (
    <FloatingWindow
      className="keyboard-shortcuts-window"
      ariaLabel="Keyboard shortcuts"
      closeLabel="Close keyboard shortcuts"
      focusCloseButton
      initialPosition={{ left: 48, top: 48 }}
      onClose={close}
      title="Keyboard Shortcuts"
    >
      <div className="keyboard-shortcuts-content">
        <p>Available while an ArrayScope editor is active and a text input or terminal is not focused.</p>
        {groups.map((group) => (
          <section key={group.label} aria-labelledby={`shortcut-${group.label.toLowerCase().replaceAll(" ", "-")}`}>
            <h3 id={`shortcut-${group.label.toLowerCase().replaceAll(" ", "-")}`}>{group.label}</h3>
            <dl>
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.action}>
                  <dt>
                    {shortcut.keys.map((key, index) => (
                      <span key={`${key}-${index}`}>
                        {index > 0 && <span className="shortcut-separator">+</span>}
                        <kbd>{key}</kbd>
                      </span>
                    ))}
                    {shortcut.gesture && <span className="shortcut-gesture"> + {shortcut.gesture}</span>}
                  </dt>
                  <dd>{shortcut.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </FloatingWindow>
  );
}
