import { useState, useEffect } from "react";
import { MdAdd, MdDelete } from "react-icons/md";
import LookupAutocomplete from "./LookupAutocomplete";
import SelectDropdown from "./SelectDropdown";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import DivisionSelect from "./DivisionSelect";
import QuantityInput from "./QuantityInput";
import { usePermissions } from "../contexts/PermissionsContext";
import { getAllUnits } from "../api/unitsApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getPagedSalesQuotesByCompany } from "../api/salesQuoteApi";
import { formStyles, modalSizes } from "../theme";

const colors = {
  textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2", danger: "#dc3545", dangerLight: "#fff0f1", teal: "#00897b",
};

const blankItem = () => ({ id: 0, itemTypeId: null, description: "", quantity: 1, unit: "" });

// Create + edit a Sales Order (quantity-only). Pass `order` to edit.
export default function SalesOrderForm({ onClose, onSaved, companyId, order }) {
  const isEdit = !!order;
  const [client, setClient] = useState(order ? { id: order.clientId, label: order.clientName } : null);
  const [orderDate, setOrderDate] = useState(order?.orderDate ? order.orderDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [requiredDate, setRequiredDate] = useState(order?.requiredDate ? order.requiredDate.slice(0, 10) : "");
  const [poNumber, setPoNumber] = useState(order?.customerPoNumber || "");
  const [poDate, setPoDate] = useState(order?.customerPoDate ? order.customerPoDate.slice(0, 10) : "");
  const [site, setSite] = useState(order?.site || "");
  const [notes, setNotes] = useState(order?.notes || "");
  const [items, setItems] = useState(
    order?.items?.length
      ? order.items.map((i) => ({ id: i.id, itemTypeId: i.itemTypeId, description: i.description, quantity: i.quantity, unit: i.unit, delivered: i.deliveredQuantity }))
      : [blankItem()]
  );
  const [units, setUnits] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const { has } = usePermissions();
  const [divisionId, setDivisionId] = useState(order?.divisionId ? String(order.divisionId) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [salesQuoteId, setSalesQuoteId] = useState(order?.salesQuoteId ? String(order.salesQuoteId) : "");
  const [quotes, setQuotes] = useState([]);
  const [quoteLoadedMsg, setQuoteLoadedMsg] = useState("");

  useEffect(() => { getAllUnits().then(({ data }) => setUnits(data)).catch(() => setUnits([])); }, []);
  useEffect(() => { getItemTypes(companyId).then(({ data }) => setItemTypes(data || [])).catch(() => setItemTypes([])); }, [companyId]);

  // Optional item-type pick prefills description + unit.
  const pickItemType = (idx, newId, picked) => {
    const patch = { itemTypeId: newId ? parseInt(newId) : null };
    if (picked) {
      if (picked.name) patch.description = picked.name;
      if (picked.uom) patch.unit = picked.uom;
    }
    setItem(idx, patch);
  };
  useEffect(() => {
    getPagedSalesQuotesByCompany(companyId, { pageSize: 200 })
      .then(({ data }) => setQuotes(data.items || []))
      .catch(() => setQuotes([]));
  }, [companyId]);

  // Only Draft / Sent / Accepted quotes are offered for linking (a Rejected /
  // Expired / Converted quote isn't a candidate). Keep the currently-linked
  // quote visible in edit mode even if its status has since changed, so
  // editing never silently drops the link.
  const QUOTE_LINKABLE = ["Draft", "Sent", "Accepted"];
  const clientQuotes = quotes.filter((q) => client && q.clientId === client.id
    && (QUOTE_LINKABLE.includes(q.status) || String(q.id) === salesQuoteId));

  // Picking a quote on a NEW order pulls its client + line items in (quantity
  // only — prices are dropped, re-entered at bill time); the lines stay fully
  // editable. On EDIT we only re-link, never replacing items that may already
  // have deliveries against them.
  const handleQuoteSelect = (value) => {
    setSalesQuoteId(value);
    setQuoteLoadedMsg("");
    if (!value || isEdit) return;
    const q = quotes.find((x) => String(x.id) === String(value));
    if (!q) return;
    if (q.clientId && (!client || client.id !== q.clientId)) setClient({ id: q.clientId, label: q.clientName });
    if (q.items?.length) {
      setItems(q.items.map((i) => ({ id: 0, itemTypeId: i.itemTypeId || null, description: i.description, quantity: i.quantity, unit: i.unit })));
      setQuoteLoadedMsg(`Loaded ${q.items.length} item${q.items.length !== 1 ? "s" : ""} from Quote #${q.quoteNumber} — edit as needed.`);
    }
  };

  const setItem = (idx, patch) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addItem = () => {
    if (!items[items.length - 1].description.trim()) { setError("Fill the current item's description first."); return; }
    setError("");
    setItems([...items, blankItem()]);
  };
  const removeItem = (idx) => setItems(items.filter((_, i) => i !== idx));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError("");
    const valid = items.filter((i) => i.description.trim());
    if (!client) { setError("Please select a client."); return; }
    if (valid.length === 0) { setError("Add at least one item."); return; }

    setSaving(true);
    try {
      await onSaved({
        clientId: client.id,
        divisionId: divisionId ? parseInt(divisionId) : null,
        salesQuoteId: salesQuoteId ? parseInt(salesQuoteId) : null,
        orderDate: orderDate ? new Date(orderDate).toISOString() : null,
        requiredDate: requiredDate ? new Date(requiredDate).toISOString() : null,
        customerPoNumber: poNumber.trim() || null,
        customerPoDate: poDate ? new Date(poDate).toISOString() : null,
        site: site.trim() || null,
        notes: notes.trim() || null,
        items: valid.map((i) => ({
          id: i.id || 0,
          itemTypeId: i.itemTypeId || null,
          description: i.description.trim(),
          quantity: typeof i.quantity === "number" ? i.quantity : (parseFloat(i.quantity) || 1),
          unit: i.unit,
        })),
      });
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message;
      setError(msg || (!err.response ? "Could not reach the server." : "Could not save the order."));
      setSaving(false);
    }
  };

  const disabled = !client || items.every((i) => !i.description.trim()) || saving;

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? `Edit Sales Order #${order.salesOrderNumber}` : "Create Sales Order"}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div style={s.err}>{error}</div>}
            <div style={s.row}>
              <div style={{ flex: 2, minWidth: 220 }}>
                <SelectDropdown label="Client" endpoint={`/clients/company/${companyId}`} value={client} onChange={(v) => { setClient(v); setSite(""); setSalesQuoteId(""); }} placeholder="Choose client" />
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label style={s.label}>Site / Department <span style={s.opt}>(optional)</span></label>
                {(() => {
                  const sites = client?.site ? client.site.split(";").map((x) => x.trim()).filter(Boolean) : [];
                  return sites.length > 0 ? (
                    <select style={s.input} value={site} onChange={(e) => setSite(e.target.value)}>
                      <option value="">(none)</option>
                      {sites.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  ) : (
                    <input type="text" style={s.input} value={site} onChange={(e) => setSite(e.target.value)} placeholder={client ? "Optional" : "Pick a client first"} disabled={!client} />
                  );
                })()}
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={s.label}>Sales Quote <span style={s.opt}>(optional)</span></label>
                <select style={s.input} value={salesQuoteId} onChange={(e) => handleQuoteSelect(e.target.value)} disabled={!client}>
                  <option value="">{client ? "— not linked —" : "Pick a client first"}</option>
                  {clientQuotes.map((q) => <option key={q.id} value={q.id}>Quote #{q.quoteNumber}{q.status ? ` · ${q.status}` : ""}</option>)}
                </select>
                {quoteLoadedMsg && <div style={{ fontSize: "0.72rem", color: colors.teal, marginTop: 4, fontWeight: 600 }}>{quoteLoadedMsg}</div>}
              </div>
              {has("divisions.manage.view") && (
                <DivisionSelect companyId={companyId} value={divisionId} onChange={setDivisionId} mode="select" label={<>Division <span style={s.opt}>(optional)</span></>} labelStyle={s.label} style={s.input} wrapStyle={{ flex: 1, minWidth: 150 }} />
              )}
            </div>
            <div style={s.row}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={s.label}>Order Date</label>
                <input type="date" style={s.input} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={s.label}>Required By <span style={s.opt}>(optional)</span></label>
                <input type="date" style={s.input} value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} />
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={s.label}>Customer PO # <span style={s.opt}>(optional)</span></label>
                <input type="text" style={s.input} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Their PO number" />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={s.label}>Customer PO Date</label>
                <input type="date" style={s.input} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
              </div>
            </div>

            <label style={{ ...s.label, marginBottom: "0.5rem" }}>Items (quantity ordered)</label>
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={{ ...s.th, width: 28, textAlign: "center" }}>#</th>
                    <th style={{ ...s.th, width: 190 }}>Item Type</th>
                    <th style={s.th}>Description</th>
                    <th style={{ ...s.th, width: 100, textAlign: "right" }}>Qty</th>
                    <th style={{ ...s.th, width: 150 }}>Unit</th>
                    <th style={{ ...s.th, width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const locked = isEdit && item.id > 0 && item.delivered > 0;
                    return (
                      <tr key={idx}>
                        <td style={{ ...s.td, textAlign: "center", color: colors.textSecondary, fontWeight: 700 }}>{idx + 1}</td>
                        <td style={{ ...s.td, verticalAlign: "top" }}>
                          <SearchableItemTypeSelect
                            items={itemTypes}
                            value={item.itemTypeId || ""}
                            onChange={(newId, picked) => pickItemType(idx, newId, picked)}
                            placeholder="— optional —"
                            style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                          />
                        </td>
                        <td style={{ ...s.td, verticalAlign: "top" }}>
                          <LookupAutocomplete label="Item description" endpoint="/lookup/items" value={item.description} onChange={(v) => setItem(idx, { description: v })} inputStyle={s.cellInput} multiline />
                          {locked && <div style={s.hint}>{item.delivered} already delivered — qty can't go below that</div>}
                        </td>
                        <td style={s.td}>
                          <QuantityInput value={item.quantity} onChange={(v) => setItem(idx, { quantity: v })} unit={item.unit} units={units} style={{ ...s.cellInput, textAlign: "right" }} />
                        </td>
                        <td style={s.td}>
                          <LookupAutocomplete label="Unit" endpoint="/lookup/units" value={item.unit} onChange={(v) => setItem(idx, { unit: v })} inputStyle={s.cellInput} />
                        </td>
                        <td style={{ ...s.td, textAlign: "center" }}>
                          {idx !== 0 && !locked && <button type="button" style={s.del} onClick={() => removeItem(idx)} title="Remove item"><MdDelete size={16} /></button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button type="button" style={s.addBtn} onClick={addItem}><MdAdd size={16} /> Add Item</button>

            <div style={{ marginTop: "1rem" }}>
              <label style={s.label}>Notes <span style={s.opt}>(optional)</span></label>
              <textarea style={{ ...s.input, minHeight: 56, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes for this order" />
            </div>
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: disabled ? 0.6 : 1 }} disabled={disabled}>{saving ? "Saving..." : isEdit ? "Update Order" : "Save Order"}</button>
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
  tableWrap: { maxHeight: 280, overflowY: "auto", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 10 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.02em", fontWeight: 700, color: colors.textSecondary, padding: "0.5rem 0.4rem", borderBottom: `2px solid ${colors.cardBorder}`, whiteSpace: "nowrap", background: "#fafbfc", position: "sticky", top: 0 },
  td: { padding: "0.3rem 0.4rem", verticalAlign: "middle", borderBottom: `1px solid ${colors.cardBorder}` },
  cellInput: { width: "100%", padding: "0.5rem 0.55rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.88rem", backgroundColor: colors.inputBg, color: "#1a2332", outline: "none", boxSizing: "border-box" },
  hint: { fontSize: "0.7rem", color: colors.danger, marginTop: 2, fontWeight: 600 },
  del: { display: "grid", placeItems: "center", padding: "0.4rem", borderRadius: 8, border: `1px solid ${colors.danger}25`, backgroundColor: colors.dangerLight, color: colors.danger, cursor: "pointer", margin: "0 auto" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", marginTop: "0.6rem", padding: "0.4rem 0.9rem", borderRadius: 8, border: "none", backgroundColor: `${colors.teal}14`, color: colors.teal, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
};
