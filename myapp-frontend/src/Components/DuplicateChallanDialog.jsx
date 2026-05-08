// Tiny modal that asks "How many copies?" before firing the duplicate
// request. Default 1, capped at 20 (matches the server-side hard cap in
// DeliveryChallanService.DuplicateAsync). Returns a Promise<number|null>:
//   • resolves to the chosen count (1..20) on Confirm
//   • resolves to null on Cancel / backdrop / Esc
//
// 2026-05-08 ChallanPage UX:
//   Pre-fix the operator had to click Duplicate N times. The first click
//   often had latency, and double-clicks fired two requests. This dialog
//   plus the existing duplicatingId in-flight guard kills both problems.
import { useState, useEffect, useRef } from "react";
import { MdContentCopy } from "react-icons/md";
import { formStyles, modalSizes } from "../theme";

export default function DuplicateChallanDialog({ open, challanNumber, onConfirm, onCancel }) {
  const [count, setCount] = useState(1);
  const inputRef = useRef(null);

  // Reset to default whenever the dialog re-opens for a different challan,
  // and auto-focus the input so the operator can type a number immediately.
  useEffect(() => {
    if (open) {
      setCount(1);
      // Defer focus so the input element exists by the time we ask for it.
      const id = setTimeout(() => inputRef.current?.select(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  if (!open) return null;

  const clamp = (n) => {
    if (!Number.isFinite(n)) return 1;
    if (n < 1) return 1;
    if (n > 20) return 20;
    return Math.floor(n);
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    onConfirm(clamp(count));
  };

  return (
    <div
      style={{ ...formStyles.backdrop, zIndex: 1102, animation: "fadeIn 0.2s ease" }}
      // No backdrop-close — keeps the operator's intent unambiguous.
    >
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.sm}px`, animation: "fadeIn 0.25s ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 28 }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: "50%", background: "#ede7f6",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <MdContentCopy size={28} color="#4527a0" />
          </div>
        </div>

        <div style={{ padding: "16px 28px 4px", textAlign: "center" }}>
          <h3 style={{ margin: "0 0 8px", fontSize: "1.15rem", fontWeight: 700, color: "#1a2332" }}>
            Duplicate Challan #{challanNumber}?
          </h3>
          <p style={{ margin: 0, fontSize: "0.88rem", color: "#5f6d7e", lineHeight: 1.5 }}>
            How many copies should be created? Each copy reuses the same challan
            number and can be edited (PO, items) independently.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ padding: "12px 28px 4px", display: "flex", justifyContent: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => setCount((c) => clamp((+c || 1) - 1))}
                aria-label="Decrease"
                style={S.stepBtn}
              >−</button>
              <input
                ref={inputRef}
                type="number"
                min={1}
                max={20}
                step={1}
                value={count}
                onChange={(e) => setCount(e.target.value === "" ? "" : Number(e.target.value))}
                onBlur={() => setCount((c) => clamp(+c))}
                style={S.input}
              />
              <button
                type="button"
                onClick={() => setCount((c) => clamp((+c || 1) + 1))}
                aria-label="Increase"
                style={S.stepBtn}
              >+</button>
            </div>
          </div>
          <div style={{ textAlign: "center", fontSize: "0.75rem", color: "#98a4b3", padding: "0 28px 4px" }}>
            Maximum 20 per request.
          </div>

          <div style={{ display: "flex", gap: 10, padding: "16px 28px 24px", justifyContent: "center" }}>
            <button
              type="button"
              onClick={onCancel}
              style={S.cancelBtn}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={S.confirmBtn}
            >
              {clamp(+count) === 1 ? "Create 1 copy" : `Create ${clamp(+count)} copies`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const S = {
  stepBtn: {
    width: 36, height: 36, borderRadius: 8, border: "1px solid #d0d7e2",
    background: "#fff", color: "#1a2332", fontWeight: 700, fontSize: "1.1rem",
    cursor: "pointer",
  },
  input: {
    width: 84, height: 36, padding: "0 10px", borderRadius: 8,
    border: "1px solid #d0d7e2", background: "#fff",
    color: "#1a2332", fontSize: "1.1rem", fontWeight: 700, textAlign: "center",
    outline: "none",
  },
  cancelBtn: {
    flex: 1, padding: "10px 20px", borderRadius: 10, border: "1px solid #d0d7e2",
    background: "#fff", color: "#1a2332", fontWeight: 600, fontSize: "0.9rem",
    cursor: "pointer",
  },
  confirmBtn: {
    flex: 1, padding: "10px 20px", borderRadius: 10, border: "none",
    background: "#4527a0", color: "#fff", fontWeight: 600, fontSize: "0.9rem",
    cursor: "pointer",
  },
};
