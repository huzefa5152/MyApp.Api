import StockEntryForm from "./StockEntryForm";
import { usePermissions } from "../contexts/PermissionsContext";
import DocumentCopyPicker from "./DocumentCopyPicker";
import { appendCopiedLines, copyLine } from "../utils/documentCopy";
import { useState, useEffect, useMemo, useRef } from "react";
import { MdAdd, MdDelete, MdReceipt, MdInventory2, MdLocalShipping, MdArrowForward, MdCheckCircle } from "react-icons/md";
import { createPurchaseBill, updatePurchaseBill, getPurchaseBillById, previewPurchaseStock, getLocalPurchaseSources, getLocalPurchaseSource } from "../api/purchaseBillApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getPurchaseTemplate } from "../api/invoiceApi";
import { getAllUnits } from "../api/unitsApi";
import { formStyles } from "../theme";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import DocumentTaxFields from "./DocumentTaxFields";
import QuantityInput from "./QuantityInput";
import AttachmentManager from "./AttachmentManager";
import useScrollToError from "../hooks/useScrollToError";
import DocumentNotesEditor from "./DocumentNotesEditor";
import BillNumberField, { billNumberPayload } from "./BillNumberField";
import CopyLineButton from "./CopyLineButton";
import SearchableSelect from "./SearchableSelect";
import { purchaseBillTotals } from "../utils/purchaseBillTotals.mjs";
import "./PurchaseBillFlow.css";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

