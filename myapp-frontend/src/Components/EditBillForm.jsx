import { useState, useEffect, useMemo } from "react";
import { MdInfo } from "react-icons/md";
import { getInvoiceById, updateInvoice, updateInvoiceItemTypes, updateInvoiceItemTypesAndQty } from "../api/invoiceApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getClientsByCompany } from "../api/clientApi";
import { getAllUnits } from "../api/unitsApi";
import QuantityInput from "./QuantityInput";
import { getFbrApplicableScenarios } from "../api/fbrApi";
import { formStyles, modalSizes } from "../theme";
import { usePermissions } from "../contexts/PermissionsContext";
import LookupAutocomplete from "./LookupAutocomplete";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  warn: "#f57c00",
  warnBg: "#fff8e1",
  warnBorder: "#ffcc80",
  infoBg: "#e3f2fd",
  infoBorder: "#90caf9",
};

/**
 * Edit an existing bill.
 *
 * Items cannot be added or removed here — add/remove items on the linked
 * delivery challan instead (the bill auto-syncs). Here the user can only
 * update per-item fields: description, quantity, UOM, unit price, HS Code, sale type.
 *
 * Description and UOM use LookupAutocomplete with /api/lookup/items and /api/lookup/units,
 * matching the delivery challan form — picks existing values, creates new ones if needed.
 */
