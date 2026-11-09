import BillNumberField, { billNumberPayload } from "./BillNumberField";
import { useState, useEffect, useMemo, useRef } from "react";
import { MdAdd, MdDelete, MdEditNote, MdShoppingCart } from "react-icons/md";
import {
  createPurchaseBill,
  updatePurchaseBill,
  getPurchaseBillById,
} from "../api/purchaseBillApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getNonInventoryItemsByCompany } from "../api/nonInventoryItemApi";
import { getAllUnits } from "../api/unitsApi";
import { getAccountsFlat } from "../api/accountApi";
import { formStyles } from "../theme";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import { defaultAccountPlaceholder } from "../utils/accountDisplay";
import SearchableItemTypeSelect, { NewItemTypeButton } from "./SearchableItemTypeSelect";
import BulkItemTypeBar from "./BulkItemTypeBar";
import SearchableSelect from "./SearchableSelect";
import DocumentNotesEditor from "./DocumentNotesEditor";
import DivisionSelect from "./DivisionSelect";
import AccountSelect from "./AccountSelect";
import AttachmentManager from "./AttachmentManager";
import QuantityInput from "./QuantityInput";
import useScrollToError from "../hooks/useScrollToError";
import useIsNarrow from "../hooks/useIsNarrow";
import CustomerDemandPicker from "./CustomerDemandPicker";
import { docTag, docTitle, docTrail } from "../utils/demandTags";
import { usePermissions } from "../contexts/PermissionsContext";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

