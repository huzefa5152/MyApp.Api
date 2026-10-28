import { useMemo, useState } from "react";
import { MdClose, MdInfoOutline } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import { resetFbrSubmission } from "../api/fbrApi";
import { stockGroups } from "../utils/invoiceActions";
import { StockChoiceList } from "./ManualFilingStep";

/**
 * Record that an invoice was filed BY HAND on FBR's portal (importer,
 * 2026-10-28). Calls the reset-submission valve in mode "recordManual": the
 * invoice is marked filed with no IRN, keeps the portal's invoice number, is
 * never sent to FBR from here again, and stays editable so its date or lines
 * can be corrected. Never contacts FBR; audited with the reason.
 *
 * The server is the authority: invoices.fbr.reset, the invoice's company, and
 * only an invoice that has not been sent to FBR (the caller renders this for
 * holders of the key, on such invoices only).
 *
 * Stock: the goods left stock when the invoice was saved. A filing made by
 * hand may cover goods the operator does not want deducted, so each HS code
 * on the invoice gets a "take out of stock" choice (default: yes). The ones
 * left unticked go to the server as keepInStockHsCodes.
 */

export default function FbrRecordManualModal({ invoice, trackStock = true, onClose, onDone }) {
  const groups = useMemo(() => (trackStock ? stockGroups(invoice.items) : []), [invoice, trackStock]);
  const [deduct, setDeduct] = useState(() => Object.fromEntries(groups.map((g) => [g.code, !g.keep])));
  const [portalNumber, setPortalNumber] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!portalNumber.trim()) return setError("Enter the invoice number you used on FBR's portal.");
    if (!reason.trim()) return setError("A reason is required — it is written to the audit log.");
    setBusy(true);
    try {
      await resetFbrSubmission(invoice.id, {
        mode: "recordManual",
        manualFbrInvoiceNumber: portalNumber.trim(),
        keepInStockHsCodes: groups.filter((g) => !deduct[g.code]).map((g) => g.code),
        reason: reason.trim(),
      });
      onDone?.();
    } catch (e) {
      setError(e?.response?.data?.message || e?.response?.data?.Message ||
        "It could not be recorded. Check your permissions and try again.");
      setBusy(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={{ ...formStyles.modal, maxWidth: modalSizes.md }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>Filed on FBR portal · Invoice #{invoice.invoiceNumber}</h3>
          <button style={formStyles.closeButton} onClick={onClose} disabled={busy} aria-label="Close">
            <MdClose size={18} />
          </button>
        </div>

        <div style={formStyles.body}>
          <div style={{
            display: "flex", gap: 10, alignItems: "flex-start", borderRadius: 10, padding: "0.7rem 0.85rem",
            marginBottom: "1rem", fontSize: "0.83rem",
            background: colors.infoSoft, border: `1px solid ${colors.infoLine}`, color: colors.infoInk,
          }}>
            <MdInfoOutline size={20} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Use this only when the invoice was <b>already filed by hand on FBR's portal</b>. It is marked
              filed (with no IRN) and is <b>never sent to FBR from here</b>. You can still edit it here;
              edits are not sent to FBR.
            </span>
          </div>

          {groups.length > 0 && (
            <fieldset style={{ border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.65rem 0.85rem 0.4rem", margin: "0 0 1rem", minWidth: 0 }}>
              <legend style={{ ...formStyles.label, padding: "0 0.3rem", margin: 0 }}>Stock</legend>
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: colors.textSecondary }}>
                These goods left stock when the invoice was saved. Untick an HS code to put its goods back in stock.
              </p>
              <StockChoiceList
                groups={groups}
                isDeducted={(code) => !!deduct[code]}
                onToggle={(code, on) => setDeduct((d) => ({ ...d, [code]: on }))}
                disabled={busy}
              />
            </fieldset>
          )}

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Invoice number used on FBR's portal *</label>
            <input style={formStyles.input} value={portalNumber} maxLength={100} disabled={busy}
              onChange={(e) => setPortalNumber(e.target.value)} placeholder="As typed on the portal, e.g. ABC-123" />
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Reason (audited) *</label>
            <textarea
              style={{ ...formStyles.input, minHeight: 70, resize: "vertical" }}
              value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}
              placeholder="e.g. Filed on the portal while the FBR connection was down." />
          </div>

          {error && <div style={formStyles.error}>{error}</div>}
        </div>

        <div style={formStyles.footer}>
          <button style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button style={{ ...formStyles.button, ...formStyles.submit, opacity: busy ? 0.6 : 1 }}
            onClick={submit} disabled={busy}>
            {busy ? "Recording…" : "Record as filed"}
          </button>
        </div>
      </div>
    </div>
  );
}
