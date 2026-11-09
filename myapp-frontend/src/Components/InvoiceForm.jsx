import BillTaxTreatmentField from "./BillTaxTreatmentField";
import { defaultFurtherTaxRate } from "../utils/furtherTax";
import { useState, useEffect, useMemo, useRef } from "react";
import { MdCheck, MdInfo, MdAdd, MdPersonAdd, MdExpandMore, MdExpandLess } from "react-icons/md";
import { getPendingChallansByCompany } from "../api/challanApi";
import {
  getSalesOrdersForPicker,
  getSalesOrderChallans,
  getSalesOrderById,
} from "../api/salesOrderApi";
import SearchableSelect from "./SearchableSelect";
import SearchableClientSelect from "./SearchableClientSelect";
import ChallanBillingPicker from "./ChallanBillingPicker";
import { isBillableChallan } from "../utils/challanBilling";
import { createInvoice, getLastRatesForChallan } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getFbrApplicableScenarios } from "../api/fbrApi";
import { saveItemFbrDefaults } from "../api/lookupApi";
import { formStyles, modalSizes } from "../theme";
import { ENTRY_MODE, displayUnitPrice, lineTotalFrom, unitPriceFrom } from "../utils/lineAmount";
import LineEntryModeSwitch, { CalculatedField } from "./LineEntryModeSwitch";
import useLineEntryMode from "../hooks/useLineEntryMode";
import { todayYmd } from "../utils/dateInput";
import { usePermissions } from "../contexts/PermissionsContext";
import SmartItemAutocomplete from "./SmartItemAutocomplete";
import SearchableItemTypeSelect, { NON_HS_EMPTY_MESSAGE } from "./SearchableItemTypeSelect";
import ClientForm from "./ClientForm";
import ItemTypeForm from "./ItemTypeForm";
import PermissionLackedHint from "./PermissionLackedHint";
import BillNumberField, { billNumberPayload } from "./BillNumberField";
import DocumentTaxFields from "./DocumentTaxFields";
import FreightChargesField from "./FreightChargesField";
// 2026-05-08: Same UOM autocomplete the ChallanForm uses, hooked up
// to /lookup/units. Replaces the plain text input on each row's UOM
// cell so operators get the saved-units suggestions instead of having
// to retype "Pcs" / "KG" / etc. each line.
import LookupAutocomplete from "./LookupAutocomplete";
import AttachmentManager from "./AttachmentManager";
import useScrollToError from "../hooks/useScrollToError";
import TaxInvoiceGrouping from "./TaxInvoiceGrouping";
import DocumentNotesEditor from "./DocumentNotesEditor";

const colors = {
  blue: "var(--k-blue)",
  teal: "var(--k-teal)",
  textPrimary: "var(--k-ink)",
  textSecondary: "var(--k-muted)",
  cardBorder: "var(--k-line)",
  inputBg: "var(--k-surface-2)",
  inputBorder: "var(--k-line-strong)",
  danger: "var(--k-danger)",
  dangerLight: "var(--k-danger-bg)",
  warn: "var(--k-warn)",
  warnLight: "var(--k-warn-bg-2)",
};

// Per-scenario buyer-kind metadata. Mirrors StandaloneInvoiceForm so the
// two flows behave identically on buyer filtering. See V1.12 §9 + §10.
//   buyerKind drives the client dropdown filter:
//     "b2b-registered"   → only Registered clients
//     "b2b-unregistered" → only Unregistered clients
//     "walk-in"          → only Unregistered clients (counter sale)
//     "either"           → no buyer-type filter
const SCENARIO_META = {
  SN001: { buyerKind: "b2b-registered" },
  SN002: { buyerKind: "b2b-unregistered" },
  SN003: { buyerKind: "either" },
  SN004: { buyerKind: "either" },
  SN005: { buyerKind: "either" },
  SN006: { buyerKind: "either" },
  SN007: { buyerKind: "either" },
  SN008: { buyerKind: "either" },
  SN009: { buyerKind: "either" },
  SN010: { buyerKind: "either" },
  SN011: { buyerKind: "b2b-registered" },
  SN012: { buyerKind: "either" },
  SN013: { buyerKind: "b2b-registered" },
  SN014: { buyerKind: "b2b-registered" },
  SN015: { buyerKind: "either" },
  SN016: { buyerKind: "b2b-registered" },
  SN017: { buyerKind: "either" },
  SN018: { buyerKind: "either" },
  SN019: { buyerKind: "either" },
  SN020: { buyerKind: "either" },
  SN021: { buyerKind: "either" },
  SN022: { buyerKind: "either" },
  SN023: { buyerKind: "either" },
  SN024: { buyerKind: "either" },
  SN025: { buyerKind: "either" },
  SN026: { buyerKind: "walk-in" },
  SN027: { buyerKind: "walk-in" },
  SN028: { buyerKind: "walk-in" },
};

