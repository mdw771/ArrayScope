import { useEffect, useRef, useState } from "react";
import type { PixelTransform } from "../shared/types";
import { applyTransform } from "./controller";

type BinaryOperation = Extract<PixelTransform, { operand: number }>["operation"];
const labels: Record<BinaryOperation, string> = {
  add: "Add", subtract: "Subtract", multiply: "Multiply", divide: "Divide",
};
const expressions: Record<BinaryOperation, string> = {
  add: "pixel + operand", subtract: "pixel − operand", multiply: "pixel × operand", divide: "pixel ÷ operand",
};

export function TransformOperandDialog({ operation, onClose }: { operation: BinaryOperation; onClose(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [operand, setOperand] = useState(operation === "add" || operation === "subtract" ? "0" : "1");
  const [error, setError] = useState<string>();
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    inputRef.current?.select();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={dialogRef} className="transform-dialog" aria-labelledby="transform-title" onCancel={onClose}>
      <form onSubmit={(event) => {
        event.preventDefault();
        const value = Number(operand);
        if (!operand.trim() || !Number.isFinite(value)) {
          setError("Enter a finite number.");
          inputRef.current?.focus();
          return;
        }
        if (operation === "divide" && value === 0) {
          setError("The divisor must not be zero.");
          inputRef.current?.focus();
          return;
        }
        applyTransform({ operation, operand: value });
        onClose();
      }}>
        <h2 id="transform-title">{labels[operation]}</h2>
        <p id="transform-description">Apply {expressions[operation]} to every pixel.</p>
        <label htmlFor="transform-operand">Operand</label>
        <input ref={inputRef} id="transform-operand" type="text" inputMode="decimal" autoFocus
          value={operand} onChange={(event) => { setOperand(event.target.value); setError(undefined); }}
          aria-describedby={error ? "transform-description transform-error" : "transform-description"}
          aria-invalid={Boolean(error)} />
        {error && <p id="transform-error" role="alert">{error}</p>}
        <div className="transform-dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Apply</button>
        </div>
      </form>
    </dialog>
  );
}
