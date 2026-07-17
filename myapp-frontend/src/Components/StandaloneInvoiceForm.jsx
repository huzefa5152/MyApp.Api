import { useState, useEffect, useMemo, useRef } from "react";
import { MdAdd, MdDelete, MdCheck, MdInfo, MdLock, MdPersonAdd, MdExpandMore, MdExpandLess } from "react-icons/md";
import { createStandaloneInvoice } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { getFbrApplicableScenarios } from "../api/fbrApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getNonInventoryItemsByCompany } from "../api/nonInventoryItemApi";
import { getAccountsFlat } from "../api/accountApi";
import { getSalesOrdersForPicker, getSalesOrderInvoicePrefill } from "../api/salesOrderApi";
import { formStyles, modalSizes } from "../theme";
import { todayYmd } from "../utils/dateInput";
import { defaultAccountPlaceholder } from "../utils/accountDisplay";
import { usePermissions } from "../contexts/PermissionsContext";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import BulkItemTypeBar from "./BulkItemTypeBar";
import AccountSelect from "./AccountSelect";
import LookupAutocomplete from "./LookupAutocomplete";
import ClientForm from "./ClientForm";
import DivisionSelect from "./DivisionSelect";
import SearchableSelect from "./SearchableSelect";
import ItemTypeForm from "./ItemTypeForm";
import PermissionLackedHint from "./PermissionLackedHint";
import AttachmentManager from "./AttachmentManager";

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
  // Non-Inventory Item id (GL-account shortcut line: Freight / Discount / …).
  // Mutually exclusive with itemTypeId — a line carries at most one.
  nonInventoryItemId: "",
  // Per-line GL income account (auto-filled from the picked item type's
  // per-company overlay, overridable). null → posting engine derives.
  accountId: null,
  // Free-text description used in Bills mode; picking an (optional)
  // Item Type seeds it when blank. In Invoices mode this stays empty
  // and the description derives from itemTypeName instead.
  description: "",
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

