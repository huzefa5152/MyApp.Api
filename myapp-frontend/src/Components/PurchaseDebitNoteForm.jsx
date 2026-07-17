import { useState, useEffect, useMemo } from "react";
import { MdAdd, MdDelete } from "react-icons/md";
import { createPurchaseDebitNote, updatePurchaseDebitNote, getPurchaseDebitNoteById } from "../api/purchaseDebitNoteApi";
import { getPurchaseBillsByCompanyPaged, getPurchaseBillById } from "../api/purchaseBillApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getAllUnits } from "../api/unitsApi";
import { getAccountsFlat } from "../api/accountApi";
import { formStyles } from "../theme";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import { defaultAccountPlaceholder } from "../utils/accountDisplay";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import BulkItemTypeBar from "./BulkItemTypeBar";
import SearchableSelect from "./SearchableSelect";
import DivisionSelect from "./DivisionSelect";
import AccountSelect from "./AccountSelect";
import { usePermissions } from "../contexts/PermissionsContext";
import QuantityInput from "./QuantityInput";

const colors = {
  blue: "#0d47a1",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
};

// Create/edit form for a supplier (purchase) debit note. A lean mirror of the
// purchase-bill form: header + a line grid where each line optionally carries an
// Item Type (reduces on-hand when the company tracks it) and/or a GL Account
// (else the engine derives it). Value-only lines (no item/account) are allowed.
export default function PurchaseDebitNoteForm({ companyId, company = null, noteId, onClose, onSaved, readOnly = false, defaultDivisionId = null }) {
  const isEdit = !!noteId;
  const { has } = usePermissions();
  const canViewDivisions = has("divisions.manage.view");

  const [suppliers, setSuppliers] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const glOn = accounts.length > 0;
  const [units, setUnits] = useState([]);

  const [supplierId, setSupplierId] = useState("");
  // Optional "Purchase Invoice" link (Manager-style): the selected supplier's
  // purchase bills; picking one prefills the lines + GST. The link isn't
  // persisted — it's an entry convenience that copies the bill onto the note.
  const [purchaseBills, setPurchaseBills] = useState([]);
  const [billId, setBillId] = useState("");
  const [prefilling, setPrefilling] = useState(false);
  const [divisionId, setDivisionId] = useState(!isEdit && defaultDivisionId ? String(defaultDivisionId) : "");
  const [date, setDate] = useState(todayYmd());
  const [gstRate, setGstRate] = useState(0);
  const [supplierRef, setSupplierRef] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([newRow()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function newRow() {
    return { id: 0, itemTypeId: null, accountId: null, description: "", quantity: 1, unitPrice: 0, uom: "", hsCode: "" };
  }

  useEffect(() => {
    (async () => {
      try {
        const [sRes, tRes, uRes] = await Promise.all([
          getSuppliersByCompany(companyId),
          getItemTypes(companyId),
          getAllUnits(),
        ]);
        setSuppliers(sRes.data || []);
        setItemTypes(tRes.data || []);
        setUnits(uRes.data || []);
      } catch {
        setError("Failed to load suppliers or item types.");
      }
    })();
  }, [companyId]);

  useEffect(() => {
    if (!companyId) { setAccounts([]); return; }
    getAccountsFlat(companyId)
      .then(({ data }) => setAccounts((data || []).filter((a) => a.isActive)))
      .catch(() => setAccounts([]));
  }, [companyId]);

  // Load the SELECTED supplier's purchase bills for the optional "Purchase
  // Invoice" picker (scoped to the supplier — you can't debit one supplier
  // against another's invoice). Cleared when no supplier is chosen.
  useEffect(() => {
    if (!companyId || !supplierId) { setPurchaseBills([]); return; }
    getPurchaseBillsByCompanyPaged(companyId, { supplierId: parseInt(supplierId), pageSize: 100 })
      .then(({ data }) => setPurchaseBills(data?.items || data?.data || []))
      .catch(() => setPurchaseBills([]));
  }, [companyId, supplierId]);

  // Picking a purchase bill copies its GST rate + lines onto the note.
  const prefillFromBill = async (id) => {
    setBillId(id);
    if (!id) return;
    setPrefilling(true);
    try {
      const { data } = await getPurchaseBillById(id);
      if (data.gstRate != null) setGstRate(data.gstRate);
      const rows = (data.items || []).map((i) => ({
        id: 0,
        itemTypeId: i.itemTypeId ?? null,
        accountId: i.accountId ?? null,
        description: i.description || "",
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        uom: i.uom || "",
        hsCode: i.hsCode || "",
      }));
      if (rows.length) setItems(rows);
    } catch {
      setError("Failed to load the selected purchase invoice.");
    } finally {
      setPrefilling(false);
    }
  };

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await getPurchaseDebitNoteById(noteId);
        setSupplierId(String(data.supplierId));
        setDivisionId(data.divisionId ? String(data.divisionId) : "");
        setDate(data.date.slice(0, 10));
        setGstRate(data.gstRate ?? 0);
        setSupplierRef(data.supplierRef || "");
        setNotes(data.notes || "");
        setItems((data.items || []).map((i) => ({
          id: i.id,
          itemTypeId: i.itemTypeId ?? null,
          accountId: i.accountId ?? null,
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          uom: i.uom || "",
          hsCode: i.hsCode || "",
        })));
      } catch {
        setError("Failed to load debit note.");
      }
    })();
  }, [noteId, isEdit]);

  const subtotal = useMemo(
    () => items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0), 0),
    [items]
  );
  const gstAmount = useMemo(
    () => Math.round(subtotal * (parseFloat(gstRate) || 0) / 100 * 100) / 100,
    [subtotal, gstRate]
  );
  const grandTotal = subtotal + gstAmount;

  const defaultPurchaseAccountLabel = defaultAccountPlaceholder(accounts, company?.defaultPurchaseAccountId);

  const updateItem = (idx, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const pickItemType = (idx, newId, picked) => {
    setItems((prev) => {
      const next = [...prev];
      const r = { ...next[idx], itemTypeId: newId ? parseInt(newId) : null };
      if (picked) {
        if (picked.uom) r.uom = picked.uom;
        if (picked.hsCode) r.hsCode = picked.hsCode;
        if (!r.description?.trim() && picked.name) r.description = picked.name;
        r.accountId = picked.purchaseAccountId ?? null;
      } else {
        r.uom = ""; r.hsCode = ""; r.accountId = null;
      }
      next[idx] = r;
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (readOnly) return;
    setError("");
    if (!supplierId) return setError("Select a supplier.");
    if (items.length === 0) return setError("Add at least one item.");
    if (items.some((i) => !i.description?.trim())) return setError("Every line needs a description.");
    if (items.some((i) => !(parseFloat(i.quantity) > 0))) return setError("Quantity must be greater than zero on every line.");
    if (items.some((i) => parseFloat(i.unitPrice) < 0)) return setError("Unit price cannot be negative.");
    setSaving(true);
    try {
      const payload = {
        date,
        companyId,
        divisionId: divisionId ? parseInt(divisionId) : null,
        supplierId: parseInt(supplierId),
        supplierRef: supplierRef || null,
        notes: notes || null,
        gstRate: parseFloat(gstRate) || 0,
        items: items.map((i) => ({
          itemTypeId: i.itemTypeId || null,
          accountId: i.accountId || null,
          description: i.description?.trim(),
          quantity: parseFloat(i.quantity) || 0,
          unitPrice: parseFloat(i.unitPrice),
          uom: i.uom || null,
          hsCode: i.hsCode || null,
        })),
      };
      const res = isEdit
        ? await updatePurchaseDebitNote(noteId, payload)
        : await createPurchaseDebitNote(payload);
      notify(`Purchase debit note ${isEdit ? "updated" : "created"}.`, "success");
      onSaved?.(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Failed to save debit note.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: 1100, width: "96vw" }}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{readOnly ? "View Purchase Debit Note" : (isEdit ? "Edit Purchase Debit Note" : "New Purchase Debit Note")}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ ...formStyles.body, maxHeight: "75vh", overflowY: "auto" }}>
            <fieldset disabled={readOnly} style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
              {error && <div style={formStyles.error}>{error}</div>}

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "0.75rem" }}>
                <div style={{ ...formStyles.formGroup, gridColumn: "1 / -1" }}>
                  <label style={formStyles.label}>Supplier *</label>
                  <SearchableSelect
                    items={suppliers}
                    value={supplierId}
                    onChange={(id) => { setSupplierId(id ? String(id) : ""); setBillId(""); }}
                    placeholder="Select supplier…"
                  />
                </div>
                <div style={{ ...formStyles.formGroup, gridColumn: "1 / -1" }}>
                  <label style={formStyles.label}>Purchase Invoice <span style={{ fontWeight: 400 }}>(optional — prefills lines &amp; GST)</span></label>
                  <select
                    style={{ ...formStyles.input, opacity: prefilling ? 0.6 : 1 }}
                    value={billId}
                    onChange={(e) => prefillFromBill(e.target.value)}
                    disabled={!supplierId || prefilling}
                  >
                    <option value="">
                      {!supplierId ? "— pick a supplier first —"
                        : purchaseBills.length ? "— select a bill to prefill —"
                        : "— no purchase invoices for this supplier —"}
                    </option>
                    {purchaseBills.map((b) => (
                      <option key={b.id} value={b.id}>
                        Bill #{b.purchaseBillNumber} · {new Date(b.date).toLocaleDateString()} · Rs {Number(b.grandTotal).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Date *</label>
                  <input type="date" style={formStyles.input} value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                {canViewDivisions && (
                  <div style={formStyles.formGroup}>
                    <DivisionSelect companyId={companyId} value={divisionId} onChange={setDivisionId} mode="select" label={<>Division <span style={{ fontWeight: 400 }}>(optional)</span></>} labelStyle={formStyles.label} style={formStyles.input} />
                  </div>
                )}
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>GST Rate (%)</label>
                  <input type="number" min={0} step={0.01} style={formStyles.input} value={gstRate} onChange={(e) => setGstRate(e.target.value)} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Supplier Reference</label>
                  <input type="text" style={formStyles.input} value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="Their document reference (optional)" />
                </div>
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Notes</label>
                  <input type="text" style={formStyles.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div style={{ marginTop: "0.75rem", padding: "0.75rem", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, backgroundColor: colors.inputBg }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <strong style={{ color: colors.textPrimary }}>Items ({items.length})</strong>
                  <button type="button" onClick={() => setItems([...items, newRow()])} style={{ ...formStyles.button, padding: "0.3rem 0.65rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.25rem", background: "#e3f2fd", color: "#0d47a1", border: "none" }}>
                    <MdAdd size={14} /> Add line
                  </button>
                </div>
                <BulkItemTypeBar items={items} setItems={setItems} itemTypes={itemTypes} nonInventoryItems={[]} divisionId={divisionId} />
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f5f8fc" }}>
                        <th style={th}>Item Type <span style={{ fontWeight: 400, textTransform: "none" }}>(optional — reduces stock)</span></th>
                        <th style={th}>Description *</th>
                        <th style={{ ...th, textAlign: "right", width: 120, minWidth: 120 }}>Qty *</th>
                        <th style={{ ...th, textAlign: "right", width: 100 }}>Unit Price *</th>
                        <th style={{ ...th, width: 100 }}>UOM</th>
                        {glOn && <th style={{ ...th, width: 170 }}>Account (GL)</th>}
                        <th style={{ ...th, textAlign: "right", width: 110 }}>Line Total</th>
                        <th style={{ ...th, width: 36 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => {
                        const lineTotal = (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0);
                        return (
                          <tr key={idx}>
                            <td style={td}>
                              <SearchableItemTypeSelect
                                divisionId={divisionId}
                                items={itemTypes}
                                value={it.itemTypeId || ""}
                                onChange={(newId, picked) => pickItemType(idx, newId, picked)}
                                placeholder="— optional —"
                                style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                              />
                            </td>
                            <td style={td}>
                              <textarea rows={2} style={{ ...cellInput, resize: "vertical", minHeight: 38, lineHeight: 1.4 }} value={it.description} onChange={(e) => updateItem(idx, "description", e.target.value)} />
                            </td>
                            <td style={td}>
                              <QuantityInput
                                value={it.quantity}
                                onChange={(val) => updateItem(idx, "quantity", val)}
                                unit={it.uom}
                                units={units}
                                style={{ ...cellInput, textAlign: "right" }}
                              />
                            </td>
                            <td style={td}>
                              <input type="number" min={0} step={0.01} style={{ ...cellInput, textAlign: "right" }} value={it.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", e.target.value)} />
                            </td>
                            <td style={td}>
                              <input type="text" style={cellInput} value={it.uom} onChange={(e) => updateItem(idx, "uom", e.target.value)} />
                            </td>
                            {glOn && (
                              <td style={td}>
                                <AccountSelect
                                  accounts={accounts}
                                  value={it.accountId}
                                  onChange={(v) => updateItem(idx, "accountId", v)}
                                  side="expense"
                                  placeholder={defaultPurchaseAccountLabel}
                                  style={{ ...cellInput, fontSize: "0.76rem" }}
                                />
                              </td>
                            )}
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
            </fieldset>
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>{readOnly ? "Close" : "Cancel"}</button>
            {!readOnly && (
              <button type="submit" disabled={saving} style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving..." : (isEdit ? "Update" : "Create")}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

const th = { textAlign: "left", padding: "0.45rem 0.55rem", borderBottom: "1px solid #e8edf3", fontSize: "0.74rem", fontWeight: 700, color: "#5f6d7e", textTransform: "uppercase", letterSpacing: "0.04em" };
const td = { padding: "0.4rem 0.45rem", borderBottom: "1px solid #f3f5f9", verticalAlign: "top" };
const cellInput = { width: "100%", padding: "0.3rem 0.5rem", fontSize: "0.8rem", border: "1px solid #d0d7e2", borderRadius: 6, backgroundColor: "#f8f9fb", color: "#1a2332", outline: "none" };
