import { useState, useEffect, useMemo } from "react";
import { MdAdd, MdDelete, MdReceipt } from "react-icons/md";
import { createPurchaseBill, updatePurchaseBill, getPurchaseBillById } from "../api/purchaseBillApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getPurchaseTemplate } from "../api/invoiceApi";
import { formStyles } from "../theme";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

export default function PurchaseBillForm({ companyId, billId, onClose, onSaved, prefillFromInvoiceId = null }) {
  const isEdit = !!billId;
  const isAgainstSale = !!prefillFromInvoiceId;
  const [suppliers, setSuppliers] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [supplierBillNumber, setSupplierBillNumber] = useState("");
  const [supplierIRN, setSupplierIRN] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [items, setItems] = useState([newRow()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Source-bill metadata when in "Purchase Against Sale" mode
  const [sourceBill, setSourceBill] = useState(null);

  function newRow() {
    return {
      id: 0, itemTypeId: null, description: "", quantity: 1, unitPrice: 0,
      uom: "", hsCode: "", saleType: "",
      sourceInvoiceItemIds: [],
      // metadata used only when in against-sale mode (not sent to API)
      _saleSoldQty: 0, _saleProcuredQty: 0, _saleRemaining: 0, _saleLineCount: 0,
    };
  }

  // For the against-sale flow, the ItemType picker MUST filter to items
  // that have an HSCode — procurement is an FBR-compliance moment, not
  // a re-classification with a placeholder. For the standalone flow,
  // any catalog item is fine.
  const eligibleItemTypes = useMemo(() => {
    if (!isAgainstSale) return itemTypes;
    return itemTypes.filter(it => it.hsCode && it.hsCode.trim().length > 0);
  }, [itemTypes, isAgainstSale]);

  useEffect(() => {
    (async () => {
      try {
        const [sRes, tRes] = await Promise.all([
          getSuppliersByCompany(companyId),
          getItemTypes(),
        ]);
        setSuppliers(sRes.data || []);
        setItemTypes(tRes.data || []);
      } catch {
        setError("Failed to load suppliers or item types.");
      }
    })();
  }, [companyId]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await getPurchaseBillById(billId);
        setSupplierId(String(data.supplierId));
        setDate(data.date.slice(0, 10));
        setSupplierBillNumber(data.supplierBillNumber || "");
        setSupplierIRN(data.supplierIRN || "");
        setGstRate(data.gstRate);
        setPaymentTerms(data.paymentTerms || "");
        setPaymentMode(data.paymentMode || "");
        setItems((data.items || []).map(i => ({
          id: i.id, itemTypeId: i.itemTypeId, description: i.description,
          quantity: i.quantity, unitPrice: i.unitPrice, uom: i.uom,
          hsCode: i.hsCode || "", saleType: i.saleType || "",
          sourceInvoiceItemIds: i.sourceInvoiceItemIds || [],
        })));
      } catch {
        setError("Failed to load purchase bill.");
      }
    })();
  }, [billId, isEdit]);

  // "Purchase Against Sale Bill" mode — load the grouped template and
  // populate items. Each row represents a group of sale lines with the
  // same ItemType (HSCode-empty). Operator picks an FBR-compliant
  // ItemType to procure under; on save, every linked sale line gets
  // back-filled with HSCode/UOM/SaleType.
  useEffect(() => {
    if (!prefillFromInvoiceId) return;
    (async () => {
      try {
        const { data } = await getPurchaseTemplate(prefillFromInvoiceId);
        setSourceBill({
          invoiceId: data.invoiceId,
          invoiceNumber: data.invoiceNumber,
          date: data.date,
          clientName: data.clientName,
        });
        if (!data.items || data.items.length === 0) {
          setError("This sale bill has no lines awaiting procurement.");
          setItems([]);
          return;
        }
        setItems(data.items.map(g => ({
          id: 0,
          itemTypeId: null,            // operator MUST pick an HSCode'd item
          description: g.description,  // shows e.g. "Paracetamol (+ 27 more)"
          quantity: g.remainingQty,
          unitPrice: g.avgSaleUnitPrice || 0,
          uom: g.saleUom || "",
          hsCode: "",
          saleType: "",
          sourceInvoiceItemIds: g.invoiceItemIds || [],
          _saleSoldQty: g.soldQty,
          _saleProcuredQty: g.purchasedQty,
          _saleRemaining: g.remainingQty,
          _saleLineCount: g.lineCount,
          _originalItemTypeId: g.itemTypeId,
          _originalItemTypeName: g.itemTypeName,
        })));
      } catch {
        setError("Failed to load purchase template for the chosen sale bill.");
      }
    })();
  }, [prefillFromInvoiceId]);

  const subtotal = useMemo(
    () => items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0), 0),
    [items]
  );
  const gstAmount = useMemo(
    () => Math.round(subtotal * (parseFloat(gstRate) || 0) / 100 * 100) / 100,
    [subtotal, gstRate]
  );
  const grandTotal = subtotal + gstAmount;

  const updateItem = (idx, field, value) => {
    setItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const pickItemType = (idx, newId, picked) => {
    setItems(prev => {
      const next = [...prev];
      const r = { ...next[idx], itemTypeId: newId ? parseInt(newId) : null };
      if (picked) {
        if (picked.uom) r.uom = picked.uom;
        if (picked.hsCode) r.hsCode = picked.hsCode;
        if (picked.saleType) r.saleType = picked.saleType;
        if (!r.description?.trim() && picked.name) r.description = picked.name;
      } else {
        r.uom = ""; r.hsCode = ""; r.saleType = "";
      }
      next[idx] = r;
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!supplierId) return setError("Select a supplier.");
    if (items.length === 0) return setError("Add at least one item.");
    if (items.some(i => !i.description?.trim())) return setError("Every line needs a description.");
    if (items.some(i => !(parseInt(i.quantity) > 0))) return setError("Quantity must be greater than zero on every line.");
    if (items.some(i => parseFloat(i.unitPrice) < 0)) return setError("Unit price cannot be negative.");
    if (isAgainstSale) {
      // In the "Purchase Against Sale" flow every row MUST have an
      // ItemType picked — that's the whole point (binding the sale's
      // unclassified items to a real catalog item with HSCode).
      const unbound = items.filter(i => !i.itemTypeId);
      if (unbound.length > 0)
        return setError("Pick an FBR-compliant Item Type (with HS Code) for every row.");
    }
    setSaving(true);
    try {
      const payload = {
        date,
        companyId,
        supplierId: parseInt(supplierId),
        supplierBillNumber: supplierBillNumber || null,
        supplierIRN: supplierIRN || null,
        gstRate: parseFloat(gstRate),
        paymentTerms: paymentTerms || null,
        paymentMode: paymentMode || null,
        items: items.map(i => ({
          id: i.id || 0,
          itemTypeId: i.itemTypeId || null,
          description: i.description?.trim(),
          quantity: parseInt(i.quantity),
          unitPrice: parseFloat(i.unitPrice),
          uom: i.uom || null,
          hsCode: i.hsCode || null,
          saleType: i.saleType || null,
          sourceInvoiceItemIds: i.sourceInvoiceItemIds || [],
        })),
      };
      const res = isEdit
        ? await updatePurchaseBill(billId, payload)
        : await createPurchaseBill(payload);
      notify(`Purchase bill ${isEdit ? "updated" : "created"}.`, "success");
      onSaved(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Failed to save purchase bill.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: 1200, width: "96vw" }}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? "Edit Purchase Bill" : "New Purchase Bill"}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ ...formStyles.body, maxHeight: "75vh", overflowY: "auto" }}>
            {error && <div style={formStyles.error}>{error}</div>}

            {sourceBill && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: "0.65rem",
                padding: "0.7rem 0.95rem", marginBottom: "0.85rem",
                backgroundColor: "#fff8e1", border: "1px solid #ffcc80",
                borderRadius: 8,
              }}>
                <MdReceipt size={20} color="#bf360c" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: "0.84rem", color: "#1a2332", lineHeight: 1.4 }}>
                  <strong>Procuring against Sale Bill #{sourceBill.invoiceNumber}</strong>
                  {" "}for <strong>{sourceBill.clientName}</strong>
                  {" "}({new Date(sourceBill.date).toLocaleDateString()})
                  <div style={{ fontSize: "0.76rem", color: "#5f6d7e", marginTop: 2 }}>
                    Each row groups same-ItemType sale lines. Pick an HS-coded catalog item per row —
                    on save, every linked sale line back-fills with that HSCode / UOM / Sale Type and
                    becomes FBR-ready.
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier *</label>
                <select style={formStyles.input} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                  <option value="">Select supplier...</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Bill Date *</label>
                <input type="date" style={formStyles.input} value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>GST Rate (%)</label>
                <input type="number" min={0} step={0.01} style={formStyles.input} value={gstRate} onChange={e => setGstRate(e.target.value)} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier Bill #</label>
                <input type="text" style={formStyles.input} value={supplierBillNumber} onChange={e => setSupplierBillNumber(e.target.value)} placeholder="Their invoice number" />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier IRN</label>
                <input type="text" style={{ ...formStyles.input, fontFamily: "monospace" }} value={supplierIRN} onChange={e => setSupplierIRN(e.target.value)} placeholder="From supplier's tax invoice (FBR-issued)" />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Payment Mode</label>
                <select style={formStyles.input} value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>
                  <option value="">— optional —</option>
                  <option value="Cash">Cash</option>
                  <option value="Credit">Credit</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Online">Online</option>
                </select>
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Payment Terms</label>
                <input type="text" style={formStyles.input} value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30" />
              </div>
            </div>

            <div style={{ marginTop: "0.75rem", padding: "0.75rem", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, backgroundColor: colors.inputBg }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <strong style={{ color: colors.textPrimary }}>Items ({items.length})</strong>
                <button type="button" onClick={() => setItems([...items, newRow()])} style={{ ...formStyles.button, padding: "0.3rem 0.65rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.25rem", background: "#e3f2fd", color: "#0d47a1", border: "none" }}>
                  <MdAdd size={14} /> Add line
                </button>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f5f8fc" }}>
                      <th style={th}>Item Type (FBR catalog)</th>
                      <th style={th}>Description *</th>
                      <th style={{ ...th, textAlign: "right", width: 70 }}>Qty *</th>
                      <th style={{ ...th, textAlign: "right", width: 100 }}>Unit Price *</th>
                      <th style={{ ...th, width: 100 }}>UOM</th>
                      <th style={{ ...th, textAlign: "right", width: 110 }}>Line Total</th>
                      <th style={{ ...th, width: 36 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const lineTotal = (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0);
                      const linkedToSale = (it.sourceInvoiceItemIds?.length || 0) > 0;
                      return (
                        <tr key={idx}>
                          <td style={td}>
                            <SearchableItemTypeSelect
                              items={eligibleItemTypes}
                              value={it.itemTypeId || ""}
                              onChange={(newId, picked) => pickItemType(idx, newId, picked)}
                              placeholder={isAgainstSale ? "— pick item with HS Code —" : "— optional —"}
                              style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem",
                                       ...(isAgainstSale && !it.itemTypeId ? { borderColor: "#dc3545" } : {}) }}
                            />
                            {linkedToSale && (
                              <div style={{ fontSize: "0.7rem", color: "#5f6d7e", marginTop: 2 }}>
                                {it._saleLineCount > 1
                                  ? `${it._saleLineCount} sale lines, was: ${it._originalItemTypeName || "—"}`
                                  : `1 sale line, was: ${it._originalItemTypeName || "—"}`}
                                {it._saleProcuredQty > 0 && ` · already procured ${it._saleProcuredQty} of ${it._saleSoldQty}`}
                              </div>
                            )}
                          </td>
                          <td style={td}>
                            <input type="text" style={cellInput} value={it.description} onChange={e => updateItem(idx, "description", e.target.value)} />
                          </td>
                          <td style={td}>
                            <input type="number" min={1} style={{ ...cellInput, textAlign: "right" }} value={it.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} />
                          </td>
                          <td style={td}>
                            <input type="number" min={0} step={0.01} style={{ ...cellInput, textAlign: "right" }} value={it.unitPrice} onChange={e => updateItem(idx, "unitPrice", e.target.value)} />
                          </td>
                          <td style={td}>
                            <input type="text" style={cellInput} value={it.uom} onChange={e => updateItem(idx, "uom", e.target.value)} />
                          </td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td style={td}>
                            {items.length > 1 && (
                              <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#c62828", cursor: "pointer", padding: 0 }}>
                                <MdDelete size={16} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ marginTop: "1rem", padding: "0.75rem 1rem", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#f8faff", display: "grid", gridTemplateColumns: "1fr auto auto", rowGap: "0.35rem", columnGap: "1rem" }}>
              <span style={{ color: colors.textSecondary }}>Subtotal:</span>
              <span></span>
              <strong>Rs. {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
              <span style={{ color: colors.textSecondary }}>GST ({gstRate}%):</span>
              <span></span>
              <strong>Rs. {gstAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
              <span style={{ color: colors.textPrimary, fontWeight: 700, fontSize: "1rem" }}>Grand Total:</span>
              <span></span>
              <strong style={{ fontSize: "1.05rem", color: colors.blue }}>Rs. {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
            </div>
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" disabled={saving} style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving..." : (isEdit ? "Update" : "Create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const th = { textAlign: "left", padding: "0.45rem 0.55rem", borderBottom: "1px solid #e8edf3", fontSize: "0.74rem", fontWeight: 700, color: "#5f6d7e", textTransform: "uppercase", letterSpacing: "0.04em" };
const td = { padding: "0.4rem 0.45rem", borderBottom: "1px solid #f3f5f9", verticalAlign: "top" };
const cellInput = { width: "100%", padding: "0.3rem 0.5rem", fontSize: "0.8rem", border: "1px solid #d0d7e2", borderRadius: 6, backgroundColor: "#f8f9fb", color: "#1a2332", outline: "none" };
