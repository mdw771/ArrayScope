import { useEffect, useRef, useState } from "react";
import type { MenuAction } from "../shared/types";
import {
  autoContrast,
  executeViewerCommand,
  requestHistogram,
  requestMenuAction,
  requestStatistics,
  resetDynamicRange,
} from "./controller";
import { useViewerStore } from "./store";

type MenuName = "file" | "view" | "tools" | "help";

interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  action(): void;
}

interface MenuDefinition {
  name: MenuName;
  label: string;
  items: MenuItem[];
}

const menuOrder: MenuName[] = ["file", "view", "tools", "help"];

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<MenuName>();
  const rootRef = useRef<HTMLElement>(null);
  const hasImage = useViewerStore((state) => Boolean(state.metadata));

  useEffect(() => {
    if (!openMenu) return;
    const closeFromOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(undefined);
    };
    const closeFromEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpenMenu(undefined);
      focusTrigger(openMenu);
    };
    window.addEventListener("pointerdown", closeFromOutside);
    window.addEventListener("keydown", closeFromEscape);
    return () => {
      window.removeEventListener("pointerdown", closeFromOutside);
      window.removeEventListener("keydown", closeFromEscape);
    };
  }, [openMenu]);

  const hostAction = (action: MenuAction): (() => void) => () => requestMenuAction(action);
  const menus: MenuDefinition[] = [
    {
      name: "file",
      label: "File",
      items: [
        { label: "Open", action: hostAction("open") },
        { label: "Open in New Tab", action: hostAction("openInNewTab") },
        { label: "Settings", separatorBefore: true, action: hostAction("settings") },
        { label: "Close", separatorBefore: true, action: hostAction("close") },
      ],
    },
    {
      name: "view",
      label: "View",
      items: [
        {
          label: "Zoom In",
          shortcut: "=",
          disabled: !hasImage,
          action: () => executeViewerCommand("zoomIn"),
        },
        {
          label: "Zoom Out",
          shortcut: "−",
          disabled: !hasImage,
          action: () => executeViewerCommand("zoomOut"),
        },
      ],
    },
    {
      name: "tools",
      label: "Tools",
      items: [
        {
          label: "Calculate Statistics",
          disabled: !hasImage,
          action: requestStatistics,
        },
        {
          label: "Auto-Contrast",
          disabled: !hasImage,
          separatorBefore: true,
          action: autoContrast,
        },
        {
          label: "Reset Contrast",
          disabled: !hasImage,
          action: resetDynamicRange,
        },
        {
          label: "Recalculate Histogram",
          disabled: !hasImage,
          action: requestHistogram,
        },
      ],
    },
    {
      name: "help",
      label: "Help",
      items: [
        { label: "Source Code on GitHub", action: hostAction("sourceCode") },
        { label: "Report an Issue", action: hostAction("reportIssue") },
      ],
    },
  ];

  const openAndFocus = (name: MenuName): void => {
    setOpenMenu(name);
    window.requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLButtonElement>(`[data-menu="${name}"] [role="menuitem"]:not(:disabled)`)
        ?.focus();
    });
  };

  const moveToMenu = (name: MenuName, offset: number): void => {
    const index = menuOrder.indexOf(name);
    const next = menuOrder[(index + offset + menuOrder.length) % menuOrder.length]!;
    if (openMenu) openAndFocus(next);
    else focusTrigger(next);
  };

  return (
    <nav ref={rootRef} className="menu-bar" role="menubar" aria-label="ArrayScope menu bar">
      {menus.map((menu) => (
        <div
          className="menu-root"
          data-menu={menu.name}
          key={menu.name}
          onMouseEnter={() => openMenu && setOpenMenu(menu.name)}
        >
          <button
            type="button"
            className={`menu-trigger ${openMenu === menu.name ? "open" : ""}`}
            role="menuitem"
            data-menu-trigger={menu.name}
            aria-haspopup="menu"
            aria-expanded={openMenu === menu.name}
            onClick={() => setOpenMenu(openMenu === menu.name ? undefined : menu.name)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                openAndFocus(menu.name);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveToMenu(menu.name, -1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                moveToMenu(menu.name, 1);
              }
            }}
          >
            {menu.label}
          </button>
          {openMenu === menu.name && (
            <div
              className="menu-popup"
              role="menu"
              aria-label={menu.label}
              onKeyDown={(event) => handlePopupKeyDown(event, () => setOpenMenu(undefined))}
            >
              {menu.items.map((item) => (
                <div key={item.label}>
                  {item.separatorBefore && <div className="menu-separator" role="separator" />}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpenMenu(undefined);
                      item.action();
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

function focusTrigger(name: MenuName): void {
  document.querySelector<HTMLButtonElement>(`[data-menu-trigger="${name}"]`)?.focus();
}

function handlePopupKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  close: () => void,
): void {
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
  );
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  let nextIndex: number | undefined;
  if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
  else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = items.length - 1;
  else if (event.key === "Tab") close();
  if (nextIndex === undefined || items.length === 0) return;
  event.preventDefault();
  items[nextIndex]?.focus();
}
