import { useState, useRef, useEffect, useMemo } from "react";
import { MdAdd, MdDelete } from "react-icons/md";
import LookupAutocomplete from "./LookupAutocomplete";
import SearchableSelect from "./SearchableSelect";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import ItemTypeForm from "./ItemTypeForm";
import QuantityInput from "./QuantityInput";
import { usePermissions } from "../contexts/PermissionsContext";
import { getAllUnits } from "../api/unitsApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getClientsByCompany } from "../api/clientApi";
import { getQuoteItemRate } from "../api/salesQuoteApi";
import AttachmentManager from "./AttachmentManager";
import { formStyles, modalSizes } from "../theme";

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
  const [items, setItems] = useState(
    quote?.items?.length
      ? quote.items.map((i) => ({ id: i.id, itemTypeId: i.itemTypeId, description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, rateHint: "" }))
      : [blankItem()]
  );
  const [units, setUnits] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [clients, setClients] = useState([]);
  const [showAddItemType, setShowAddItemType] = useState(false);
  // Bulk-apply mode for the "set Item Type on every row" bar above the grid —
  // "all" overwrites every line, "empty" only fills untagged rows.
  const [bulkApplyMode, setBulkApplyMode] = useState("all");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rateTimers = useRef({});
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

  // Picking an item type only TAGS the line (records ItemTypeId). It must NOT
  // overwrite the operator's typed description/unit — that auto-fill is reserved
  // for Invoice (FBR-classification) mode, not pre-sale quotes.
  const pickItemType = (idx, newId) => setItem(idx, { itemTypeId: newId ? parseInt(newId) : null });

  // Stamp one Item Type onto every line (or only the untagged ones) in a
  // single pick — saves repetitive per-row selection when the whole quote is
  // one product family. Simplified vs InvoiceForm: quotes only tag ItemTypeId,
  // there's no HS/UOM/SaleType inheritance to fan out.
  const applyItemTypeToAll = (newId) => {
    if (!newId) return;
    const id = parseInt(newId);
    setItems((prev) => prev.map((it) => (bulkApplyMode === "empty" && it.itemTypeId) ? it : { ...it, itemTypeId: id }));
  };
  const clearAllItemTypes = () => setItems((prev) => prev.map((it) => ({ ...it, itemTypeId: null })));

  const setItem = (idx, patch) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  // Auto-fill price from the item's last billed rate (the operator's
  // "if the item already has a price in the system" rule). Only fills when
  // the row's price is still 0, so it never clobbers a typed price.
  const fetchRate = async (idx, description) => {
    if (!companyId || !description?.trim()) return;
    try {
      const { data } = await getQuoteItemRate(companyId, { description });
      if (data?.lastUnitPrice != null) {
        setItems((prev) => prev.map((it, i) => {
          if (i !== idx) return it;
          const hint = `Last billed: Rs ${Number(data.lastUnitPrice).toLocaleString()}${data.lastInvoiceNumber ? ` (Bill #${data.lastInvoiceNumber})` : ""}`;
          return (!it.unitPrice || Number(it.unitPrice) === 0)
            ? { ...it, unitPrice: data.lastUnitPrice, rateHint: hint }
            : { ...it, rateHint: hint };
        }));
      }
    } catch { /* no suggestion */ }
  };

  const handleDescChange = (idx, val) => {
    setItem(idx, { description: val });
    clearTimeout(rateTimers.current[idx]);
    rateTimers.current[idx] = setTimeout(() => fetchRate(idx, val), 600);
  };

  const addItem = () => {
    if (!items[items.length - 1].description.trim()) {
      setError("Fill the current item's description before adding another.");
      return;
    }
    setError("");
    setItems([...items, blankItem()]);
  };
  const removeItem = (idx) => setItems(items.filter((_, i) => i !== idx));

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

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? `Edit Quote #${quote.quoteNumber}` : "Create Sales Quote"}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div style={s.err}>{error}</div>}
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
            </div>

            <div style={s.itemsHeaderBar}>
              <label style={{ ...s.label, margin: 0 }}>Items <span style={{ fontWeight: 400, fontSize: "0.72rem", color: colors.textSecondary }}>— unit price is required per line and remembered for later billing</span></label>
              {canCreateItemType && (
                <button type="button" style={s.inlineAddBtn} onClick={() => setShowAddItemType(true)} title="Add a new item type to your catalog">
                  <MdAdd size={14} /> New Item Type
                </button>
              )}
            </div>

            {/* Bulk-apply — stamp one Item Type across every line (or just the
                empty ones) in a single pick. Shown once there are 2+ rows. */}
            {items.length > 1 && (
              <div style={s.bulkApplyBar}>
                <span style={{ fontSize: "0.82rem", color: "#1a2332", fontWeight: 500 }}>Apply same Item Type to:</span>
                <select value={bulkApplyMode} onChange={(e) => setBulkApplyMode(e.target.value)} style={{ ...s.input, width: "auto", padding: "0.3rem 0.5rem", fontSize: "0.8rem", maxWidth: 160 }}>
                  <option value="all">All {items.length} rows</option>
                  <option value="empty">Only empty rows</option>
                </select>
                <div style={{ flex: "1 1 200px", maxWidth: 280 }}>
                  <SearchableItemTypeSelect
                    items={nonHsItemTypes}
                    value={""}
                    onChange={(newId) => applyItemTypeToAll(newId)}
                    placeholder={bulkApplyMode === "all" ? "— pick to apply to all —" : "— pick to fill empty rows —"}
                    style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                  />
                </div>
                <button type="button" style={s.bulkClearBtn} onClick={clearAllItemTypes} disabled={!items.some((it) => it.itemTypeId)} title="Drop the Item Type binding from every row">
                  Clear all
                </button>
              </div>
            )}

            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={{ ...s.th, width: 28, textAlign: "center" }}>#</th>
                    <th style={{ ...s.th, width: 190 }}>Item Type</th>
                    <th style={s.th}>Description</th>
                    <th style={{ ...s.th, width: 92, textAlign: "right" }}>Qty</th>
                    <th style={{ ...s.th, width: 120 }}>Unit</th>
                    <th style={{ ...s.th, width: 120, textAlign: "right" }}>Unit Price</th>
                    <th style={{ ...s.th, width: 110, textAlign: "right" }}>Amount</th>
                    <th style={{ ...s.th, width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ ...s.td, textAlign: "center", color: colors.textSecondary, fontWeight: 700 }}>{idx + 1}</td>
                      <td style={{ ...s.td, verticalAlign: "top" }}>
                        <SearchableItemTypeSelect
                          items={nonHsItemTypes}
                          value={item.itemTypeId || ""}
                          onChange={(newId) => pickItemType(idx, newId)}
                          placeholder="— optional —"
                          style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                        />
                      </td>
                      <td style={{ ...s.td, verticalAlign: "top" }}>
                        <LookupAutocomplete label="Item description" endpoint="/lookup/items" value={item.description} onChange={(v) => handleDescChange(idx, v)} inputStyle={s.cellInput} multiline />
                        {item.rateHint && <div style={s.hint}>{item.rateHint}</div>}
                      </td>
                      <td style={s.td}>
                        <QuantityInput value={item.quantity} onChange={(v) => setItem(idx, { quantity: v })} unit={item.unit} units={units} style={{ ...s.cellInput, textAlign: "right" }} />
                      </td>
                      <td style={s.td}>
                        <LookupAutocomplete label="Unit" endpoint="/lookup/units" value={item.unit} onChange={(v) => setItem(idx, { unit: v })} inputStyle={s.cellInput} />
                      </td>
                      <td style={s.td}>
                        <input type="number" min="0" step="0.01" style={{ ...s.cellInput, textAlign: "right" }} value={item.unitPrice} onChange={(e) => setItem(idx, { unitPrice: e.target.value })} />
                      </td>
                      <td style={{ ...s.td, textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{lineTotal(item).toLocaleString()}</td>
                      <td style={{ ...s.td, textAlign: "center" }}>
                        {idx !== 0 && <button type="button" style={s.del} onClick={() => removeItem(idx)} title="Remove item"><MdDelete size={16} /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" style={s.addBtn} onClick={addItem}><MdAdd size={16} /> Add Item</button>

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
};
