import { useRef, useState, type PointerEvent, type ReactNode } from "react";

interface WindowDrag {
  pointerId: number;
  clientX: number;
  clientY: number;
  left: number;
  top: number;
}

interface FloatingWindowProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  closeLabel: string;
  initialPosition?: { left: number; top: number };
  onClose(): void;
  title: ReactNode;
  titleTooltip?: string;
}

export function FloatingWindow({
  ariaLabel,
  children,
  className,
  closeLabel,
  initialPosition = { left: 16, top: 16 },
  onClose,
  title,
  titleTooltip,
}: FloatingWindowProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<WindowDrag | undefined>(undefined);
  const [position, setPosition] = useState(initialPosition);

  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      left: position.left,
      top: position.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveWindow = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const root = rootRef.current;
    const parent = root?.parentElement;
    if (!drag || !root || !parent || drag.pointerId !== event.pointerId) return;
    setPosition({
      left: Math.max(
        0,
        Math.min(parent.clientWidth - root.offsetWidth, drag.left + event.clientX - drag.clientX),
      ),
      top: Math.max(
        0,
        Math.min(parent.clientHeight - root.offsetHeight, drag.top + event.clientY - drag.clientY),
      ),
    });
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
  };

  return (
    <div
      ref={rootRef}
      className={`floating-window${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-label={ariaLabel}
      style={position}
    >
      <div
        className="floating-window-title"
        onPointerDown={startDrag}
        onPointerMove={moveWindow}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <span title={titleTooltip}>{title}</span>
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >×</button>
      </div>
      {children}
    </div>
  );
}
