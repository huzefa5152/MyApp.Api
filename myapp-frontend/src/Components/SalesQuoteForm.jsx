import { useState, useRef, useEffect, useMemo } from "react";
import SearchableSelect from "./SearchableSelect";
import ItemTypeForm from "./ItemTypeForm";
import LineItemsEditor from "./LineItemsEditor";
import { usePermissions } from "../contexts/PermissionsContext";
import { getAllUnits } from "../api/unitsApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getClientsByCompany } from "../api/clientApi";
import { getQuoteItemRate } from "../api/salesQuoteApi";
import AttachmentManager from "./AttachmentManager";
import { formStyles, modalSizes } from "../theme";
import useScrollToError from "../hooks/useScrollToError";

const colors = {
  textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2", danger: "#dc3545", dangerLight: "#fff0f1", teal: "#00897b",
};

const blankItem = () => ({ id: 0, itemTypeId: null, description: "", quantity: 1, unit: "", unitPrice: 0, rateHint: "" });

// Create + edit a Sales Quote. Pass `quote` to edit; omit to create.
export default function SalesQuoteForm({ onClose, onSaved, companyId, quote }) {
  const { has } = usePermissions();
  const canCreateItemType = has("itemtypes.manage.create");
  const isEdit = !!quote;
  const [client, setClient] = useState(quote ? { id: quote.clientId, label: quote.clientName } : null);
  const [date, setDate] = useState(quote?.date ? quote.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
  // "Valid for N days" drives expiry: ValidUntil = issue date + N days. Blank =
  // no expiry (quote stays Active until accepted). On edit, derive the day count
  // back from the stored dates.
  const [validForDays, setValidForDays] = useState(() => {
    if (quote?.validUntil && quote?.date) {
      const d = Math.round((new Date(quote.validUntil) - new Date(quote.date)) / 86400000);
      return d > 0 ? String(d) : "";
    }
    return "";
  });
  const [enquiryRef, setEnquiryRef] = useState(quote?.customerEnquiryRef || "");
  const [enquiryDate, setEnquiryDate] = useState(quote?.enquiryDate ? quote.enquiryDate.slice(0, 10) : "");
  const [gstRate, setGstRate] = useState(quote?.gstRate ?? 18);
  const [notes, setNotes] = useState(quote?.notes || "");
  const [contactPerson, setContactPerson] = useState(quote?.contactPerson || "");
  const [items, setItems] = useState(
    quote?.items?.length
      ? quote.items.map((i) => ({ id: i.id, itemTypeId: i.itemTypeId, description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, rateHint: "" }))
      : [blankItem()]
  );
  const [units, setUnits] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [clients, setClients] = useState([]);
  const [showAddItemType, setShowAddItemType] = useState(false);
  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const [saving, setSaving] = useState(false);
  const attachmentRef = useRef(null);

  useEffect(() => { getAllUnits().then(({ data }) => setUnits(data)).catch(() => setUnits([])); }, []);
  useEffect(() => { getItemTypes(companyId).then(({ data }) => setItemTypes(data || [])).catch(() => setItemTypes([])); }, [companyId]);
  useEffect(() => { getClientsByCompany(companyId).then(({ data }) => setClients(data || [])).catch(() => setClients([])); }, [companyId]);
  // A quote is a pre-sale document (never sent to FBR), so — like Bill mode —
  // it only offers item types WITHOUT an HS code (HS-coded types are the
  // FBR-classification set used on the Invoices tab).
  const nonHsItemTypes = useMemo(
    () => itemTypes.filter((it) => !(it.hsCode && String(it.hsCode).trim())),
    [itemTypes]
  );

  // Last-billed-rate lookup for the shared editor's price auto-fill. Returns
  // { lastUnitPrice, hint } or null. The editor only fills when the row's price
  // is still 0, so a typed price is never clobbered.
  const getRate = async (description) => {
    if (!companyId || !description?.trim()) return null;
    const { data } = await getQuoteItemRate(companyId, { description });
    if (data?.lastUnitPrice == null) return null;
    return {
      lastUnitPrice: data.lastUnitPrice,
      hint: `Last billed: Rs ${Number(data.lastUnitPrice).toLocaleString()}${data.lastInvoiceNumber ? ` (Bill #${data.lastInvoiceNumber})` : ""}`,
    };
  };

  const lineTotal = (it) => Math.round((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) * 100) / 100;
  const subtotal = items.reduce((s, it) => s + lineTotal(it), 0);
  const gstAmount = Math.round(subtotal * (Number(gstRate) || 0)) / 100;
  const grandTotal = subtotal + gstAmount;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError("");
    const valid = items.filter((i) => i.description.trim());
    if (!client) { setError("Please select a client."); return; }
    if (valid.length === 0) { setError("Add at least one item."); return; }

    setSaving(true);
    try {
      const saved = await onSaved({
        clientId: client.id,
        date: date ? new Date(date).toISOString() : null,
        validUntil: validForDays && date ? new Date(new Date(date).getTime() + Number(validForDays) * 86400000).toISOString() : null,
        customerEnquiryRef: enquiryRef.trim() || null,
        enquiryDate: enquiryDate ? new Date(enquiryDate).toISOString() : null,
        gstRate: Number(gstRate) || 0,
        notes: notes.trim() || null,
        contactPerson: contactPerson || null,
        items: valid.map((i) => ({
          id: i.id || 0,
          itemTypeId: i.itemTypeId || null,
          description: i.description.trim(),
          quantity: typeof i.quantity === "number" ? i.quantity : (parseFloat(i.quantity) || 1),
          unit: i.unit,
          unitPrice: Number(i.unitPrice) || 0,
        })),
      });
      // Upload any files staged before the record had an id (no-op in edit
      // mode / when nothing was staged). Best-effort — the quote is saved.
      const savedId = saved?.id ?? quote?.id;
      if (savedId) { try { await attachmentRef.current?.flush(savedId); } catch { /* attachments best-effort */ } }
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message;
      setError(msg || (!err.response ? "Could not reach the server." : "Could not save the quote."));
      setSaving(false);
    }
  };

  const disabled = !client || items.every((i) => !i.description.trim()) || saving;

  // Contact-person dropdown options come from the selected client's
  // semicolon-separated ContactPerson list (mirrors the challan Site dropdown).
  const contactOptions = useMemo(() => {
    const sel = clients.find((c) => String(c.id) === String(client?.id));
    return sel?.contactPerson ? sel.contactPerson.split(";").map((x) => x.trim()).filter(Boolean) : [];
  }, [clients, client]);

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? `Edit Quote #${quote.quoteNumber}` : "Create Sales Quote"}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div ref={errRef} style={s.err}>{error}</div>}
            <div style={s.row}>
              <div style={{ flex: 2, minWidth: 220 }}>
                <label style={s.label}>Client</label>
                <SearchableSelect
                  items={clients}
                  value={client?.id || ""}
                  onChange={(id, item) => setClient(item)}
                  placeholder="— Select Client —"
                />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={s.label}>Issue Date</label>
                <input type="date" style={s.input} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={s.label}>Valid for (days) <span style={s.opt}>(optional)</span></label>
                <input type="number" min={1} step={1} style={s.input} value={validForDays} onChange={(e) => setValidForDays(e.target.value)} placeholder="blank = no expiry" />
              </div>
            </div>
            <div style={s.row}>
              <div style={{ flex: 1.5, minWidth: 180 }}>
                <label style={s.label}>Customer Enquiry Ref <span style={s.opt}>(optional)</span></label>
                <input type="text" style={s.input} value={enquiryRef} onChange={(e) => setEnquiryRef(e.target.value)} placeholder="Their RFQ / enquiry number" />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={s.label}>Enquiry Date <span style={s.opt}>(optional)</span></label>
                <input type="date" style={s.input} value={enquiryDate} onChange={(e) => setEnquiryDate(e.target.value)} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={s.label}>GST Rate (%)</label>
                <input type="number" min="0" max="100" step="0.01" style={{ ...s.input, textAlign: "right" }} value={gstRate} onChange={(e) => setGstRate(e.target.value)} />
              </div>
              <div style={{ flex: 1.5, minWidth: 180 }}>
                <label style={s.label}>Contact Person <span style={s.opt}>(optional)</span></label>
                {contactOptions.length > 0 ? (
                  <select style={s.input} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)}>
                    <option value="">(none)</option>
                    {contactPerson && !contactOptions.includes(contactPerson) && <option value={contactPerson}>{contactPerson}</option>}
                    {contactOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input type="text" style={s.input} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder={client ? "Optional (client has no saved contacts)" : "Pick a client first"} disabled={!client} />
                )}
              </div>
            </div>

            <LineItemsEditor
              items={items}
              onItemsChange={setItems}
              makeBlankItem={blankItem}
              units={units}
              showItemType
              itemTypes={nonHsItemTypes}
              canCreateItemType={canCreateItemType}
              onAddItemType={() => setShowAddItemType(true)}
              showUnitPrice
              getRate={getRate}
              itemsLabel="Items"
              itemsHint="unit price is required per line and remembered for later billing"
            />

            <div style={s.totals}>
              <div style={s.tRow}><span>Subtotal</span><span>Rs {subtotal.toLocaleString()}</span></div>
              <div style={s.tRow}><span>GST @ {gstRate || 0}%</span><span>Rs {gstAmount.toLocaleString()}</span></div>
              <div style={{ ...s.tRow, ...s.grand }}><span>Grand Total</span><span>Rs {grandTotal.toLocaleString()}</span></div>
            </div>

            <div style={{ marginTop: "1rem" }}>
              <label style={s.label}>Notes / Terms <span style={s.opt}>(optional)</span></label>
              <textarea style={{ ...s.input, minHeight: 56, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Terms printed at the foot of the quote" />
            </div>

            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager ref={attachmentRef} companyId={companyId} entityType="SalesQuote" entityId={quote?.id ?? null} mode="edit" />
            </div>
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: disabled ? 0.6 : 1 }} disabled={disabled}>{saving ? "Saving..." : isEdit ? "Update Quote" : "Save Quote"}</button>
          </div>
        </form>
      </div>

      {showAddItemType && (
        <ItemTypeForm
          companyId={companyId}
          onClose={() => setShowAddItemType(false)}
          onSaved={() => { setShowAddItemType(false); getItemTypes(companyId).then(({ data }) => setItemTypes(data || [])).catch(() => {}); }}
        />
      )}
    </div>
  );
}

