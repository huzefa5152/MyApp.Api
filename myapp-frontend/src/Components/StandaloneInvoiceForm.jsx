import { useState, useEffect, useMemo } from "react";
import { MdAdd, MdDelete, MdCheck, MdInfo } from "react-icons/md";
import { createStandaloneInvoice } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { getFbrApplicableScenarios } from "../api/fbrApi";
import { saveItemFbrDefaults } from "../api/lookupApi";
import { formStyles, modalSizes } from "../theme";
import SmartItemAutocomplete from "./SmartItemAutocomplete";

// NOTE: this form deliberately does NOT include the FBR Item Type
// catalog picker. SmartItemAutocomplete already searches both saved
// item descriptions AND the FBR catalog, and auto-fills HS code +
// UOM + Sale Type on pick — having a second column for the same
// thing was redundant. Sale Type is locked to the chosen scenario,
// so an item's catalog saleType is overridden anyway.

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

// ────────────────────────────────────────────────────────────────────
// Scenario shape contract
// ────────────────────────────────────────────────────────────────────
//
// Per FBR DI-API v1.12 §9 (Scenarios for Sandbox Testing) + §10
// (Applicable Scenarios based on Business Activity), each scenario has:
//   • a locked Sale Type that every line on the bill must use
//   • a buyer constraint (Registered, Unregistered, or End-Consumer Walk-in)
//   • a default GST rate (auto-fill on pick)
//   • optional extra fields the line must carry to validate:
//       - MRP    (fixedNotifiedValueOrRetailPrice) — for SN008 / SN027
//       - SRO    (sroScheduleNo + sroItemSerialNo) — for SN028
//       - 4 % further tax tip — for SN002 (advisory; the FBR service
//         emits the further-tax line itself at submit time)
//
// `scenarioMeta` annotates whatever the backend returns so the form's
// conditional rendering doesn't have to care about scenario codes
// directly.
const SCENARIO_META = {
  SN001: { kind: "b2b-registered",   needsMRP: false, needsSRO: false, hint: "Wholesale B2B to a registered buyer (NTN required, validated by FBR)." },
  SN002: { kind: "b2b-unregistered", needsMRP: false, needsSRO: false, hint: "B2B to an unregistered buyer. 4% further tax common at submit time." },
  SN008: { kind: "either",           needsMRP: true,  needsSRO: false, hint: "3rd Schedule goods — tax backed out of MRP. Enter the printed retail price × qty." },
  SN026: { kind: "walk-in",          needsMRP: false, needsSRO: false, hint: "Retail counter sale to an end consumer at standard rate." },
  SN027: { kind: "walk-in",          needsMRP: true,  needsSRO: false, hint: "Retail counter sale of 3rd Schedule goods. MRP × qty required." },
  SN028: { kind: "walk-in",          needsMRP: false, needsSRO: true,  hint: "Retail counter sale at reduced rate. SRO Schedule + Item No required." },
};

// Default sale-type list (for the rare "no scenario" case). When a
// scenario IS picked, its saleType is locked and this list isn't shown.
const SALE_TYPES = [
  "Goods at standard rate (default)",
  "Goods at Reduced Rate",
  "Goods at zero-rate",
  "Exempt goods",
  "3rd Schedule Goods",
  "Services",
  "Services (FED in ST Mode)",
  "Goods (FED in ST Mode)",
];

const blankRow = () => ({
  localId: Math.random().toString(36).slice(2, 10),
  description: "",
  quantity: "",
  uom: "",
  unitPrice: "",
  hsCode: "",
  saleType: "",
  fbrUOMId: null,
  // Extra fields surfaced only for scenarios that need them
  fixedNotifiedValueOrRetailPrice: "",
  sroScheduleNo: "",
  sroItemSerialNo: "",
});

