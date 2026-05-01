import { useState, useEffect, useMemo } from "react";
import { MdAdd, MdDelete, MdCheck, MdInfo, MdLock, MdPersonAdd, MdInventory2 } from "react-icons/md";
import { createStandaloneInvoice } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { getFbrApplicableScenarios, getFbrHSCodes } from "../api/fbrApi";
import { getItemTypes, createItemType, getItemTypeFbrHints } from "../api/itemTypeApi";
import { formStyles, modalSizes } from "../theme";
import { usePermissions } from "../contexts/PermissionsContext";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import ClientForm from "./ClientForm";

// Bill-without-challan flow ("Standalone Bill"). Per FBR DI-API V1.12:
//   • §9 (Scenarios) — locks Sale Type per SN.
//   • §10 (Applicable Scenarios) — only the SNs valid for the company's
//     Activity × Sector profile are listed.
//
// Operator interaction model: pick scenario → pick buyer (filtered by
// scenario) → add lines (item type + qty + unit price). Everything
// else (HSCode, UOM, SaleType, GST rate, payment mode, MRP-vs-unit-
// price split, SRO refs) is locked / auto-derived by the scenario or
// the picked Item Type. Operator can ALSO inline-create a Buyer or an
// Item Type from this same form when permitted.

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
  warn: "#e65100",
  warnLight: "#fff8e1",
};

// Per §9 + §10. Each entry annotates the backend's Scenario record so
// the form's conditional rendering doesn't have to read SN codes.
//   buyerKind — drives the buyer-pool filter:
//     "b2b-registered"   → only Registered clients
//     "b2b-unregistered" → only Unregistered clients
//     "walk-in"          → only Unregistered (counter sale)
//     "either"           → no filter (FBR accepts both)
//   needsMRP — line carries fixedNotifiedValueOrRetailPrice (3rd-Sched).
//   needsSRO — line carries SRO Schedule + Item Serial #.
const SCENARIO_META = {
  SN001: { buyerKind: "b2b-registered",   needsMRP: false, needsSRO: false, hint: "Wholesale B2B to a registered buyer (NTN required, validated by FBR)." },
  SN002: { buyerKind: "b2b-unregistered", needsMRP: false, needsSRO: false, hint: "B2B to an unregistered buyer. 4% further tax common at submit time." },
  SN003: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Sale of Steel (Melted and Re-Rolled)." },
  SN004: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Sale by Ship Breakers." },
  SN005: { buyerKind: "either",           needsMRP: false, needsSRO: true,  hint: "Reduced rate sale — SRO reference required." },
  SN006: { buyerKind: "either",           needsMRP: false, needsSRO: true,  hint: "Exempt goods (rate 0%) — SRO reference required." },
  SN007: { buyerKind: "either",           needsMRP: false, needsSRO: true,  hint: "Zero rated sale — SRO reference required." },
  SN008: { buyerKind: "either",           needsMRP: true,  needsSRO: false, hint: "3rd Schedule goods — tax backed out of MRP. Enter the printed retail price × qty." },
  SN009: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Cotton ginners → spinners (Textile Sector)." },
  SN010: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Telecom services rendered or provided." },
  SN011: { buyerKind: "b2b-registered",   needsMRP: false, needsSRO: false, hint: "Toll Manufacturing sale by Steel sector (registered buyer only)." },
  SN012: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Sale of Petroleum products." },
  SN013: { buyerKind: "b2b-registered",   needsMRP: false, needsSRO: false, hint: "Electricity supply to retailers (registered buyer)." },
  SN014: { buyerKind: "b2b-registered",   needsMRP: false, needsSRO: false, hint: "Sale of gas to CNG stations (registered buyer)." },
  SN015: { buyerKind: "either",           needsMRP: false, needsSRO: true,  hint: "Sale of mobile phones — Ninth Schedule SRO reference required." },
  SN016: { buyerKind: "b2b-registered",   needsMRP: false, needsSRO: false, hint: "Processing / Conversion of Goods (registered buyer)." },
  SN017: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Sale of goods where FED is charged in ST mode." },
  SN018: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Services rendered where FED is charged in ST mode." },
  SN019: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Services rendered or provided (16% standard)." },
  SN020: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Sale of Electric Vehicles (1%)." },
  SN021: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Sale of Cement / Concrete Block." },
  SN022: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Sale of Potassium Chlorate." },
  SN023: { buyerKind: "either",           needsMRP: false, needsSRO: false, hint: "Sale of CNG." },
  SN024: { buyerKind: "either",           needsMRP: false, needsSRO: true,  hint: "Goods listed in SRO 297(I)/2023 — SRO reference required." },
  SN025: { buyerKind: "either",           needsMRP: false, needsSRO: true,  hint: "Drugs at fixed ST rate (Eighth Schedule Table 1, S.No 81)." },
  SN026: { buyerKind: "walk-in",          needsMRP: false, needsSRO: false, hint: "Retail counter sale to an end consumer at standard rate." },
  SN027: { buyerKind: "walk-in",          needsMRP: true,  needsSRO: false, hint: "Retail counter sale of 3rd Schedule goods. MRP × qty required." },
  SN028: { buyerKind: "walk-in",          needsMRP: false, needsSRO: true,  hint: "Retail counter sale at reduced rate. SRO Schedule + Item No required." },
};

const blankRow = () => ({
  localId: Math.random().toString(36).slice(2, 10),
  itemTypeId: "",
  itemTypeName: "",       // mirrored from the picked ItemType for the read-only Description column
  hsCode: "",
  uom: "",
  fbrUOMId: null,
  saleType: "",           // overridden by scenario at save time, kept for display only
  quantity: "",
  unitPrice: "",
  // Scenario-specific extras
  // MRP scenarios (SN008 / SN027) — operator types the per-unit MRP
  // (the printed retail price). The MRP × Qty total column is computed
  // and read-only. On submit we ship `fixedNotifiedValueOrRetailPrice`
  // = mrp × quantity, which is what FBR expects on the line.
  mrp: "",
  sroScheduleNo: "",
  sroItemSerialNo: "",
});

