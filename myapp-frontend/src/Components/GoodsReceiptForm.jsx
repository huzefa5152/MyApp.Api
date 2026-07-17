import { useState, useEffect, useRef } from "react";
import { MdAdd, MdDelete } from "react-icons/md";
import { createGoodsReceipt, updateGoodsReceipt, getGoodsReceiptById } from "../api/goodsReceiptApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getNonInventoryItemsByCompany } from "../api/nonInventoryItemApi";
import { getPurchaseBillsByCompanyPaged } from "../api/purchaseBillApi";
import { formStyles } from "../theme";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import BulkItemTypeBar from "./BulkItemTypeBar";
import SearchableSelect from "./SearchableSelect";
import DivisionSelect from "./DivisionSelect";
import AttachmentManager from "./AttachmentManager";
import { usePermissions } from "../contexts/PermissionsContext";

export default function GoodsReceiptForm({ companyId, receiptId, onClose, onSaved, defaultDivisionId }) {
  const isEdit = !!receiptId;
  const { has } = usePermissions();
  const canViewDivisions = has("divisions.manage.view");
  // New receipts default to the division currently being filtered (so "filter
  // to a division → New Receipt" lands in that division); edits hydrate from
  // the loaded receipt below.
  const [divisionId, setDivisionId] = useState(!isEdit && defaultDivisionId ? String(defaultDivisionId) : "");
  const [suppliers, setSuppliers] = useState([]);
  const [bills, setBills] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [nonInvItems, setNonInvItems] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [purchaseBillId, setPurchaseBillId] = useState("");
  // todayYmd() returns LOCAL "YYYY-MM-DD" so the date input doesn't pre-fill
  // with yesterday for users running in non-UTC zones at midnight–05:00.
  const [receiptDate, setReceiptDate] = useState(todayYmd());
  const [supplierChallanNumber, setSupplierChallanNumber] = useState("");
  const [site, setSite] = useState("");
  const [items, setItems] = useState([{ id: 0, itemTypeId: null, nonInventoryItemId: null, description: "", quantity: 1, unit: "" }]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const attachmentRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [sRes, tRes, bRes] = await Promise.all([
          getSuppliersByCompany(companyId),
          getItemTypes(companyId),
          getPurchaseBillsByCompanyPaged(companyId, { page: 1, pageSize: 100 }),
        ]);
        setSuppliers(sRes.data || []);
        setItemTypes(tRes.data || []);
        setBills(bRes.data?.items || []);
      } catch { setError("Failed to load reference data."); }
    })();
  }, [companyId]);

  // Per-company Non-Inventory Items (GL-account shortcut lines: Freight, Discount, …).
  // A company with GL off / no items resolves to [] and the picker shows none.
  useEffect(() => {
    if (!companyId) { setNonInvItems([]); return; }
    getNonInventoryItemsByCompany(companyId, true).then(({ data }) => setNonInvItems(data || [])).catch(() => setNonInvItems([]));
  }, [companyId]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await getGoodsReceiptById(receiptId);
        setSupplierId(String(data.supplierId));
        setDivisionId(data.divisionId ? String(data.divisionId) : "");
        setPurchaseBillId(data.purchaseBillId ? String(data.purchaseBillId) : "");
        setReceiptDate(data.receiptDate.slice(0, 10));
        setSupplierChallanNumber(data.supplierChallanNumber || "");
        setSite(data.site || "");
        setItems((data.items || []).map(i => ({ id: i.id, itemTypeId: i.itemTypeId, nonInventoryItemId: i.nonInventoryItemId ?? null, description: i.description, quantity: i.quantity, unit: i.unit })));
      } catch { setError("Failed to load receipt."); }
    })();
  }, [receiptId, isEdit]);

  const billsForSupplier = bills.filter(b => !supplierId || b.supplierId === parseInt(supplierId));

  const updateItem = (idx, field, value) => {
    setItems(prev => {
      const next = [...prev]; next[idx] = { ...next[idx], [field]: value }; return next;
    });
  };

  // Non-Inventory pick — mutually exclusive with an item type. Records the
  // non-inv id, clears any itemTypeId, and prefills description / unit only
  // when empty (goods receipts are qty-only, so ignore price).
  const pickNonInventory = (idx, n) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      if (!n) return { ...it, nonInventoryItemId: null };
      const next = { ...it, nonInventoryItemId: n.id, itemTypeId: null };
      if (!it.description?.trim()) next.description = n.defaultLineDescription || n.name || "";
      if (!it.unit?.trim()) next.unit = n.unitName || "";
      return next;
    }));
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
        divisionId: divisionId ? parseInt(divisionId) : null,
        supplierId: parseInt(supplierId),
        purchaseBillId: purchaseBillId ? parseInt(purchaseBillId) : null,
        supplierChallanNumber: supplierChallanNumber || null,
        site: site || null,
        items: items.map(i => ({
          id: i.id || 0,
          itemTypeId: i.itemTypeId || null,
          nonInventoryItemId: i.nonInventoryItemId || null,
          description: i.description?.trim(),
          quantity: parseInt(i.quantity),
          unit: i.unit || "",
        })),
      };
      const res = isEdit
        ? await updateGoodsReceipt(receiptId, { ...payload, status: undefined })
        : await createGoodsReceipt(payload);
      // Upload any attachments staged before the receipt had an id. No-op in
      // edit mode (there they upload immediately) and when nothing's staged.
      try {
        const savedId = res.data?.id ?? receiptId;
        if (savedId) await attachmentRef.current?.flush(savedId);
      } catch { /* attachments are best-effort — the receipt is already saved */ }
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
              <div style={{ ...formStyles.formGroup, gridColumn: "1 / -1" }}>
                <label style={formStyles.label}>Supplier *</label>
                <SearchableSelect
                  items={suppliers}
                  value={supplierId}
                  onChange={(id) => setSupplierId(id ? String(id) : "")}
                  placeholder="Select supplier…"
                />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Receipt Date *</label>
                <input type="date" style={formStyles.input} value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
              </div>
              {canViewDivisions && (
                <div style={formStyles.formGroup}>
                  <DivisionSelect companyId={companyId} value={divisionId} onChange={setDivisionId} mode="select" label={<>Division <span style={{ fontWeight: 400 }}>(optional)</span></>} labelStyle={formStyles.label} style={formStyles.input} />
                </div>
              )}
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
                <button type="button" onClick={() => setItems([...items, { id: 0, itemTypeId: null, nonInventoryItemId: null, description: "", quantity: 1, unit: "" }])} style={{ ...formStyles.button, padding: "0.3rem 0.65rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.25rem", background: "#e3f2fd", color: "#0d47a1", border: "none" }}>
                  <MdAdd size={14} /> Add line
                </button>
              </div>
              <BulkItemTypeBar items={items} setItems={setItems} itemTypes={itemTypes} nonInventoryItems={nonInvItems} divisionId={divisionId} />
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
                          divisionId={divisionId}
                          items={itemTypes}
                          value={it.itemTypeId || ""}
                          onChange={(newId, picked) => {
                            // Picking an item type clears any non-inv binding (mutually exclusive).
                            updateItem(idx, "nonInventoryItemId", null);
                            updateItem(idx, "itemTypeId", newId ? parseInt(newId) : null);
                            if (picked) {
                              if (!it.description?.trim()) updateItem(idx, "description", picked.name || "");
                              if (picked.uom) updateItem(idx, "unit", picked.uom);
                            }
                          }}
                          nonInventoryItems={nonInvItems}
                          nonInventoryValue={it.nonInventoryItemId || ""}
                          onPickNonInventory={(n) => pickNonInventory(idx, n)}
                          placeholder="— optional —"
                          style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                        />
                      </td>
                      <td style={td}><textarea rows={2} style={{ ...cellInput, resize: "vertical", minHeight: 38, lineHeight: 1.4 }} value={it.description} onChange={e => updateItem(idx, "description", e.target.value)} /></td>
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

            <AttachmentManager
              ref={attachmentRef}
              companyId={companyId}
              entityType="GoodsReceipt"
              entityId={receiptId ?? null}
              mode="edit"
            />
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
