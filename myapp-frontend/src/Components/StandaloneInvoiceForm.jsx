import { useState, useEffect, useMemo, useRef } from "react";
import { MdAdd, MdDelete, MdCheck, MdInfo, MdLock, MdPersonAdd, MdExpandMore, MdExpandLess } from "react-icons/md";
import { createStandaloneInvoice, getStockPricing } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { getFbrApplicableScenarios } from "../api/fbrApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getNonInventoryItemsByCompany } from "../api/nonInventoryItemApi";
import { getAccountsFlat } from "../api/accountApi";
import { getAllUnits } from "../api/unitsApi";
import { isDecimalUnit } from "../utils/formatQuantity";
import { getSalesOrdersForPicker, getSalesOrderInvoicePrefill } from "../api/salesOrderApi";
import { formStyles, modalSizes } from "../theme";
import { todayYmd } from "../utils/dateInput";
import { ADVANCE_TAX_OPTIONS, advanceTaxLabel, findAdvanceTax, advanceTaxAmount } from "../config/advanceTax";
import { defaultAccountPlaceholder } from "../utils/accountDisplay";
import { usePermissions } from "../contexts/PermissionsContext";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import TaxRateNotice from "./TaxRateNotice";
import { billFormShell, billFormBody } from "./bill/billTheme";
import BillStep from "./bill/BillStep";
import BillChecklist from "./bill/BillChecklist";
import BillTotals from "./bill/BillTotals";
import { BILL_ANCHORS, lineAnchor, rateBlockText, billChecklist, billTotalsRows, salesTaxBase, isThirdScheduleSaleType } from "../utils/billEntry";
import useImportedTaxRates from "../hooks/useImportedTaxRates";
import useScenarioFollowsGoods from "../hooks/useScenarioFollowsGoods";
import { itemTypesForBook, BOOK_BILL } from "../utils/itemTypeBooks";
import { matchesScenarioSaleType, DEFAULT_SALE_TYPE } from "../utils/saleType";
import BulkItemTypeBar from "./BulkItemTypeBar";
import AccountSelect from "./AccountSelect";
import LookupAutocomplete from "./LookupAutocomplete";
import ClientForm from "./ClientForm";
import DivisionSelect from "./DivisionSelect";
import SearchableSelect from "./SearchableSelect";
import ItemTypeForm from "./ItemTypeForm";
import PermissionLackedHint from "./PermissionLackedHint";
import BillNumberField, { billNumberPayload } from "./BillNumberField";
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
  SN008: { buyerKind: "either",           needsMRP: true,  needsSRO: false, hint: "3rd Schedule goods — FBR charges the tax on the printed retail price: 18% of MRP × Qty. Enter the MRP per unit." },
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
  // New bills default to the division currently being filtered on the page
  // (so "filter to a division → New Bill" lands in that division).
  const [divisionId, setDivisionId] = useState(defaultDivisionId ? String(defaultDivisionId) : "");
  const [gstRate, setGstRate] = useState(18);
  // Withholding tax (income tax that sits ON TOP of GST — never changes
  // subtotal / GST / grand total). "none" | "rate" (a %) | "amount" (fixed PKR).
  // Prefilled from the company's default rate below when one is configured.
  const [whtMode, setWhtMode] = useState("none");
  const [whtRate, setWhtRate] = useState("");
  // Further tax (s.3(1A)). Unlike the two income taxes it is part of the
  // supply's tax, so it goes INSIDE the grand total. Defaulted to the
  // statutory 4% on every bill (operator decision 2026-09-07) -- clear the
  // field to charge none. A per-client rate can come later.
  const [furtherTaxRate, setFurtherTaxRate] = useState(""); // set from the buyer below
  // Advance income tax (236G / 236H). One dropdown: the section and whether the
  // buyer is on the Active Taxpayer List together pick the rate. Empty means
  // none, which is the default -- it must never be charged by accident.
  const [advTaxKey, setAdvTaxKey] = useState("");

  // What each picked item's stock is worth, so a line TOTAL can be turned into
  // a quantity. The operator knows the amount they are billing, not the unit
  // count. Keyed by item type id; the unit price is the stock's weighted-average
  // cost, read from the server's one valuation walk -- nothing is recomputed
  // here (see Helpers/StockValuation).
  const [stockPricing, setStockPricing] = useState({});
  // The unit table decides whether a "bill the whole bin" line may carry the
  // exact fractional on-hand (KG) or must round up to whole units (Pcs).
  const [units, setUnits] = useState([]);
  useEffect(() => {
    let alive = true;
    getAllUnits().then(({ data }) => { if (alive) setUnits(Array.isArray(data) ? data : []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  // The row whose item type was just picked. The next field to fill depends on
  // whether that item can be priced from stock, and pricing arrives one fetch
  // later -- so the focus is placed by an effect once the answer is in, not at
  // the moment of the pick.
  const [focusRow, setFocusRow] = useState(null);
  useEffect(() => {
    if (!focusRow) return;
    const priced = stockPricing[focusRow.itemTypeId];
    // undefined = the pricing for this item has not come back yet; wait for it
    // rather than guessing and focusing the wrong box.
    if (priced === undefined) return;
    const key = priced.canPrice ? "amount" : "qty";
    const el = document.querySelector(`[data-row-${key}="${focusRow.localId}"]`);
    if (el) { el.focus(); el.select?.(); }
    setFocusRow(null);
  }, [focusRow, stockPricing]);

  // The Unit table is no longer read here. A quantity DERIVED from an entered
  // amount is always a whole number now, so AllowsDecimalQuantity has nothing
  // to decide on this screen -- it still governs a quantity the operator types,
  // which QuantityInput handles wherever that happens.
  const [whtAmount, setWhtAmount] = useState("");
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
  // Bill / Invoice number. "auto" is the default and reproduces the behaviour
  // that existed before this control: invoiceNumber is sent as null and the
  // server allocates the next number in this bill's own (per-division)
  // sequence. "custom" sends the typed number verbatim; billNumberOk mirrors
  // the field's availability check so Save can't fire on a refused number.
  const [billNumberMode, setBillNumberMode] = useState("auto");
  const [billNumber, setBillNumber] = useState("");
  const [billNumberOk, setBillNumberOk] = useState(true);
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
  // Error banner lives at the top of a scrollable modal body; on a failed save
  // the user is normally scrolled down at the submit button and never sees it.
  // Scroll it into view whenever an error appears (server 409 or validation).
  const errorRef = useRef(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);

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
          // Prefer the name the prefill payload carries so the row keeps the
          // Item Type even before the catalog finishes loading; fall back to
          // the local catalog row when an older backend omits it.
          itemTypeName: ln.itemTypeName || t?.name || "",
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

  // ── The rate the goods came in at ─────────────────────────────────────────
  // The company's own GD / opening stock say what each item was imported at;
  // a bill charging another rate is refused on save unless the scenario is
  // changed or a reason is written (Helpers/ImportedTaxRate). This asks the
  // server BEFORE saving, so the operator sees the refusal coming and the
  // one-click fix beside it.
  const [rateReason, setRateReason] = useState("");
  const pickedItemKey = rows.map((r) => r.itemTypeId || "").join(",");
  const pickedItemIds = useMemo(
    () => pickedItemKey.split(",").map(Number).filter((n) => n > 0),
    [pickedItemKey],
  );
  // Under a non-standard scenario the picker keeps only items whose sale type IS
  // that scenario's; the goods imported at its rate carry none, so they are
  // fetched and let back in.
  const widenForRate = chosenScenario
    && (chosenScenario.saleType || "").trim().toLowerCase() !== DEFAULT_SALE_TYPE.toLowerCase()
    ? Number(chosenScenario.defaultRate) : null;
  const rateCheck = useImportedTaxRates(companyId, pickedItemIds, gstRate, { widenForRate });

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

  // Further tax (s.3(1A)) is charged on a supply to an UNREGISTERED buyer. The
  // form used to open on 4% for every bill, so a registered buyer was billed 4%
  // on top -- and FBR's sandbox accepts it, so nothing downstream objected.
  // Follows the buyer the way Payment Mode does above: 4% for an unregistered
  // buyer, none for a registered one; the operator can still change it.
  useEffect(() => {
    if (!selectedClientId) return;
    const client = clients.find((c) => String(c.id) === String(selectedClientId));
    if (!client) return;
    const registered = (client.registrationType || "").toLowerCase() === "registered";
    setFurtherTaxRate(registered ? "" : "4");
  }, [selectedClientId, clients]);

  // Prefill the WHT rate from the company default (rate-mode) when one is
  // configured. Runs once when the default becomes available; the primitive
  // dependency stays stable afterward so it never clobbers operator edits.
  useEffect(() => {
    if (company?.defaultWithholdingTaxRate != null) {
      setWhtMode("rate");
      setWhtRate(String(company.defaultWithholdingTaxRate));
    }
  }, [company?.defaultWithholdingTaxRate]);

  // Per-row helpers
  const updateRow = (localId, patch) =>
    setRows((prev) => prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (localId) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.localId !== localId)));

  // A description the previous pick filled in -- still that item's name, word
  // for word -- is the catalog's text, not the operator's, so it follows a
  // re-pick. Keeping it left "WEIGHT SCALE PARTS PLASTIC HOUSING" on a line
  // re-pointed at a juice blender. Anything typed, or carried in from a sales
  // order, still stays.
  const seededDescription = (r, picked) =>
    (r.description?.trim() && r.description !== r.itemTypeName ? r.description : (picked.name || ""));

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
        // Seed the description from the item type ONLY when the operator has not
        // written one -- in either mode. Picking (or re-picking) an item type
        // must never overwrite words someone typed, or a prefill carried in
        // from a sales order.
        description: seededDescription(r, picked),
        // A line priced from an AMOUNT is re-priced at the new item's cost
        // (the effect after deriveFromTotal); the old item's quantity and
        // rate must not stand in for it meanwhile.
        ...(r.lineTotal && r.itemTypeId !== picked.id ? { quantity: "", unitPrice: "" } : null),
      };
    }));
    // The operator's next step is the amount (or the quantity, when there is
    // no stock to price from), so put the cursor there.
    setFocusRow({ localId, itemTypeId: picked.id });
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
        // Seed the description from the item type ONLY when the operator has not
        // written one -- in either mode. Picking (or re-picking) an item type
        // must never overwrite words someone typed, or a prefill carried in
        // from a sales order.
        description: seededDescription(r, picked),
        // A line priced from an AMOUNT is re-priced at the new item's cost
        // (the effect after deriveFromTotal); the old item's quantity and
        // rate must not stand in for it meanwhile.
        ...(r.lineTotal && r.itemTypeId !== picked.id ? { quantity: "", unitPrice: "" } : null),
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
  // A bill is the COMMERCIAL book, so under the overlay it offers only item
  // types with no HS code; the HS-coded ones belong to the invoice that gets
  // filed. With the overlay off this is the identical list as before.
  const overlayOn = !!company?.inventoryOverlayEnabled;
  const filteredItemTypes = useMemo(() => {
    const forBook = itemTypesForBook(itemTypes, overlayOn, BOOK_BILL);
    // The scenario's sale-type filter belongs to the FILED book. It exists to
    // stop a mixed-sale-type bill that FBR rejects with 0052 -- but under the
    // overlay the bill is not what gets filed, and a commercial no-HS item
    // carries no sale type at all, so applying both filters leaves the picker
    // empty and the operator with nothing to choose.
    if (overlayOn) return forBook;
    if (!chosenScenario) return forBook;
    // An item type with NO sale type counts as the standard-rate default
    // (utils/saleType.js) -- otherwise the bill's own item vanished from
    // this list and the picker rendered blank on edit.
    // Two exceptions, both so the scenario an operator must use stays usable:
    // an item already on the bill is never hidden (its own row's picker would
    // go blank), and goods this company imported at the scenario's rate are let
    // in even though they carry no sale type of their own.
    const onBill = new Set(pickedItemIds);
    return forBook.filter(
      (t) => matchesScenarioSaleType(t, chosenScenario.saleType)
        || onBill.has(Number(t.id))
        || rateCheck.importedAtRate.has(Number(t.id)),
    );
  }, [itemTypes, chosenScenario, overlayOn, pickedItemIds, rateCheck.importedAtRate]);

  // One click to the scenario whose rate the goods came in at -- offered only
  // when every item with a record agrees on one rate AND exactly one scenario
  // carries it (25% is SN024 alone). Goods of two rates cannot share a bill
  // here, so that case is told to split instead.
  const rateSplitNeeded = rateCheck.billRates.length > 1;
  const rateSuggestion = useMemo(() => {
    if (rateCheck.enforced.length === 0 || rateCheck.billRates.length !== 1) return null;
    const target = rateCheck.billRates[0];
    const matches = enrichedScenarios.filter((sc) => Number(sc.defaultRate) === target);
    if (matches.length !== 1) return null;
    const sc = matches[0];
    return {
      code: sc.code,
      rate: target,
      label: `Bill under ${sc.code} (${target}%)`,
      hint: sc.meta?.needsSRO && sc.defaultSroScheduleNo
        ? `Fills SRO schedule ${sc.defaultSroScheduleNo}. The serial is FBR's catalog default: confirm it for these goods.`
        : null,
      // The SRO reference follows from the scenario (the effect below).
      onApply: () => setScenarioCode(sc.code),
    };
  }, [rateCheck.enforced.length, rateCheck.billRates, enrichedScenarios]);
  // Saving is refused (here and on the server) until the scenario matches or a
  // reason is written, so the button says so instead of looking live.
  const rateBlocked = rateCheck.enforced.length > 0 && !rateReason.trim();
  // Until the operator picks one, the scenario follows the goods: 25% goods
  // move the bill to SN024 by themselves (hooks/useScenarioFollowsGoods).
  const scenarioFollow = useScenarioFollowsGoods({
    suggestion: rateSuggestion,
    billRates: rateCheck.billRates,
    scenarios: enrichedScenarios,
    scenarioCode,
    setScenarioCode,
  });

  // An SRO scenario carries FBR's own schedule string and a default serial.
  // Fill them into every line that has none, however the scenario was chosen --
  // the Step 1 cards or the rate notice's one-click switch -- and into rows
  // added later. Only the one-click switch used to fill them, so picking SN024
  // from the cards left two required boxes empty and the bill unsaveable behind
  // "Some required fields are missing". On a switch between SRO scenarios, a
  // value the previous one filled in is replaced; one the operator typed stays.
  const autoSro = useRef({ sched: "", serial: "" });
  useEffect(() => {
    const needs = !!chosenScenario?.meta.needsSRO;
    const sched = needs ? (chosenScenario.defaultSroScheduleNo || "") : "";
    const serial = needs ? (chosenScenario.defaultSroItemSerialNo || "") : "";
    if (!sched && !serial) return;
    const prev = autoSro.current;
    autoSro.current = { sched, serial };
    const pick = (current, fill, stale) => (!current?.trim() || current === stale ? fill : current);
    setRows((rs) => {
      let changed = false;
      const next = rs.map((r) => {
        const s = pick(r.sroScheduleNo, sched, prev.sched);
        const n = pick(r.sroItemSerialNo, serial, prev.serial);
        if (s === r.sroScheduleNo && n === r.sroItemSerialNo) return r;
        changed = true;
        return { ...r, sroScheduleNo: s, sroItemSerialNo: n };
      });
      return changed ? next : rs;
    });
  }, [chosenScenario, rows.length]);

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
  // 3rd Schedule goods are taxed on MRP x Qty, not the sale value -- the base
  // the server charges and FBR is sent (Helpers/SalesTaxBase). The MRP is the
  // per-unit figure on the line; the payload sends it times the quantity.
  const taxBase = salesTaxBase(rows.map((r) => {
    const q = parseFloat(r.quantity) || 0;
    return {
      value: q * (parseFloat(r.unitPrice) || 0),
      retail: chosenScenario?.meta.needsMRP && r.mrp && q ? Math.round(parseFloat(r.mrp) * q * 100) / 100 : 0,
      thirdSchedule: !!chosenScenario?.isThirdSchedule || isThirdScheduleSaleType(effectiveSaleType(r)),
    };
  }));
  const gstAmount = Math.round(taxBase * (parseFloat(gstRate) || 0) / 100 * 100) / 100;
  // Charged on the NET value of supply -- the same base as sales tax, which is
  // what FbrLineTax uses per line, so the document and the FBR payload cannot
  // disagree. Rounded the way the server rounds it.
  const furtherTaxAmount =
    Math.round(subtotal * (parseFloat(furtherTaxRate) || 0) / 100 * 100) / 100;
  const grandTotal = subtotal + gstAmount + furtherTaxAmount;

  // Withholding tax — rate-mode = % of the gross (subtotal + GST), rounded to
  // 2dp exactly like the backend (Math.round(x*100)/100). Fixed-amount mode =
  // the typed PKR value. Balance due the buyer pays = grandTotal − WHT.
  const computedWhtAmount = Math.round(grandTotal * (parseFloat(whtRate) || 0)) / 100;
  const whtResolved = whtMode === "none" ? 0 : (whtMode === "rate" ? computedWhtAmount : (parseFloat(whtAmount) || 0));
  const balanceDue = grandTotal - whtResolved;

  // One request per change of the picked set, not per keystroke.
  const pickedItemTypeIds = useMemo(
    () => [...new Set(rows.map((r) => r.itemTypeId).filter(Boolean))].sort().join(","),
    [rows]
  );
  useEffect(() => {
    if (!companyId || !pickedItemTypeIds) return;
    // Under the overlay the bill carries the COMMERCIAL quantity and price the
    // customer agreed, typed by hand -- not this item'''s stock cost. Not
    // fetching is the whole switch: with no pricing, canPrice is never true,
    // deriveFromTotal returns null, the Amount box stops driving anything and
    // focus lands on Quantity. The form falls back to its own qty x price
    // path, which is code that already existed and is already tested.
    if (overlayOn) { setStockPricing({}); return; }
    let cancelled = false;
    getStockPricing(companyId, pickedItemTypeIds)
      .then(({ data }) => {
        if (cancelled) return;
        setStockPricing(Object.fromEntries((data || []).map((x) => [x.itemTypeId, x])));
      })
      .catch(() => { /* pricing is a convenience; the operator can still type */ });
    return () => { cancelled = true; };
  }, [companyId, pickedItemTypeIds, overlayOn]);

  // Line total -> quantity, at the stock's own unit price:
  //     UnitPrice = stock value excluding tax / stock quantity
  //     Quantity  = line total / UnitPrice
  // Refuses rather than divides by zero when the item has no stock or no value.
  // The AMOUNT is what the operator enters; quantity and unit price are
  // derived from it, and their product must equal it exactly.
  //
  // Two constraints make that arithmetic, not a rounding hope:
  //   * InvoiceItem.UnitPrice is decimal(18,2), so the rate has to BE a 2dp
  //     figure -- carrying the stock's 4dp average cost through would store a
  //     rounded rate and the line would no longer multiply out.
  //   * A unit that does not allow decimals can only hold a whole quantity
  //     (AllowsDecimalQuantity per Unit -- 5.5 Pcs is not a thing).
  //
  // WHILE TYPING the field keeps exactly what was typed. Rewriting it on every
  // keystroke made the box impossible to use: typing the "5" of 5000 derived a
  // quantity of 1, snapped the amount to one unit's cost and replaced the text,
  // so the remaining digits had nothing to land on. The snap happens on blur
  // instead, once the operator has finished the number.
  const deriveFromTotal = (row, total) => {
    const price = stockPricing[row.itemTypeId];
    if (!price?.canPrice || !(total > 0)) return null;
    const cost = Number(price.unitCost);
    if (!(cost > 0)) return null;

    // The AMOUNT the operator typed is the source of truth (2026-09-03). The
    // quantity is rounded to a WHOLE number and the rate absorbs whatever that
    // rounding costs, so the line comes to exactly the figure they entered.
    //
    // The UOM deliberately does NOT decide the precision here. It used to: a
    // decimal-capable unit kept a fractional quantity like 2.5, which is
    // tidy arithmetic but not what someone asking for "100 worth" means, and
    // it made the answer depend on a unit setting the operator cannot see from
    // this field. Entering an amount now always yields a whole quantity --
    // typing a quantity directly is still governed by the unit (QuantityInput),
    // which is where that rule belongs.
    // The WHOLE of the stock is a case of its own (2026-09-12). Stock on an
    // integer unit can be fractional (an import or an adjustment left
    // 331.9597 Pcs worth 317,028.67), and an operator typing that value wants
    // the bin emptied. The quantity stays WHOLE -- 332 Pcs, rounded up -- and
    // the rate absorbs it so the line is exactly the bin's value. The server
    // settles the 0.0403 the bin is short with a zero-cost rounding
    // adjustment before the sale, so this is not an oversell and the bin ends
    // at zero.
    const fullValue = Math.round(Number(price.availableValueExcludingTax) * 100) / 100;
    const onHand = Number(price.availableQuantity);
    if (fullValue > 0 && onHand > 0 && Math.abs(total - fullValue) < 0.005) {
      const qtyAll = closeOutQuantity(price, row);
      const rate = Math.round((fullValue / qtyAll) * 1e12) / 1e12;
      return { qty: qtyAll, rate, exact: fullValue, closeOut: true };
    }

    const rawQty = total / cost;
    const qty = Math.max(1, Math.round(rawQty));

    // The rate carries the remainder, to the 12 decimals UnitPrice stores:
    // 100 over 3 units is 33.333333333333 each, and 3 x that books as exactly
    // 100.00 once LineTotal is rounded to its 2dp money precision. While the
    // rate was capped at 2dp the best it could do was 33.33, i.e. 99.99.
    const rate = Math.round((total / qty) * 1e12) / 1e12;
    // What the LINE is worth is the amount that was typed, not qty x rate
    // re-rounded -- the two agree to the paisa by construction, and quoting the
    // typed figure back is what guarantees the operator never sees their own
    // number change.
    return { qty, rate, exact: Math.round(total * 100) / 100 };
  };

  // The AMOUNT is the source of truth on a line priced from stock, so a line
  // re-pointed at another item is re-priced at THAT item's cost once its
  // pricing arrives. Without this the old item's quantity and rate stayed:
  // 10,000 of a 1,992-a-unit massage gun went down as 48 units at 208.33.
  useEffect(() => {
    setRows((rs) => {
      let changed = false;
      const next = rs.map((r) => {
        if (!r.itemTypeId || !r.lineTotal) return r;
        const d = deriveFromTotal(r, parseFloat(r.lineTotal));
        if (!d) return r;
        const q = String(d.qty);
        const p = String(d.rate);
        if (q === r.quantity && p === r.unitPrice) return r;
        changed = true;
        return { ...r, quantity: q, unitPrice: p, lineTotal: String(d.exact) };
      });
      return changed ? next : rs;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockPricing]);

  // How much this line wants versus how much there is.
  //
  // Only meaningful when the item HAS priceable stock: `canPrice` is false both
  // when nothing is on hand and when the stock carries no value, and billing an
  // item with nothing on hand is a documented flow (the operator types the
  // quantity and rate themselves). Blocking that would be a regression, so the
  // test is limited to lines the system can actually price.
  //
  // Entering an AMOUNT is what makes this easy to get wrong: 1,162,456.17 at a
  // weighted-average 5.50 asks for 211,356 KG of an item holding 2,100, and
  // nothing on the way to saving said so (Alpha Traders bill 51, 2026-09-04 --
  // on-hand went to -209,256).
  //
  // Whether a shortfall STOPS the save follows the company's own policy
  // (Company.StockGuardHardBlock), so the form never refuses something the
  // server would accept, nor waves through something it would reject with a
  // 409. With the policy off the operator still gets told, in as many words,
  // that the bill will drive on-hand negative -- silence is what let Alpha
  // Traders reach -209,256.
  const stockHardBlock = !!company?.stockGuardHardBlock;

  // The quantity that empties a bin, by the unit's own rule: a decimal-capable
  // unit (KG) takes the exact on-hand, fraction and all; a whole-unit one (Pcs)
  // rounds UP, and the server settles the missing fraction in the stock ledger.
  const closeOutQuantity = (price, row) => {
    const onHand = Number(price.availableQuantity);
    if (isDecimalUnit(price.uom || row.uom, units)) return onHand;
    return Math.max(1, Math.ceil(onHand - 1e-9));
  };

  // The line bills the whole bin at the bin's exact value, with the quantity
  // closeOutQuantity gives. Not a shortfall -- for a whole-unit item the server
  // rounds the bin up by the fraction before the sale (see deriveFromTotal).
  const isCloseOut = (row) => {
    const price = stockPricing[row.itemTypeId];
    if (!price?.canPrice) return false;
    const have = Number(price.availableQuantity);
    const want = parseFloat(row.quantity);
    const total = parseFloat(row.lineTotal);
    const fullValue = Math.round(Number(price.availableValueExcludingTax) * 100) / 100;
    return have > 0 && Math.abs(want - closeOutQuantity(price, row)) < 1e-9
      && fullValue > 0 && Math.abs(total - fullValue) < 0.005;
  };

  const stockShortfall = (row, extraAvailable = 0) => {
    const price = stockPricing[row.itemTypeId];
    if (!price?.canPrice) return null;
    const want = parseFloat(row.quantity);
    if (!(want > 0)) return null;
    const have = Number(price.availableQuantity) + Number(extraAvailable || 0);
    if (!(want > have)) return null;
    if (!extraAvailable && isCloseOut(row)) return null;
    return {
      want,
      have,
      short: want - have,
      uom: price.uom || row.uom || "",
      unitCost: Number(price.unitCost) || 0,
      name: price.itemTypeName || row.itemTypeName || "this item",
    };
  };

  const applyLineTotal = (localId, raw) => {
    const row = rows.find((r) => r.localId === localId);
    if (!row?.itemTypeId) return;          // the field is disabled until one is picked

    const d = deriveFromTotal(row, parseFloat(raw));
    if (!d) {
      // Keep the keystrokes; clear the derived pair until the amount is usable.
      updateRow(localId, { lineTotal: raw, quantity: "", unitPrice: "" });
      return;
    }
    updateRow(localId, {
      lineTotal: raw,                      // verbatim, so typing works
      quantity: String(d.qty),
      unitPrice: String(d.rate),
    });
  };

  // "Bill everything on hand": the line takes the stock's whole value, which
  // deriveFromTotal turns into the exact on-hand quantity.
  const billAllOnHand = (localId) => {
    const row = rows.find((r) => r.localId === localId);
    const price = row && stockPricing[row.itemTypeId];
    if (!price?.canPrice) return;
    const fullValue = Math.round(Number(price.availableValueExcludingTax) * 100) / 100;
    if (!(fullValue > 0)) return;
    const d = deriveFromTotal(row, fullValue);
    if (!d) return;
    updateRow(localId, { lineTotal: String(d.exact), quantity: String(d.qty), unitPrice: String(d.rate) });
  };

  // On blur, settle the amount on what quantity x rate actually makes, so what
  // is on screen is what gets stored and the bill sums to the amounts shown.
  const commitLineTotal = (localId) => {
    const row = rows.find((r) => r.localId === localId);
    if (!row?.itemTypeId || !row.lineTotal) return;
    const d = deriveFromTotal(row, parseFloat(row.lineTotal));
    if (!d) return;
    updateRow(localId, {
      lineTotal: String(d.exact),
      quantity: String(d.qty),
      unitPrice: String(d.rate),
    });
  };


  // Charged on the total INCLUDING sales tax, and ADDED to it -- the opposite of
  // withholding tax above, which is deducted. The server recomputes both from
  // the same table (Helpers/AdvanceTaxRates), so this is only what the operator
  // sees before saving.
  const advTaxOption = findAdvanceTax(advTaxKey);
  const advTaxResolved = advanceTaxAmount(grandTotal, advTaxOption?.rate);
  const totalWithAdvTax = grandTotal + advTaxResolved;

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
    // Never issue more than is on hand. The message next to the row carries the
    // figures; this is what actually stops the save.
    if (stockHardBlock && stockShortfall(r)) errs.push("qty exceeds stock on hand");
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

  // What a line still needs, in the words on screen. "Some required fields are
  // missing" alone sent an operator hunting: the tax-rate reason they had just
  // typed looked like the thing being refused, when the line had no amount.
  const rowProblem = (r) => {
    const errs = rowErrors(r);
    if (errs.length === 0) return null;
    const parts = [];
    if (errs.includes("itemType")) parts.push("pick an item type");
    if (errs.includes("description")) parts.push("type a description");
    const noQty = errs.includes("qty>0");
    const noPrice = errs.includes("unitPrice>0");
    if (noQty || noPrice) {
      if (r.itemTypeId && stockPricing[r.itemTypeId]?.canPrice)
        parts.push("enter the Line Total (Qty and Unit Price are worked out from stock)");
      else if (noQty && noPrice) parts.push("enter Qty and Unit Price");
      else parts.push(noQty ? "enter Qty" : "enter Unit Price");
    }
    if (errs.includes("qty exceeds stock on hand")) parts.push("it asks for more than is on hand");
    if (errs.includes("MRP>0")) parts.push("enter the MRP");
    if (errs.includes("sroSchedule")) parts.push("enter the SRO Schedule");
    if (errs.includes("sroItemNo")) parts.push("enter the SRO Item No");
    return parts.join(", ");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!selectedClientId) return setError("Select a buyer first.");
    if (!company || company.startingInvoiceNumber === 0)
      return setError("Starting bill number not set for this company. Configure it on the Companies page first.");
    if (fbrEnabled && !chosenScenario) return setError("Pick an FBR scenario first.");
    if (rateCheck.enforced.length > 0 && !rateReason.trim())
      return setError(
        `Some goods came in at a different sales tax rate than the ${gstRate}% this bill charges. ` +
        "Switch to the matching scenario, or give a reason for charging this rate.");
    if (billNumberMode === "custom" && !billNumberOk)
      return setError("Enter a bill number that isn't already in use, or switch back to Auto.");
    // Every line on a bill must be classified — an Item Type OR a Non-Inventory item.
    if (rows.some((r) => !r.itemTypeId && !r.nonInventoryItemId)) {
      return setError("Every line must have an Item Type or Non-Inventory item selected.");
    }
    // A line asking for more than is on hand is not a missing field, so it gets
    // its own message with the figures rather than being listed as "missing".
    const over = rows.map((r) => stockShortfall(r)).filter(Boolean);
    if (stockHardBlock && over.length > 0) {
      return setError(
        "Not enough stock: " +
        over.map((sf) =>
          `${sf.name} — ${sf.have.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${sf.uom} on hand, ` +
          `this bill needs ${sf.want.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${sf.uom}`
        ).join("; ") + ". Lower the amount or the quantity."
      );
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
        // null = Auto (server allocates the next number in sequence).
        invoiceNumber: billNumberPayload(billNumberMode, billNumber),
        // Withholding tax: rate-mode ships the %, fixed-amount mode ships null
        // rate + the typed amount. Backend recomputes/clamps the amount.
        withholdingTaxRate: whtMode === "rate" ? (parseFloat(whtRate) || 0) : null,
        withholdingTaxAmount: whtResolved,
        // The server recomputes the amount from this rate; it never trusts a
        // client-side money figure.
        furtherTaxRate: parseFloat(furtherTaxRate) > 0 ? parseFloat(furtherTaxRate) : null,
        advanceTaxSection: advTaxOption?.section ?? null,
        advanceTaxFilerActive: advTaxOption ? advTaxOption.filerActive : null,
        paymentTerms: paymentTerms || null,
        scenarioId: scenarioCode || null,
        // Sent only when the rates disagree; the server ignores it otherwise.
        taxRateOverrideReason: rateCheck.enforced.length > 0 ? rateReason.trim() || null : null,
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
          // Whatever the operator wrote wins. In Invoices mode this used to send
          // `r.itemTypeName || r.description`, which threw away a typed
          // description -- and any description prefilled from a sales order --
          // and replaced it with the catalog name on save. The item type's name
          // is now only a FALLBACK for a line that carries no description of its
          // own. Either way it lands on InvoiceItem.Description.
          description: r.description?.trim() || r.itemTypeName?.trim() || "",
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

  // The shared bill layout (Components/bill, utils/billEntry): numbered steps,
  // a totals panel that says where each figure comes from, and a footer that
  // lists what is left -- each item a link to its step or line.
  const selectedClient = clients.find((c) => String(c.id) === String(selectedClientId)) || null;
  const buyerRegistered = selectedClient
    ? (selectedClient.registrationType || "").toLowerCase() === "registered" : null;
  const linesVisible = (chosenScenario || !fbrEnabled) && !!selectedClientId;
  const checklist = billChecklist({
    needsScenario: fbrEnabled,
    hasScenario: !!chosenScenario,
    hasBuyer: !!selectedClientId,
    billNumberOk: !(billNumberMode === "custom" && !billNumberOk),
    rateBlock: rateBlocked ? rateBlockText({ suggestion: rateSuggestion, splitNeeded: rateSplitNeeded }) : null,
    lines: linesVisible
      ? rows.map((r, i) => ({ key: r.localId, n: i + 1, problem: rowProblem(r) })).filter((l) => l.problem)
      : [],
  });
  const totalsRows = billTotalsRows({
    subtotal, gstRate, gstAmount, taxBase, scenarioCode: chosenScenario?.code || null,
    furtherTaxRate, furtherTaxAmount, buyerRegistered, grandTotal,
    withholdingAmount: whtResolved, withholdingRate: whtMode === "rate" ? whtRate : null, balanceDue,
    advanceTaxAmount: advTaxResolved, advanceTaxSection: advTaxOption?.section,
    advanceTaxRate: advTaxOption?.rate, totalWithAdvance: totalWithAdvTax,
  });
  // Without FBR there is no scenario step, so every later step moves up one.
  const stepNo = (k) => k - (fbrEnabled ? 0 : 1);
  const money = (n) => `Rs. ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xxl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <div style={{ minWidth: 0 }}>
            <h5 style={formStyles.title}>Create Bill (No Challan)</h5>
            <div style={styles.headerSub}>
              A bill straight from stock: the goods leave inventory when you save. Each step turns green when it is complete.
            </div>
          </div>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} style={billFormShell}>
          <div style={{ ...formStyles.body, ...billFormBody }}>
            {error && <div ref={errorRef} style={styles.errorAlert}>{error}</div>}

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
                  <BillStep
                    id={BILL_ANCHORS.scenario}
                    n={1}
                    title="FBR Scenario"
                    status={!chosenScenario ? "todo" : rateBlocked ? "warn" : "done"}
                    open={scenarioPickerOpen}
                    onToggle={() => setScenarioPickerOpen((v) => !v)}
                    help="The scenario tells FBR what kind of sale this is, and fixes the sale type and GST rate of every line. Goods imported at 25% switch it to SN024 by themselves, so open this only to choose differently."
                    notice={scenarioFollow.source === "goods" && chosenScenario ? (
                      <div style={{ ...styles.scenarioAutoNote, margin: 0 }}>
                        <MdInfo size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span>
                          Set to <strong>{chosenScenario.code} ({chosenScenario.defaultRate}%)</strong> because these
                          goods came in at {chosenScenario.defaultRate}%. Goods at another rate go on a separate
                          bill. Press <strong>Change</strong> if this sale is different.
                        </span>
                      </div>
                    ) : null}
                    summary={chosenScenario ? (
                      <>
                        <span style={styles.scenarioCollapseCode}>{chosenScenario.code}</span>
                        <span>·</span>
                        <span>{chosenScenario.saleType}</span>
                        <span>·</span>
                        <span>{chosenScenario.defaultRate}% GST</span>
                        {chosenScenario.meta.buyerKind === "b2b-registered" && <span style={{ ...styles.scenarioBadge, ...styles.badgeBlue }}>Registered</span>}
                        {chosenScenario.meta.buyerKind === "b2b-unregistered" && <span style={{ ...styles.scenarioBadge, ...styles.badgeOrange }}>Unregistered</span>}
                        {chosenScenario.meta.buyerKind === "walk-in" && <span style={{ ...styles.scenarioBadge, ...styles.badgePurple }}>Walk-in</span>}
                      </>
                    ) : (
                      <span style={styles.scenarioCollapseSummaryMuted}>
                        Pick an FBR scenario to start
                      </span>
                    )}
                  >
                    <div>
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
                                  scenarioFollow.markOperatorChoice();
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
                  </BillStep>
                )}

                {/* ── Step 2: Buyer ───────────────
                    Collapsible — same shape as Step 1 but expanded by
                    default because the operator must pick a buyer. The
                    summary bar shows the selected buyer name when collapsed
                    so the screen stays tidy on subsequent steps. */}
                {(chosenScenario || !fbrEnabled) && (() => {
                  const selectedBuyer = filteredClients.find((c) => String(c.id) === String(selectedClientId));
                  return (
                    <BillStep
                      id={BILL_ANCHORS.buyer}
                      n={stepNo(2)}
                      title={buyerKind === "walk-in" ? "Walk-in Buyer" : "Buyer"}
                      status={selectedBuyer ? "done" : "todo"}
                      open={buyerOpen}
                      onToggle={() => setBuyerOpen((v) => !v)}
                      help={fbrEnabled
                        ? "Pick the customer. Only buyers that fit the scenario are listed: SN001 is for registered buyers, SN002 for unregistered ones. An unregistered buyer is also charged 4% further tax."
                        : "Pick the customer. An unregistered buyer is charged 4% further tax."}
                      summary={selectedBuyer ? (
                        <>
                          <span style={{ fontWeight: 600 }}>{selectedBuyer.name}</span>
                          {(selectedBuyer.ntn || selectedBuyer.cnic) && (
                            <span style={styles.scenarioCollapseMeta}>
                              · {selectedBuyer.ntn ? `NTN ${selectedBuyer.ntn}` : `CNIC ${selectedBuyer.cnic}`}
                            </span>
                          )}
                          {selectedBuyer.registrationType && (
                            <span style={{
                              ...styles.scenarioBadge,
                              ...((selectedBuyer.registrationType || "").toLowerCase() === "registered" ? styles.badgeBlue : styles.badgeOrange),
                            }}>
                              {selectedBuyer.registrationType}
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={styles.scenarioCollapseSummaryMuted}>Choose a buyer</span>
                      )}
                    >
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
                                  items={filteredClients.map((cl) => {
                                    // A client with neither a registration type
                                    // nor an NTN/CNIC used to read "Name (—)",
                                    // so every row in the list carried an empty
                                    // bracket. Show the bracket only when there
                                    // is something to put in it.
                                    const bits = [
                                      cl.registrationType,
                                      cl.ntn ? `NTN ${cl.ntn}` : cl.cnic ? `CNIC ${cl.cnic}` : null,
                                    ].filter(Boolean);
                                    return { ...cl, _label: bits.length ? `${cl.name} (${bits.join(" · ")})` : cl.name };
                                  })}
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
                    </BillStep>
                  );
                })()}

                {/* Steps 3-5 wait for the scenario and the buyer. They show,
                    folded, so the operator can see the whole road ahead and
                    the numbers never jump from 2 to 6. */}
                {!linesVisible && [["details", 3, "Bill Details"], ["items", 4, "Items"], ["taxes", 5, "Taxes & Total"]].map(([k, n, t]) => (
                  <BillStep
                    key={k}
                    id={BILL_ANCHORS[k]}
                    n={stepNo(n)}
                    title={t}
                    status="todo"
                    summary={<span style={styles.scenarioCollapseSummaryMuted}>
                      {fbrEnabled && !chosenScenario ? "Opens once a scenario is chosen" : "Opens when the buyer is chosen"}
                    </span>}
                  />
                ))}

                {/* ── Step 3: Bill header + items ───────────────
                    The header-fields row (Bill Date / GST / Payment Terms /
                    Doc Type / Payment Mode) is collapsible — most defaults
                    are sensible (today's date, scenario-locked GST, "Sale
                    Invoice"), so the operator can hide the row to free
                    vertical space for the items grid. The items, totals
                    and Sale-Type-locked banner stay outside the collapse. */}
                {(chosenScenario || !fbrEnabled) && selectedClientId && (
                  <>
                    <BillStep
                      id={BILL_ANCHORS.details}
                      n={stepNo(3)}
                      title="Bill Details"
                      status={billNumberMode === "custom" && !billNumberOk ? "warn" : "done"}
                      open={billHeaderOpen}
                      onToggle={() => setBillHeaderOpen((v) => !v)}
                      toggleLabel={billHeaderOpen ? "Hide" : "Edit"}
                      help="The next bill number and today's date are already filled in. Change them only when this bill needs something different."
                      summary={(
                        <>
                          <span>{billNumberMode === "custom" ? `#${billNumber || "—"}` : "Auto #"}</span>
                          <span>·</span>
                          <span>{invoiceDate || "—"}</span>
                          <span>·</span>
                          <span>{gstRate}% GST</span>
                          <span>·</span>
                          <span>{documentType === 4 ? "Sale Invoice" : documentType === 9 ? "Debit Note" : documentType === 10 ? "Credit Note" : "—"}</span>
                          {paymentMode && <><span>·</span><span>{paymentMode}</span></>}
                        </>
                      )}
                    >
                          <div style={styles.row}>
                            <div style={{ flex: 1, minWidth: 180 }}>
                              <BillNumberField
                                companyId={companyId}
                                divisionId={divisionId}
                                mode={billNumberMode}
                                onModeChange={setBillNumberMode}
                                number={billNumber}
                                onNumberChange={setBillNumber}
                                onValidityChange={setBillNumberOk}
                                disabled={saving}
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <label style={styles.label}>Bill Date</label>
                              <input type="date" style={styles.input} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                            </div>
                            <DivisionSelect companyId={companyId} value={divisionId} onChange={setDivisionId} mode="select" label={<>Division <span style={{ fontWeight: 400 }}>(optional)</span></>} labelStyle={styles.label} style={styles.input} wrapStyle={{ flex: 1, minWidth: 140 }} />
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
                    </BillStep>

                    {/* ── Step 4: Items ─────────────── */}
                    <BillStep
                      id={BILL_ANCHORS.items}
                      n={stepNo(4)}
                      title="Items"
                      status={!allRowsValid ? "todo" : rateBlocked ? "warn" : "done"}
                      summary={<span>{rows.length} line{rows.length === 1 ? "" : "s"} · {money(subtotal)} before tax</span>}
                      help={overlayOn
                        ? "Add each item the customer ordered, with the quantity and price agreed."
                        : "Find each item by name or HS code. Type the Line Total and the quantity and rate are worked out from stock at cost; with no stock on hand, type the quantity and rate. A line marked in red came in at a different sales tax rate."}
                    >
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
                        <span style={styles.itemsCount}>{rows.length} line{rows.length === 1 ? "" : "s"}</span>
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
                        {/* Sideways scroll only when the table genuinely needs
                            it. A flat 1200px floor forced a scrollbar for 32
                            unused pixels on a 1280 desktop; the OPTIONAL
                            columns (GL account, MRP, SRO) are what actually
                            make it wide, so they are what raise the floor. */}
                        <table style={{ ...styles.unifiedTable, minWidth: 900 + (glOn ? 120 : 0) + (showMRP ? 110 : 0) + (showSRO ? 240 : 0) }}>
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
                              // Pricing from stock needs BOTH a quantity and a
                              // value on hand. When the item has neither, the
                              // amount box cannot work anything out -- so the
                              // quantity and rate have to stay typeable.
                              // Locking them on the mere presence of text in
                              // the amount box left the row unfillable: the
                              // operator typed 5,000, nothing was derived, and
                              // both fields went read-only and empty.
                              const priced = stockPricing[r.itemTypeId];
                              const canDerive = !!r.itemTypeId && !!priced?.canPrice;
                              const noStock = !!r.itemTypeId && !!priced && !priced.canPrice;
                              const derivedFromAmount = canDerive && !!r.lineTotal;
                              return (
                                <tr key={r.localId} id={lineAnchor(r.localId)} style={styles.unifiedRow}>
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
                                    {/* What this item is worth, right where it
                                        was picked. Without it the operator only
                                        found out that a line could not be priced
                                        after typing an amount into a box that
                                        then did nothing. */}
                                    {canDerive && (
                                      <div style={styles.stockChipOk}>
                                        {Number(priced.availableQuantity).toLocaleString(undefined, { maximumFractionDigits: 4 })} {priced.uom || r.uom || ""} on hand
                                        {" · "}
                                        {Number(priced.unitCost).toLocaleString(undefined, { maximumFractionDigits: 4 })} each
                                        {Number(priced.availableValueExcludingTax) > 0 && (
                                          <>
                                            {" · "}
                                            <button
                                              type="button"
                                              style={styles.stockChipBtn}
                                              title={`Bill everything on hand: ${Number(priced.availableQuantity).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${priced.uom || r.uom || ""} for ${Number(priced.availableValueExcludingTax).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                              onClick={() => billAllOnHand(r.localId)}
                                            >
                                              Bill all ({Number(priced.availableValueExcludingTax).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    )}
                                    {noStock && (
                                      <div style={styles.stockChipNone}>
                                        No stock — type the quantity and rate
                                      </div>
                                    )}
                                    {(() => {
                                      // Which line the rate notice is about, right where
                                      // the item was picked.
                                      const rc = r.itemTypeId ? rateCheck.checks[r.itemTypeId] : null;
                                      if (!rc?.warning) return null;
                                      return (
                                        <div style={rc.warning.enforce ? styles.rateChipBad : styles.rateChipCheck}>
                                          {rc.mixed
                                            ? `Came in at ${rc.rates.map((x) => `${x}%`).join(" and ")}`
                                            : `Imported at ${rc.rate}%${rc.source ? ` · ${rc.source}` : ""}`}
                                        </div>
                                      );
                                    })()}
                                    {(() => {
                                      // States the two numbers the operator needs: what
                                      // they hold, and what this line would take. Saying
                                      // only "not enough stock" leaves them to work out
                                      // the amount that does fit, which is the whole
                                      // difficulty when the quantity came from an amount.
                                      const sf = stockShortfall(r);
                                      if (!sf) return null;
                                      const fits = sf.unitCost > 0
                                        ? Math.floor(sf.have) * sf.unitCost
                                        : null;
                                      return (
                                        <div style={stockHardBlock ? styles.stockChipOver : styles.stockChipWarn}>
                                          {stockHardBlock
                                            ? <>Only {sf.have.toLocaleString(undefined, { maximumFractionDigits: 2 })} {sf.uom} on hand — </>
                                            : <>Stock will go negative: {sf.have.toLocaleString(undefined, { maximumFractionDigits: 2 })} {sf.uom} on hand, </>}
                                          this line needs {sf.want.toLocaleString(undefined, { maximumFractionDigits: 2 })} {sf.uom}
                                          {" "}({sf.short.toLocaleString(undefined, { maximumFractionDigits: 2 })} short).
                                          {fits !== null && (
                                            <> At {sf.unitCost.toLocaleString(undefined, { maximumFractionDigits: 4 })} each, {stockHardBlock ? "the most you can bill in whole units is" : "what you hold is worth"}{" "}
                                              {fits.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.</>
                                          )}
                                          {Number(priced?.availableValueExcludingTax) > 0 && (
                                            <>
                                              {" "}Or{" "}
                                              <button type="button" style={styles.stockChipBtn} onClick={() => billAllOnHand(r.localId)}>
                                                bill everything on hand
                                              </button>
                                              {" "}— {closeOutQuantity(priced, r).toLocaleString(undefined, { maximumFractionDigits: 4 })} {sf.uom} for {Number(priced.availableValueExcludingTax).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, which empties the bin.
                                            </>
                                          )}
                                        </div>
                                      );
                                    })()}
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
                                    // Invoices-mode description is read-only, and it shows what
                                    // will actually be SAVED: the line's own description, falling
                                    // back to the item type's name. It used to show itemTypeName
                                    // first, which disagreed with the saved value for any line that
                                    // carried a description of its own -- one prefilled from a sales
                                    // order, for instance.
                                    const display = r.description?.trim()
                                      || r.itemTypeName
                                      || "";
                                    return (
                                      <td style={{ ...styles.unifiedTd, color: display ? colors.textPrimary : colors.textSecondary, fontStyle: display ? "normal" : "italic" }}>
                                        {display || "(pick an item type)"}
                                      </td>
                                    );
                                  })()}
                                  <td style={styles.unifiedTd}>
                                    <input
                                      type="number" min={0} step="any"
                                      style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem", ...(derivedFromAmount ? styles.derivedInput : null), minWidth: `calc(${Math.min(20, Math.max(4, String(r.quantity ?? "").length + 1))}ch + 2.4rem)` }}
                                      value={r.quantity}
                                      data-row-qty={r.localId}
                                      onChange={(e) => updateRow(r.localId, { quantity: e.target.value, lineTotal: "" })}
                                      placeholder="0"
                                      readOnly={derivedFromAmount}
                                      title={derivedFromAmount
                                        ? "Worked out from the amount. Clear the amount to type a quantity yourself."
                                        : noStock
                                          ? "Nothing on hand to price from — type the quantity here."
                                          : ""}
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
                                      type="number" min={0} step="any"
                                      style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem", ...(derivedFromAmount ? styles.derivedInput : null), minWidth: `calc(${Math.min(20, Math.max(4, String((derivedFromAmount && r.unitPrice !== "" ? String(Math.round(Number(r.unitPrice) * 10000) / 10000) : r.unitPrice) ?? "").length + 1))}ch + 2.4rem)` }}
                                      // A rate worked out from the amount carries 12 decimals so the
                                      // line multiplies back to the exact figure typed; showing all of
                                      // them read as "206.20879" cut off mid-number. Read-only then, so
                                      // the display can round without touching what is saved.
                                      value={derivedFromAmount && r.unitPrice !== ""
                                        ? String(Math.round(Number(r.unitPrice) * 10000) / 10000)
                                        : r.unitPrice}
                                      onChange={(e) => updateRow(r.localId, { unitPrice: e.target.value, lineTotal: "" })}
                                      placeholder="0.00"
                                      readOnly={derivedFromAmount}
                                      title={derivedFromAmount
                                        ? "Worked out from the amount. Clear the amount to type a rate yourself."
                                        : noStock
                                          ? "Nothing on hand to price from — type the rate here."
                                          : ""}
                                    />
                                  </td>
                                  {/* Enter the AMOUNT and the quantity follows,
                                      priced at what the stock is worth. Typing a
                                      quantity or a unit price instead clears this and
                                      the cell shows quantity x price again, so neither
                                      way is a trap.

                                      A text input with inputMode="decimal", not
                                      type="number": the browser's spinner arrows ate
                                      enough of a narrow column to make the figure
                                      unreadable, and this is a money field nobody
                                      wants to step by 0.01. */}
                                  {(() => {
                                    const price = priced;
                                    const ready = canDerive;
                                    const shown = r.lineTotal !== undefined && r.lineTotal !== ""
                                      ? r.lineTotal
                                      : (q * p ? (q * p).toFixed(2) : "");
                                    const typed = parseFloat(r.lineTotal);
                                    const overStock = ready && typed > 0
                                      && typed > Number(price.availableValueExcludingTax) + 0.005;
                                    const rateMoved = ready && typed > 0 && p > 0
                                      && Math.abs(p - Number(price.unitCost)) > 0.005;
                                    return (
                                      <td style={{ ...styles.unifiedTd, textAlign: "right" }}>
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          data-row-amount={r.localId}
                                          // Off until there is stock to price
                                          // against. An enabled box that can
                                          // never work anything out is the
                                          // dead end this replaces.
                                          disabled={!r.itemTypeId || noStock}
                                          style={{
                                            ...styles.input,
                                            padding: "0.35rem 0.5rem",
                                            fontSize: "0.92rem",
                                            fontWeight: 700,
                                            textAlign: "right",
                                            minWidth: 108,
                                            fontVariantNumeric: "tabular-nums",
                                            backgroundColor: (!r.itemTypeId || noStock) ? "#f1f3f6" : colors.inputBg,
                                            cursor: (!r.itemTypeId || noStock) ? "not-allowed" : "text",
                                            borderColor: overStock ? "#e65100" : undefined,
                                          }}
                                          value={shown}
                                          // Digits and a single decimal point only, so a
                                          // stray character cannot reach the arithmetic.
                                          onChange={(e) => {
                                            const cleaned = e.target.value
                                              .replace(/[^\d.]/g, "")
                                              .replace(/(\..*)\./g, "$1");
                                            applyLineTotal(r.localId, cleaned);
                                          }}
                                          onBlur={() => commitLineTotal(r.localId)}
                                          placeholder={!r.itemTypeId ? "pick an item" : noStock ? "n/a" : "0.00"}
                                          title={!r.itemTypeId
                                            ? "Pick an item type first — the quantity is worked out from what that stock is worth"
                                            : ready
                                              ? `Enter the amount; quantity is worked out at ${Number(price.unitCost).toLocaleString()} per ${price.uom || "unit"}`
                                              : price?.note || "Type a quantity and unit price instead"}
                                        />
                                        {/* The reason lives on the chip under the
                                            item picker; five wrapped lines of it
                                            in this narrow column only crushed the
                                            row. Here the box just reports what
                                            quantity x rate came to. */}
                                        {noStock && (
                                          <div style={{ fontSize: "0.68rem", color: colors.textSecondary, marginTop: 3, lineHeight: 1.3 }}>
                                            qty × rate
                                          </div>
                                        )}
                                        {ready && (
                                          <div style={{ fontSize: "0.7rem", color: overStock ? "#e65100" : colors.textSecondary, marginTop: 3, lineHeight: 1.3 }}>
                                            {overStock
                                              ? `only ${Number(price.availableValueExcludingTax).toLocaleString(undefined, { maximumFractionDigits: 0 })} in stock`
                                              : rateMoved
                                                ? `${q} x ${p.toLocaleString(undefined, { maximumFractionDigits: 6 })}`
                                                : `${Number(price.unitCost).toLocaleString()} each`}
                                          </div>
                                        )}
                                      </td>
                                    );
                                  })()}
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
                                        type="number" min={0} step="any"
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
                                        // FBR's own spelling, which is NOT the SRO's legal name
                                        // ("297(I)/2023-Table-I", no "SRO" prefix) -- a legal-name
                                        // example here taught operators a value FBR refuses [0077].
                                        placeholder={chosenScenario?.defaultSroScheduleNo || "FBR schedule"}
                                        title="FBR's schedule string for this scenario. Filled in for you; change it only if FBR gave these goods a different one."
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
                                        placeholder={chosenScenario?.defaultSroItemSerialNo || "serial"}
                                        title="The item's serial in that schedule. Filled with FBR's catalog default: confirm it for these goods."
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
                          <> every line needs an <b>item type</b> or a <b>non-inventory item</b> — an item type also classifies the line (HS Code / UOM / Sale Type ride along) and shows it on the Invoices tab</>
                        ) : (
                          <> <b>Description, UOM, HS Code, Sale Type</b> all auto-fill from the picked Item Type</>
                        )}
                        {showMRP && " · enter the per-unit MRP — FBR charges 3rd Schedule tax on the MRP × Qty total"}
                        {showSRO && " · SRO Schedule + Item No referenced for reduced-rate items"}
                      </p>

                      <div id={BILL_ANCHORS.rate}>
                        <TaxRateNotice
                          enforced={rateCheck.enforced}
                          advisory={rateCheck.advisory}
                          billRate={gstRate}
                          suggestion={rateSuggestion}
                          splitNeeded={rateSplitNeeded}
                          reason={rateReason}
                          onReasonChange={setRateReason}
                        />
                      </div>
                    </div>
                    </BillStep>

                    {/* ── Step 5: Taxes & total ─────────────── */}
                    <BillStep
                      id={BILL_ANCHORS.taxes}
                      n={stepNo(5)}
                      title="Taxes & Total"
                      status="done"
                      summary={<span>Grand total <strong>{money(grandTotal)}</strong></span>}
                      help="GST follows the scenario. Further tax is added for an unregistered buyer. Withholding is what the buyer deducts from your payment; advance income tax (236G / 236H) is collected on top of the bill."
                    >
                      <div style={styles.taxGrid}>
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
                              <label style={styles.label}>Withholding Tax</label>
                              <select style={styles.input} value={whtMode} onChange={(e) => setWhtMode(e.target.value)} title="Income tax withheld on top of GST — reduces the balance due, not the invoice total">
                                <option value="none">None</option>
                                <option value="rate">Rate %</option>
                                <option value="amount">Fixed amount</option>
                              </select>
                            </div>
                            <div style={{ flex: 1, minWidth: 190 }}>
                              <label style={styles.label}>Advance Income Tax</label>
                              <select
                                style={styles.input}
                                value={advTaxKey}
                                onChange={(e) => setAdvTaxKey(e.target.value)}
                                title="Advance income tax collected from the buyer under s.236G / s.236H. Charged on the amount including sales tax and added to the total. Leave as None to charge nothing."
                              >
                                <option value="">None</option>
                                {ADVANCE_TAX_OPTIONS.map((o) => (
                                  <option key={o.key} value={o.key}>{advanceTaxLabel(o)}</option>
                                ))}
                              </select>
                            </div>
                            <div style={{ flex: 1, minWidth: 120 }}>
                              <label style={styles.label}>Further Tax (%)</label>
                              <input
                                type="number" min={0} step={0.01}
                                style={styles.input}
                                value={furtherTaxRate}
                                onChange={(e) => setFurtherTaxRate(e.target.value)}
                                placeholder="0"
                                title="Further tax under s.3(1A), charged on the value excluding sales tax and ADDED to the grand total. 4% when the buyer is unregistered, none when registered; change it if this sale differs."
                              />
                            </div>
                            {whtMode === "rate" && (
                              <div style={{ flex: 1, minWidth: 120 }}>
                                <label style={styles.label}>WHT Rate (%)</label>
                                <input
                                  type="number" min={0} step={0.01}
                                  style={styles.input}
                                  value={whtRate}
                                  onChange={(e) => setWhtRate(e.target.value)}
                                  placeholder="e.g. 5.5"
                                />
                              </div>
                            )}
                            {whtMode === "amount" && (
                              <div style={{ flex: 1, minWidth: 120 }}>
                                <label style={styles.label}>WHT Amount (Rs.)</label>
                                <input
                                  type="number" min={0} step={0.01}
                                  style={styles.input}
                                  value={whtAmount}
                                  onChange={(e) => setWhtAmount(e.target.value)}
                                  placeholder="0.00"
                                />
                              </div>
                            )}
                      </div>
                      <BillTotals rows={totalsRows} />
                    </BillStep>
                  </>
                )}

                {/* Attachments — staged client-side until the bill is created,
                    then flushed against the new id (see handleSubmit). Never
                    folded away: a staged file must still be mounted to upload. */}
                <BillStep
                  id={BILL_ANCHORS.attachments}
                  n={stepNo(6)}
                  title="Attachments"
                  status="optional"
                  help="Optional: the customer's PO, a delivery note, anything to keep with this bill."
                >
                  <AttachmentManager
                    ref={attachmentRef}
                    companyId={companyId}
                    entityType="Invoice"
                    entityId={null}
                    mode="edit"
                  />
                </BillStep>
              </>
            )}
          </div>
          <div style={formStyles.footer}>
            <BillChecklist items={checklist} />
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button
              type="submit"
              style={{
                ...formStyles.button, ...formStyles.submit,
                opacity: saving || !(chosenScenario || !fbrEnabled) || !selectedClientId || !allRowsValid || !billNumberOk || rateBlocked ? 0.6 : 1,
                cursor: rateBlocked ? "not-allowed" : undefined,
              }}
              disabled={saving || !(chosenScenario || !fbrEnabled) || !selectedClientId || !allRowsValid || !billNumberOk || rateBlocked}
              title={rateBlocked ? "These goods came in at a different sales tax rate. Switch to the matching scenario, or write a reason in the red box." : undefined}
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
  headerSub: { marginTop: 2, fontSize: "0.78rem", lineHeight: 1.35, color: "rgba(255,255,255,0.88)" },
  itemsCount: { fontSize: "0.8rem", fontWeight: 600, color: colors.textSecondary },
  // The tax inputs sit above the totals they change.
  taxGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))",
    gap: "0.65rem", marginBottom: "0.85rem",
  },
  // Stock at a glance under the item picker: what is on hand and what it is
  // worth per unit, or that there is none.
  stockChipOk: {
    marginTop: 3, fontSize: "0.68rem", lineHeight: 1.3, color: "#00695c",
    fontVariantNumeric: "tabular-nums",
  },
  stockChipNone: {
    marginTop: 3, fontSize: "0.68rem", lineHeight: 1.3, color: "#8d6e00",
    fontWeight: 600,
  },
  rateChipBad: {
    marginTop: 3, fontSize: "0.68rem", lineHeight: 1.3, color: colors.danger,
    fontWeight: 600,
  },
  rateChipCheck: {
    marginTop: 3, fontSize: "0.68rem", lineHeight: 1.3, color: "#b26a00",
    fontWeight: 600,
  },
  // The scenario was set from the goods' own records, not by the operator.
  scenarioAutoNote: {
    display: "flex", gap: "0.45rem", alignItems: "flex-start",
    margin: "0.45rem 0 0", padding: "0.5rem 0.75rem",
    border: `1px solid ${colors.blue}33`, background: "#e3f2fd", borderRadius: 8,
    fontSize: "0.8rem", lineHeight: 1.4, color: colors.textPrimary,
  },
  // Qty / Unit Price worked out from the amount: visibly not a box to type in.
  derivedInput: {
    backgroundColor: "#f1f3f6", color: colors.textSecondary, cursor: "not-allowed",
    fontVariantNumeric: "tabular-nums",
  },
  stockChipWarn: {
    marginTop: 3, fontSize: "0.68rem", lineHeight: 1.35, color: "#8d6e00",
    fontWeight: 600, fontVariantNumeric: "tabular-nums",
  },
  stockChipOver: {
    marginTop: 3, fontSize: "0.68rem", lineHeight: 1.35, color: "#b3261e",
    fontWeight: 600, fontVariantNumeric: "tabular-nums",
  },
  stockChipBtn: {
    background: "none", border: "none", padding: 0, margin: 0, font: "inherit", fontWeight: 700,
    color: "#0d47a1", textDecoration: "underline", cursor: "pointer", minHeight: 24,
  },

  row: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "0.85rem 1rem", marginBottom: "1rem", alignItems: "end" },
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
  unifiedTable: { width: "100%", borderCollapse: "collapse" },   // minWidth is computed at the call site
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