const s = {
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  itemsHeaderBar: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" },
  inlineAddBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.45rem 0.75rem", borderRadius: 6, border: `1px solid ${colors.teal}`, backgroundColor: "#fff", color: colors.teal, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  bulkApplyBar: { display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap", padding: "0.55rem 0.85rem", marginBottom: "0.5rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#f8faff" },
  bulkClearBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.35rem 0.7rem", borderRadius: 6, border: `1px solid ${colors.danger}`, backgroundColor: "#fff", color: colors.danger, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  opt: { color: colors.textSecondary, fontWeight: 400 },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: "#1a2332", outline: "none", boxSizing: "border-box" },
  err: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, fontSize: "0.85rem" },
  tableWrap: { maxHeight: 300, overflowY: "auto", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 10 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.02em", fontWeight: 700, color: colors.textSecondary, padding: "0.5rem 0.4rem", borderBottom: `2px solid ${colors.cardBorder}`, whiteSpace: "nowrap", background: "#fafbfc", position: "sticky", top: 0 },
  td: { padding: "0.3rem 0.4rem", verticalAlign: "middle", borderBottom: `1px solid ${colors.cardBorder}` },
  cellInput: { width: "100%", padding: "0.5rem 0.55rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.88rem", backgroundColor: colors.inputBg, color: "#1a2332", outline: "none", boxSizing: "border-box" },
  hint: { fontSize: "0.7rem", color: colors.teal, marginTop: 2, fontWeight: 600 },
  del: { display: "grid", placeItems: "center", padding: "0.4rem", borderRadius: 8, border: `1px solid ${colors.danger}25`, backgroundColor: colors.dangerLight, color: colors.danger, cursor: "pointer", margin: "0 auto" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", marginTop: "0.6rem", padding: "0.4rem 0.9rem", borderRadius: 8, border: "none", backgroundColor: `${colors.teal}14`, color: colors.teal, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  totals: { marginTop: "1rem", marginLeft: "auto", width: 280 },
  tRow: { display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.9rem", color: colors.textSecondary },
  grand: { borderTop: "2px solid #0d47a1", marginTop: 4, paddingTop: 8, fontWeight: 800, fontSize: "1rem", color: "#0d47a1" },
  // Mobile stacked-card line items (rendered below 760px instead of the table).
  mcards: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  mcard: { border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.7rem 0.75rem", background: "#fff" },
  mcardHead: { display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" },
  mnum: { flex: "0 0 auto", width: 24, height: 24, borderRadius: 7, background: "#f0f3f8", color: colors.textSecondary, display: "grid", placeItems: "center", fontSize: "0.78rem", fontWeight: 700 },
  m3col: { display: "grid", gridTemplateColumns: "1fr 1fr 1.1fr", gap: "0.5rem", marginTop: "0.5rem" },
  mlabel: { display: "block", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.03em", color: colors.textSecondary, fontWeight: 700, marginBottom: "0.2rem" },
  mamt: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.55rem", paddingTop: "0.45rem", borderTop: `1px dashed ${colors.cardBorder}`, fontSize: "0.85rem", color: colors.textSecondary },
};