export default function StandaloneInvoiceForm({ companyId, company, onClose, onSaved }) {
  const [clients, setClients] = useState([]);
  const [scenarios, setScenarios] = useState([]);

  const [selectedClientId, setSelectedClientId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [gstRate, setGstRate] = useState(18);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [documentType, setDocumentType] = useState(4);
  const [paymentMode, setPaymentMode] = useState("");
  const [scenarioCode, setScenarioCode] = useState("");
  const [rows, setRows] = useState([blankRow()]);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [clientRes, scenarioRes] = await Promise.all([
          getClientsByCompany(companyId),
          getFbrApplicableScenarios(companyId).catch(() => ({ data: { scenarios: [] } })),
        ]);
        setClients(clientRes.data || []);
        setScenarios(scenarioRes.data?.scenarios || []);
      } catch {
        setError("Failed to load data.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [companyId]);

  // Decorate the backend's scenario list with the local meta we need to
  // drive conditional rendering. Falls back to a generic "either" record
  // if the backend ever sends a code we don't know about, so the form
  // never crashes — it just renders the scenario without conditional UI.
  const enrichedScenarios = useMemo(
    () => scenarios.map((s) => ({
      ...s,
      meta: SCENARIO_META[s.code] || { kind: "either", needsMRP: false, needsSRO: false, hint: s.description || "" },
    })),
    [scenarios],
  );

  const chosenScenario = useMemo(
    () => enrichedScenarios.find((s) => s.code === scenarioCode) || null,
    [enrichedScenarios, scenarioCode],
  );

  // GST rate auto-syncs to scenario's canonical rate when picked.
  useEffect(() => {
    if (chosenScenario && chosenScenario.defaultRate != null) {
      setGstRate(chosenScenario.defaultRate);
    }
  }, [chosenScenario]);

  // Buyer pool depends on scenario kind:
  //   • b2b-registered   → Registered clients only
  //   • b2b-unregistered → all clients
  //   • either           → all clients
  //   • walk-in          → only Unregistered clients (operator picks the
  //                        company's standing walk-in row, or whichever
  //                        Unregistered client they want to bill)
  const filteredClients = useMemo(() => {
    if (!chosenScenario) return clients;
    const k = chosenScenario.meta.kind;
    if (k === "b2b-registered")
      return clients.filter((c) => (c.registrationType || "").toLowerCase() === "registered");
    if (k === "walk-in")
      return clients.filter((c) => (c.registrationType || "").toLowerCase() === "unregistered");
    return clients;
  }, [clients, chosenScenario]);

  // Auto-pick a sensible default buyer when the scenario changes:
  //   • walk-in → snap to the first Unregistered client (operator can
  //               override). Avoids the "Select a client first" blocker
  //               for the most common counter-sale path.
  //   • b2b-registered with current selection invalid → clear it.
  useEffect(() => {
    if (!chosenScenario) return;
    const k = chosenScenario.meta.kind;
    if (k === "walk-in") {
      if (filteredClients.length > 0) setSelectedClientId(String(filteredClients[0].id));
      else setSelectedClientId("");
    } else if (k === "b2b-registered") {
      // If the current selection isn't in the registered list, clear.
      if (selectedClientId && !filteredClients.some((c) => String(c.id) === String(selectedClientId)))
        setSelectedClientId("");
    }
    // For "either" / "b2b-unregistered" we leave whatever the operator picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenScenario]);

  // Per-row helpers
  const updateRow = (localId, patch) => {
    setRows((prev) => prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (localId) => {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.localId !== localId)));
  };

  // Effective sale type for a row — locked to scenario when one is picked,
  // otherwise the operator's manual pick. Centralised so the saved payload
  // and the on-screen "Locked: …" label stay in sync.
  const effectiveSaleType = (r) =>
    chosenScenario ? chosenScenario.saleType : (r.saleType || "");

  // Totals — for non-3rd-Schedule rows, line total is qty × unitPrice.
  // For 3rd Schedule rows (MRP-driven), the MRP × qty becomes the gross
  // value and tax is BACKED OUT inside FbrService at submit time. The
  // bill-screen subtotal stays consistent (qty × unitPrice) since the
  // bill stores price separately from MRP.
  const subtotal = rows.reduce((sum, r) => {
    const q = parseFloat(r.quantity) || 0;
    const p = parseFloat(r.unitPrice) || 0;
    return sum + q * p;
  }, 0);
  const gstAmount = Math.round(subtotal * (parseFloat(gstRate) || 0) / 100 * 100) / 100;
  const grandTotal = subtotal + gstAmount;

  // Form validation: row-level checks plus scenario-driven extras.
  const rowErrors = (r) => {
    const errs = [];
    if (!r.description.trim()) errs.push("description");
    const q = parseFloat(r.quantity);
    if (!(q > 0)) errs.push("qty>0");
    const p = parseFloat(r.unitPrice);
    if (!(p > 0)) errs.push("unitPrice>0");
    if (chosenScenario?.meta.needsMRP) {
      const mrp = parseFloat(r.fixedNotifiedValueOrRetailPrice);
      if (!(mrp > 0)) errs.push("MRP>0");
    }
    if (chosenScenario?.meta.needsSRO) {
      if (!r.sroScheduleNo?.trim()) errs.push("sroSchedule");
      if (!r.sroItemSerialNo?.trim()) errs.push("sroItemNo");
    }
    return errs;
  };
  const allRowsValid = rows.length > 0 && rows.every((r) => rowErrors(r).length === 0);

  const handleItemPick = (localId, picked) => {
    updateRow(localId, {
      description: picked.name || "",
      hsCode: picked.hsCode || "",
      uom: picked.uom || "",
      fbrUOMId: picked.fbrUOMId || null,
      saleType: picked.saleType || "",
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!selectedClientId) return setError("Select a buyer first.");
    if (!company || company.startingInvoiceNumber === 0)
      return setError("Starting bill number not set for this company. Configure it on the Companies page first.");
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
        // Backend auto-prepends "[SNxxx]" when scenarioId is set, so the
        // operator's typed payment terms come through clean.
        paymentTerms: paymentTerms || null,
        scenarioId: scenarioCode || null,
        documentType: documentType || null,
        paymentMode: paymentMode || null,
        items: rows.map((r) => ({
          description: r.description.trim(),
          quantity: parseFloat(r.quantity),
          uom: r.uom?.trim() || null,
          unitPrice: parseFloat(r.unitPrice),
          hsCode: r.hsCode?.trim() || null,
          // Sale type comes from the scenario when one's picked — the
          // operator can't override it on a locked-scenario bill.
          saleType: effectiveSaleType(r) || null,
          fbrUOMId: r.fbrUOMId || null,
          fixedNotifiedValueOrRetailPrice:
            chosenScenario?.meta.needsMRP && r.fixedNotifiedValueOrRetailPrice
              ? parseFloat(r.fixedNotifiedValueOrRetailPrice)
              : null,
          sroScheduleNo: chosenScenario?.meta.needsSRO ? r.sroScheduleNo?.trim() || null : null,
          sroItemSerialNo: chosenScenario?.meta.needsSRO ? r.sroItemSerialNo?.trim() || null : null,
        })),
      });

      // Best-effort save of FBR defaults per item description.
      const rememberPromises = rows
        .filter((r) => r.hsCode || r.uom || r.fbrUOMId || effectiveSaleType(r))
        .map((r) => {
          const name = r.description.trim();
          if (!name) return Promise.resolve();
          return saveItemFbrDefaults({
            name,
            hsCode: r.hsCode?.trim() || null,
            saleType: effectiveSaleType(r) || null,
            uom: r.uom?.trim() || null,
            fbrUOMId: r.fbrUOMId || null,
          }).catch(() => {});
        });
      await Promise.all(rememberPromises);

      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create bill.");
    } finally {
      setSaving(false);
    }
  };

  // Layout knobs — table column widths shift based on which scenario-
  // specific columns are visible. Computed inside the render closure.
  const showMRP = !!chosenScenario?.meta.needsMRP;
  const showSRO = !!chosenScenario?.meta.needsSRO;
  const buyerKind = chosenScenario?.meta.kind || null;

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
                {/* ──────────────── Step 1 — Pick FBR scenario ──────────────── */}
                <div style={{ marginBottom: "1rem" }}>
                  <label style={styles.stepLabel}>
                    <span style={styles.stepNum}>1</span> Pick FBR Scenario
                  </label>
                  <p style={styles.stepHint}>
                    Each scenario locks the Sale Type and tells FBR how to validate this bill.
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
                              {s.meta.kind === "b2b-registered" && <span style={{ ...styles.scenarioBadge, ...styles.badgeBlue }}>Registered buyer</span>}
                              {s.meta.kind === "b2b-unregistered" && <span style={{ ...styles.scenarioBadge, ...styles.badgeOrange }}>Unregistered OK</span>}
                              {s.meta.kind === "walk-in" && <span style={{ ...styles.scenarioBadge, ...styles.badgePurple }}>Walk-in retail</span>}
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

                {/* ──────────────── Step 2 — Buyer ──────────────── */}
                {chosenScenario && (
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={styles.stepLabel}>
                      <span style={styles.stepNum}>2</span>
                      {buyerKind === "walk-in" ? "Walk-in Buyer" : "Buyer"}
                    </label>
                    {filteredClients.length === 0 ? (
                      <div style={styles.warnAlert}>
                        <MdInfo size={16} /> No matching {buyerKind === "b2b-registered" ? "Registered" : buyerKind === "walk-in" ? "Unregistered (Walk-in)" : ""} clients.
                        Add one on the Clients page first.
                      </div>
                    ) : (
                      <select
                        style={styles.select}
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
                    {company && company.startingInvoiceNumber > 0 && (
                      <span style={{ fontSize: "0.78rem", color: colors.textSecondary, marginTop: "0.3rem", display: "block" }}>
                        Next bill #: {company.currentInvoiceNumber > 0 ? company.currentInvoiceNumber + 1 : company.startingInvoiceNumber}
                      </span>
                    )}
                  </div>
                )}

                {/* ──────────────── Step 3 — Header + items ──────────────── */}
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
                          GST Rate (%) <span style={styles.lockedTag} title="Auto-set from scenario">scenario default</span>
                        </label>
                        <input type="number" style={styles.input} value={gstRate} onChange={(e) => setGstRate(e.target.value)} min={0} max={100} step={0.5} />
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={styles.label}>Payment Terms</label>
                        <input type="text" style={styles.input} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Optional" />
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={styles.label}>
                          Document Type <span style={styles.optionalTag}>FBR</span>
                        </label>
                        <select
                          style={styles.input}
                          value={documentType}
                          onChange={(e) => setDocumentType(parseInt(e.target.value))}
                        >
                          <option value={4}>Sale Invoice</option>
                          <option value={9}>Debit Note</option>
                          <option value={10}>Credit Note</option>
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={styles.label}>
                          Payment Mode <span style={styles.optionalTag}>FBR</span>
                        </label>
                        <select
                          style={styles.input}
                          value={paymentMode}
                          onChange={(e) => setPaymentMode(e.target.value)}
                        >
                          <option value="">— optional —</option>
                          <option>Cash</option>
                          <option>Credit</option>
                          <option>Bank Transfer</option>
                          <option>Cheque</option>
                          <option>Online</option>
                        </select>
                      </div>
                    </div>

                    {/* Locked Sale Type banner */}
                    <div style={styles.lockedSaleType}>
                      <MdCheck size={14} color={colors.teal} />
                      <span><b>Sale Type locked:</b> {chosenScenario.saleType}</span>
                      <span style={styles.lockedSaleTypeHint}>(every line below uses this — required by {chosenScenario.code})</span>
                    </div>

                    {/* Items table */}
                    <div>
                      <div style={styles.itemsHeaderBar}>
                        <label style={{ ...styles.label, margin: 0 }}>
                          Items ({rows.length})
                        </label>
                        <button type="button" style={styles.addRowBtn} onClick={addRow}>
                          <MdAdd size={14} /> Add Row
                        </button>
                      </div>

                      <div style={styles.unifiedTableWrap}>
                        <table style={styles.unifiedTable}>
                          <thead>
                            <tr style={styles.unifiedThead}>
                              <th style={{ ...styles.unifiedTh, width: showMRP || showSRO ? "26%" : "32%" }}>Description *</th>
                              <th style={{ ...styles.unifiedTh, width: "7%" }}>Qty *</th>
                              <th style={{ ...styles.unifiedTh, width: "8%" }}>UOM</th>
                              <th style={{ ...styles.unifiedTh, width: "9%" }}>Unit Price *</th>
                              <th style={{ ...styles.unifiedTh, width: "10%" }}>Line Total</th>
                              <th style={{ ...styles.unifiedTh, width: "12%" }}>HS Code</th>
                              {showMRP && <th style={{ ...styles.unifiedTh, width: "11%", backgroundColor: "#fff8e1" }}>MRP × Qty *</th>}
                              {showSRO && <th style={{ ...styles.unifiedTh, width: "11%", backgroundColor: "#fce4ec" }}>SRO Schedule *</th>}
                              {showSRO && <th style={{ ...styles.unifiedTh, width: "9%", backgroundColor: "#fce4ec" }}>SRO Item No *</th>}
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
                                    <SmartItemAutocomplete
                                      companyId={companyId}
                                      value={r.description}
                                      onChange={(v) => updateRow(r.localId, { description: v })}
                                      onPick={(picked) => handleItemPick(r.localId, picked)}
                                      style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                      placeholder="Search items / FBR catalog — auto-fills HS Code & UOM"
                                    />
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
                                      style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                      value={r.uom}
                                      onChange={(e) => updateRow(r.localId, { uom: e.target.value })}
                                      placeholder="Pcs"
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
                                      style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.78rem", fontFamily: "monospace" }}
                                      value={r.hsCode}
                                      onChange={(e) => updateRow(r.localId, { hsCode: e.target.value })}
                                      placeholder="auto"
                                    />
                                  </td>
                                  {showMRP && (
                                    <td style={{ ...styles.unifiedTd, backgroundColor: "#fffdf5" }}>
                                      <input
                                        type="number" min={0} step={0.01}
                                        style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                        value={r.fixedNotifiedValueOrRetailPrice}
                                        onChange={(e) => updateRow(r.localId, { fixedNotifiedValueOrRetailPrice: e.target.value })}
                                        placeholder="MRP × qty"
                                        title="Printed retail price × quantity. FBR backs the sales tax out of this number."
                                      />
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
                        <b>*</b> required
                        {showMRP && " · MRP × Qty drives 3rd Schedule tax (backed out of MRP)"}
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
    </div>
  );
}

const styles = {
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  select: { width: "100%", padding: "0.6rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", cursor: "pointer" },
  errorAlert: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, border: `1px solid ${colors.danger}30`, fontSize: "0.85rem" },
  warnAlert: { display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.65rem 0.85rem", borderRadius: 8, backgroundColor: colors.warnLight, border: `1px solid ${colors.warn}30`, color: colors.warn, fontSize: "0.85rem" },
  totalsBox: { display: "flex", flexDirection: "column", gap: "0.35rem", alignItems: "flex-end", padding: "1rem", backgroundColor: "#f8f9fb", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, marginTop: "0.5rem" },
  totalRow: { display: "flex", gap: "2rem", justifyContent: "flex-end", fontSize: "0.9rem", minWidth: 280 },
  fbrToggleHint: { margin: "0.3rem 0 0", fontSize: "0.75rem", color: colors.textSecondary },
  optionalTag: { marginLeft: "0.3rem", padding: "0.05rem 0.35rem", borderRadius: 4, backgroundColor: "#fff3e0", color: "#e65100", fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase" },
  lockedTag: { marginLeft: "0.3rem", padding: "0.05rem 0.35rem", borderRadius: 4, backgroundColor: "#e0f2f1", color: "#00695c", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase" },
  itemsHeaderBar: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" },
  addRowBtn: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.35rem 0.75rem", borderRadius: 6, border: "none", backgroundColor: colors.blue, color: "#fff", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  removeRowBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.3rem", borderRadius: 6, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fff", color: colors.danger, cursor: "pointer" },
  unifiedTableWrap: { width: "100%", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 8 },
  unifiedTable: { width: "100%", borderCollapse: "collapse", minWidth: 1100 },
  unifiedThead: { backgroundColor: "#eff3f8" },
  unifiedTh: { padding: "0.5rem 0.45rem", textAlign: "left", fontSize: "0.7rem", fontWeight: 800, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${colors.cardBorder}` },
  unifiedRow: { backgroundColor: "#fff" },
  unifiedTd: { padding: "0.3rem 0.4rem", fontSize: "0.8rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "middle" },

  // ── Step labels (numbered) ────────────────────────────────────────
  stepLabel: { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary, marginBottom: "0.4rem" },
  stepNum: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", backgroundColor: colors.blue, color: "#fff", fontSize: "0.78rem", fontWeight: 800 },
  stepHint: { margin: "0 0 0.6rem 30px", fontSize: "0.78rem", color: colors.textSecondary, lineHeight: 1.4 },

  // ── Scenario picker cards ─────────────────────────────────────────
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

  // Locked-sale-type banner
  lockedSaleType: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.85rem", marginBottom: "0.6rem", borderRadius: 8, backgroundColor: "#e0f2f1", border: "1px solid #80cbc4", color: "#00695c", fontSize: "0.82rem" },
  lockedSaleTypeHint: { color: "#00695c", opacity: 0.8, fontSize: "0.75rem" },
};
