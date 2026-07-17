import { useState, useEffect, useMemo, useRef } from "react";
import { MdSearch, MdCheck, MdInfo, MdLock, MdAdd, MdPersonAdd, MdExpandMore, MdExpandLess } from "react-icons/md";
import { getPendingChallansByCompany } from "../api/challanApi";
import { getSalesOrdersForPicker } from "../api/salesOrderApi";
import { createInvoice, getLastRatesForChallan } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getNonInventoryItemsByCompany } from "../api/nonInventoryItemApi";
import { getAccountsFlat } from "../api/accountApi";
import { getFbrApplicableScenarios } from "../api/fbrApi";
import { saveItemFbrDefaults } from "../api/lookupApi";
import { formStyles, modalSizes } from "../theme";
import { todayYmd } from "../utils/dateInput";
import { usePermissions } from "../contexts/PermissionsContext";
import SmartItemAutocomplete from "./SmartItemAutocomplete";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import BulkItemTypeBar from "./BulkItemTypeBar";
import AccountSelect from "./AccountSelect";
import ClientForm from "./ClientForm";
import DivisionSelect from "./DivisionSelect";
import SearchableSelect from "./SearchableSelect";
import ItemTypeForm from "./ItemTypeForm";
import PermissionLackedHint from "./PermissionLackedHint";
// 2026-05-08: Same UOM autocomplete the ChallanForm uses, hooked up
// to /lookup/units. Replaces the plain text input on each row's UOM
// cell so operators get the saved-units suggestions instead of having
// to retype "Pcs" / "KG" / etc. each line.
import LookupAutocomplete from "./LookupAutocomplete";
import AttachmentManager from "./AttachmentManager";
import { defaultAccountPlaceholder } from "../utils/accountDisplay";

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

