import { useState, useEffect, useMemo, useRef } from "react";
import { MdAdd, MdDelete, MdReceipt } from "react-icons/md";
import { createPurchaseBill, updatePurchaseBill, getPurchaseBillById } from "../api/purchaseBillApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getNonInventoryItemsByCompany } from "../api/nonInventoryItemApi";
import { getPurchaseTemplate } from "../api/invoiceApi";
import { getAllUnits } from "../api/unitsApi";
import { getAccountsFlat } from "../api/accountApi";
import { formStyles } from "../theme";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import { defaultAccountPlaceholder } from "../utils/accountDisplay";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import BulkItemTypeBar from "./BulkItemTypeBar";
import SearchableSelect from "./SearchableSelect";
import SupplierForm from "./SupplierForm";
import DivisionSelect from "./DivisionSelect";
import AccountSelect from "./AccountSelect";
import AttachmentManager from "./AttachmentManager";
import QuantityInput from "./QuantityInput";
import useScrollToError from "../hooks/useScrollToError";
import useIsNarrow from "../hooks/useIsNarrow";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

export default function PurchaseBillForm({ companyId, company = null, billId, onClose, onSaved, prefillFromInvoiceId = null, prefillItems = null, prefillSourceLabel = null, readOnly = false, defaultDivisionId = null }) {
  const isEdit = !!billId;
  const isAgainstSale = !!prefillFromInvoiceId;
  // "Purchase Against Sales Order(s)" prefill — plain lines (NOT the FBR
  // item-type-binding flow); the operator picks the supplier and unit prices.
  const isFromOrders = Array.isArray(prefillItems) && prefillItems.length > 0;
  const [suppliers, setSuppliers] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [nonInvItems, setNonInvItems] = useState([]);
  // GL accounts for the editable per-line "Account" column (design §5). Empty
  // when GL isn't set up / the caller lacks accounting.coa.view → column hidden.
  const [accounts, setAccounts] = useState([]);
  const glOn = accounts.length > 0;
  // Units list — gates each row's quantity input on the picked UOM
  // (decimal allowed for KG/Liter/etc., integer-only for Pcs/SET/etc.),
  // same behaviour as the sales bill form.
  const [units, setUnits] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  // New bills default to the division the list is filtered to; edits hydrate
  // their stored division from the loaded bill below.
  const [divisionId, setDivisionId] = useState(
    !isEdit && defaultDivisionId ? String(defaultDivisionId) : "");
  const [date, setDate] = useState(todayYmd());
  const [supplierBillNumber, setSupplierBillNumber] = useState("");
  const [supplierIRN, setSupplierIRN] = useState("");
  const [gstRate, setGstRate] = useState(18);
  // Withholding tax we deduct from the supplier — income tax that sits ON TOP
  // of GST and never changes subtotal / GST / grand total; it reduces the
  // balance we actually pay. "none" | "rate" (a %) | "amount" (fixed PKR).
  // Prefilled from the company default on create, from the bill on edit.
  const [whtMode, setWhtMode] = useState("none");
  const [whtRate, setWhtRate] = useState("");
  const [whtAmount, setWhtAmount] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [items, setItems] = useState([newRow()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Source-bill metadata when in "Purchase Against Sale" mode
  const [sourceBill, setSourceBill] = useState(null);
  const attachmentRef = useRef(null);
  const errRef = useScrollToError(error);
  // Below 768px the wide line-items table reflows to a stacked card per line.
  const isNarrow = useIsNarrow();

  function newRow() {
    return {
      id: 0, itemTypeId: null, nonInventoryItemId: null, accountId: null, description: "", quantity: 1, unitPrice: 0,
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
        const [sRes, tRes, uRes] = await Promise.all([
          getSuppliersByCompany(companyId),
          // Pass companyId so each item type carries this company's overlay
          // purchase account, which auto-fills the line's Account on pick.
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

  // GL accounts (expense side highlighted) for the per-line Account picker.
  useEffect(() => {
    if (!companyId) { setAccounts([]); return; }
    getAccountsFlat(companyId)
      .then(({ data }) => setAccounts((data || []).filter((a) => a.isActive)))
      .catch(() => setAccounts([]));
  }, [companyId]);

  // Per-company Non-Inventory Items (GL-account shortcut lines: Freight,
  // Discount, …). A company with GL off / no items resolves to [] silently.
  useEffect(() => {
    if (!companyId) { setNonInvItems([]); return; }
    getNonInventoryItemsByCompany(companyId, true).then(({ data }) => setNonInvItems(data || [])).catch(() => setNonInvItems([]));
  }, [companyId]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await getPurchaseBillById(billId);
        setSupplierId(String(data.supplierId));
        setDivisionId(data.divisionId ? String(data.divisionId) : "");
        setDate(data.date.slice(0, 10));
        setSupplierBillNumber(data.supplierBillNumber || "");
        setSupplierIRN(data.supplierIRN || "");
        setGstRate(data.gstRate);
        // Withholding tax — prefill from the loaded bill: a stored rate → rate
        // mode; else a non-zero stored amount → fixed-amount mode; else off.
        if (data.withholdingTaxRate != null) {
          setWhtMode("rate");
          setWhtRate(String(data.withholdingTaxRate));
        } else if (data.withholdingTaxAmount) {
          setWhtMode("amount");
          setWhtAmount(String(data.withholdingTaxAmount));
        } else {
          setWhtMode("none");
        }
        setPaymentTerms(data.paymentTerms || "");
        setPaymentMode(data.paymentMode || "");
        setItems((data.items || []).map(i => ({
          id: i.id, itemTypeId: i.itemTypeId, nonInventoryItemId: i.nonInventoryItemId ?? null,
          accountId: i.accountId ?? null,
          description: i.description,
          quantity: i.quantity, unitPrice: i.unitPrice, uom: i.uom,
          hsCode: i.hsCode || "", saleType: i.saleType || "",
          sourceInvoiceItemIds: i.sourceInvoiceItemIds || [],
        })));
      } catch {
        setError("Failed to load purchase bill.");
      }
    })();
  }, [billId, isEdit]);

  // Create only: prefill the WHT rate from the company default (rate-mode)
  // when one is configured. Edits hydrate WHT from the loaded bill above.
  useEffect(() => {
    if (isEdit) return;
    if (company?.defaultWithholdingTaxRate != null) {
      setWhtMode("rate");
      setWhtRate(String(company.defaultWithholdingTaxRate));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.defaultWithholdingTaxRate, isEdit]);

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

  // "Purchase Against Sales Order(s)" — seed plain lines from the merged order
  // items. Unit prices start at 0 (orders carry no pricing); operator fills them.
  useEffect(() => {
    if (!isFromOrders) return;
    setItems(prefillItems.map(p => ({
      ...newRow(),
      itemTypeId: p.itemTypeId || null,
      description: p.description || "",
      quantity: p.quantity || 0,
      unitPrice: p.unitPrice || 0,
      uom: p.uom || "",
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = useMemo(
    () => items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0), 0),
    [items]
  );
  const gstAmount = useMemo(
    () => Math.round(subtotal * (parseFloat(gstRate) || 0) / 100 * 100) / 100,
    [subtotal, gstRate]
  );
  const grandTotal = subtotal + gstAmount;

  // Withholding tax — rate-mode = % of the gross (subtotal + GST), rounded to
  // 2dp exactly like the backend (Math.round(x*100)/100). Fixed-amount mode =
  // the typed PKR value. Balance payable to the supplier = grandTotal − WHT.
  const computedWhtAmount = Math.round(grandTotal * (parseFloat(whtRate) || 0)) / 100;
  const whtResolved = whtMode === "none" ? 0 : (whtMode === "rate" ? computedWhtAmount : (parseFloat(whtAmount) || 0));
  const balanceDue = grandTotal - whtResolved;

  // Account labels for the per-line Account (GL) column — name the resolved
  // company-default purchase account (shown when a line carries no explicit
  // account) and a non-inventory line's own mapped purchase account, so the
  // operator always sees which account the amount lands in.
  const defaultPurchaseAccountLabel = defaultAccountPlaceholder(accounts, company?.defaultPurchaseAccountId);
  const nonInvPurchaseAccountLabel = (nonInvId) => {
    const n = nonInvItems.find((x) => String(x.id) === String(nonInvId));
    return n?.purchaseAccountName ? `→ ${n.purchaseAccountName}` : "→ Suspense";
  };

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
      // Picking an item type is mutually exclusive with a non-inventory item.
      const r = { ...next[idx], itemTypeId: newId ? parseInt(newId) : null, nonInventoryItemId: null };
      if (picked) {
        if (picked.uom) r.uom = picked.uom;
        if (picked.hsCode) r.hsCode = picked.hsCode;
        if (picked.saleType) r.saleType = picked.saleType;
        if (!r.description?.trim() && picked.name) r.description = picked.name;
        // Auto-fill the line's GL account from the item type's per-company
        // purchase-account mapping (null → engine derives at post time).
        r.accountId = picked.purchaseAccountId ?? null;
      } else {
        r.uom = ""; r.hsCode = ""; r.saleType = ""; r.accountId = null;
      }
      next[idx] = r;
      return next;
    });
  };

  // Non-Inventory pick — mutually exclusive with an item type. Clears the
  // item type + its FBR fields, records the non-inv id, and prefills
  // description / UOM / purchase price only when those fields are empty.
  const pickNonInventory = (idx, n) => {
    setItems(prev => {
      const next = [...prev];
      const r = { ...next[idx] };
      if (!n) {
        r.nonInventoryItemId = null;
      } else {
        r.nonInventoryItemId = n.id;
        r.itemTypeId = null; r.hsCode = ""; r.saleType = "";
        // A non-inventory item posts to its own mapped account — clear any
        // per-line override so that mapping governs.
        r.accountId = null;
        if (!r.description?.trim()) r.description = n.defaultLineDescription || n.name || "";
        if (!r.uom?.trim()) r.uom = n.unitName || "";
        if ((!r.unitPrice || Number(r.unitPrice) === 0) && n.defaultPurchasePrice != null) r.unitPrice = n.defaultPurchasePrice;
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
    if (items.some(i => !i.description?.trim())) return setError("Every line needs a description.");
    // Every line on a purchase bill must be classified — an Item Type OR a Non-Inventory item.
    if (items.some(i => !i.itemTypeId && !i.nonInventoryItemId)) return setError("Every line must have an Item Type or Non-Inventory item selected.");
    if (items.some(i => !(parseFloat(i.quantity) > 0))) return setError("Quantity must be greater than zero on every line.");
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
        divisionId: divisionId ? parseInt(divisionId) : null,
        supplierId: parseInt(supplierId),
        supplierBillNumber: supplierBillNumber || null,
        supplierIRN: supplierIRN || null,
        gstRate: parseFloat(gstRate),
        // Withholding tax: rate-mode ships the %, fixed-amount mode ships null
        // rate + the typed amount. Backend recomputes/clamps the amount.
        withholdingTaxRate: whtMode === "rate" ? (parseFloat(whtRate) || 0) : null,
        withholdingTaxAmount: whtResolved,
        paymentTerms: paymentTerms || null,
        paymentMode: paymentMode || null,
        items: items.map(i => ({
          id: i.id || 0,
          itemTypeId: i.itemTypeId || null,
          nonInventoryItemId: i.nonInventoryItemId || null,
          accountId: i.accountId || null,
          description: i.description?.trim(),
          // parseFloat preserves decimals (12.5 KG, 0.0004 Carat) — same as
          // the sales bill form; the server clamps/validates per UOM.
          quantity: parseFloat(i.quantity) || 0,
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
      // Upload any attachments staged before the bill had an id. No-op in
      // edit mode (there they upload immediately) and when nothing's staged.
      try {
        const savedId = res.data?.id ?? billId;
        if (savedId) await attachmentRef.current?.flush(savedId);
      } catch { /* attachments are best-effort — the bill is already saved */ }
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
          <h5 style={formStyles.title}>{readOnly ? "View Purchase Bill" : (isEdit ? "Edit Purchase Bill" : "New Purchase Bill")}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
          <div style={formStyles.body}>
          <fieldset disabled={readOnly} style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
            {error && <div ref={errRef} style={formStyles.error}>{error}</div>}

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

            {isFromOrders && prefillSourceLabel && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: "0.65rem",
                padding: "0.7rem 0.95rem", marginBottom: "0.85rem",
                backgroundColor: "#e8f5e9", border: "1px solid #a5d6a7",
                borderRadius: 8,
              }}>
                <MdReceipt size={20} color="#1b5e20" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: "0.84rem", color: "#1a2332", lineHeight: 1.4 }}>
                  <strong>Purchasing for Sales Order {prefillSourceLabel}</strong>
                  <div style={{ fontSize: "0.76rem", color: "#5f6d7e", marginTop: 2 }}>
                    Lines are prefilled with the outstanding (undelivered) quantities. Pick a supplier
                    and enter unit prices. Quantities and lines are editable.
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
              <div style={{ ...formStyles.formGroup, gridColumn: "1 / -1" }}>
                <label style={{ ...formStyles.label, display: "flex", alignItems: "center", gap: 8 }}>
                  Supplier *
                  {!readOnly && (
                    <button type="button" onClick={() => setShowSupplierForm(true)}
                      style={{ background: "none", border: "none", color: "#0d47a1", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer", padding: 0 }}>
                      + New supplier
                    </button>
                  )}
                </label>
                <SearchableSelect
                  items={suppliers}
                  value={supplierId}
                  onChange={(id) => setSupplierId(id ? String(id) : "")}
                  placeholder="Select supplier…"
                />
              </div>
              {showSupplierForm && (
                <SupplierForm
                  companyId={companyId}
                  onClose={() => setShowSupplierForm(false)}
                  onSaved={(sup) => {
                    if (sup && sup.id) {
                      setSuppliers((prev) => [sup, ...prev.filter((s) => s.id !== sup.id)]);
                      setSupplierId(String(sup.id));
                    }
                  }}
                />
              )}
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Bill Date *</label>
                <input type="date" style={formStyles.input} value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div style={formStyles.formGroup}>
                <DivisionSelect companyId={companyId} value={divisionId} onChange={setDivisionId} mode="select" label={<>Division <span style={{ fontWeight: 400 }}>(optional)</span></>} labelStyle={formStyles.label} style={formStyles.input} />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>GST Rate (%)</label>
                <input type="number" min={0} step={0.01} style={formStyles.input} value={gstRate} onChange={e => setGstRate(e.target.value)} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Withholding Tax</label>
                <select style={formStyles.input} value={whtMode} onChange={e => setWhtMode(e.target.value)} title="Income tax withheld from the supplier — reduces the balance payable, not the bill total">
                  <option value="none">None</option>
                  <option value="rate">Rate %</option>
                  <option value="amount">Fixed amount</option>
                </select>
              </div>
              {whtMode === "rate" && (
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>WHT Rate (%)</label>
                  <input type="number" min={0} step={0.01} style={formStyles.input} value={whtRate} onChange={e => setWhtRate(e.target.value)} placeholder="e.g. 5.5" />
                </div>
              )}
              {whtMode === "amount" && (
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>WHT Amount (Rs.)</label>
                  <input type="number" min={0} step={0.01} style={formStyles.input} value={whtAmount} onChange={e => setWhtAmount(e.target.value)} placeholder="0.00" />
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier Bill #</label>
                <input type="text" style={formStyles.input} value={supplierBillNumber} onChange={e => setSupplierBillNumber(e.target.value)} placeholder="Their invoice number" />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier IRN</label>
                <input type="text" style={{ ...formStyles.input, fontFamily: "monospace" }} value={supplierIRN} onChange={e => setSupplierIRN(e.target.value)} placeholder="From supplier's tax invoice (FBR-issued)" />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
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
              <BulkItemTypeBar items={items} setItems={setItems} itemTypes={itemTypes} nonInventoryItems={nonInvItems} divisionId={divisionId} />
              {isNarrow ? (
              /* Phone (<768px): each line becomes a stacked card so no control
                 gets squeezed. Every editable field from the desktop table is
                 preserved (item-type/non-inventory picker, description, qty,
                 unit price, UOM, GL account, remove) — identical handlers +
                 submit payload. */
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {items.map((it, idx) => {
                  const lineTotal = (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0);
                  const linkedToSale = (it.sourceInvoiceItemIds?.length || 0) > 0;
                  return (
                    <div key={idx} style={mStyles.card}>
                      <div style={mStyles.cardHead}>
                        <span style={mStyles.cardHeadLabel}>Line {idx + 1}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                          <span style={mStyles.cardHeadTotal}>{lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          {items.length > 1 && (
                            <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))} style={mStyles.removeBtn} title="Remove line" aria-label="Remove line">
                              <MdDelete size={18} />
                            </button>
                          )}
                        </div>
                      </div>

                      <div>
                        <label style={mStyles.label}>Item Type (FBR catalog)</label>
                        <SearchableItemTypeSelect
                          divisionId={divisionId}
                          items={eligibleItemTypes}
                          value={it.itemTypeId || ""}
                          onChange={(newId, picked) => pickItemType(idx, newId, picked)}
                          nonInventoryItems={nonInvItems}
                          nonInventoryValue={it.nonInventoryItemId || ""}
                          onPickNonInventory={(n) => pickNonInventory(idx, n)}
                          placeholder={isAgainstSale ? "— pick item with HS Code —" : "— optional —"}
                          style={{ padding: "0.5rem 0.6rem", fontSize: "0.9rem",
                                   ...(isAgainstSale && !it.itemTypeId ? { borderColor: "#dc3545" } : {}) }}
                        />
                        {linkedToSale && (
                          <div style={{ fontSize: "0.72rem", color: "#5f6d7e", marginTop: 3 }}>
                            {it._saleLineCount > 1
                              ? `${it._saleLineCount} sale lines, was: ${it._originalItemTypeName || "—"}`
                              : `1 sale line, was: ${it._originalItemTypeName || "—"}`}
                            {it._saleProcuredQty > 0 && ` · already procured ${it._saleProcuredQty} of ${it._saleSoldQty}`}
                          </div>
                        )}
                      </div>

                      <div>
                        <label style={mStyles.label}>Description *</label>
                        <textarea rows={2} style={{ ...mStyles.input, resize: "vertical", minHeight: 44, lineHeight: 1.4 }} value={it.description} onChange={e => updateItem(idx, "description", e.target.value)} />
                      </div>

                      <div style={mStyles.fieldGrid}>
                        <div>
                          <label style={mStyles.label}>Qty *</label>
                          <QuantityInput
                            value={it.quantity}
                            onChange={val => updateItem(idx, "quantity", val)}
                            unit={it.uom}
                            units={units}
                            style={{ ...mStyles.input, textAlign: "right" }}
                          />
                        </div>
                        <div>
                          <label style={mStyles.label}>Unit Price *</label>
                          <input type="number" min={0} step={0.01} style={{ ...mStyles.input, textAlign: "right" }} value={it.unitPrice} onChange={e => updateItem(idx, "unitPrice", e.target.value)} />
                        </div>
                        <div>
                          <label style={mStyles.label}>UOM</label>
                          <input type="text" style={mStyles.input} value={it.uom} onChange={e => updateItem(idx, "uom", e.target.value)} />
                        </div>
                      </div>

                      {glOn && (
                        <div>
                          <label style={mStyles.label}>Account (GL)</label>
                          <AccountSelect
                            accounts={accounts}
                            value={it.accountId}
                            onChange={(v) => updateItem(idx, "accountId", v)}
                            side="expense"
                            disabled={!!it.nonInventoryItemId}
                            placeholder={it.nonInventoryItemId ? nonInvPurchaseAccountLabel(it.nonInventoryItemId) : defaultPurchaseAccountLabel}
                            style={{ ...mStyles.input, minHeight: 44 }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f5f8fc" }}>
                      <th style={th}>Item Type (FBR catalog)</th>
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
                      const linkedToSale = (it.sourceInvoiceItemIds?.length || 0) > 0;
                      return (
                        <tr key={idx}>
                          <td style={td}>
                            <SearchableItemTypeSelect
                              divisionId={divisionId}
                              items={eligibleItemTypes}
                              value={it.itemTypeId || ""}
                              onChange={(newId, picked) => pickItemType(idx, newId, picked)}
                              nonInventoryItems={nonInvItems}
                              nonInventoryValue={it.nonInventoryItemId || ""}
                              onPickNonInventory={(n) => pickNonInventory(idx, n)}
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
                            <textarea rows={2} style={{ ...cellInput, resize: "vertical", minHeight: 38, lineHeight: 1.4 }} value={it.description} onChange={e => updateItem(idx, "description", e.target.value)} />
                          </td>
                          <td style={td}>
                            <QuantityInput
                              value={it.quantity}
                              onChange={val => updateItem(idx, "quantity", val)}
                              unit={it.uom}
                              units={units}
                              style={{ ...cellInput, textAlign: "right" }}
                            />
                          </td>
                          <td style={td}>
                            <input type="number" min={0} step={0.01} style={{ ...cellInput, textAlign: "right" }} value={it.unitPrice} onChange={e => updateItem(idx, "unitPrice", e.target.value)} />
                          </td>
                          <td style={td}>
                            <input type="text" style={cellInput} value={it.uom} onChange={e => updateItem(idx, "uom", e.target.value)} />
                          </td>
                          {glOn && (
                            <td style={td}>
                              <AccountSelect
                                accounts={accounts}
                                value={it.accountId}
                                onChange={(v) => updateItem(idx, "accountId", v)}
                                side="expense"
                                disabled={!!it.nonInventoryItemId}
                                placeholder={it.nonInventoryItemId ? nonInvPurchaseAccountLabel(it.nonInventoryItemId) : defaultPurchaseAccountLabel}
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
              )}
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
              {whtResolved > 0 && (
                <>
                  <span style={{ color: colors.textSecondary }}>Withholding tax{whtMode === "rate" ? ` (${whtRate}%)` : ""}:</span>
                  <span></span>
                  <strong>Rs. {whtResolved.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                  <span style={{ color: colors.textPrimary, fontWeight: 700, fontSize: "1rem" }}>Balance payable:</span>
                  <span></span>
                  <strong style={{ fontSize: "1.05rem", color: colors.blue }}>Rs. {balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                </>
              )}
            </div>
          </fieldset>

            {/* Outside the disabled fieldset so preview/download stay clickable in view mode. */}
            <AttachmentManager
              ref={attachmentRef}
              companyId={companyId}
              entityType="PurchaseBill"
              entityId={billId ?? null}
              mode={readOnly ? "view" : "edit"}
            />
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

// Mobile (<768px) stacked-line-item card styles. `boxShadow:"none"` + explicit
// padding on the remove button neutralise index.css's global <button> rule.
const mStyles = {
  card: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.75rem", backgroundColor: "#fff", display: "flex", flexDirection: "column", gap: "0.55rem" },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", borderBottom: `1px solid ${colors.cardBorder}`, paddingBottom: "0.45rem" },
  cardHeadLabel: { fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary },
  cardHeadTotal: { fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary },
  removeBtn: { display: "grid", placeItems: "center", width: 44, height: 44, padding: 0, borderRadius: 8, border: "none", background: "#ffebee", color: "#c62828", cursor: "pointer", boxShadow: "none" },
  label: { display: "block", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary, marginBottom: 3 },
  input: { width: "100%", boxSizing: "border-box", padding: "0.5rem 0.6rem", fontSize: "0.9rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", minHeight: 44 },
  fieldGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: "0.5rem" },
};
