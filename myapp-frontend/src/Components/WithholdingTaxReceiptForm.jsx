import { useState, useRef } from "react";
import SelectDropdown from "./SelectDropdown";
import DivisionSelect from "./DivisionSelect";
import AttachmentManager from "./AttachmentManager";
import { usePermissions } from "../contexts/PermissionsContext";
import { formStyles, modalSizes } from "../theme";

const colors = {
  textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2", danger: "#dc3545", dangerLight: "#fff0f1",
};

// Create + edit a Withholding Tax Receipt (customer-issued tax certificate).
// Single-amount document: Date + Customer + Amount + Description + an optional
// scanned certificate (attachment). Pass `receipt` to edit. `onSaved` returns
// the saved record so staged attachments can flush against the new id.
export default function WithholdingTaxReceiptForm({ onClose, onSaved, companyId, receipt, defaultDivisionId }) {
  const isEdit = !!receipt;
  const { has } = usePermissions();
  const [client, setClient] = useState(receipt ? { id: receipt.clientId, label: receipt.clientName } : null);
  const [date, setDate] = useState(receipt?.date ? receipt.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(receipt?.amount != null ? String(receipt.amount) : "");
  const [description, setDescription] = useState(receipt?.description || "");
  // Division is fixed once created (it drives the receipt's numbering series).
  const [divisionId, setDivisionId] = useState(
    receipt?.divisionId ? String(receipt.divisionId) : (defaultDivisionId ? String(defaultDivisionId) : ""));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const attachmentRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError("");
    if (!client) { setError("Please select a customer."); return; }
    const amt = parseFloat(amount);
    if (!(amt > 0)) { setError("Enter an amount greater than zero."); return; }

    setSaving(true);
    try {
      const saved = await onSaved({
        clientId: client.id,
        divisionId: divisionId ? parseInt(divisionId) : null,
        date: date ? new Date(date).toISOString() : null,
        amount: amt,
        description: description.trim() || null,
      });
      // Upload any certificate staged before the receipt had an id. No-op in
      // edit mode (uploads immediately there) and when nothing's staged.
      try {
        const savedId = saved?.id ?? receipt?.id;
        if (savedId) await attachmentRef.current?.flush(savedId);
      } catch { /* attachments are best-effort — the receipt is already saved */ }
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message;
      setError(msg || (!err.response ? "Could not reach the server." : "Could not save the receipt."));
      setSaving(false);
    }
  };

  const disabled = !client || !(parseFloat(amount) > 0) || saving;

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            {isEdit ? `Edit Withholding Tax Receipt #${receipt.receiptNumber}` : "New Withholding Tax Receipt"}
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div style={s.err}>{error}</div>}
            <div style={s.row}>
              <div style={{ flex: "1 1 100%", minWidth: 220 }}>
                <SelectDropdown
                  label="Customer"
                  endpoint={`/clients/company/${companyId}`}
                  value={client}
                  onChange={(v) => setClient(v)}
                  placeholder="Choose customer"
                />
              </div>
            </div>
            <div style={s.row}>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label style={s.label}>Date</label>
                <input type="date" style={s.input} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label style={s.label}>Amount (PKR)</label>
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  style={{ ...s.input, textAlign: "right" }}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              {has("divisions.manage.view") && !isEdit && (
                <DivisionSelect
                  companyId={companyId} value={divisionId} onChange={setDivisionId} mode="select"
                  label={<>Division <span style={s.opt}>(optional)</span></>}
                  labelStyle={s.label} style={s.input} wrapStyle={{ flex: 1, minWidth: 150 }}
                />
              )}
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={s.label}>Description <span style={s.opt}>(optional — certificate ref, section, period…)</span></label>
              <textarea
                style={{ ...s.input, minHeight: 56, resize: "vertical" }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. WHT u/s 153(1)(a) — May 2026"
              />
            </div>

            <AttachmentManager
              ref={attachmentRef}
              companyId={companyId}
              entityType="WithholdingTaxReceipt"
              entityId={receipt?.id ?? null}
              mode="edit"
              title="Certificate"
            />
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: disabled ? 0.6 : 1 }} disabled={disabled}>
              {saving ? "Saving..." : isEdit ? "Update Receipt" : "Save Receipt"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const s = {
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  opt: { color: colors.textSecondary, fontWeight: 400 },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: "#1a2332", outline: "none", boxSizing: "border-box" },
  err: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, fontSize: "0.85rem" },
};