export default function StandaloneInvoiceForm({ companyId, company, onClose, onSaved }) {
  const { has } = usePermissions();
  const canCreateClient   = has("clients.manage.create");
  const canCreateItemType = has("itemtypes.manage.create");

  const [clients, setClients] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [scenarios, setScenarios] = useState([]);

  const [selectedClientId, setSelectedClientId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [gstRate, setGstRate] = useState(18);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [documentType, setDocumentType] = useState(4);
  const [paymentMode, setPaymentMode] = useState("");
  const [scenarioCode, setScenarioCode] = useState("");
  const [rows, setRows] = useState([blankRow()]);

  // Bulk-apply mode for the "set Item Type on every row" toolbar — saves
  // the operator from picking the same catalog row N times when every
  // line on the bill is the same FBR category. Mirrors the InvoiceForm
  // (with-challan) bulk apply.
  const [bulkApplyMode, setBulkApplyMode] = useState("all");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Inline-create modals
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddItemType, setShowAddItemType] = useState(false);
  // Which row's item-type select triggered the Add modal — used so the
  // newly-created type auto-selects on that row when the modal closes.
  const [pendingItemTypeRow, setPendingItemTypeRow] = useState(null);

  const refreshClients = async () => {
    const { data } = await getClientsByCompany(companyId);
    setClients(data || []);
    return data || [];
  };
  const refreshItemTypes = async () => {
    const { data } = await getItemTypes();
    setItemTypes(data || []);
    return data || [];
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [, , scenarioRes] = await Promise.all([
          refreshClients(),
          refreshItemTypes(),
          getFbrApplicableScenarios(companyId).catch(() => ({ data: { scenarios: [] } })),
        ]);
        setScenarios(scenarioRes.data?.scenarios || []);
      } catch {
        setError("Failed to load data.");
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // Decorate scenarios with local meta. Falls back to a generic record
  // if the backend ever sends a code we don't know — form never crashes.
  const enrichedScenarios = useMemo(
    () => scenarios.map((s) => ({
      ...s,
      meta: SCENARIO_META[s.code]
        || { buyerKind: "either", needsMRP: false, needsSRO: false, hint: s.description || "" },
    })),
    [scenarios],
  );

  // Default to SN001 when applicable — most operators bill registered B2B
  // at standard rate, so opening on SN001 saves a click. If SN001 isn't in
  // the applicable list (e.g. company has a niche profile that excludes it),
  // we fall through to the empty / "pick a scenario" state.
  useEffect(() => {
    if (!scenarioCode && enrichedScenarios.length > 0) {
      const sn001 = enrichedScenarios.find((s) => s.code === "SN001");
      if (sn001) setScenarioCode("SN001");
    }
  }, [enrichedScenarios, scenarioCode]);

  const chosenScenario = useMemo(
    () => enrichedScenarios.find((s) => s.code === scenarioCode) || null,
    [enrichedScenarios, scenarioCode],
  );

  // GST rate auto-syncs to scenario's canonical rate when one is picked.
  // The input itself is locked when a scenario is active — operators
  // override only by switching scenario.
  useEffect(() => {
    if (chosenScenario && chosenScenario.defaultRate != null) {
      setGstRate(chosenScenario.defaultRate);
    }
  }, [chosenScenario]);

  // Buyer pool filter.
  const filteredClients = useMemo(() => {
    if (!chosenScenario) return clients;
    const k = chosenScenario.meta.buyerKind;
    if (k === "b2b-registered")
      return clients.filter((c) => (c.registrationType || "").toLowerCase() === "registered");
    if (k === "b2b-unregistered" || k === "walk-in")
      return clients.filter((c) => (c.registrationType || "").toLowerCase() !== "registered");
    return clients;
  }, [clients, chosenScenario]);

  // Auto-pick a sensible default buyer on scenario change.
  useEffect(() => {
    if (!chosenScenario) return;
    const k = chosenScenario.meta.buyerKind;
    if (k === "walk-in") {
      if (filteredClients.length > 0) setSelectedClientId(String(filteredClients[0].id));
      else setSelectedClientId("");
    } else if (k === "b2b-registered" || k === "b2b-unregistered") {
      if (selectedClientId && !filteredClients.some((c) => String(c.id) === String(selectedClientId)))
        setSelectedClientId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenScenario]);

  // Per-row helpers
  const updateRow = (localId, patch) =>
    setRows((prev) => prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (localId) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.localId !== localId)));

  const handleItemTypePick = (localId, picked) => {
    if (!picked) {
      updateRow(localId, {
        itemTypeId: "", itemTypeName: "", hsCode: "", uom: "", fbrUOMId: null, saleType: "",
      });
      return;
    }
    updateRow(localId, {
      itemTypeId: picked.id,
      itemTypeName: picked.name || "",
      hsCode: picked.hsCode || "",
      uom: picked.uom || "",
      fbrUOMId: picked.fbrUOMId || null,
      saleType: picked.saleType || "",
    });
  };

  // Bulk-apply: stamp one Item Type onto every row (or only empty rows).
  // Mirrors InvoiceForm's applyItemTypeToAll — saves repetitive picking
  // when every line on the bill is the same FBR category.
  const applyItemTypeToRows = (picked, mode) => {
    if (!picked) return;
    setRows((prev) => prev.map((r) => {
      if (mode === "empty" && r.itemTypeId) return r;
      return {
        ...r,
        itemTypeId: picked.id,
        itemTypeName: picked.name || "",
        hsCode: picked.hsCode || "",
        uom: picked.uom || "",
        fbrUOMId: picked.fbrUOMId || null,
        saleType: picked.saleType || "",
      };
    }));
  };

  // Item types compatible with the chosen scenario. When no scenario is
  // chosen, every catalog row is visible. When a scenario is locked in,
  // only items whose stored saleType matches the scenario's saleType
  // surface — same rule the InvoiceForm uses, prevents 0052 mixed-bucket
  // errors at FBR validation.
  const filteredItemTypes = useMemo(() => {
    if (!chosenScenario) return itemTypes;
    const target = (chosenScenario.saleType || "").trim().toLowerCase();
    return itemTypes.filter(
      (t) => (t.saleType || "").trim().toLowerCase() === target,
    );
  }, [itemTypes, chosenScenario]);

  // Effective sale type for a row — locked to scenario when one's picked.
  const effectiveSaleType = (r) => (chosenScenario ? chosenScenario.saleType : r.saleType || "");

  // Totals — see comment in CreateStandaloneAsync about MRP scenarios:
  // backend backs tax out of MRP at FBR submit, but the bill subtotal
  // here stays qty × unitPrice (price stored separately from MRP).
  const subtotal = rows.reduce((sum, r) => {
    const q = parseFloat(r.quantity) || 0;
    const p = parseFloat(r.unitPrice) || 0;
    return sum + q * p;
  }, 0);
  const gstAmount = Math.round(subtotal * (parseFloat(gstRate) || 0) / 100 * 100) / 100;
  const grandTotal = subtotal + gstAmount;

  const rowErrors = (r) => {
    const errs = [];
    if (!r.itemTypeId) errs.push("itemType");
    const q = parseFloat(r.quantity);
    if (!(q > 0)) errs.push("qty>0");
    const p = parseFloat(r.unitPrice);
    if (!(p > 0)) errs.push("unitPrice>0");
    if (chosenScenario?.meta.needsMRP) {
      const mrp = parseFloat(r.mrp);
      if (!(mrp > 0)) errs.push("MRP>0");
    }
    if (chosenScenario?.meta.needsSRO) {
      if (!r.sroScheduleNo?.trim()) errs.push("sroSchedule");
      if (!r.sroItemSerialNo?.trim()) errs.push("sroItemNo");
    }
    return errs;
  };
  const allRowsValid = rows.length > 0 && rows.every((r) => rowErrors(r).length === 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!selectedClientId) return setError("Select a buyer first.");
    if (!company || company.startingInvoiceNumber === 0)
      return setError("Starting bill number not set for this company. Configure it on the Companies page first.");
    if (!chosenScenario) return setError("Pick an FBR scenario first.");
    if (!allRowsValid) {
      const missing = rows.flatMap(rowErrors);
      return setError(`Fill all required fields. Missing: ${[...new Set(missing)].join(", ")}.`);
    }

    setSaving(true);
    try {
      await createStandaloneInvoice({
        date: new Date(invoiceDate).toISOString(),
        companyId,
        clientId: parseInt(selectedClientId),
        gstRate: parseFloat(gstRate),
        paymentTerms: paymentTerms || null,
        scenarioId: scenarioCode || null,
        documentType: documentType || null,
        paymentMode: paymentMode || null,
        items: rows.map((r) => ({
          itemTypeId: r.itemTypeId ? parseInt(r.itemTypeId) : null,
          // Description is the item type's name — the operator never edits
          // it directly. CreateStandaloneAsync stores it on InvoiceItem.Description.
          description: r.itemTypeName || "",
          quantity: parseFloat(r.quantity),
          uom: r.uom?.trim() || null,
          unitPrice: parseFloat(r.unitPrice),
          hsCode: r.hsCode?.trim() || null,
          saleType: effectiveSaleType(r) || null,
          fbrUOMId: r.fbrUOMId || null,
          // MRP × Qty (FBR field name `fixedNotifiedValueOrRetailPrice`)
          // is computed from the per-unit MRP the operator typed × the
          // quantity already on the row. Storing as the precomputed total
          // matches what FBR expects; the per-unit MRP itself is a UI
          // affordance only and isn't persisted separately.
          fixedNotifiedValueOrRetailPrice:
            chosenScenario.meta.needsMRP && r.mrp && r.quantity
              ? Math.round(parseFloat(r.mrp) * parseFloat(r.quantity) * 100) / 100
              : null,
          sroScheduleNo: chosenScenario.meta.needsSRO ? r.sroScheduleNo?.trim() || null : null,
          sroItemSerialNo: chosenScenario.meta.needsSRO ? r.sroItemSerialNo?.trim() || null : null,
        })),
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || "Failed to create bill.");
    } finally {
      setSaving(false);
    }
  };

  // Inline-create handlers — refresh the underlying list and auto-select
  // the new entity. Errors bubble up to the API form (ClientForm) or are
  // surfaced inline (item-type mini form).
  const onClientSaved = async (created) => {
    setShowAddClient(false);
    const list = await refreshClients();
    if (created?.id) setSelectedClientId(String(created.id));
    else if (list.length > 0) setSelectedClientId(String(list[0].id));
  };

  const onItemTypeSaved = async (created) => {
    setShowAddItemType(false);
    const list = await refreshItemTypes();
    if (created?.id && pendingItemTypeRow) {
      handleItemTypePick(pendingItemTypeRow, list.find((t) => t.id === created.id) || created);
    }
    setPendingItemTypeRow(null);
  };

  const showMRP = !!chosenScenario?.meta.needsMRP;
  const showSRO = !!chosenScenario?.meta.needsSRO;
  const buyerKind = chosenScenario?.meta.buyerKind || null;

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xxl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>Create Bill (No Challan)</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ ...formStyles.body, maxHeight: "75vh", overflowY: "auto" }}>
            {error && <div style={styles.errorAlert}>{error}</div>}

            {loading ? (
              <div style={{ textAlign: "center", padding: "2rem", color: colors.textSecondary }}>Loading…</div>
            ) : (
              <>
                {/* ── Step 1: Pick FBR scenario ─────────────── */}
                <div style={{ marginBottom: "1rem" }}>
                  <label style={styles.stepLabel}>
                    <span style={styles.stepNum}>1</span> Pick FBR Scenario
                  </label>
                  <p style={styles.stepHint}>
                    Each scenario locks the Sale Type, GST rate, buyer type, and any extra fields FBR needs to validate this bill.
                    Only the scenarios applicable to your company's profile
                    ({company?.fbrBusinessActivity || "—"} · {company?.fbrSector || "—"}) are listed.
                  </p>
                  {enrichedScenarios.length === 0 ? (
                    <div style={styles.warnAlert}>
                      <MdInfo size={16} /> No FBR scenarios available. Configure Business Activity
                      and Sector on the Company before creating a standalone bill.
                    </div>
                  ) : (
                    <div style={styles.scenarioGrid}>
                      {enrichedScenarios.map((s) => {
                        const active = scenarioCode === s.code;
                        return (
                          <button
                            type="button"
                            key={s.code}
                            onClick={() => setScenarioCode(s.code)}
                            style={{
                              ...styles.scenarioCard,
                              borderColor: active ? colors.blue : colors.cardBorder,
                              backgroundColor: active ? "#e3f2fd" : "#fff",
                            }}
                          >
                            <div style={styles.scenarioCardHeader}>
                              <span style={styles.scenarioCode}>{s.code}</span>
                              {active && <MdCheck size={16} color={colors.blue} />}
                            </div>
                            <div style={styles.scenarioSaleType}>{s.saleType}</div>
                            <div style={styles.scenarioRate}>{s.defaultRate}% GST</div>
                            <div style={styles.scenarioBadges}>
                              {s.meta.buyerKind === "b2b-registered" && <span style={{ ...styles.scenarioBadge, ...styles.badgeBlue }}>Registered buyer</span>}
                              {s.meta.buyerKind === "b2b-unregistered" && <span style={{ ...styles.scenarioBadge, ...styles.badgeOrange }}>Unregistered buyer</span>}
                              {s.meta.buyerKind === "walk-in" && <span style={{ ...styles.scenarioBadge, ...styles.badgePurple }}>Walk-in retail</span>}
                              {s.meta.needsMRP && <span style={{ ...styles.scenarioBadge, ...styles.badgeYellow }}>MRP required</span>}
                              {s.meta.needsSRO && <span style={{ ...styles.scenarioBadge, ...styles.badgePink }}>SRO required</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {chosenScenario && (
                    <div style={styles.scenarioHint}>
                      <MdInfo size={14} color={colors.blue} /> {chosenScenario.meta.hint}
                    </div>
                  )}
                </div>

                {/* ── Step 2: Buyer ─────────────── */}
                {chosenScenario && (
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={styles.stepLabel}>
                      <span style={styles.stepNum}>2</span>
                      {buyerKind === "walk-in" ? "Walk-in Buyer" : "Buyer"}
                    </label>
                    <div style={styles.inlineRow}>
                      {filteredClients.length === 0 ? (
                        <div style={{ ...styles.warnAlert, flex: 1 }}>
                          <MdInfo size={16} />
                          No matching{" "}
                          {buyerKind === "b2b-registered" ? "Registered"
                            : buyerKind === "b2b-unregistered" ? "Unregistered"
                            : buyerKind === "walk-in" ? "Unregistered (Walk-in)" : ""}{" "}
                          clients yet.
                        </div>
                      ) : (
                        <select
                          style={{ ...styles.select, flex: 1 }}
                          value={selectedClientId}
                          onChange={(e) => setSelectedClientId(e.target.value)}
                        >
                          <option value="">— Choose a buyer —</option>
                          {filteredClients.map((cl) => (
                            <option key={cl.id} value={cl.id}>
                              {cl.name} ({cl.registrationType || "—"}{cl.ntn ? ` · NTN ${cl.ntn}` : cl.cnic ? ` · CNIC ${cl.cnic}` : ""})
                            </option>
                          ))}
                        </select>
                      )}
                      {/* Inline-create. Hidden when caller can't create
                          clients — replaced by an inline hint instead. */}
                      {canCreateClient ? (
                        <button
                          type="button"
                          style={styles.inlineAddBtn}
                          onClick={() => setShowAddClient(true)}
                          title="Create a new buyer without leaving this form"
                        >
                          <MdPersonAdd size={14} /> New Buyer
                        </button>
                      ) : (
                        <PermissionLackedHint perm="clients.manage.create" what="add a new buyer" />
                      )}
                    </div>
                    {company && company.startingInvoiceNumber > 0 && (
                      <span style={{ fontSize: "0.78rem", color: colors.textSecondary, marginTop: "0.3rem", display: "block" }}>
                        Next bill #: {company.currentInvoiceNumber > 0 ? company.currentInvoiceNumber + 1 : company.startingInvoiceNumber}
                      </span>
                    )}
                  </div>
                )}

                {/* ── Step 3: Bill header + items ─────────────── */}
                {chosenScenario && selectedClientId && (
                  <>
                    <label style={styles.stepLabel}>
                      <span style={styles.stepNum}>3</span> Bill Details
                    </label>

                    <div style={styles.row}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={styles.label}>Bill Date</label>
                        <input type="date" style={styles.input} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 100 }}>
                        <label style={styles.label}>
                          GST Rate (%) <span style={styles.lockedTag}><MdLock size={10} /> scenario-locked</span>
                        </label>
                        <input
                          type="number"
                          style={{ ...styles.input, backgroundColor: "#eef5ff", cursor: "not-allowed" }}
                          value={gstRate}
                          readOnly
                          title={`Locked by ${chosenScenario.code}. Switch scenario to change.`}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={styles.label}>Payment Terms</label>
                        <input type="text" style={styles.input} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Optional" />
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={styles.label}>Document Type <span style={styles.optionalTag}>FBR</span></label>
                        <select style={styles.input} value={documentType} onChange={(e) => setDocumentType(parseInt(e.target.value))}>
                          <option value={4}>Sale Invoice</option>
                          <option value={9}>Debit Note</option>
                          <option value={10}>Credit Note</option>
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={styles.label}>Payment Mode <span style={styles.optionalTag}>FBR</span></label>
                        <select style={styles.input} value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                          <option value="">— optional —</option>
                          <option>Cash</option>
                          <option>Credit</option>
                          <option>Bank Transfer</option>
                          <option>Cheque</option>
                          <option>Online</option>
                        </select>
                      </div>
                    </div>

                    <div style={styles.lockedSaleType}>
                      <MdLock size={14} color={colors.teal} />
                      <span><b>Sale Type locked:</b> {chosenScenario.saleType}</span>
                      <span style={styles.lockedSaleTypeHint}>(every line uses this — required by {chosenScenario.code})</span>
                    </div>

                    {/* Items table */}
                    <div>
                      <div style={styles.itemsHeaderBar}>
                        <label style={{ ...styles.label, margin: 0 }}>Items ({rows.length})</label>
                        <button type="button" style={styles.addRowBtn} onClick={addRow}>
                          <MdAdd size={14} /> Add Row
                        </button>
                      </div>

                      {/* Bulk-apply toolbar — single dropdown stamps the
                          same catalog row across every line (or only the
                          empty ones). Only shown once there are 2+ rows
                          since it has no value at row count = 1. */}
                      {rows.length > 1 && (
                        <div style={styles.bulkApplyBar}>
                          <span style={{ fontSize: "0.82rem", color: colors.textPrimary, fontWeight: 500 }}>
                            Apply same Item Type to:
                          </span>
                          <select
                            value={bulkApplyMode}
                            onChange={(e) => setBulkApplyMode(e.target.value)}
                            style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem", maxWidth: 180 }}
                          >
                            <option value="all">All {rows.length} rows</option>
                            <option value="empty">Only empty rows</option>
                          </select>
                          <div style={{ flex: "1 1 220px", maxWidth: 280 }}>
                            <SearchableItemTypeSelect
                              items={filteredItemTypes}
                              value=""
                              onChange={(_, picked) => applyItemTypeToRows(picked, bulkApplyMode)}
                              placeholder={bulkApplyMode === "all"
                                ? "— pick to apply to all —"
                                : "— pick to fill empty rows —"}
                              style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                            />
                          </div>
                        </div>
                      )}

                      <div style={styles.unifiedTableWrap}>
                        <table style={styles.unifiedTable}>
                          <thead>
                            <tr style={styles.unifiedThead}>
                              <th style={{ ...styles.unifiedTh, width: showMRP || showSRO ? "22%" : "26%" }}>Item Type *</th>
                              <th style={{ ...styles.unifiedTh, width: showMRP || showSRO ? "16%" : "20%" }}>Description</th>
                              <th style={{ ...styles.unifiedTh, width: "7%" }}>Qty *</th>
                              <th style={{ ...styles.unifiedTh, width: "8%" }}>UOM</th>
                              <th style={{ ...styles.unifiedTh, width: "9%" }}>Unit Price *</th>
                              <th style={{ ...styles.unifiedTh, width: "10%" }}>Line Total</th>
                              <th style={{ ...styles.unifiedTh, width: "10%" }}>HS Code</th>
                              {showMRP && <th style={{ ...styles.unifiedTh, width: "9%", backgroundColor: "#fff8e1" }}>MRP / unit *</th>}
                              {showMRP && <th style={{ ...styles.unifiedTh, width: "9%", backgroundColor: "#fff8e1" }}>MRP × Qty</th>}
                              {showSRO && <th style={{ ...styles.unifiedTh, width: "10%", backgroundColor: "#fce4ec" }}>SRO Schedule *</th>}
                              {showSRO && <th style={{ ...styles.unifiedTh, width: "8%", backgroundColor: "#fce4ec" }}>SRO Item No *</th>}
                              <th style={{ ...styles.unifiedTh, width: "4%" }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => {
                              const q = parseFloat(r.quantity) || 0;
                              const p = parseFloat(r.unitPrice) || 0;
                              return (
                                <tr key={r.localId} style={styles.unifiedRow}>
                                  <td style={styles.unifiedTd}>
                                    <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <SearchableItemTypeSelect
                                          items={filteredItemTypes}
                                          value={r.itemTypeId}
                                          onChange={(id, picked) => handleItemTypePick(r.localId, picked || null)}
                                          placeholder="Pick from your catalog…"
                                          style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                        />
                                      </div>
                                      {canCreateItemType ? (
                                        <button
                                          type="button"
                                          style={styles.tinyAddBtn}
                                          title="Add a new item type to your catalog"
                                          onClick={() => { setPendingItemTypeRow(r.localId); setShowAddItemType(true); }}
                                        >
                                          <MdAdd size={14} />
                                        </button>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td style={{ ...styles.unifiedTd, color: r.itemTypeName ? colors.textPrimary : colors.textSecondary, fontStyle: r.itemTypeName ? "normal" : "italic" }}>
                                    {r.itemTypeName || "(pick an item type)"}
                                  </td>
                                  <td style={styles.unifiedTd}>
                                    <input
                                      type="number" min={0} step="any"
                                      style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                      value={r.quantity}
                                      onChange={(e) => updateRow(r.localId, { quantity: e.target.value })}
                                      placeholder="0"
                                    />
                                  </td>
                                  <td style={styles.unifiedTd}>
                                    <input
                                      type="text"
                                      readOnly={!!r.itemTypeId}
                                      style={{
                                        ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem",
                                        backgroundColor: r.itemTypeId ? "#eef5ff" : colors.inputBg,
                                        cursor: r.itemTypeId ? "not-allowed" : "text",
                                      }}
                                      value={r.uom}
                                      onChange={(e) => updateRow(r.localId, { uom: e.target.value })}
                                      placeholder="auto from item type"
                                      title={r.itemTypeId ? "Inherited from the picked item type" : ""}
                                    />
                                  </td>
                                  <td style={styles.unifiedTd}>
                                    <input
                                      type="number" min={0} step={0.01}
                                      style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                      value={r.unitPrice}
                                      onChange={(e) => updateRow(r.localId, { unitPrice: e.target.value })}
                                      placeholder="0.00"
                                    />
                                  </td>
                                  <td style={{ ...styles.unifiedTd, textAlign: "right", fontWeight: 600, fontSize: "0.82rem" }}>
                                    {(q * p).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </td>
                                  <td style={styles.unifiedTd}>
                                    <input
                                      type="text"
                                      readOnly={!!r.itemTypeId}
                                      style={{
                                        ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.78rem", fontFamily: "monospace",
                                        backgroundColor: r.itemTypeId ? "#eef5ff" : colors.inputBg,
                                        cursor: r.itemTypeId ? "not-allowed" : "text",
                                      }}
                                      value={r.hsCode}
                                      onChange={(e) => updateRow(r.localId, { hsCode: e.target.value })}
                                      placeholder="auto from item type"
                                      title={r.itemTypeId ? "Inherited from the picked item type" : ""}
                                    />
                                  </td>
                                  {showMRP && (
                                    <td style={{ ...styles.unifiedTd, backgroundColor: "#fffdf5" }}>
                                      <input
                                        type="number" min={0} step={0.01}
                                        style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                        value={r.mrp}
                                        onChange={(e) => updateRow(r.localId, { mrp: e.target.value })}
                                        placeholder="MRP / unit"
                                        title="Printed retail price PER UNIT. The MRP × Qty total is computed automatically."
                                      />
                                    </td>
                                  )}
                                  {showMRP && (
                                    <td style={{ ...styles.unifiedTd, backgroundColor: "#fffdf5", textAlign: "right", fontWeight: 600, fontSize: "0.82rem" }}>
                                      {(() => {
                                        const m = parseFloat(r.mrp) || 0;
                                        const total = m * q;
                                        return total > 0
                                          ? total.toLocaleString(undefined, { minimumFractionDigits: 2 })
                                          : "—";
                                      })()}
                                    </td>
                                  )}
                                  {showSRO && (
                                    <td style={{ ...styles.unifiedTd, backgroundColor: "#fff7fa" }}>
                                      <input
                                        type="text"
                                        style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                                        value={r.sroScheduleNo}
                                        onChange={(e) => updateRow(r.localId, { sroScheduleNo: e.target.value })}
                                        placeholder='e.g. "SRO 297(I)/2023"'
                                      />
                                    </td>
                                  )}
                                  {showSRO && (
                                    <td style={{ ...styles.unifiedTd, backgroundColor: "#fff7fa" }}>
                                      <input
                                        type="text"
                                        style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                                        value={r.sroItemSerialNo}
                                        onChange={(e) => updateRow(r.localId, { sroItemSerialNo: e.target.value })}
                                        placeholder="serial #"
                                      />
                                    </td>
                                  )}
                                  <td style={{ ...styles.unifiedTd, textAlign: "center" }}>
                                    <button
                                      type="button"
                                      style={styles.removeRowBtn}
                                      onClick={() => removeRow(r.localId)}
                                      disabled={rows.length === 1}
                                      title={rows.length === 1 ? "At least one row is required" : "Remove this row"}
                                    >
                                      <MdDelete size={14} />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p style={styles.fbrToggleHint}>
                        <b>*</b> required ·
                        <b> Description, UOM, HS Code, Sale Type</b> all auto-fill from the picked Item Type
                        {!canCreateItemType && (
                          <span style={{ marginLeft: 8 }}>
                            · <PermissionLackedHint inline perm="itemtypes.manage.create" what="add a new item type" />
                          </span>
                        )}
                        {showMRP && " · enter the per-unit MRP — the MRP × Qty total drives 3rd Schedule tax (backed out of MRP)"}
                        {showSRO && " · SRO Schedule + Item No referenced for reduced-rate items"}
                      </p>

                      {/* Totals */}
                      <div style={styles.totalsBox}>
                        <div style={styles.totalRow}><span>Subtotal:</span><span>Rs. {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                        <div style={styles.totalRow}><span>GST ({gstRate}%):</span><span>Rs. {gstAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                        <div style={{ ...styles.totalRow, fontWeight: 700, fontSize: "1rem", borderTop: "2px solid #333", paddingTop: "0.5rem" }}>
                          <span>Grand Total:</span><span>Rs. {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          <div style={formStyles.footer}>
            {!allRowsValid && rows.length > 0 && chosenScenario && selectedClientId && (
              <span style={{ fontSize: "0.8rem", color: colors.danger, marginRight: "auto" }}>
                Some required fields are missing.
              </span>
            )}
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button
              type="submit"
              style={{
                ...formStyles.button, ...formStyles.submit,
                opacity: saving || !chosenScenario || !selectedClientId || !allRowsValid ? 0.6 : 1,
              }}
              disabled={saving || !chosenScenario || !selectedClientId || !allRowsValid}
            >
              {saving ? "Creating…" : `Create Bill${chosenScenario ? ` · ${chosenScenario.code}` : ""}`}
            </button>
          </div>
        </form>
      </div>

      {/* Inline Add Buyer modal — reuses the regular ClientForm. Pin the
          single-company picker to the active company; multi-company
          picker auto-collapses since we pass companies=[]. */}
      {showAddClient && (
        <ClientForm
          client={null}
          companyId={companyId}
          companies={[]}
          onClose={() => setShowAddClient(false)}
          onSaved={(created) => onClientSaved(created)}
        />
      )}

      {/* Inline Add Item Type modal — small dedicated form (the full
          ItemTypesPage form is too heavy for an inline add). */}
      {showAddItemType && (
        <QuickItemTypeForm
          companyId={companyId}
          scenarioCode={chosenScenario?.code}
          scenarioSaleType={chosenScenario?.saleType}
          onClose={() => { setShowAddItemType(false); setPendingItemTypeRow(null); }}
          onSaved={onItemTypeSaved}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Inline mini-form for "+ New Item Type". Scenario-aware:
//
//   • Sale Type is LOCKED to the parent bill's scenario.saleType when
//     opened from a scenario context — saving a mismatched sale type
//     would just block the bill at FBR validation. Outside a scenario,
//     it falls back to a freeform select.
//
//   • HS Code is a live typeahead against `/api/fbr/hscodes/{companyId}`.
//     When the operator picks a code, /api/itemtypes/fbr-hints fills in
//     UOM (and the FBR uoM_ID) automatically. Sale Type stays locked
//     when in scenario context; if the FBR hint suggests a different
//     SaleType, we surface that as a heads-up.
// ────────────────────────────────────────────────────────────────────
function QuickItemTypeForm({ companyId, onClose, onSaved, scenarioCode, scenarioSaleType }) {
  const lockedSaleType = !!scenarioSaleType;

  const [name, setName] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [uom, setUom] = useState("");
  const [fbrUOMId, setFbrUOMId] = useState(null);
  const [saleType, setSaleType] = useState(scenarioSaleType || "Goods at standard rate (default)");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // HS code typeahead state
  const [hsQuery, setHsQuery] = useState("");
  const [hsSuggestions, setHsSuggestions] = useState([]);
  const [hsLoading, setHsLoading] = useState(false);
  const [hsOpen, setHsOpen] = useState(false);
  const [fbrHint, setFbrHint] = useState(null);     // last fetched fbr-hints bundle
  const [hintLoading, setHintLoading] = useState(false);

  // Debounced HS code search. 250ms idle is generous enough that the
  // network isn't hammered while the operator is still typing, but
  // tight enough that the dropdown feels live. When the modal opens
  // from a scenario context the saleType filter is passed through so
  // the dropdown only suggests HS codes that are valid under the
  // parent bill's locked sale type.
  useEffect(() => {
    const q = hsQuery.trim();
    if (q.length < 2) { setHsSuggestions([]); return; }
    const t = setTimeout(async () => {
      setHsLoading(true);
      try {
        const { data } = await getFbrHSCodes(companyId, q, scenarioSaleType || null);
        // Cap the suggestion list — FBR happily returns hundreds of
        // hits for a 2-letter prefix, but the dropdown becomes
        // unusable past ~30 entries.
        setHsSuggestions(Array.isArray(data) ? data.slice(0, 30) : []);
      } catch {
        setHsSuggestions([]);
      } finally {
        setHsLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [hsQuery, companyId, scenarioSaleType]);

  const pickHsCode = async (code) => {
    setHsCode(code);
    setHsQuery(code);
    setHsOpen(false);
    setFbrHint(null);
    setHintLoading(true);
    try {
      const { data } = await getItemTypeFbrHints(companyId, code);
      setFbrHint(data);
      if (data?.defaultUom) {
        setUom(data.defaultUom.description || "");
        setFbrUOMId(data.defaultUom.uoM_ID || null);
      }
      // Sale Type only auto-fills when NOT locked by scenario context.
      if (!lockedSaleType && data?.defaultSaleType) {
        setSaleType(data.defaultSaleType);
      }
    } catch { /* hints unavailable; UOM stays editable */ }
    finally { setHintLoading(false); }
  };

  // Heads-up: when locked to the scenario's sale type, surface a soft
  // warning if FBR's hint says this HS code is normally a different
  // sale type. Doesn't block save — the operator may still be right.
  const saleTypeMismatch = lockedSaleType
    && fbrHint?.defaultSaleType
    && fbrHint.defaultSaleType !== scenarioSaleType;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    try {
      const { data } = await createItemType({
        name: name.trim(),
        hsCode: hsCode.trim() || null,
        uom: uom.trim() || null,
        fbrUOMId: fbrUOMId || null,
        saleType: saleType || null,
      }, companyId);
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create item type.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...formStyles.backdrop, zIndex: 1100 }}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.sm}px`, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            <MdInventory2 style={{ verticalAlign: "-3px", marginRight: 4 }} size={16} />
            New Item Type
            {scenarioCode && (
              <span style={styles.scenarioPillSmall}>{scenarioCode}</span>
            )}
          </h5>
          <button type="button" style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={submit}>
          <div style={formStyles.body}>
            {error && <div style={styles.errorAlert}>{error}</div>}
            <p style={{ margin: "0 0 0.6rem", fontSize: "0.78rem", color: colors.textSecondary }}>
              Adds a new entry to your product catalog.
              {scenarioCode
                ? ` Sale Type is locked to ${scenarioCode}'s rule; UOM auto-fills from FBR's HS-UOM mapping.`
                : " Pick an HS code to auto-fill UOM."}
              {" "}You can fine-tune later from <b>Configuration → Item Types</b>.
            </p>

            <div style={formStyles.formGroup}>
              <label style={styles.label}>Name *</label>
              <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>

            {/* HS code typeahead — focus opens the suggestion list,
                debounced search hits /api/fbr/hscodes. Click a suggestion
                to populate hsCode + auto-fill UOM via /api/itemtypes/fbr-hints. */}
            <div style={{ ...formStyles.formGroup, position: "relative" }}>
              <label style={styles.label}>
                HS Code
                {hintLoading && <span style={styles.lockedTag}>looking up UOM…</span>}
              </label>
              <input
                style={{ ...styles.input, fontFamily: "monospace" }}
                value={hsQuery}
                onChange={(e) => { setHsQuery(e.target.value); setHsOpen(true); setHsCode(e.target.value); }}
                onFocus={() => setHsOpen(true)}
                onBlur={() => setTimeout(() => setHsOpen(false), 180)} // small delay so click on suggestion lands
                placeholder="Type to search FBR catalog (e.g. 'mobile' or '8517')"
                autoComplete="off"
              />
              {hsOpen && (hsLoading || hsSuggestions.length > 0) && (
                <div style={styles.hsDropdown}>
                  {hsLoading && (
                    <div style={styles.hsLoading}>Searching FBR catalog…</div>
                  )}
                  {!hsLoading && hsSuggestions.length === 0 && (
                    <div style={styles.hsLoading}>No matches.</div>
                  )}
                  {!hsLoading && hsSuggestions.map((row) => (
                    <button
                      type="button"
                      key={row.hS_CODE}
                      style={styles.hsOption}
                      onMouseDown={(e) => e.preventDefault()} // keep input focused
                      onClick={() => pickHsCode(row.hS_CODE)}
                    >
                      <span style={styles.hsOptionCode}>{row.hS_CODE}</span>
                      <span style={styles.hsOptionDesc}>{row.description}</span>
                    </button>
                  ))}
                </div>
              )}
              {fbrHint?.notes?.length > 0 && (
                <span style={{ fontSize: "0.72rem", color: colors.textSecondary, marginTop: "0.2rem", display: "block" }}>
                  {fbrHint.notes[0]}
                </span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={styles.label}>
                  UOM
                  {fbrUOMId && <span style={styles.lockedTag}>FBR-mapped</span>}
                </label>
                <input
                  style={styles.input}
                  value={uom}
                  onChange={(e) => { setUom(e.target.value); setFbrUOMId(null); }}
                  placeholder="auto-fills from HS code"
                />
              </div>
              <div style={formStyles.formGroup}>
                <label style={styles.label}>
                  Sale Type
                  {lockedSaleType && <span style={styles.lockedTag}><MdLock size={10} /> {scenarioCode}</span>}
                </label>
                {lockedSaleType ? (
                  <input
                    style={{ ...styles.input, backgroundColor: "#eef5ff", cursor: "not-allowed" }}
                    value={saleType}
                    readOnly
                    title={`Locked to ${scenarioCode}'s sale type. Cancel to use a different scenario.`}
                  />
                ) : (
                  <select style={styles.input} value={saleType} onChange={(e) => setSaleType(e.target.value)}>
                    <option>Goods at standard rate (default)</option>
                    <option>Goods at Reduced Rate</option>
                    <option>Goods at zero-rate</option>
                    <option>Exempt goods</option>
                    <option>3rd Schedule Goods</option>
                    <option>Services</option>
                    <option>Services (FED in ST Mode)</option>
                    <option>Goods (FED in ST Mode)</option>
                  </select>
                )}
              </div>
            </div>

            {saleTypeMismatch && (
              <div style={styles.warnAlert}>
                <MdInfo size={14} /> Heads-up: FBR usually treats this HS code as
                <b style={{ margin: "0 0.25rem" }}>{fbrHint.defaultSaleType}</b>,
                but you're saving it as <b>{saleType}</b> to match {scenarioCode}.
                That's fine — the bill will validate as long as your scenario allows this HS code.
              </div>
            )}
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }} disabled={saving}>
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// "Permission required" hint — shown inline when a user is forbidden
// from inline-creating a buyer or item type. Surfaces the permission
// key by name so an admin can find it on Roles & Permissions.
// ────────────────────────────────────────────────────────────────────
function PermissionLackedHint({ perm, what, inline = false }) {
  return (
    <span
      style={inline ? styles.permHintInline : styles.permHintBlock}
      title={`Ask your admin to enable the '${perm}' permission on your role.`}
    >
      <MdLock size={inline ? 12 : 14} /> Can't {what}? You need the{" "}
      <code style={styles.permCode}>{perm}</code> permission. Ask an admin to enable it via
      <b> Administration → Roles &amp; Permissions</b>.
    </span>
  );
}

const styles = {
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  inlineRow: { display: "flex", gap: "0.5rem", alignItems: "stretch", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  select: { width: "100%", padding: "0.6rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", cursor: "pointer" },
  errorAlert: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, border: `1px solid ${colors.danger}30`, fontSize: "0.85rem" },
  warnAlert: { display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.65rem 0.85rem", borderRadius: 8, backgroundColor: colors.warnLight, border: `1px solid ${colors.warn}30`, color: colors.warn, fontSize: "0.85rem" },
  totalsBox: { display: "flex", flexDirection: "column", gap: "0.35rem", alignItems: "flex-end", padding: "1rem", backgroundColor: "#f8f9fb", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, marginTop: "0.5rem" },
  totalRow: { display: "flex", gap: "2rem", justifyContent: "flex-end", fontSize: "0.9rem", minWidth: 280 },
  fbrToggleHint: { margin: "0.3rem 0 0", fontSize: "0.75rem", color: colors.textSecondary },
  optionalTag: { marginLeft: "0.3rem", padding: "0.05rem 0.35rem", borderRadius: 4, backgroundColor: "#fff3e0", color: "#e65100", fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase" },
  lockedTag: { marginLeft: "0.3rem", padding: "0.05rem 0.35rem", borderRadius: 4, backgroundColor: "#e0f2f1", color: "#00695c", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 2 },
  itemsHeaderBar: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" },
  addRowBtn: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.35rem 0.75rem", borderRadius: 6, border: "none", backgroundColor: colors.blue, color: "#fff", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  inlineAddBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.45rem 0.75rem", borderRadius: 6, border: `1px solid ${colors.blue}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  tinyAddBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.25rem", borderRadius: 6, border: `1px solid ${colors.blue}`, backgroundColor: "#fff", color: colors.blue, cursor: "pointer", flexShrink: 0 },
  removeRowBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.3rem", borderRadius: 6, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fff", color: colors.danger, cursor: "pointer" },
  unifiedTableWrap: { width: "100%", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 8 },
  unifiedTable: { width: "100%", borderCollapse: "collapse", minWidth: 1200 },
  unifiedThead: { backgroundColor: "#eff3f8" },
  unifiedTh: { padding: "0.5rem 0.45rem", textAlign: "left", fontSize: "0.7rem", fontWeight: 800, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${colors.cardBorder}` },
  unifiedRow: { backgroundColor: "#fff" },
  unifiedTd: { padding: "0.3rem 0.4rem", fontSize: "0.8rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "middle" },

  stepLabel: { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary, marginBottom: "0.4rem" },
  stepNum: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", backgroundColor: colors.blue, color: "#fff", fontSize: "0.78rem", fontWeight: 800 },
  stepHint: { margin: "0 0 0.6rem 30px", fontSize: "0.78rem", color: colors.textSecondary, lineHeight: 1.4 },

  scenarioGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.6rem", marginTop: "0.25rem" },
  scenarioCard: { textAlign: "left", padding: "0.7rem 0.85rem", borderRadius: 10, border: "2px solid", cursor: "pointer", display: "flex", flexDirection: "column", gap: "0.3rem", transition: "all 0.15s", backgroundColor: "#fff", fontFamily: "inherit" },
  scenarioCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  scenarioCode: { fontWeight: 800, fontSize: "0.95rem", color: colors.blue, fontFamily: "monospace" },
  scenarioSaleType: { fontSize: "0.82rem", color: colors.textPrimary, fontWeight: 600, lineHeight: 1.25 },
  scenarioRate: { fontSize: "0.74rem", color: colors.textSecondary },
  scenarioBadges: { display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.15rem" },
  scenarioBadge: { fontSize: "0.65rem", padding: "0.1rem 0.4rem", borderRadius: 4, fontWeight: 700, letterSpacing: "0.02em" },
  badgeBlue:   { backgroundColor: "#e3f2fd", color: "#0d47a1" },
  badgeOrange: { backgroundColor: "#fff3e0", color: "#e65100" },
  badgePurple: { backgroundColor: "#f3e5f5", color: "#6a1b9a" },
  badgeYellow: { backgroundColor: "#fff8e1", color: "#a16e00" },
  badgePink:   { backgroundColor: "#fce4ec", color: "#ad1457" },
  scenarioHint: { display: "flex", alignItems: "flex-start", gap: "0.4rem", marginTop: "0.6rem", padding: "0.5rem 0.75rem", borderRadius: 8, backgroundColor: "#e3f2fd", border: "1px solid #90caf9", color: "#0d47a1", fontSize: "0.82rem", lineHeight: 1.4 },

  lockedSaleType: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.85rem", marginBottom: "0.6rem", borderRadius: 8, backgroundColor: "#e0f2f1", border: "1px solid #80cbc4", color: "#00695c", fontSize: "0.82rem" },
  lockedSaleTypeHint: { color: "#00695c", opacity: 0.8, fontSize: "0.75rem" },

  permHintBlock: { display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.45rem 0.75rem", borderRadius: 6, backgroundColor: "#fff8e1", border: `1px solid ${colors.warn}30`, color: colors.warn, fontSize: "0.78rem", lineHeight: 1.35, flexWrap: "wrap" },
  permHintInline: { display: "inline-flex", alignItems: "center", gap: "0.25rem", color: colors.warn, fontSize: "0.72rem", flexWrap: "wrap" },
  permCode: { fontFamily: "monospace", padding: "0 0.25rem", borderRadius: 3, backgroundColor: "#f5f5f5", fontWeight: 700, fontSize: "0.74rem" },

  // ── HS code typeahead inside QuickItemTypeForm ────────────────────
  scenarioPillSmall: { marginLeft: "0.5rem", padding: "0.1rem 0.4rem", borderRadius: 4, backgroundColor: "#e3f2fd", color: "#0d47a1", fontSize: "0.7rem", fontWeight: 800, fontFamily: "monospace" },
  hsDropdown: { position: "absolute", top: "100%", left: 0, right: 0, marginTop: "0.2rem", maxHeight: 260, overflowY: "auto", backgroundColor: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.08)", zIndex: 1200 },
  hsLoading: { padding: "0.6rem 0.85rem", fontSize: "0.82rem", color: colors.textSecondary },
  hsOption: { display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "0.5rem 0.75rem", border: "none", borderBottom: `1px solid ${colors.cardBorder}`, backgroundColor: "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit" },
  hsOptionCode: { fontWeight: 700, color: colors.blue, fontFamily: "monospace", fontSize: "0.85rem" },
  hsOptionDesc: { fontSize: "0.74rem", color: colors.textSecondary, marginTop: 2, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" },

  // Bulk-apply Item Type toolbar — surfaces above the items table when 2+ rows exist
  bulkApplyBar: { display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap", padding: "0.55rem 0.85rem", marginBottom: "0.5rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#f8faff" },
};