export default function InvoiceForm({ companyId, company, onClose, onSaved, prefillChallanId, prefillChallanIds, billsMode = false, defaultDivisionId }) {
  // billsMode: true when this form is mounted from the Bills tab. Hides
  // the HS Code and Sale Type columns — those stay Invoice-tab concerns.
  // Item Type affordances (per-row picker, bulk-apply toolbar, "+ New
  // Item Type") are VISIBLE in Bills mode too, and stay optional: a type
  // picked at bill time persists on the line (itemTypeId in the payload)
  // and shows later on the Invoices tab. Picking one still auto-fills the
  // hidden per-item HS/UOM/SaleType state from the catalog entry so the
  // bill lands classified; those values ride along invisibly to the API.
  // The FBR scenario picker is separately fbrEnabled-gated. Description
  // stays the existing challan-style SmartItemAutocomplete.
  const { has } = usePermissions();
  const canCreateClient   = has("clients.manage.create");
  const canCreateItemType = has("itemtypes.manage.create");
  // FBR integration toggle (company-level). When off, the bill is a plain
  // non-FBR bill: no scenario step, editable GST, no scenario saved.
  const fbrEnabled = company?.fbrEnabled !== false;

  const [clients, setClients] = useState([]);
  // Inline create modals — same affordances StandaloneInvoiceForm has
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddItemType, setShowAddItemType] = useState(false);
  const [pendingItemTypeRowId, setPendingItemTypeRowId] = useState(null);
  const [allChallans, setAllChallans] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [itemPrices, setItemPrices] = useState({});
  const [itemDescriptions, setItemDescriptions] = useState({});
  const [commonPoDate, setCommonPoDate] = useState("");
  // Bill-level customer PO (number + date). Prefilled from the linked Sales
  // Order / selected challans; editable, or typed manually when none exists.
  const [billPoNumber, setBillPoNumber] = useState("");
  const [billPoDate, setBillPoDate] = useState("");
  const [dcSearch, setDcSearch] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [paymentTerms, setPaymentTerms] = useState("");
  // 2026-05-12: todayYmd() returns LOCAL "YYYY-MM-DD" — pre-fix the UTC
  // slice rolled the calendar day back by one for PKT operators billing
  // before 5am.
  const [invoiceDate, setInvoiceDate] = useState(todayYmd());
  const canViewDivisions = has("divisions.manage.view");
  // New bills default to the division currently being filtered on the page
  // (so "filter to a division → New Bill" lands in that division).
  const [divisionId, setDivisionId] = useState(defaultDivisionId ? String(defaultDivisionId) : "");
  // FBR-off flow: optional "start from a Sales Order" picker — selecting one
  // fills the buyer + division and ticks every unbilled challan attached to
  // the order.
  const [salesOrders, setSalesOrders] = useState([]);
  const [salesOrderId, setSalesOrderId] = useState("");
  const [soPickMsg, setSoPickMsg] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const attachmentRef = useRef(null);

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
  // Per-item Non-Inventory Item id (GL-account shortcut line: Freight / Discount / …),
  // keyed by delivery item id. Mutually exclusive with itemTypeIds[id].
  const [itemNonInvIds, setItemNonInvIds] = useState({});
  const [nonInvItems, setNonInvItems] = useState([]);
  // ── Per-line GL account (design §4) ──
  // Which income account each line posts to, keyed by delivery item id.
  // Auto-fills from the picked item type's per-company overlay account and is
  // overridable per row. The Account column + this state only matter when the
  // company has a Chart of Accounts (glOn); GL-off companies never see it and
  // the null accountId lets the posting engine derive as before.
  const [itemAccountIds, setItemAccountIds] = useState({});
  const [accounts, setAccounts] = useState([]);
  const glOn = accounts.length > 0;

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
      const newHs = {}, newSt = {}, newUom = {}, newFbrUom = {}, newDesc = {}, clearNi = {}, newAcct = {};
      for (const item of allItems) {
        const id = item.id;
        if (mode === "empty" && next[id]) continue;
        next[id] = parseInt(newId);
        // Stamping an item type clears any non-inventory binding (mutually exclusive).
        clearNi[id] = null;
        // Auto-fill the line's GL account from the item type's per-company
        // sale-account mapping (null → engine derives at post time).
        newAcct[id] = picked.saleAccountId ?? null;
        if (picked.hsCode) newHs[id] = picked.hsCode;
        if (picked.saleType) newSt[id] = picked.saleType;
        if (picked.uom) newUom[id] = picked.uom;
        if (picked.fbrUOMId) newFbrUom[id] = picked.fbrUOMId;
        // Description ALWAYS becomes the item type's name now — the
        // description input is read-only when an item type is set, so
        // there's no preserved free-text edit to step on. Clearing the
        // item type later will unlock the description for editing.
        if (picked.name) newDesc[id] = picked.name;
      }
      // Apply the keyed updates outside this updater so each set runs.
      setTimeout(() => {
        if (Object.keys(newHs).length) setItemHsCodes(p => ({ ...p, ...newHs }));
        if (Object.keys(newSt).length) setItemSaleTypes(p => ({ ...p, ...newSt }));
        if (Object.keys(newUom).length) setItemUoms(p => ({ ...p, ...newUom }));
        if (Object.keys(newFbrUom).length) setItemFbrUomIds(p => ({ ...p, ...newFbrUom }));
        if (Object.keys(newDesc).length) setItemDescriptions(p => ({ ...p, ...newDesc }));
        if (Object.keys(clearNi).length) setItemNonInvIds(p => ({ ...p, ...clearNi }));
        if (Object.keys(newAcct).length) setItemAccountIds(p => ({ ...p, ...newAcct }));
      }, 0);
      return next;
    });
  };

  // Bulk-apply a NON-INVENTORY item (charge) to all / empty rows — mirrors
  // applyItemTypeToAll so the bulk picker's Non-Inventory section behaves like
  // the per-row one.
  const applyNonInvToAll = (n, mode = "all") => {
    if (!n) return;
    for (const item of allItems) {
      const id = item.id;
      if (mode === "empty" && (itemTypeIds[id] || itemNonInvIds[id])) continue;
      handleNonInvPick(item, n);
    }
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
    setItemAccountIds({});
  };

  // Last-billed rate per delivery item, keyed by deliveryItemId.
  // Populated whenever a challan gets ticked (whether via the Generate-Bill
  // shortcut on the Challans page OR by the operator selecting a challan in
  // the Bills > New Bill flow). Operator can still override any row — the
  // per-row hint shows the source bill so they can spot stale rates (e.g.
  // material price has gone up since last bill).
  const [lastRates, setLastRates] = useState({});
  const [autoFilledFromHistory, setAutoFilledFromHistory] = useState(false);
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
          fbrEnabled
            ? getFbrApplicableScenarios(companyId).catch(() => ({ data: { scenarios: [] } }))
            : Promise.resolve({ data: { scenarios: [] } }),
        ]);
        // SO-mandatory billing (company flag): only offer challans linked to a
        // Sales Order. The backend rejects billing an unlinked challan anyway,
        // so this keeps the picker honest.
        const billableChallans = company?.requireSalesOrderForBilling
          ? (challanRes.data || []).filter((c) => c.salesOrderId != null)
          : challanRes.data;
        setAllChallans(billableChallans);
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
        // One challan (Generate Bill on the Challans page) OR many (Generate
        // Bill on a Sales Order — all its unbilled challans at once). Only
        // pre-ticks challans still in the pending/unbilled list; the client is
        // taken from the first match. If none match (billed since), fall back
        // to the empty state silently.
        const prefillIds = (prefillChallanIds && prefillChallanIds.length)
          ? prefillChallanIds
          : (prefillChallanId ? [prefillChallanId] : []);
        if (prefillIds.length) {
          const matched = billableChallans.filter((c) => prefillIds.includes(c.id));
          if (matched.length) {
            setSelectedClientId(String(matched[0].clientId));
            setSelectedIds(matched.map((c) => c.id));
          }
        }
      } catch {
        setError("Failed to load data.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [companyId, prefillChallanId, prefillChallanIds]);

  // Load sales orders once for the "start from an order" picker — offered
  // in both FBR modes. NO status filter: fully-delivered orders auto-close,
  // so an unbilled-but-delivered order is typically "Closed" by billing
  // time — the options memo below decides what's offerable. Page-walking
  // helper: the server clamps pageSize at 100.
  useEffect(() => {
    getSalesOrdersForPicker(companyId)
      .then((items) => setSalesOrders(items))
      .catch(() => setSalesOrders([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // Per-company Non-Inventory Items (GL-account shortcut lines: Freight, Discount, …).
  // A company with GL off / no items resolves to [] and the picker shows none.
  useEffect(() => {
    if (!companyId) { setNonInvItems([]); return; }
    getNonInventoryItemsByCompany(companyId, true).then(({ data }) => setNonInvItems(data || [])).catch(() => setNonInvItems([]));
  }, [companyId]);

  // GL accounts (income side highlighted) for the per-line Account picker.
  // Empty when GL isn't set up / the caller lacks accounting.coa.view → the
  // Account column stays hidden and lines post to the derived default.
  useEffect(() => {
    if (!companyId) { setAccounts([]); return; }
    getAccountsFlat(companyId)
      .then(({ data }) => setAccounts((data || []).filter((a) => a.isActive)))
      .catch(() => setAccounts([]));
  }, [companyId]);

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

    return () => { cancelled = true; };
  }, [selectedIds, companyId, fetchedRateChallanIds]);

  // Decorate scenarios with local meta — same shape as StandaloneInvoiceForm.
  const enrichedScenarios = useMemo(
    () => scenarios.map((s) => ({
      ...s,
      meta: SCENARIO_META[s.code] || { buyerKind: "either" },
    })),
    [scenarios],
  );

  // The chosen scenario's full record (sale type + rate + buyerKind) — drives
  // GST rate, item-type filter, AND the client dropdown filter.
  const chosenScenario = useMemo(
    () => enrichedScenarios.find((s) => s.code === scenarioCode) || null,
    [enrichedScenarios, scenarioCode],
  );

  // Item types compatible with the chosen scenario. When no scenario is
  // chosen, ALL item types are visible (pre-existing behaviour). When a
  // scenario is locked in, only items whose stored saleType matches the
  // scenario's saleType are surfaced — preventing the operator from
  // building a mixed-sale-type bill that FBR will reject with 0052.
  const filteredItemTypes = useMemo(() => {
    if (!chosenScenario) return itemTypes;
    const target = (chosenScenario.saleType || "").trim().toLowerCase();
    return itemTypes.filter(
      (it) => (it.saleType || "").trim().toLowerCase() === target,
    );
  }, [itemTypes, chosenScenario]);

  // When operator picks a scenario, snap the GST Rate to that scenario's
  // canonical rate. Field is read-only while a scenario is locked — same
  // behaviour as StandaloneInvoiceForm. Switch scenario to change rate.
  useEffect(() => {
    if (chosenScenario) setGstRate(chosenScenario.defaultRate);
  }, [chosenScenario]);

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

  // Further filter by DC search (challan number, PO, or item descriptions)
  const filteredChallans = useMemo(() => {
    const term = dcSearch.trim().toLowerCase();
    const base = !term
      ? clientChallans
      : clientChallans.filter((c) =>
          c.challanNumber.toString().includes(term) ||
          (c.poNumber && c.poNumber.toLowerCase().includes(term)) ||
          c.items?.some((item) => item.description?.toLowerCase().includes(term))
        );
    // Pin CHECKED challans to the top so a Sales-Order auto-selection (or a
    // manual tick) doesn't get lost among hundreds of pending DCs. Stable
    // sort preserves the existing DC#-descending order within each group.
    return [...base].sort(
      (a, b) => (selectedIds.includes(b.id) ? 1 : 0) - (selectedIds.includes(a.id) ? 1 : 0)
    );
  }, [clientChallans, dcSearch, selectedIds]);

  // Reset selections when client changes
  const handleClientChange = (e) => {
    setSelectedClientId(e.target.value);
    setSelectedIds([]);
    setItemPrices({});
    setItemDescriptions({});
    setCommonPoDate("");
    setBillPoNumber("");
    setBillPoDate("");
    setDcSearch("");
    setError("");
    // Also clear any leftover rate-history state so the warning banner and
    // per-row hints don't persist across an unrelated client.
    setLastRates({});
    setAutoFilledFromHistory(false);
    setFetchedRateChallanIds(new Set());
  };

  // Orders offered by the picker: any order that still has at least one UNBILLED
  // challan linked to it (billable = Pending / Imported / No PO — a customer PO
  // is NOT required, "No PO" counts). Fully-delivered orders stay in as long as
  // an unbilled challan remains; an order whose challans are all billed drops
  // out (nothing left to bill here). Cancelled orders never show. Narrowed to
  // the form's division when one is picked; the label carries the delivery
  // status + unbilled-challan count. Picking one auto-ticks its unbilled challans.
  const salesOrderOptions = useMemo(() => {
    const list = divisionId
      ? salesOrders.filter((o) => o.divisionId === parseInt(divisionId))
      : salesOrders;
    return list
      .map((o) => ({ o, pending: allChallans.filter((c) => c.salesOrderId === o.id).length }))
      .filter(({ o, pending }) => pending > 0 && o.status !== "Cancelled")
      .sort((a, b) => b.pending - a.pending || b.o.salesOrderNumber - a.o.salesOrderNumber)
      .map(({ o, pending }) => ({
        ...o,
        _label: `SO #${o.salesOrderNumber} — ${o.clientName}${o.fulfillmentStatus ? ` · ${o.fulfillmentStatus}` : ""} (${pending} unbilled DC${pending !== 1 ? "s" : ""})${o.divisionName ? ` · ${o.divisionName}` : ""}`,
      }));
  }, [salesOrders, allChallans, divisionId]);

  // Everything a Sales Order pick populates, back to a blank form. Also
  // runs when the picker is CLEARED — the operator asked for a clean slate
  // when the order is removed, not a half-populated leftover.
  const resetSalesOrderDetails = () => {
    setSelectedClientId("");
    setDivisionId(defaultDivisionId ? String(defaultDivisionId) : "");
    setSelectedIds([]);
    setItemPrices({});
    setItemDescriptions({});
    setCommonPoDate("");
    setBillPoNumber("");
    setBillPoDate("");
    setDcSearch("");
    setError("");
    setLastRates({});
    setAutoFilledFromHistory(false);
    setFetchedRateChallanIds(new Set());
  };

  // Picking a Sales Order = pick its buyer + tick every unbilled challan
  // attached to the order in one shot. Same reset semantics as a manual
  // client change — including fetchedRateChallanIds, so last-billed rates
  // refetch and prefill prices for the newly ticked challans.
  const handleSalesOrderPick = (id) => {
    setSalesOrderId(id ? String(id) : "");
    if (!id) { setSoPickMsg(""); resetSalesOrderDetails(); return; }
    const so = salesOrders.find((o) => String(o.id) === String(id));
    if (!so) return;
    const soChallans = allChallans.filter((c) => c.salesOrderId === so.id);
    resetSalesOrderDetails();
    setSelectedClientId(so.clientId ? String(so.clientId) : "");
    setDivisionId(so.divisionId ? String(so.divisionId) : "");
    setSelectedIds(soChallans.map((c) => c.id));
    // Prefill the bill's customer PO from the order (operator can still edit).
    if (so.customerPoNumber) setBillPoNumber(so.customerPoNumber);
    if (so.customerPoDate) setBillPoDate(String(so.customerPoDate).slice(0, 10));
    setSoPickMsg(soChallans.length
      ? `Selected ${soChallans.length} unbilled challan${soChallans.length !== 1 ? "s" : ""} from Sales Order #${so.salesOrderNumber}.`
      : `Sales Order #${so.salesOrderNumber} has no unbilled challans — create a challan for it first, or tick challans manually below.`);
  };


  const toggleChallan = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    const visible = filteredChallans.map((c) => c.id);
    const allSelected = visible.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visible.includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...visible])]);
    }
  };

  const selectedChallans = clientChallans.filter((c) => selectedIds.includes(c.id));
  const allItems = selectedChallans.flatMap((c) =>
    c.items.map((item) => ({ ...item, challanNumber: c.challanNumber }))
  );

  // Prefill the bill PO from the selected challans (they carry the order's PO)
  // when the operator hasn't set one yet — covers the "Generate Bill from order"
  // path where challans are preselected without calling handleSalesOrderPick.
  useEffect(() => {
    const po = selectedChallans.map((c) => c.poNumber).find((p) => p && p.trim());
    const pod = selectedChallans.map((c) => c.poDate).find((d) => d);
    if (po) setBillPoNumber((prev) => prev || po);
    if (pod) setBillPoDate((prev) => prev || String(pod).slice(0, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  const subtotal = allItems.reduce((sum, item) => {
    const price = parseFloat(itemPrices[item.id]) || 0;
    return sum + item.quantity * price;
  }, 0);
  const gstAmount = Math.round(subtotal * gstRate / 100 * 100) / 100;
  const grandTotal = subtotal + gstAmount;

  const allPricesValid = allItems.length > 0 && allItems.every((i) => itemPrices[i.id] && parseFloat(itemPrices[i.id]) > 0);
  // Every line must be complete before the bill can be created: a classification
  // (Item Type OR Non-Inventory item), a non-empty description, qty > 0, and
  // unit price > 0. Gates the Create Bill button (disabled until all pass).
  const allLinesComplete = allItems.length > 0 && allItems.every((i) => {
    const hasPick = !!(itemTypeIds[i.id] || itemNonInvIds[i.id]);
    const desc = ((itemDescriptions[i.id] ?? i.description) || "").trim();
    const qty = Number(i.quantity) || 0;
    const price = parseFloat(itemPrices[i.id]) || 0;
    return hasPick && desc.length > 0 && qty > 0 && price > 0;
  });

  const handlePriceChange = (itemId, value) => {
    setItemPrices((prev) => ({ ...prev, [itemId]: value }));
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

  // Non-Inventory pick — mutually exclusive with an item type. Records the
  // non-inv id, clears the item-type binding + inherited FBR fields, and
  // prefills description / UOM / price only when those are still empty
  // (this is a sales bill, so use the item's defaultSalePrice).
  const handleNonInvPick = (item, n) => {
    const id = item.id;
    if (!n) { setItemNonInvIds((p) => ({ ...p, [id]: null })); return; }
    setItemNonInvIds((p) => ({ ...p, [id]: n.id }));
    setItemTypeIds((p) => ({ ...p, [id]: null }));
    // A non-inventory item posts to its own mapped account — clear any per-line
    // override so that mapping governs.
    setItemAccountIds((p) => ({ ...p, [id]: null }));
    setItemHsCodes((p) => ({ ...p, [id]: "" }));
    setItemSaleTypes((p) => ({ ...p, [id]: "" }));
    setItemFbrUomIds((p) => ({ ...p, [id]: null }));
    const curDesc = (itemDescriptions[id] ?? item.description) || "";
    if (!curDesc.trim()) setItemDescriptions((p) => ({ ...p, [id]: n.defaultLineDescription || n.name || "" }));
    const curUom = (itemUoms[id] ?? item.unit) || "";
    if (!curUom.trim()) setItemUoms((p) => ({ ...p, [id]: n.unitName || "" }));
    if ((!itemPrices[id] || Number(itemPrices[id]) === 0) && n.defaultSalePrice != null) {
      setItemPrices((p) => ({ ...p, [id]: String(n.defaultSalePrice) }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!selectedClientId) return setError("Select a client first.");
    if (selectedIds.length === 0) return setError("Select at least one challan.");
    if (!company || company.startingInvoiceNumber === 0)
      return setError("Starting invoice number has not been set for this company. Please set it in the Companies page first.");

    const missingPrices = allItems.filter((i) => !itemPrices[i.id] || parseFloat(itemPrices[i.id]) <= 0);
    if (missingPrices.length > 0) return setError("Enter unit price for all items.");

    // Every line on a bill must be classified — an Item Type OR a Non-Inventory item.
    const missingPick = allItems.filter((i) => !itemTypeIds[i.id] && !itemNonInvIds[i.id]);
    if (missingPick.length > 0) return setError("Every line must have an Item Type or Non-Inventory item selected.");

    setSaving(true);
    try {
      // Backfill the PO date onto selected challans that don't have one, using
      // the bill's PO date (the "PO Date" field the operator sees/edits).
      const poDateUpdates = {};
      if (billPoDate) {
        const isoDate = new Date(billPoDate).toISOString();
        for (const dc of selectedChallans) {
          if (!dc.poDate) {
            poDateUpdates[dc.id] = isoDate;
          }
        }
      }

      // Prepend the chosen scenario tag to paymentTerms so FbrService's
      // auto-detector routes the submission to the right scenarioId. The
      // tag pattern is "[SNxxx]" — see FbrService.PostInvoiceAsync.
      const paymentTermsToSave = scenarioCode
        ? `[${scenarioCode}] ${paymentTerms || chosenScenario?.description || ""}`.trim()
        : (paymentTerms || null);

      const { data: created } = await createInvoice({
        date: new Date(invoiceDate).toISOString(),
        companyId,
        divisionId: divisionId ? parseInt(divisionId) : null,
        clientId: parseInt(selectedClientId),
        gstRate: parseFloat(gstRate),
        paymentTerms: paymentTermsToSave,
        documentType: documentType || null,
        paymentMode: paymentMode || null,
        challanIds: selectedIds,
        items: allItems.map((item) => ({
          deliveryItemId: item.id,
          unitPrice: parseFloat(itemPrices[item.id]),
          description: itemDescriptions[item.id] || item.description,
          // ItemType link (new) — when set, backend re-derives HS/UOM/SaleType from catalog
          itemTypeId: itemTypeIds[item.id] || null,
          // Non-Inventory line (Freight / Discount / …) — mutually exclusive with itemTypeId.
          nonInventoryItemId: itemNonInvIds[item.id] || null,
          // Per-line GL income account (auto-filled from the item type's overlay,
          // overridable). Server validates against the company CoA; null → derived.
          accountId: itemAccountIds[item.id] || null,
          // Optional FBR fields — sent only if user filled them in (or auto-filled from picked ItemType)
          uom: itemUoms[item.id]?.trim() || null,
          fbrUOMId: itemFbrUomIds[item.id] || null,
          hsCode: itemHsCodes[item.id]?.trim() || null,
          // Sale Type: when a scenario is locked in, EVERY line ships the
          // scenario's saleType regardless of any per-row override. Mixed-
          // saletype bills get rejected by FBR with [0052]. The per-row
          // select is only consulted in auto-detect (no scenario) mode.
          saleType: chosenScenario
            ? chosenScenario.saleType
            : (itemSaleTypes[item.id]?.trim() || null),
        })),
        poDateUpdates,
        poNumber: billPoNumber.trim() || null,
        poDate: billPoDate ? new Date(billPoDate).toISOString() : null,
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
            name,
            hsCode: itemHsCodes[item.id]?.trim() || null,
            // Same scenario-wins precedence as the submit payload above.
            saleType: chosenScenario
              ? chosenScenario.saleType
              : (itemSaleTypes[item.id]?.trim() || null),
            uom: itemUoms[item.id]?.trim() || item.unit || null,
            fbrUOMId: itemFbrUomIds[item.id] || null,
          }).catch(() => {});
        });
      await Promise.all(rememberPromises);

      // Upload attachments staged before the bill had an id. Best-effort —
      // the bill is already saved.
      try {
        if (created?.id) await attachmentRef.current?.flush(created.id);
      } catch { /* attachments are best-effort */ }

      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create invoice.");
    } finally {
      setSaving(false);
    }
  };

  // Clients that have at least one billable challan. The buyer picked via
  // the Sales-Order shortcut stays visible even with zero — the operator
  // must SEE the buyer land; the picker hint explains what's missing.
  const clientsWithChallans = clients.filter((cl) =>
    allChallans.some((ch) => ch.clientId === cl.id)
    || String(cl.id) === String(selectedClientId)
  );

  // Apply the scenario's buyer-kind filter on top of the with-challan
  // filter — same logic StandaloneInvoiceForm uses.
  //   b2b-registered   → only Registered clients
  //   b2b-unregistered → only Unregistered clients
  //   walk-in          → only Unregistered clients (counter sale, rare with challans)
  //   either           → no filter
  // The currently-selected buyer always stays visible even when it doesn't
  // match the scenario's buyer kind (e.g. seeded by the Sales-Order pick) —
  // hiding it would make the pick look like it silently failed; FBR
  // validation still catches a genuine scenario/buyer mismatch at submit.
  const clientsForScenario = useMemo(() => {
    const base = (() => {
      if (!chosenScenario) return clientsWithChallans;
      const k = chosenScenario.meta.buyerKind;
      if (k === "b2b-registered")
        return clientsWithChallans.filter((c) => (c.registrationType || "").toLowerCase() === "registered");
      if (k === "b2b-unregistered" || k === "walk-in")
        return clientsWithChallans.filter((c) => (c.registrationType || "").toLowerCase() !== "registered");
      return clientsWithChallans;
    })();
    if (selectedClientId && !base.some((c) => String(c.id) === String(selectedClientId))) {
      const sel = clientsWithChallans.find((c) => String(c.id) === String(selectedClientId));
      if (sel) return [sel, ...base];
    }
    return base;
  }, [clientsWithChallans, chosenScenario, selectedClientId]);

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

  // Account labels for the per-line Account (GL) column: the resolved company
  // default (named, shown when a line carries no explicit account) + a helper
  // naming a non-inventory line's own mapped sale account.
  const defaultSaleAccountLabel = defaultAccountPlaceholder(accounts, company?.defaultSalesAccountId);
  const nonInvSaleAccountLabel = (nonInvId) => {
    const n = nonInvItems.find((x) => String(x.id) === String(nonInvId));
    return n?.saleAccountName ? `→ ${n.saleAccountName}` : "→ Suspense";
  };

  // Backdrop click is a no-op — bills can hold a lot of typed data and
  // a stray click shouldn't wipe it. Dismiss via X or Cancel.
  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xxl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>Create Bill</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ ...formStyles.body, maxHeight: "70vh", overflowY: "auto" }}>
            {error && <div style={styles.errorAlert}>{error}</div>}

            {loading ? (
              <div style={{ textAlign: "center", padding: "2rem", color: colors.textSecondary }}>Loading...</div>
            ) : (
              <>
                {/* Optional "start from a Sales Order" (both FBR modes) —
                    fills the buyer + division and ticks every unbilled
                    challan attached to the order. Clearing it resets those
                    details. */}
                <div style={{ marginBottom: "1rem" }}>
                  <label style={styles.label}>
                    Sales Order <span style={{ fontWeight: 400, color: colors.textSecondary }}>(optional — fills the buyer and selects its challans)</span>
                  </label>
                  {salesOrderOptions.length === 0 ? (
                    <p style={{ color: colors.textSecondary, fontSize: "0.82rem", margin: 0 }}>
                      No sales orders with unbilled challans{divisionId ? " in this division" : ""} — pick a buyer and challans below.
                    </p>
                  ) : (
                    <SearchableSelect
                      items={salesOrderOptions}
                      value={salesOrderId}
                      onChange={handleSalesOrderPick}
                      labelKey="_label"
                      searchKeys={["salesOrderNumber", "clientName", "customerPoNumber"]}
                      placeholder="— Start from a sales order —"
                    />
                  )}
                  {soPickMsg && <div style={{ fontSize: "0.78rem", color: colors.teal, fontWeight: 600, marginTop: 4 }}>{soPickMsg}</div>}
                </div>

                {/* Step 1 — Pick FBR scenario. Collapsed by default —
                    operator sees a one-line summary of the auto-defaulted
                    scenario and can expand to switch. Auto-collapses on
                    pick so the form scrolls back into Buyer / Items.
                    Same UX as StandaloneInvoiceForm. */}
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
                        Each scenario locks the Sale Type, GST rate, and buyer type.
                        Only the scenarios applicable to your company's profile
                        ({company?.fbrBusinessActivity || "—"} · {company?.fbrSector || "—"}) are listed.
                      </p>
                      {enrichedScenarios.length === 0 ? (
                        <div style={styles.warnAlert}>
                          <MdInfo size={16} /> No FBR scenarios available. Configure Business Activity
                          and Sector on the Company before creating a bill.
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
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}

                {/* Step 2 — Pick a client. Collapsible — expanded by
                    default. Filtered by scenario.buyerKind + "has at least
                    one pending challan". Inline "+ New Buyer" button. */}
                {(chosenScenario || !fbrEnabled) && (() => {
                  const selectedBuyer = clientsForScenario.find((c) => String(c.id) === String(selectedClientId));
                  const pendingCount = selectedBuyer ? allChallans.filter((ch) => ch.clientId === selectedBuyer.id).length : 0;
                  return (
                    <div style={{ marginBottom: "1.25rem" }}>
                      <button
                        type="button"
                        onClick={() => setBuyerOpen((v) => !v)}
                        style={styles.scenarioCollapseHeader}
                      >
                        <span style={styles.stepNum}>2</span>
                        <span style={styles.scenarioCollapseTitle}>
                          {chosenScenario?.meta.buyerKind === "walk-in" ? "Walk-in Buyer" : "Buyer"}
                        </span>
                        {selectedBuyer ? (
                          <span style={styles.scenarioCollapseSummary}>
                            <span>{selectedBuyer.name}</span>
                            <span style={styles.scenarioCollapseMeta}>· {pendingCount} pending DC{pendingCount !== 1 ? "s" : ""}</span>
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
                            {clientsForScenario.length === 0 ? (
                              <div style={{ ...styles.warnAlert, flex: 1 }}>
                                <MdInfo size={16} />
                                No matching{" "}
                                {chosenScenario?.meta.buyerKind === "b2b-registered" ? "Registered"
                                  : chosenScenario?.meta.buyerKind === "b2b-unregistered" ? "Unregistered"
                                  : chosenScenario?.meta.buyerKind === "walk-in" ? "Unregistered (Walk-in)" : ""}{" "}
                                clients with pending challans.
                                {canCreateClient ? " Add a buyer below." : " Switch scenarios or ask an admin to add one."}
                              </div>
                            ) : (
                              <div style={{ flex: 1 }}>
                                <SearchableSelect
                                  items={clientsForScenario.map((cl) => {
                                    const count = allChallans.filter((ch) => ch.clientId === cl.id).length;
                                    return { ...cl, _label: `${cl.name} (${count} pending DC${count !== 1 ? "s" : ""})` };
                                  })}
                                  value={selectedClientId}
                                  onChange={(id) => handleClientChange({ target: { value: id ? String(id) : "" } })}
                                  labelKey="_label"
                                  searchKeys={["name", "ntn"]}
                                  placeholder="— Choose a buyer —"
                                />
                              </div>
                            )}
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
                          {company && company.startingInvoiceNumber === 0 && (
                            <div style={{ ...styles.errorAlert, marginTop: "0.5rem", marginBottom: 0 }}>
                              Starting bill number not set for this company. Please configure it in the Companies page.
                            </div>
                          )}
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

                {/* Step 3 — Bill details (collapsible inputs row) +
                    DC selection + items. Same UX as StandaloneInvoiceForm:
                    the inputs row is collapsible (default open) so the
                    operator can free vertical space for the items grid. */}
                {(chosenScenario || !fbrEnabled) && selectedClientId && company?.startingInvoiceNumber > 0 && (
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
                            {canViewDivisions && (
                              <DivisionSelect companyId={companyId} value={divisionId} onChange={setDivisionId} mode="select" label={<>Division <span style={{ fontWeight: 400 }}>(optional)</span></>} labelStyle={styles.label} style={styles.input} wrapStyle={{ flex: 1, minWidth: 140 }} />
                            )}
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <label style={styles.label}>Bill Date</label>
                              <input type="date" style={styles.input} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                            </div>
                            <div style={{ flex: 1, minWidth: 100 }}>
                              <label style={{ ...styles.label, whiteSpace: "nowrap" }}>
                                GST Rate (%){chosenScenario && <span style={styles.lockedTag} title={`Locked by ${chosenScenario.code}`}>🔒 locked</span>}
                              </label>
                              <input
                                type="number"
                                style={{
                                  ...styles.input,
                                  backgroundColor: chosenScenario ? "#eef5ff" : colors.inputBg,
                                  cursor: chosenScenario ? "not-allowed" : "text",
                                }}
                                value={gstRate}
                                onChange={(e) => setGstRate(e.target.value)}
                                readOnly={!!chosenScenario}
                                title={chosenScenario ? `Locked by ${chosenScenario.code}. Switch scenario to change.` : ""}
                                min={0} max={100} step={0.5}
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <label style={styles.label}>Payment Terms</label>
                              <input type="text" style={styles.input} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Optional" />
                            </div>
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <label style={styles.label}>
                                Document Type <span style={styles.optionalTag}>FBR</span>
                              </label>
                              <input
                                type="text"
                                style={{ ...styles.input, backgroundColor: "#eef5ff", cursor: "not-allowed" }}
                                value="Sale Invoice"
                                readOnly
                                title="This screen creates Sale Invoices only. Credit / Debit Notes will get their own dedicated screens."
                              />
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
                        </div>
                      )}
                    </div>

                    {/* Challan selection */}
                    <div style={{ marginBottom: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem", flexWrap: "wrap", gap: "0.35rem" }}>
                        <label style={{ ...styles.label, marginBottom: 0 }}>
                          Pending Challans ({dcSearch ? `${filteredChallans.length} / ${clientChallans.length}` : clientChallans.length})
                        </label>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          {clientChallans.length > 0 && (
                            <div style={{ position: "relative" }}>
                              <MdSearch size={14} style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", color: colors.textSecondary }} />
                              <input
                                type="text"
                                placeholder="Search DC#, PO, items..."
                                style={{ ...styles.input, padding: "0.25rem 0.5rem 0.25rem 1.5rem", fontSize: "0.78rem", width: 180 }}
                                value={dcSearch}
                                onChange={(e) => setDcSearch(e.target.value)}
                              />
                            </div>
                          )}
                          {filteredChallans.length > 1 && (
                            <button
                              type="button"
                              style={styles.selectAllBtn}
                              onClick={selectAll}
                            >
                              {filteredChallans.every((c) => selectedIds.includes(c.id)) ? "Deselect All" : "Select All"}
                            </button>
                          )}
                        </div>
                      </div>
                      {clientChallans.length === 0 ? (
                        <p style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>No pending challans for this client.</p>
                      ) : filteredChallans.length === 0 ? (
                        <p style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>No challans match "{dcSearch}".</p>
                      ) : (
                        <>
                          <div style={styles.challanGrid}>
                            {filteredChallans.map((c) => (
                              <label key={c.id} style={{
                                ...styles.challanCard,
                                borderColor: selectedIds.includes(c.id) ? colors.blue : colors.cardBorder,
                                backgroundColor: selectedIds.includes(c.id) ? "#e3f2fd" : "#fff",
                              }}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.includes(c.id)}
                                  onChange={() => toggleChallan(c.id)}
                                  style={{ marginRight: "0.5rem", flexShrink: 0 }}
                                />
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                                  <strong>DC #{c.challanNumber}</strong>
                                  <span style={{ fontSize: "0.78rem", color: colors.textSecondary }}>
                                    {new Date(c.deliveryDate).toLocaleDateString()} | {c.items?.length} items
                                    {c.poNumber ? ` | PO: ${c.poNumber}` : ""}
                                    {c.poDate ? ` | PO Date: ${new Date(c.poDate).toLocaleDateString()}` : ""}
                                  </span>
                                </div>
                              </label>
                            ))}
                          </div>
                          {selectedIds.length > 0 && (
                            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", flex: "1 1 180px" }}>
                                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: colors.textSecondary }}>Customer PO #</label>
                                <input
                                  type="text"
                                  placeholder="From order, or enter manually"
                                  style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.82rem" }}
                                  value={billPoNumber}
                                  onChange={(e) => setBillPoNumber(e.target.value)}
                                />
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: colors.textSecondary }}>PO Date</label>
                                <input
                                  type="date"
                                  style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.82rem", width: "auto" }}
                                  value={billPoDate}
                                  onChange={(e) => setBillPoDate(e.target.value)}
                                />
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Scenario-locked Sale Type banner — same affordance
                        as StandaloneInvoiceForm so the operator can see at
                        a glance which sale type every item line will end
                        up with. Hidden when no scenario is picked
                        (auto-detect mode). */}
                    {chosenScenario && (
                      <div style={styles.lockedSaleType}>
                        <span style={styles.lockedSaleTypeIcon}>🔒</span>
                        <span><b>Sale Type locked:</b> {chosenScenario.saleType}</span>
                        <span style={styles.lockedSaleTypeHint}>
                          (every item below uses this — required by {chosenScenario.code})
                        </span>
                      </div>
                    )}

                    {/* Items - unified single-row table (same layout as Edit Bill) */}
                    {allItems.length > 0 && (
                      <div>
                        <div style={styles.itemsHeaderBar}>
                          <label style={{ ...styles.label, margin: 0 }}>
                            Items ({allItems.length})
                          </label>
                          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                            {/* 2026-05-13: previously hidden when billsMode
                                was true (Bills tab). Operators asked for
                                the shortcut on every bill-creation flow,
                                so it's now visible in both Bills and
                                Invoices modes. Permission is still
                                checked — no perm → PermissionLackedHint. */}
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
                            <div style={styles.hintRow}>
                              <span style={styles.hintPill}>Tip</span>
                              Pick from <b>SAVED</b> (remembered defaults) or <b>FBR catalog</b> to auto-fill HS Code & UOM.
                            </div>
                          </div>
                        </div>

                        {autoFilledFromHistory && (
                          <div style={{
                            display: "flex", alignItems: "flex-start", gap: "0.5rem",
                            padding: "0.55rem 0.85rem", marginBottom: "0.5rem",
                            backgroundColor: "#fff8e1", border: "1px solid #ffcc80",
                            borderRadius: 8, fontSize: "0.82rem", color: "#bf360c"
                          }}>
                            <span style={{ fontSize: "1rem", lineHeight: 1 }}>⚠</span>
                            <div>
                              <b>Rates pre-filled from last bill.</b>
                              {" "}Verify each unit price below — material prices may have changed since the previous order. Override any row that needs a new rate.
                            </div>
                          </div>
                        )}

                        {/* Bulk "apply same Item Type to all lines" — shared
                            component (retains the picked value). Visible in Bills
                            mode too — a type picked at bill time persists to the
                            Invoices tab. */}
                        <BulkItemTypeBar
                          itemCount={allItems.length}
                          itemTypes={filteredItemTypes}
                          nonInventoryItems={nonInvItems}
                          divisionId={divisionId}
                          onApplyItemType={(id, picked, mode) => applyItemTypeToAll(id, picked, mode)}
                          onApplyNonInv={(n, mode) => applyNonInvToAll(n, mode)}
                          onClearAll={() => clearAllItemTypes()}
                          anyTagged={Object.values(itemTypeIds).some(Boolean)}
                        />

                        <div style={styles.unifiedTableWrap}>
                          <table style={styles.unifiedTable}>
                            <thead>
                              <tr style={styles.unifiedThead}>
                                <th style={{ ...styles.unifiedTh, width: "4%" }}>DC#</th>
                                <th style={{ ...styles.unifiedTh, width: "14%" }}>Item Type (FBR) *</th>
                                <th style={{ ...styles.unifiedTh, width: "16%" }}>Description</th>
                                <th style={{ ...styles.unifiedTh, width: "9%" }}>Qty</th>
                                <th style={{ ...styles.unifiedTh, width: "8%" }}>UOM</th>
                                <th style={{ ...styles.unifiedTh, width: "8%" }}>Unit Price *</th>
                                <th style={{ ...styles.unifiedTh, width: "9%" }}>Line Total</th>
                                {/* Account (GL) — which income account this line's
                                    amount posts to. Shown in BOTH Bills and Invoices
                                    modes when the company has a Chart of Accounts. */}
                                {glOn && (
                                  <th style={{ ...styles.unifiedTh, width: "14%" }} title="GL income account this line posts to">Account (GL)</th>
                                )}
                                {/* HS Code is FBR data — only relevant on the
                                    Invoices tab. Bills mode is pre-FBR data
                                    entry, so hide it. */}
                                {!billsMode && (
                                  <th style={{ ...styles.unifiedTh, width: "10%" }}>HS Code</th>
                                )}
                                {/* Sale Type is FBR-only data — same gating as HS Code.
                                    2026-05-08: was visible in both modes, which broke the symmetry
                                    with EditBillForm's Bills view. */}
                                {!billsMode && (
                                  <th style={{ ...styles.unifiedTh, width: "22%" }}>Sale Type</th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {allItems.map((item) => {
                                const price = parseFloat(itemPrices[item.id]) || 0;
                                const displayUom = itemUoms[item.id] ?? item.unit;
                                return (
                                  <tr key={item.id} style={styles.unifiedRow}>
                                    <td style={{ ...styles.unifiedTd, fontSize: "0.76rem", color: colors.textSecondary }}>
                                      {item.challanNumber}
                                    </td>
                                    <td style={styles.unifiedTd}>
                                      {/* Picking an ItemType auto-fills HS Code, UOM, SaleType,
                                          FbrUOMId on this row — identical behaviour to EditBillForm.
                                          The '+ New Item Type' affordance lives once above the grid
                                          (was per-row before — moved to declutter the table). */}
                                      <SearchableItemTypeSelect
                                        divisionId={divisionId}
                                        items={filteredItemTypes}
                                        value={itemTypeIds[item.id] || ""}
                                        nonInventoryItems={nonInvItems}
                                        nonInventoryValue={itemNonInvIds[item.id] || ""}
                                        onPickNonInventory={(n) => handleNonInvPick(item, n)}
                                        onChange={(newId, picked) => {
                                          setItemTypeIds((p) => ({ ...p, [item.id]: newId ? parseInt(newId) : null }));
                                          if (picked) {
                                            // Picking an ItemType clears any non-inventory binding (mutually exclusive).
                                            setItemNonInvIds((p) => ({ ...p, [item.id]: null }));
                                            // Auto-fill the line's GL income account from the item
                                            // type's per-company overlay (null → engine derives).
                                            setItemAccountIds((p) => ({ ...p, [item.id]: picked.saleAccountId ?? null }));
                                            // Picking an ItemType binds these fields to the catalog row.
                                            // Description switches to the item type's name and the
                                            // input goes read-only — same UX as the no-challan form.
                                            if (picked.name) setItemDescriptions((p) => ({ ...p, [item.id]: picked.name }));
                                            if (picked.hsCode) setItemHsCodes((p) => ({ ...p, [item.id]: picked.hsCode }));
                                            if (picked.saleType) setItemSaleTypes((p) => ({ ...p, [item.id]: picked.saleType }));
                                            if (picked.uom) setItemUoms((p) => ({ ...p, [item.id]: picked.uom }));
                                            if (picked.fbrUOMId) setItemFbrUomIds((p) => ({ ...p, [item.id]: picked.fbrUOMId }));
                                          } else {
                                            // Clearing the ItemType also clears the bound HS Code,
                                            // Sale Type and UOM — they were inherited from the
                                            // catalog row, so removing the link should remove the
                                            // values too. Otherwise stale FBR fields stay on the
                                            // line and the operator silently ships wrong data.
                                            // Description is left as-is so the operator can keep
                                            // editing or clear via SmartItemAutocomplete.
                                            setItemHsCodes((p) => ({ ...p, [item.id]: "" }));
                                            setItemSaleTypes((p) => ({ ...p, [item.id]: "" }));
                                            setItemUoms((p) => ({ ...p, [item.id]: "" }));
                                            setItemFbrUomIds((p) => ({ ...p, [item.id]: null }));
                                            setItemAccountIds((p) => ({ ...p, [item.id]: null }));
                                          }
                                        }}
                                        placeholder="— required —"
                                        style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                                      />
                                    </td>
                                    <td style={styles.unifiedTd}>
                                      {/* Description is locked to the picked Item Type's name when
                                          one is set — same rule as the no-challan form. Clearing the
                                          Item Type unlocks SmartItemAutocomplete so the operator can
                                          search saved items, pick from the FBR catalog, or type
                                          freely. The challan's original description still seeds the
                                          field on first load via the `?? item.description` fallback. */}
                                      {/* Applies in Bills mode too — the Item Type column is visible
                                          there now, so a picked type locks the description the same
                                          way and the operator sees which type the row carries. */}
                                      {itemTypeIds[item.id] ? (
                                        <input
                                          type="text"
                                          readOnly
                                          value={itemDescriptions[item.id] ?? item.description ?? ""}
                                          style={{
                                            ...styles.input,
                                            padding: "0.3rem 0.5rem",
                                            fontSize: "0.8rem",
                                            backgroundColor: "#eef5ff",
                                            cursor: "not-allowed",
                                          }}
                                          title="Locked to the picked Item Type's name. Clear the Item Type to edit."
                                        />
                                      ) : (
                                        <SmartItemAutocomplete
                                          companyId={companyId}
                                          value={itemDescriptions[item.id] ?? item.description}
                                          onChange={(v) => handleDescriptionChange(item.id, v)}
                                          onPick={(picked) => handleItemPick(item.id, picked)}
                                          style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                          placeholder="Search or type item…"
                                          multiline
                                        />
                                      )}
                                    </td>
                                    <td style={{ ...styles.unifiedTd, textAlign: "right", fontSize: "0.82rem", paddingRight: "0.5rem" }}>
                                      {/* Strip trailing zeros so 1.0000 → "1",
                                          12.5000 → "12.5", 0.0004 → "0.0004". */}
                                      {parseFloat(Number(item.quantity || 0).toFixed(4)).toString()}
                                    </td>
                                    <td style={styles.unifiedTd}>
                                      {/* UOM autocomplete (same backing endpoint
                                          as ChallanForm). Pre-fix this was a plain
                                          text input — operators had to retype
                                          "Pcs" / "KG" each row instead of picking
                                          from the saved-units list. */}
                                      <LookupAutocomplete
                                        endpoint="/lookup/units"
                                        value={displayUom || ""}
                                        onChange={(val) => setItemUoms((p) => ({ ...p, [item.id]: val }))}
                                      />
                                    </td>
                                    <td style={styles.unifiedTd}>
                                      <input
                                        type="number"
                                        min={0}
                                        step={0.01}
                                        style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                        value={itemPrices[item.id] || ""}
                                        onChange={(e) => handlePriceChange(item.id, e.target.value)}
                                        placeholder="0.00"
                                      />
                                      {lastRates[item.id]?.lastUnitPrice != null && (
                                        <div style={{
                                          fontSize: "0.68rem", marginTop: 2, lineHeight: 1.2,
                                          whiteSpace: "nowrap",
                                          color: parseFloat(itemPrices[item.id]) === parseFloat(lastRates[item.id].lastUnitPrice)
                                            ? "#5f6d7e" : "#2e7d32",
                                        }}
                                        title={`Last billed Rs. ${Number(lastRates[item.id].lastUnitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                                          + ` on bill #${lastRates[item.id].lastInvoiceNumber}`
                                          + (lastRates[item.id].lastInvoiceDate ? ` (${new Date(lastRates[item.id].lastInvoiceDate).toLocaleDateString()})` : "")
                                          + ` — matched by ${lastRates[item.id].matchedBy}`
                                        }>
                                          Last Rs.{Number(lastRates[item.id].lastUnitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                          {lastRates[item.id].lastInvoiceDate && (
                                            <> · #{lastRates[item.id].lastInvoiceNumber}</>
                                          )}
                                          {parseFloat(itemPrices[item.id]) !== parseFloat(lastRates[item.id].lastUnitPrice) && (
                                            <> · <b>edited</b></>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ ...styles.unifiedTd, textAlign: "right", fontWeight: 600, fontSize: "0.82rem" }}>
                                      {(item.quantity * price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </td>
                                    {glOn && (
                                      <td style={styles.unifiedTd}>
                                        <AccountSelect
                                          accounts={accounts}
                                          value={itemAccountIds[item.id] ?? null}
                                          onChange={(v) => setItemAccountIds((p) => ({ ...p, [item.id]: v }))}
                                          side="income"
                                          disabled={!!itemNonInvIds[item.id]}
                                          placeholder={itemNonInvIds[item.id] ? nonInvSaleAccountLabel(itemNonInvIds[item.id]) : defaultSaleAccountLabel}
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
                                          color: itemHsCodes[item.id] ? colors.textPrimary : colors.textSecondary,
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
                                            fontSize: "0.78rem",
                                            backgroundColor: "#eef5ff",
                                            cursor: "not-allowed",
                                          }}
                                          title={`Locked by ${chosenScenario.code}`}
                                        />
                                      ) : (
                                        <select
                                          style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                                          value={itemSaleTypes[item.id] || ""}
                                          onChange={(e) => setItemSaleTypes((p) => ({ ...p, [item.id]: e.target.value }))}
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
                        <p style={styles.fbrToggleHint}>
                          <b>*</b> Item Type (or a Non-Inventory item) and Unit Price are required on every line.
                          HS Code &amp; Sale Type are optional — needed only when submitting to FBR. They auto-fill when you pick an item.
                          {!canCreateItemType && (
                            <span style={{ marginLeft: 8 }}>
                              · <PermissionLackedHint inline perm="itemtypes.manage.create" what="add a new item type" />
                            </span>
                          )}
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
                    )}
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
            {allItems.length > 0 && !allLinesComplete && (
              <span style={{ fontSize: "0.8rem", color: colors.danger, marginRight: "auto" }}>
                Every line needs an Item Type (or Non-Inventory item), a description, quantity &gt; 0 and unit price &gt; 0.
              </span>
            )}
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button
              type="submit"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: saving || !selectedClientId || selectedIds.length === 0 || !allLinesComplete ? 0.6 : 1 }}
              disabled={saving || !selectedClientId || selectedIds.length === 0 || !allLinesComplete}
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
          fbrEnabled={company?.fbrEnabled !== false}
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
          showGlMapping
          defaultDivisionId={divisionId || null}
          onClose={() => { setShowAddItemType(false); setPendingItemTypeRowId(null); }}
          onSaved={(created) => onItemTypeCreated(created)}
        />
      )}
    </div>
  );
}

const styles = {
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  select: { width: "100%", padding: "0.6rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", cursor: "pointer" },
  errorAlert: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, border: `1px solid ${colors.danger}30`, fontSize: "0.85rem" },
  challanGrid: { display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: 200, overflowY: "auto" },
  challanCard: { display: "flex", alignItems: "center", padding: "0.5rem 0.75rem", borderRadius: 8, border: "2px solid", cursor: "pointer", transition: "all 0.2s", fontSize: "0.88rem" },
  selectAllBtn: { padding: "0.25rem 0.6rem", borderRadius: 6, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", fontSize: "0.75rem", fontWeight: 600, color: colors.blue, cursor: "pointer" },
  itemsTable: { display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "1rem" },
  itemsHeader: { display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.4rem 0.5rem", backgroundColor: "#f0f4f8", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase" },
  itemRow: { display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.4rem 0.5rem", borderRadius: 6, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fafbfc" },
  totalsBox: { display: "flex", flexDirection: "column", gap: "0.35rem", alignItems: "flex-end", padding: "1rem", backgroundColor: "#f8f9fb", borderRadius: 8, border: `1px solid ${colors.cardBorder}` },
  totalRow: { display: "flex", gap: "2rem", justifyContent: "flex-end", fontSize: "0.9rem", minWidth: 280 },
  poDateInfo: { display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", padding: "0.5rem 0.75rem", borderRadius: 8, backgroundColor: "#e3f2fd", border: "1px solid #0d47a130", flexWrap: "wrap" },
  fbrToggleHint: { margin: "0.3rem 0 0", fontSize: "0.75rem", color: colors.textSecondary },
  optionalTag: { marginLeft: "0.3rem", padding: "0.05rem 0.35rem", borderRadius: 4, backgroundColor: "#fff3e0", color: "#e65100", fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase" },
  itemsHeaderBar: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" },
  hintRow: { display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem", color: colors.textSecondary },
  hintPill: { padding: "0.05rem 0.4rem", borderRadius: 4, backgroundColor: "#e3f2fd", color: colors.blue, fontSize: "0.65rem", fontWeight: 800, letterSpacing: "0.03em" },
  unifiedTableWrap: { width: "100%", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 8 },
  unifiedTable: { width: "100%", borderCollapse: "collapse", minWidth: 1000 },
  unifiedThead: { backgroundColor: "#eff3f8" },
  unifiedTh: { padding: "0.5rem 0.45rem", textAlign: "left", fontSize: "0.7rem", fontWeight: 800, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${colors.cardBorder}` },
  unifiedRow: { backgroundColor: "#fff" },
  unifiedTd: { padding: "0.3rem 0.4rem", fontSize: "0.8rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "middle" },

  // Scenario-locked GST + Sale Type affordances (same look as StandaloneInvoiceForm).
  lockedTag: { marginLeft: "0.3rem", padding: "0.05rem 0.3rem", borderRadius: 4, backgroundColor: "#e0f2f1", color: "#00695c", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", whiteSpace: "nowrap", display: "inline-block" },
  lockedSaleType: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.85rem", marginBottom: "0.6rem", borderRadius: 8, backgroundColor: "#e0f2f1", border: "1px solid #80cbc4", color: "#00695c", fontSize: "0.82rem" },
  lockedSaleTypeIcon: { fontSize: "0.85rem" },
  lockedSaleTypeHint: { color: "#00695c", opacity: 0.8, fontSize: "0.75rem" },

  // ── Step labels + scenario picker grid (same as StandaloneInvoiceForm) ──
  stepLabel: { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary, marginBottom: "0.4rem" },
  stepNum: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", backgroundColor: colors.blue, color: "#fff", fontSize: "0.78rem", fontWeight: 800, flexShrink: 0 },
  stepHint: { margin: "0 0 0.6rem 30px", fontSize: "0.78rem", color: colors.textSecondary, lineHeight: 1.4 },
  // Collapsible Step 1 (FBR Scenario picker) — clickable header bar that
  // shows the auto-defaulted scenario summary and toggles the card grid.
  // Mirrors StandaloneInvoiceForm so the two creation flows feel identical.
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
  warnAlert: { display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.65rem 0.85rem", borderRadius: 8, backgroundColor: colors.warnLight, border: `1px solid ${colors.warn}30`, color: colors.warn, fontSize: "0.85rem" },
  scenarioGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.6rem", marginTop: "0.25rem" },
  scenarioCard: { textAlign: "left", padding: "0.7rem 0.85rem", borderRadius: 10, border: "2px solid", cursor: "pointer", display: "flex", flexDirection: "column", gap: "0.3rem", transition: "all 0.15s", backgroundColor: "#fff", fontFamily: "inherit" },
  scenarioCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  scenarioCode: { fontWeight: 800, fontSize: "0.95rem", color: colors.blue, fontFamily: "monospace" },
  scenarioSaleType: { fontSize: "0.82rem", color: colors.textPrimary, fontWeight: 600, lineHeight: 1.25 },
  scenarioRate: { fontSize: "0.74rem", color: colors.textSecondary },
  scenarioBadges: { display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.15rem" },
  scenarioBadge: { fontSize: "0.65rem", padding: "0.1rem 0.4rem", borderRadius: 4, fontWeight: 700, letterSpacing: "0.02em" },
  badgeBlue: { backgroundColor: "#e3f2fd", color: "#0d47a1" },
  badgeOrange: { backgroundColor: "#fff3e0", color: "#e65100" },
  badgePurple: { backgroundColor: "#f3e5f5", color: "#6a1b9a" },

  // ── Inline create buttons (next to Buyer dropdown + per-row Item Type) ──
  inlineRow: { display: "flex", gap: "0.5rem", alignItems: "stretch", flexWrap: "wrap" },
  inlineAddBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.45rem 0.75rem", borderRadius: 6, border: `1px solid ${colors.blue}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  tinyAddBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.25rem", borderRadius: 6, border: `1px solid ${colors.blue}`, backgroundColor: "#fff", color: colors.blue, cursor: "pointer", flexShrink: 0 },
  bulkClearBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.35rem 0.7rem", borderRadius: 6, border: `1px solid ${colors.danger}`, backgroundColor: "#fff", color: colors.danger, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
};
