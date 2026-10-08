import DocumentCopyPicker from "./DocumentCopyPicker";
import { appendCopiedLines, copyLine } from "../utils/documentCopy";
import { useState, useEffect, useRef } from "react";
import { MdAdd, MdDelete } from "react-icons/md";
import { createGoodsReceipt, updateGoodsReceipt, getGoodsReceiptById } from "../api/goodsReceiptApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getPurchaseBillsByCompanyPaged } from "../api/purchaseBillApi";
import { formStyles } from "../theme";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import AttachmentManager from "./AttachmentManager";
import useScrollToError from "../hooks/useScrollToError";
import DocumentNotesEditor from "./DocumentNotesEditor";
import BillNumberField, { billNumberPayload } from "./BillNumberField";
import SearchableClientSelect from "./SearchableClientSelect";
import SearchableSelect from "./SearchableSelect";
import { Button, IconButton, TableWrap } from "../ui/Kit";

export default function GoodsReceiptForm({ companyId, receiptId, onClose, onSaved }) {
  const isEdit = !!receiptId;
  const [suppliers, setSuppliers] = useState([]);
  const [bills, setBills] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [purchaseBillId, setPurchaseBillId] = useState("");
  // todayYmd() returns LOCAL "YYYY-MM-DD" so the date input doesn't pre-fill
  // with yesterday for users running in non-UTC zones at midnight–05:00.
  const [receiptDate, setReceiptDate] = useState(todayYmd());
  const [supplierChallanNumber, setSupplierChallanNumber] = useState("");
  const [site, setSite] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([{ id: 0, itemTypeId: null, description: "", quantity: 1, unit: "" }]);
  // Responsive: the line-item table side-scrolls on a phone, so below 760px
  // each line renders as a tap-friendly stacked card instead.
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 760);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const [saving, setSaving] = useState(false);
  const [numberMode, setNumberMode] = useState("auto");
  const [currentNumber, setCurrentNumber] = useState(null);
  const [customNumber, setCustomNumber] = useState("");
  const [numberValid, setNumberValid] = useState(true);
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

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await getGoodsReceiptById(receiptId);
        setCurrentNumber(data.goodsReceiptNumber);
        setCustomNumber(String(data.goodsReceiptNumber));
        setSupplierId(String(data.supplierId));
        setPurchaseBillId(data.purchaseBillId ? String(data.purchaseBillId) : "");
        setReceiptDate(data.receiptDate.slice(0, 10));
        setSupplierChallanNumber(data.supplierChallanNumber || "");
        setSite(data.site || "");
        setNotes(data.notes || "");
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
    if (saving || !numberValid) return;
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
        customNumber: billNumberPayload(isEdit ? "custom" : numberMode, customNumber),
        supplierId: parseInt(supplierId),
        purchaseBillId: purchaseBillId ? parseInt(purchaseBillId) : null,
        supplierChallanNumber: supplierChallanNumber || null,
        site: site || null,
        notes: notes.trim() || null,
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
      // Upload any files staged before the receipt had an id (no-op on edit /
      // when nothing was staged). Best-effort — the receipt is already saved.
      const savedId = res.data?.id ?? receiptId;
      if (savedId) { try { await attachmentRef.current?.flush(savedId); } catch { /* attachments best-effort */ } }
      onSaved(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save receipt.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: 1000, width: "94vw" }}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? "Edit Goods Receipt" : "New Goods Receipt"}</h5>
          <button data-admin-close="" style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ ...formStyles.body, maxHeight: "75vh", overflowY: "auto" }}>
            <DocumentCopyPicker companyId={companyId} destination="GoodsReceipt" allowDetails={!isEdit} disabled={!!purchaseBillId}
              onCopy={(source,lines,details) => {
                setItems(prev => appendCopiedLines(details ? [] : prev, lines, () => ({id:0,itemTypeId:null,description:"",quantity:1,unit:""})));
                if(details) { setSupplierId(String(source.supplierId));setNotes(source.notes||"");setSite(source.site||"");setSupplierChallanNumber("");setPurchaseBillId(""); }
              }} />
            {error && <div ref={errRef} style={formStyles.error}>{error}</div>}
            {<div style={{ maxWidth: 360, marginBottom: "0.75rem" }}><BillNumberField companyId={companyId} documentType="goods-receipt" variant={isEdit ? "edit" : "create"} currentNumber={currentNumber} editRecordId={receiptId} mode={numberMode} onModeChange={setNumberMode} number={customNumber} onNumberChange={setCustomNumber} onValidityChange={setNumberValid} disabled={saving} /></div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier *</label>
                <SearchableClientSelect
                  clients={suppliers}
                  value={supplierId}
                  onChange={(id) => setSupplierId(String(id))}
                  placeholder="Select..."
                  noun="suppliers"
                  ariaLabel="Supplier"
                />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Receipt Date *</label>
                <input type="date" style={formStyles.input} value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Linked Purchase Bill</label>
                <SearchableSelect
                  items={billsForSupplier.map(b => ({ id: b.id, label: `PB #${b.purchaseBillNumber}` }))}
                  value={purchaseBillId}
                  onChange={(id) => setPurchaseBillId(String(id))}
                  labelKey="label"
                  placeholder="— optional —"
                  ariaLabel="Linked Purchase Bill"
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier Challan #</label>
                <input type="text" style={formStyles.input} value={supplierChallanNumber} onChange={e => setSupplierChallanNumber(e.target.value)} />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Receiving Site</label>
                <input type="text" style={formStyles.input} value={site} onChange={e => setSite(e.target.value)} />
              </div>
            </div>

            <DocumentNotesEditor value={notes} onChange={setNotes} />
            <div style={itemsBox}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <strong style={{ color: "var(--k-ink)" }}>Items ({items.length})</strong>
                <Button size="sm" icon={MdAdd} onClick={() => setItems([...items, { id: 0, itemTypeId: null, description: "", quantity: 1, unit: "" }])}>Add line</Button>
              </div>
              {isNarrow ? (
                <div style={mStyles.cards}>
                  {items.map((it, idx) => (
                    <div key={idx} style={mStyles.card}>
                      <div style={mStyles.head}>
                        <div style={{ flex: 1 }}>
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
                            style={{ padding: "0.4rem 0.55rem", fontSize: "0.82rem" }}
                          />
                        </div>
                        <button type="button" title="Copy line" style={{minHeight:44,minWidth:44,border:"1px solid #d0d7e2",borderRadius:8}} onClick={() => setItems(prev => [...prev,copyLine(it,() => ({id:0,itemTypeId:null,description:"",quantity:1,unit:""}))])}>Copy</button>
                          {items.length > 1 && (
                          <IconButton label="Remove line" icon={MdDelete} danger onClick={() => setItems(items.filter((_, i) => i !== idx))} />
                        )}
                      </div>
                      <div style={{ marginBottom: "0.4rem" }}>
                        <label style={mStyles.label}>Description *</label>
                        <input type="text" style={cellInput} value={it.description} onChange={e => updateItem(idx, "description", e.target.value)} />
                      </div>
                      <div style={mStyles.grid2}>
                        <div>
                          <label style={mStyles.label}>Qty *</label>
                          <input type="number" min={1} style={{ ...cellInput, textAlign: "right" }} value={it.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} />
                        </div>
                        <div>
                          <label style={mStyles.label}>UOM</label>
                          <input type="text" style={cellInput} value={it.unit} onChange={e => updateItem(idx, "unit", e.target.value)} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
              <TableWrap data-admin-table-region="">
              <table className="k-table k-table--compact">
                <thead>
                  <tr>
                    <th>Item Type</th>
                    <th>Description *</th>
                    <th className="k-num" style={{ width: 80 }}>Qty *</th>
                    <th style={{ width: 100 }}>UOM</th>
                    <th style={{ width: 36 }}></th>
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
                        <button type="button" title="Copy line" style={{minHeight:44,minWidth:44,border:"1px solid #d0d7e2",borderRadius:8}} onClick={() => setItems(prev => [...prev,copyLine(it,() => ({id:0,itemTypeId:null,description:"",quantity:1,unit:""}))])}>Copy</button>
                          {items.length > 1 && (
                          <IconButton label="Remove line" icon={MdDelete} size={16} danger onClick={() => setItems(items.filter((_, i) => i !== idx))} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableWrap>
              )}
            </div>

            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager ref={attachmentRef} companyId={companyId} entityType="GoodsReceipt" entityId={receiptId ?? null} mode="edit" />
            </div>
          </div>
          <div style={formStyles.footer}>
            <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" disabled={saving || !numberValid} style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving..." : (isEdit ? "Update" : "Create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Line-item editor layout: the table is a kit k-table; cells stay top-aligned and the
// cell inputs stay compact in every theme.
const td = { verticalAlign: "top" };
const cellInput = { width: "100%", padding: "0.3rem 0.5rem", fontSize: "var(--k-font-sm)", border: "1px solid var(--k-line-strong)", borderRadius: 6, backgroundColor: "var(--k-input-bg)", color: "var(--k-ink)", outline: "none" };
const itemsBox = { marginTop: "0.75rem", padding: "0.75rem", borderRadius: "var(--k-radius)", border: "1px solid var(--k-line)", backgroundColor: "var(--k-surface-2)" };
// Mobile stacked-card line items (rendered below 760px instead of the table).
const mStyles = {
  cards: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  card: { border: "1px solid var(--k-line)", borderRadius: "var(--k-radius)", padding: "0.7rem 0.75rem", background: "var(--k-surface)" },
  head: { display: "flex", alignItems: "flex-start", gap: "0.5rem", marginBottom: "0.5rem" },
  label: { display: "block", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--k-muted)", fontWeight: 700, marginBottom: "0.2rem" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.4rem" },
};