export default function StandaloneInvoiceForm({ companyId, company, onClose, onSaved, billsMode = false, defaultDivisionId }) {
  // billsMode: true when this form is mounted from the Bills tab. Hides
  // the FBR-only display columns (HS Code); the scenario UI stays
  // fbrEnabled-gated as usual. Item Type affordances — per-row picker,
  // bulk-apply toolbar, "+ New Item Type" — ARE available and OPTIONAL:
  // a type picked at bill time is sent as itemTypeId (the backend
  // re-derives HS/UOM/SaleType from the catalog) so the bill lands
  // classified and the pick shows later on the Invoices tab.
  // Description becomes a LookupAutocomplete (challan-style) bound to
  // /lookup/items, so operators can pick from previously-entered values
  // or type free-text; picking an Item Type seeds it when blank.
  const { has } = usePermissions();
  const canCreateClient   = has("clients.manage.create");
  const canCreateItemType = has("itemtypes.manage.create");
  // FBR integration toggle (company-level). When off, this is a plain
  // non-FBR bill: no scenario step, editable GST, no scenario saved.
  const fbrEnabled = company?.fbrEnabled !== false;

  const [clients, setClients] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [nonInvItems, setNonInvItems] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  // GL accounts for the per-line Account column — empty (column hidden) when GL
  // isn't set up / the caller lacks accounting.coa.view.
  const [accounts, setAccounts] = useState([]);
  const glOn = accounts.length > 0;

  const [selectedClientId, setSelectedClientId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayYmd());
  const canViewDivisions = has("divisions.manage.view");
  // New bills default to the division currently being filtered on the page
  // (so "filter to a division → New Bill" lands in that division).
  const [divisionId, setDivisionId] = useState(defaultDivisionId ? String(defaultDivisionId) : "");
  const [gstRate, setGstRate] = useState(18);
  const [paymentTerms, setPaymentTerms] = useState("");
  // Document Type is locked to Sale Invoice (4) on the no-challan flow.
  // Credit Note (10) and Debit Note (9) get their own dedicated screens
  // — see InvoiceForm.jsx for the same rationale.
  const documentType = 4;
  const [paymentMode, setPaymentMode] = useState("");
  const [scenarioCode, setScenarioCode] = useState("");
  // Step 1 (FBR scenario) is collapsed by default — most bills use the
  // auto-defaulted SN001 and the operator never needs to switch. Steps 2
  // and 3 stay expanded by default since they hold required input. All
  // three use the same collapse-with-summary pattern below.
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false);
  const [buyerOpen, setBuyerOpen] = useState(true);
  const [billHeaderOpen, setBillHeaderOpen] = useState(true);
  const [rows, setRows] = useState([blankRow()]);

  // Bulk-apply mode for the "set Item Type on every row" toolbar — saves
  // the operator from picking the same catalog row N times when every
  // line on the bill is the same FBR category. Mirrors the InvoiceForm
  // (with-challan) bulk apply.
  const [bulkApplyMode, setBulkApplyMode] = useState("all");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const attachmentRef = useRef(null);

  // ── Sales-Order prefill (FBR-off companies only) ──────────────────
  // The operator can seed the bill from an Open Sales Order: client,
  // division, GST rate and lines (with server-resolved unit prices —
  // quote price → last billed rate → 0) all populate in one pick.
  const [salesOrders, setSalesOrders] = useState([]);
  const [salesOrderId, setSalesOrderId] = useState("");
  const [soLoadedMsg, setSoLoadedMsg] = useState("");
  // Customer PO — prefilled from a selected Sales Order, or typed manually.
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");

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
    const { data } = await getItemTypes(companyId);
    setItemTypes(data || []);
    return data || [];
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [, , scenarioRes] = await Promise.all([
          refreshClients(),
          refreshItemTypes(),
          fbrEnabled
            ? getFbrApplicableScenarios(companyId).catch(() => ({ data: { scenarios: [] } }))
            : Promise.resolve({ data: { scenarios: [] } }),
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

  // Load sales orders once for the prefill picker — offered in both FBR modes
  // (FBR-on operators wanted the same shortcut; the scenario still drives
  // GST/classification). NO status filter: a fully-delivered order auto-flips
  // to "Closed", so filtering by status:"Open" would hide exactly the
  // partially/fully delivered orders the operator most wants to bill. Keep
  // every order; only Cancelled ones are dropped below. Page-walking helper:
  // the server clamps pageSize at 100.
  useEffect(() => {
    getSalesOrdersForPicker(companyId)
      .then((items) => setSalesOrders(items))
      .catch(() => setSalesOrders([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // Per-company Non-Inventory Items (GL-account shortcut lines: Freight,
  // Discount, …). A company with GL off / no items resolves to [] silently.
  useEffect(() => {
    if (!companyId) { setNonInvItems([]); return; }
    getNonInventoryItemsByCompany(companyId, true).then(({ data }) => setNonInvItems(data || [])).catch(() => setNonInvItems([]));
  }, [companyId]);

  // GL accounts (income side highlighted) for the per-line Account picker.
  useEffect(() => {
    if (!companyId) { setAccounts([]); return; }
    getAccountsFlat(companyId)
      .then(({ data }) => setAccounts((data || []).filter((a) => a.isActive)))
      .catch(() => setAccounts([]));
  }, [companyId]);

  // Picker options — narrowed to the form's selected division when one is
  // set; otherwise every order shows. Cancelled orders are excluded; the label
  // carries the delivery status so partially / fully delivered orders are easy
  // to spot.
  const salesOrderOptions = useMemo(() => {
    const list = divisionId
      ? salesOrders.filter((o) => o.divisionId === parseInt(divisionId))
      : salesOrders;
    return list
      .filter((o) => o.status !== "Cancelled")
      .map((o) => ({
        ...o,
        _label: `SO #${o.salesOrderNumber} — ${o.clientName}${o.fulfillmentStatus ? ` · ${o.fulfillmentStatus}` : ""}${o.divisionName ? ` · ${o.divisionName}` : ""}`,
      }));
  }, [salesOrders, divisionId]);

  // Selecting an order REPLACES the item rows with its lines (picking a
  // different order replaces them again); CLEARING the picker resets the
  // populated details back to a blank form — the operator asked for a
  // clean slate when the order is removed, not a half-populated leftover.
  const handleSalesOrderSelect = async (id) => {
    setSalesOrderId(id ? String(id) : "");
    if (!id) {
      setSoLoadedMsg("");
      setSelectedClientId("");
      setDivisionId(defaultDivisionId ? String(defaultDivisionId) : "");
      setGstRate(18);
      setRows([blankRow()]);
      setPoNumber("");
      setPoDate("");
      setError("");
      return;
    }
    try {
      const { data } = await getSalesOrderInvoicePrefill(id);
      // A backend that predates this endpoint serves the SPA's index.html
      // with a 200 (fallback route) — anything but the real JSON payload
      // must fail loudly instead of silently populating nothing.
      if (!data || typeof data !== "object" || !Array.isArray(data.lines)) {
        throw new Error("unexpected prefill payload");
      }
      if (data.clientId) setSelectedClientId(String(data.clientId));
      setDivisionId(data.divisionId ? String(data.divisionId) : "");
      // GST only prefills when FBR is off — with FBR on the rate is locked
      // to the chosen scenario's canonical rate and must not be overridden.
      if (data.gstRate != null && !fbrEnabled) setGstRate(data.gstRate);
      const mapped = (data.lines || []).map((ln) => {
        // A matching catalog row supplies the FBR fields; the prefill line's
        // own description / qty / price / unit always win over the type's.
        const t = ln.itemTypeId ? itemTypes.find((x) => x.id === ln.itemTypeId) : null;
        return {
          ...blankRow(),
          itemTypeId: ln.itemTypeId || "",
          itemTypeName: t?.name || "",
          description: ln.description || "",
          quantity: ln.quantity != null ? String(ln.quantity) : "",
          unitPrice: ln.unitPrice != null ? String(ln.unitPrice) : "",
          uom: ln.unit || t?.uom || "",
          hsCode: t?.hsCode || "",
          fbrUOMId: t?.fbrUOMId || null,
          saleType: t?.saleType || "",
          accountId: t?.saleAccountId ?? null,
        };
      });
      setRows(mapped.length ? mapped : [blankRow()]);
      // Prefill the customer PO from the order (operator can still edit it).
      setPoNumber(data.customerPoNumber || "");
      setPoDate(data.customerPoDate ? String(data.customerPoDate).slice(0, 10) : "");
      setSoLoadedMsg(`Loaded ${mapped.length} item${mapped.length !== 1 ? "s" : ""} from Sales Order #${data.salesOrderNumber}`);
      setError("");
    } catch {
      setSoLoadedMsg("");
      setError("Failed to load the sales order details.");
    }
  };

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

  // Buyer pool filter. The currently-selected buyer always stays visible
  // even when it doesn't match the scenario's buyer kind (e.g. seeded by
  // the Sales-Order prefill) — hiding it would make the pick look like it
  // silently failed. The scenario-change effect below still clears true
  // mismatches when the operator switches scenario.
  const filteredClients = useMemo(() => {
    const base = (() => {
      if (!chosenScenario) return clients;
      const k = chosenScenario.meta.buyerKind;
      if (k === "b2b-registered")
        return clients.filter((c) => (c.registrationType || "").toLowerCase() === "registered");
      if (k === "b2b-unregistered" || k === "walk-in")
        return clients.filter((c) => (c.registrationType || "").toLowerCase() !== "registered");
      return clients;
    })();
    if (selectedClientId && !base.some((c) => String(c.id) === String(selectedClientId))) {
      const sel = clients.find((c) => String(c.id) === String(selectedClientId));
      if (sel) return [sel, ...base];
    }
    return base;
  }, [clients, chosenScenario, selectedClientId]);

  // Auto-pick a sensible default buyer on scenario change. Mismatch is
  // judged on the client's actual registration type (NOT pool membership —
  // the pool deliberately keeps the selected buyer visible above).
  useEffect(() => {
    if (!chosenScenario) return;
    const k = chosenScenario.meta.buyerKind;
    if (k === "walk-in") {
      const walkIns = clients.filter((c) => (c.registrationType || "").toLowerCase() !== "registered");
      if (walkIns.length > 0) setSelectedClientId(String(walkIns[0].id));
      else setSelectedClientId("");
    } else if (k === "b2b-registered" || k === "b2b-unregistered") {
      const sel = clients.find((c) => String(c.id) === String(selectedClientId));
      const registered = (sel?.registrationType || "").toLowerCase() === "registered";
      const fits = k === "b2b-registered" ? registered : !registered;
      if (selectedClientId && (!sel || !fits)) setSelectedClientId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenScenario]);

  // Auto-default Payment Mode based on the buyer's registration status.
  // Company-level config (FBR Settings) provides the default per bucket;
  // when those are blank we fall back to "Credit" (registered) and
  // "Cash" (unregistered) — same fallback the FBR Settings tooltip
  // documents. Re-runs whenever the operator changes client so the
  // dropdown stays consistent with the buyer. The operator can still
  // override the dropdown afterwards — their selection survives until
  // they pick a different client.
  useEffect(() => {
    if (!selectedClientId) return;
    const client = clients.find((c) => String(c.id) === String(selectedClientId));
    if (!client) return;
    const registered = (client.registrationType || "").toLowerCase() === "registered";
    const fromCompany = registered
      ? company?.fbrDefaultPaymentModeRegistered
      : company?.fbrDefaultPaymentModeUnregistered;
    setPaymentMode(fromCompany || (registered ? "Credit" : "Cash"));
  }, [
    selectedClientId,
    clients,
    company?.fbrDefaultPaymentModeRegistered,
    company?.fbrDefaultPaymentModeUnregistered,
  ]);

  // Per-row helpers
  const updateRow = (localId, patch) =>
    setRows((prev) => prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (localId) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.localId !== localId)));

  const handleItemTypePick = (localId, picked) => {
    if (!picked) {
      // Clearing the item type also drops any non-inv binding (mutually exclusive)
      // and the auto-filled GL account.
      updateRow(localId, {
        itemTypeId: "", itemTypeName: "", hsCode: "", uom: "", fbrUOMId: null, saleType: "", nonInventoryItemId: "", accountId: null,
      });
      return;
    }
    setRows((prev) => prev.map((r) => {
      if (r.localId !== localId) return r;
      return {
        ...r,
        itemTypeId: picked.id,
        itemTypeName: picked.name || "",
        hsCode: picked.hsCode || "",
        uom: picked.uom || "",
        fbrUOMId: picked.fbrUOMId || null,
        saleType: picked.saleType || "",
        // Auto-fill the line's GL income account from the item type's overlay.
        accountId: picked.saleAccountId ?? null,
        // Picking an item type clears any non-inventory selection.
        nonInventoryItemId: "",
        // Bills mode types the description directly — seed it from the
        // picked type's name only when the operator hasn't typed one yet.
        description: billsMode && !r.description?.trim() ? picked.name || "" : r.description,
      };
    }));
  };

  // Non-Inventory pick — mutually exclusive with an item type. Clears the
  // item-type binding + its FBR fields, records the non-inv id, and prefills
  // description / UOM / sale price only when those fields are still empty.
  const handleNonInventoryPick = (localId, n) => {
    if (!n) { updateRow(localId, { nonInventoryItemId: "" }); return; }
    setRows((prev) => prev.map((r) => {
      if (r.localId !== localId) return r;
      const next = {
        ...r,
        nonInventoryItemId: n.id,
        itemTypeId: "", itemTypeName: "", hsCode: "", fbrUOMId: null, saleType: "",
        // Non-inventory posts to its own mapped account — clear any per-line override.
        accountId: null,
      };
      if (!r.description?.trim()) next.description = n.defaultLineDescription || n.name || "";
      if (!r.uom?.trim()) next.uom = n.unitName || "";
      if ((!r.unitPrice || Number(r.unitPrice) === 0) && n.defaultSalePrice != null) next.unitPrice = String(n.defaultSalePrice);
      return next;
    }));
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
        // Auto-fill the line's GL income account from the item type's overlay.
        accountId: picked.saleAccountId ?? null,
        // Stamping an item type clears any non-inventory binding.
        nonInventoryItemId: "",
        // Same Bills-mode seeding rule as the per-row pick.
        description: billsMode && !r.description?.trim() ? picked.name || "" : r.description,
      };
    }));
  };

  // Bulk-apply a NON-INVENTORY item (charge) to all / empty rows — mirrors
  // applyItemTypeToRows so the bulk picker's Non-Inventory section behaves like
  // the per-row one.
  const applyNonInvToRows = (n, mode) => {
    if (!n) return;
    setRows((prev) => prev.map((r) => {
      if (mode === "empty" && (r.itemTypeId || r.nonInventoryItemId)) return r;
      const next = {
        ...r,
        nonInventoryItemId: n.id,
        itemTypeId: "", itemTypeName: "", hsCode: "", fbrUOMId: null, saleType: "",
        accountId: null,
      };
      if (!r.description?.trim()) next.description = n.defaultLineDescription || n.name || "";
      if (!r.uom?.trim()) next.uom = n.unitName || "";
      if ((!r.unitPrice || Number(r.unitPrice) === 0) && n.defaultSalePrice != null) next.unitPrice = String(n.defaultSalePrice);
      return next;
    }));
  };

  // Bulk-clear: drop the Item Type binding (and the inherited HS Code /
  // UOM / Sale Type / FbrUOMId) on every row. Used when the operator
  // wants to start over after a wrong bulk-apply pick. In Invoices mode
  // the Description falls back to "(pick an item type)"; Bills-mode
  // free-text descriptions (typed or seeded) are preserved. Quantity /
  // Unit Price / MRP / SRO refs are preserved — those are line-level
  // inputs, not catalog-derived.
  const clearAllItemTypes = () => {
    setRows((prev) => prev.map((r) => ({
      ...r,
      itemTypeId: "",
      itemTypeName: "",
      hsCode: "",
      uom: "",
      fbrUOMId: null,
      saleType: "",
      accountId: null,
    })));
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

  // Account labels for the per-line Account (GL) column: the resolved company
  // default (named, shown when a line carries no explicit account) + a helper
  // naming a non-inventory line's own mapped sale account.
  const defaultSaleAccountLabel = defaultAccountPlaceholder(accounts, company?.defaultSalesAccountId);
  const nonInvSaleAccountLabel = (nonInvId) => {
    const n = nonInvItems.find((x) => String(x.id) === String(nonInvId));
    return n?.saleAccountName ? `→ ${n.saleAccountName}` : "→ Suspense";
  };

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
    // Every bill line must be classified — an Item Type OR a Non-Inventory
    // item (Freight / Discount / … which legitimately has no item type/HS).
    // Required in BOTH Bills and Invoices modes.
    if (!r.itemTypeId && !r.nonInventoryItemId) errs.push("itemType");
    // Bills mode: the operator types the description directly; in Invoices
    // mode it derives from the picked item type.
    if (billsMode && !r.description?.trim()) errs.push("description");
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
    if (fbrEnabled && !chosenScenario) return setError("Pick an FBR scenario first.");
    // Every line on a bill must be classified — an Item Type OR a Non-Inventory item.
    if (rows.some((r) => !r.itemTypeId && !r.nonInventoryItemId)) {
      return setError("Every line must have an Item Type or Non-Inventory item selected.");
    }
    if (!allRowsValid) {
      const missing = rows.flatMap(rowErrors);
      return setError(`Fill all required fields. Missing: ${[...new Set(missing)].join(", ")}.`);
    }

    setSaving(true);
    try {
      const { data: created } = await createStandaloneInvoice({
        date: new Date(invoiceDate).toISOString(),
        companyId,
        divisionId: divisionId ? parseInt(divisionId) : null,
        clientId: parseInt(selectedClientId),
        gstRate: parseFloat(gstRate),
        paymentTerms: paymentTerms || null,
        scenarioId: scenarioCode || null,
        documentType: documentType || null,
        paymentMode: paymentMode || null,
        salesOrderId: salesOrderId ? parseInt(salesOrderId) : null,
        poNumber: poNumber.trim() || null,
        poDate: poDate ? new Date(poDate).toISOString() : null,
        items: rows.map((r) => ({
          // Optional in Bills mode — when set, the backend re-derives
          // HS / UOM / Sale Type from the catalog for this line.
          itemTypeId: r.itemTypeId ? parseInt(r.itemTypeId) : null,
          // Non-Inventory line (Freight / Discount / …) — mutually exclusive
          // with itemTypeId; the backend sources GL accounts from it.
          nonInventoryItemId: r.nonInventoryItemId ? parseInt(r.nonInventoryItemId) : null,
          // Per-line GL income account (auto-filled from the item type's overlay,
          // overridable). Server validates against the company CoA; null → derived.
          accountId: r.accountId || null,
          // Description in Invoices mode is the item type's name (locked).
          // In Bills mode the operator types it directly into r.description
          // (or an optional Item Type pick seeds it). A non-inv line has no
          // item type name, so fall back to its free-text description. Either
          // way it lands on InvoiceItem.Description.
          description: (billsMode ? r.description : (r.itemTypeName || r.description))?.trim() || "",
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
            chosenScenario?.meta.needsMRP && r.mrp && r.quantity
              ? Math.round(parseFloat(r.mrp) * parseFloat(r.quantity) * 100) / 100
              : null,
          sroScheduleNo: chosenScenario?.meta.needsSRO ? r.sroScheduleNo?.trim() || null : null,
          sroItemSerialNo: chosenScenario?.meta.needsSRO ? r.sroItemSerialNo?.trim() || null : null,
        })),
      });
      // Upload attachments staged before the bill had an id. Best-effort —
      // the bill is already saved.
      try {
        if (created?.id) await attachmentRef.current?.flush(created.id);
      } catch { /* attachments are best-effort */ }
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
    await refreshItemTypes();
    // The "+ New Item Type" button now lives once in the items header bar
    // (not per-row), so we don't auto-stamp the new type onto a specific
    // row. The operator picks it via the per-row dropdown OR the bulk-
    // apply toolbar — explicit and undoable.
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
                {/* ── Sales-Order prefill (both FBR modes) ─────────────
                    Optional shortcut: pick an Open Sales Order and the
                    buyer / division / item rows populate from it (unit
                    prices resolved server-side: quote → last billed
                    rate → 0; GST prefills only when FBR is off — the
                    scenario owns it otherwise). Clearing it resets
                    those details. */}
                <div style={{ marginBottom: "1rem" }}>
                  <label style={styles.label}>Sales Order <span style={{ fontWeight: 400 }}>(optional — loads buyer &amp; items)</span></label>
                  {salesOrderOptions.length === 0 ? (
                    <p style={{ color: colors.textSecondary, fontSize: "0.82rem", margin: 0 }}>
                      No sales orders{divisionId ? " in this division" : ""} — enter the bill manually below.
                    </p>
                  ) : (
                    <SearchableSelect
                      items={salesOrderOptions}
                      value={salesOrderId}
                      onChange={(id) => handleSalesOrderSelect(id)}
                      labelKey="_label"
                      searchKeys={["salesOrderNumber", "clientName", "customerPoNumber"]}
                      placeholder="— Load from a sales order —"
                    />
                  )}
                  {soLoadedMsg && <div style={{ fontSize: "0.72rem", color: colors.teal, marginTop: 4, fontWeight: 600 }}>{soLoadedMsg}</div>}
                </div>

                {/* ── Step 1: Pick FBR scenario ───────────────
                    Collapsed by default — operator sees a one-line summary
                    of the auto-defaulted scenario and can expand to change
                    it. Auto-collapses again when a card is picked so the
                    flow keeps moving down to Buyer / Bill Details. */}
                {fbrEnabled && (
                <div style={{ marginBottom: "1rem" }}>
                  <button
                    type="button"
                    onClick={() => setScenarioPickerOpen((v) => !v)}
                    style={styles.scenarioCollapseHeader}
                  >
                    <span style={styles.stepNum}>1</span>
                    <span style={styles.scenarioCollapseTitle}>FBR Scenario</span>
                    {chosenScenario ? (
                      <span style={styles.scenarioCollapseSummary}>
                        <span style={styles.scenarioCollapseCode}>{chosenScenario.code}</span>
                        <span>·</span>
                        <span>{chosenScenario.saleType}</span>
                        <span>·</span>
                        <span>{chosenScenario.defaultRate}% GST</span>
                        {chosenScenario.meta.buyerKind === "b2b-registered" && <span style={{ ...styles.scenarioBadge, ...styles.badgeBlue }}>Registered</span>}
                        {chosenScenario.meta.buyerKind === "b2b-unregistered" && <span style={{ ...styles.scenarioBadge, ...styles.badgeOrange }}>Unregistered</span>}
                        {chosenScenario.meta.buyerKind === "walk-in" && <span style={{ ...styles.scenarioBadge, ...styles.badgePurple }}>Walk-in</span>}
                      </span>
                    ) : (
                      <span style={styles.scenarioCollapseSummaryMuted}>
                        Pick an FBR scenario to start
                      </span>
                    )}
                    <span style={styles.scenarioCollapseChevron}>
                      {scenarioPickerOpen ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
                      <span style={styles.scenarioCollapseChevronLabel}>
                        {scenarioPickerOpen ? "Hide" : "Change"}
                      </span>
                    </span>
                  </button>

                  {scenarioPickerOpen && (
                    <div style={styles.scenarioCollapseBody}>
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
                                onClick={() => {
                                  setScenarioCode(s.code);
                                  // Auto-collapse on pick — operator made
                                  // their choice, hide the picker so the
                                  // form scrolls back into Buyer / Items.
                                  setScenarioPickerOpen(false);
                                }}
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
                  )}
                </div>
                )}

                {/* ── Step 2: Buyer ───────────────
                    Collapsible — same shape as Step 1 but expanded by
                    default because the operator must pick a buyer. The
                    summary bar shows the selected buyer name when collapsed
                    so the screen stays tidy on subsequent steps. */}
                {(chosenScenario || !fbrEnabled) && (() => {
                  const selectedBuyer = filteredClients.find((c) => String(c.id) === String(selectedClientId));
                  return (
                    <div style={{ marginBottom: "1rem" }}>
                      <button
                        type="button"
                        onClick={() => setBuyerOpen((v) => !v)}
                        style={styles.scenarioCollapseHeader}
                      >
                        <span style={styles.stepNum}>2</span>
                        <span style={styles.scenarioCollapseTitle}>
                          {buyerKind === "walk-in" ? "Walk-in Buyer" : "Buyer"}
                        </span>
                        {selectedBuyer ? (
                          <span style={styles.scenarioCollapseSummary}>
                            <span>{selectedBuyer.name}</span>
                            {(selectedBuyer.ntn || selectedBuyer.cnic) && (
                              <span style={styles.scenarioCollapseMeta}>
                                · {selectedBuyer.ntn ? `NTN ${selectedBuyer.ntn}` : `CNIC ${selectedBuyer.cnic}`}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span style={styles.scenarioCollapseSummaryMuted}>
                            Choose a buyer
                          </span>
                        )}
                        <span style={styles.scenarioCollapseChevron}>
                          {buyerOpen ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
                          <span style={styles.scenarioCollapseChevronLabel}>
                            {buyerOpen ? "Hide" : "Change"}
                          </span>
                        </span>
                      </button>

                      {buyerOpen && (
                        <div style={styles.scenarioCollapseBody}>
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
                              <div style={{ flex: 1 }}>
                                <SearchableSelect
                                  items={filteredClients.map((cl) => ({ ...cl, _label: `${cl.name} (${cl.registrationType || "—"}${cl.ntn ? ` · NTN ${cl.ntn}` : cl.cnic ? ` · CNIC ${cl.cnic}` : ""})` }))}
                                  value={selectedClientId}
                                  onChange={(id) => setSelectedClientId(id ? String(id) : "")}
                                  labelKey="_label"
                                  searchKeys={["name", "ntn", "cnic"]}
                                  placeholder="— Choose a buyer —"
                                />
                              </div>
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
                    </div>
                  );
                })()}

                {/* ── Step 3: Bill header + items ───────────────
                    The header-fields row (Bill Date / GST / Payment Terms /
                    Doc Type / Payment Mode) is collapsible — most defaults
                    are sensible (today's date, scenario-locked GST, "Sale
                    Invoice"), so the operator can hide the row to free
                    vertical space for the items grid. The items, totals
                    and Sale-Type-locked banner stay outside the collapse. */}
                {(chosenScenario || !fbrEnabled) && selectedClientId && (
                  <>
                    <div style={{ marginBottom: "0.75rem" }}>
                      <button
                        type="button"
                        onClick={() => setBillHeaderOpen((v) => !v)}
                        style={styles.scenarioCollapseHeader}
                      >
                        <span style={styles.stepNum}>3</span>
                        <span style={styles.scenarioCollapseTitle}>Bill Details</span>
                        <span style={styles.scenarioCollapseSummary}>
                          <span>{invoiceDate || "—"}</span>
                          <span>·</span>
                          <span>{gstRate}% GST</span>
                          <span>·</span>
                          <span>{documentType === 4 ? "Sale Invoice" : documentType === 9 ? "Debit Note" : documentType === 10 ? "Credit Note" : "—"}</span>
                          {paymentMode && <><span>·</span><span>{paymentMode}</span></>}
                        </span>
                        <span style={styles.scenarioCollapseChevron}>
                          {billHeaderOpen ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
                          <span style={styles.scenarioCollapseChevronLabel}>
                            {billHeaderOpen ? "Hide" : "Edit"}
                          </span>
                        </span>
                      </button>

                      {billHeaderOpen && (
                        <div style={{ ...styles.scenarioCollapseBody, marginBottom: 0 }}>
                          <div style={styles.row}>
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <label style={styles.label}>Bill Date</label>
                              <input type="date" style={styles.input} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                            </div>
                            {canViewDivisions && (
                              <DivisionSelect companyId={companyId} value={divisionId} onChange={setDivisionId} mode="select" label={<>Division <span style={{ fontWeight: 400 }}>(optional)</span></>} labelStyle={styles.label} style={styles.input} wrapStyle={{ flex: 1, minWidth: 140 }} />
                            )}
                            <div style={{ flex: 1, minWidth: 100 }}>
                              <label style={{ ...styles.label, whiteSpace: "nowrap" }}>
                                GST Rate (%) {chosenScenario && <span style={styles.lockedTag} title={`Locked by ${chosenScenario.code}`}><MdLock size={10} /> locked</span>}
                              </label>
                              <input
                                type="number"
                                style={{ ...styles.input, backgroundColor: chosenScenario ? "#eef5ff" : undefined, cursor: chosenScenario ? "not-allowed" : "text" }}
                                value={gstRate}
                                onChange={(e) => setGstRate(e.target.value)}
                                readOnly={!!chosenScenario}
                                title={chosenScenario ? `Locked by ${chosenScenario.code}. Switch scenario to change.` : "Set the GST rate for this bill"}
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <label style={styles.label}>Payment Terms</label>
                              <input type="text" style={styles.input} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Optional" />
                            </div>
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <label style={styles.label}>Customer PO # <span style={styles.optionalTag}>optional</span></label>
                              <input type="text" style={styles.input} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="From order, or manual" />
                            </div>
                            <div style={{ flex: 1, minWidth: 120 }}>
                              <label style={styles.label}>PO Date</label>
                              <input type="date" style={styles.input} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
                            </div>
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <label style={styles.label}>Document Type <span style={styles.optionalTag}>FBR</span></label>
                              <input
                                type="text"
                                style={{ ...styles.input, backgroundColor: "#eef5ff", cursor: "not-allowed" }}
                                value="Sale Invoice"
                                readOnly
                                title="This screen creates Sale Invoices only. Credit / Debit Notes will get their own dedicated screens."
                              />
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
                        </div>
                      )}
                    </div>

                    {chosenScenario && (
                      <div style={styles.lockedSaleType}>
                        <MdLock size={14} color={colors.teal} />
                        <span><b>Sale Type locked:</b> {chosenScenario.saleType}</span>
                        <span style={styles.lockedSaleTypeHint}>(every line uses this — required by {chosenScenario.code})</span>
                      </div>
                    )}

                    {/* Items table */}
                    <div>
                      <div style={styles.itemsHeaderBar}>
                        <label style={{ ...styles.label, margin: 0 }}>Items ({rows.length})</label>
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                          {/* 2026-05-13: previously hidden when billsMode
                              was true. Operators asked for the New Item
                              Type shortcut on every bill-creation flow
                              (including New Bill / New Bill No Challan),
                              so it's now visible regardless of tab.
                              Permission still gates the button. */}
                          {canCreateItemType ? (
                            <button
                              type="button"
                              style={styles.inlineAddBtn}
                              onClick={() => setShowAddItemType(true)}
                              title="Add a new item type to your catalog"
                            >
                              <MdAdd size={14} /> New Item Type
                            </button>
                          ) : (
                            <PermissionLackedHint inline perm="itemtypes.manage.create" what="add a new item type" />
                          )}
                          <button type="button" style={styles.addRowBtn} onClick={addRow}>
                            <MdAdd size={14} /> Add Row
                          </button>
                        </div>
                      </div>

                      {/* Bulk-apply toolbar — single dropdown stamps the
                          same catalog row across every line (or only the
                          empty ones). 'Clear all' wipes the Item Type
                          binding from every row in one click; useful when
                          the operator picked the wrong category in bulk
                          and wants to start over. Only shown once there
                          are 2+ rows since both actions have no value at
                          row count = 1. Available in Bills mode too —
                          the pick is optional there but persists and
                          shows on the Invoices tab. */}
                      <BulkItemTypeBar
                        itemCount={rows.length}
                        itemTypes={filteredItemTypes}
                        nonInventoryItems={nonInvItems}
                        divisionId={divisionId}
                        onApplyItemType={(id, picked, mode) => applyItemTypeToRows(picked, mode)}
                        onApplyNonInv={(n, mode) => applyNonInvToRows(n, mode)}
                        onClearAll={() => clearAllItemTypes()}
                        anyTagged={rows.some((r) => r.itemTypeId)}
                      />

                      <div style={styles.unifiedTableWrap}>
                        <table style={styles.unifiedTable}>
                          <thead>
                            <tr style={styles.unifiedThead}>
                              {/* Optional in Bills mode — a type picked at
                                  bill time persists to the Invoices tab. */}
                              <th style={{ ...styles.unifiedTh, width: showMRP || showSRO ? "22%" : "26%" }}>Item Type *</th>
                              <th style={{ ...styles.unifiedTh, width: showMRP || showSRO ? "16%" : "20%" }}>Description{billsMode ? " *" : ""}</th>
                              <th style={{ ...styles.unifiedTh, width: "7%" }}>Qty *</th>
                              <th style={{ ...styles.unifiedTh, width: "8%" }}>UOM</th>
                              <th style={{ ...styles.unifiedTh, width: "9%" }}>Unit Price *</th>
                              <th style={{ ...styles.unifiedTh, width: "10%" }}>Line Total</th>
                              {/* Account (GL) — which income account this line's
                                  amount posts to. Shown in both modes when the
                                  company has a Chart of Accounts. */}
                              {glOn && (
                                <th style={{ ...styles.unifiedTh, width: "14%" }} title="GL income account this line posts to">Account (GL)</th>
                              )}
                              {/* HS Code is an FBR field — only relevant on
                                  the Invoices tab. Bills mode is pre-FBR
                                  data entry, so hide the column. */}
                              {!billsMode && (
                                <th style={{ ...styles.unifiedTh, width: "10%" }}>HS Code</th>
                              )}
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
                                    <SearchableItemTypeSelect
                                      divisionId={divisionId}
                                      items={filteredItemTypes}
                                      value={r.itemTypeId}
                                      onChange={(id, picked) => handleItemTypePick(r.localId, picked || null)}
                                      nonInventoryItems={nonInvItems}
                                      nonInventoryValue={r.nonInventoryItemId || ""}
                                      onPickNonInventory={(n) => handleNonInventoryPick(r.localId, n)}
                                      placeholder="Required — pick item or non-inventory…"
                                      style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                    />
                                  </td>
                                  {/* Description: in Invoices mode it stays locked to the
                                      picked item type's name (text display). In Bills mode
                                      it becomes a LookupAutocomplete tied to /lookup/items —
                                      same UX the challan item form uses — so the operator
                                      can pick from previously-typed descriptions or type
                                      free-text. Picking an Item Type seeds it when blank. */}
                                  {billsMode ? (
                                    <td style={styles.unifiedTd}>
                                      <LookupAutocomplete
                                        label="Description"
                                        endpoint="/lookup/items"
                                        value={r.description || ""}
                                        onChange={(val) => updateRow(r.localId, { description: val })}
                                        inputStyle={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                        multiline
                                      />
                                    </td>
                                  ) : (() => {
                                    // Invoices-mode description is read-only: the item type's
                                    // name, or (for a non-inv charge line) its free-text description.
                                    const display = r.itemTypeName || (r.nonInventoryItemId ? r.description : "");
                                    return (
                                      <td style={{ ...styles.unifiedTd, color: display ? colors.textPrimary : colors.textSecondary, fontStyle: display ? "normal" : "italic" }}>
                                        {display || "(pick an item type)"}
                                      </td>
                                    );
                                  })()}
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
                                    {/* Bills mode (no challan): Unit autocomplete
                                        bound to /lookup/units — same UX the
                                        challan item form uses. New units the
                                        operator types are upserted into the
                                        Units table on save (see UnitRegistry).
                                        Invoices mode keeps the locked-when-
                                        itemTypeId input because UOM there is
                                        derived from the picked Item Type. */}
                                    {billsMode ? (
                                      <LookupAutocomplete
                                        label="Unit"
                                        endpoint="/lookup/units"
                                        value={r.uom || ""}
                                        onChange={(val) => updateRow(r.localId, { uom: val })}
                                        inputStyle={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                      />
                                    ) : (
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
                                    )}
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
                                  {glOn && (
                                    <td style={styles.unifiedTd}>
                                      <AccountSelect
                                        accounts={accounts}
                                        value={r.accountId ?? null}
                                        onChange={(v) => updateRow(r.localId, { accountId: v })}
                                        side="income"
                                        disabled={!!r.nonInventoryItemId}
                                        placeholder={r.nonInventoryItemId ? nonInvSaleAccountLabel(r.nonInventoryItemId) : defaultSaleAccountLabel}
                                        style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.76rem" }}
                                      />
                                    </td>
                                  )}
                                  {!billsMode && (
                                    <td
                                      style={{
                                        ...styles.unifiedTd,
                                        backgroundColor: "#f4f6fa",
                                        fontFamily: "monospace",
                                        fontSize: "0.78rem",
                                        color: r.hsCode ? colors.textPrimary : colors.textSecondary,
                                        fontStyle: r.hsCode ? "normal" : "italic",
                                      }}
                                      title="HS Code auto-fills from the picked Item Type"
                                    >
                                      {r.hsCode || "—"}
                                    </td>
                                  )}
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
                        {billsMode ? (
                          <> <b>Item Type</b> is optional — picking one classifies the line (HS Code / UOM / Sale Type ride along) and shows on the Invoices tab</>
                        ) : (
                          <> <b>Description, UOM, HS Code, Sale Type</b> all auto-fill from the picked Item Type</>
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

                {/* Attachments — staged client-side until the bill is created,
                    then flushed against the new id (see handleSubmit). */}
                <AttachmentManager
                  ref={attachmentRef}
                  companyId={companyId}
                  entityType="Invoice"
                  entityId={null}
                  mode="edit"
                />
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
                opacity: saving || !(chosenScenario || !fbrEnabled) || !selectedClientId || !allRowsValid ? 0.6 : 1,
              }}
              disabled={saving || !(chosenScenario || !fbrEnabled) || !selectedClientId || !allRowsValid}
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
          fbrEnabled={company?.fbrEnabled !== false}
          onClose={() => setShowAddClient(false)}
          onSaved={(created) => onClientSaved(created)}
        />
      )}

      {/* Inline Add Item Type modal — shared ItemTypeForm used by every
          create / edit entry point. Slim props (no rich-hints panel, no
          favorite toggle) keep the modal inline-friendly. */}
      {showAddItemType && (
        <ItemTypeForm
          companyId={companyId}
          scenarioCode={chosenScenario?.code}
          scenarioSaleType={chosenScenario?.saleType}
          showGlMapping
          defaultDivisionId={divisionId || null}
          onClose={() => { setShowAddItemType(false); setPendingItemTypeRow(null); }}
          onSaved={onItemTypeSaved}
        />
      )}
    </div>
  );
}

// ItemTypeForm + PermissionLackedHint live in their own files
// (Components/ItemTypeForm.jsx, Components/PermissionLackedHint.jsx)
// so InvoiceForm (with-challan) can import the same pieces.

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
  stepNum: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", backgroundColor: colors.blue, color: "#fff", fontSize: "0.78rem", fontWeight: 800, flexShrink: 0 },
  stepHint: { margin: "0 0 0.6rem 30px", fontSize: "0.78rem", color: colors.textSecondary, lineHeight: 1.4 },
  // Collapsible Step 1 (FBR Scenario picker) — clickable header bar that
  // shows the auto-defaulted scenario summary and toggles the card grid.
  // Operator only opens this when they need to switch scenarios; the rest
  // of the time they read the summary chip and move on to Buyer / Items.
  scenarioCollapseHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    width: "100%",
    padding: "0.6rem 0.85rem",
    borderRadius: 10,
    border: `1px solid ${colors.cardBorder}`,
    backgroundColor: "#f8faff",
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
    boxShadow: "none",
    margin: 0,
  },
  scenarioCollapseTitle: {
    fontSize: "0.92rem",
    fontWeight: 700,
    color: colors.textPrimary,
    flexShrink: 0,
  },
  scenarioCollapseSummary: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    flex: 1,
    fontSize: "0.82rem",
    color: colors.textPrimary,
    flexWrap: "wrap",
    minWidth: 0,
  },
  scenarioCollapseSummaryMuted: {
    flex: 1,
    fontSize: "0.82rem",
    color: colors.textSecondary,
    fontStyle: "italic",
  },
  scenarioCollapseMeta: {
    color: colors.textSecondary,
    fontSize: "0.78rem",
  },
  scenarioCollapseCode: {
    fontWeight: 700,
    color: colors.blue,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  scenarioCollapseChevron: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.2rem",
    color: colors.blue,
    fontWeight: 600,
    fontSize: "0.78rem",
    flexShrink: 0,
  },
  scenarioCollapseChevronLabel: {
    fontSize: "0.78rem",
    fontWeight: 600,
  },
  scenarioCollapseBody: {
    marginTop: "0.65rem",
    padding: "0.65rem 0.85rem",
    borderRadius: 10,
    border: `1px solid ${colors.cardBorder}`,
    backgroundColor: "#fff",
  },

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

  // ── HS code typeahead inside ItemTypeForm ─────────────────────────
  scenarioPillSmall: { marginLeft: "0.5rem", padding: "0.1rem 0.4rem", borderRadius: 4, backgroundColor: "#e3f2fd", color: "#0d47a1", fontSize: "0.7rem", fontWeight: 800, fontFamily: "monospace" },
  hsDropdown: { position: "absolute", top: "100%", left: 0, right: 0, marginTop: "0.2rem", maxHeight: 260, overflowY: "auto", backgroundColor: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.08)", zIndex: 1200 },
  hsLoading: { padding: "0.6rem 0.85rem", fontSize: "0.82rem", color: colors.textSecondary },
  hsOption: { display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "0.5rem 0.75rem", border: "none", borderBottom: `1px solid ${colors.cardBorder}`, backgroundColor: "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit" },
  hsOptionCode: { fontWeight: 700, color: colors.blue, fontFamily: "monospace", fontSize: "0.85rem" },
  hsOptionDesc: { fontSize: "0.74rem", color: colors.textSecondary, marginTop: 2, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" },

  // Bulk-apply Item Type toolbar — surfaces above the items table when 2+ rows exist
  bulkApplyBar: { display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap", padding: "0.55rem 0.85rem", marginBottom: "0.5rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#f8faff" },
  bulkClearBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.35rem 0.7rem", borderRadius: 6, border: `1px solid ${colors.danger}`, backgroundColor: "#fff", color: colors.danger, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
};
