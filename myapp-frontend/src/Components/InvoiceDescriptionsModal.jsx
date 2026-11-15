import { useState } from "react";
import { MdClose, MdInfoOutline } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import { updateInvoiceLineDescriptions } from "../api/invoiceApi";

/**
 * Change only the line descriptions of an invoice already filed with FBR
 * (importer, 2026-11-16). Edit is closed once an invoice is filed; FBR is sent
 * a blank description, so the wording can still be corrected without touching
 * the filing. Items, quantities, prices, totals and stock are shown read-only.
 *
 * The server is the authority: bills.manage.update, the invoice's company and
 * division, a filed invoice, and its own lines only.
 */

const MAX = 1000;
const qty = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const money = (v) =>
  Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InvoiceDescriptionsModal({
  invoice,
  docName = "Invoice",
  onClose,
  onDone,
}) {
  const lines = invoice.items || [];
  const [text, setText] = useState(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.description || ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const changed = lines.filter((l) => (text[l.id] ?? "").trim() !== (l.description || "").trim());

  const save = async () => {
    setError("");
    if (changed.length === 0) return onClose();
    setBusy(true);
    try {
      await updateInvoiceLineDescriptions(
        invoice.id,
        changed.map((l) => ({ invoiceItemId: l.id, description: (text[l.id] ?? "").trim() })),
      );
      onDone?.(changed.length);
    } catch (e) {
      setError(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "The descriptions could not be saved. Try again.",
      );
      setBusy(false);
    }
  };

  return (
    <div
      style={formStyles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        style={{ ...formStyles.modal, maxWidth: modalSizes.lg }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>
            Edit descriptions · {docName} #{invoice.invoiceNumber}
          </h3>
          <button
            style={formStyles.closeButton}
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <MdClose size={18} />
          </button>
        </div>

        <div style={formStyles.body}>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              borderRadius: 10,
              padding: "0.7rem 0.85rem",
              marginBottom: "1rem",
              fontSize: "0.83rem",
              background: colors.infoSoft,
              border: `1px solid ${colors.infoLine}`,
              color: colors.infoInk,
            }}
          >
            <MdInfoOutline size={20} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              This {docName.toLowerCase()} is filed with FBR, so only the <b>line descriptions</b>{" "}
              can change. FBR is not sent descriptions, so the filing stays as it is. Items,
              quantities, prices and totals do not change. A description left blank shows the item's
              name.
            </span>
          </div>

          {lines.length === 0 && (
            <p style={{ color: colors.textSecondary }}>
              This {docName.toLowerCase()} has no lines.
            </p>
          )}

          {lines.map((l, i) => (
            <div
              key={l.id}
              style={{
                ...formStyles.formGroup,
                borderTop: i ? `1px solid ${colors.cardBorder}` : "none",
                paddingTop: i ? "0.75rem" : 0,
              }}
            >
              <label style={formStyles.label} htmlFor={`desc-${l.id}`}>
                Line {i + 1}
                {(l.itemTypeName || l.nonInventoryItemName) && (
                  <span style={{ fontWeight: 400, color: colors.textSecondary }}>
                    {" · "}
                    {l.itemTypeName || l.nonInventoryItemName}
                  </span>
                )}
              </label>
              <div
                style={{ fontSize: "0.78rem", color: colors.textSecondary, margin: "0 0 0.35rem" }}
              >
                {qty(l.quantity)} {l.uom} × {money(l.unitPrice)} = Rs. {money(l.lineTotal)}
              </div>
              <textarea
                id={`desc-${l.id}`}
                style={{ ...formStyles.input, minHeight: 56, resize: "vertical" }}
                value={text[l.id] ?? ""}
                maxLength={MAX}
                disabled={busy}
                onChange={(e) => setText((t) => ({ ...t, [l.id]: e.target.value }))}
              />
            </div>
          ))}

          {error && <div style={formStyles.error}>{error}</div>}
        </div>

        <div style={formStyles.footer}>
          <button
            style={{ ...formStyles.button, ...formStyles.cancel }}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            style={{
              ...formStyles.button,
              ...formStyles.submit,
              opacity: busy || changed.length === 0 ? 0.6 : 1,
            }}
            onClick={save}
            disabled={busy || changed.length === 0}
          >
            {busy
              ? "Saving…"
              : changed.length
                ? `Save ${changed.length} description${changed.length === 1 ? "" : "s"}`
                : "No changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