export default function EditBillForm({ invoiceId, onClose, onSaved, readOnly = false }) {
  const { has } = usePermissions();
  // Three permission tiers for editing a bill, ordered narrowest → broadest:
  //   • invoices.manage.update.itemtype       → ONLY Item Type column
  //   • invoices.manage.update.itemtype.qty   → Item Type + Quantity columns
  //   • invoices.manage.update                → full edit (price, all fields)
  //
  // The narrow paths are for operators who classify or correct quantities
  // but shouldn't touch commercial values. When the user has only a narrow
  // permission, every input on this form outside its scope becomes
  // read-only and Save POSTs to the matching narrow PATCH endpoint.
  const canFullEdit          = has("invoices.manage.update");
  const canEditItemTypeAndQty = has("invoices.manage.update.itemtype.qty");
  const canEditItemType       = has("invoices.manage.update.itemtype");
  // Mode flags — exactly one of these is true at a time (in priority order).
  // canFullEdit takes precedence: a full-editor doesn't need the narrow modes.
  const itemTypeOnlyMode     = !canFullEdit && !canEditItemTypeAndQty && canEditItemType;
  const itemTypeAndQtyMode   = !canFullEdit && canEditItemTypeAndQty;

  // Effective read-only: caller-forced OR no edit permission at all.
  const effectiveReadOnly = readOnly || (!canFullEdit && !canEditItemTypeAndQty && !canEditItemType);

  const [invoice, setInvoice] = useState(null);
  const [items, setItems] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  // Buyer reassignment — only meaningful for standalone bills (no
  // linked challan). Loaded lazily after the bill itself comes back so
  // we know which company's client list to pull. clientId starts as the
  // bill's existing buyer.
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  // Units list — gates each row's quantity input on the picked UOM
  // (decimal allowed for KG/Liter/etc., integer-only for Pcs/SET/etc.).
  const [units, setUnits] = useState([]);
  const [gstRate, setGstRate] = useState(18);
  const [billDate, setBillDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [documentType, setDocumentType] = useState(4);
  const [loading, setLoading] = useState(true);
  // Bulk-apply mode for the "Apply same Item Type to all rows" UX.
  const [bulkApplyMode, setBulkApplyMode] = useState("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ── FBR scenario lock — same UX as the bill-creation form ──────────
  // Picking a scenario filters the Item Type dropdown to catalog rows
  // whose stored saleType matches, so the bill can't drift into a
  // mixed-bucket state that PRAL rejects with 0052. Auto-detected
  // from the existing paymentTerms ("[SNxxx] ...") on load.
  const [scenarios, setScenarios] = useState([]);
  const [scenarioCode, setScenarioCode] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const [{ data }, typesRes, unitsRes] = await Promise.all([
          getInvoiceById(invoiceId),
          getItemTypes().catch(() => ({ data: [] })),
          getAllUnits().catch(() => ({ data: [] })),
        ]);
        setInvoice(data);
        setItems(data.items.map((it) => ({ ...it })));
        setItemTypes(typesRes.data || []);
        setUnits(unitsRes.data || []);
        setClientId(data.clientId ? String(data.clientId) : "");
        setGstRate(data.gstRate ?? 18);
        // Date arrives as ISO string; the <input type="date"> control wants YYYY-MM-DD.
        setBillDate(data.date ? new Date(data.date).toISOString().slice(0, 10) : "");
        const pt = data.paymentTerms ?? "";
        setPaymentTerms(pt);
        setPaymentMode(data.paymentMode ?? "");
        setDocumentType(data.documentType ?? 4);

        // Auto-detect scenario from paymentTerms tag.
        const tag = pt.match(/\[\s*(SN\d{3})\s*\]/i);
        if (tag) setScenarioCode(tag[1].toUpperCase());

        // Lazy-load applicable scenarios for the bill's company.
        if (data.companyId) {
          getFbrApplicableScenarios(data.companyId)
            .then(({ data: sc }) => setScenarios(sc?.scenarios || []))
            .catch(() => setScenarios([]));
          // Load the company's clients so the operator can reassign the
          // buyer on a standalone bill (challan-linked bills get the
          // same dropdown but disabled — see lockClient below).
          getClientsByCompany(data.companyId)
            .then((res) => setClients(res.data || []))
            .catch(() => setClients([]));
        }
      } catch {
        setError("Failed to load bill.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [invoiceId]);

  // The chosen scenario record drives both the item-type filter and the
  // bill-level GST rate when it differs from the canonical scenario rate.
  const chosenScenario = useMemo(
    () => scenarios.find((s) => s.code === scenarioCode) || null,
    [scenarios, scenarioCode],
  );

  // Item types compatible with the chosen scenario. Empty selection ("auto")
  // shows ALL item types — same fallback as the create form.
  const filteredItemTypes = useMemo(() => {
    if (!chosenScenario) return itemTypes;
    const target = (chosenScenario.saleType || "").trim().toLowerCase();
    return itemTypes.filter(
      (it) => (it.saleType || "").trim().toLowerCase() === target,
    );
  }, [itemTypes, chosenScenario]);

  const updateItem = (index, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      // Recalculate lineTotal
      const qty = parseFloat(next[index].quantity) || 0;
      const price = parseFloat(next[index].unitPrice) || 0;
      next[index].lineTotal = Math.round(qty * price * 100) / 100;
      return next;
    });
  };

  // Apply a catalog row to one bill line. Sets ItemType + the inherited
  // FBR fields (UOM, HS Code, Sale Type, FbrUOMId). Clearing the
  // ItemType wipes the inherited fields so stale data doesn't ship to FBR.
  const _applyItemTypeToRow = (current, newId, pickedType) => {
    const next = { ...current };
    next.itemTypeId = newId || null;
    if (pickedType) {
      next.itemTypeName = pickedType.name || "";
      next.uom = pickedType.uom || "";
      next.fbrUOMId = pickedType.fbrUOMId || null;
      next.hsCode = pickedType.hsCode || "";
      next.saleType = pickedType.saleType || "";
      if (!next.description?.trim()) next.description = pickedType.name || "";
    } else {
      next.itemTypeName = "";
      next.uom = "";
      next.fbrUOMId = null;
      next.hsCode = "";
      next.saleType = "";
    }
    return next;
  };

  const updateItemType = (index, newId, pickedType) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = _applyItemTypeToRow(next[index], newId, pickedType);
      return next;
    });
  };

  // Bulk apply — sets the same ItemType on every row in one shot.
  // Good when the operator has 20+ items that should all be classified
  // the same way (typical for single-category sale bills).
  const applyItemTypeToAll = (newId, pickedType, mode = "all") => {
    setItems((prev) => prev.map((row) => {
      // mode === "empty" → only fill rows that don't have an Item Type yet
      if (mode === "empty" && row.itemTypeId) return row;
      return _applyItemTypeToRow(row, newId, pickedType);
    }));
  };

  const subtotal = items.reduce((s, i) => s + (parseFloat(i.lineTotal) || 0), 0);
  const gstAmount = Math.round(subtotal * (parseFloat(gstRate) || 0) / 100 * 100) / 100;
  const grandTotal = subtotal + gstAmount;

  // Field-level gating booleans, derived once for clarity:
  //   • lockNonItemType — locks every input that isn't the Item Type
  //     picker (bill-level fields like GST rate, dates, payment terms;
  //     line-item fields like description, UOM, unit price, line total,
  //     HS code, sale type). True in BOTH narrow modes (itemtype-only
  //     and itemtype+qty) and in caller-forced read-only.
  //   • lockQty — locks ONLY the Qty cell on each line. Same as
  //     lockNonItemType EXCEPT in ItemType+Qty mode, where Qty unlocks.
  //   • lockItemType — locks the Item Type picker too (full read-only).
  const lockNonItemType = readOnly || itemTypeOnlyMode || itemTypeAndQtyMode;
  const lockQty         = readOnly || itemTypeOnlyMode; // Qty stays editable in itemTypeAndQty mode
  const lockItemType    = readOnly;
  // Buyer reassignment: only meaningful for standalone bills (no
  // linked challan) AND only in full-edit mode. Challan-linked bills
  // would diverge from their challan if the buyer changed, so the
  // backend rejects the change and we lock it client-side.
  const isChallanLinked = !!(invoice?.challanNumbers && invoice.challanNumbers.length > 0);
  const lockClient      = lockNonItemType || isChallanLinked;

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    if (items.length === 0) return setError("No items to save.");

    setSaving(true);
    try {
      if (itemTypeOnlyMode) {
        // Narrow path — only re-classify lines by ItemType. Server enforces
        // the same restriction (PATCH /invoices/{id}/itemtypes route is
        // gated by invoices.manage.update.itemtype).
        await updateInvoiceItemTypes(
          invoiceId,
          items.map((i) => ({ id: i.id || 0, itemTypeId: i.itemTypeId || null })),
        );
      } else if (itemTypeAndQtyMode) {
        // Slightly broader narrow path — Item Type + Qty. Same back-end
        // model (UpdateInvoiceItemTypesDto), but the .qty endpoint sets
        // allowQuantityEdit=true so the service honours each row's qty.
        // Decimal validation rejects fractional qty for integer-only UOMs.
        if (items.some((i) => (parseFloat(i.quantity) || 0) <= 0)) {
          return setError("Quantity must be greater than 0.");
        }
        await updateInvoiceItemTypesAndQty(
          invoiceId,
          items.map((i) => ({
            id: i.id || 0,
            itemTypeId: i.itemTypeId || null,
            quantity: parseFloat(i.quantity) || 0,
          })),
        );
      } else {
        // Full edit path — same validation as before.
        if (items.some((i) => !i.description?.trim())) return setError("All items must have a description.");
        if (items.some((i) => (parseFloat(i.quantity) || 0) <= 0)) return setError("Quantity must be greater than 0.");
        if (items.some((i) => (parseFloat(i.unitPrice) || 0) < 0)) return setError("Unit price cannot be negative.");

        // Re-write paymentTerms to keep the [SNxxx] tag in sync with the
        // operator's scenario choice — same convention as the create form
        // so FbrService's auto-detect routes the right scenarioId on submit.
        const cleaned = (paymentTerms || "").replace(/^\s*\[\s*SN\d{3}\s*\]\s*/i, "").trim();
        const ptToSave = scenarioCode
          ? `[${scenarioCode}] ${cleaned || chosenScenario?.description || ""}`.trim()
          : (cleaned || null);

        await updateInvoice(invoiceId, {
          date: billDate || null,
          gstRate: parseFloat(gstRate),
          paymentTerms: ptToSave,
          documentType: documentType || null,
          paymentMode: paymentMode || null,
          // Only send clientId when it would actually change — backend
          // refuses to reassign on challan-linked bills, so omitting the
          // field on those (when locked) avoids a needless 400.
          clientId: !lockClient && clientId ? parseInt(clientId) : null,
          items: items.map((i) => ({
            id: i.id || 0,
            deliveryItemId: i.deliveryItemId || null,
            // When ItemTypeId is set, backend re-derives HS/UOM/Sale Type from it.
            itemTypeId: i.itemTypeId || null,
            description: i.description,
            // parseFloat preserves decimals (12.5 KG, 0.0004 Carat).
            // Server-side validation rejects fractions for integer-only UOMs.
            quantity: parseFloat(i.quantity) || 0,
            uom: i.uom || "",
            unitPrice: parseFloat(i.unitPrice),
            hsCode: i.hsCode || null,
            fbrUOMId: i.fbrUOMId || null,
            saleType: i.saleType || null,
            rateId: i.rateId || null,
          })),
        });
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save bill.");
    } finally {
      setSaving(false);
    }
  };

  // Backdrop click is a no-op — protects in-progress edits. Dismiss
  // via the X in the header or the Cancel button.
  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xxl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            {readOnly ? "View Bill" : "Edit Bill"} {invoice?.fbrInvoiceNumber || `#${invoice?.invoiceNumber || ""}`}
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSave}>
          <div style={{ ...formStyles.body, maxHeight: "75vh", overflowY: "auto" }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: "2rem", color: colors.textSecondary }}>Loading...</div>
            ) : !invoice ? (
              <div style={styles.errorAlert}>Bill not found.</div>
            ) : !invoice.isEditable && !readOnly ? (
              <div style={styles.errorAlert}>
                This bill has been submitted to FBR and cannot be edited.
              </div>
            ) : (
              <>
                {error && <div style={styles.errorAlert}>{error}</div>}

                {!readOnly && (
                  <div style={styles.infoBox}>
                    <MdInfo size={16} style={{ color: colors.blue, flexShrink: 0, marginTop: 2 }} />
                    <div>
                      To <b>add or remove items</b>, edit the linked delivery challan
                      {invoice.challanNumbers?.length > 0 && (
                        <> (<b>DC#{invoice.challanNumbers.join(", DC#")}</b>)</>
                      )}.
                      The bill will sync automatically.
                    </div>
                  </div>
                )}

                {readOnly && (
                  <div style={styles.infoBox}>
                    <MdInfo size={16} style={{ color: colors.blue, flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <b>Client:</b> {invoice.clientName} · <b>Date:</b> {invoice.date ? new Date(invoice.date).toLocaleDateString() : "—"}
                      {invoice.challanNumbers?.length > 0 && <> · <b>DC#{invoice.challanNumbers.join(", #")}</b></>}
                      {/* PO Number / Indent / Site rolled up from linked
                          challans — same fields the bill list card now
                          shows, so the read-only view matches the card
                          and Edit form one-for-one. */}
                      {invoice.poNumber && <> · <b>PO:</b> {invoice.poNumber}</>}
                      {invoice.indentNo && <> · <b>Indent:</b> {invoice.indentNo}</>}
                      {invoice.site && <> · <b>Site:</b> {invoice.site}</>}
                      {invoice.fbrStatus && <> · <b>FBR:</b> {invoice.fbrStatus}</>}
                      {invoice.fbrIRN && <> · <b>IRN:</b> {invoice.fbrIRN}</>}
                    </div>
                  </div>
                )}

                {/* Narrow-permission banner */}
                {itemTypeOnlyMode && (
                  <div style={styles.narrowPermissionBanner}>
                    <MdInfo size={16} style={{ color: colors.warn, flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <b>Item Type only</b> — your role lets you re-classify lines by picking
                      a different Item Type. Quantities, prices, dates, and other fields are
                      read-only here. Ask an administrator to grant <code>invoices.manage.update</code> for full edit access.
                    </div>
                  </div>
                )}
                {itemTypeAndQtyMode && (
                  <div style={styles.narrowPermissionBanner}>
                    <MdInfo size={16} style={{ color: colors.warn, flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <b>Item Type + Quantity only</b> — your role lets you re-classify lines and
                      adjust quantity. Prices, dates, payment terms, and other fields are read-only.
                      Ask an administrator to grant <code>invoices.manage.update</code> for full edit access.
                    </div>
                  </div>
                )}

                {/* FBR scenario picker — pure UI filter for the Item Type
                    dropdown below. Stays editable even in itemTypeOnlyMode
                    (narrow `invoices.manage.update.itemtype` permission)
                    because picking a scenario doesn't change commercial
                    values; it only narrows which ItemType rows the operator
                    can pick from. The narrow PATCH path doesn't persist
                    paymentTerms, so the [SNxxx] tag only updates on the
                    full-edit save path. */}
                {scenarios.length > 0 && (
                  <div style={styles.row}>
                    <div style={{ flex: 1, minWidth: 280 }}>
                      <label style={styles.label}>
                        FBR Scenario <span style={{ fontWeight: 400, color: colors.textSecondary, fontSize: "0.7rem" }}>filters items below</span>
                      </label>
                      <select
                        style={{ ...styles.input, ...(lockItemType ? styles.readOnlyInput : {}) }}
                        value={scenarioCode}
                        onChange={(e) => setScenarioCode(e.target.value)}
                        disabled={lockItemType}
                      >
                        <option value="">— auto-detect from items —</option>
                        {scenarios.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.code} · {s.saleType} · {s.defaultRate}%
                          </option>
                        ))}
                      </select>
                      {chosenScenario && (
                        <div style={{ fontSize: "0.7rem", color: colors.textSecondary, marginTop: "0.25rem" }}>
                          Showing only item types with sale type "{chosenScenario.saleType}".
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Bill-level fields */}
                <div style={styles.row}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <label style={styles.label}>
                      Buyer
                      {isChallanLinked && (
                        <span style={{ fontWeight: 400, color: colors.textSecondary, fontSize: "0.7rem", marginLeft: "0.4rem" }}>
                          locked — set by linked challan
                        </span>
                      )}
                    </label>
                    <select
                      style={{ ...styles.input, ...(lockClient ? styles.readOnlyInput : {}) }}
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      disabled={lockClient}
                    >
                      {/* Show the existing buyer as a fallback option even
                          when not in the loaded clients list (e.g. archived
                          client) so the dropdown never silently changes the
                          buyer just because of an empty options list. */}
                      {invoice?.clientId && !clients.some((c) => c.id === invoice.clientId) && (
                        <option value={invoice.clientId}>{invoice.clientName}</option>
                      )}
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.registrationType || "—"}{c.ntn ? ` · NTN ${c.ntn}` : c.cnic ? ` · CNIC ${c.cnic}` : ""})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={styles.label}>Bill Date</label>
                    <input
                      type="date"
                      style={{ ...styles.input, ...(lockNonItemType ? styles.readOnlyInput : {}) }}
                      value={billDate}
                      onChange={(e) => setBillDate(e.target.value)}
                      max={new Date().toISOString().slice(0, 10)}
                      readOnly={lockNonItemType}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <label style={styles.label}>GST Rate (%)</label>
                    <input
                      type="number"
                      style={{ ...styles.input, ...(lockNonItemType ? styles.readOnlyInput : {}) }}
                      value={gstRate}
                      onChange={(e) => setGstRate(e.target.value)}
                      min={0}
                      max={100}
                      step={0.5}
                      readOnly={lockNonItemType}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={styles.label}>Payment Terms</label>
                    <input
                      type="text"
                      style={{ ...styles.input, ...(lockNonItemType ? styles.readOnlyInput : {}) }}
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                      placeholder="Optional"
                      readOnly={lockNonItemType}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={styles.label}>Payment Mode</label>
                    <select
                      style={{ ...styles.input, ...(lockNonItemType ? styles.readOnlyInput : {}) }}
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value)}
                      disabled={lockNonItemType}
                    >
                      <option value="">— none —</option>
                      <option>Cash</option>
                      <option>Credit</option>
                      <option>Bank Transfer</option>
                      <option>Cheque</option>
                      <option>Online</option>
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={styles.label}>Document Type</label>
                    <select
                      style={{ ...styles.input, ...(lockNonItemType ? styles.readOnlyInput : {}) }}
                      value={documentType}
                      onChange={(e) => setDocumentType(parseInt(e.target.value))}
                      disabled={lockNonItemType}
                    >
                      <option value={4}>Sale Invoice</option>
                      <option value={9}>Debit Note</option>
                      <option value={10}>Credit Note</option>
                    </select>
                  </div>
                </div>

                {/* Items table — no add/remove; only field edits */}
                <h6 style={styles.sectionHeading}>Items ({items.length})</h6>

                {!readOnly && (
                  <p style={styles.gridHint}>
                    Pick an <b>Item Type</b> — UOM, HS Code &amp; Sale Type auto-fill from the catalog and
                    <b> cannot be edited inline</b>. To change them, pick a different Item Type or edit the Item Type row on the catalog page.
                  </p>
                )}

                {/* Bulk Item Type apply — saves operator the pain of picking
                    the same catalog row 20+ times. Two modes:
                      - "All rows": overwrites Item Type on every row
                      - "Empty rows only": fills only rows that don't have one
                    Available to narrow-perm users too — it's still just an
                    Item Type pick. */}
                {!lockItemType && items.length > 1 && (
                  <div style={styles.bulkApplyBar}>
                    <span style={styles.bulkApplyLabel}>
                      Apply same Item Type to:
                    </span>
                    <select
                      value={bulkApplyMode}
                      onChange={(e) => setBulkApplyMode(e.target.value)}
                      style={{ ...styles.tableInput, maxWidth: 180 }}
                    >
                      <option value="all">All {items.length} rows</option>
                      <option value="empty">Only empty rows</option>
                    </select>
                    <div style={{ flex: "1 1 220px", maxWidth: 280 }}>
                      <SearchableItemTypeSelect
                        items={filteredItemTypes}
                        value=""
                        onChange={(newId, picked) => {
                          if (!newId) return;
                          applyItemTypeToAll(parseInt(newId), picked, bulkApplyMode);
                        }}
                        placeholder={bulkApplyMode === "all"
                          ? "— pick to apply to all —"
                          : "— pick to fill empty rows —"}
                        style={styles.tableInput}
                      />
                    </div>
                  </div>
                )}

                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr style={styles.thead}>
                        <th style={{ ...styles.th, width: 180, minWidth: 180 }}>Item Type (FBR)</th>
                        <th style={{ ...styles.th, minWidth: 140 }}>Description</th>
                        <th style={{ ...styles.th, width: 120, minWidth: 120 }}>Qty</th>
                        <th style={{ ...styles.th, width: 110, minWidth: 110 }}>UOM</th>
                        <th style={{ ...styles.th, width: 100, minWidth: 100 }}>Unit Price</th>
                        <th style={{ ...styles.th, width: 100, minWidth: 100 }}>Line Total</th>
                        <th style={{ ...styles.th, width: 90, minWidth: 90 }}>HS Code</th>
                        <th style={{ ...styles.th, minWidth: 140 }}>Sale Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => {
                        const hasItemType = !!item.itemTypeId;
                        return (
                          <tr key={item.id || `new-${idx}`}>
                            <td style={styles.td}>
                              {lockItemType ? (
                                <div style={styles.readOnlyText}>{item.itemTypeName || <span style={styles.muted}>—</span>}</div>
                              ) : (
                                <SearchableItemTypeSelect
                                  items={filteredItemTypes}
                                  value={item.itemTypeId || ""}
                                  onChange={(newId, picked) => updateItemType(idx, newId ? parseInt(newId) : null, picked)}
                                  placeholder="Pick item…"
                                  style={styles.tableInput}
                                />
                              )}
                            </td>
                            <td style={styles.td}>
                              {lockNonItemType ? (
                                <div style={styles.readOnlyText}>{item.description || <span style={styles.muted}>—</span>}</div>
                              ) : (
                                <LookupAutocomplete
                                  label="Description"
                                  endpoint="/lookup/items"
                                  value={item.description || ""}
                                  onChange={(v) => updateItem(idx, "description", v)}
                                  inputClassName=""
                                  inputStyle={styles.tableInput}
                                />
                              )}
                            </td>
                            <td style={styles.td}>
                              {/* Uses lockQty (not lockNonItemType) so the
                                  ItemType+Qty narrow mode keeps this cell
                                  editable while everything else stays locked. */}
                              <QuantityInput
                                value={item.quantity ?? 0}
                                onChange={(val) => updateItem(idx, "quantity", val)}
                                unit={item.uom}
                                units={units}
                                disabled={lockQty}
                                readOnly={lockQty}
                                style={{ ...styles.tableInput, ...(lockQty ? styles.readOnlyInput : {}), textAlign: "right" }}
                              />
                            </td>
                            <td style={{ ...styles.td, ...styles.readOnlyCell }} title="Comes from Item Type">
                              {item.uom || <span style={styles.muted}>—</span>}
                            </td>
                            <td style={styles.td}>
                              <input
                                type="number"
                                style={{ ...styles.tableInput, ...(lockNonItemType ? styles.readOnlyInput : {}), textAlign: "right" }}
                                value={item.unitPrice ?? 0}
                                onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                                min={0}
                                step={0.01}
                                readOnly={lockNonItemType}
                              />
                            </td>
                            <td style={{ ...styles.td, fontWeight: 600, color: colors.textPrimary, textAlign: "right" }}>
                              {(parseFloat(item.lineTotal) || 0).toLocaleString()}
                            </td>
                            <td style={{ ...styles.td, ...styles.readOnlyCell, fontFamily: "monospace" }} title="Comes from Item Type">
                              {item.hsCode || <span style={styles.muted}>—</span>}
                            </td>
                            <td style={{ ...styles.td, ...styles.readOnlyCell, fontSize: "0.72rem" }} title="Comes from Item Type">
                              {item.saleType || <span style={styles.muted}>—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div style={styles.totalsBox}>
                  <div style={styles.totalsRow}>
                    <span>Subtotal:</span>
                    <strong>Rs. {subtotal.toLocaleString()}</strong>
                  </div>
                  <div style={styles.totalsRow}>
                    <span>GST ({gstRate}%):</span>
                    <strong>Rs. {gstAmount.toLocaleString()}</strong>
                  </div>
                  <div style={{ ...styles.totalsRow, borderTop: `1px solid ${colors.cardBorder}`, paddingTop: "0.5rem", marginTop: "0.5rem" }}>
                    <span style={{ fontWeight: 700 }}>Grand Total:</span>
                    <strong style={{ fontSize: "1.1rem", color: colors.blue }}>Rs. {grandTotal.toLocaleString()}</strong>
                  </div>
                </div>

                {invoice?.fbrStatus === "Validated" && (
                  <div style={styles.warnNote}>
                    ⓘ Editing this bill will clear its FBR validation status. You'll need to re-validate before submitting to FBR.
                  </div>
                )}
              </>
            )}
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && invoice?.isEditable && (canFullEdit || canEditItemTypeAndQty || canEditItemType) && (
              <button
                type="submit"
                style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }}
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : itemTypeOnlyMode
                    ? "Save Item Types"
                    : itemTypeAndQtyMode
                      ? "Save Item Types & Qty"
                      : "Save Changes"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  errorAlert: { padding: "0.7rem 1rem", backgroundColor: colors.dangerLight, color: colors.danger, borderRadius: 6, marginBottom: "1rem", fontSize: "0.85rem" },
  warnNote: { padding: "0.7rem 1rem", backgroundColor: colors.warnBg, color: colors.warn, borderRadius: 6, marginTop: "1rem", fontSize: "0.82rem", border: `1px solid ${colors.warnBorder}` },
  infoBox: {
    display: "flex", alignItems: "flex-start", gap: "0.5rem",
    padding: "0.65rem 0.85rem", backgroundColor: colors.infoBg,
    color: colors.textPrimary, borderRadius: 6, marginBottom: "1rem",
    fontSize: "0.82rem", border: `1px solid ${colors.infoBorder}`,
  },
  row: { display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", fontSize: "0.82rem", fontWeight: 600, color: colors.textPrimary, marginBottom: "0.3rem" },
  input: { width: "100%", padding: "0.55rem 0.75rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 6, fontSize: "0.85rem", backgroundColor: colors.inputBg },
  sectionHeading: { margin: "1rem 0 0.5rem", fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary },
  tableWrap: { width: "100%", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 1100, tableLayout: "fixed" },
  thead: { backgroundColor: "#f5f7fa" },
  th: { padding: "0.6rem 0.5rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${colors.cardBorder}` },
  td: { padding: "0.4rem 0.5rem", fontSize: "0.82rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "middle" },
  tableInput: { width: "100%", padding: "0.35rem 0.5rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 4, fontSize: "0.8rem", backgroundColor: "#fff" },
  narrowPermissionBanner: {
    display: "flex", alignItems: "flex-start", gap: "0.5rem",
    padding: "0.65rem 0.85rem", backgroundColor: colors.warnBg,
    color: colors.textPrimary, borderRadius: 6, marginBottom: "1rem",
    fontSize: "0.82rem", border: `1px solid ${colors.warnBorder}`, lineHeight: 1.4,
  },
  readOnlyCell: { backgroundColor: "#f5f7fa", color: colors.textPrimary, fontSize: "0.78rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  readOnlyInput: { backgroundColor: "#f5f7fa", cursor: "not-allowed", pointerEvents: "none" },
  readOnlyText: { padding: "0.35rem 0.5rem", fontSize: "0.8rem", color: colors.textPrimary, fontWeight: 600 },
  muted: { color: "#9ca3af", fontStyle: "italic" },
  gridHint: { margin: "0.5rem 0 0.6rem", fontSize: "0.75rem", color: colors.textSecondary, lineHeight: 1.4 },
  bulkApplyBar: {
    display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap",
    padding: "0.55rem 0.85rem", marginBottom: "0.65rem",
    borderRadius: 8, border: `1px solid ${colors.cardBorder}`,
    backgroundColor: "#f8faff",
  },
  bulkApplyLabel: { fontSize: "0.82rem", color: colors.textPrimary, fontWeight: 500 },
  totalsBox: { marginTop: "1rem", padding: "0.75rem 1rem", backgroundColor: "#f5f7fa", borderRadius: 8, maxWidth: 360, marginLeft: "auto" },
  totalsRow: { display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: colors.textPrimary, padding: "0.2rem 0" },
};
