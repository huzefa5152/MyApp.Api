import { useState, useEffect } from "react";
import { MdAdd, MdDelete } from "react-icons/md";
import { createGoodsReceipt, updateGoodsReceipt, getGoodsReceiptById } from "../api/goodsReceiptApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getPurchaseBillsByCompanyPaged } from "../api/purchaseBillApi";
import { formStyles } from "../theme";
import { notify } from "../utils/notify";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";

export default function GoodsReceiptForm({ companyId, receiptId, onClose, onSaved }) {
  const isEdit = !!receiptId;
  const [suppliers, setSuppliers] = useState([]);
  const [bills, setBills] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [purchaseBillId, setPurchaseBillId] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierChallanNumber, setSupplierChallanNumber] = useState("");
  const [site, setSite] = useState("");
  const [items, setItems] = useState([{ id: 0, itemTypeId: null, description: "", quantity: 1, unit: "" }]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [sRes, tRes, bRes] = await Promise.all([
          getSuppliersByCompany(companyId),
          getItemTypes(),
          getPurchaseBillsByCompanyPaged(companyId, { page: 1, pageSize: 100 }),
        ]);
        setSuppliers(sRes.data || []);
        setItemTypes(tRes.data || []);
        setBills(bRes.data?.items || []);
      } catch { setError("Failed to load reference data."); }
    })();
  }, [companyId]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await getGoodsReceiptById(receiptId);
        setSupplierId(String(data.supplierId));
        setPurchaseBillId(data.purchaseBillId ? String(data.purchaseBillId) : "");
        setReceiptDate(data.receiptDate.slice(0, 10));
        setSupplierChallanNumber(data.supplierChallanNumber || "");
        setSite(data.site || "");
        setItems((data.items || []).map(i => ({ id: i.id, itemTypeId: i.itemTypeId, description: i.description, quantity: i.quantity, unit: i.unit })));
      } catch { setError("Failed to load receipt."); }
    })();
  }, [receiptId, isEdit]);

  const billsForSupplier = bills.filter(b => !supplierId || b.supplierId === parseInt(supplierId));

  const updateItem = (idx, field, value) => {
    setItems(prev => {
      const next = [...prev]; next[idx] = { ...next[idx], [field]: value }; return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!supplierId) return setError("Select a supplier.");
    if (items.length === 0) return setError("Add at least one item.");
    if (items.some(i => !i.description?.trim())) return setError("Every line needs a description.");
    if (items.some(i => !(parseInt(i.quantity) > 0))) return setError("Quantity must be greater than zero.");
    setSaving(true);
    try {
      const payload = {
        receiptDate,
        companyId,
        supplierId: parseInt(supplierId),
        purchaseBillId: purchaseBillId ? parseInt(purchaseBillId) : null,
        supplierChallanNumber: supplierChallanNumber || null,
        site: site || null,
        items: items.map(i => ({
          id: i.id || 0,
          itemTypeId: i.itemTypeId || null,
          description: i.description?.trim(),
          quantity: parseInt(i.quantity),
          unit: i.unit || "",
        })),
      };
      const res = isEdit
        ? await updateGoodsReceipt(receiptId, { ...payload, status: undefined })
        : await createGoodsReceipt(payload);
      notify(`Goods Receipt ${isEdit ? "updated" : "created"}.`, "success");
      onSaved(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save receipt.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: 1000, width: "94vw" }}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? "Edit Goods Receipt" : "New Goods Receipt"}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ ...formStyles.body, maxHeight: "75vh", overflowY: "auto" }}>
            {error && <div style={formStyles.error}>{error}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier *</label>
                <select style={formStyles.input} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                  <option value="">Select...</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Receipt Date *</label>
                <input type="date" style={formStyles.input} value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Linked Purchase Bill</label>
                <select style={formStyles.input} value={purchaseBillId} onChange={e => setPurchaseBillId(e.target.value)}>
                  <option value="">— optional —</option>
                  {billsForSupplier.map(b => <option key={b.id} value={b.id}>PB #{b.purchaseBillNumber}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier Challan #</label>
                <input type="text" style={formStyles.input} value={supplierChallanNumber} onChange={e => setSupplierChallanNumber(e.target.value)} />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Receiving Site</label>
                <input type="text" style={formStyles.input} value={site} onChange={e => setSite(e.target.value)} />
              </div>
            </div>

            <div style={{ marginTop: "0.75rem", padding: "0.75rem", borderRadius: 10, border: "1px solid #e8edf3", backgroundColor: "#f8f9fb" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <strong>Items ({items.length})</strong>
                <button type="button" onClick={() => setItems([...items, { id: 0, itemTypeId: null, description: "", quantity: 1, unit: "" }])} style={{ ...formStyles.button, padding: "0.3rem 0.65rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.25rem", background: "#e3f2fd", color: "#0d47a1", border: "none" }}>
                  <MdAdd size={14} /> Add line
                </button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f5f8fc" }}>
                    <th style={th}>Item Type</th>
                    <th style={th}>Description *</th>
                    <th style={{ ...th, textAlign: "right", width: 80 }}>Qty *</th>
                    <th style={{ ...th, width: 100 }}>UOM</th>
                    <th style={{ ...th, width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td style={td}>
                        <SearchableItemTypeSelect
                          items={itemTypes}
                          value={it.itemTypeId || ""}
                          onChange={(newId, picked) => {
                            updateItem(idx, "itemTypeId", newId ? parseInt(newId) : null);
                            if (picked) {
                              if (!it.description?.trim()) updateItem(idx, "description", picked.name || "");
                              if (picked.uom) updateItem(idx, "unit", picked.uom);
                            }
                          }}
                          placeholder="— optional —"
                          style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                        />
                      </td>
                      <td style={td}><input type="text" style={cellInput} value={it.description} onChange={e => updateItem(idx, "description", e.target.value)} /></td>
                      <td style={td}><input type="number" min={1} style={{ ...cellInput, textAlign: "right" }} value={it.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} /></td>
                      <td style={td}><input type="text" style={cellInput} value={it.unit} onChange={e => updateItem(idx, "unit", e.target.value)} /></td>
                      <td style={td}>
                        {items.length > 1 && (
                          <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#c62828", cursor: "pointer", padding: 0 }}>
                            <MdDelete size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