export default function PurchaseBillForm({
  companyId,
  company = null,
  billId,
  onClose,
  onSaved,
  readOnly = false,
  defaultDivisionId = null,
  startWithPicker = false,
  forDoc = null,
}) {
  const isEdit = !!billId;
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
  // New bills default to the division the list is filtered to; edits hydrate
  // their stored division from the loaded bill below.
  const [divisionId, setDivisionId] = useState(
    !isEdit && defaultDivisionId ? String(defaultDivisionId) : "",
  );
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
  const [notes, setNotes] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [items, setItems] = useState([newRow()]);
  const [error, setError] = useState("");
  const [numberMode, setNumberMode] = useState("auto");
  const [currentNumber, setCurrentNumber] = useState(null);
  const [storedNumberDivision, setStoredNumberDivision] = useState(null);
  const [customNumber, setCustomNumber] = useState("");
  const [numberValid, setNumberValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const attachmentRef = useRef(null);
  const errRef = useScrollToError(error);
  // Below 768px the wide line-items table reflows to a stacked card per line.
  const isNarrow = useIsNarrow();
  const { has } = usePermissions();
  // Buying for customer documents needs at least one of them to be viewable.
  const canPick =
    !readOnly &&
    has("purchasebills.manage.create") &&
    (has("salesorders.list.view") || has("challans.list.view") || has("invoices.list.view"));
  const [showPicker, setShowPicker] = useState(startWithPicker && canPick);
  // A new bill starts by choosing how to fill its lines; "Enter lines myself" hides the choice.
  const [manualEntry, setManualEntry] = useState(false);

  function newRow() {
    return {
      id: 0,
      itemTypeId: null,
      nonInventoryItemId: null,
      accountId: null,
      description: "",
      quantity: 1,
      unitPrice: 0,
      uom: "",
      hsCode: "",
      saleType: "",
      // Customer-document lines this row buys ({ kind, lineId, quantity, trailKey }),
      // and the documents they are on, for the row's tag.
      sources: [],
      tags: [],
    };
  }


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
    if (!companyId) {
      setAccounts([]);
      return;
    }
    getAccountsFlat(companyId)
      .then(({ data }) => setAccounts((data || []).filter((a) => a.isActive)))
      .catch(() => setAccounts([]));
  }, [companyId]);

  // Per-company Non-Inventory Items (GL-account shortcut lines: Freight,
  // Discount, …). A company with GL off / no items resolves to [] silently.
  useEffect(() => {
    if (!companyId) {
      setNonInvItems([]);
      return;
    }
    getNonInventoryItemsByCompany(companyId, true)
      .then(({ data }) => setNonInvItems(data || []))
      .catch(() => setNonInvItems([]));
  }, [companyId]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await getPurchaseBillById(billId);
        setCurrentNumber(data.purchaseBillNumber);
        setCustomNumber(String(data.purchaseBillNumber));
        setSupplierId(String(data.supplierId));
        setDivisionId(data.divisionId ? String(data.divisionId) : "");
        setStoredNumberDivision(data.divisionId ?? null);
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
        setNotes(data.notes || "");
        setPaymentMode(data.paymentMode || "");
        setItems(
          (data.items || []).map((i) => ({
            id: i.id,
            itemTypeId: i.itemTypeId,
            nonInventoryItemId: i.nonInventoryItemId ?? null,
            accountId: i.accountId ?? null,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            uom: i.uom,
            hsCode: i.hsCode || "",
            saleType: i.saleType || "",
            sources: i.sources || [],
            tags: i.tags || [],
          })),
        );
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

  const subtotal = useMemo(
    () =>
      items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0), 0),
    [items],
  );
  const gstAmount = useMemo(
    () => Math.round(((subtotal * (parseFloat(gstRate) || 0)) / 100) * 100) / 100,
    [subtotal, gstRate],
  );
  const grandTotal = subtotal + gstAmount;

  // Withholding tax — rate-mode = % of the gross (subtotal + GST), rounded to
  // 2dp exactly like the backend (Math.round(x*100)/100). Fixed-amount mode =
  // the typed PKR value. Balance payable to the supplier = grandTotal − WHT.
  const computedWhtAmount = Math.round(grandTotal * (parseFloat(whtRate) || 0)) / 100;
  const whtResolved =
    whtMode === "none" ? 0 : whtMode === "rate" ? computedWhtAmount : parseFloat(whtAmount) || 0;
  const balanceDue = grandTotal - whtResolved;

  // Account labels for the per-line Account (GL) column — name the resolved
  // company-default purchase account (shown when a line carries no explicit
  // account) and a non-inventory line's own mapped purchase account, so the
  // operator always sees which account the amount lands in.
  const defaultPurchaseAccountLabel = defaultAccountPlaceholder(
    accounts,
    company?.defaultPurchaseAccountId,
  );
  const nonInvPurchaseAccountLabel = (nonInvId) => {
    const n = nonInvItems.find((x) => String(x.id) === String(nonInvId));
    return n?.purchaseAccountName ? `→ ${n.purchaseAccountName}` : "→ Suspense";
  };

  const updateItem = (idx, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  // What each customer demand ("trail") this bill already holds, so the picker
  // only offers what is still left.
  const takenByTrail = useMemo(() => {
    const m = {};
    for (const i of items)
      for (const src of fitSources(i))
        if (src.trailKey) m[src.trailKey] = (m[src.trailKey] || 0) + src.quantity;
    return m;
  }, [items]);

  // The customer documents this bill buys for, each once, for the "For" strip.
  const forDocuments = useMemo(() => {
    const seen = new Map();
    for (const i of items)
      for (const t of i.tags || []) seen.set(`${t.kind}:${t.documentId}`, t);
    const order = { order: 0, challan: 1, bill: 2 };
    return [...seen.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.number - b.number);
  }, [items]);

  const isBlankRow = (r) =>
    !r.sources?.length && !r.description?.trim() && !r.itemTypeId && !r.nonInventoryItemId;
  const showStart = !isEdit && canPick && !manualEntry && items.every(isBlankRow);

  const addPickedLines = (picked) => {
    const rows = picked.map((p) => {
      const type = itemTypes.find((t) => t.id === p.itemTypeId);
      return {
        ...newRow(),
        itemTypeId: p.nonInventoryItemId ? null : p.itemTypeId || null,
        nonInventoryItemId: p.nonInventoryItemId || null,
        accountId: type?.purchaseAccountId ?? null,
        description: p.description || "",
        quantity: p.quantity,
        unitPrice: p.unitPrice || 0,
        uom: p.uom || type?.uom || "",
        hsCode: type?.hsCode || "",
        saleType: type?.saleType || "",
        sources: p.sources.map((src, n) => ({ ...src, trailKey: p.trailKeys[n] })),
        tags: p.tags,
      };
    });
    // Untouched blank rows give way to the picked lines. A line whose demand is
    // already on a single-source row tops that row up: one demand, one row.
    setItems((prev) => {
      const next = prev.filter((r) => !isBlankRow(r));
      for (const row of rows) {
        const key = row.sources.length === 1 ? row.sources[0].trailKey : null;
        const at = key
          ? next.findIndex((r) => r.sources?.length === 1 && r.sources[0].trailKey === key)
          : -1;
        if (at < 0) {
          next.push(row);
          continue;
        }
        const quantity = (parseFloat(next[at].quantity) || 0) + row.quantity;
        next[at] = {
          ...next[at],
          quantity,
          sources: [{ ...next[at].sources[0], quantity }],
        };
      }
      return next;
    });
    setManualEntry(true);
    setShowPicker(false);
  };

  const docTags = (it) =>
    it.tags?.length > 0 && (
      <div style={docChip} title={`Buys for ${it.tags.map(docTitle).join(", ")}`}>
        <MdShoppingCart size={12} /> {docTrail(it.tags)}
      </div>
    );

  const pickItemType = (idx, newId, picked) => {
    setItems((prev) => {
      const next = [...prev];
      // Picking an item type is mutually exclusive with a non-inventory item.
      const r = {
        ...next[idx],
        itemTypeId: newId ? parseInt(newId) : null,
        nonInventoryItemId: null,
      };
      if (picked) {
        if (picked.uom) r.uom = picked.uom;
        if (picked.hsCode) r.hsCode = picked.hsCode;
        if (picked.saleType) r.saleType = picked.saleType;
        if (!r.description?.trim() && picked.name) r.description = picked.name;
        // Auto-fill the line's GL account from the item type's per-company
        // purchase-account mapping (null → engine derives at post time).
        r.accountId = picked.purchaseAccountId ?? null;
      } else {
        r.uom = "";
        r.hsCode = "";
        r.saleType = "";
        r.accountId = null;
      }
      next[idx] = r;
      return next;
    });
  };

  // Non-Inventory pick — mutually exclusive with an item type. Clears the
  // item type + its FBR fields, records the non-inv id, and prefills
  // description / UOM / purchase price only when those fields are empty.
  const pickNonInventory = (idx, n) => {
    setItems((prev) => {
      const next = [...prev];
      const r = { ...next[idx] };
      if (!n) {
        r.nonInventoryItemId = null;
      } else {
        r.nonInventoryItemId = n.id;
        r.itemTypeId = null;
        r.hsCode = "";
        r.saleType = "";
        // A non-inventory item posts to its own mapped account — clear any
        // per-line override so that mapping governs.
        r.accountId = null;
        if (!r.description?.trim()) r.description = n.defaultLineDescription || n.name || "";
        if (!r.uom?.trim()) r.uom = n.unitName || "";
        if ((!r.unitPrice || Number(r.unitPrice) === 0) && n.defaultPurchasePrice != null)
          r.unitPrice = n.defaultPurchasePrice;
      }
      next[idx] = r;
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!numberValid) return;
    if (readOnly) return;
    setError("");
    if (!supplierId) return setError("Select a supplier.");
    if (items.length === 0) return setError("Add at least one item.");
    if (items.some((i) => !i.description?.trim()))
      return setError("Every line needs a description.");
    // Every line on a purchase bill must be classified — an Item Type OR a Non-Inventory item.
    if (items.some((i) => !i.itemTypeId && !i.nonInventoryItemId))
      return setError("Every line must have an Item Type or Non-Inventory item selected.");
    if (items.some((i) => !(parseFloat(i.quantity) > 0)))
      return setError("Quantity must be greater than zero on every line.");
    if (items.some((i) => parseFloat(i.unitPrice) < 0))
      return setError("Unit price cannot be negative.");
    setSaving(true);
    try {
      const payload = {
        customNumber: billNumberPayload(isEdit ? "custom" : numberMode, customNumber),
        date,
        companyId,
        divisionId: divisionId ? parseInt(divisionId) : null,
        supplierId: parseInt(supplierId),
        supplierBillNumber: supplierBillNumber || null,
        supplierIRN: supplierIRN || null,
        gstRate: parseFloat(gstRate),
        // Withholding tax: rate-mode ships the %, fixed-amount mode ships null
        // rate + the typed amount. Backend recomputes/clamps the amount.
        withholdingTaxRate: whtMode === "rate" ? parseFloat(whtRate) || 0 : null,
        withholdingTaxAmount: whtResolved,
        paymentTerms: paymentTerms || null,
        notes: notes.trim() || null,
        paymentMode: paymentMode || null,
        items: items.map((i) => ({
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
          sources: fitSources(i).map(({ kind, lineId, quantity }) => ({ kind, lineId, quantity })),
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
      } catch {
        /* attachments are best-effort — the bill is already saved */
      }
      notify(`Purchase bill ${isEdit ? "updated" : "created"}.`, "success");
      onSaved(res.data);
      onClose();
    } catch (err) {
      setError(
        err.response?.data?.error || err.response?.data?.message || "Failed to save purchase bill.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: 1200, width: "96vw" }}>
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>
            {readOnly ? "View Purchase Bill" : isEdit ? "Edit Purchase Bill" : "New Purchase Bill"}
          </h5>
          <button data-admin-close="" style={formStyles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            flex: "1 1 auto",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div data-admin-body="" style={formStyles.body}>
            <fieldset
              disabled={readOnly}
              style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}
            >
              <div style={{ maxWidth: 360, marginBottom: "0.75rem" }}>
                <BillNumberField
                  companyId={companyId}
                  divisionId={isEdit ? storedNumberDivision : divisionId}
                  documentType="purchase-bill"
                  variant={isEdit ? "edit" : "create"}
                  currentNumber={currentNumber}
                  editRecordId={billId}
                  mode={numberMode}
                  onModeChange={setNumberMode}
                  number={customNumber}
                  onNumberChange={setCustomNumber}
                  onValidityChange={setNumberValid}
                  disabled={saving}
                  lockedReason={readOnly ? "Document number is read-only in View." : undefined}
                />
              </div>
              {error && (
                <div ref={errRef} style={formStyles.error}>
                  {error}
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
                  gap: "0.75rem",
                }}
              >
                <div data-admin-field="" style={{ ...formStyles.formGroup, gridColumn: "1 / -1" }}>
                  <label style={formStyles.label}>Supplier *</label>
                  <SearchableSelect
                    quickCreate="supplier"
                    companyId={companyId}
                    disabled={readOnly}
                    onCreated={(created) =>
                      setSuppliers((prev) => [created, ...prev.filter((c) => c.id !== created.id)])
                    }
                    items={suppliers}
                    value={supplierId}
                    onChange={(id) => setSupplierId(id ? String(id) : "")}
                    placeholder="Select supplier…"
                  />
                </div>
                <div data-admin-field="" style={formStyles.formGroup}>
                  <label style={formStyles.label}>Bill Date *</label>
                  <input
                    type="date"
                    style={formStyles.input}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div data-admin-field="" style={formStyles.formGroup}>
                  <DivisionSelect
                    companyId={companyId}
                    value={divisionId}
                    onChange={setDivisionId}
                    mode="select"
                    label={
                      <>
                        Division <span style={{ fontWeight: 400 }}>(optional)</span>
                      </>
                    }
                    labelStyle={formStyles.label}
                    style={formStyles.input}
                  />
                </div>
                <div data-admin-field="" style={formStyles.formGroup}>
                  <label style={formStyles.label}>GST Rate (%)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    style={formStyles.input}
                    value={gstRate}
                    onChange={(e) => setGstRate(e.target.value)}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
                  gap: "0.75rem",
                }}
              >
                <div data-admin-field="" style={formStyles.formGroup}>
                  <label style={formStyles.label}>Withholding Tax</label>
                  <select
                    style={formStyles.input}
                    value={whtMode}
                    onChange={(e) => setWhtMode(e.target.value)}
                    title="Income tax withheld from the supplier — reduces the balance payable, not the bill total"
                  >
                    <option value="none">None</option>
                    <option value="rate">Rate %</option>
                    <option value="amount">Fixed amount</option>
                  </select>
                </div>
                {whtMode === "rate" && (
                  <div data-admin-field="" style={formStyles.formGroup}>
                    <label style={formStyles.label}>WHT Rate (%)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      style={formStyles.input}
                      value={whtRate}
                      onChange={(e) => setWhtRate(e.target.value)}
                      placeholder="e.g. 5.5"
                    />
                  </div>
                )}
                {whtMode === "amount" && (
                  <div data-admin-field="" style={formStyles.formGroup}>
                    <label style={formStyles.label}>WHT Amount (Rs.)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      style={formStyles.input}
                      value={whtAmount}
                      onChange={(e) => setWhtAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
                  gap: "0.75rem",
                }}
              >
                <div data-admin-field="" style={formStyles.formGroup}>
                  <label style={formStyles.label}>Supplier Bill #</label>
                  <input
                    type="text"
                    style={formStyles.input}
                    value={supplierBillNumber}
                    onChange={(e) => setSupplierBillNumber(e.target.value)}
                    placeholder="Their invoice number"
                  />
                </div>
                <div data-admin-field="" style={formStyles.formGroup}>
                  <label style={formStyles.label}>Supplier IRN</label>
                  <input
                    type="text"
                    style={{ ...formStyles.input, fontFamily: "monospace" }}
                    value={supplierIRN}
                    onChange={(e) => setSupplierIRN(e.target.value)}
                    placeholder="From supplier's tax invoice (FBR-issued)"
                  />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
                  gap: "0.75rem",
                }}
              >
                <div data-admin-field="" style={formStyles.formGroup}>
                  <label style={formStyles.label}>Payment Mode</label>
                  <select
                    style={formStyles.input}
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value)}
                  >
                    <option value="">— optional —</option>
                    <option value="Cash">Cash</option>
                    <option value="Credit">Credit</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Online">Online</option>
                  </select>
                </div>
                <div data-admin-field="" style={formStyles.formGroup}>
                  <label style={formStyles.label}>Payment Terms</label>
                  <input
                    type="text"
                    style={formStyles.input}
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    placeholder="e.g. Net 30"
                  />
                </div>
              </div>

              <DocumentNotesEditor value={notes} onChange={setNotes} readOnly={readOnly} />
              <div
                style={{
                  marginTop: "0.75rem",
                  padding: "0.75rem",
                  borderRadius: 10,
                  border: `1px solid ${colors.cardBorder}`,
                  backgroundColor: colors.inputBg,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.5rem",
                  }}
                >
                  <strong style={{ color: colors.textPrimary }}>Items ({items.length})</strong>
                  {!readOnly && (
                    <NewItemTypeButton
                      companyId={companyId}
                      divisionId={divisionId}
                      onCreated={(created) =>
                        setItemTypes((prev) => [
                          created,
                          ...prev.filter((t) => t.id !== created.id),
                        ])
                      }
                      style={{ marginLeft: "auto", marginRight: "0.5rem" }}
                    />
                  )}
                  {canPick && !showStart && (
                    <button
                      type="button"
                      onClick={() => setShowPicker(true)}
                      style={{
                        ...formStyles.button,
                        padding: "0.3rem 0.65rem",
                        fontSize: "0.8rem",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        background: "#e8f5e9",
                        color: "#1b5e20",
                        border: "none",
                        marginRight: "0.5rem",
                      }}
                    >
                      <MdShoppingCart size={14} /> From customer documents
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setManualEntry(true);
                      if (!showStart) setItems([...items, newRow()]);
                    }}
                    style={{
                      ...formStyles.button,
                      padding: "0.3rem 0.65rem",
                      fontSize: "0.8rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.25rem",
                      background: "#e3f2fd",
                      color: "#0d47a1",
                      border: "none",
                    }}
                  >
                    <MdAdd size={14} /> Add line
                  </button>
                </div>
                {forDocuments.length > 0 && (
                  <div style={docStrip}>
                    <MdShoppingCart size={18} color="#0d47a1" style={{ flexShrink: 0 }} />
                    <div>
                      <strong>For:</strong>{" "}
                      {forDocuments.map((t, n) => (
                        <span key={`${t.kind}:${t.documentId}`} title={docTitle(t)}>
                          {n > 0 && ", "}
                          {docTag(t)}
                          {t.clientName ? ` (${t.clientName})` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {showStart ? (
                  <div style={startGrid}>
                    <button type="button" style={startTile} onClick={() => setShowPicker(true)}>
                      <MdShoppingCart size={26} color="#0d47a1" />
                      <span style={startTitle}>Pick from customer documents</span>
                      <span style={startText}>
                        Buy lines of sales orders, challans or sale bills. Each line is bought once,
                        whichever document you pick it from.
                      </span>
                    </button>
                    <button type="button" style={startTile} onClick={() => setManualEntry(true)}>
                      <MdEditNote size={26} color="#455a64" />
                      <span style={startTitle}>Enter lines myself</span>
                      <span style={startText}>For stock, expenses or anything not sold yet.</span>
                    </button>
                  </div>
                ) : (
                  <>
                <BulkItemTypeBar
                  items={items}
                  setItems={setItems}
                  itemTypes={itemTypes}
                  nonInventoryItems={nonInvItems}
                  divisionId={divisionId}
                  companyId={companyId}
                  onItemTypeCreated={(created) =>
                    setItemTypes((prev) => [created, ...prev.filter((t) => t.id !== created.id)])
                  }
                />
                {isNarrow ? (
                  /* Phone (<768px): each line becomes a stacked card so no control
                 gets squeezed. Every editable field from the desktop table is
                 preserved (item-type/non-inventory picker, description, qty,
                 unit price, UOM, GL account, remove) — identical handlers +
                 submit payload. */
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                    {items.map((it, idx) => {
                      const lineTotal =
                        (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0);
                      return (
                        <div key={idx} style={mStyles.card}>
                          <div style={mStyles.cardHead}>
                            <span style={mStyles.cardHeadLabel}>Line {idx + 1}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                              <span style={mStyles.cardHeadTotal}>
                                {lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                              {items.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setItems(items.filter((_, i) => i !== idx))}
                                  style={mStyles.removeBtn}
                                  title="Remove line"
                                  aria-label="Remove line"
                                >
                                  <MdDelete size={18} />
                                </button>
                              )}
                            </div>
                          </div>

                          <div>
                            <label style={mStyles.label}>Item Type (FBR catalog) *</label>
                            <SearchableItemTypeSelect
                              companyId={companyId}
                              onItemTypeCreated={(created) =>
                                setItemTypes((prev) => [
                                  created,
                                  ...prev.filter((t) => t.id !== created.id),
                                ])
                              }
                              divisionId={divisionId}
                              items={itemTypes}
                              value={it.itemTypeId || ""}
                              onChange={(newId, picked) => pickItemType(idx, newId, picked)}
                              nonInventoryItems={nonInvItems}
                              nonInventoryValue={it.nonInventoryItemId || ""}
                              onPickNonInventory={(n) => pickNonInventory(idx, n)}
                              placeholder="— pick item type —"
                              style={{ padding: "0.5rem 0.6rem", fontSize: "0.9rem" }}
                            />
                          </div>

                          <div>
                            <label style={mStyles.label}>Description *</label>
                            <textarea
                              rows={2}
                              style={{
                                ...mStyles.input,
                                resize: "vertical",
                                minHeight: 44,
                                lineHeight: 1.4,
                              }}
                              value={it.description}
                              onChange={(e) => updateItem(idx, "description", e.target.value)}
                            />
                            {docTags(it)}
                          </div>

                          <div style={mStyles.fieldGrid}>
                            <div>
                              <label style={mStyles.label}>Qty *</label>
                              <QuantityInput
                                value={it.quantity}
                                onChange={(val) => updateItem(idx, "quantity", val)}
                                unit={it.uom}
                                units={units}
                                style={{ ...mStyles.input, textAlign: "right" }}
                              />
                            </div>
                            <div>
                              <label style={mStyles.label}>Unit Price *</label>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                style={{ ...mStyles.input, textAlign: "right" }}
                                value={it.unitPrice}
                                onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                              />
                            </div>
                            <div>
                              <label style={mStyles.label}>UOM</label>
                              <input
                                type="text"
                                style={mStyles.input}
                                value={it.uom}
                                onChange={(e) => updateItem(idx, "uom", e.target.value)}
                              />
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
                                placeholder={
                                  it.nonInventoryItemId
                                    ? nonInvPurchaseAccountLabel(it.nonInventoryItemId)
                                    : defaultPurchaseAccountLabel
                                }
                                style={{ ...mStyles.input, minHeight: 44 }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div data-admin-table-region="" style={{ overflowX: "auto" }}>
                    <table
                      style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}
                    >
                      <thead>
                        <tr style={{ backgroundColor: "#f5f8fc" }}>
                          <th style={th}>Item Type (FBR catalog) *</th>
                          <th style={th}>Description *</th>
                          <th style={{ ...th, textAlign: "right", width: 120, minWidth: 120 }}>
                            Qty *
                          </th>
                          <th style={{ ...th, textAlign: "right", width: 100 }}>Unit Price *</th>
                          <th style={{ ...th, width: 100 }}>UOM</th>
                          {glOn && <th style={{ ...th, width: 170 }}>Account (GL)</th>}
                          <th style={{ ...th, textAlign: "right", width: 110 }}>Line Total</th>
                          <th style={{ ...th, width: 36 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it, idx) => {
                          const lineTotal =
                            (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0);
                              return (
                            <tr key={idx}>
                              <td style={td}>
                                <SearchableItemTypeSelect
                                  companyId={companyId}
                                  onItemTypeCreated={(created) =>
                                    setItemTypes((prev) => [
                                      created,
                                      ...prev.filter((t) => t.id !== created.id),
                                    ])
                                  }
                                  divisionId={divisionId}
                                  items={itemTypes}
                                  value={it.itemTypeId || ""}
                                  onChange={(newId, picked) => pickItemType(idx, newId, picked)}
                                  nonInventoryItems={nonInvItems}
                                  nonInventoryValue={it.nonInventoryItemId || ""}
                                  onPickNonInventory={(n) => pickNonInventory(idx, n)}
                                  placeholder="— pick item type —"
                                  style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                                />
                              </td>
                              <td style={td}>
                                <textarea
                                  rows={2}
                                  style={{
                                    ...cellInput,
                                    resize: "vertical",
                                    minHeight: 38,
                                    lineHeight: 1.4,
                                  }}
                                  value={it.description}
                                  onChange={(e) => updateItem(idx, "description", e.target.value)}
                                />
                                {docTags(it)}
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
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  style={{ ...cellInput, textAlign: "right" }}
                                  value={it.unitPrice}
                                  onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                                />
                              </td>
                              <td style={td}>
                                <input
                                  type="text"
                                  style={cellInput}
                                  value={it.uom}
                                  onChange={(e) => updateItem(idx, "uom", e.target.value)}
                                />
                              </td>
                              {glOn && (
                                <td style={td}>
                                  <AccountSelect
                                    accounts={accounts}
                                    value={it.accountId}
                                    onChange={(v) => updateItem(idx, "accountId", v)}
                                    side="expense"
                                    disabled={!!it.nonInventoryItemId}
                                    placeholder={
                                      it.nonInventoryItemId
                                        ? nonInvPurchaseAccountLabel(it.nonInventoryItemId)
                                        : defaultPurchaseAccountLabel
                                    }
                                    style={{ ...cellInput, fontSize: "0.76rem" }}
                                  />
                                </td>
                              )}
                              <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>
                                {lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                              <td style={td}>
                                {items.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setItems(items.filter((_, i) => i !== idx))}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      color: "#c62828",
                                      cursor: "pointer",
                                      padding: 0,
                                    }}
                                  >
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
                  </>
                )}
              </div>

              <div
                style={{
                  marginTop: "1rem",
                  padding: "0.75rem 1rem",
                  borderRadius: 10,
                  border: `1px solid ${colors.cardBorder}`,
                  backgroundColor: "#f8faff",
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  rowGap: "0.35rem",
                  columnGap: "1rem",
                }}
              >
                <span style={{ color: colors.textSecondary }}>Subtotal:</span>
                <span></span>
                <strong>
                  Rs. {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </strong>
                <span style={{ color: colors.textSecondary }}>GST ({gstRate}%):</span>
                <span></span>
                <strong>
                  Rs. {gstAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </strong>
                <span style={{ color: colors.textPrimary, fontWeight: 700, fontSize: "1rem" }}>
                  Grand Total:
                </span>
                <span></span>
                <strong style={{ fontSize: "1.05rem", color: colors.blue }}>
                  Rs. {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </strong>
                {whtResolved > 0 && (
                  <>
                    <span style={{ color: colors.textSecondary }}>
                      Withholding tax{whtMode === "rate" ? ` (${whtRate}%)` : ""}:
                    </span>
                    <span></span>
                    <strong>
                      Rs. {whtResolved.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </strong>
                    <span style={{ color: colors.textPrimary, fontWeight: 700, fontSize: "1rem" }}>
                      Balance payable:
                    </span>
                    <span></span>
                    <strong style={{ fontSize: "1.05rem", color: colors.blue }}>
                      Rs. {balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </strong>
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
          {showPicker && (
            <CustomerDemandPicker
              companyId={companyId}
              suppliers={suppliers}
              supplierId={supplierId}
              onSupplierChange={setSupplierId}
              onSupplierCreated={(created) =>
                setSuppliers((prev) => [created, ...prev.filter((c) => c.id !== created.id)])
              }
              supplierLocked={isEdit}
              excludeBillId={isEdit ? billId : null}
              taken={takenByTrail}
              forDoc={forDoc}
              onAdd={addPickedLines}
              onClose={() => setShowPicker(false)}
            />
          )}
          <div data-admin-footer="" style={formStyles.footer}>
            <button
              data-admin-close=""
              type="button"
              style={{ ...formStyles.button, ...formStyles.cancel }}
              onClick={onClose}
            >
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button
                type="submit"
                disabled={saving || !numberValid}
                style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? "Saving..." : isEdit ? "Update" : "Create"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// A row's sources must add up to its quantity. When the operator changes the
// quantity of a picked row, the change lands on its last source (a lower
// quantity empties the last sources first). The server checks what is left.
function fitSources(row) {
  const sources = row.sources || [];
  if (sources.length === 0) return [];
  let remaining = parseFloat(row.quantity) || 0;
  const out = [];
  sources.forEach((src, n) => {
    const quantity = n === sources.length - 1 ? remaining : Math.min(src.quantity, remaining);
    remaining -= quantity;
    if (quantity > 0) out.push({ ...src, quantity });
  });
  return out;
}

const docChip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  marginTop: 4,
  padding: "1px 8px",
  borderRadius: 999,
  fontSize: "0.7rem",
  fontWeight: 600,
  background: "#e3f2fd",
  color: "#0d47a1",
};

const startGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
  gap: "0.75rem",
  margin: "0.25rem 0 0.5rem",
};

const startTile = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "0.3rem",
  padding: "1rem 1.1rem",
  minHeight: 110,
  textAlign: "left",
  background: "#fff",
  border: "1px solid #d0d7e2",
  borderRadius: 12,
  boxShadow: "none",
  cursor: "pointer",
};

const startTitle = { fontWeight: 700, fontSize: "0.95rem", color: "#1a2332" };
const startText = { fontSize: "0.8rem", color: "#5f6d7e", lineHeight: 1.4 };

const docStrip = {
  display: "flex",
  alignItems: "flex-start",
  gap: "0.5rem",
  padding: "0.55rem 0.8rem",
  marginBottom: "0.6rem",
  background: "#f5f9ff",
  border: "1px solid #bbdefb",
  borderRadius: 8,
  fontSize: "0.82rem",
  color: "#1a2332",
};

const th = {
  textAlign: "left",
  padding: "0.45rem 0.55rem",
  borderBottom: "1px solid #e8edf3",
  fontSize: "0.74rem",
  fontWeight: 700,
  color: "#5f6d7e",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const td = { padding: "0.4rem 0.45rem", borderBottom: "1px solid #f3f5f9", verticalAlign: "top" };
const cellInput = {
  width: "100%",
  padding: "0.3rem 0.5rem",
  fontSize: "0.8rem",
  border: "1px solid #d0d7e2",
  borderRadius: 6,
  backgroundColor: "#f8f9fb",
  color: "#1a2332",
  outline: "none",
};

// Mobile (<768px) stacked-line-item card styles. `boxShadow:"none"` + explicit
// padding on the remove button neutralise index.css's global <button> rule.
const mStyles = {
  card: {
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 10,
    padding: "0.75rem",
    backgroundColor: "#fff",
    display: "flex",
    flexDirection: "column",
    gap: "0.55rem",
  },
  cardHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.6rem",
    borderBottom: `1px solid ${colors.cardBorder}`,
    paddingBottom: "0.45rem",
  },
  cardHeadLabel: {
    fontSize: "0.72rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: colors.textSecondary,
  },
  cardHeadTotal: { fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary },
  removeBtn: {
    display: "grid",
    placeItems: "center",
    width: 44,
    height: 44,
    padding: 0,
    borderRadius: 8,
    border: "none",
    background: "#ffebee",
    color: "#c62828",
    cursor: "pointer",
    boxShadow: "none",
  },
  label: {
    display: "block",
    fontSize: "0.68rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: colors.textSecondary,
    marginBottom: 3,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "0.5rem 0.6rem",
    fontSize: "0.9rem",
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: 8,
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
    outline: "none",
    minHeight: 44,
  },
  fieldGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))",
    gap: "0.5rem",
  },
};