export default function PurchaseBillForm({ companyId, billId, onClose, onSaved, prefillFromInvoiceId = null, localSource = null, startLocal = false, readOnly = false }) {
  const { has } = usePermissions();
  const [stockEntryOpen, setStockEntryOpen] = useState(false);
  const isEdit = !!billId;
  const opensLocal = !billId && !prefillFromInvoiceId && (!!localSource || startLocal);
  const [isNonStock, setIsNonStock] = useState(opensLocal);
  const [isGeneratedLocal, setIsGeneratedLocal] = useState(false);
  const [isAuto, setIsAuto] = useState(false);
  const isAgainstSale = !!prefillFromInvoiceId;
  const [choosingCategory, setChoosingCategory] = useState(!billId && !prefillFromInvoiceId && !opensLocal);
  const [categoryChoice, setCategoryChoice] = useState(opensLocal ? "LocalDirect" : "");
  const [categoryConfirmed, setCategoryConfirmed] = useState(opensLocal);
  const detailHeading = useRef(null);
  const [suppliers, setSuppliers] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  // Units list — gates each row's quantity input on the picked UOM
  // (decimal allowed for KG/Liter/etc., integer-only for Pcs/SET/etc.),
  // same behaviour as the sales bill form.
  const [units, setUnits] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierLockedReason, setSupplierLockedReason] = useState(null);
  const [savedSupplierName, setSavedSupplierName] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [supplierBillNumber, setSupplierBillNumber] = useState("");
  const [supplierIRN, setSupplierIRN] = useState("");
  const [gstRate, setGstRate] = useState(opensLocal ? 0 : 18);
  // Withholding defaults to NONE — nothing is withheld unless the operator
  // adds it. Further tax has no purchase-side counterpart (see PurchaseBill).
  const [withholdingTaxRate, setWithholdingTaxRate] = useState(null);
  const [withholdingTaxAmount, setWithholdingTaxAmount] = useState(null);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [items, setItems] = useState([newRow()]);
  const [stockPreview, setStockPreview] = useState(null);
  const [stockPreviewAttempt, setStockPreviewAttempt] = useState(0);
  const stockPreviewKey = JSON.stringify({ companyId, billId, items: items.map(i => ({ itemTypeId: i.itemTypeId || null, quantity: Math.max(0, Number(i.quantity) || 0), hsCode: i.hsCode || null })) });
  const needsStockPreview = !readOnly && !isNonStock && (isEdit || items.some(i => i.itemTypeId));
  const stockPreviewReady = !needsStockPreview || (stockPreview?.key === stockPreviewKey && !!stockPreview.data);
  useEffect(() => {
    if (!needsStockPreview) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const response = await previewPurchaseStock(JSON.parse(stockPreviewKey));
        if (active) setStockPreview({ key: stockPreviewKey, data: response.data });
      } catch {
        if (active) setStockPreview({ key: stockPreviewKey, error: true });
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [needsStockPreview, stockPreviewKey, stockPreviewAttempt]);
  // Responsive: the wide line-item table side-scrolls on a phone, so below
  // 760px each line renders as a tap-friendly stacked card instead.
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
  // Source-bill metadata when in "Purchase Against Sale" mode
  const [sourceBill, setSourceBill] = useState(null);
  // Local purchase linking: one challan or sale bill at a time, any number
  // of its lines, any quantity up to what is left to purchase.
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceOptions, setSourceOptions] = useState([]);
  const [selectedSource, setSelectedSource] = useState(localSource ? `${localSource.kind}:${localSource.id}` : "");
  const [sourceLines, setSourceLines] = useState([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const attachmentRef = useRef(null);

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
        const [sRes, tRes, uRes] = await Promise.all([
          getSuppliersByCompany(companyId),
          getItemTypes(companyId),
          getAllUnits(companyId),
        ]);
        setSuppliers(sRes.data || []);
        setItemTypes(tRes.data || []);
        setUnits(uRes.data || []);
      } catch {
        setError("Failed to load suppliers or item types.");
      }
    })();
  }, [companyId]);

  const canLinkSource = !readOnly && !isEdit && isNonStock && !isAgainstSale;
  useEffect(() => {
    if (!canLinkSource) return;
    let active = true;
    const timer = setTimeout(() => {
      getLocalPurchaseSources(companyId, sourceSearch.trim() || undefined)
        .then(r => { if (active) setSourceOptions(r.data || []); })
        .catch(() => { if (active) setSourceOptions([]); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [companyId, canLinkSource, sourceSearch]);

  const lineKey = line => line.deliveryItemId ? `d${line.deliveryItemId}` : `b${line.invoiceItemId}`;
  const rowKey = row => row.localDeliveryItemId ? `d${row.localDeliveryItemId}` : row.localInvoiceItemId ? `b${row.localInvoiceItemId}` : null;

  const loadSource = async (value) => {
    setSelectedSource(value); setSourceLines([]);
    if (!value) { setSourceBill(null); return; }
    const [kind, id] = value.split(":");
    setSourceLoading(true); setError("");
    try {
      const { data } = await getLocalPurchaseSource(companyId, kind, id);
      setSourceLines(data.items || []);
      setSourceBill({ kind: data.kind, number: data.number, clientName: data.clientName, date: data.date });
    } catch (e) { setError(e.response?.data?.error || "Could not load the document's remaining items."); }
    finally { setSourceLoading(false); }
  };
  useEffect(() => { if (localSource && canLinkSource) loadSource(`${localSource.kind}:${localSource.id}`); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localSource?.kind, localSource?.id, canLinkSource]);

  const addSourceLines = (lines) => {
    const taken = new Set(items.map(rowKey).filter(Boolean));
    const fresh = lines.filter(line => !taken.has(lineKey(line)));
    if (fresh.length === 0) return;
    // The line's own supplier is a sensible default for an empty supplier box.
    const supplierHint = fresh.find(l => l.supplierId)?.supplierId;
    if (!supplierId && supplierHint && suppliers.some(s => s.id === supplierHint)) setSupplierId(String(supplierHint));
    setItems(rows => [...rows.filter(row => row.description?.trim() || rowKey(row)), ...fresh.map(line => ({ ...newRow(),
      description: line.description, quantity: line.remainingQuantity, uom: line.unit,
      unitPrice: line.estimatedUnitCost ?? "",
      localDeliveryItemId: line.deliveryItemId || null, localInvoiceItemId: line.invoiceItemId || null,
      _availableQty: line.remainingQuantity, _sourceLabel: line.sourceChallanNumber ? `Challan #${line.sourceChallanNumber}` : `Bill line` }))]);
  };

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await getPurchaseBillById(billId);
        setIsNonStock(!!data.isNonStockSupplierPurchase);
        setIsGeneratedLocal(data.source === "local-direct");
        setIsAuto(data.source === "auto-cost");
        setCurrentNumber(data.purchaseBillNumber);
        setCustomNumber(String(data.purchaseBillNumber));
        setSupplierId(String(data.supplierId));
        setSupplierLockedReason(data.supplierLockedReason || (data.isNonStockSupplierPurchase ? "Supplier is fixed by the source challan." : null));
        setSavedSupplierName(data.supplierName || "");
        setDate(data.date.slice(0, 10));
        setSupplierBillNumber(data.supplierBillNumber || "");
        setSupplierIRN(data.supplierIRN || "");
        setGstRate(data.gstRate);
        setWithholdingTaxRate(data.withholdingTaxRate ?? null);
        setWithholdingTaxAmount(
          data.withholdingTaxRate == null && data.withholdingTaxAmount > 0 ? data.withholdingTaxAmount : null);
        setPaymentTerms(data.paymentTerms || "");
        setNotes(data.notes || "");
        setPaymentMode(data.paymentMode || "");
        setItems((data.items || []).map(i => ({
          id: i.id, itemTypeId: i.itemTypeId, itemTypeName: i.itemTypeName, description: i.description,
          quantity: i.quantity, unitPrice: i.unitPrice, uom: i.uom,
          hsCode: i.hsCode || "", saleType: i.saleType || "",
          sourceInvoiceItemIds: i.sourceInvoiceItemIds || [],
          localDeliveryItemId: i.localDeliveryItemId || null, localInvoiceItemId: i.localInvoiceItemId || null,
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

  const { subtotal, gstAmount, grandTotal, lineTotals } = useMemo(() => purchaseBillTotals(items, gstRate), [items, gstRate]);

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
        r.hsCode = picked.hsCode || "";
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
    if (choosingCategory) { continueCategory(); return; }
    if (saving) return;
    if (readOnly) return;
    setError("");
    if (!numberValid) return setError("Enter a valid purchase bill number or choose Auto.");
    if (!supplierId) return setError("Select a supplier.");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`))) return setError("Choose a valid bill date.");
    if (items.length === 0) return setError("Add at least one item.");
    if (items.some(i => !i.description?.trim())) return setError("Every line needs a description.");
    if (items.some(i => !Number.isFinite(Number(i.quantity)) || !(Number(i.quantity) > 0))) return setError("Quantity must be greater than zero on every line.");
    const overLinked = items.find(i => rowKey(i) && i._availableQty != null && Number(i.quantity) > Number(i._availableQty));
    if (overLinked) return setError(`${overLinked.description}: only ${overLinked._availableQty} ${overLinked.uom || ""} remains to purchase.`.replace(" .", "."));
    if (items.some(i => i.unitPrice === "" || i.unitPrice == null || !Number.isFinite(Number(i.unitPrice)) || Number(i.unitPrice) < 0)) return setError("Enter a non-negative unit price on every line.");
    if (!Number.isFinite(parseFloat(gstRate)) || parseFloat(gstRate) < 0 || parseFloat(gstRate) > 100) return setError("GST rate must be between 0 and 100.");
    if (isAgainstSale) {
      // In the "Purchase Against Sale" flow every row MUST have an
      // ItemType picked — that's the whole point (binding the sale's
      // unclassified items to a real catalog item with HSCode).
      const unbound = items.filter(i => !i.itemTypeId);
      if (unbound.length > 0)
        return setError("Pick an FBR-compliant Item Type (with HS Code) for every row.");
    }
    if (!stockPreviewReady) return;
    setSaving(true);
    try {
      const payload = {
        purchaseCategory: isNonStock ? "LocalDirect" : "Inventory",
        date,
        companyId,
        customNumber: billNumberPayload(isEdit ? "custom" : numberMode, customNumber),
        supplierId: parseInt(supplierId),
        supplierBillNumber: supplierBillNumber || null,
        supplierIRN: supplierIRN || null,
        gstRate: parseFloat(gstRate),
        // null, not 0 — only null means nothing is withheld.
        withholdingTaxRate: withholdingTaxRate === null || withholdingTaxRate === "" ? null : parseFloat(withholdingTaxRate),
        withholdingTaxAmount: withholdingTaxAmount === null || withholdingTaxAmount === "" ? null : parseFloat(withholdingTaxAmount),
        paymentTerms: paymentTerms || null,
        notes: notes.trim() || null,
        paymentMode: paymentMode || null,
        items: items.map(i => ({
          id: i.id || 0,
          itemTypeId: i.itemTypeId || null,
          description: i.description?.trim(),
          // parseFloat preserves decimals (12.5 KG, 0.0004 Carat) — same as
          // the sales bill form; the server clamps/validates per UOM.
          quantity: parseFloat(i.quantity) || 0,
          unitPrice: parseFloat(i.unitPrice),
          uom: i.uom || null,
          hsCode: i.hsCode || null,
          saleType: i.saleType || null,
          sourceInvoiceItemIds: i.sourceInvoiceItemIds || [],
          localDeliveryItemId: i.localDeliveryItemId || null,
          localInvoiceItemId: i.localInvoiceItemId || null,
        })),
      };
      const res = isEdit
        ? await updatePurchaseBill(billId, payload)
        : await createPurchaseBill(payload);
      notify(`Purchase bill ${isEdit ? "updated" : "created"}.`, "success");
      // Upload any files staged before the bill had an id (no-op on edit /
      // when nothing was staged). Best-effort — the bill is already saved.
      const savedId = res.data?.id ?? billId;
      if (savedId) { try { await attachmentRef.current?.flush(savedId); } catch { /* attachments best-effort */ } }
      onSaved(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Failed to save purchase bill.");
    } finally {
      setSaving(false);
    }
  };

  const continueCategory = () => {
    if (!categoryChoice) { setError("Choose a purchase category to continue."); return; }
    if(categoryChoice === "StockEntry") { setStockEntryOpen(true); return; }
    const local = categoryChoice === "LocalDirect";
    if (local !== isNonStock) setItems(rows => rows.map(i => ({ ...i, itemTypeId: "", hsCode: "", saleType: "", sourceInvoiceItemIds: [] })));
    if (!categoryConfirmed) setGstRate(local ? 0 : 18);
    setIsNonStock(local); setCategoryConfirmed(true); setChoosingCategory(false); setError("");
    requestAnimationFrame(() => detailHeading.current?.focus());
  };

  if(stockEntryOpen) return <StockEntryForm companyId={companyId} onClose={onClose} onBack={()=>setStockEntryOpen(false)} />;

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop}>
      <div data-admin-dialog="" className="purchase-bill-flow" style={{ ...formStyles.modal, maxWidth: choosingCategory ? 760 : 1200, width: "96vw" }}>
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>{readOnly ? "View Purchase Bill" : (isEdit ? "Edit Purchase Bill" : "New Purchase Bill")}</h5>
          <button data-admin-close="" style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          {/* Scrollable body WRAPS the fieldset so the Attachments section can
              sit inside the scroll region (never clipped) yet outside the
              disabled fieldset (so view-mode preview/download stay clickable). */}
          <div data-admin-body="" style={{ ...formStyles.body, maxHeight: "75vh", overflowY: "auto" }}>
          {!isEdit && !isAgainstSale && <ol className="purchase-flow-steps" aria-label="Purchase creation progress"><li aria-current={choosingCategory ? "step" : undefined}><span>{choosingCategory ? "1" : <MdCheckCircle aria-hidden="true" />}</span>Purchase category</li><li aria-current={!choosingCategory ? "step" : undefined}><span>2</span>Bill details</li></ol>}
          {error && <div ref={errRef} role="alert" tabIndex={-1} style={formStyles.error}>{error}</div>}
          {choosingCategory ? <section className="purchase-category-step" aria-labelledby="purchase-category-title">
            <h3 id="purchase-category-title">What would you like to record?</h3><p>Choose a purchase or stock entry.</p>
            <fieldset className="purchase-category-options"><legend>Purchase category</legend>
              {[{value:"LocalDirect", title:"Local direct purchase", description:"Record supplier costs and payables. No inventory movement.", icon:MdLocalShipping}, {value:"Inventory", title:"Stock purchase", description:"Add stock and record the supplier payable.", icon:MdInventory2}, ...(has("stock.opening.manage") || has("stock.adjust.create") ? [{value:"StockEntry",title:"Opening stock / Stock adjustment",description:"Record existing stock or count corrections. No supplier payable.",icon:MdInventory2}] : [])].map(({value,title,description,icon:Icon}) => <label className={`purchase-category-option${categoryChoice === value ? " is-selected" : ""}`} key={value}><input type="radio" name="purchase-category" value={value} checked={categoryChoice === value} onChange={() => { setCategoryChoice(value); setError(""); }} /><Icon className="purchase-category-icon" aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small></span></label>)}
            </fieldset>
            {categoryConfirmed && (categoryChoice === "LocalDirect") !== isNonStock && <p className="purchase-category-warning" role="status">Changing category clears item classifications and source links. Descriptions, quantities and prices are kept.</p>}
          </section> : <>
          {!isEdit && <div className="purchase-category-selected"><div><strong ref={detailHeading} tabIndex={-1}>{isNonStock ? "Local direct purchase" : "Stock purchase"}</strong><small>{isNonStock ? "Supplier payable only · No stock movement" : isAgainstSale ? "Linked to a customer sale bill" : "Catalog items · Inventory controls apply"}</small></div>{!isAgainstSale && <button type="button" onClick={() => { setCategoryChoice(isNonStock ? "LocalDirect" : "Inventory"); setChoosingCategory(true); setError(""); }}>Change category</button>}</div>}
          {isAuto && <p className="purchase-linked-note">This purchase follows the supplier and cost entered on its challan or bill. Change lines there; here you can add the supplier's invoice reference, IRN and GST.</p>}
          {isGeneratedLocal && <p className="purchase-linked-note">Linked lines keep their challan or bill. Quantities are re-checked against what is left to purchase. Once this purchase is paid or credited, correct it with a supplier credit instead.</p>}
          <fieldset disabled={readOnly} style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
            {/* Number and the copy shortcut share one row; the copy panel takes
                the full row once it is opened. */}
            <div className="doc-header-row">
              <div className="doc-header-row__number"><BillNumberField companyId={companyId} documentType="purchase-bill" variant={isEdit ? "edit" : "create"} currentNumber={currentNumber} editRecordId={billId} lockedReason={readOnly ? "Document number is read-only in View." : undefined} mode={numberMode} onModeChange={setNumberMode} number={customNumber} onNumberChange={setCustomNumber} onValidityChange={setNumberValid} disabled={saving} /></div>
              {!readOnly && <div className="doc-header-row__copy">
                <DocumentCopyPicker companyId={companyId} destination="PurchaseBill" allowDetails={!isEdit && !isAgainstSale} disabled={readOnly || isAgainstSale || isNonStock}
                  onCopy={(source,lines,details) => {
                    setItems(prev => appendCopiedLines(details ? [] : prev, lines, newRow).map(row => ({...row,uom:row.uom || row.unit || ""})));
                    if(details) { setSupplierId(String(source.supplierId));setNotes(source.notes||"");setGstRate(source.gstRate??18);setPaymentTerms(source.paymentTerms||"");setPaymentMode(source.paymentMode||"");setSupplierIRN("");setSupplierBillNumber("");setWithholdingTaxRate(source.withholdingTaxRate??null);setWithholdingTaxAmount(null); }
                  }} />
              </div>}
            </div>

            {sourceBill && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: "0.65rem",
                padding: "0.7rem 0.95rem", marginBottom: "0.85rem",
                backgroundColor: "#fff8e1", border: "1px solid #ffcc80",
                borderRadius: 8,
              }}>
                <MdReceipt size={20} color="#bf360c" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: "0.84rem", color: "#1a2332", lineHeight: 1.4 }}>
                  <strong>{sourceBill.kind ? `Purchasing against ${sourceBill.kind === "challan" ? "Challan" : "Sale Bill"} #${sourceBill.number}` : `Procuring against Sale Bill #${sourceBill.invoiceNumber}`}</strong>
                  {" "}for <strong>{sourceBill.clientName}</strong>
                  {" "}({new Date(sourceBill.date).toLocaleDateString()})
                  <div style={{ fontSize: "0.76rem", color: "#5f6d7e", marginTop: 2 }}>
                    {sourceBill.kind ? "Add only what you bought from this supplier. Buy the rest later or from another supplier with another purchase bill." : "Each row groups same-ItemType sale lines. Pick an HS-coded catalog item per row; linked sale lines are classified on save."}
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "0.75rem" }}>
              <div data-admin-field="" style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier *</label>
                {readOnly ? <input aria-label="Supplier" readOnly style={formStyles.input} value={savedSupplierName || suppliers.find(s => String(s.id) === supplierId)?.name || "—"} />
                  : <SearchableSelect items={suppliers} value={supplierId} onChange={id => { if (isEdit && String(id) !== supplierId) { setSupplierIRN(""); setSupplierBillNumber(""); } setSupplierId(String(id)); }}
                    placeholder="Search supplier…" searchKeys={["name", "ntn", "phone"]} disabled={!!supplierLockedReason} allowClear={!isEdit} style={formStyles.input} />}
                {!readOnly && supplierLockedReason && <p style={{fontSize:"0.8rem",color:colors.textSecondary,marginTop:6}}>{supplierLockedReason}</p>}
              </div>
              <div data-admin-field="" style={formStyles.formGroup}>
                <label style={formStyles.label}>Bill Date *</label>
                <input aria-label="Bill date" aria-invalid={!date || undefined} disabled={isAuto} type="date" style={formStyles.input} value={date} onChange={e => { setDate(e.target.value); if (error === "Choose a valid bill date.") setError(""); }} />
                {!date && <small className="purchase-field-error">Choose a bill date.</small>}
              </div>
              <div data-admin-field="" style={formStyles.formGroup}>
                <label style={formStyles.label}>GST Rate (%)</label>
                <input aria-label="GST rate" aria-invalid={gstRate === "" || !Number.isFinite(Number(gstRate)) || Number(gstRate) < 0 || Number(gstRate) > 100 || undefined} type="number" min={0} max={100} step={0.01} style={formStyles.input} value={gstRate} onChange={e => { setGstRate(e.target.value); if (error === "GST rate must be between 0 and 100.") setError(""); }} />
                {(gstRate === "" || Number(gstRate) < 0 || Number(gstRate) > 100) && <small className="purchase-field-error">Enter GST from 0 to 100. Use 0 for no GST.</small>}
              </div>
            </div>

            {canLinkSource && (
              <section aria-label="Link items from a challan or sale bill" className="local-source-picker">
                <label style={{ ...formStyles.label, display: "block" }}>Link to a challan or sale bill <span style={{ fontWeight: 400 }}>(optional)</span></label>
                <div className="local-source-picker__controls">
                  <input aria-label="Search challan or bill" type="search" style={formStyles.input} value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} placeholder="Search by number or customer" />
                  <select aria-label="Challan or sale bill" style={formStyles.input} value={selectedSource} onChange={e => loadSource(e.target.value)}>
                    <option value="">Unlinked local purchase</option>
                    {selectedSource && !sourceOptions.some(o => `${o.kind}:${o.id}` === selectedSource) && sourceBill?.kind &&
                      <option value={selectedSource}>{sourceBill.kind === "challan" ? "Challan" : "Bill"} #{sourceBill.number} · {sourceBill.clientName}</option>}
                    {sourceOptions.map(o => <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>{o.kind === "challan" ? "Challan" : "Bill"} #{o.number} · {o.clientName} · {o.remainingLines} line{o.remainingLines === 1 ? "" : "s"} to purchase</option>)}
                  </select>
                </div>
                {sourceLoading && <small role="status">Loading remaining items…</small>}
                {selectedSource && !sourceLoading && <>
                  {sourceLines.length === 0 ? <small role="status">Everything on this document is already purchased.</small> : <>
                    <div className="local-source-picker__bar">
                      <small>{sourceLines.length} line{sourceLines.length === 1 ? "" : "s"} with quantity left to purchase</small>
                      <button type="button" disabled={sourceLines.every(l => items.some(i => rowKey(i) === lineKey(l)))} onClick={() => addSourceLines(sourceLines)} style={{ ...formStyles.button, minHeight: 44 }}>Add all remaining</button>
                    </div>
                    <ul className="local-source-picker__lines">
                      {sourceLines.map(line => {
                        const added = items.some(i => rowKey(i) === lineKey(line));
                        return <li key={lineKey(line)}>
                          <div><strong>{line.description}</strong><small>{line.sourceChallanNumber ? `Challan #${line.sourceChallanNumber} · ` : ""}Ordered {line.quantity} · Purchased {line.purchasedQuantity} · <b>{line.remainingQuantity} {line.unit} left</b>{line.estimatedUnitCost != null ? ` · Est. Rs. ${line.estimatedUnitCost}` : ""}</small></div>
                          <button type="button" disabled={added} onClick={() => addSourceLines([line])} style={{ ...formStyles.button, minHeight: 44, flexShrink: 0 }}>{added ? "Added" : "Add item"}</button>
                        </li>;
                      })}
                    </ul>
                  </>}
                  <small className="local-source-picker__hint">Change a line's quantity below to record a partial purchase. Buy the rest later, or from another supplier on a new purchase bill.</small>
                </>}
              </section>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
              <div data-admin-field="" style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier Bill #</label>
                <input type="text" style={formStyles.input} value={supplierBillNumber} onChange={e => setSupplierBillNumber(e.target.value)} placeholder="Their invoice number" />
              </div>
              <div data-admin-field="" style={formStyles.formGroup}>
                <label style={formStyles.label}>Supplier IRN</label>
                <input type="text" style={{ ...formStyles.input, fontFamily: "monospace" }} value={supplierIRN} onChange={e => setSupplierIRN(e.target.value)} placeholder="From supplier's tax invoice (FBR-issued)" />
              </div>
            </div>

            <details className="purchase-extra-details" open={readOnly || undefined}><summary>Payment terms &amp; notes (optional)</summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
              <div data-admin-field="" style={formStyles.formGroup}>
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
              <div data-admin-field="" style={formStyles.formGroup}>
                <label style={formStyles.label}>Payment Terms</label>
                <input type="text" style={formStyles.input} value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30" />
              </div>
            </div>

            <DocumentNotesEditor value={notes} onChange={setNotes} readOnly={readOnly} />
            </details>
            <fieldset disabled={isAuto} style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
            <div style={{ marginTop: "0.75rem", padding: "0.75rem", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, backgroundColor: colors.inputBg }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <strong style={{ color: colors.textPrimary }}>Items ({items.length})</strong>
                {!readOnly && <button type="button" onClick={() => setItems([...items, newRow()])} style={{ ...formStyles.button, padding: "0.3rem 0.65rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.25rem", background: "#e3f2fd", color: "#0d47a1", border: "none" }}>
                  <MdAdd size={14} /> Add line
                </button>}
              </div>
              {isNarrow ? (
                <div style={mStyles.cards}>
                  {items.map((it, idx) => {
                    const lineTotal = lineTotals[idx];
                    const linkedToSale = (it.sourceInvoiceItemIds?.length || 0) > 0;
                    return (
                      <div key={idx} style={mStyles.card}>
                        <div style={mStyles.head}>
                          <div style={{ flex: 1 }}>
                            {isNonStock || readOnly ? <span>{isNonStock ? "Non-stock supplier cost" : it.itemTypeName || eligibleItemTypes.find(t => t.id === it.itemTypeId)?.name || "—"}</span> : <SearchableItemTypeSelect
                              items={eligibleItemTypes} groupByHsCode
                              value={it.itemTypeId || ""}
                              onChange={(newId, picked) => pickItemType(idx, newId, picked)}
                              placeholder={isAgainstSale ? "— pick item with HS Code —" : "— optional —"}
                              style={{ padding: "0.4rem 0.55rem", fontSize: "0.82rem", ...(isAgainstSale && !it.itemTypeId ? { borderColor: "#dc3545" } : {}) }}
                            />}
                            {linkedToSale && (
                              <div style={{ fontSize: "0.7rem", color: "#5f6d7e", marginTop: 2 }}>
                                {it._saleLineCount > 1
                                  ? `${it._saleLineCount} sale lines, was: ${it._originalItemTypeName || "—"}`
                                  : `1 sale line, was: ${it._originalItemTypeName || "—"}`}
                                {it._saleProcuredQty > 0 && ` · already procured ${it._saleProcuredQty} of ${it._saleSoldQty}`}
                              </div>
                            )}
                          </div>
                          {!readOnly && <CopyLineButton onClick={() => setItems(prev => [...prev,{...copyLine(it,newRow),uom:it.uom,hsCode:it.hsCode,saleType:it.saleType}])} />}
                          {!readOnly && items.length > 1 && (
                            <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#c62828", cursor: "pointer", padding: "0.4rem", minWidth: 44, minHeight: 44, flexShrink: 0 }}>
                              <MdDelete size={18} />
                            </button>
                          )}
                        </div>
                        <div style={{ marginBottom: "0.4rem" }}>
                          <label style={mStyles.label}>Description *</label>
                          <input aria-label={`Description for item ${idx + 1}`} type="text" style={cellInput} value={it.description} onChange={e => updateItem(idx, "description", e.target.value)} />
                          {rowKey(it) && <small style={{ display: "block", marginTop: 3, color: colors.textSecondary }}>{it._sourceLabel || "Linked line"}{it._availableQty != null ? ` · ${it._availableQty} ${it.uom} left to purchase` : ""}</small>}
                        </div>
                        <div style={mStyles.grid3}>
                          <div>
                            <label style={mStyles.label}>Qty *</label>
                            <QuantityInput value={it.quantity} onChange={val => updateItem(idx, "quantity", val)} unit={it.uom} units={units} style={{ ...cellInput, textAlign: "right" }} />
                          </div>
                          <div>
                            <label style={mStyles.label}>Unit Price *</label>
                            <input aria-label={`Unit price for item ${idx + 1}`} type="number" min={0} step={0.01} style={{ ...cellInput, textAlign: "right" }} value={it.unitPrice} onChange={e => updateItem(idx, "unitPrice", e.target.value)} />
                          </div>
                          <div>
                            <label style={mStyles.label}>UOM</label>
                            <input type="text" style={cellInput} value={it.uom} onChange={e => updateItem(idx, "uom", e.target.value)} />
                          </div>
                        </div>
                        <div style={mStyles.amt}><span>Line Total</span><b>Rs. {lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b></div>
                      </div>
                    );
                  })}
                </div>
              ) : (
              <div data-admin-table-region="" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f5f8fc" }}>
                      <th style={th}>Item Type (FBR catalog)</th>
                      <th style={th}>Description *</th>
                      <th style={{ ...th, textAlign: "right", width: 120, minWidth: 120 }}>Qty *</th>
                      <th style={{ ...th, textAlign: "right", width: 100 }}>Unit Price *</th>
                      <th style={{ ...th, width: 100 }}>UOM</th>
                      <th style={{ ...th, textAlign: "right", width: 110 }}>Line Total</th>
                      {!readOnly && <th style={{ ...th, width: 76 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const lineTotal = lineTotals[idx];
                      const linkedToSale = (it.sourceInvoiceItemIds?.length || 0) > 0;
                      return (
                        <tr key={idx}>
                          <td style={td}>
                            {isNonStock || readOnly ? <span>{isNonStock ? "Non-stock supplier cost" : it.itemTypeName || eligibleItemTypes.find(t => t.id === it.itemTypeId)?.name || "—"}</span> : <SearchableItemTypeSelect
                              items={eligibleItemTypes} groupByHsCode
                              value={it.itemTypeId || ""}
                              onChange={(newId, picked) => pickItemType(idx, newId, picked)}
                              placeholder={isAgainstSale ? "— pick item with HS Code —" : "— optional —"}
                              style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem",
                                       ...(isAgainstSale && !it.itemTypeId ? { borderColor: "#dc3545" } : {}) }}
                            />}
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
                            <input aria-label={`Description for item ${idx + 1}`} type="text" style={cellInput} value={it.description} onChange={e => updateItem(idx, "description", e.target.value)} />
                            {rowKey(it) && <small style={{ display: "block", marginTop: 3, color: colors.textSecondary }}>{it._sourceLabel || "Linked line"}{it._availableQty != null ? ` · ${it._availableQty} ${it.uom} left to purchase` : ""}</small>}
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
                            <input aria-label={`Unit price for item ${idx + 1}`} type="number" min={0} step={0.01} style={{ ...cellInput, textAlign: "right" }} value={it.unitPrice} onChange={e => updateItem(idx, "unitPrice", e.target.value)} />
                          </td>
                          <td style={td}>
                            <input type="text" style={cellInput} value={it.uom} onChange={e => updateItem(idx, "uom", e.target.value)} />
                          </td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          {!readOnly && <td style={{ ...td, whiteSpace: "nowrap" }}>
                            {!readOnly && <CopyLineButton style={{ marginRight: 6 }} onClick={() => setItems(prev => [...prev,{...copyLine(it,newRow),uom:it.uom,hsCode:it.hsCode,saleType:it.saleType}])} />}
                          {!readOnly && items.length > 1 && (
                              <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#c62828", cursor: "pointer", padding: 0 }}>
                                <MdDelete size={16} />
                              </button>
                            )}
                          </td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </div>
            </fieldset>

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

            {!readOnly && !isNonStock && <section aria-label="Inventory impact" aria-live="polite" style={{ marginTop:16, padding:16, borderRadius:10, border:`1px solid ${colors.cardBorder}`, background:"#f8faff" }}>
              <strong style={{color:colors.blue}}>Inventory impact</strong>
              <p style={{fontSize:"0.85rem",color:colors.textSecondary,margin:"8px 0"}}>Items without an HS code and challan supplier purchases do not move stock.</p>
              {isNonStock ? <p>No inventory movement. This purchase records supplier costs only.</p>
                : needsStockPreview && stockPreview?.key !== stockPreviewKey ? <p role="status">Calculating inventory impact…</p>
                : needsStockPreview && stockPreview?.error ? <div><p role="alert">Inventory preview could not load. Retry before saving.</p><button type="button" style={formStyles.button} onClick={() => { setStockPreview(null); setStockPreviewAttempt(a => a + 1); }}>Retry inventory preview</button></div>
                : stockPreview?.key === stockPreviewKey && stockPreview.data && <>
                  {!stockPreview.data.trackingEnabled && <p>Inventory tracking is off for this company. No stock will move.</p>}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(min(260px, 100%), 1fr))",gap:12}}>
                    {stockPreview.data.items.map(item => <div key={item.itemTypeId} style={{padding:12,background:"white",borderRadius:8,border:`1px solid ${colors.cardBorder}`,overflowWrap:"anywhere"}}>
                      <strong>{item.name}</strong><div style={{fontSize:"0.8rem",color:colors.textSecondary}}>{item.hsCode || "No HS code"}</div>
                      {!item.tracksStock && item.changeQuantity === 0 ? <p style={{marginBottom:0}}>No stock movement</p> : <dl style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,marginBottom:0}}>
                        <dt>Current stock</dt><dd style={{margin:0}}>{item.currentQuantity.toLocaleString()} {item.uom}</dd>
                        <dt>This save</dt><dd style={{margin:0,color:item.changeQuantity < 0 ? "#b45309" : colors.teal}}>{item.changeQuantity > 0 ? "+" : ""}{item.changeQuantity.toLocaleString()}</dd>
                        <dt>After saving</dt><dd style={{margin:0,fontWeight:700}}>{item.afterQuantity.toLocaleString()} {item.uom}</dd>
                      </dl>}
                    </div>)}
                  </div>
                  <p style={{fontSize:"0.8rem",color:colors.textSecondary,marginBottom:0}}>Preview uses current inventory. Other documents saved meanwhile can change the final balance.</p>
                </>}
            </section>}

            <DocumentTaxFields
              readOnly={readOnly}
              subtotal={subtotal}
              gstAmount={gstAmount}
              withholdingTaxRate={withholdingTaxRate}
              withholdingTaxAmount={withholdingTaxAmount}
              onWithholdingChange={({ rate, amount }) => {
                setWithholdingTaxRate(rate);
                setWithholdingTaxAmount(amount);
              }}
            />
          </fieldset>
          {/* Inside the scrollable body (never clipped), but outside the
              disabled fieldset so view-mode preview/download stay clickable;
              upload/delete remain permission-gated inside the component. */}
          <div style={{ padding: "0 1.25rem 0.5rem" }}>
            <AttachmentManager
              ref={attachmentRef}
              companyId={companyId}
              entityType="PurchaseBill"
              entityId={billId ?? null}
              mode={readOnly ? "view" : "edit"}
            />
          </div>
          </>}
          </div>
          <div data-admin-footer="" style={formStyles.footer}>
            <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>{readOnly ? "Close" : "Cancel"}</button>
            {choosingCategory ? <button type="submit" style={{ ...formStyles.button, ...formStyles.submit }}>Continue <MdArrowForward aria-hidden="true" /></button> : !readOnly && (
              <button type="submit" disabled={saving || !numberValid || !stockPreviewReady} style={{ ...formStyles.button, ...formStyles.submit, opacity: saving || !stockPreviewReady ? 0.6 : 1 }}>
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
// Mobile stacked-card line items (rendered below 760px instead of the table).
const mStyles = {
  cards: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  card: { border: "1px solid #e8edf3", borderRadius: 12, padding: "0.7rem 0.75rem", background: "#fff" },
  head: { display: "flex", alignItems: "flex-start", gap: "0.5rem", marginBottom: "0.5rem" },
  label: { display: "block", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.03em", color: "#5f6d7e", fontWeight: 700, marginBottom: "0.2rem" },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginTop: "0.4rem" },
  amt: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.55rem", paddingTop: "0.45rem", borderTop: "1px dashed #e8edf3", fontSize: "0.85rem", color: "#5f6d7e" },
};
