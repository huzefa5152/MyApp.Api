import { useState } from "react";
import { MdClose, MdLocalShipping } from "react-icons/md";
import { formStyles, modalSizes } from "../theme";

/**
 * Confirm dialog for marking a customer's printed documents (Bill + Tax
 * Invoice copies) as handed over — single bill or bulk. Collects an optional
 * remark (max 300 chars); the parent owns the actual API call via
 * onConfirm(remark) and closes on success.
 *
 * mode:
 *   • "single" — invoiceNumber is shown in the title.
 *   • "bulk"   — count is shown ("Mark N invoices delivered").
 *
 * Uses the shared responsive formStyles (backdrop scrolls, modal caps at
 * 96vh) so it never clips on a phone — CLAUDE.md §3.
 */
export default function HandoverDialog({ mode = "single", invoiceNumber, count = 0, onClose, onConfirm }) {
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isBulk = mode === "bulk";

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      await onConfirm(remark.trim() || null);
      // parent closes the dialog on success
    } catch (e) {
      setError(e?.response?.data?.error || "Could not mark delivered. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={{ ...formStyles.modal, maxWidth: modalSizes.sm }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>
            {isBulk
              ? `Mark ${count} invoice${count === 1 ? "" : "s"} delivered`
              : `Mark documents delivered · #${invoiceNumber}`}
          </h3>
          <button style={formStyles.closeButton} onClick={onClose} disabled={busy} aria-label="Close">
            <MdClose size={18} />
          </button>
        </div>

        <div style={formStyles.body}>
          <div style={{
            display: "flex", gap: 10, alignItems: "flex-start",
            background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32",
            borderRadius: 10, padding: "0.7rem 0.85rem", marginBottom: "1rem", fontSize: "0.83rem",
          }}>
            <MdLocalShipping size={20} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {isBulk
                ? `Confirm the printed customer copies (Bill + Tax Invoice) for these ${count} invoice${count === 1 ? "" : "s"} were physically handed to the customer. You can revert any of them later.`
                : "Confirm the printed customer copies (Bill + Tax Invoice) were physically handed to the customer. You can revert this later."}
            </span>
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Remark (optional)</label>
            <input
              style={formStyles.input}
              value={remark}
              maxLength={300}
              onChange={(e) => setRemark(e.target.value)}
              disabled={busy}
              placeholder="e.g. received by Ali at gate, TCS #123"
            />
          </div>

          {error && <div style={formStyles.error}>{error}</div>}
        </div>

        <div style={formStyles.footer}>
          <button style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            style={{ ...formStyles.button, ...formStyles.submit, backgroundColor: "#2e7d32", opacity: busy ? 0.6 : 1 }}
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Saving…" : isBulk ? `Mark ${count} delivered` : "Mark delivered"}
          </button>
        </div>
      </div>
    </div>
  );
}
