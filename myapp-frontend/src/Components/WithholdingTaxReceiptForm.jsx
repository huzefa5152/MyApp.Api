import { useState, useRef } from "react";
import { todayYmd, toLocalYmd } from "../utils/dateInput";
import SelectDropdown from "./SelectDropdown";
import AttachmentManager from "./AttachmentManager";
import useScrollToError from "../hooks/useScrollToError";
import { formStyles, modalSizes } from "../theme";
import { Field } from "../ui/Kit";

// Create + edit a Withholding Tax Receipt (customer-issued tax certificate).
// Single-amount document: Date + Customer + Amount + Description + an optional
// scanned certificate (attachment). Pass `receipt` to edit. `onSaved` returns
// the saved record so staged attachments can flush against the new id.
export default function WithholdingTaxReceiptForm({ onClose, onSaved, companyId, receipt }) {
  const isEdit = !!receipt;
  const [client, setClient] = useState(receipt ? { id: receipt.clientId, label: receipt.clientName } : null);
  const [date, setDate] = useState(receipt?.date ? toLocalYmd(receipt.date) : todayYmd());
  const [amount, setAmount] = useState(receipt?.amount != null ? String(receipt.amount) : "");
  const [description, setDescription] = useState(receipt?.description || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const attachmentRef = useRef(null);
  const errRef = useScrollToError(error);

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
        date: date ? `${date}T00:00:00` : null,
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
          <button aria-label="Close" type="button" style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div ref={errRef} style={formStyles.error}>{error}</div>}
            <div style={{ marginBottom: "1rem" }}>
              <SelectDropdown
                label="Customer"
                endpoint={`/clients/company/${companyId}`}
                value={client}
                onChange={(v) => setClient(v)}
                placeholder="Choose customer"
              />
            </div>
            <div className="k-form-grid" style={{ marginBottom: "1rem", alignItems: "end" }}>
              <Field label="Date">
                <input type="date" className="k-input" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Amount (PKR)">
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  className="k-input"
                  style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <Field label={<>Description <span style={{ fontWeight: 400 }}>(optional — certificate ref, section, period…)</span></>}>
                <textarea
                  className="k-textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. WHT u/s 153(1)(a) — May 2026"
                />
              </Field>
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