export default function InvoiceForm({
  companyId,
  company,
  onClose,
  onSaved,
  prefillChallanId,
  prefillSalesOrderId,
  billsMode = false,
}) {
  // Commercial bills may leave product families unclassified for the consultant.
  // Selected item types suggest filing groups without changing commercial lines.
  const { has } = usePermissions();
  const canCreateClient = has("clients.manage.create");
  const canCreateItemType = has("itemtypes.manage.create");
  const attachmentRef = useRef(null);

  const [clients, setClients] = useState([]);
  // Inline create modals — same affordances StandaloneInvoiceForm has
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddItemType, setShowAddItemType] = useState(false);
  const [, setPendingItemTypeRowId] = useState(null);
  const [allChallans, setAllChallans] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  // Lines of the selected challans NOT billed now. The server moves each to a
  // new row of its challan (same number) that stays billable.
  const [leftOutIds, setLeftOutIds] = useState([]);
  const toggleLeftOut = (id) =>
    setLeftOutIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // Optional "bill from a Sales Order" shortcut — picks the order's client and
  // pre-ticks its billable challans in the list below.
  const canUseOrders = has("salesorders.list.view");
  const [billableOrders, setBillableOrders] = useState([]);
  const [salesOrderId, setSalesOrderId] = useState("");
  const [itemPrices, setItemPrices] = useState({});
  // Amounts the operator typed per line, keyed like itemPrices. Absent means
  // "not stated" — the cell then shows quantity x rate, as it always did.
  const [itemLineTotals, setItemLineTotals] = useState({});
  const [itemDescriptions, setItemDescriptions] = useState({});
  const [commonPoDate, setCommonPoDate] = useState("");
  // Optional bill-time PO number override (blank → the bill derives its PO from
  // the linked challans). PO date reuses commonPoDate below.
  const [poNumber, setPoNumber] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [taxTreatment, setTaxTreatment] = useState("FBR");
  const outsideFbr = taxTreatment !== "FBR";
  const changeTaxTreatment = (value) => {
    setTaxTreatment(value);
    setGstRate(value === "SRB" ? 15 : value === "NoTax" ? 0 : (chosenScenario?.defaultRate ?? 18));
    setFurtherTaxRate(null);
  };
  // Further tax follows the buyer/scenario; withholding uses the company preference.
  // The operator can override either value.
  const [furtherTaxRate, setFurtherTaxRate] = useState(null);
  const [withholdingTaxRate, setWithholdingTaxRate] = useState(
    () => company?.defaultWithholdingTaxRate ?? null,
  );
  const [withholdingTaxAmount, setWithholdingTaxAmount] = useState(null);
  const [freightCharges, setFreightCharges] = useState(0);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [groupTaxInvoiceByItemType, setGroupTaxInvoiceByItemType] = useState(
    () => !!company?.defaultGroupTaxInvoiceByItemType,
  );
  useEffect(() => {
    setGroupTaxInvoiceByItemType(!!company?.defaultGroupTaxInvoiceByItemType);
  }, [companyId, company?.defaultGroupTaxInvoiceByItemType]);
  // 2026-05-12: todayYmd() returns LOCAL "YYYY-MM-DD" — pre-fix the UTC
  // slice rolled the calendar day back by one for PKT operators billing
  // before 5am.
  const [invoiceDate, setInvoiceDate] = useState(todayYmd());
  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── FBR optional fields (per item + invoice-level) ──
  // Document Type is locked to Sale Invoice (4) on the new-bill flow.
  // Credit Note (10) and Debit Note (9) get their own dedicated screens
  // — wiring them into the same form was creating workflow ambiguity
  // (different validation, different ref-bill linkage, different perms),
  // so this form is now Sale-Invoice-only.
  const documentType = 4;
  const [paymentMode, setPaymentMode] = useState("");
  const [itemHsCodes, setItemHsCodes] = useState({});
  const [itemSaleTypes, setItemSaleTypes] = useState({});
  // Overridable UOM per item (starts from challan's unit but can change when
  // user picks an FBR catalog item that has its own UOM)
  const [itemUoms, setItemUoms] = useState({});
  const [itemFbrUomIds, setItemFbrUomIds] = useState({});
  // ── Per-item ItemType (FBR catalog entry) ──
  // When the operator picks an ItemType, HS Code / UOM / Sale Type auto-fill
  // from the catalog entry — same UX as the Edit Bill form. ItemTypeId flows
  // to the backend so the bill line is permanently linked to the catalog.
  const [itemTypes, setItemTypes] = useState([]);
  const [itemTypeIds, setItemTypeIds] = useState({});

  // ── Scenario lock ─────────────────────────────────────────────
  // FBR allows only one sale type per invoice. Operator picks the
  // scenario at bill-creation time → item-type dropdown filters to
  // catalog rows with a compatible sale type → bill is structurally
  // submittable (no mixed-bucket 0052 errors). Empty selection ("auto")
  // means "infer from items" — which is allowed but only works when
  // every item happens to share the same sale type.
  const [scenarios, setScenarios] = useState([]);
  const [scenarioCode, setScenarioCode] = useState("");
  // Step 1 (FBR scenario) is collapsed by default — most bills use the
  // auto-defaulted SN001 and the operator never needs to switch. Steps 2
  // (Buyer) and 3 (Bill Details inputs row) stay expanded by default
  // since they hold required input. Same UX as StandaloneInvoiceForm.
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false);
  const [buyerOpen, setBuyerOpen] = useState(true);
  const [billHeaderOpen, setBillHeaderOpen] = useState(true);
  // Bill / Invoice number — same control and same contract as the no-challan
  // form (StandaloneInvoiceForm). "auto" sends invoiceNumber null and the
  // server allocates MAX + 1 under its per-company lock; "custom" sends the
  // typed number verbatim and billNumberOk gates Save on the field's own
  // availability check.
  const [billNumberMode, setBillNumberMode] = useState("auto");
  const [billNumber, setBillNumber] = useState("");
  const [billNumberOk, setBillNumberOk] = useState(true);

  // Bulk-apply mode — drives the "Apply same Item Type to: [All / Only empty]"
  // selector above the items grid. Saves 20+ catalog picks when every line on
  // the bill is the same FBR category.
  const [bulkApplyMode, setBulkApplyMode] = useState("all");

  // Apply one catalog ItemType to many lines in one shot. mode = "all"
  // overwrites every row; "empty" only fills rows without an Item Type.
  // Re-uses the per-row state setters so the same auto-fill logic
  // (description default, HSCode/UOM/SaleType inheritance) runs uniformly.
  const applyItemTypeToAll = (newId, picked, mode = "all") => {
    if (!newId || !picked) return;
    setItemTypeIds((prev) => {
      const next = { ...prev };
      const newHs = {},
        newSt = {};
      for (const item of allItems) {
        const id = item.id;
        if (mode === "empty" && next[id]) continue;
        next[id] = parseInt(newId);
        if (picked.hsCode) newHs[id] = picked.hsCode;
        if (picked.saleType) newSt[id] = picked.saleType;
        // Description AND UOM are intentionally NOT touched — each row keeps
        // its own challan product description + unit; Item Type only sets the
        // FBR classification (HS Code / Sale Type).
      }
      // Apply the keyed updates outside this updater so each set runs.
      setTimeout(() => {
        if (Object.keys(newHs).length) setItemHsCodes((p) => ({ ...p, ...newHs }));
        if (Object.keys(newSt).length) setItemSaleTypes((p) => ({ ...p, ...newSt }));
      }, 0);
      return next;
    });
  };

  // Bulk-clear: drop the Item Type binding (and the inherited HS Code /
  // UOM / Sale Type / FbrUOMId) on every challan-derived item row in
  // one click. Description state is also cleared so the SmartItemAutocomplete
  // falls back to the challan's original description — operator gets a
  // clean slate without losing the challan context.
  const clearAllItemTypes = () => {
    setItemTypeIds({});
    setItemHsCodes({});
    setItemSaleTypes({});
    setItemUoms({});
    setItemFbrUomIds({});
    setItemDescriptions({});
  };

  // Last-billed rate per delivery item, keyed by deliveryItemId.
  // Populated whenever a challan gets ticked (whether via the Generate-Bill
  // shortcut on the Challans page OR by the operator selecting a challan in
  // the Bills > New Bill flow). Operator can still override any row — the
  // per-row hint shows the source bill so they can spot stale rates (e.g.
  // material price has gone up since last bill).
  const [lastRates, setLastRates] = useState({});
  const [autoFilledFromHistory, setAutoFilledFromHistory] = useState(false);
  // Responsive: the wide FBR line-item table side-scrolls on a phone, so below
  // 760px each challan line renders as a tap-friendly stacked card instead.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 760,
  );
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 760);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Memo of challan ids we've already queried last-rates for, so toggling
  // the same challan on/off doesn't re-hit the API every time.
  const [fetchedRateChallanIds, setFetchedRateChallanIds] = useState(() => new Set());

  useEffect(() => {
    const load = async () => {
      try {
        const [challanRes, clientRes, typesRes, scenarioRes] = await Promise.all([
          getPendingChallansByCompany(companyId),
          getClientsByCompany(companyId),
          getItemTypes(companyId).catch(() => ({ data: [] })),
          getFbrApplicableScenarios(companyId).catch(() => ({ data: { scenarios: [] } })),
        ]);
        setAllChallans(challanRes.data);
        setClients(clientRes.data);
        setItemTypes(typesRes.data || []);
        setScenarios(scenarioRes.data?.scenarios || []);

        // Generate-Bill shortcut from the Challans page: when a challanId is
        // passed in, derive its client and pre-tick the challan. The user
        // lands directly on the items/prices step. The actual rate fetch +
        // price prefill is handled by the selectedIds-change effect below,
        // so the same code path serves both this shortcut and the regular
        // Bills > New Bill flow when the operator ticks a challan manually.
        // If the challan is no longer in the pending list (someone else
        // billed it in between) we fall back to the empty state silently.
        if (prefillChallanId) {
          const dc = challanRes.data.find((c) => c.id === prefillChallanId);
          if (dc) {
            setSelectedClientId(String(dc.clientId));
            setSelectedIds([dc.id]);
          }
        }

        // "Generate Bill" launched from the Sales Order screen: pre-tick the
        // order's billable (unbilled, including optional PO and incomplete FBR setup) challans that are in
        // the pending list, and set the client. The operator can then un-tick
        // to bill a subset — the same SO can be billed again for the rest.
        // Mirrors selectFromOrder() without depending on the billableOrders
        // list having loaded yet.
        if (prefillSalesOrderId) {
          try {
            const { data: soChallans } = await getSalesOrderChallans(prefillSalesOrderId);
            const billableIds = (soChallans || [])
              .filter((c) => isBillableChallan(c))
              .map((c) => c.id)
              .filter((cid) => challanRes.data.some((ac) => ac.id === cid));
            if (billableIds.length > 0) {
              const first = challanRes.data.find((ac) => ac.id === billableIds[0]);
              if (first) setSelectedClientId(String(first.clientId));
              setSelectedIds(billableIds);
              setSalesOrderId(String(prefillSalesOrderId));
              await seedPricesFromOrder(prefillSalesOrderId, billableIds, challanRes.data);
            }
          } catch {
            /* leave nothing pre-ticked on failure */
          }
        }
      } catch {
        setError("Failed to load data.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [companyId, prefillChallanId, prefillSalesOrderId]);

  // Whenever a challan gets newly ticked (either via the Generate-Bill
  // prefill or a manual click in the Bills > New Bill flow), fetch the
  // last-billed rate for each of its items and merge them into lastRates.
  // Pre-fill itemPrices ONLY for items the operator has not already typed
  // a price into — never overwrite manual entries. fetchedRateChallanIds
  // prevents re-fetching when the user toggles the same challan on/off.
  useEffect(() => {
    const newIds = selectedIds.filter((id) => !fetchedRateChallanIds.has(id));
    if (newIds.length === 0) return;

    let cancelled = false;
    (async () => {
      const updates = {};
      const priceUpdates = {};
      let filledAny = false;
      for (const cid of newIds) {
        try {
          const r = await getLastRatesForChallan(companyId, cid);
          (r.data || []).forEach((row) => {
            updates[row.deliveryItemId] = row;
            if (row.lastUnitPrice != null) {
              priceUpdates[row.deliveryItemId] = String(row.lastUnitPrice);
              filledAny = true;
            }
          });
        } catch {
          // Non-fatal — operator can still type prices manually.
        }
      }
      if (cancelled) return;
      setFetchedRateChallanIds((prev) => {
        const next = new Set(prev);
        newIds.forEach((id) => next.add(id));
        return next;
      });
      if (Object.keys(updates).length > 0) {
        setLastRates((prev) => ({ ...prev, ...updates }));
      }
      if (Object.keys(priceUpdates).length > 0) {
        // Only fill prices for items the operator hasn't typed into yet.
        setItemPrices((prev) => {
          const next = { ...prev };
          Object.entries(priceUpdates).forEach(([k, v]) => {
            if (!next[k]) next[k] = v;
          });
          return next;
        });
        if (filledAny) setAutoFilledFromHistory(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedIds, companyId, fetchedRateChallanIds]);

  // Decorate scenarios with local meta — same shape as StandaloneInvoiceForm.
  const enrichedScenarios = useMemo(
    () =>
      scenarios.map((s) => ({
        ...s,
        meta: SCENARIO_META[s.code] || { buyerKind: "either" },
      })),
    [scenarios],
  );

  // The chosen scenario's full record (sale type + rate + buyerKind) — drives
  // GST rate, item-type filter, AND the client dropdown filter.
  const buyerRegistrationType = clients.find(
    (c) => String(c.id) === String(selectedClientId),
  )?.registrationType;
  useEffect(() => {
    setFurtherTaxRate(
      outsideFbr ? null : defaultFurtherTaxRate(scenarioCode, buyerRegistrationType),
    );
  }, [scenarioCode, selectedClientId, buyerRegistrationType, outsideFbr]);

  const chosenScenario = useMemo(
    () =>
      outsideFbr
        ? {
            code: taxTreatment,
            defaultRate: taxTreatment === "SRB" ? 15 : 0,
            saleType: "",
            meta: { buyerKind: "either", hint: "Outside FBR" },
          }
        : enrichedScenarios.find((s) => s.code === scenarioCode) || null,
    [enrichedScenarios, scenarioCode, taxTreatment, outsideFbr],
  );

  // Item types compatible with the chosen scenario. When no scenario is
  // chosen, ALL item types are visible (pre-existing behaviour). When a
  // scenario is locked in, only items whose stored saleType matches the
  // scenario's saleType are surfaced — preventing the operator from
  // building a mixed-sale-type bill that FBR will reject with 0052.
  const filteredItemTypes = useMemo(() => {
    // Bill create is always Bill mode (2026-07-15): the operator DECLARES the
    // kind of goods shipped, so only NON-HS "product family" item types are
    // offered (e.g. "Hardware Items"). FBR classification — assigning a real
    // HS-coded type — happens later on the Invoices tab (tax-consultant role).
    return itemTypes.filter((it) => !(it.hsCode && String(it.hsCode).trim()));
  }, [itemTypes]);

  // When operator picks a scenario, snap the GST Rate to that scenario's
  // canonical rate. Field is read-only while a scenario is locked — same
  // behaviour as StandaloneInvoiceForm. Switch scenario to change rate.
  useEffect(() => {
    if (!outsideFbr && chosenScenario) setGstRate(chosenScenario.defaultRate);
  }, [chosenScenario, outsideFbr]);

  // Default to SN001 when applicable. Most operators bill registered
  // B2B at standard rate; opening on SN001 saves a click. We only set
  // it once after scenarios load AND when the form isn't already
  // showing a different value (e.g. the prefillChallanId path may
  // have its own implicit context later). If SN001 isn't applicable
  // for this company's profile, fall through to the empty / "auto-
  // detect" state.
  useEffect(() => {
    if (!scenarioCode && scenarios.length > 0) {
      const sn001 = scenarios.find((s) => s.code === "SN001");
      if (sn001) setScenarioCode("SN001");
    }
  }, [scenarios, scenarioCode]);

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

  // Filter challans for selected client, sorted by DC# descending
  const clientChallans = selectedClientId
    ? allChallans
        .filter((c) => c.clientId === parseInt(selectedClientId))
        .sort((a, b) => b.challanNumber - a.challanNumber)
    : [];

  // Reset selections when client changes
  const handleClientChange = (e) => {
    setSelectedClientId(e.target.value);
    setSelectedIds([]);
    setItemPrices({});
    setItemDescriptions({});
    setCommonPoDate("");
    setPoNumber("");
    setError("");
    // Also clear any leftover rate-history state so the warning banner and
    // per-row hints don't persist across an unrelated client.
    setLastRates({});
    setAutoFilledFromHistory(false);
    setFetchedRateChallanIds(new Set());
  };

  // Load sales orders that have ≥1 billable challan, for the "bill from a
  // Sales Order" picker (only when the user can see orders).
  useEffect(() => {
    if (!canUseOrders || !companyId) {
      setBillableOrders([]);
      return;
    }
    getSalesOrdersForPicker(companyId)
      .then((list) =>
        setBillableOrders((list || []).filter((o) => (o.billableChallanCount ?? 0) > 0)),
      )
      .catch(() => setBillableOrders([]));
  }, [companyId, canUseOrders]);

  // Pre-fill bill prices from the Sales Order's OWN line prices: for each
  // selected challan line linked to an order line that carries a UnitPrice,
  // seed that price. Operator-typed prices always win (prev spread last); the
  // last-billed-rate effect fills any line the order didn't price.
  const seedPricesFromOrder = async (soId, billableIds, challanSource) => {
    try {
      const { data: so } = await getSalesOrderById(soId);
      const priceBySoItem = {};
      (so.items || []).forEach((it) => {
        if (it.unitPrice != null && Number(it.unitPrice) > 0) priceBySoItem[it.id] = it.unitPrice;
      });
      if (Object.keys(priceBySoItem).length === 0) return;
      const seed = {};
      (challanSource || [])
        .filter((c) => billableIds.includes(c.id))
        .forEach((c) =>
          (c.items || []).forEach((it) => {
            if (it.salesOrderItemId && priceBySoItem[it.salesOrderItemId] != null)
              seed[it.id] = String(priceBySoItem[it.salesOrderItemId]);
          }),
        );
      if (Object.keys(seed).length) setItemPrices((prev) => ({ ...seed, ...prev }));
    } catch {
      /* leave prices to the last-billed effect on failure */
    }
  };

  // Pick a Sales Order → set its client and pre-tick its billable
  // (unbilled, including optional PO and incomplete FBR setup) challans that are in the pending list. The
  // existing multi-challan bill flow (price prefill, PO roll-up) then applies.
  const selectFromOrder = async (id) => {
    setSalesOrderId(id || "");
    if (!id) return;
    const o = billableOrders.find((x) => String(x.id) === String(id));
    if (!o) return;
    setSelectedClientId(String(o.clientId));
    setSelectedIds([]);
    setItemPrices({});
    setItemDescriptions({});
    setCommonPoDate("");
    setPoNumber("");
    setError("");
    setLastRates({});
    setAutoFilledFromHistory(false);
    setFetchedRateChallanIds(new Set());
    try {
      const { data } = await getSalesOrderChallans(id);
      const billable = (data || [])
        .filter((c) => isBillableChallan(c))
        .map((c) => c.id)
        .filter((cid) => allChallans.some((ac) => ac.id === cid));
      setSelectedIds(billable);
      await seedPricesFromOrder(id, billable, allChallans);
    } catch {
      /* leave nothing pre-ticked on failure */
    }
  };

  const selectedChallans = clientChallans.filter((c) => selectedIds.includes(c.id));
  const shownItems = selectedChallans.flatMap((c) =>
    c.items.map((item) => ({ ...item, challanNumber: c.challanNumber })),
  );
  // Everything below (totals, validation, the payload) is the billed lines only.
  const allItems = shownItems.filter((item) => !leftOutIds.includes(item.id));

  const subtotal = allItems.reduce((sum, item) => {
    const price = parseFloat(itemPrices[item.id]) || 0;
    const typed = parseFloat(itemLineTotals[item.id]);
    return sum + (Number.isFinite(typed) ? typed : lineTotalFrom(item.quantity, price));
  }, 0);
  const gstAmount = Math.round(((subtotal * gstRate) / 100) * 100) / 100;
  // Preview only — the server resolves further tax from its own subtotal. A
  // null rate contributes 0, so this is the same number it has always been.
  const furtherTaxAmount =
    furtherTaxRate === null || furtherTaxRate === ""
      ? 0
      : Math.round(((subtotal * (Number(furtherTaxRate) || 0)) / 100) * 100) / 100;
  const grandTotal = subtotal + gstAmount + furtherTaxAmount;
  const commercialTotal = grandTotal + (billsMode ? Number(freightCharges || 0) : 0);

  const allItemTypesValid = billsMode || allItems.every((i) => !!itemTypeIds[i.id]);
  const allPricesValid =
    allItems.length > 0 &&
    allItems.every((i) => itemPrices[i.id] && parseFloat(itemPrices[i.id]) > 0);

  // Drives the "Apply same Item Type to all" picker's displayed value so it
  // RETAINS the applied selection (was hardcoded "" → snapped back to the
  // placeholder after every pick). Resolves to the common Item Type when
  // every row shares one, and "" when rows diverge (then the operator can
  // re-pick to re-unify). Mirrors EditBillForm's bulk picker.
  const bulkCommonItemTypeId = useMemo(() => {
    if (allItems.length === 0) return "";
    const ids = allItems.map((i) => itemTypeIds[i.id] || null);
    const first = ids[0];
    return first && ids.every((x) => x === first) ? String(first) : "";
  }, [allItems, itemTypeIds]);

  // The quantity is fixed by the challan, so the operator either types the
  // unit price (the line total is worked out) or the line total (the unit
  // price is worked out); the other is read-only. Remembered for this screen.
  const [entryMode, setEntryModePref] = useLineEntryMode("bill-challan");
  const byTotal = entryMode === ENTRY_MODE.total;
  const typedTotal = (item) => {
    const price = parseFloat(itemPrices[item.id]) || 0;
    return (
      itemLineTotals[item.id] ?? (price > 0 ? String(lineTotalFrom(item.quantity, price)) : "")
    );
  };
  const shownRate = (item) => {
    const raw = itemPrices[item.id];
    if (raw === "" || raw == null) return "";
    const t = typedTotal(item);
    return displayUnitPrice(raw, Number(item.quantity), t === "" ? null : Number(t));
  };
  const shownTotal = (item) => {
    const t = typedTotal(item);
    return t === "" || !Number.isFinite(Number(t))
      ? ""
      : Number(t).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  // Flipping the mode keeps every line's figures: Line total starts from what
  // each line comes to now; Unit price trims a derived rate to the fewest
  // decimals that still reproduce that total.
  const setEntryMode = (next) => {
    if (next === ENTRY_MODE.total) {
      const seeded = {};
      for (const item of allItems) {
        const t = typedTotal(item);
        if (t !== "") seeded[item.id] = t;
      }
      setItemLineTotals(seeded);
    } else {
      setItemPrices((prev) => {
        const out = { ...prev };
        for (const item of allItems) {
          const shown = shownRate(item);
          if (shown !== "") out[item.id] = String(shown);
        }
        return out;
      });
      setItemLineTotals({});
    }
    setEntryModePref(next);
  };

  const handlePriceChange = (itemId, value) => {
    setItemPrices((prev) => ({ ...prev, [itemId]: value }));
    // The typed rate owns the line now; drop any amount the operator had
    // entered, so the two can never disagree on screen.
    setItemLineTotals((prev) => {
      if (prev[itemId] == null) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  // The operator states what the line must COME TO and the rate is derived
  // from it and the challan's quantity — which is fixed here, so this is the
  // only derivation that applies on this form. The rate carries up to 12
  // decimals (InvoiceItem.UnitPrice), so the server's own
  // `LineTotal = Quantity x UnitPrice` reproduces the typed figure rather than
  // landing a few paisa away: 220,000 over 196 units is 1122.448979591837,
  // where a 2dp rate would have billed 220,000.20.
  const handleLineTotalChange = (itemId, value, quantity) => {
    setItemLineTotals((prev) => ({ ...prev, [itemId]: value }));
    const derived = unitPriceFrom(value, quantity);
    if (derived != null) setItemPrices((prev) => ({ ...prev, [itemId]: String(derived) }));
  };

  const handleDescriptionChange = (itemId, value) => {
    setItemDescriptions((prev) => ({ ...prev, [itemId]: value }));
  };

  // Fires when user picks an item from SmartItemAutocomplete dropdown.
  // `picked` has { name, hsCode, uom, fbrUOMId, saleType, source }.
  // Auto-fills HS Code / UOM / Sale Type in one shot.
  const handleItemPick = (itemId, picked) => {
    setItemDescriptions((p) => ({ ...p, [itemId]: picked.name || p[itemId] }));
    if (picked.hsCode) setItemHsCodes((p) => ({ ...p, [itemId]: picked.hsCode }));
    if (picked.uom) setItemUoms((p) => ({ ...p, [itemId]: picked.uom }));
    if (picked.fbrUOMId) setItemFbrUomIds((p) => ({ ...p, [itemId]: picked.fbrUOMId }));
    if (picked.saleType) setItemSaleTypes((p) => ({ ...p, [itemId]: picked.saleType }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!selectedClientId) return setError("Select a client first.");
    if (selectedIds.length === 0) return setError("Select at least one challan.");
    if (!company || company.startingInvoiceNumber === 0)
      return setError(
        "Starting invoice number has not been set for this company. Please set it in the Companies page first.",
      );

    if (billNumberMode === "custom" && !billNumberOk)
      return setError("Enter a bill number that isn't already in use, or switch back to Auto.");

    const emptied = selectedChallans.find(
      (c) => c.items.length > 0 && c.items.every((i) => leftOutIds.includes(i.id)),
    );
    if (emptied)
      return setError(
        `Challan #${emptied.challanNumber}: every line is left out. Untick the challan instead.`,
      );

    const missingPrices = allItems.filter(
      (i) => !itemPrices[i.id] || parseFloat(itemPrices[i.id]) <= 0,
    );
    if (missingPrices.length > 0) return setError("Enter unit price for all items.");

    if (!allItemTypesValid) return setError("Select an Item Type for each invoice line.");

    setSaving(true);
    try {
      // Prepend the chosen scenario tag to paymentTerms so FbrService's
      // auto-detector routes the submission to the right scenarioId. The
      // tag pattern is "[SNxxx]" — see FbrService.PostInvoiceAsync.
      const paymentTermsToSave =
        !outsideFbr && scenarioCode
          ? `[${scenarioCode}] ${paymentTerms || chosenScenario?.description || ""}`.trim()
          : paymentTerms || null;

      const { data: createdInvoice } = await createInvoice({
        date: new Date(invoiceDate).toISOString(),
        companyId,
        clientId: parseInt(selectedClientId),
        gstRate: parseFloat(gstRate),
        taxTreatment,
        // null = Auto (server allocates the next number in sequence).
        invoiceNumber: billNumberPayload(billNumberMode, billNumber),
        // null, not 0 — "not selected" and "selected at zero" are different
        // things, and only null means the server charges nothing.
        furtherTaxRate:
          furtherTaxRate === null || furtherTaxRate === "" ? null : parseFloat(furtherTaxRate),
        withholdingTaxRate:
          withholdingTaxRate === null || withholdingTaxRate === ""
            ? null
            : parseFloat(withholdingTaxRate),
        withholdingTaxAmount:
          withholdingTaxAmount === null || withholdingTaxAmount === ""
            ? null
            : parseFloat(withholdingTaxAmount),
        freightCharges: billsMode ? Number(freightCharges || 0) : 0,
        groupTaxInvoiceByItemType,
        paymentTerms: paymentTermsToSave,
        notes: notes.trim() || null,
        documentType: documentType || null,
        paymentMode: paymentMode || null,
        challanIds: selectedIds,
        items: allItems.map((item) => ({
          deliveryItemId: item.id,
          unitPrice: parseFloat(itemPrices[item.id]),
          description: itemDescriptions[item.id] || item.description,
          // ItemType link (new) — when set, backend re-derives HS/SaleType from catalog
          itemTypeId: itemTypeIds[item.id] || null,
          // UOM stays the challan line's own unit (item.unit) unless the operator
          // typed an override (itemUoms). Sending it explicitly makes the backend
          // keep the challan UOM instead of substituting the Item Type's — the
          // Item Type's UOM is only applied on the Invoices tab. Empty → backend
          // falls back to the Item Type's UOM (fine when the challan had none).
          uom: (itemUoms[item.id] ?? item.unit)?.trim() || null,
          fbrUOMId: itemFbrUomIds[item.id] || null,
          hsCode: itemHsCodes[item.id]?.trim() || null,
          // Sale Type: when a scenario is locked in, EVERY line ships the
          // scenario's saleType regardless of any per-row override. Mixed-
          // saletype bills get rejected by FBR with [0052]. The per-row
          // select is only consulted in auto-detect (no scenario) mode.
          saleType: chosenScenario
            ? chosenScenario.saleType
            : itemSaleTypes[item.id]?.trim() || null,
        })),
        // Optional bill-time PO override (blank → the bill derives the PO from
        // its challans). PO date reuses commonPoDate.
        poNumber: poNumber.trim() || null,
        poDate: commonPoDate ? new Date(commonPoDate).toISOString() : null,
      });

      // ── Remember FBR defaults per item description ──
      // Next time the user invoices the same item, HS Code / Sale Type / UOM
      // will auto-fill from these saved defaults. Best-effort — don't fail the
      // overall bill creation if a save fails.
      const rememberPromises = allItems
        .filter((item) => {
          const hs = itemHsCodes[item.id]?.trim();
          const st = chosenScenario ? chosenScenario.saleType : itemSaleTypes[item.id]?.trim();
          const uom = itemUoms[item.id]?.trim();
          const fbrUom = itemFbrUomIds[item.id];
          return hs || st || uom || fbrUom;
        })
        .map((item) => {
          const name = (itemDescriptions[item.id] || item.description)?.trim();
          if (!name) return Promise.resolve();
          return saveItemFbrDefaults({
            companyId: companyId,
            name,
            hsCode: itemHsCodes[item.id]?.trim() || null,
            // Same scenario-wins precedence as the submit payload above.
            saleType: chosenScenario
              ? chosenScenario.saleType
              : itemSaleTypes[item.id]?.trim() || null,
            uom: itemUoms[item.id]?.trim() || item.unit || null,
            fbrUOMId: itemFbrUomIds[item.id] || null,
          }).catch(() => {});
        });
      await Promise.all(rememberPromises);

      // Upload any files staged before the bill had an id. Best-effort —
      // the bill is already created.
      const savedId = createdInvoice?.id;
      if (savedId) {
        try {
          await attachmentRef.current?.flush(savedId);
        } catch {
          /* attachments best-effort */
        }
      }

      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create invoice.");
    } finally {
      setSaving(false);
    }
  };

  // Clients that have at least one pending challan
  const clientsWithChallans = clients.filter((cl) =>
    allChallans.some((ch) => ch.clientId === cl.id),
  );

  // Apply the scenario's buyer-kind filter on top of the with-challan
  // filter — same logic StandaloneInvoiceForm uses.
  //   b2b-registered   → only Registered clients
  //   b2b-unregistered → only Unregistered clients
  //   walk-in          → only Unregistered clients (counter sale, rare with challans)
  //   either           → no filter
  const clientsForScenario = useMemo(() => {
    if (outsideFbr || !chosenScenario) return clientsWithChallans;
    const k = chosenScenario.meta.buyerKind;
    if (k === "b2b-registered")
      return clientsWithChallans.filter(
        (c) => (c.registrationType || "").toLowerCase() === "registered",
      );
    if (k === "b2b-unregistered" || k === "walk-in")
      return clientsWithChallans.filter(
        (c) => (c.registrationType || "").toLowerCase() !== "registered",
      );
    return clientsWithChallans;
  }, [clientsWithChallans, chosenScenario, outsideFbr]);

  // Re-fetchers for inline creates so the new buyer / item type lands
  // in the dropdowns immediately. Keep the original useEffect for first
  // load — these helpers just refresh on demand.
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

  const onClientCreated = async (created) => {
    setShowAddClient(false);
    await refreshClients();
    if (created?.id) setSelectedClientId(String(created.id));
  };

  const onItemTypeCreated = async (created) => {
    setShowAddItemType(false);
    await refreshItemTypes();
    // The "+ New Item Type" button now lives once in the items header bar
    // (not per-row), so we don't auto-stamp the new type onto a specific
    // row. The operator picks it via the per-row dropdown OR the bulk-
    // apply toolbar — explicit and undoable. created is unused here but
    // kept on the signature for parity with onClientCreated.
    setPendingItemTypeRowId(null);
  };

  // Backdrop click is a no-op — bills can hold a lot of typed data and
  // a stray click shouldn't wipe it. Dismiss via X or Cancel.
  return (
    <div data-admin-backdrop="" style={formStyles.backdrop}>
      <div
        data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.xxl}px`, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>Create Bill</h5>
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
          <div data-admin-body="" style={{ ...formStyles.body, overflowY: "auto" }}>
            <BillTaxTreatmentField
              enabled={!!company?.allowNonFbrBills}
              value={taxTreatment}
              onChange={changeTaxTreatment}
              rate={gstRate}
              onRateChange={setGstRate}
              disabled={saving}
            />
            {error && (
              <div ref={errRef} style={styles.errorAlert}>
                {error}
              </div>
            )}

            {loading ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--k-muted)" }}>
                Loading...
              </div>
            ) : (
              <>
                {/* Optional: bill from a Sales Order (bill mode). Picking one
                    sets the buyer and pre-ticks its billable challans below. */}
                {billsMode && (
                  <div
                    style={{
                      display: "flex",
                      gap: "1rem",
                      flexWrap: "wrap",
                      marginBottom: "1rem",
                      padding: "0.75rem",
                      border: `1px solid var(--k-line)`,
                      borderRadius: "var(--k-radius)",
                      background: "var(--k-surface-2)",
                    }}
                  >
                    {canUseOrders && (
                      <div style={{ flex: 2, minWidth: 240 }}>
                        <label style={styles.label}>
                          Bill from Sales Order{" "}
                          <span style={{ fontWeight: 400 }}>
                            (optional — pre-ticks its billable challans)
                          </span>
                        </label>
                        <SearchableSelect
                          items={billableOrders.map((o) => ({
                            id: o.id,
                            label: `SO #${o.salesOrderNumber} — ${o.clientName} · ${o.billableChallanCount} billable challan${o.billableChallanCount !== 1 ? "s" : ""}`,
                          }))}
                          value={salesOrderId}
                          onChange={(id) => selectFromOrder(id ? String(id) : "")}
                          labelKey="label"
                          placeholder={
                            billableOrders.length
                              ? "— not from an order —"
                              : "No sales orders with billable challans"
                          }
                        />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <label style={styles.label}>
                        PO Number <span style={{ fontWeight: 400 }}>(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={poNumber}
                        onChange={(e) => setPoNumber(e.target.value)}
                        placeholder="Optional — blank keeps challan PO"
                        style={{ ...styles.input, backgroundColor: "var(--ui-input-bg, #fff)" }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <label style={styles.label}>
                        PO Date <span style={{ fontWeight: 400 }}>(optional)</span>
                      </label>
                      <input
                        type="date"
                        value={commonPoDate}
                        onChange={(e) => setCommonPoDate(e.target.value)}
                        style={{ ...styles.input, backgroundColor: "var(--ui-input-bg, #fff)" }}
                      />
                    </div>
                  </div>
                )}
                {billsMode && (
                  <p
                    style={{
                      fontSize: "var(--k-fs-sm)",
                      color: "var(--k-muted)",
                      marginBottom: "1rem",
                    }}
                  >
                    PO details are optional. Any number or date entered here will be saved on this
                    bill and every selected challan. Blank fields keep existing challan details.
                  </p>
                )}
                {/* Step 1 — Pick FBR scenario. Collapsed by default —
                    operator sees a one-line summary of the auto-defaulted
                    scenario and can expand to switch. Auto-collapses on
                    pick so the form scrolls back into Buyer / Items.
                    Same UX as StandaloneInvoiceForm. */}
                <div style={{ marginBottom: "1rem", display: outsideFbr ? "none" : undefined }}>
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
                        {chosenScenario.meta.buyerKind === "b2b-registered" && (
                          <span style={{ ...styles.scenarioBadge, ...styles.badgeBlue }}>
                            Registered
                          </span>
                        )}
                        {chosenScenario.meta.buyerKind === "b2b-unregistered" && (
                          <span style={{ ...styles.scenarioBadge, ...styles.badgeOrange }}>
                            Unregistered
                          </span>
                        )}
                        {chosenScenario.meta.buyerKind === "walk-in" && (
                          <span style={{ ...styles.scenarioBadge, ...styles.badgePurple }}>
                            Walk-in
                          </span>
                        )}
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
                        Each scenario locks the Sale Type, GST rate, and buyer type. Only the
                        scenarios applicable to your company's profile (
                        {company?.fbrBusinessActivity || "—"} · {company?.fbrSector || "—"}) are
                        listed.
                      </p>
                      {enrichedScenarios.length === 0 ? (
                        <div style={styles.warnAlert}>
                          <MdInfo size={16} /> No FBR scenarios available. Configure Business
                          Activity and Sector on the Company before creating a bill.
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
                                  setScenarioPickerOpen(false);
                                }}
                                style={{
                                  ...styles.scenarioCard,
                                  borderColor: active ? "var(--k-blue)" : "var(--k-line)",
                                  backgroundColor: active ? "var(--k-info-bg)" : "var(--k-surface)",
                                }}
                              >
                                <div style={styles.scenarioCardHeader}>
                                  <span style={styles.scenarioCode}>{s.code}</span>
                                  {active && <MdCheck size={16} color={"var(--k-blue)"} />}
                                </div>
                                <div style={styles.scenarioSaleType}>{s.saleType}</div>
                                <div style={styles.scenarioRate}>{s.defaultRate}% GST</div>
                                <div style={styles.scenarioBadges}>
                                  {s.meta.buyerKind === "b2b-registered" && (
                                    <span style={{ ...styles.scenarioBadge, ...styles.badgeBlue }}>
                                      Registered buyer
                                    </span>
                                  )}
                                  {s.meta.buyerKind === "b2b-unregistered" && (
                                    <span
                                      style={{ ...styles.scenarioBadge, ...styles.badgeOrange }}
                                    >
                                      Unregistered buyer
                                    </span>
                                  )}
                                  {s.meta.buyerKind === "walk-in" && (
                                    <span
                                      style={{ ...styles.scenarioBadge, ...styles.badgePurple }}
                                    >
                                      Walk-in retail
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Step 2 — Pick a client. Collapsible — expanded by
                    default. Filtered by scenario.buyerKind + "has at least
                    one pending challan". Inline "+ New Buyer" button. */}
                {chosenScenario &&
                  (() => {
                    const selectedBuyer = clientsForScenario.find(
                      (c) => String(c.id) === String(selectedClientId),
                    );
                    const pendingCount = selectedBuyer
                      ? allChallans.filter((ch) => ch.clientId === selectedBuyer.id).length
                      : 0;
                    return (
                      <div style={{ marginBottom: "1.25rem" }}>
                        <button
                          type="button"
                          onClick={() => setBuyerOpen((v) => !v)}
                          style={styles.scenarioCollapseHeader}
                        >
                          <span style={styles.stepNum}>2</span>
                          <span style={styles.scenarioCollapseTitle}>
                            {chosenScenario.meta.buyerKind === "walk-in"
                              ? "Walk-in Buyer"
                              : "Buyer"}
                          </span>
                          {selectedBuyer ? (
                            <span style={styles.scenarioCollapseSummary}>
                              <span>{selectedBuyer.name}</span>
                              <span style={styles.scenarioCollapseMeta}>
                                · {pendingCount} pending DC{pendingCount !== 1 ? "s" : ""}
                              </span>
                            </span>
                          ) : (
                            <span style={styles.scenarioCollapseSummaryMuted}>Choose a buyer</span>
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
                              {clientsForScenario.length === 0 ? (
                                <div style={{ ...styles.warnAlert, flex: 1 }}>
                                  <MdInfo size={16} />
                                  No matching{" "}
                                  {chosenScenario.meta.buyerKind === "b2b-registered"
                                    ? "Registered"
                                    : chosenScenario.meta.buyerKind === "b2b-unregistered"
                                      ? "Unregistered"
                                      : chosenScenario.meta.buyerKind === "walk-in"
                                        ? "Unregistered (Walk-in)"
                                        : ""}{" "}
                                  clients with pending challans.
                                  {canCreateClient
                                    ? " Add a buyer below."
                                    : " Switch scenarios or ask an admin to add one."}
                                </div>
                              ) : (
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  {/* The pending-DC count stays part of each buyer's name, as it was in the old <select>. */}
                                  <SearchableClientSelect
                                    clients={clientsForScenario.map((cl) => {
                                      const count = allChallans.filter(
                                        (ch) => ch.clientId === cl.id,
                                      ).length;
                                      return {
                                        ...cl,
                                        name: `${cl.name} (${count} pending DC${count !== 1 ? "s" : ""})`,
                                      };
                                    })}
                                    value={selectedClientId}
                                    onChange={(id) =>
                                      handleClientChange({ target: { value: String(id) } })
                                    }
                                    placeholder="— Choose a buyer —"
                                    ariaLabel="Buyer"
                                  />
                                </div>
                              )}
                              {canCreateClient ? (
                                <button
                                  type="button"
                                  className="k-btn k-btn--secondary k-btn--sm"
                                  onClick={() => setShowAddClient(true)}
                                  title="Create a new buyer without leaving this form"
                                >
                                  <MdPersonAdd size={14} /> New Buyer
                                </button>
                              ) : (
                                <PermissionLackedHint
                                  perm="clients.manage.create"
                                  what="add a new buyer"
                                />
                              )}
                            </div>
                            {company && company.startingInvoiceNumber === 0 && (
                              <div
                                style={{
                                  ...styles.errorAlert,
                                  marginTop: "0.5rem",
                                  marginBottom: 0,
                                }}
                              >
                                Starting bill number not set for this company. Please configure it
                                in the Companies page.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                {/* Step 3 — Bill details (collapsible inputs row) +
                    DC selection + items. Same UX as StandaloneInvoiceForm:
                    the inputs row is collapsible (default open) so the
                    operator can free vertical space for the items grid. */}
                {chosenScenario && selectedClientId && company?.startingInvoiceNumber > 0 && (
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
                          <span>
                            {billNumberMode === "custom" ? `#${billNumber || "—"}` : "Auto #"}
                          </span>
                          <span>·</span>
                          <span>{invoiceDate || "—"}</span>
                          <span>·</span>
                          <span>
                            {gstRate}% {outsideFbr ? "SRB / non-FBR tax" : "GST"}
                          </span>
                          <span>·</span>
                          <span>
                            {documentType === 4
                              ? "Sale Invoice"
                              : documentType === 9
                                ? "Debit Note"
                                : documentType === 10
                                  ? "Credit Note"
                                  : "—"}
                          </span>
                          {paymentMode && (
                            <>
                              <span>·</span>
                              <span>{paymentMode}</span>
                            </>
                          )}
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
                          <div data-admin-form-row="" style={styles.row}>
                            <div style={{ flex: 1, minWidth: 180 }}>
                              <BillNumberField
                                companyId={companyId}
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
                              <input
                                type="date"
                                style={styles.input}
                                value={invoiceDate}
                                onChange={(e) => setInvoiceDate(e.target.value)}
                              />
                            </div>
                            <div
                              style={{
                                display: outsideFbr ? "none" : undefined,
                                flex: 1,
                                minWidth: 100,
                              }}
                            >
                              <label style={{ ...styles.label, whiteSpace: "nowrap" }}>
                                {outsideFbr ? "Tax rate (%)" : "GST Rate (%)"}
                                {chosenScenario && (
                                  <span
                                    style={styles.lockedTag}
                                    title={`Locked by ${chosenScenario.code}`}
                                  >
                                    🔒 locked
                                  </span>
                                )}
                              </label>
                              <input
                                type="number"
                                style={{
                                  ...styles.input,
                                  backgroundColor: chosenScenario ? "#eef5ff" : "var(--k-input-bg)",
                                  cursor: chosenScenario ? "not-allowed" : "text",
                                }}
                                value={gstRate}
                                onChange={(e) => setGstRate(e.target.value)}
                                readOnly={!!chosenScenario}
                                title={
                                  chosenScenario
                                    ? `Locked by ${chosenScenario.code}. Switch scenario to change.`
                                    : ""
                                }
                                min={0}
                                max={100}
                                step={0.5}
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <label style={styles.label}>Payment Terms</label>
                              <input
                                type="text"
                                style={styles.input}
                                value={paymentTerms}
                                onChange={(e) => setPaymentTerms(e.target.value)}
                                placeholder="Optional"
                              />
                            </div>
                            <div
                              style={{
                                display: outsideFbr ? "none" : undefined,
                                flex: 1,
                                minWidth: 140,
                              }}
                            >
                              <label style={styles.label}>
                                Document Type <span style={styles.optionalTag}>FBR</span>
                              </label>
                              <input
                                type="text"
                                style={{
                                  ...styles.input,
                                  backgroundColor: "var(--k-surface-3)",
                                  cursor: "not-allowed",
                                }}
                                value="Sale Invoice"
                                readOnly
                                title="This screen creates Sale Invoices only. Credit / Debit Notes will get their own dedicated screens."
                              />
                            </div>
                            <div
                              style={{
                                display: outsideFbr ? "none" : undefined,
                                flex: 1,
                                minWidth: 140,
                              }}
                            >
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
                        </div>
                      )}
                    </div>

                    <ChallanBillingPicker
                      key={selectedClientId}
                      challans={clientChallans}
                      selectedIds={selectedIds}
                      onChange={setSelectedIds}
                    />

                    {/* Scenario-locked Sale Type banner — same affordance
                        as StandaloneInvoiceForm so the operator can see at
                        a glance which sale type every item line will end
                        up with. Hidden when no scenario is picked
                        (auto-detect mode). */}
                    {!outsideFbr && chosenScenario && (
                      <div style={styles.lockedSaleType}>
                        <span style={styles.lockedSaleTypeIcon}>🔒</span>
                        <span>
                          <b>Sale Type locked:</b> {chosenScenario.saleType}
                        </span>
                        <span style={styles.lockedSaleTypeHint}>
                          (every item below uses this — required by {chosenScenario.code})
                        </span>
                      </div>
                    )}

                    {/* Items - unified single-row table (same layout as Edit Bill) */}
                    {shownItems.length > 0 && (
                      <div>
                        <div style={styles.itemsHeaderBar}>
                          <label style={{ ...styles.label, margin: 0 }}>
                            Items (
                            {allItems.length === shownItems.length
                              ? allItems.length
                              : `${allItems.length} of ${shownItems.length} billed`}
                            )
                            <span style={styles.leaveOutHint}>
                              {" "}
                              — untick a line to bill it later; it stays on its challan as pending
                            </span>
                          </label>
                          <div
                            style={{
                              display: "flex",
                              gap: "0.5rem",
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <LineEntryModeSwitch mode={entryMode} onChange={setEntryMode} />
                            {/* Bills mode hides all item-type-management
                                controls — the catalog "+ New Item Type"
                                button, the FBR-tip pill. Operators classify
                                items on the Invoices tab; the Bills tab is
                                financial entry only. */}
                            {/* 2026-05-13: previously hidden when billsMode
                                was true (Bills tab). Operators asked for
                                the shortcut on every bill-creation flow,
                                so it's now visible in both Bills and
                                Invoices modes. Permission is still
                                checked — no perm → PermissionLackedHint. */}
                            {canCreateItemType ? (
                              <button
                                type="button"
                                className="k-btn k-btn--secondary k-btn--sm"
                                onClick={() => setShowAddItemType(true)}
                                title="Add a new item type to your catalog"
                              >
                                <MdAdd size={14} /> New Item Type
                              </button>
                            ) : (
                              <PermissionLackedHint
                                inline
                                perm="itemtypes.manage.create"
                                what="add a new item type"
                              />
                            )}
                            {!billsMode && (
                              <div style={styles.hintRow}>
                                <span style={styles.hintPill}>Tip</span>
                                Pick from <b>SAVED</b> (remembered defaults) or <b>FBR catalog</b>{" "}
                                to auto-fill HS Code & UOM.
                              </div>
                            )}
                          </div>
                        </div>

                        {autoFilledFromHistory && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "0.5rem",
                              padding: "0.55rem 0.85rem",
                              marginBottom: "0.5rem",
                              backgroundColor: "var(--k-warn-bg-2)",
                              border: "1px solid #ffcc80",
                              borderRadius: "var(--k-radius)",
                              fontSize: "var(--k-fs-sm)",
                              color: "#bf360c",
                            }}
                          >
                            <span
                              style={{ fontSize: "var(--k-fs-md)", lineHeight: 1 }}
                              aria-hidden="true"
                            >
                              ⚠
                            </span>
                            <div>
                              <b>Rates pre-filled from last bill.</b> Verify each unit price below —
                              material prices may have changed since the previous order. Override
                              any row that needs a new rate.
                            </div>
                          </div>
                        )}

                        {/* Bulk Item Type apply — single dropdown sets the
                            same catalog row across all lines. Saves 20+
                            picks when every item on the bill is the same
                            FBR category. Shown in both modes now that Item
                            Type is optional on a commercial bill. */}
                        {allItems.length > 1 && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.65rem",
                              flexWrap: "wrap",
                              padding: "0.55rem 0.85rem",
                              marginBottom: "0.5rem",
                              borderRadius: "var(--k-radius)",
                              border: `1px solid var(--k-line)`,
                              backgroundColor: "var(--k-surface-2)",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "var(--k-fs-sm)",
                                color: "var(--k-ink)",
                                fontWeight: 500,
                              }}
                            >
                              Apply same Item Type to:
                            </span>
                            <select
                              value={bulkApplyMode}
                              onChange={(e) => setBulkApplyMode(e.target.value)}
                              style={{
                                ...styles.input,
                                padding: "0.3rem 0.5rem",
                                fontSize: "var(--k-fs-sm)",
                                maxWidth: 180,
                              }}
                            >
                              <option value="all">All {allItems.length} rows</option>
                              <option value="empty">Only empty rows</option>
                            </select>
                            <div style={{ flex: "1 1 220px", maxWidth: 280 }}>
                              <SearchableItemTypeSelect
                                items={filteredItemTypes}
                                emptyMessage={NON_HS_EMPTY_MESSAGE}
                                value={bulkCommonItemTypeId}
                                onChange={(newId, picked) => {
                                  if (!newId || !picked) return;
                                  applyItemTypeToAll(parseInt(newId), picked, bulkApplyMode);
                                }}
                                placeholder={
                                  bulkApplyMode === "all"
                                    ? "— pick to apply to all —"
                                    : "— pick to fill empty rows —"
                                }
                                style={{ padding: "0.3rem 0.5rem", fontSize: "var(--k-fs-xs)" }}
                              />
                            </div>
                            {/* Clear all — drops the Item Type binding (+ HS
                                / UOM / SaleType / Description) on every
                                row. Disabled until at least one row carries
                                an Item Type so the button never offers a
                                no-op. */}
                            <button
                              type="button"
                              className="k-btn k-btn--danger k-btn--sm"
                              onClick={clearAllItemTypes}
                              disabled={!Object.values(itemTypeIds).some(Boolean)}
                              title="Drop the Item Type binding from every row"
                            >
                              Clear all
                            </button>
                          </div>
                        )}

                        {isNarrow ? (
                          <div style={styles.mcards}>
                            {shownItems.map((item) => {
                              const displayUom = itemUoms[item.id] ?? item.unit;
                              const out = leftOutIds.includes(item.id);
                              return (
                                <div
                                  key={item.id}
                                  style={{ ...styles.mcard, ...(out ? styles.leftOutRow : null) }}
                                >
                                  <div style={styles.mcardHead}>
                                    <label style={styles.billTick}>
                                      <input
                                        type="checkbox"
                                        checked={!out}
                                        onChange={() => toggleLeftOut(item.id)}
                                        aria-label={`Bill ${item.description} now`}
                                      />
                                      {out ? "Later" : "Bill"}
                                    </label>
                                    <span style={styles.mdc}>DC #{item.challanNumber}</span>
                                    <div style={{ flex: 1, minWidth: 160 }}>
                                      <SearchableItemTypeSelect
                                        items={filteredItemTypes}
                                        emptyMessage={NON_HS_EMPTY_MESSAGE}
                                        value={itemTypeIds[item.id] || ""}
                                        onChange={(newId, picked) => {
                                          setItemTypeIds((p) => ({
                                            ...p,
                                            [item.id]: newId ? parseInt(newId) : null,
                                          }));
                                          if (picked) {
                                            if (picked.hsCode)
                                              setItemHsCodes((p) => ({
                                                ...p,
                                                [item.id]: picked.hsCode,
                                              }));
                                            if (picked.saleType)
                                              setItemSaleTypes((p) => ({
                                                ...p,
                                                [item.id]: picked.saleType,
                                              }));
                                          } else {
                                            setItemHsCodes((p) => ({ ...p, [item.id]: "" }));
                                            setItemSaleTypes((p) => ({ ...p, [item.id]: "" }));
                                          }
                                        }}
                                        placeholder={
                                          billsMode ? "Item type (optional)…" : "Pick item… *"
                                        }
                                        style={{
                                          padding: "0.4rem 0.55rem",
                                          fontSize: "var(--k-fs-sm)",
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <div style={{ marginBottom: "0.4rem" }}>
                                    <label style={styles.mlabel}>Description</label>
                                    <SmartItemAutocomplete
                                      companyId={companyId}
                                      value={itemDescriptions[item.id] ?? item.description}
                                      onChange={(v) => handleDescriptionChange(item.id, v)}
                                      onPick={(picked) => handleItemPick(item.id, picked)}
                                      style={{
                                        ...styles.input,
                                        padding: "0.5rem 0.6rem",
                                        fontSize: "var(--k-fs-base)",
                                      }}
                                      placeholder="Search or type item…"
                                    />
                                  </div>
                                  <div style={styles.mgrid3}>
                                    <div>
                                      <label style={styles.mlabel}>Qty</label>
                                      <div
                                        style={{
                                          padding: "0.5rem 0",
                                          fontSize: "var(--k-fs-base)",
                                          textAlign: "right",
                                          fontWeight: 600,
                                        }}
                                      >
                                        {parseFloat(
                                          Number(item.quantity || 0).toFixed(4),
                                        ).toString()}
                                      </div>
                                    </div>
                                    <div>
                                      <label style={styles.mlabel}>UOM</label>
                                      <LookupAutocomplete
                                        companyId={companyId}
                                        endpoint="/lookup/units"
                                        value={displayUom || ""}
                                        onChange={(val) =>
                                          setItemUoms((p) => ({ ...p, [item.id]: val }))
                                        }
                                      />
                                    </div>
                                    <div>
                                      <label style={styles.mlabel}>Unit Price *</label>
                                      {byTotal ? (
                                        <CalculatedField
                                          label="Unit price"
                                          value={shownRate(item)}
                                        />
                                      ) : (
                                        <input
                                          type="number"
                                          min={0}
                                          step="any"
                                          style={{
                                            ...styles.input,
                                            padding: "0.5rem 0.55rem",
                                            fontSize: "var(--k-fs-base)",
                                            textAlign: "right",
                                          }}
                                          value={itemPrices[item.id] || ""}
                                          onChange={(e) =>
                                            handlePriceChange(item.id, e.target.value)
                                          }
                                          placeholder="0.00"
                                        />
                                      )}
                                      {lastRates[item.id]?.lastUnitPrice != null && (
                                        <div
                                          style={{
                                            fontSize: "var(--k-fs-2xs)",
                                            marginTop: 2,
                                            lineHeight: 1.2,
                                            color:
                                              parseFloat(itemPrices[item.id]) ===
                                              parseFloat(lastRates[item.id].lastUnitPrice)
                                                ? "var(--k-muted)"
                                                : "var(--k-success)",
                                          }}
                                          title={
                                            `Last billed Rs. ${Number(lastRates[item.id].lastUnitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}` +
                                            ` on bill #${lastRates[item.id].lastInvoiceNumber}` +
                                            (lastRates[item.id].lastInvoiceDate
                                              ? ` (${new Date(lastRates[item.id].lastInvoiceDate).toLocaleDateString()})`
                                              : "") +
                                            ` — matched by ${lastRates[item.id].matchedBy}`
                                          }
                                        >
                                          Last Rs.
                                          {Number(lastRates[item.id].lastUnitPrice).toLocaleString(
                                            undefined,
                                            { minimumFractionDigits: 2 },
                                          )}
                                          {lastRates[item.id].lastInvoiceDate && (
                                            <> · #{lastRates[item.id].lastInvoiceNumber}</>
                                          )}
                                          {parseFloat(itemPrices[item.id]) !==
                                            parseFloat(lastRates[item.id].lastUnitPrice) && (
                                            <>
                                              {" "}
                                              · <b>edited</b>
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {!billsMode && (
                                    <div style={styles.mkv}>
                                      <span style={styles.mlabel}>HS Code</span>
                                      <span
                                        style={{
                                          fontFamily: "monospace",
                                          fontSize: "var(--k-fs-sm)",
                                          color: itemHsCodes[item.id]
                                            ? "var(--k-ink)"
                                            : "var(--k-muted)",
                                          fontStyle: itemHsCodes[item.id] ? "normal" : "italic",
                                        }}
                                        title="HS Code auto-fills from the picked Item Type"
                                      >
                                        {itemHsCodes[item.id] || "—"}
                                      </span>
                                    </div>
                                  )}
                                  {!billsMode && (
                                    <div style={{ marginTop: "0.4rem" }}>
                                      <label style={styles.mlabel}>Sale Type</label>
                                      {chosenScenario ? (
                                        <input
                                          type="text"
                                          readOnly
                                          value={chosenScenario.saleType}
                                          style={{
                                            ...styles.input,
                                            padding: "0.5rem 0.55rem",
                                            fontSize: "var(--k-fs-base)",
                                            backgroundColor: "var(--k-surface-3)",
                                            cursor: "not-allowed",
                                          }}
                                          title={`Locked by ${chosenScenario.code}`}
                                        />
                                      ) : (
                                        <select
                                          style={{
                                            ...styles.input,
                                            padding: "0.5rem 0.55rem",
                                            fontSize: "var(--k-fs-base)",
                                          }}
                                          value={itemSaleTypes[item.id] || ""}
                                          onChange={(e) =>
                                            setItemSaleTypes((p) => ({
                                              ...p,
                                              [item.id]: e.target.value,
                                            }))
                                          }
                                        >
                                          <option value="">— select —</option>
                                          <option>Goods at standard rate (default)</option>
                                          <option>Goods at Reduced Rate</option>
                                          <option>Goods at zero-rate</option>
                                          <option>Exempt goods</option>
                                          <option>3rd Schedule Goods</option>
                                          <option>Services</option>
                                          <option>Services (FED in ST Mode)</option>
                                          <option>Goods (FED in ST Mode)</option>
                                          <option>Steel Melting and re-rolling</option>
                                          <option>Toll Manufacturing</option>
                                          <option>Mobile Phones</option>
                                          <option>Petroleum Products</option>
                                          <option>Electric Vehicle</option>
                                          <option>Cement /Concrete Block</option>
                                          <option>Processing/Conversion of Goods</option>
                                          <option>Cotton Ginners</option>
                                          <option>Non-Adjustable Supplies</option>
                                        </select>
                                      )}
                                    </div>
                                  )}
                                  <div style={styles.mamt}>
                                    <span style={styles.mlabel}>Line Total</span>
                                    {byTotal ? (
                                      <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        aria-label="Line total"
                                        style={{
                                          ...styles.input,
                                          padding: "0.5rem 0.55rem",
                                          fontSize: "var(--k-fs-base)",
                                          textAlign: "right",
                                          fontWeight: 700,
                                          maxWidth: 150,
                                        }}
                                        value={typedTotal(item)}
                                        onChange={(e) =>
                                          handleLineTotalChange(
                                            item.id,
                                            e.target.value,
                                            item.quantity,
                                          )
                                        }
                                        placeholder="0.00"
                                        title="Type the amount this line must come to — the unit price is worked out from it and the challan quantity."
                                      />
                                    ) : (
                                      <CalculatedField
                                        label="Line total"
                                        value={shownTotal(item)}
                                        style={{ maxWidth: 150, fontWeight: 700 }}
                                      />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div data-admin-table-region="" style={styles.unifiedTableWrap}>
                            <table style={styles.unifiedTable}>
                              <thead>
                                <tr style={styles.unifiedThead}>
                                  <th style={{ ...styles.unifiedTh, width: "6%" }}>Bill · DC#</th>
                                  {/* Optional Item Type helps the
                                    invoice can group by it — shown in both
                                    Bills and Invoices modes. */}
                                  <th style={{ ...styles.unifiedTh, width: "14%" }}>
                                    Item Type {billsMode ? "(optional)" : "*"}
                                  </th>
                                  <th style={{ ...styles.unifiedTh, width: "16%" }}>Description</th>
                                  <th style={{ ...styles.unifiedTh, width: "9%" }}>Qty</th>
                                  <th style={{ ...styles.unifiedTh, width: "8%" }}>UOM</th>
                                  <th style={{ ...styles.unifiedTh, width: "8%" }}>Unit Price *</th>
                                  <th style={{ ...styles.unifiedTh, width: "9%" }}>Line Total</th>
                                  {/* HS Code is FBR data — only relevant on the
                                    Invoices tab. Bills mode is pre-FBR data
                                    entry, so hide it. */}
                                  {!billsMode && (
                                    <th style={{ ...styles.unifiedTh, width: "10%" }}>HS Code</th>
                                  )}
                                  {/* Sale Type is FBR-only data — same gating as Item Type / HS Code.
                                    2026-05-08: was visible in both modes, which broke the symmetry
                                    with EditBillForm's Bills view. */}
                                  {!billsMode && (
                                    <th style={{ ...styles.unifiedTh, width: "22%" }}>Sale Type</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {shownItems.map((item) => {
                                  const displayUom = itemUoms[item.id] ?? item.unit;
                                  const out = leftOutIds.includes(item.id);
                                  return (
                                    <tr
                                      key={item.id}
                                      style={{
                                        ...styles.unifiedRow,
                                        ...(out ? styles.leftOutRow : null),
                                      }}
                                    >
                                      <td
                                        style={{
                                          ...styles.unifiedTd,
                                          fontSize: "var(--k-fs-xs)",
                                          color: "var(--k-muted)",
                                        }}
                                      >
                                        <label
                                          style={styles.billTickCell}
                                          title={
                                            out
                                              ? "Left out: billed later"
                                              : "Billed now: untick to bill this line later"
                                          }
                                        >
                                          <input
                                            type="checkbox"
                                            checked={!out}
                                            onChange={() => toggleLeftOut(item.id)}
                                            aria-label={`Bill ${item.description} now`}
                                          />
                                          <span>{item.challanNumber}</span>
                                        </label>
                                      </td>
                                      <td style={styles.unifiedTd}>
                                        {/* Picking an ItemType auto-fills HS Code, UOM, SaleType,
                                          FbrUOMId on this row — identical behaviour to EditBillForm.
                                          The '+ New Item Type' affordance lives once above the grid
                                          (was per-row before — moved to declutter the table). */}
                                        <SearchableItemTypeSelect
                                          items={filteredItemTypes}
                                          emptyMessage={NON_HS_EMPTY_MESSAGE}
                                          value={itemTypeIds[item.id] || ""}
                                          onChange={(newId, picked) => {
                                            setItemTypeIds((p) => ({
                                              ...p,
                                              [item.id]: newId ? parseInt(newId) : null,
                                            }));
                                            if (picked) {
                                              // Picking an ItemType binds the FBR classification fields
                                              // (HS Code, Sale Type). It deliberately does NOT touch the
                                              // Description or the UOM — those stay the challan line's own
                                              // values (the physical delivery). The Item Type's UOM is
                                              // applied later on the Invoices tab, not here. If the challan
                                              // line carries no UOM, the backend falls back to the Item
                                              // Type's UOM on save (no issue).
                                              if (picked.hsCode)
                                                setItemHsCodes((p) => ({
                                                  ...p,
                                                  [item.id]: picked.hsCode,
                                                }));
                                              if (picked.saleType)
                                                setItemSaleTypes((p) => ({
                                                  ...p,
                                                  [item.id]: picked.saleType,
                                                }));
                                            } else {
                                              // Clearing the ItemType clears the HS Code + Sale Type it
                                              // inherited. Description AND UOM are left as-is — they're
                                              // the challan line's own values, not the Item Type's, so
                                              // removing the classification must not wipe them.
                                              setItemHsCodes((p) => ({ ...p, [item.id]: "" }));
                                              setItemSaleTypes((p) => ({ ...p, [item.id]: "" }));
                                            }
                                          }}
                                          placeholder={
                                            billsMode ? "Item type (optional)…" : "Pick item… *"
                                          }
                                          style={{
                                            padding: "0.3rem 0.5rem",
                                            fontSize: "var(--k-fs-xs)",
                                          }}
                                        />
                                      </td>
                                      <td style={styles.unifiedTd}>
                                        {/* Description stays the challan line's own product
                                          description and remains editable regardless of the picked
                                          Item Type. Item Type is only the FBR classification bucket —
                                          it never overwrites or locks the description. The challan's
                                          original description seeds the field via `?? item.description`. */}
                                        <SmartItemAutocomplete
                                          companyId={companyId}
                                          value={itemDescriptions[item.id] ?? item.description}
                                          onChange={(v) => handleDescriptionChange(item.id, v)}
                                          onPick={(picked) => handleItemPick(item.id, picked)}
                                          style={{
                                            ...styles.input,
                                            padding: "0.3rem 0.5rem",
                                            fontSize: "var(--k-fs-sm)",
                                          }}
                                          placeholder="Search or type item…"
                                        />
                                      </td>
                                      <td
                                        style={{
                                          ...styles.unifiedTd,
                                          textAlign: "right",
                                          fontSize: "var(--k-fs-sm)",
                                          paddingRight: "0.5rem",
                                        }}
                                      >
                                        {/* Strip trailing zeros so 1.0000 → "1",
                                          12.5000 → "12.5", 0.0004 → "0.0004". */}
                                        {parseFloat(
                                          Number(item.quantity || 0).toFixed(4),
                                        ).toString()}
                                      </td>
                                      <td style={styles.unifiedTd}>
                                        {/* UOM autocomplete (same backing endpoint
                                          as ChallanForm). Pre-fix this was a plain
                                          text input — operators had to retype
                                          "Pcs" / "KG" each row instead of picking
                                          from the saved-units list. */}
                                        <LookupAutocomplete
                                          companyId={companyId}
                                          endpoint="/lookup/units"
                                          value={displayUom || ""}
                                          onChange={(val) =>
                                            setItemUoms((p) => ({ ...p, [item.id]: val }))
                                          }
                                        />
                                      </td>
                                      <td style={styles.unifiedTd}>
                                        {byTotal ? (
                                          <CalculatedField
                                            label="Unit price"
                                            value={shownRate(item)}
                                            style={{
                                              fontSize: "var(--k-fs-sm)",
                                              minHeight: 32,
                                              padding: "0.3rem 0.5rem",
                                            }}
                                          />
                                        ) : (
                                          <input
                                            type="number"
                                            min={0}
                                            step="any"
                                            style={{
                                              ...styles.input,
                                              padding: "0.3rem 0.5rem",
                                              fontSize: "var(--k-fs-sm)",
                                            }}
                                            value={itemPrices[item.id] || ""}
                                            onChange={(e) =>
                                              handlePriceChange(item.id, e.target.value)
                                            }
                                            placeholder="0.00"
                                          />
                                        )}
                                        {lastRates[item.id]?.lastUnitPrice != null && (
                                          <div
                                            style={{
                                              fontSize: "var(--k-fs-2xs)",
                                              marginTop: 2,
                                              lineHeight: 1.2,
                                              whiteSpace: "nowrap",
                                              color:
                                                parseFloat(itemPrices[item.id]) ===
                                                parseFloat(lastRates[item.id].lastUnitPrice)
                                                  ? "var(--k-muted)"
                                                  : "var(--k-success)",
                                            }}
                                            title={
                                              `Last billed Rs. ${Number(lastRates[item.id].lastUnitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}` +
                                              ` on bill #${lastRates[item.id].lastInvoiceNumber}` +
                                              (lastRates[item.id].lastInvoiceDate
                                                ? ` (${new Date(lastRates[item.id].lastInvoiceDate).toLocaleDateString()})`
                                                : "") +
                                              ` — matched by ${lastRates[item.id].matchedBy}`
                                            }
                                          >
                                            Last Rs.
                                            {Number(
                                              lastRates[item.id].lastUnitPrice,
                                            ).toLocaleString(undefined, {
                                              minimumFractionDigits: 2,
                                            })}
                                            {lastRates[item.id].lastInvoiceDate && (
                                              <> · #{lastRates[item.id].lastInvoiceNumber}</>
                                            )}
                                            {parseFloat(itemPrices[item.id]) !==
                                              parseFloat(lastRates[item.id].lastUnitPrice) && (
                                              <>
                                                {" "}
                                                · <b>edited</b>
                                              </>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                      <td
                                        style={{
                                          ...styles.unifiedTd,
                                          textAlign: "right",
                                          fontWeight: 600,
                                          fontSize: "var(--k-fs-sm)",
                                        }}
                                      >
                                        {byTotal ? (
                                          <input
                                            type="number"
                                            min={0}
                                            step="any"
                                            aria-label="Line total"
                                            style={{
                                              ...styles.input,
                                              padding: "0.3rem 0.5rem",
                                              fontSize: "var(--k-fs-sm)",
                                              textAlign: "right",
                                              fontWeight: 600,
                                            }}
                                            value={typedTotal(item)}
                                            onChange={(e) =>
                                              handleLineTotalChange(
                                                item.id,
                                                e.target.value,
                                                item.quantity,
                                              )
                                            }
                                            placeholder="0.00"
                                            title="Type the amount this line must come to — the unit price is worked out from it and the challan quantity."
                                          />
                                        ) : (
                                          <CalculatedField
                                            label="Line total"
                                            value={shownTotal(item)}
                                            style={{
                                              fontSize: "var(--k-fs-sm)",
                                              minHeight: 32,
                                              padding: "0.3rem 0.5rem",
                                              fontWeight: 600,
                                            }}
                                          />
                                        )}
                                      </td>
                                      {!billsMode && (
                                        <td
                                          style={{
                                            ...styles.unifiedTd,
                                            backgroundColor: "#f4f6fa",
                                            fontFamily: "monospace",
                                            fontSize: "var(--k-fs-xs)",
                                            color: itemHsCodes[item.id]
                                              ? "var(--k-ink)"
                                              : "var(--k-muted)",
                                            fontStyle: itemHsCodes[item.id] ? "normal" : "italic",
                                          }}
                                          title="HS Code auto-fills from the picked Item Type"
                                        >
                                          {itemHsCodes[item.id] || "—"}
                                        </td>
                                      )}
                                      {!billsMode && (
                                        <td style={styles.unifiedTd}>
                                          {/* Scenario-locked Sale Type — every line on the bill must use
                                          the scenario's saleType (FBR rejects mixed-saletype bills
                                          with [0052]). When a scenario is picked we render this as a
                                          read-only display showing the locked value; when no scenario
                                          is picked (auto-detect mode) we fall back to the per-row
                                          select so legacy mixed-cart bills still work. The submit
                                          payload uses chosenScenario.saleType when set, see
                                          handleSubmit's items.map. */}
                                          {chosenScenario ? (
                                            <input
                                              type="text"
                                              readOnly
                                              value={chosenScenario.saleType}
                                              style={{
                                                ...styles.input,
                                                padding: "0.3rem 0.5rem",
                                                fontSize: "var(--k-fs-xs)",
                                                backgroundColor: "var(--k-surface-3)",
                                                cursor: "not-allowed",
                                              }}
                                              title={`Locked by ${chosenScenario.code}`}
                                            />
                                          ) : (
                                            <select
                                              style={{
                                                ...styles.input,
                                                padding: "0.3rem 0.5rem",
                                                fontSize: "var(--k-fs-xs)",
                                              }}
                                              value={itemSaleTypes[item.id] || ""}
                                              onChange={(e) =>
                                                setItemSaleTypes((p) => ({
                                                  ...p,
                                                  [item.id]: e.target.value,
                                                }))
                                              }
                                            >
                                              <option value="">— select —</option>
                                              <option>Goods at standard rate (default)</option>
                                              <option>Goods at Reduced Rate</option>
                                              <option>Goods at zero-rate</option>
                                              <option>Exempt goods</option>
                                              <option>3rd Schedule Goods</option>
                                              <option>Services</option>
                                              <option>Services (FED in ST Mode)</option>
                                              <option>Goods (FED in ST Mode)</option>
                                              <option>Steel Melting and re-rolling</option>
                                              <option>Toll Manufacturing</option>
                                              <option>Mobile Phones</option>
                                              <option>Petroleum Products</option>
                                              <option>Electric Vehicle</option>
                                              <option>Cement /Concrete Block</option>
                                              <option>Processing/Conversion of Goods</option>
                                              <option>Cotton Ginners</option>
                                              <option>Non-Adjustable Supplies</option>
                                            </select>
                                          )}
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                        <p style={styles.fbrToggleHint}>
                          <b>*</b> Unit Price is required. HS Code &amp; Sale Type are optional —
                          needed only when submitting to FBR. They auto-fill when you pick an item.
                          {!canCreateItemType && (
                            <span style={{ marginLeft: 8 }}>
                              ·{" "}
                              <PermissionLackedHint
                                inline
                                perm="itemtypes.manage.create"
                                what="add a new item type"
                              />
                            </span>
                          )}
                        </p>

                        {/* Totals */}
                        <div style={styles.totalsBox}>
                          <div style={styles.totalRow}>
                            <span>Subtotal:</span>
                            <span>
                              Rs. {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div style={styles.totalRow}>
                            <span>
                              {taxTreatment === "SRB"
                                ? "SRB sales tax"
                                : taxTreatment === "NoTax"
                                  ? "Tax"
                                  : "GST"}{" "}
                              ({gstRate}%):
                            </span>
                            <span>
                              Rs.{" "}
                              {gstAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          {billsMode && Number(freightCharges) > 0 && (
                            <div style={styles.totalRow}>
                              <span>Freight / cartage:</span>
                              <span>
                                Rs.{" "}
                                {Number(freightCharges).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                          )}
                          {furtherTaxAmount > 0 && (
                            <div style={styles.totalRow}>
                              <span>Further tax ({furtherTaxRate}%):</span>
                              <span>
                                Rs.{" "}
                                {furtherTaxAmount.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                          )}
                          <div
                            style={{
                              ...styles.totalRow,
                              fontWeight: 700,
                              fontSize: "var(--k-fs-md)",
                              borderTop: "2px solid #333",
                              paddingTop: "0.5rem",
                            }}
                          >
                            <span>Grand Total:</span>
                            <span>
                              Rs.{" "}
                              {commercialTotal.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {billsMode && (
              <FreightChargesField value={freightCharges} onChange={setFreightCharges} />
            )}
            <DocumentTaxFields
              freightCharges={billsMode ? Number(freightCharges || 0) : 0}
              subtotal={subtotal}
              gstAmount={gstAmount}
              furtherTaxRate={taxTreatment === "FBR" ? furtherTaxRate : undefined}
              onFurtherTaxRateChange={setFurtherTaxRate}
              withholdingTaxRate={withholdingTaxRate}
              withholdingTaxAmount={withholdingTaxAmount}
              onWithholdingChange={({ rate, amount }) => {
                setWithholdingTaxRate(rate);
                setWithholdingTaxAmount(amount);
              }}
            />
            <p style={{ color: "var(--k-muted)", fontSize: "var(--k-fs-base)", lineHeight: 1.5 }}>
              Item Type is optional on bills. Selected types suggest filing groups; unclassified
              lines stay separate. The tax consultant can combine or separate them in Adjust
              invoice.
            </p>
            {!company?.taxInvoiceUseOriginalBillLines && (
              <TaxInvoiceGrouping
                value={groupTaxInvoiceByItemType}
                onChange={setGroupTaxInvoiceByItemType}
              />
            )}
            <DocumentNotesEditor value={notes} onChange={setNotes} />
            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager
                ref={attachmentRef}
                companyId={companyId}
                entityType="Invoice"
                entityId={null}
                mode="edit"
              />
            </div>
          </div>
          <div data-admin-footer="" style={formStyles.footer}>
            {allItems.length > 0 && !allPricesValid && (
              <span
                style={{
                  fontSize: "var(--k-fs-sm)",
                  color: "var(--k-danger)",
                  marginRight: "auto",
                }}
              >
                All items must have a unit price greater than 0.
              </span>
            )}
            <button
              data-admin-close=""
              type="button"
              style={{ ...formStyles.button, ...formStyles.cancel }}
              onClick={onClose}
            >
              Cancel
            </button>
            {billNumberMode === "custom" && !billNumberOk && (
              <span
                style={{
                  fontSize: "var(--k-fs-sm)",
                  color: "var(--k-danger)",
                  marginRight: "auto",
                }}
              >
                Enter a bill number that isn&apos;t already in use, or switch back to Auto.
              </span>
            )}
            <button
              type="submit"
              style={{
                ...formStyles.button,
                ...formStyles.submit,
                opacity:
                  saving ||
                  !selectedClientId ||
                  selectedIds.length === 0 ||
                  !allPricesValid ||
                  !allItemTypesValid ||
                  !billNumberOk
                    ? 0.6
                    : 1,
              }}
              disabled={
                saving ||
                !selectedClientId ||
                selectedIds.length === 0 ||
                !allPricesValid ||
                !allItemTypesValid ||
                !billNumberOk
              }
            >
              {saving ? "Creating..." : "Create Bill"}
            </button>
          </div>
        </form>
      </div>

      {/* Inline Add Buyer modal — reuses the regular ClientForm. The
          single-company picker pins to the active company; multi-company
          picker auto-collapses since we pass companies=[]. */}
      {showAddClient && (
        <ClientForm
          client={null}
          companyId={companyId}
          companies={[]}
          onClose={() => setShowAddClient(false)}
          onSaved={(created) => onClientCreated(created)}
        />
      )}

      {/* Inline Add Item Type modal — shared ItemTypeForm used by every
          create / edit entry point (Item Types page, bill forms,
          invoice edit). Inherits the parent bill's scenario so Sale
          Type is locked and the HS-code typeahead filters by it. */}
      {showAddItemType && (
        <ItemTypeForm
          companyId={companyId}
          scenarioCode={chosenScenario?.code}
          scenarioSaleType={chosenScenario?.saleType}
          onClose={() => {
            setShowAddItemType(false);
            setPendingItemTypeRowId(null);
          }}
          onSaved={(created) => onItemTypeCreated(created)}
        />
      )}
    </div>
  );
}

const styles = {
  // Mobile stacked-card line items (rendered below 760px instead of the table).
  mcards: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  mcard: {
    border: `1px solid var(--k-line)`,
    borderRadius: "var(--k-card-radius)",
    padding: "0.7rem 0.75rem",
    background: "var(--k-surface)",
  },
  mcardHead: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    marginBottom: "0.5rem",
    flexWrap: "wrap",
  },
  billTick: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    fontSize: "var(--k-fs-xs)",
    fontWeight: 700,
    color: "var(--k-blue)",
    minHeight: "var(--k-btn-h)",
    cursor: "pointer",
    flexShrink: 0,
  },
  billTickCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    cursor: "pointer",
  },
  leftOutRow: { opacity: 0.5 },
  leaveOutHint: { fontWeight: 400, fontSize: "var(--k-fs-2xs)", color: "var(--k-muted)" },
  mdc: {
    fontSize: "var(--k-fs-2xs)",
    fontWeight: 700,
    color: "var(--k-blue)",
    background: "var(--k-info-bg)",
    borderRadius: "var(--k-r-sm)",
    padding: "0.15rem 0.45rem",
    flexShrink: 0,
  },
  mlabel: {
    display: "block",
    fontSize: "var(--k-fs-2xs)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color: "var(--k-muted)",
    fontWeight: 700,
    marginBottom: "0.2rem",
  },
  mgrid3: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "0.5rem",
    marginTop: "0.4rem",
  },
  mkv: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "0.5rem",
  },
  mamt: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "0.55rem",
    paddingTop: "0.45rem",
    borderTop: `1px dashed var(--k-line)`,
    fontSize: "var(--k-fs-base)",
    color: "var(--k-muted)",
  },
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: {
    display: "block",
    marginBottom: "var(--ui-label-gap, 0.35rem)",
    fontWeight: 600,
    fontSize: "var(--ui-label-size, var(--k-fs-base))",
    color: "var(--k-muted)",
  },
  input: {
    width: "100%",
    padding: "var(--ui-input-pad, 0.55rem 0.75rem)",
    minHeight: "var(--ui-control-h, 0px)",
    borderRadius: "var(--k-radius)",
    border: `1px solid var(--k-line-strong)`,
    fontSize: "var(--ui-input-size, var(--k-fs-base))",
    backgroundColor: `var(--ui-input-bg, var(--k-input-bg))`,
    color: "var(--k-ink)",
    outline: "none",
    boxSizing: "border-box",
  },
  select: {
    width: "100%",
    padding: "var(--ui-select-pad, 0.6rem 0.75rem)",
    minHeight: "var(--ui-control-h, 0px)",
    borderRadius: "var(--k-radius)",
    border: `1px solid var(--k-line-strong)`,
    fontSize: "var(--ui-input-size, var(--k-fs-base))",
    backgroundColor: `var(--ui-input-bg, var(--k-input-bg))`,
    color: "var(--k-ink)",
    outline: "none",
    cursor: "pointer",
  },
  errorAlert: {
    backgroundColor: "var(--k-danger-bg)",
    color: "var(--k-danger)",
    padding: "0.65rem 1rem",
    borderRadius: "var(--k-radius)",
    marginBottom: "1rem",
    fontWeight: 500,
    border: `1px solid color-mix(in srgb, var(--k-danger) 19%, transparent)`,
    fontSize: "var(--k-fs-base)",
  },
  challanGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    maxHeight: 200,
    overflowY: "auto",
  },
  challanCard: {
    display: "flex",
    alignItems: "center",
    padding: "0.5rem 0.75rem",
    borderRadius: "var(--k-radius)",
    border: "2px solid",
    cursor: "pointer",
    transition: "all 0.2s",
    fontSize: "var(--k-fs-base)",
  },
  selectAllBtn: {
    padding: "0.25rem 0.6rem",
    borderRadius: "var(--k-r-sm)",
    border: `1px solid var(--k-line-strong)`,
    backgroundColor: "var(--k-surface)",
    fontSize: "var(--k-fs-xs)",
    fontWeight: 600,
    color: "var(--k-blue)",
    cursor: "pointer",
  },
  itemsTable: { display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "1rem" },
  itemsHeader: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    padding: "0.4rem 0.5rem",
    backgroundColor: "#f0f4f8",
    borderRadius: "var(--k-r-sm)",
    fontSize: "var(--k-fs-xs)",
    fontWeight: 700,
    color: "var(--k-muted)",
    textTransform: "uppercase",
  },
  itemRow: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    padding: "0.4rem 0.5rem",
    borderRadius: "var(--k-r-sm)",
    border: `1px solid var(--k-line)`,
    backgroundColor: "#fafbfc",
  },
  totalsBox: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    alignItems: "flex-end",
    padding: "1rem",
    backgroundColor: "var(--k-surface-2)",
    borderRadius: "var(--k-radius)",
    border: `1px solid var(--k-line)`,
  },
  totalRow: {
    display: "flex",
    gap: "2rem",
    justifyContent: "flex-end",
    fontSize: "var(--k-fs-base)",
    minWidth: 280,
  },
  poDateInfo: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginTop: "0.5rem",
    padding: "0.5rem 0.75rem",
    borderRadius: "var(--k-radius)",
    backgroundColor: "var(--k-info-bg)",
    border: "1px solid #0d47a130",
    flexWrap: "wrap",
  },
  fbrToggleHint: { margin: "0.3rem 0 0", fontSize: "var(--k-fs-xs)", color: "var(--k-muted)" },
  optionalTag: {
    marginLeft: "0.3rem",
    padding: "0.05rem 0.35rem",
    borderRadius: "var(--k-r-xs)",
    backgroundColor: "var(--k-warn-bg)",
    color: "var(--k-warn)",
    fontSize: "var(--k-fs-2xs)",
    fontWeight: 800,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
  },
  itemsHeaderBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "0.5rem",
    marginBottom: "0.5rem",
  },
  hintRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    fontSize: "var(--k-fs-xs)",
    color: "var(--k-muted)",
  },
  hintPill: {
    padding: "0.05rem 0.4rem",
    borderRadius: "var(--k-r-xs)",
    backgroundColor: "var(--k-info-bg)",
    color: "var(--k-blue)",
    fontSize: "var(--k-fs-2xs)",
    fontWeight: 800,
    letterSpacing: "0.03em",
  },
  unifiedTableWrap: {
    width: "100%",
    overflowX: "auto",
    border: `1px solid var(--k-line)`,
    borderRadius: "var(--k-radius)",
  },
  unifiedTable: { width: "100%", borderCollapse: "collapse", minWidth: 1000 },
  unifiedThead: { backgroundColor: "#eff3f8" },
  unifiedTh: {
    padding: "0.5rem 0.45rem",
    textAlign: "left",
    fontSize: "var(--k-fs-2xs)",
    fontWeight: 800,
    color: "var(--k-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    borderBottom: `1px solid var(--k-line)`,
  },
  unifiedRow: { backgroundColor: "var(--k-surface)" },
  unifiedTd: {
    padding: "0.3rem 0.4rem",
    fontSize: "var(--k-fs-sm)",
    borderBottom: `1px solid var(--k-line)`,
    verticalAlign: "middle",
  },

  // Scenario-locked GST + Sale Type affordances (same look as StandaloneInvoiceForm).
  lockedTag: {
    marginLeft: "0.3rem",
    padding: "0.05rem 0.3rem",
    borderRadius: "var(--k-r-xs)",
    backgroundColor: "var(--k-teal-bg)",
    color: "var(--k-teal-ink)",
    fontSize: "var(--k-fs-2xs)",
    fontWeight: 700,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    display: "inline-block",
  },
  lockedSaleType: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 0.85rem",
    marginBottom: "0.6rem",
    borderRadius: "var(--k-radius)",
    backgroundColor: "var(--k-teal-bg)",
    border: "1px solid #80cbc4",
    color: "var(--k-teal-ink)",
    fontSize: "var(--k-fs-sm)",
  },
  lockedSaleTypeIcon: { fontSize: "var(--k-fs-base)" },
  lockedSaleTypeHint: { color: "var(--k-teal-ink)", opacity: 0.8, fontSize: "var(--k-fs-xs)" },

  // ── Step labels + scenario picker grid (same as StandaloneInvoiceForm) ──
  stepLabel: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "var(--k-fs-md)",
    fontWeight: 700,
    color: "var(--k-ink)",
    marginBottom: "0.4rem",
  },
  stepNum: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: "50%",
    backgroundColor: "var(--k-accent-solid, var(--k-blue))",
    color: "#fff",
    fontSize: "var(--k-fs-xs)",
    fontWeight: 800,
    flexShrink: 0,
  },
  stepHint: {
    margin: "0 0 0.6rem 30px",
    fontSize: "var(--k-fs-xs)",
    color: "var(--k-muted)",
    lineHeight: 1.4,
  },
  // Collapsible Step 1 (FBR Scenario picker) — clickable header bar that
  // shows the auto-defaulted scenario summary and toggles the card grid.
  // Mirrors StandaloneInvoiceForm so the two creation flows feel identical.
  scenarioCollapseHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    width: "100%",
    minHeight: "var(--ui-btn-h, 0px)",
    padding: "var(--ui-input-pad, 0.6rem 0.85rem)",
    borderRadius: "var(--k-radius)",
    border: `1px solid var(--k-line)`,
    backgroundColor: "var(--k-surface-2)",
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
    boxShadow: "none",
    margin: 0,
  },
  scenarioCollapseTitle: {
    fontSize: "var(--k-fs-base)",
    fontWeight: 700,
    color: "var(--k-ink)",
    flexShrink: 0,
  },
  scenarioCollapseSummary: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    flex: 1,
    fontSize: "var(--k-fs-sm)",
    color: "var(--k-ink)",
    flexWrap: "wrap",
    minWidth: 0,
  },
  scenarioCollapseSummaryMuted: {
    flex: 1,
    fontSize: "var(--k-fs-sm)",
    color: "var(--k-muted)",
    fontStyle: "italic",
  },
  scenarioCollapseMeta: {
    color: "var(--k-muted)",
    fontSize: "var(--k-fs-xs)",
  },
  scenarioCollapseCode: {
    fontWeight: 700,
    color: "var(--k-blue)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  scenarioCollapseChevron: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.2rem",
    color: "var(--k-blue)",
    fontWeight: 600,
    fontSize: "var(--k-fs-xs)",
    flexShrink: 0,
  },
  scenarioCollapseChevronLabel: {
    fontSize: "var(--k-fs-xs)",
    fontWeight: 600,
  },
  scenarioCollapseBody: {
    marginTop: "0.65rem",
    padding: "0.65rem 0.85rem",
    borderRadius: "var(--k-radius)",
    border: `1px solid var(--k-line)`,
    backgroundColor: "var(--k-surface)",
  },
  warnAlert: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.65rem 0.85rem",
    borderRadius: "var(--k-radius)",
    backgroundColor: colors.warnLight,
    border: `1px solid color-mix(in srgb, ${colors.warn} 19%, transparent)`,
    color: colors.warn,
    fontSize: "var(--k-fs-base)",
  },
  scenarioGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "0.6rem",
    marginTop: "0.25rem",
  },
  scenarioCard: {
    textAlign: "left",
    padding: "0.7rem 0.85rem",
    borderRadius: "var(--k-radius)",
    border: "2px solid",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
    transition: "all 0.15s",
    backgroundColor: "var(--k-surface)",
    fontFamily: "inherit",
  },
  scenarioCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  scenarioCode: {
    fontWeight: 800,
    fontSize: "var(--k-fs-md)",
    color: "var(--k-blue)",
    fontFamily: "monospace",
  },
  scenarioSaleType: {
    fontSize: "var(--k-fs-sm)",
    color: "var(--k-ink)",
    fontWeight: 600,
    lineHeight: 1.25,
  },
  scenarioRate: { fontSize: "var(--k-fs-xs)", color: "var(--k-muted)" },
  scenarioBadges: { display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.15rem" },
  scenarioBadge: {
    fontSize: "var(--k-fs-2xs)",
    padding: "0.1rem 0.4rem",
    borderRadius: "var(--k-r-xs)",
    fontWeight: 700,
    letterSpacing: "0.02em",
  },
  badgeBlue: { backgroundColor: "var(--k-info-bg)", color: "var(--k-blue)" },
  badgeOrange: { backgroundColor: "var(--k-warn-bg)", color: "var(--k-warn)" },
  badgePurple: { backgroundColor: "var(--k-purple-bg-2)", color: "var(--k-purple-3)" },

  // ── Inline create buttons (next to Buyer dropdown + per-row Item Type) ──
  inlineRow: { display: "flex", gap: "0.5rem", alignItems: "stretch", flexWrap: "wrap" },
  tinyAddBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.25rem",
    borderRadius: "var(--k-r-sm)",
    border: `1px solid var(--k-blue)`,
    backgroundColor: "var(--k-surface)",
    color: "var(--k-blue)",
    cursor: "pointer",
    flexShrink: 0,
  },
};
