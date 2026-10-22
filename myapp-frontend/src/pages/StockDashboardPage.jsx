import { useState, useEffect, useCallback, Fragment } from "react";
import LateGdMatchPanel from "../Components/stock/LateGdMatchPanel";
import { Link } from "react-router-dom";
import { MdInventory, MdSearch, MdAdd, MdHistory, MdClose, MdSwapHoriz, MdExpandMore, MdChevronRight, MdFileDownload, MdEdit, MdBuild } from "react-icons/md";
import StockMenu, { StockMenuItem } from "../Components/stock/StockMenu";
import "./StockDashboardPage.css";
import CostHistoryDialog from "../Components/CostHistoryDialog";
import { getStockOnHand, getInventorySummary, setInventoryFlowVersion, getStockMovements, getStockGdDetails, setLineClaimMonth, getOpeningBalances, upsertOpeningBalance, deleteOpeningBalance, adjustStock, exportStockOnHand, exportStockMonthly, exportAnnexH1, getTrackedItemTypes, getCostingMethod } from "../api/stockApi";
import { adjustmentLooksLikeSale, SALE_WARNING } from "../utils/stockAdjustWarning";
// Shared blob-save helper: it reads the filename off Content-Disposition and
// revokes the object URL on the next tick. Generic, not accounting-specific —
// a second copy here would only drift from it.
import { saveBlob } from "../api/accountingReportApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getAllUnits } from "../api/unitsApi";
import { formStyles, modalSizes } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import { isDecimalUnit } from "../utils/formatQuantity";
import SearchableItemTypeSelect from "../Components/SearchableItemTypeSelect";
import Pagination from "../Components/Pagination";
import usePageSize from "../hooks/usePageSize";
import usePersistentFilter from "../hooks/usePersistentFilter";
import { useColumnVisibility } from "../Components/ColumnPicker";

const money = (v) =>
  Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const num = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

// On-hand as it is, up to 4 decimals: a bin holding 331.9597 Pcs used to read
// "332" here while the bill form refused 332 as an oversell (2026-09-12).
const fmtOnHand = (q) => Number(q || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

export default function StockDashboardPage() {
  const { companies, selectedCompany, setSelectedCompany, refreshCompanies, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canManageOpening = has("stock.opening.manage");
  const canAdjust = has("stock.adjust.create");
  const canViewMovements = has("stock.movements.view");
  const canManagePolicy = has("stock.policy.manage");
  const canExport = has("stock.dashboard.export");
  // Task 9 adds this key; has() reads false for an unknown key, so the
  // Actual Cost / Margin columns and the picker stay hidden until it lands.
  const canViewActualCost = has("stock.actualcost.view");
  const flowVersion = Number(selectedCompany?.inventoryFlowVersion) === 2 ? 2 : 1;

  const [onhandPage, setOnhandPage] = useState(1);
  const [onhandPageSize, setOnhandPageSize] = usePageSize("stockOnhand");

  // Tab and search survive leaving the screen and coming back.
  const [tab, setTab] = usePersistentFilter("stock-dashboard", "tab", "onhand");
  const [onhand, setOnhand] = useState([]);
  // V2 derived inventory buckets (Available/Committed/ToDeliver/Delivered/
  // Incoming) per item — empty on V1 companies with no reservation activity.
  const [summary, setSummary] = useState([]);
  const [movements, setMovements] = useState([]);
  const [movPage, setMovPage] = useState(1);
  const [movTotal, setMovTotal] = useState(0);
  // Server-driven page size from appsettings Pagination:DefaultPageSize.
  // Set after the first response so the pagination math is accurate.
  const [movPageSize, setMovPageSize] = useState(0);
  // Operator's rows-per-page choice for the Movements tab (null → server default).
  const [movSize, setMovSize] = usePageSize("stockMovements");
  const [openings, setOpenings] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  // Ids the SERVER says are stock-tracked. null = not loaded yet, which is
  // deliberately different from an empty set: an empty set legitimately means
  // "this company tracks nothing", and a picker must not silently show the
  // whole catalog just because a fetch has not landed.
  const [trackedIds, setTrackedIds] = useState(null);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = usePersistentFilter("stock-dashboard", "search", "");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  // When the figures on screen were fetched -- the header's "as of".
  const [loadedAt, setLoadedAt] = useState(null);
  // Save in flight in either stock dialog; stops a double submit.
  const [saving, setSaving] = useState(false);

  // On-hand drill-down: which item-type row is expanded, plus a cache of
  // the full movement history per item type (so re-expanding is instant).
  const [expandedId, setExpandedId] = useState(null);
  const [drill, setDrill] = useState({});        // itemTypeId → movement[]
  const [drillLoading, setDrillLoading] = useState(null); // itemTypeId being fetched
  const [gdDetails, setGdDetails] = useState({}); // itemTypeId → GD source rows
  const [gdLoading, setGdLoading] = useState(null);
  // Which half of an expanded On-Hand row shows: "gd" lots or "moves".
  const [drillTab, setDrillTab] = useState("gd");

  const [showOpening, setShowOpening] = useState(false);
  // Set while RESTATING an existing opening balance rather than adding one.
  // Correcting a mistyped opening is not a stock movement -- nothing moved,
  // it was recorded wrong -- so it must not go through Adjust, which would
  // put an event in the ledger that never happened. UpsertOpeningBalance
  // already SETS rather than adds, so restating is a plain re-save.
  const [openingEditId, setOpeningEditId] = useState(null);
  const [openingDraft, setOpeningDraft] = useState({
    itemTypeId: "", quantity: 0, valueExcludingTax: "", actualCostExcludingTax: "",
    salesTaxRate: "", asOfDate: todayYmd(), notes: "",
  });
  const [showAdjust, setShowAdjust] = useState(false);
  // "set" is the default: someone fixing a mistake knows what the figures
  // SHOULD be, not the size of their error, so the form takes the truth and
  // the server works out the change. "delta" is still there for a genuine
  // movement ("10 more arrived", "3 broke").
  const [adjustDraft, setAdjustDraft] = useState({
    itemTypeId: "", mode: "set",
    delta: 0, valueDelta: "", unitCost: "",
    targetQuantity: "", targetValue: "",
    // Actual-cost mirror of valueDelta / targetValue / unitCost above — same
    // three roles, own pool (gated on stock.actualcost.view at the render site).
    actualValueDelta: "", targetActualCost: "", actualUnitCost: "",
    salesTaxRate: "", movementDate: todayYmd(), notes: "",
  });
  // Set when the Adjustment modal is launched from a grid row — the item
  // is fixed (read-only display) so the operator just types the delta.
  // Null when opened from the header button (free pick).
  const [adjustLockedItem, setAdjustLockedItem] = useState(null);
  // The cost audit drill-down (2026-09-13). Null = closed; an object with
  // itemTypeId narrows to one item, and {} would be the whole company.
  const [costHistoryItem, setCostHistoryItem] = useState(null);

  const fetchAll = useCallback(async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const [oh, sm, op, tracked, it, mov] = await Promise.all([
        getStockOnHand(selectedCompany.id),
        getInventorySummary(selectedCompany.id).catch(() => ({ data: [] })),
        canManageOpening ? getOpeningBalances(selectedCompany.id) : Promise.resolve({ data: [] }),
        getTrackedItemTypes(selectedCompany.id),
        // Company-scoped: the catalog is installation-wide, so an unscoped
        // call offered every other tenant's items in both stock modals.
        getItemTypes(selectedCompany.id),
        // 2026-05-12: also pull the movements first page on initial load
        // so the "Movements (N)" tab label shows the correct count
        // BEFORE the operator clicks into the tab. Pre-fix this was 0
        // until the tab was opened, which made the tab look empty even
        // when there were 20+ records waiting.
        canViewMovements
          ? getStockMovements(selectedCompany.id, { page: 1, ...(movSize ? { pageSize: movSize } : {}) }).catch(() => ({ data: { items: [], totalCount: 0, pageSize: 0 } }))
          : Promise.resolve({ data: { items: [], totalCount: 0, pageSize: 0 } }),
      ]);
      setOnhand(oh.data || []);
      setSummary(sm.data || []);
      setOpenings(op.data || []);
      setTrackedIds(new Set(tracked.data || []));
      setItemTypes(it.data || []);
      setMovements(mov.data?.items || []);
      setMovTotal(mov.data?.totalCount || 0);
      setMovPageSize(mov.data?.pageSize || 0);
      // A refresh can change movement history (new adjustment, edited bill),
      // so drop the drill cache; keep the expanded row open to refetch.
      setDrill({});
      setGdDetails({});
      setLoadedAt(new Date());
    } catch {
      setOnhand([]); setOpenings([]); setItemTypes([]); setTrackedIds(null);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, canManageOpening, canViewMovements, movSize]);

  const fetchMovements = useCallback(async (pg) => {
    if (!selectedCompany || !canViewMovements) return;
    try {
      // Don't send pageSize — let the server apply Pagination:DefaultPageSize
      // from appsettings.json. Read it back from the response so totalPages
      // is accurate.
      const { data } = await getStockMovements(selectedCompany.id, { page: pg || movPage, ...(movSize ? { pageSize: movSize } : {}) });
      setMovements(data.items || []);
      setMovTotal(data.totalCount || 0);
      setMovPageSize(data.pageSize || 0);
    } catch {
      setMovements([]); setMovTotal(0);
    }
  }, [selectedCompany, movPage, canViewMovements, movSize]);

  useEffect(() => { if (selectedCompany) fetchAll(); }, [selectedCompany]);
  useEffect(() => { if (tab === "movements") fetchMovements(movPage); }, [tab, selectedCompany, movPage, movSize]);
  useEffect(() => {
    if (loading) return;
    const available = tab === "onhand"
      || (tab === "inventory" && summary.length > 0)
      || (tab === "opening" && canManageOpening)
      || (tab === "movements" && canViewMovements);
    if (!available) setTab("onhand");
  }, [tab, loading, summary.length, canManageOpening, canViewMovements, setTab]);

  // Units list (carries the AllowsDecimalQuantity flag) drives whether the
  // opening-balance / adjustment quantity inputs accept decimals — the same
  // per-Unit rule the bill / challan forms use. Units are global (not
  // company-scoped), so fetch once on mount.
  useEffect(() => {
    getAllUnits().then(r => setUnits(r.data || [])).catch(() => setUnits([]));
  }, []);

  // GDs per item, from the on-hand rows. The Inventory and Opening tabs carry
  // no GD of their own, so they read it from here by item.
  const gdByItem = new Map(onhand.map(r => [r.itemTypeId, r.gdNumbers || []]));
  // The Inventory tab's stock ledger needs each item's opening balance, which
  // only the on-hand feed carries.
  const onhandById = new Map(onhand.map(r => [r.itemTypeId, r]));
  const gdText = (itemTypeId) => (gdByItem.get(itemTypeId) || []).join(", ");
  const matches = (name, hsCode, itemTypeId) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (name || "").toLowerCase().includes(q)
      || (hsCode || "").toLowerCase().includes(q)
      || (gdByItem.get(itemTypeId) || []).some(g => g.toLowerCase().includes(q));
  };

  const filteredOnhand = onhand.filter(r => matches(r.itemTypeName, r.hsCode, r.itemTypeId));

  // Paging is client-side here, unlike the item catalog. This endpoint only
  // returns items that actually have stock or an opening balance -- hundreds,
  // not the whole catalog -- and it is fetched in one request whose valuation
  // walk already covers every row. Slicing what is loaded keeps the totals
  // below honest across the WHOLE filtered set; server-side paging would only
  // be able to total the page.
  const onhandSize = onhandPageSize ?? 10;
  const onhandTotalPages = Math.max(1, Math.ceil(filteredOnhand.length / onhandSize));
  const onhandPageRows = filteredOnhand.slice(
    (onhandPage - 1) * onhandSize,
    (onhandPage - 1) * onhandSize + onhandSize,
  );

  // Totals follow the search, not the whole company — an operator filtering to
  // one supplier's items wants that subset's worth, and the unfiltered figure
  // is one keystroke away.
  // `actual` is the LANDED-cost pool, which an importer cares about more than
  // the declared one: declared value is what the customs sheet and the ledger
  // carry, landed cost is what the goods really cost. The gap between them is
  // the margin the declared-basis P&L cannot show.
  const onhandTotals = filteredOnhand.reduce((acc, r) => ({
    qty: acc.qty + (r.onHand || 0),
    excl: acc.excl + (r.valueExcludingTax || 0),
    tax: acc.tax + (r.salesTax || 0),
    incl: acc.incl + (r.valueIncludingTax || 0),
    actual: acc.actual + (r.actualCostExcludingTax || 0),
  }), { qty: 0, excl: 0, tax: 0, incl: 0, actual: 0 });

  const filteredSummary = summary.filter(r => matches(r.itemTypeName, r.hsCode, r.itemTypeId));
  const filteredOpenings = openings.filter(o => matches(o.itemTypeName, o.hsCode, o.itemTypeId));

  // Column choice per tab, remembered per viewer. On-Hand starts hidden on
  // the On-Hand tab (operators asked for it off); the Quantity tile above the
  // grid still totals it, and the picker brings the column back.
  const [showOnhandCol, onhandPicker] = useColumnVisibility("stock:onhand", [
    { key: "gd", label: "GD No" },
    { key: "item", label: "Item" },
    { key: "onhand", label: "On-Hand", defaultHidden: true },
    { key: "excl", label: "Excluding" },
    { key: "tax", label: "Sales Tax" },
    { key: "incl", label: "Including" },
    ...(canViewActualCost ? [
      { key: "actual", label: "Actual Cost" },
      { key: "margin", label: "Margin" },
    ] : []),
  ]);
  // Money first: the Inventory tab answers "how much value came in on GDs
  // and how much went out on invoices". The quantity buckets stay one click
  // away in the column picker.
  const [showInvCol, inventoryPicker] = useColumnVisibility("stock:inventory:v2", [
    { key: "item", label: "Item" },
    { key: "hs", label: "HS Code" },
    { key: "instock", label: "In Stock (qty)" },
    { key: "available", label: "Available (qty)", defaultHidden: true },
    { key: "committed", label: "Committed (qty)", defaultHidden: true },
    { key: "todeliver", label: "To Deliver (qty)", defaultHidden: true },
    { key: "delivered", label: "Delivered (qty)", defaultHidden: true },
    { key: "incoming", label: "Incoming (qty)", defaultHidden: true },
    { key: "valuein", label: "Value In" },
    { key: "valueout", label: "Value Out" },
    { key: "excl", label: "Excluding" },
    { key: "tax", label: "Sales Tax" },
    { key: "incl", label: "Including" },
    ...(canViewActualCost ? [
      { key: "actual", label: "Actual Cost" },
      { key: "margin", label: "Margin" },
    ] : []),
  ]);
  // The per-item stock ledger under each Inventory row: values by default,
  // quantities on request.
  const [showLedgerCol, ledgerPicker] = useColumnVisibility("stock:ledger", [
    { key: "qtyin", label: "Qty In", defaultHidden: true },
    { key: "qtyout", label: "Qty Out", defaultHidden: true },
    { key: "qtybal", label: "Qty Balance", defaultHidden: true },
    { key: "excl", label: "Excluding" },
    { key: "tax", label: "Sales Tax" },
    { key: "incl", label: "Including" },
    ...(canViewActualCost ? [
      { key: "actual", label: "Actual Cost" },
      { key: "margin", label: "Margin" },
    ] : []),
    { key: "balance", label: "Value Balance" },
  ]);
  const [showOpenCol, openingPicker] = useColumnVisibility("stock:opening", [
    { key: "gd", label: "GD No" },
    { key: "item", label: "Item" },
    { key: "qty", label: "Quantity" },
    { key: "excl", label: "Excluding" },
    { key: "rate", label: "S.Tax %" },
    { key: "tax", label: "Sales Tax" },
    { key: "incl", label: "Including" },
    ...(canViewActualCost ? [
      { key: "actual", label: "Actual Cost" },
      { key: "margin", label: "Margin" },
    ] : []),
    { key: "asof", label: "As Of" },
    { key: "notes", label: "Notes" },
  ]);
  const [showMovCol, movementPicker] = useColumnVisibility("stock:movements", [
    { key: "date", label: "Date" },
    { key: "item", label: "Item" },
    { key: "direction", label: "Direction" },
    { key: "qty", label: "Qty" },
    { key: "unitcost", label: "Unit Cost" },
    { key: "value", label: "Value" },
    { key: "balance", label: "Balance" },
    { key: "source", label: "Source" },
    { key: "notes", label: "Notes" },
  ]);
  // Cells after the item cell. In / Out share one cell, and so do Actual /
  // Margin, so each pair counts once while either half is visible.
  const invFlowCell = showInvCol("valuein") || showInvCol("valueout");
  const invCostCell = canViewActualCost && (showInvCol("actual") || showInvCol("margin"));
  const inventoryTracked = ["instock", "available", "committed", "todeliver", "delivered", "incoming",
    "excl", "tax", "incl"].filter(showInvCol).length + (invFlowCell ? 1 : 0) + (invCostCell ? 1 : 0);
  const invItemCell = showInvCol("item") || showInvCol("hs");
  // Opening balances: GD chips and notes sit under the item name; actual cost
  // and margin share a cell.
  const openItemCell = showOpenCol("item") || showOpenCol("gd") || showOpenCol("notes");
  const openCostCell = canViewActualCost && (showOpenCol("actual") || showOpenCol("margin"));

  // Switch the selected company between V1 (legacy HS-gated) and V2 (standard
  // inventory). ONE-WAY and audited server-side. Refresh the company list so
  // the badge + selectedCompany.inventoryFlowVersion update, then refetch.
  const switchVersion = async () => {
    if (!selectedCompany) return;
    const target = flowVersion === 2 ? 1 : 2;
    const ok = await confirm({
      title: `Switch to ${target === 2 ? "V2 (Standard Inventory)" : "V1 (Legacy)"}`,
      message: target === 2
        ? "Switch this company to V2 (Standard Inventory)? ALL item types become inventory (HS code becomes FBR metadata only), and over-commit / oversell will be hard-blocked. This CANNOT be undone."
        : "Switch this company back to V1 (Legacy)? Only HS-coded item types will be stock-tracked, as before.",
      confirmText: "Switch",
    });
    if (!ok) return;
    try {
      await setInventoryFlowVersion(selectedCompany.id, target);
      await refreshCompanies?.();
      await fetchAll();
      notify(`Company switched to ${target === 2 ? "V2 (Standard Inventory)" : "V1 (Legacy)"}.`, "success");
    } catch (e) {
      notify(e?.response?.data?.error || "Could not switch inventory version.", "error");
    }
  };

  // How this company values stock, shown as a pill. FIFO by GD is the default
  // for new companies and one-way (CLAUDE.md 5b-17), so there is no switch here.
  const [costingMethod, setCostingMethodState] = useState("WeightedAverage");
  const isFifo = costingMethod === "GdFifo";
  useEffect(() => {
    if (!selectedCompany) return;
    let cancelled = false;
    getCostingMethod(selectedCompany.id)
      .then(({ data }) => { if (!cancelled) setCostingMethodState(data?.method || "WeightedAverage"); })
      .catch(() => { if (!cancelled) setCostingMethodState("WeightedAverage"); });
    return () => { cancelled = true; };
  }, [selectedCompany]);

  // Download the on-hand grid as .xlsx. The SERVER builds the workbook, so it
  // carries every item and every movement rather than the page on screen — the
  // grid is client-paged, and an export of one page is not a stock sheet. The
  // current search rides along, so an operator who narrowed the screen gets
  // the sheet they can actually see.
  const downloadExcel = () => runExport(
    () => exportStockOnHand(selectedCompany.id, search.trim()),
    `stock-report-${todayYmd()}.xlsx`);

  // The client's month-by-month sheet: one row per GD line, Opening = the
  // line on the first of the month, Consumed = that month's sales. FIFO only
  // -- the weighted average allocates no sale to a GD.
  const [sheetMonth, setSheetMonth] = useState(() => todayYmd().slice(0, 7));
  const downloadMonthly = () => {
    if (!/^\d{4}-\d{2}$/.test(sheetMonth)) return;
    runExport(
      () => exportStockMonthly(selectedCompany.id, sheetMonth, search.trim()),
      `stock-sheet-${sheetMonth}.xlsx`);
  };

  const downloadAnnexH1 = () => {
    if (!/^\d{4}-\d{2}$/.test(sheetMonth)) return;
    runExport(() => exportAnnexH1(selectedCompany.id, sheetMonth), `annex-h1-${sheetMonth}.xlsx`);
  };

  const runExport = async (request, fileName) => {
    if (!selectedCompany || exporting) return;
    setExporting(true);
    try {
      const response = await request();
      saveBlob(response, fileName);
    } catch (err) {
      // With responseType "blob" an error body arrives as a Blob, not JSON, so
      // the usual err.response.data.error read yields undefined and the
      // operator would be told nothing at all. Read the blob first.
      let message = "Could not build the Excel file.";
      const data = err?.response?.data;
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text());
          message = parsed?.message || parsed?.error || message;
        } catch { /* not JSON — keep the generic message */ }
      } else if (data?.message || data?.error) {
        message = data.message || data.error;
      }
      notify(message, "error");
    } finally {
      setExporting(false);
    }
  };

  const startEditOpening = (o) => {
    setOpeningEditId(o.id);
    setOpeningDraft({
      itemTypeId: String(o.itemTypeId),
      quantity: o.quantity,
      valueExcludingTax: o.valueExcludingTax ?? "",
      // 0 means "not known" (see OpeningStockBalanceDto) — show an empty box,
      // not a misleading zero the operator might mistake for a real cost.
      actualCostExcludingTax: o.actualCostExcludingTax || "",
      salesTaxRate: o.salesTaxRate ?? "",
      asOfDate: (o.asOfDate || "").slice(0, 10) || todayYmd(),
      notes: o.notes || "",
    });
    setShowOpening(true);
  };

  const startAddOpening = () => {
    setOpeningEditId(null);
    setOpeningDraft({
      itemTypeId: "", quantity: 0, valueExcludingTax: "", actualCostExcludingTax: "",
      salesTaxRate: "", asOfDate: todayYmd(), notes: "",
    });
    setShowOpening(true);
  };

  const submitOpening = async (e) => {
    e.preventDefault();
    if (!openingDraft.itemTypeId) return notify("Pick an item.", "error");
    if (saving) return;
    setSaving(true);
    try {
      const actual = openingDraft.actualCostExcludingTax;
      const payload = {
        companyId: selectedCompany.id,
        itemTypeId: Number(openingDraft.itemTypeId),
        quantity: Number(openingDraft.quantity) || 0,
        valueExcludingTax: Number(openingDraft.valueExcludingTax) || 0,
        salesTaxRate: Number(openingDraft.salesTaxRate) || 0,
        asOfDate: openingDraft.asOfDate,
        notes: openingDraft.notes || null,
        // Omitted entirely when the box is blank: the server then keeps whatever
        // cost the import established. Sending 0 would erase it.
        ...(actual === "" || actual === null || actual === undefined
          ? {}
          : { actualCostExcludingTax: Number(actual) || 0 }),
      };
      await upsertOpeningBalance(payload);
      notify(openingEditId ? "Opening balance updated." : "Opening balance saved.", "success");
      setShowOpening(false);
      setOpeningEditId(null);
      setOpeningDraft({
        itemTypeId: "", quantity: 0, valueExcludingTax: "", actualCostExcludingTax: "",
        salesTaxRate: "", asOfDate: todayYmd(), notes: "",
      });
      fetchAll();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to save opening balance.", "error");
    } finally {
      setSaving(false);
    }
  };

  // Single delete handler shared between the desktop table and the
  // mobile card so the confirm dialog stays consistent across viewports.
  const handleDeleteOpening = async (o) => {
    const ok = await confirm({
      title: "Delete opening balance?",
      message: `Remove the opening balance for "${o.itemTypeName}"? This won't affect movement-driven stock; only the seeded starting quantity is removed.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteOpeningBalance(o.id);
      fetchAll();
    } catch (err) {
      notify(err?.response?.data?.error || "Failed to delete opening balance.", "error");
    }
  };

  const closeAdjust = () => {
    setShowAdjust(false);
    setAdjustLockedItem(null);
    setAdjustDraft({
      itemTypeId: "", mode: "set", delta: 0, valueDelta: "", unitCost: "",
      targetQuantity: "", targetValue: "",
      actualValueDelta: "", targetActualCost: "", actualUnitCost: "",
      salesTaxRate: "",
      movementDate: todayYmd(), notes: "",
    });
  };

  // Per-row "Adjust" action on the on-hand grid: open the Adjustment modal
  // with the row's item pre-picked and locked — operator just enters the
  // delta. Header "Adjustment" button keeps the free item pick.
  const openAdjustForRow = (r) => {
    setAdjustLockedItem({ id: r.itemTypeId, name: r.itemTypeName, hsCode: r.hsCode, uom: r.uom });
    setAdjustDraft({
      itemTypeId: String(r.itemTypeId), mode: "set",
      delta: 0, valueDelta: "", unitCost: "",
      // Prefilled with what is on record, so the operator edits the figure
      // that is wrong and leaves the rest alone.
      targetQuantity: String(r.onHand ?? ""),
      targetValue: r.valueExcludingTax != null ? String(r.valueExcludingTax) : "",
      actualValueDelta: "",
      // Same "prefilled with what is on record" rule as targetValue above.
      targetActualCost: r.actualCostExcludingTax != null ? String(r.actualCostExcludingTax) : "",
      actualUnitCost: "",
      salesTaxRate: r.salesTaxRate ? String(r.salesTaxRate) : "",
      movementDate: todayYmd(), notes: "",
    });
    setShowAdjust(true);
  };

  // Expand/collapse the per-item movement drill-down. Pure toggle — the
  // fetch is driven by the effect below so a cache-clear (after an
  // adjustment / bill edit) re-loads an already-open row automatically.
  const toggleDrill = useCallback((itemTypeId) => {
    setExpandedId(prev => (prev === itemTypeId ? null : itemTypeId));
    setDrillTab("gd");
  }, []);
  // A focused row opens with Enter or Space, as a click would.
  const rowKey = (e, itemTypeId) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleDrill(itemTypeId); }
  };

  // Load the FULL movement history for the expanded item (paging through
  // all pages — the feed is small per item) so the operator sees every IN,
  // OUT, reversal and adjustment, not just the first page. Cached per item.
  useEffect(() => {
    if (expandedId == null || !canViewMovements || !selectedCompany) return;
    if (drill[expandedId]) return; // already cached
    let cancelled = false;
    (async () => {
      setDrillLoading(expandedId);
      try {
        let page = 1, all = [], total = 0, size = 0;
        do {
          const { data } = await getStockMovements(selectedCompany.id, { itemTypeId: expandedId, page });
          all = all.concat(data.items || []);
          total = data.totalCount || 0;
          size = data.pageSize || (data.items?.length || 0);
          page += 1;
          if (!size) break;
        } while (all.length < total);
        if (!cancelled) setDrill(prev => ({ ...prev, [expandedId]: all }));
      } catch {
        if (!cancelled) setDrill(prev => ({ ...prev, [expandedId]: [] }));
      } finally {
        if (!cancelled) setDrillLoading(null);
      }
    })();
    return () => { cancelled = true; };
  }, [expandedId, drill, canViewMovements, selectedCompany]);

  useEffect(() => {
    if (expandedId == null || !selectedCompany || gdDetails[expandedId]) return;
    let cancelled = false;
    setGdLoading(expandedId);
    getStockGdDetails(selectedCompany.id, expandedId)
      .then(({ data }) => { if (!cancelled) setGdDetails(prev => ({ ...prev, [expandedId]: data || [] })); })
      .catch(() => { if (!cancelled) setGdDetails(prev => ({ ...prev, [expandedId]: [] })); })
      .finally(() => { if (!cancelled) setGdLoading(null); });
    return () => { cancelled = true; };
  }, [expandedId, selectedCompany, gdDetails]);

  // Per LINE, not per GD: one declaration's items are often claimed in
  // different returns, which is how the clients' own sheets record them.
  const saveClaimMonth = async (line, month) => {
    await setLineClaimMonth(selectedCompany.id, line, month);
    const same = (r) => (line.lotId != null && r.lotId === line.lotId)
      || (line.consignmentLineId != null && r.consignmentLineId === line.consignmentLineId);
    setGdDetails(prev => {
      const next = {};
      for (const [id, rows] of Object.entries(prev))
        next[id] = rows.map(r => same(r) ? { ...r, claimMonth: month ? `${month}-01T00:00:00` : null } : r);
      return next;
    });
    notify(month ? "Claim month saved." : "Claim month cleared.", "success");
  };

  // Drop the drill cache + collapse whenever the company changes.
  useEffect(() => { setExpandedId(null); setDrill({}); setGdDetails({}); }, [selectedCompany]);

  // A narrower search, a different company or a smaller page can all strand
  // the operator past the last page.
  useEffect(() => { setOnhandPage(1); }, [search, selectedCompany, onhandPageSize]);

  const submitAdjust = async (e) => {
    e.preventDefault();
    if (!adjustDraft.itemTypeId) return notify("Pick an item.", "error");
    if (adjustDraft.mode === "set"
        && adjustDraft.targetQuantity === "" && adjustDraft.targetValue === ""
        && adjustDraft.targetActualCost === "")
      return notify("Say what the quantity, the value, or the actual cost should be.", "error");
    if (adjustDraft.mode === "delta"
        && !parseFloat(adjustDraft.delta) && !parseFloat(adjustDraft.valueDelta)
        && !parseFloat(adjustDraft.actualValueDelta))
      return notify("Give a quantity change, a value change, an actual-cost change, or some combination.", "error");
    if (saving) return;
    if (adjustmentLooksLikeSale(adjustCurrent, adjustDraft)) {
      const ok = await confirm({ title: "Were these goods sold?", message: SALE_WARNING, variant: "warning", confirmText: "Adjust anyway" });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const setMode = adjustDraft.mode === "set";
      const { data } = await adjustStock({
        companyId: selectedCompany.id,
        itemTypeId: parseInt(adjustDraft.itemTypeId),
        mode: adjustDraft.mode,
        delta: setMode ? 0 : parseFloat(adjustDraft.delta) || 0,
        valueDelta: setMode ? null : parseFloat(adjustDraft.valueDelta) || null,
        targetQuantity: setMode && adjustDraft.targetQuantity !== ""
          ? parseFloat(adjustDraft.targetQuantity) : null,
        targetValueExcludingTax: setMode && adjustDraft.targetValue !== ""
          ? parseFloat(adjustDraft.targetValue) : null,
        unitCostExcludingTax: setMode ? null : parseFloat(adjustDraft.unitCost) || null,
        // Actual-cost mirror of the three fields above — stays null (a no-op
        // on the server) whenever the operator never touched it, which is
        // also what happens when the input is hidden for someone without
        // stock.actualcost.view.
        targetActualCostExcludingTax: setMode && adjustDraft.targetActualCost !== ""
          ? parseFloat(adjustDraft.targetActualCost) : null,
        actualValueDelta: setMode ? null : parseFloat(adjustDraft.actualValueDelta) || null,
        actualUnitCostExcludingTax: setMode ? null : parseFloat(adjustDraft.actualUnitCost) || null,
        salesTaxRate: parseFloat(adjustDraft.salesTaxRate) || null,
        movementDate: adjustDraft.movementDate,
        notes: adjustDraft.notes || null,
      });
      notify(data?.message || "Adjustment recorded.", "success");
      closeAdjust();
      fetchAll();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to record adjustment.", "error");
    } finally {
      setSaving(false);
    }
  };

  // UOM-driven decimal rule for the modal quantity inputs. Each ItemType
  // carries a UOM string; whether that unit allows fractional quantities is
  // configured per-Unit (AllowsDecimalQuantity) on the Units page. Unknown
  // UOMs fall back to whole-numbers-only, same as the bill / challan forms.
  // Live read-back of the two derived figures, so the operator sees the same
  // Sales Tax / Including numbers the grid will show before saving.
  const openingValuePreview = (() => {
    const excl = parseFloat(openingDraft.valueExcludingTax);
    const rate = parseFloat(openingDraft.salesTaxRate);
    if (!(excl > 0) || !(rate > 0)) return null;
    const tax = Math.round(excl * rate) / 100;
    return { tax: money(tax), incl: money(excl + tax) };
  })();

  // Live margin preview while the operator types: selling value less actual
  // cost. Only shown once a positive cost is entered — a blank/zero cost
  // means "not known", not "free", so there is nothing honest to preview yet.
  const openingMarginPreview = (() => {
    const sell = parseFloat(openingDraft.valueExcludingTax);
    const cost = parseFloat(openingDraft.actualCostExcludingTax);
    if (!isFinite(sell) || !isFinite(cost) || cost <= 0) return null;
    const margin = sell - cost;
    const pct = sell > 0 ? (margin * 100) / sell : 0;
    return { margin, pct };
  })();

  const openingItem = itemTypes.find(it => String(it.id) === String(openingDraft.itemTypeId));
  const openingUom = openingItem?.uom || "";
  const openingAllowsDecimal = isDecimalUnit(openingUom, units);
  // Fall back to the locked row's UOM when the catalog lookup misses
  // (e.g. soft-deleted item type still present in the grid).
  // What the grid currently says about the picked item. The dialog needs it
  // to show "currently x, worth y" and to compute the change it is about to
  // make; an item with no stock yet simply has no row and reads as zeros.
  const adjustCurrent = onhand.find(r => String(r.itemTypeId) === String(adjustDraft.itemTypeId)) || null;

  // Spell out the change the server is about to make, in the operator's own
  // figures, so "correct it to" never feels like a guess.
  const adjustPlan = (() => {
    if (adjustDraft.mode !== "set" || !adjustCurrent) return null;
    const curQty = Number(adjustCurrent.onHand || 0);
    const curVal = Number(adjustCurrent.valueExcludingTax || 0);
    const tQty = adjustDraft.targetQuantity === "" ? curQty : parseFloat(adjustDraft.targetQuantity);
    const tVal = adjustDraft.targetValue === "" ? curVal : parseFloat(adjustDraft.targetValue);
    if (Number.isNaN(tQty) || Number.isNaN(tVal)) return null;
    const dQty = tQty - curQty;
    const dVal = tVal - curVal;
    const rate = parseFloat(adjustDraft.salesTaxRate) || Number(adjustCurrent.salesTaxRate || 0);
    const tax = Math.round(tVal * rate) / 100;
    return {
      qtyText: dQty === 0 ? "No change to the quantity."
        : `${dQty > 0 ? "Adds" : "Removes"} ${num(Math.abs(dQty))}.`,
      valueText: dVal === 0 ? "No change to the value."
        : `${dVal > 0 ? "Adds" : "Removes"} ${money(Math.abs(dVal))}.`,
      result: `Result: ${num(tQty)} · ${money(tVal)} excl · tax ${money(tax)} · including ${money(tVal + tax)}`,
    };
  })();

  // Live margin preview while the operator types an actual-cost correction —
  // selling value less actual cost, in either mode. Same shape the Opening
  // Balances tab's preview already uses (a blank/zero cost reads as "not
  // known", not "free", so no preview until there is a real one to show), so
  // a mistyped cost is visible before saving rather than after.
  const adjustMarginPreview = (() => {
    if (!adjustCurrent) return null;
    const curVal = Number(adjustCurrent.valueExcludingTax || 0);
    const curActual = Number(adjustCurrent.actualCostExcludingTax || 0);
    let sell, cost;
    if (adjustDraft.mode === "set") {
      sell = adjustDraft.targetValue === "" ? curVal : parseFloat(adjustDraft.targetValue);
      cost = adjustDraft.targetActualCost === "" ? curActual : parseFloat(adjustDraft.targetActualCost);
    } else {
      sell = curVal + (parseFloat(adjustDraft.valueDelta) || 0);
      cost = curActual + (parseFloat(adjustDraft.actualValueDelta) || 0);
    }
    if (!isFinite(sell) || !isFinite(cost) || cost <= 0) return null;
    const margin = sell - cost;
    return { margin, pct: sell > 0 ? (margin * 100) / sell : null };
  })();

  const adjustItem = itemTypes.find(it => String(it.id) === String(adjustDraft.itemTypeId)) || adjustLockedItem;
  const adjustUom = adjustItem?.uom || "";
  const adjustAllowsDecimal = isDecimalUnit(adjustUom, units);

  // Both pickers offer exactly what this company STOCK-TRACKS, and the server
  // decides that (V1 = HS-coded only, V2 = everything, per-company overrides
  // win either way). The page used to offer the whole catalog while telling the
  // operator that HS-less items were hidden -- on a V2 company all 335 of them
  // were selectable and the hint was simply false. Offering an untracked item
  // is worse than cosmetic: the engine will never move it, so the operator
  // would be seeding a position that can never change.
  const trackable = (it) => trackedIds === null || trackedIds.has(it.id);
  const onhandIds = new Set(onhand.map(r => r.itemTypeId));

  // Opening Balance ADDS a day-zero figure, so it offers only items that do not
  // have one yet; restating an existing opening is the Edit action on the list
  // below, which is a correction of a recorded fact rather than a movement.
  const openingPickerItems = itemTypes.filter(
    it => trackable(it) && !onhandIds.has(it.id));

  // Adjust changes a COUNT, so it offers every tracked item whether or not it
  // was ever opened -- recording found stock on an item with no opening is
  // exactly what it is for.
  const adjustPickerItems = itemTypes.filter(trackable);

  // Tools menu: each entry keeps the gate it had as a header button. Reconcile
  // and Split sat inside the FIFO export block, so they keep that condition.
  const canReconcile = canExport && !!selectedCompany && isFifo && canManagePolicy;
  const canSwitchV2 = canManagePolicy && !!selectedCompany && flowVersion !== 2;
  const showTools = canReconcile || canViewActualCost || canSwitchV2;
  const showCostTiles = canViewActualCost && onhandTotals.actual > 0;
  const onhandMargin = onhandTotals.excl - onhandTotals.actual;

  return (
    <div className="stock-page stk">
      <header className="stk-head">
        <div style={{ minWidth: 0 }}>
          <h2>Stock</h2>
          <div className="stk-sub">
            {selectedCompany
              ? `${selectedCompany.brandName || selectedCompany.name}${loadedAt ? ` · as of ${loadedAt.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}`
              : "Select a company"}
          </div>
          {/* What the company is set to sits with the title it describes. */}
          {selectedCompany && (
            <div className="stk-chips">
              <span
                className={`stk-chip${flowVersion === 2 ? "" : " grey"}`}
                title={flowVersion === 2
                  ? "V2 Standard Inventory — all item types are tracked; HS code is FBR metadata only."
                  : "V1 Legacy — only HS-coded item types are stock-tracked."}
              >
                {flowVersion === 2 ? "Inventory V2 · Standard" : "Inventory V1 · Legacy"}
              </span>
              <span
                className={`stk-chip${isFifo ? "" : " grey"}`}
                title={isFifo
                  ? "Stock is valued FIFO by GD: a sale uses claimed GDs first, oldest GD date first, then unclaimed GDs."
                  : "Stock is valued at the weighted average of everything held."}
              >
                {isFifo ? "Costing · FIFO by GD" : "Costing · Weighted average"}
              </span>
            </div>
          )}
        </div>
        <div className="stk-actions">
          {!loadingCompanies && companies.length > 1 && (
            <select className="stk-select" aria-label="Company" value={selectedCompany?.id || ""}
                    onChange={e => setSelectedCompany(companies.find(c => parseInt(c.id) === parseInt(e.target.value)))}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          )}
          {canAdjust && (
            <button type="button" className="stk-btn primary" onClick={() => { setAdjustLockedItem(null); setShowAdjust(true); }}>
              <MdSwapHoriz size={16} /> Adjustment
            </button>
          )}
          {canManageOpening && (
            <button type="button" className="stk-btn" onClick={startAddOpening}>
              <MdAdd size={16} /> Opening balance
            </button>
          )}
          {canExport && selectedCompany && (
            <StockMenu label={exporting ? "Preparing…" : "Export"} icon={<MdFileDownload size={16} />} busy={exporting}>
              <StockMenuItem
                title={exporting ? "Preparing…" : "Stock sheet (Excel)"}
                hint="One row per item · Opening / Consumed / Balance · follows the search"
                onClick={downloadExcel}
                disabled={exporting || loading}
                aria-label="Export Excel stock sheet"
              />
              {isFifo && (
                <>
                  <div className="stk-sep" role="separator" />
                  <div className="stk-mlbl">Monthly (FIFO)</div>
                  <label className="stk-monthrow">
                    Month
                    <input
                      type="month"
                      className="stk-input"
                      value={sheetMonth}
                      max={todayYmd().slice(0, 7)}
                      onChange={(e) => setSheetMonth(e.target.value)}
                      aria-label="Month for the monthly stock sheet and Annex-H1"
                    />
                  </label>
                  <StockMenuItem
                    title="Monthly stock sheet"
                    hint="One row per GD line: Opening on the 1st, the month's Consumed at FIFO cost, Balance at month end"
                    onClick={downloadMonthly}
                    disabled={exporting || loading || !sheetMonth}
                  />
                  <StockMenuItem
                    title="Annex-H1"
                    hint="Per HS code, unit and rate: opening, purchased/imported, supplies and closing at cost"
                    onClick={downloadAnnexH1}
                    disabled={exporting || loading || !sheetMonth}
                  />
                </>
              )}
            </StockMenu>
          )}
          {showTools && (
            <StockMenu label="Tools" icon={<MdBuild size={15} />}>
              {canReconcile && (
                <StockMenuItem as={Link} to="/stock/reconcile" title="Reconcile to my stock sheet"
                  hint="Upload the month's stock sheet and bring the books in line with it, GD by GD" />
              )}
              {canReconcile && (
                <StockMenuItem as={Link} to="/stock/split" title="Split an item"
                  hint="Move GD lines that are really a different product to their own item" />
              )}
              {canViewActualCost && (
                <StockMenuItem title="Cost history" hint="Every change to landed cost, company-wide"
                  onClick={() => setCostHistoryItem({})} />
              )}
              {/* V2 is one-way. Under V2 every item type is inventory, so a company
                  builds up positions on items V1 does not track; going back would
                  hide them rather than remove them, which reads as stock vanishing.
                  The server refuses it too -- this only stops us offering a button
                  whose answer is always no. */}
              {canSwitchV2 && (
                <>
                  {(canReconcile || canViewActualCost) && <div className="stk-sep" role="separator" />}
                  <StockMenuItem title="Switch to Inventory V2"
                    hint="Standard inventory for every item type. This cannot be undone."
                    onClick={switchVersion} />
                </>
              )}
            </StockMenu>
          )}
        </div>
      </header>

      {loadingCompanies ? (
        <div className="stk-loading"><div className="stk-spinner" /></div>
      ) : companies.length === 0 ? (
        <div className="stk-empty">No companies available.</div>
      ) : (
        <>
          {/* GDs dated before the last stock-sheet match: one-step fix. */}
          {selectedCompany && <LateGdMatchPanel companyId={selectedCompany.id} onDone={fetchAll} />}
          {selectedCompany && !selectedCompany.inventoryTrackingEnabled && (
            <div className="stk-banner" role="status">
              ⚠ Inventory tracking is OFF for this company. Stock IN / OUT movements are not being recorded automatically.
              You can still record opening balances and manual adjustments here, then enable tracking on the Company settings to begin auto-tracking purchases and sales.
            </div>
          )}

          {/* Totals follow the search, over the whole filtered set rather than
              the page on screen. */}
          {!loading && filteredOnhand.length > 0 && (tab === "onhand" || tab === "inventory") && (
            <div className="stk-kpis">
              <Kpi label="Quantity" value={num(onhandTotals.qty)} sub={`${filteredOnhand.length} items`} />
              <Kpi label="Excluding tax" value={money(onhandTotals.excl)} sub="Value before sales tax" />
              <Kpi label="Sales tax" value={money(onhandTotals.tax)} sub="At each item's rate" />
              <Kpi label="Including tax" value={money(onhandTotals.incl)} sub="Excluding + sales tax" tone="t" />
              {/* Landed cost and the margin over it. Shown only when a costing
                  import has actually supplied an actual cost (otherwise these
                  would read 0 and imply the stock cost nothing), and only to
                  someone allowed to see actual cost. */}
              {showCostTiles && (
                <Kpi label="Landed cost" value={money(onhandTotals.actual)} sub="What the stock cost" tone="o" />
              )}
              {showCostTiles && (
                <Kpi label="Margin over cost" value={money(onhandMargin)} sub="Excluding − landed" tone="g"
                  negative={onhandMargin < 0} />
              )}
            </div>
          )}

          <div className="stk-card">
            <div className="stk-tabs" role="tablist" aria-label="Stock views">
              <TabBtn active={tab === "onhand"} onClick={() => setTab("onhand")} count={onhand.length}>On hand</TabBtn>
              {summary.length > 0 && <TabBtn active={tab === "inventory"} onClick={() => setTab("inventory")} count={summary.length}>Inventory</TabBtn>}
              {canManageOpening && <TabBtn active={tab === "opening"} onClick={() => setTab("opening")} count={openings.length}>Opening balances</TabBtn>}
              {canViewMovements && <TabBtn active={tab === "movements"} onClick={() => setTab("movements")} count={movTotal}>Movements</TabBtn>}
            </div>

            {tab === "onhand" && (
              <section role="tabpanel" aria-label="On hand">
                {/* Search renders whenever there is ANY stock data — gating it
                    on the FILTERED list meant a no-match search unmounted the
                    box itself and the operator had no way to clear it. */}
                {onhand.length > 0 && (
                  <div className="stk-toolbar">
                    <SearchBox value={search} onChange={setSearch} />
                    <span className="stk-grow" />
                    {onhandPicker}
                  </div>
                )}
                {loading ? (
                  <div className="stk-loading"><div className="stk-spinner" /></div>
                ) : filteredOnhand.length === 0 ? (
                  <div className="stk-empty">
                    <MdInventory size={40} />
                    {search ? (
                      <>
                        <p>No items match "{search}".</p>
                        <button type="button" className="stk-btn" onClick={() => setSearch("")}>
                          Clear search
                        </button>
                      </>
                    ) : (
                      <p>
                        No stock data yet. Set opening balances or post a Purchase Bill / FBR-submitted invoice to start tracking.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Desktop / tablet — table. The code, unit and last
                        movement sit under the item name, and the opening / IN /
                        OUT flow sits under the on-hand figure it explains. */}
                    <div className="stock-table stk-tw">
                      <table className="stk-table">
                        <thead>
                          <tr>
                            <th style={{ width: 28 }} aria-label="Expand item details"></th>
                            {(showOnhandCol("item") || showOnhandCol("gd")) && <th>{showOnhandCol("item") ? "Item" : "GD No"}</th>}
                            {showOnhandCol("onhand") && <th className="num">On-Hand</th>}
                            {showOnhandCol("excl") && <th className="num">Excluding</th>}
                            {showOnhandCol("tax") && <th className="num">Sales Tax</th>}
                            {showOnhandCol("incl") && <th className="num">Including</th>}
                            {canViewActualCost && showOnhandCol("actual") && <th className="num">Actual Cost</th>}
                            {canViewActualCost && showOnhandCol("margin") && <th className="num">Margin</th>}
                            {(canAdjust || canViewActualCost) && <th style={{ width: 60 }} aria-label="Actions"></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {onhandPageRows.map((r) => {
                            const isOpen = expandedId === r.itemTypeId;
                            const colCount = 1
                              + ((showOnhandCol("item") || showOnhandCol("gd")) ? 1 : 0)
                              + ["onhand", "excl", "tax", "incl"].filter(showOnhandCol).length
                              + (canViewActualCost ? ["actual", "margin"].filter(showOnhandCol).length : 0)
                              + ((canAdjust || canViewActualCost) ? 1 : 0);
                            return (
                            <Fragment key={r.itemTypeId}>
                            <tr
                              className={`stk-row${isOpen ? " open" : ""}`}
                              tabIndex={0}
                              aria-expanded={isOpen}
                              onClick={() => toggleDrill(r.itemTypeId)}
                              onKeyDown={(e) => rowKey(e, r.itemTypeId)}
                            >
                              <td><span className="stk-chev">{isOpen ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}</span></td>
                              {(showOnhandCol("item") || showOnhandCol("gd")) && (
                              <td>
                                {/* Clamped, never ellipsised on one line: two
                                    item names sharing a prefix must stay
                                    distinguishable (dashboard incident
                                    2026-05-13). The GD chips sit under the
                                    name so the table needs no GD column. */}
                                {showOnhandCol("item") && (
                                  <>
                                    <div className="stk-name">{r.itemTypeName}</div>
                                    <div className="stk-meta">
                                      <span className="stk-mono">{r.hsCode || "no HS code"}</span>
                                      {r.uom && <span>{r.uom}</span>}
                                      <span>
                                        {r.lastMovementAt
                                          ? `moved ${new Date(r.lastMovementAt).toLocaleDateString()}`
                                          : "no movements"}
                                      </span>
                                    </div>
                                  </>
                                )}
                                {showOnhandCol("gd") && <div className="stk-sub-gds"><GdList gds={r.gdNumbers} /></div>}
                              </td>
                              )}
                              {showOnhandCol("onhand") && (
                              <td className="num">
                                <div style={{ fontWeight: 700, color: r.onHand < 0 ? "var(--dash-negative)" : "var(--dash-primary)" }}>
                                  {fmtOnHand(r.onHand)}
                                </div>
                                {/* Opening / in / out, each as quantity and the
                                    money against it (the opening's stored value
                                    and the valuation walk's own ValueIn /
                                    ValueOut, all from the API row). */}
                                <div className="stk-flow">
                                  <span title="Opening balance">{num(r.openingBalance)}</span>
                                  <span title="Opening value, excluding tax">{money(r.openingValueExcludingTax)}</span>
                                  <span className="pos" title="Total in">+{num(r.totalIn)}</span>
                                  <span className="pos" title="Value in, excluding tax">+{money(r.valueIn)}</span>
                                  <span className="neg" title="Total out">−{num(r.totalOut)}</span>
                                  <span className="neg" title="Value out, excluding tax">−{money(r.valueOut)}</span>
                                </div>
                              </td>
                              )}
                              {showOnhandCol("excl") && <td className="num">{money(r.valueExcludingTax)}</td>}
                              {showOnhandCol("tax") && (
                              <td className="num">
                                <div>{money(r.salesTax)}</div>
                                <div className="stk-rate">
                                  {r.salesTaxRate ? `${num(r.salesTaxRate)}%` : "no rate"}
                                </div>
                              </td>
                              )}
                              {showOnhandCol("incl") && <td className="num" style={{ fontWeight: 700 }}>{money(r.valueIncludingTax)}</td>}
                              {canViewActualCost && showOnhandCol("actual") && (
                                <td className="num" style={{ color: "var(--dash-text)" }}>
                                  {r.actualCostExcludingTax ? money(r.actualCostExcludingTax) : "—"}
                                </td>
                              )}
                              {canViewActualCost && showOnhandCol("margin") && (
                                <td className={`num${r.margin < 0 ? " neg" : ""}`} style={{ fontWeight: 600 }}>
                                  {money(r.margin)}
                                  <div>
                                    {r.marginPercent != null
                                      ? <span className={`stk-pct${r.margin < 0 ? " neg" : ""}`}>{num(r.marginPercent)}%</span>
                                      : <span className="stk-rate">—</span>}
                                  </div>
                                </td>
                              )}
                              {(canAdjust || canViewActualCost) && (
                                <td className="stk-acts" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                                  {canAdjust && (
                                    <button type="button" className="stk-ib" onClick={() => openAdjustForRow(r)}
                                      title={`Record a stock adjustment for ${r.itemTypeName}`} aria-label={`Adjust ${r.itemTypeName}`}>
                                      <MdSwapHoriz size={16} />
                                    </button>
                                  )}
                                  {canViewActualCost && (
                                    <button
                                      type="button" className="stk-ib"
                                      onClick={() => setCostHistoryItem({ itemTypeId: r.itemTypeId, itemTypeName: r.itemTypeName })}
                                      title={`What changed the actual cost of ${r.itemTypeName}`}
                                      aria-label={`Cost history for ${r.itemTypeName}`}
                                    >
                                      <MdHistory size={16} />
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                            {isOpen && (
                              <tr className="stk-drow">
                                <td colSpan={colCount}>
                                  <OnhandDrill
                                    row={r} tab={drillTab} onTab={setDrillTab}
                                    gdRows={gdDetails[r.itemTypeId]} gdLoading={gdLoading === r.itemTypeId}
                                    moves={drill[r.itemTypeId]} movesLoading={drillLoading === r.itemTypeId}
                                    canViewMovements={canViewMovements} canEdit={canManageOpening}
                                    onSave={saveClaimMonth} canViewActualCost={canViewActualCost}
                                  />
                                </td>
                              </tr>
                            )}
                            </Fragment>
                            );
                          })}
                        </tbody>
                        {/* The whole filtered set, like the tiles above -- not just this page. */}
                        <tfoot>
                          <tr>
                            <td colSpan={1 + ((showOnhandCol("item") || showOnhandCol("gd")) ? 1 : 0)}>
                              Total · {filteredOnhand.length} items
                            </td>
                            {showOnhandCol("onhand") && <td className="num">{num(onhandTotals.qty)}</td>}
                            {showOnhandCol("excl") && <td className="num">{money(onhandTotals.excl)}</td>}
                            {showOnhandCol("tax") && <td className="num">{money(onhandTotals.tax)}</td>}
                            {showOnhandCol("incl") && <td className="num">{money(onhandTotals.incl)}</td>}
                            {canViewActualCost && showOnhandCol("actual") && (
                              <td className="num">{onhandTotals.actual > 0 ? money(onhandTotals.actual) : "—"}</td>
                            )}
                            {canViewActualCost && showOnhandCol("margin") && (
                              <td className={`num${onhandTotals.actual > 0 && onhandMargin < 0 ? " neg" : ""}`}>
                                {onhandTotals.actual > 0 ? money(onhandMargin) : "—"}
                              </td>
                            )}
                            {(canAdjust || canViewActualCost) && <td />}
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Mobile — On-hand stack. The "answer" the page exists to
                        show is on-hand quantity, so it goes top-right at large
                        size. IN / OUT / Opening are secondary stats below. */}
                    <div className="stock-cards stk-cards">
                      {onhandPageRows.map((r) => {
                        const isOpen = expandedId === r.itemTypeId;
                        return (
                        <div key={r.itemTypeId} className="stock-card">
                          <div className="stock-card__top">
                            <div className="stock-card__top-left">
                              {showOnhandCol("gd") && r.gdNumbers?.length > 0 && (
                                <span className="stock-card__hs">GD {r.gdNumbers.join(", ")}</span>
                              )}
                              <span className="stock-card__name stk-name" style={{ minWidth: 0, maxWidth: "none" }}>{r.itemTypeName}</span>
                              {r.hsCode && <span className="stock-card__hs">{r.hsCode}</span>}
                            </div>
                            <div className="stock-card__onhand">
                              <span className="stock-card__onhand-label">On-Hand</span>
                              <span
                                className="stock-card__onhand-value"
                                style={{ color: r.onHand < 0 ? "var(--dash-negative)" : "var(--dash-primary)" }}
                              >
                                {fmtOnHand(r.onHand)}
                                {r.uom && <span className="stock-card__uom"> {r.uom}</span>}
                              </span>
                            </div>
                          </div>
                          <div className="stock-card__stats">
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">Opening</span>
                              <span className="stock-card__stat-value">{r.openingBalance.toLocaleString()}</span>
                              <span className="stk-rate">{money(r.openingValueExcludingTax)}</span>
                            </div>
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">Total IN</span>
                              <span className="stock-card__stat-value pos">+{r.totalIn.toLocaleString()}</span>
                              <span className="stk-rate">{money(r.valueIn)}</span>
                            </div>
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">Total OUT</span>
                              <span className="stock-card__stat-value neg">−{r.totalOut.toLocaleString()}</span>
                              <span className="stk-rate">{money(r.valueOut)}</span>
                            </div>
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">Excluding</span>
                              <span className="stock-card__stat-value">{money(r.valueExcludingTax)}</span>
                            </div>
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">Sales Tax{r.salesTaxRate ? ` (${num(r.salesTaxRate)}%)` : ""}</span>
                              <span className="stock-card__stat-value">{money(r.salesTax)}</span>
                            </div>
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">Including</span>
                              <span className="stock-card__stat-value" style={{ fontWeight: 700 }}>{money(r.valueIncludingTax)}</span>
                            </div>
                            {canViewActualCost && (
                              <div className="stock-card__stat">
                                <span className="stock-card__stat-label">Actual Cost</span>
                                <span className="stock-card__stat-value">
                                  {r.actualCostExcludingTax ? money(r.actualCostExcludingTax) : "—"}
                                </span>
                              </div>
                            )}
                            {canViewActualCost && (
                              <div className="stock-card__stat">
                                <span className="stock-card__stat-label">Margin</span>
                                <span className={`stock-card__stat-value${r.margin < 0 ? " neg" : ""}`}>
                                  {money(r.margin)} {r.marginPercent != null ? `(${num(r.marginPercent)}%)` : "(—)"}
                                </span>
                              </div>
                            )}
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">Last Move</span>
                              <span className="stock-card__stat-value stock-card__stat-value--muted">
                                {r.lastMovementAt ? new Date(r.lastMovementAt).toLocaleDateString() : "—"}
                              </span>
                            </div>
                          </div>
                          <button type="button" className="stk-btn" style={cardBtn} aria-expanded={isOpen} onClick={() => toggleDrill(r.itemTypeId)}>
                            {isOpen ? <MdExpandMore size={16} /> : <MdChevronRight size={16} />}
                            {isOpen ? "Hide GD details" : "View GD details"}
                          </button>
                          {isOpen && (
                            <OnhandDrill
                              row={r} tab={drillTab} onTab={setDrillTab}
                              gdRows={gdDetails[r.itemTypeId]} gdLoading={gdLoading === r.itemTypeId}
                              moves={drill[r.itemTypeId]} movesLoading={drillLoading === r.itemTypeId}
                              canViewMovements={canViewMovements} canEdit={canManageOpening}
                              onSave={saveClaimMonth} canViewActualCost={canViewActualCost}
                            />
                          )}
                          {canAdjust && (
                            <button type="button" className="stk-btn primary" style={cardBtn} onClick={() => openAdjustForRow(r)}>
                              <MdSwapHoriz size={15} /> Adjustment
                            </button>
                          )}
                          {canViewActualCost && (
                            <button
                              type="button" className="stk-btn" style={cardBtn}
                              onClick={() => setCostHistoryItem({ itemTypeId: r.itemTypeId, itemTypeName: r.itemTypeName })}
                            >
                              <MdHistory size={15} /> Cost history
                            </button>
                          )}
                        </div>
                        );
                      })}
                    </div>

                    {/* One pager below both renders -- they are the desktop and
                        phone views of the same page. The totals above still
                        cover the whole filtered set, not this page. */}
                    <div className="stk-pager">
                      <Pagination
                        page={onhandPage}
                        totalPages={onhandTotalPages}
                        total={filteredOnhand.length}
                        onPage={setOnhandPage}
                        pageSize={onhandSize}
                        onPageSize={setOnhandPageSize}
                        unit="items"
                      />
                    </div>
                  </>
                )}
              </section>
            )}

            {tab === "inventory" && (
              <section role="tabpanel" aria-label="Inventory">
                {summary.length > 0 && (
                  <div className="stk-toolbar">
                    <SearchBox value={search} onChange={setSearch} />
                    <span className="stk-grow" />
                    {inventoryPicker}
                  </div>
                )}
                {loading ? (
                  <div className="stk-loading"><div className="stk-spinner" /></div>
                ) : filteredSummary.length === 0 ? (
                  <div className="stk-empty">
                    <MdInventory size={40} />
                    <p>{search ? `No items match "${search}".` : "No inventory activity yet."}</p>
                  </div>
                ) : (
                  <>
                  {/* Desktop / tablet — table */}
                  <div className="stock-table stk-tw">
                    <table className="stk-table">
                      <thead>
                        {(() => {
                          // Two-tier header: the figures are grouped by what they
                          // answer, so a dozen numeric columns read as four ideas.
                          const qty = ["instock", "available", "committed", "todeliver", "delivered", "incoming"].filter(showInvCol);
                          const flow = invFlowCell ? 1 : 0;
                          const hand = ["excl", "tax", "incl"].filter(showInvCol);
                          const cost = invCostCell ? 1 : 0;
                          const lead = 1 + (invItemCell ? 1 : 0);
                          const band = (n, label, tint) => n > 0 && (
                            <th colSpan={n} className="band" style={{ background: tint }}>{label}</th>
                          );
                          return (
                            <>
                              <tr>
                                <th colSpan={lead} />
                                {band(qty.length, "Quantity", "var(--dash-band-qty)")}
                                {band(flow, "Value movement", "var(--dash-band-flow)")}
                                {band(hand.length, "In hand", "var(--dash-primary)")}
                                {band(cost, "Cost & margin", "var(--dash-positive)")}
                              </tr>
                              <tr>
                                <th style={{ width: 28 }} aria-label="Expand stock ledger"></th>
                                {invItemCell && <th>{showInvCol("item") ? "Item" : "HS Code"}</th>}
                                {showInvCol("instock") && <th className="num" title="Physical stock in hand">In Stock</th>}
                                {showInvCol("available") && <th className="num" title="Free to sell = In Stock - Committed">Available</th>}
                                {showInvCol("committed") && <th className="num" title="Reserved to customers = To Deliver + Delivered">Committed</th>}
                                {showInvCol("todeliver") && <th className="num" title="Ordered, not yet delivered">To Deliver</th>}
                                {showInvCol("delivered") && <th className="num" title="Delivered on a challan, not yet billed">Delivered</th>}
                                {showInvCol("incoming") && <th className="num" title="On un-billed goods receipts">Incoming</th>}
                                {invFlowCell && (
                                  <th className="num" title="In: value that came in (opening / GD stock plus purchases). Out: value that went out on invoices and other stock out. Both excluding tax.">
                                    {[showInvCol("valuein") && "In", showInvCol("valueout") && "Out"].filter(Boolean).join(" / ")}
                                  </th>
                                )}
                                {showInvCol("excl") && <th className="num" title="Value of the stock in hand, excluding tax">Excl.</th>}
                                {showInvCol("tax") && <th className="num" title="Sales tax on the stock in hand">S.Tax</th>}
                                {showInvCol("incl") && <th className="num" title="Value including sales tax">Incl.</th>}
                                {invCostCell && (
                                  <th className="num" title="Landed: cost of the stock in hand. Margin: excluding value less landed cost.">
                                    {[showInvCol("actual") && "Landed", showInvCol("margin") && "Margin"].filter(Boolean).join(" / ")}
                                  </th>
                                )}
                              </tr>
                            </>
                          );
                        })()}
                      </thead>
                      <tbody>
                        {filteredSummary.map((r) => {
                          const isOpen = expandedId === r.itemTypeId;
                          const colCount = 1 + (invItemCell ? 1 : 0) + inventoryTracked;
                          return (
                          <Fragment key={r.itemTypeId}>
                          <tr
                            className={`stk-row${isOpen ? " open" : ""}`}
                            tabIndex={0}
                            aria-expanded={isOpen}
                            onClick={() => toggleDrill(r.itemTypeId)}
                            onKeyDown={(e) => rowKey(e, r.itemTypeId)}
                          >
                            <td><span className="stk-chev">{isOpen ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}</span></td>
                            {invItemCell && (
                            <td>
                              {showInvCol("item") && <div className="stk-name">{r.itemTypeName}</div>}
                              {(showInvCol("hs") || (showInvCol("item") && (!r.tracked || (r.reorderLevel != null && r.available <= r.reorderLevel)))) && (
                                <div className="stk-meta">
                                  {showInvCol("hs") && <span className="stk-mono">{r.hsCode || "—"}</span>}
                                  {showInvCol("hs") && r.uom && <span>{r.uom}</span>}
                                  {showInvCol("item") && !r.tracked && (
                                    <span className="stk-badge" title="FBR-reporting item — not tracked as inventory">FBR-only</span>
                                  )}
                                  {showInvCol("item") && r.reorderLevel != null && r.available <= r.reorderLevel && (
                                    <span className="stk-badge low" title={`At/below reorder level ${r.reorderLevel}`}>Low</span>
                                  )}
                                </div>
                              )}
                            </td>
                            )}
                            {r.tracked ? (
                              <>
                                {showInvCol("instock") && <td className="num" style={{ fontWeight: 700, color: r.onHand < 0 ? "var(--dash-negative)" : "var(--dash-primary)" }}>{fmtOnHand(r.onHand)}</td>}
                                {showInvCol("available") && <td className="num" style={{ fontWeight: 700, color: r.available < 0 ? "var(--dash-negative)" : "var(--dash-secondary)" }}>{r.available.toLocaleString()}</td>}
                                {showInvCol("committed") && <td className="num">{r.committed.toLocaleString()}</td>}
                                {showInvCol("todeliver") && <td className="num">{r.toDeliver.toLocaleString()}</td>}
                                {showInvCol("delivered") && <td className="num">{r.delivered.toLocaleString()}</td>}
                                {showInvCol("incoming") && <td className="num">{r.incoming.toLocaleString()}</td>}
                                <InventoryValueCells o={onhandById.get(r.itemTypeId)} show={showInvCol} canViewActualCost={canViewActualCost} />
                              </>
                            ) : inventoryTracked > 0 && (
                              <td style={{ textAlign: "center", color: "var(--dash-text)" }} colSpan={inventoryTracked}>—</td>
                            )}
                          </tr>
                          {isOpen && (
                            <tr className="stk-drow">
                              <td colSpan={colCount}>
                                <div className="stk-drill">
                                  <StockLedgerPanel
                                    gdRows={gdDetails[r.itemTypeId]} gdLoading={gdLoading === r.itemTypeId}
                                    movements={canViewMovements ? drill[r.itemTypeId] : []}
                                    movementsLoading={canViewMovements && drillLoading === r.itemTypeId}
                                    canViewMovements={canViewMovements}
                                    openingQty={onhandById.get(r.itemTypeId)?.openingBalance}
                                    onHand={r.onHand} uom={r.uom}
                                    position={onhandById.get(r.itemTypeId)}
                                    showCol={showLedgerCol} picker={ledgerPicker} canViewActualCost={canViewActualCost}
                                  />
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile — inventory (V2 buckets) stack. In Stock is the
                      headline metric; the reservation buckets are secondary
                      stats below. Untracked (FBR-only) items show a note. */}
                  <div className="stock-cards stk-cards">
                    {filteredSummary.map((r) => (
                      <div key={r.itemTypeId} className="stock-card">
                        <div className="stock-card__top">
                          <div className="stock-card__top-left">
                            <span className="stock-card__name stk-name" style={{ minWidth: 0, maxWidth: "none" }}>{r.itemTypeName}</span>
                            {showInvCol("hs") && r.hsCode && <span className="stock-card__hs">{r.hsCode}</span>}
                            {(!r.tracked || (r.reorderLevel != null && r.available <= r.reorderLevel)) && (
                              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: 2 }}>
                                {!r.tracked && (
                                  <span className="stk-badge" title="FBR-reporting item — not tracked as inventory">FBR-only</span>
                                )}
                                {r.reorderLevel != null && r.available <= r.reorderLevel && (
                                  <span className="stk-badge low" title={`At/below reorder level ${r.reorderLevel}`}>Low</span>
                                )}
                              </div>
                            )}
                          </div>
                          {r.tracked && (
                            <div className="stock-card__onhand">
                              <span className="stock-card__onhand-label">In Stock</span>
                              <span className="stock-card__onhand-value" style={{ color: r.onHand < 0 ? "var(--dash-negative)" : "var(--dash-primary)" }}>
                                {fmtOnHand(r.onHand)}
                              </span>
                            </div>
                          )}
                        </div>
                        {r.tracked ? (
                          <div className="stock-card__stats">
                            {(() => { const o = onhandById.get(r.itemTypeId); if (!o) return null; return (<>
                              {showInvCol("valuein") && <div className="stock-card__stat"><span className="stock-card__stat-label">Value In</span><span className="stock-card__stat-value pos">{money(Number(o.openingValueExcludingTax || 0) + Number(o.valueIn || 0))}</span></div>}
                              {showInvCol("valueout") && <div className="stock-card__stat"><span className="stock-card__stat-label">Value Out</span><span className="stock-card__stat-value neg">{money(o.valueOut)}</span></div>}
                              {showInvCol("excl") && <div className="stock-card__stat"><span className="stock-card__stat-label">Excluding</span><span className="stock-card__stat-value">{money(o.valueExcludingTax)}</span></div>}
                              {showInvCol("incl") && <div className="stock-card__stat"><span className="stock-card__stat-label">Including</span><span className="stock-card__stat-value">{money(o.valueIncludingTax)}</span></div>}
                              {canViewActualCost && showInvCol("margin") && o.margin != null && <div className="stock-card__stat"><span className="stock-card__stat-label">Margin</span><span className={`stock-card__stat-value ${o.margin < 0 ? "neg" : "pos"}`}>{money(o.margin)}</span></div>}
                            </>); })()}
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">Available</span>
                              <span className="stock-card__stat-value" style={{ color: r.available < 0 ? "var(--dash-negative)" : "var(--dash-secondary)" }}>{r.available.toLocaleString()}</span>
                            </div>
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">Committed</span>
                              <span className="stock-card__stat-value">{r.committed.toLocaleString()}</span>
                            </div>
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">To Deliver</span>
                              <span className="stock-card__stat-value">{r.toDeliver.toLocaleString()}</span>
                            </div>
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">Delivered</span>
                              <span className="stock-card__stat-value">{r.delivered.toLocaleString()}</span>
                            </div>
                            <div className="stock-card__stat">
                              <span className="stock-card__stat-label">Incoming</span>
                              <span className="stock-card__stat-value">{r.incoming.toLocaleString()}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="stock-card__notes">Not tracked as inventory (FBR-reporting item).</div>
                        )}
                        <button type="button" className="stk-btn" style={cardBtn} aria-expanded={expandedId === r.itemTypeId} onClick={() => toggleDrill(r.itemTypeId)}>
                          {expandedId === r.itemTypeId ? <MdExpandMore size={16} /> : <MdChevronRight size={16} />}
                          {expandedId === r.itemTypeId ? "Hide stock ledger" : "View stock ledger"}
                        </button>
                        {expandedId === r.itemTypeId && (
                          <StockLedgerPanel
                            gdRows={gdDetails[r.itemTypeId]} gdLoading={gdLoading === r.itemTypeId}
                            movements={canViewMovements ? drill[r.itemTypeId] : []}
                            movementsLoading={canViewMovements && drillLoading === r.itemTypeId}
                            canViewMovements={canViewMovements}
                            openingQty={onhandById.get(r.itemTypeId)?.openingBalance}
                            onHand={r.onHand} uom={r.uom}
                            position={onhandById.get(r.itemTypeId)}
                            showCol={showLedgerCol} picker={ledgerPicker} canViewActualCost={canViewActualCost}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  </>
                )}
              </section>
            )}

            {tab === "opening" && canManageOpening && (
              <section role="tabpanel" aria-label="Opening balances">
                {openings.length > 0 && (
                  <div className="stk-toolbar">
                    <SearchBox value={search} onChange={setSearch} />
                    <span className="stk-grow" />
                    {openingPicker}
                  </div>
                )}
                {openings.length > 0 && filteredOpenings.length === 0 ? (
                  <div className="stk-empty">
                    <p>No opening balances match "{search}".</p>
                    <button type="button" className="stk-btn" onClick={() => setSearch("")}>Clear search</button>
                  </div>
                ) : openings.length === 0 ? (
                  <div className="stk-empty">
                    <p>No opening balances set yet. Click "Opening balance" above to add one.</p>
                  </div>
                ) : (
                  <>
                    {/* Desktop — table */}
                    <div className="stock-table stk-tw">
                      <table className="stk-table">
                        <thead>
                          <tr>
                            {openItemCell && <th>{showOpenCol("item") ? "Item" : showOpenCol("gd") ? "GD No" : "Notes"}</th>}
                            {showOpenCol("qty") && <th className="num">Quantity</th>}
                            {showOpenCol("excl") && <th className="num">Excluding</th>}
                            {showOpenCol("rate") && !showOpenCol("tax") && <th className="num">S.Tax %</th>}
                            {showOpenCol("tax") && <th className="num">Sales Tax</th>}
                            {showOpenCol("incl") && <th className="num">Including</th>}
                            {openCostCell && <th className="num">{[showOpenCol("actual") && "Actual cost", showOpenCol("margin") && "Margin"].filter(Boolean).join(" / ")}</th>}
                            {showOpenCol("asof") && !showOpenCol("item") && <th>As Of</th>}
                            <th style={{ width: 64 }} aria-label="Actions"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOpenings.map((o) => (
                            <tr key={o.id}>
                              {openItemCell && (
                                <td>
                                  {showOpenCol("item") && <div className="stk-name">{o.itemTypeName}</div>}
                                  {showOpenCol("item") && showOpenCol("asof") && <div className="stk-meta">as of {new Date(o.asOfDate).toLocaleDateString()}</div>}
                                  {showOpenCol("gd") && <div className="stk-sub-gds"><GdList gds={gdByItem.get(o.itemTypeId)} /></div>}
                                  {showOpenCol("notes") && o.notes && <div className="stk-note" title={o.notes}>{o.notes}</div>}
                                </td>
                              )}
                              {showOpenCol("qty") && <td className="num" style={{ fontWeight: 600 }}>{o.quantity.toLocaleString()}</td>}
                              {showOpenCol("excl") && <td className="num">{money(o.valueExcludingTax)}</td>}
                              {showOpenCol("rate") && !showOpenCol("tax") && <td className="num" style={{ color: "var(--dash-text)" }}>{o.salesTaxRate ? `${num(o.salesTaxRate)}%` : "—"}</td>}
                              {showOpenCol("tax") && <td className="num">{money(o.salesTax)}{showOpenCol("rate") && <div className="stk-rate">{o.salesTaxRate ? `${num(o.salesTaxRate)}%` : "no rate"}</div>}</td>}
                              {showOpenCol("incl") && <td className="num" style={{ fontWeight: 600 }}>{money(o.valueIncludingTax)}</td>}
                              {openCostCell && (
                                <td className="num">
                                  {showOpenCol("actual") && (
                                    <div style={{ color: "var(--dash-text)" }} title="Actual cost">
                                      {o.actualCostExcludingTax ? money(o.actualCostExcludingTax) : "—"}
                                    </div>
                                  )}
                                  {showOpenCol("margin") && (
                                    <>
                                      <div className={o.margin < 0 ? "neg" : undefined} style={{ fontWeight: 600 }} title="Margin">{money(o.margin)}</div>
                                      {o.marginPercent != null
                                        ? <span className={`stk-pct${o.margin < 0 ? " neg" : ""}`}>{num(o.marginPercent)}%</span>
                                        : <div className="stk-rate">—</div>}
                                    </>
                                  )}
                                </td>
                              )}
                              {showOpenCol("asof") && !showOpenCol("item") && <td style={{ whiteSpace: "nowrap" }}>{new Date(o.asOfDate).toLocaleDateString()}</td>}
                              <td className="stk-acts">
                                <button type="button" className="stk-ib" title="Restate this opening balance"
                                  aria-label={`Edit opening balance for ${o.itemTypeName}`} onClick={() => startEditOpening(o)}>
                                  <MdEdit size={15} />
                                </button>
                                <button type="button" className="stk-ib danger" title="Delete opening balance"
                                  aria-label={`Delete opening balance for ${o.itemTypeName}`} onClick={() => handleDeleteOpening(o)}>
                                  <MdClose size={15} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile — opening balance cards */}
                    <div className="stock-cards stk-cards">
                      {filteredOpenings.map((o) => (
                        <div key={o.id} className="stock-card">
                          <div className="stock-card__top">
                            <div className="stock-card__top-left">
                              {showOpenCol("gd") && gdText(o.itemTypeId) && (
                                <span className="stock-card__hs">GD {gdText(o.itemTypeId)}</span>
                              )}
                              <span className="stock-card__name stk-name" style={{ minWidth: 0, maxWidth: "none" }}>{o.itemTypeName}</span>
                              <span className="stock-card__hs">As of {new Date(o.asOfDate).toLocaleDateString()}</span>
                            </div>
                            <div className="stock-card__onhand">
                              <span className="stock-card__onhand-label">Quantity</span>
                              <span className="stock-card__onhand-value" style={{ color: "var(--dash-primary)" }}>
                                {o.quantity.toLocaleString()}
                              </span>
                            </div>
                          </div>
                          {canViewActualCost && (
                            <div className="stock-card__stats">
                              <div className="stock-card__stat">
                                <span className="stock-card__stat-label">Actual Cost</span>
                                <span className="stock-card__stat-value">
                                  {o.actualCostExcludingTax ? money(o.actualCostExcludingTax) : "—"}
                                </span>
                              </div>
                              <div className="stock-card__stat">
                                <span className="stock-card__stat-label">Margin</span>
                                <span className={`stock-card__stat-value${o.margin < 0 ? " neg" : ""}`}>
                                  {money(o.margin)} {o.marginPercent != null ? `(${num(o.marginPercent)}%)` : "(—)"}
                                </span>
                              </div>
                            </div>
                          )}
                          {o.notes && (
                            <div className="stock-card__notes">{o.notes}</div>
                          )}
                          <button type="button" className="stk-btn" style={cardBtn} onClick={() => startEditOpening(o)}
                            aria-label={`Edit opening balance for ${o.itemTypeName}`}>
                            <MdEdit size={14} /> Edit
                          </button>
                          <button type="button" className="stk-btn" style={{ ...cardBtn, color: "var(--dash-negative)" }} onClick={() => handleDeleteOpening(o)}
                            aria-label={`Delete opening balance for ${o.itemTypeName}`}>
                            <MdClose size={14} /> Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}

            {tab === "movements" && canViewMovements && (
              <section role="tabpanel" aria-label="Movements">
                {movements.length === 0 ? (
                  <div className="stk-empty">
                    <MdHistory size={40} />
                    <p>No movements recorded yet.</p>
                  </div>
                ) : (
                  <>
                    <div className="stk-toolbar">
                      <span className="stk-hint">Every stock movement, newest first</span>
                      <span className="stk-grow" />
                      {movementPicker}
                    </div>
                    {/* Desktop — table */}
                    <div className="stock-table stk-tw">
                      <table className="stk-table">
                        <thead>
                          <tr>
                            {showMovCol("date") && <th>Date</th>}
                            {(showMovCol("item") || showMovCol("notes")) && <th>{showMovCol("item") ? "Item" : "Notes"}</th>}
                            {(showMovCol("qty") || showMovCol("direction")) && <th className="num">{showMovCol("qty") ? "Qty" : "Direction"}</th>}
                            {showMovCol("unitcost") && <th className="num">Unit Cost</th>}
                            {showMovCol("value") && <th className="num">Value</th>}
                            {showMovCol("balance") && <th className="num">Balance</th>}
                            {showMovCol("source") && <th>Source</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {movements.map((m) => (
                            <tr key={m.id}>
                              {showMovCol("date") && <td style={{ whiteSpace: "nowrap" }}>{new Date(m.movementDate).toLocaleDateString()}</td>}
                              {(showMovCol("item") || showMovCol("notes")) && (
                                <td>
                                  {showMovCol("item") && <div className="stk-name">{m.itemTypeName}</div>}
                                  {showMovCol("notes") && m.notes && <div className="stk-note" title={m.notes}>{m.notes}</div>}
                                </td>
                              )}
                              {(showMovCol("qty") || showMovCol("direction")) && (
                              <td className={`num ${m.direction === "In" ? "pos" : "neg"}`} style={{ fontWeight: 600 }}>
                                {/* Signed quantity with the direction beside it; a
                                    revaluation moves money, not goods, so it keeps "—". */}
                                {showMovCol("qty") && (m.sourceType === "Revaluation"
                                  ? <span style={{ color: "var(--dash-text)" }}>—</span>
                                  : `${m.direction === "In" ? "+" : "−"}${m.quantity.toLocaleString()}`)}
                                {showMovCol("direction") && <span className="stk-dir"> {m.direction}</span>}
                              </td>
                              )}
                              {showMovCol("unitcost") && (
                              <td className="num" style={{ color: "var(--dash-text)" }}>
                                {m.sourceType === "Revaluation" ? "—" : num(m.unitCost)}
                              </td>
                              )}
                              {showMovCol("value") && (
                              <td className={`num ${m.direction === "In" ? "pos" : "neg"}`}>
                                {m.direction === "In" ? "+" : "−"}{money(m.value)}
                              </td>
                              )}
                              {showMovCol("balance") && (
                                <td className="num">
                                  <div>{num(m.runningQuantity)}</div>
                                  <div className="stk-rate">{money(m.runningValue)}</div>
                                </td>
                              )}
                              {showMovCol("source") && <td style={{ fontSize: 11.5 }}>{m.sourceType}{m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile — movement cards */}
                    <div className="stock-cards stk-cards">
                      {movements.map((m) => (
                        <div key={m.id} className="stock-card">
                          <div className="stock-card__top">
                            <div className="stock-card__top-left">
                              <span className="stock-card__name stk-name" style={{ minWidth: 0, maxWidth: "none" }}>{m.itemTypeName}</span>
                              <span className="stock-card__hs">{new Date(m.movementDate).toLocaleDateString()}</span>
                            </div>
                            <div className="stock-card__onhand">
                              <span className={`stock-card__direction ${m.direction === "In" ? "pos" : "neg"}`}>
                                {m.direction === "In" ? "+" : "−"}{m.quantity.toLocaleString()}
                              </span>
                              <span className="stock-card__direction-label">{m.direction}</span>
                            </div>
                          </div>
                          <div className="stock-card__source">
                            <span className="stock-card__stat-label">Value</span>
                            <span className={`stock-card__stat-value ${m.direction === "In" ? "pos" : "neg"}`}>
                              {m.direction === "In" ? "+" : "−"}{money(m.value)}
                            </span>
                          </div>
                          <div className="stock-card__source">
                            <span className="stock-card__stat-label">Balance</span>
                            <span className="stock-card__stat-value">{num(m.runningQuantity)} · {money(m.runningValue)}</span>
                          </div>
                          <div className="stock-card__source">
                            <span className="stock-card__stat-label">Source</span>
                            <span className="stock-card__stat-value">
                              {m.sourceType}{m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}
                            </span>
                          </div>
                          {m.notes && <div className="stock-card__notes">{m.notes}</div>}
                        </div>
                      ))}
                    </div>

                    <div className="stk-pager">
                      <Pagination
                        page={movPage}
                        totalPages={movPageSize > 0 ? Math.ceil(movTotal / movPageSize) : 0}
                        total={movTotal}
                        onPage={setMovPage}
                        pageSize={movSize}
                        onPageSize={(n) => { setMovSize(n); setMovPage(1); }}
                        unit="rows"
                      />
                    </div>
                  </>
                )}
              </section>
            )}
          </div>
        </>
      )}

      {showOpening && (
        <SmallModal title={openingEditId ? "Edit Opening Balance" : "Set Opening Balance"} onClose={() => { setShowOpening(false); setOpeningEditId(null); }} onSubmit={submitOpening} submitting={saving}>
          <Field label="Item">
            {openingEditId ? (
              <input
                readOnly
                value={itemTypes.find(it => String(it.id) === String(openingDraft.itemTypeId))?.name || ""}
                style={{ ...mInput, ...mInputLocked }}
                title="Restating this item's opening balance. To open a different item, close and use Opening Balance."
              />
            ) : (
            <SearchableItemTypeSelect
              emptyText={
                itemTypes.length === 0
                  ? "No items in this company's catalog yet. Create one below."
                  : "Every item in this company's catalog already has an opening balance. "
                    + "Edit one from its row, or create a new item type below."
              }
              items={openingPickerItems}
              value={openingDraft.itemTypeId}
              onChange={(newId) => setOpeningDraft({ ...openingDraft, itemTypeId: newId ? String(newId) : "" })}
              placeholder="Search & pick an item…"
              style={mInput}
            />
            )}
            <div style={qtyHint}>
              {openingEditId
                ? "Restating the opening balance already recorded for this item. This corrects a figure; it does not move stock."
                : <>Items that already have an opening balance are hidden — edit theirs
                   in the list instead. {flowVersion !== 2 && "On V1 only HS-coded items are tracked."}</>}
            </div>
          </Field>
          <Field label="Quantity">
            <input type="number" min={0} step={openingAllowsDecimal ? "any" : "1"} required style={mInput} value={openingDraft.quantity} onChange={e => setOpeningDraft({ ...openingDraft, quantity: e.target.value })} />
            {openingItem && (
              <div style={qtyHint}>UOM: <strong>{openingUom || "—"}</strong> · {openingAllowsDecimal ? "decimals allowed" : "whole numbers only"}</div>
            )}
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
            <Field label="Value excluding sales tax">
              <input type="number" min={0} step="0.01" style={mInput} value={openingDraft.valueExcludingTax} onChange={e => setOpeningDraft({ ...openingDraft, valueExcludingTax: e.target.value })} placeholder="0.00" />
              <div style={qtyHint}>What the opening quantity is worth in total, not per unit.</div>
            </Field>
            <Field label="Actual cost (excl. tax)">
              <input type="number" min={0} step="0.01" style={mInput} value={openingDraft.actualCostExcludingTax} onChange={e => setOpeningDraft({ ...openingDraft, actualCostExcludingTax: e.target.value })} placeholder="0.00" />
              <div style={qtyHint}>
                {openingMarginPreview
                  ? <span style={{ color: openingMarginPreview.margin < 0 ? "var(--dash-negative)" : qtyHint.color, fontWeight: 600 }}>
                      Margin {money(openingMarginPreview.margin)} ({openingMarginPreview.pct.toFixed(2)}%)
                    </span>
                  : "Leave blank to keep whatever cost is already stored (e.g. from a GD import)."}
              </div>
            </Field>
          </div>
          <Field label="Sales tax rate %">
            <input type="number" min={0} max={100} step="0.01" style={mInput} value={openingDraft.salesTaxRate} onChange={e => setOpeningDraft({ ...openingDraft, salesTaxRate: e.target.value })} placeholder="18" />
            <div style={qtyHint}>
              {openingValuePreview
                ? `Sales tax ${openingValuePreview.tax} · including ${openingValuePreview.incl}`
                : "Tax and the inclusive total are worked out from these two."}
            </div>
          </Field>
          <Field label="As Of"><input type="date" required style={mInput} value={openingDraft.asOfDate} onChange={e => setOpeningDraft({ ...openingDraft, asOfDate: e.target.value })} /></Field>
          <Field label="Notes"><input type="text" style={mInput} value={openingDraft.notes} onChange={e => setOpeningDraft({ ...openingDraft, notes: e.target.value })} placeholder="optional" /></Field>
        </SmallModal>
      )}

      {costHistoryItem && selectedCompany?.id && (
        <CostHistoryDialog
          companyId={selectedCompany.id}
          item={costHistoryItem}
          onClose={() => setCostHistoryItem(null)}
        />
      )}

      {showAdjust && (
        <SmallModal title="Stock Adjustment" onClose={closeAdjust} onSubmit={submitAdjust} submitting={saving}>
          <Field label="Item">
            {adjustLockedItem ? (
              <input
                type="text"
                readOnly
                value={`${adjustLockedItem.name}${adjustLockedItem.hsCode ? ` (${adjustLockedItem.hsCode})` : ""}`}
                style={{ ...mInput, ...mInputLocked }}
                title="Opened from the stock grid — item is fixed. Use the header Adjustment button to pick a different item."
              />
            ) : (
              <>
                <SearchableItemTypeSelect
                  items={adjustPickerItems}
                  value={adjustDraft.itemTypeId}
                  onChange={(newId) => setAdjustDraft({ ...adjustDraft, itemTypeId: newId ? String(newId) : "" })}
                  placeholder="Search & pick an item…"
                  style={mInput}
                />
                <div style={qtyHint}>
                  Every item this company tracks stock for, whether or not it has an
                  opening balance — recording found stock on an item that was never
                  opened is exactly what an adjustment is for.
                  {flowVersion !== 2 && " On V1 that means HS-coded items only."}
                </div>
              </>
            )}
          </Field>
          {adjustCurrent && (
            <div style={adjustNow}>
              <span style={adjustNowLabel}>On record now</span>
              <span>
                <strong>{fmtOnHand(adjustCurrent.onHand)}</strong>{adjustUom ? ` ${adjustUom}` : ""}
                {" · "}<strong>{money(adjustCurrent.valueExcludingTax)}</strong> excl
                {adjustCurrent.salesTaxRate ? ` · ${num(adjustCurrent.salesTaxRate)}%` : ""}
              </span>
            </div>
          )}

          <div style={modeRow}>
            {[["set", "Correct it to"], ["delta", "Adjust by"]].map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setAdjustDraft({ ...adjustDraft, mode: m })}
                style={{
                  ...modeBtn,
                  backgroundColor: adjustDraft.mode === m ? "var(--dash-primary)" : "var(--dash-card)",
                  color: adjustDraft.mode === m ? "var(--dash-card)" : "var(--dash-ink)",
                  borderColor: adjustDraft.mode === m ? "var(--dash-primary)" : "var(--dash-grid)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ ...qtyHint, marginBottom: "0.6rem" }}>
            {adjustDraft.mode === "set"
              ? "Type what the figures should actually be — the change is worked out for you. Use this to fix a wrong count or a wrong value."
              : "Type the change itself — for goods that genuinely arrived or were lost."}
          </div>

          {adjustDraft.mode === "set" ? (
            <>
              <Field label="Quantity it should be">
                <input type="number" min={0} step={adjustAllowsDecimal ? "any" : "1"} style={mInput}
                       value={adjustDraft.targetQuantity}
                       onChange={e => setAdjustDraft({ ...adjustDraft, targetQuantity: e.target.value })} />
                <div style={qtyHint}>
                  {adjustItem && <>UOM: <strong>{adjustUom || "—"}</strong> · {adjustAllowsDecimal ? "decimals allowed" : "whole numbers only"}. </>}
                  {adjustPlan?.qtyText}
                </div>
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
                <Field label="Value excluding sales tax it should be">
                  <input type="number" min={0} step="0.01" style={mInput}
                         value={adjustDraft.targetValue}
                         onChange={e => setAdjustDraft({ ...adjustDraft, targetValue: e.target.value })} />
                  <div style={qtyHint}>
                    Total worth of that quantity, not per unit. {adjustPlan?.valueText}
                  </div>
                </Field>
                {canViewActualCost && (
                  <Field label="Actual cost it should be">
                    <input type="number" min={0} step="0.01" style={mInput}
                           value={adjustDraft.targetActualCost}
                           onChange={e => setAdjustDraft({ ...adjustDraft, targetActualCost: e.target.value })}
                           placeholder="0.00" />
                    <div style={qtyHint}>
                      {adjustMarginPreview
                        ? <span style={{ color: adjustMarginPreview.margin < 0 ? "var(--dash-negative)" : qtyHint.color, fontWeight: 600 }}>
                            Margin {money(adjustMarginPreview.margin)}
                            {adjustMarginPreview.pct != null ? ` (${adjustMarginPreview.pct.toFixed(2)}%)` : ""}
                          </span>
                        : "Total actual cost of that quantity. Leave blank to keep what is already on record."}
                    </div>
                  </Field>
                )}
              </div>
              <Field label="Sales tax rate %">
                <input type="number" min={0} max={100} step="0.01" style={mInput}
                       value={adjustDraft.salesTaxRate}
                       onChange={e => setAdjustDraft({ ...adjustDraft, salesTaxRate: e.target.value })}
                       placeholder="18" />
                <div style={qtyHint}>{adjustPlan?.result}</div>
              </Field>
            </>
          ) : (
            <>
              <Field label="Quantity change (positive = up, negative = down)">
                <input type="number" step={adjustAllowsDecimal ? "any" : "1"} style={mInput}
                       value={adjustDraft.delta}
                       onChange={e => setAdjustDraft({ ...adjustDraft, delta: e.target.value })} />
                {adjustItem && (
                  <div style={qtyHint}>UOM: <strong>{adjustUom || "—"}</strong> · {adjustAllowsDecimal ? "decimals allowed" : "whole numbers only"}</div>
                )}
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
                <Field label="Value change excluding tax (optional)">
                  <input type="number" step="0.01" style={mInput}
                         value={adjustDraft.valueDelta}
                         onChange={e => setAdjustDraft({ ...adjustDraft, valueDelta: e.target.value })}
                         placeholder="e.g. -5000 to write stock down" />
                  <div style={qtyHint}>
                    Changes what the stock is worth without moving any of it. Leave blank when only the quantity changed.
                  </div>
                </Field>
                {canViewActualCost && (
                  <Field label="Actual cost change excluding tax (optional)">
                    <input type="number" step="0.01" style={mInput}
                           value={adjustDraft.actualValueDelta}
                           onChange={e => setAdjustDraft({ ...adjustDraft, actualValueDelta: e.target.value })}
                           placeholder="e.g. -5000 to write the actual cost down" />
                    <div style={qtyHint}>
                      {adjustMarginPreview
                        ? <span style={{ color: adjustMarginPreview.margin < 0 ? "var(--dash-negative)" : qtyHint.color, fontWeight: 600 }}>
                            Margin {money(adjustMarginPreview.margin)}
                            {adjustMarginPreview.pct != null ? ` (${adjustMarginPreview.pct.toFixed(2)}%)` : ""}
                          </span>
                        : "Changes what the stock actually cost without moving any of it."}
                    </div>
                  </Field>
                )}
              </div>
              {parseFloat(adjustDraft.delta) > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
                  <Field label="Unit cost excluding tax">
                    <input type="number" min={0} step="0.0001" style={mInput}
                           value={adjustDraft.unitCost}
                           onChange={e => setAdjustDraft({ ...adjustDraft, unitCost: e.target.value })}
                           placeholder="leave blank to use the current average" />
                    <div style={qtyHint}>
                      Blank values the stock coming in at the average already on hand — right for a count correction.
                    </div>
                  </Field>
                  {canViewActualCost && (
                    <Field label="Actual unit cost excluding tax">
                      <input type="number" min={0} step="0.0001" style={mInput}
                             value={adjustDraft.actualUnitCost}
                             onChange={e => setAdjustDraft({ ...adjustDraft, actualUnitCost: e.target.value })}
                             placeholder="leave blank to use the current actual average" />
                      <div style={qtyHint}>
                        Blank values the stock coming in at the actual-cost average already on hand.
                      </div>
                    </Field>
                  )}
                </div>
              )}
              <Field label="Sales tax rate %">
                <input type="number" min={0} max={100} step="0.01" style={mInput}
                       value={adjustDraft.salesTaxRate}
                       onChange={e => setAdjustDraft({ ...adjustDraft, salesTaxRate: e.target.value })}
                       placeholder="18" />
              </Field>
            </>
          )}
          <Field label="Date"><input type="date" required style={mInput} value={adjustDraft.movementDate} onChange={e => setAdjustDraft({ ...adjustDraft, movementDate: e.target.value })} /></Field>
          <Field label="Notes"><input type="text" style={mInput} value={adjustDraft.notes} onChange={e => setAdjustDraft({ ...adjustDraft, notes: e.target.value })} placeholder="e.g. count correction, breakage" /></Field>
        </SmallModal>
      )}
    </div>
  );
}

// Per-item movement history shown inside an expanded On-Hand row / card.
// Movements are GROUPED BY SOURCE DOCUMENT (one row per invoice / purchase
// bill / receipt with the summed quantity across its line items) — a bill
// with 3 lines of this item shows one row, not three. Adjustments, opening
// stock and document-less reversals stay individual. Newest-first with a
// running on-hand computed after each whole document.
function GdPanel({ rows, loading, openingQty, openingValue, canEdit, onSave }) {
  if (loading || !rows) return <div style={drillStyles.state}>Loading GD sources…</div>;
  if (rows.length === 0) return <div style={drillStyles.state}>No GD source rows recorded for this item.</div>;
  const sourceQty = rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
  const sourceValue = rows.reduce((sum, r) => sum + Number(r.valueExcludingTax || 0), 0);
  const missingQty = Number(openingQty || 0) - sourceQty;
  const missingValue = Number(openingValue || 0) - sourceValue;
  const unclaimed = rows.filter(r => !r.claimMonth).length;
  // FIFO by GD fills Sold / Left per line; the weighted average has no split.
  const fifo = rows.some(r => r.remainingQuantity != null);
  const month = (date) => date ? new Date(date).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—";
  const date = (value) => value ? new Date(value).toLocaleDateString() : "—";
  return (
    <div style={drillStyles.wrap}>
      <div style={gdStyles.head}>
        <span style={drillStyles.heading}>GD source lots ({rows.length})</span>
        <span style={gdStyles.stat}><b>{num(sourceQty)}</b> units</span>
        <span style={gdStyles.stat}><b>{money(sourceValue)}</b> excl</span>
        <span style={{ ...gdStyles.stat, ...(unclaimed ? gdStyles.statWarn : gdStyles.statOk) }}>
          {unclaimed ? `${unclaimed} not claimed` : "All claimed"}
        </span>
      </div>
      <details style={gdStyles.help}>
        <summary style={gdStyles.helpSummary}>What these figures mean</summary>
        Source quantities explain the opening position before later sales. Cost-only backfills add no stock.
        GD month is the declaration month; claim month is the return this line's input tax was
        filed in — each line has its own, and a blank one means not claimed yet.
        {fifo && " Sold and Left are FIFO by GD: a sale uses the GDs claimed by its month first, oldest GD date first, then the unclaimed ones."}
      </details>
      <div className="gd-lines" style={gdStyles.box}>
        <table style={gdStyles.table}>
          <thead>
            <tr>
              <th style={gdStyles.th}>GD</th>
              <th style={gdStyles.th}>GD date</th>
              <th style={gdStyles.th}>Source line</th>
              <th style={gdStyles.thNum}>Qty</th>
              <th style={gdStyles.thNum}>Value excl</th>
              {fifo && <th style={gdStyles.thNum} title="FIFO by GD: what sales took from this line">Sold</th>}
              {fifo && <th style={gdStyles.thNum} title="FIFO by GD: what this line still holds">Left</th>}
              <th style={gdStyles.thNum}>Tax</th>
              <th style={gdStyles.th}>Claim month</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => (
              <tr key={`${r.source}-${r.gdNumber}-${r.sourceRow}-${index}`}>
                <td style={gdStyles.td} data-label="GD">
                  <div style={gdStyles.gdNo}>{r.gdNumber}</div>
                  <div style={gdStyles.sub}>{r.source}</div>
                </td>
                <td style={gdStyles.td} data-label="GD date">
                  <div style={{ whiteSpace: "nowrap" }}>{date(r.gdDate)}</div>
                  <div style={gdStyles.sub}>{month(r.gdDate)}</div>
                </td>
                <td style={gdStyles.td} data-label="Source line">
                  <div style={gdStyles.desc}>{r.description || "Source line"}</div>
                  <div style={gdStyles.sub}>row {r.sourceRow}{r.hsCode ? ` · HS ${r.hsCode}` : ""}</div>
                </td>
                <td style={gdStyles.tdNum} data-label="Qty">
                  {r.quantity == null ? <span style={gdStyles.sub}>No stock added</span> : num(r.quantity)}
                </td>
                <td style={gdStyles.tdNum} data-label="Value excl">
                  {r.quantity == null ? "—" : money(r.valueExcludingTax)}
                </td>
                {fifo && (
                  <td style={{ ...gdStyles.tdNum, color: "var(--dash-negative)" }} data-label="Sold">
                    {r.consumedQuantity == null ? "—" : (
                      <>
                        <div>{num(r.consumedQuantity)}</div>
                        <div style={gdStyles.sub}>{money(r.consumedValueExcludingTax)}</div>
                      </>
                    )}
                  </td>
                )}
                {fifo && (
                  <td style={{ ...gdStyles.tdNum, fontWeight: 700, color: "var(--dash-primary)" }} data-label="Left">
                    {r.remainingQuantity == null ? "—" : (
                      <>
                        <div>{num(r.remainingQuantity)}</div>
                        <div style={gdStyles.sub}>{money(r.remainingValueExcludingTax)}</div>
                      </>
                    )}
                  </td>
                )}
                <td style={gdStyles.tdNum} data-label="Tax">
                  {r.salesTaxRate != null ? `${num(r.salesTaxRate)}%` : "—"}
                </td>
                <td style={gdStyles.td} data-label="Claim month">
                  {canEdit && (r.lotId != null || r.consignmentLineId != null) ? (
                    <ClaimMonthEditor key={`${r.lotId}:${r.consignmentLineId}:${r.claimMonth || ""}`}
                      line={r} value={r.claimMonth} onSave={onSave} />
                  ) : (
                    <span style={{ ...gdStyles.pill, ...(r.claimMonth ? gdStyles.statOk : gdStyles.statWarn) }}>
                      {r.claimMonth ? month(r.claimMonth) : "Not claimed yet"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(Math.abs(missingQty) > 0.0001 || Math.abs(missingValue) > 0.01) && (
        <div style={gdStyles.untraced}>
          Opening position not traced by these GD rows: <b>{num(missingQty)}</b> units · <b>{money(missingValue)}</b> excl.
          This can include manual opening corrections or source rows without a GD number.
        </div>
      )}
    </div>
  );
}

// The Inventory tab's per-item stock ledger: every unit that came in and
// went out, oldest first, with a running balance. Stock IN is the GD lots
// behind the opening position (GD number + GD date) plus any inward movement
// (purchase bill, goods receipt, adjustment up); stock OUT is each invoice
// (and any other outward movement). Opening quantity no GD row explains is
// shown as its own line so the ledger still adds up to on-hand. Reads only
// the two feeds the On-Hand drill-down already loads -- no new figures.
const LEDGER_SOURCE_LABELS = {
  Invoice: "Invoice",
  PurchaseBill: "Purchase bill",
  GoodsReceipt: "Goods receipt",
  PurchaseDebitNote: "Debit note",
  Adjustment: "Adjustment",
  ImportConsignment: "GD",
};
// FIFO by GD: which GDs a movement took its stock from (or, for a return, went
// back into), one chip per GD with the quantity and the value at its cost.
// Slices of one GD across a document's lines are summed.
function AllocationChips({ allocations, isIn }) {
  if (!allocations?.length) return null;
  const byLabel = new Map();
  for (const a of allocations) {
    const hit = byLabel.get(a.label);
    if (hit) { hit.quantity += Number(a.quantity); hit.value += Number(a.valueExcludingTax); }
    else byLabel.set(a.label, { ...a, quantity: Number(a.quantity), value: Number(a.valueExcludingTax) });
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
      <span style={gdStyles.sub}>{isIn ? "into" : "from"}</span>
      {[...byLabel.values()].map((a) => (
        <span key={a.label} title={a.claimed ? "Claimed by this movement's month" : "Not claimed by this movement's month"}
          style={{ ...gdStyles.pill, ...(a.gdNumber ? (a.claimed ? gdStyles.statOk : gdStyles.stat) : gdStyles.statWarn) }}>
          {a.label} · {num(a.quantity)} · {money(a.value)}
        </span>
      ))}
    </div>
  );
}

// The Inventory row's money: what came in (opening / GD stock + purchases),
// what went out, and the position in hand -- all from the on-hand feed, the
// same figures the On-Hand tab shows. Nothing is recomputed here.
function InventoryValueCells({ o, show, canViewActualCost }) {
  const td = { textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  const valueIn = Number(o?.openingValueExcludingTax || 0) + Number(o?.valueIn || 0);
  const margin = o?.margin;
  return (
    <>
      {(show("valuein") || show("valueout")) && (
        <td style={{ ...td, fontWeight: 600 }}>
          {show("valuein") && <div style={{ color: "var(--dash-positive)" }} title="Value in, excluding tax">{o ? money(valueIn) : "—"}</div>}
          {show("valueout") && <div style={{ color: "var(--dash-negative)" }} title="Value out, excluding tax">{o ? money(o.valueOut) : "—"}</div>}
        </td>
      )}
      {show("excl") && <td style={{ ...td, fontWeight: 700, color: "var(--dash-primary)" }}>{o ? money(o.valueExcludingTax) : "—"}</td>}
      {show("tax") && <td style={td}>{o ? money(o.salesTax) : "—"}</td>}
      {show("incl") && <td style={{ ...td, fontWeight: 600 }}>{o ? money(o.valueIncludingTax) : "—"}</td>}
      {canViewActualCost && (show("actual") || show("margin")) && (
        <td style={td}>
          {show("actual") && <div title="Landed cost">{o?.actualCostExcludingTax != null ? money(o.actualCostExcludingTax) : "—"}</div>}
          {show("margin") && (
            <>
              <div style={{ fontWeight: 600, color: margin < 0 ? "var(--dash-negative)" : "var(--dash-positive)" }} title="Margin">
                {margin != null ? money(margin) : "—"}
              </div>
              {o?.marginPercent != null && <span className={`stk-pct${margin < 0 ? " neg" : ""}`}>{Number(o.marginPercent).toFixed(1)}%</span>}
            </>
          )}
        </td>
      )}
    </>
  );
}

function StockLedgerPanel({ gdRows, gdLoading, movements, movementsLoading, canViewMovements, openingQty, onHand, uom,
  position, showCol, picker, canViewActualCost }) {
  if (gdLoading || !gdRows || (canViewMovements && (movementsLoading || !movements))) {
    return <div style={drillStyles.state}>Loading stock ledger…</div>;
  }
  const show = (k) => (showCol ? showCol(k) : true);
  const itemRate = Number(position?.salesTaxRate || 0);
  const entries = [];
  let tracedQty = 0, tracedValue = 0, tracedActual = 0, tracedActualKnown = true;
  const restated = gdRows.some((g) => g.restatementLineId != null);
  gdRows.forEach((g, i) => {
    const q = Number(g.quantity || 0);
    if (g.quantity == null || q <= 0) return; // cost-only backfill: no stock moved
    const v = Number(g.valueExcludingTax || 0);
    tracedQty += q; tracedValue += v;
    if (g.actualCostExcludingTax == null) tracedActualKnown = false; else tracedActual += Number(g.actualCostExcludingTax);
    entries.push({
      key: `gd-${i}`, date: g.gdDate, order: 0, dir: "In", qty: q, value: v,
      actual: g.actualCostExcludingTax == null ? null : Number(g.actualCostExcludingTax),
      rate: g.salesTaxRate != null && Number(g.salesTaxRate) > 0 ? Number(g.salesTaxRate) : itemRate,
      ref: `GD ${g.gdNumber}`, kind: g.source || "GD lot",
      detail: g.description, sub: g.sourceRow != null ? `row ${g.sourceRow}` : null,
    });
  });
  const untraced = Number(openingQty || 0) - tracedQty;
  if (untraced > 0.0001) {
    const openActual = position?.openingActualCostExcludingTax;
    entries.push({
      key: "opening-untraced", date: null, order: -1, dir: "In", qty: untraced,
      value: Math.max(0, Number(position?.openingValueExcludingTax || 0) - tracedValue),
      actual: openActual == null || !tracedActualKnown ? null : Math.max(0, Number(openActual) - tracedActual),
      rate: itemRate, ref: "Opening balance", kind: "Not traced to a GD", detail: null, sub: null,
    });
  }
  // Movements arrive per line item; one document's lines of this item are
  // summed into one ledger row, as the On-Hand movement history does. A
  // revaluation moves money, not goods, so it is a row here -- except for a
  // restated item, whose restatement lines above already carry the sheet.
  const byDoc = new Map();
  (movements || []).forEach((m) => {
    if (m.sourceType === "OpeningBalance") return;
    const q = Number(m.quantity || 0);
    const isReval = m.sourceType === "Revaluation";
    if (isReval ? restated || !Number(m.value) : q === 0) return;
    const v = Number(m.value || 0);
    const a = m.actualValue == null ? null : Number(m.actualValue);
    const key = m.sourceId != null ? `${m.sourceType}:${m.sourceId}:${m.direction}` : `row:${m.id}`;
    const hit = byDoc.get(key);
    if (hit) {
      hit.qty += q; hit.value += v; hit.lines += 1;
      hit.actual = hit.actual == null || a == null ? null : hit.actual + a;
      hit.allocations.push(...(m.allocations || []));
      return;
    }
    byDoc.set(key, {
      key: `mv-${key}`, date: m.movementDate, order: 1, dir: m.direction === "In" ? "In" : "Out", qty: q,
      value: v, actual: isReval ? null : a, rate: itemRate, reval: isReval,
      ref: isReval ? "Revaluation" : `${LEDGER_SOURCE_LABELS[m.sourceType] || m.sourceType}${m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}`,
      kind: isReval ? "Value change, no goods moved" : m.direction === "In" ? "Stock in" : "Stock out",
      detail: m.notes ? String(m.notes).split(" (")[0] : null, sub: null, lines: 1, id: m.id,
      allocations: [...(m.allocations || [])],
    });
  });
  byDoc.forEach((e) => { if (e.lines > 1) e.sub = `${e.lines} line items`; entries.push(e); });

  const time = (d) => (d ? new Date(d).getTime() : -Infinity);
  entries.sort((a, b) => (time(a.date) - time(b.date)) || (a.order - b.order) || ((a.id || 0) - (b.id || 0)));
  let bal = 0, balValue = 0, totalIn = 0, totalOut = 0;
  const tot = { in: { v: 0, t: 0, a: 0, aKnown: true }, out: { v: 0, t: 0, a: 0, aKnown: true } };
  entries.forEach((e) => {
    e.tax = Math.round(e.value * e.rate) / 100;
    if (e.dir === "In") { bal += e.qty; totalIn += e.qty; balValue += e.value; }
    else { bal -= e.qty; totalOut += e.qty; balValue -= e.value; }
    e.balance = bal; e.balanceValue = balValue;
    const t = e.dir === "In" ? tot.in : tot.out;
    t.v += e.value; t.t += e.tax;
    if (!e.reval) { if (e.actual == null) t.aKnown = false; else t.a += e.actual; }
  });
  const drift = Number(onHand || 0) - bal;
  const valueDrift = position ? Number(position.valueExcludingTax || 0) - balValue : 0;
  const unit = uom ? ` ${uom}` : "";
  const date = (d) => (d ? new Date(d).toLocaleDateString() : "—");
  const showCost = canViewActualCost;

  if (entries.length === 0) return <div style={drillStyles.state}>No stock has moved for this item yet.</div>;
  const signed = (dir, v) => (Math.abs(v) < 0.005 ? money(0) : `${dir === "In" ? "+" : "−"}${money(v)}`);
  const tone = (dir) => ({ color: dir === "In" ? "var(--dash-positive)" : "var(--dash-negative)" });
  const moneyCells = (dir, value, tax, actual, reval, bold) => {
    const fw = bold ? 700 : 600;
    const margin = actual == null ? null : value - actual;
    return (
      <>
        {show("excl") && <td style={{ ...gdStyles.tdNum, ...tone(dir), fontWeight: fw }} data-label="Excluding">{signed(dir, value)}</td>}
        {show("tax") && <td style={{ ...gdStyles.tdNum, fontWeight: bold ? 700 : 400 }} data-label="Sales Tax">{signed(dir, tax)}</td>}
        {show("incl") && <td style={{ ...gdStyles.tdNum, ...tone(dir), fontWeight: fw }} data-label="Including">{signed(dir, value + tax)}</td>}
        {showCost && show("actual") && <td style={{ ...gdStyles.tdNum, fontWeight: bold ? 700 : 400 }} data-label="Actual Cost">{reval || actual == null ? "—" : signed(dir, actual)}</td>}
        {showCost && show("margin") && (
          <td style={{ ...gdStyles.tdNum, fontWeight: fw, color: margin != null && margin < 0 ? "var(--dash-negative)" : "var(--dash-positive)" }} data-label="Margin">
            {reval || margin == null ? "—" : money(margin)}
          </td>
        )}
      </>
    );
  };
  return (
    <div style={drillStyles.wrap}>
      <div style={gdStyles.head}>
        <span style={drillStyles.heading}><MdHistory size={15} /> Stock ledger ({entries.length})</span>
        <span style={{ ...gdStyles.stat, ...gdStyles.statOk }} title="Value that came in, excluding tax">In <b>{money(tot.in.v)}</b></span>
        <span style={{ ...gdStyles.stat, ...gdStyles.statWarn }} title="Value that went out, excluding tax">Out <b>{money(tot.out.v)}</b></span>
        <span style={gdStyles.stat} title="Value in hand, excluding tax">Balance <b>{money(balValue)}</b></span>
        {showCost && tot.out.aKnown && tot.out.a > 0 && (
          <span style={gdStyles.stat} title="Value out less what those goods actually cost">Margin on sales <b>{money(tot.out.v - tot.out.a)}</b></span>
        )}
        {picker && <span style={{ marginLeft: "auto" }}>{picker}</span>}
      </div>
      {!canViewMovements && (
        <div style={{ ...gdStyles.help, marginBottom: "0.4rem" }}>
          Showing stock in from GDs only — invoices need the stock movements permission.
        </div>
      )}
      <div className="gd-lines" style={gdStyles.box}>
        <table style={gdStyles.table}>
          <thead>
            <tr>
              <th style={gdStyles.th}>Date</th>
              <th style={gdStyles.th}>Document</th>
              {show("qtyin") && <th style={gdStyles.thNum}>Qty In</th>}
              {show("qtyout") && <th style={gdStyles.thNum}>Qty Out</th>}
              {show("qtybal") && <th style={gdStyles.thNum}>Qty Balance</th>}
              {show("excl") && <th style={gdStyles.thNum}>Excluding</th>}
              {show("tax") && <th style={gdStyles.thNum}>Sales Tax</th>}
              {show("incl") && <th style={gdStyles.thNum}>Including</th>}
              {showCost && show("actual") && <th style={gdStyles.thNum}>Actual Cost</th>}
              {showCost && show("margin") && <th style={gdStyles.thNum} title="Excluding value less actual cost">Margin</th>}
              {show("balance") && <th style={gdStyles.thNum} title="Value in hand after this row, excluding tax">Value Balance</th>}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const isIn = e.dir === "In";
              return (
                <tr key={e.key}>
                  <td style={gdStyles.td} data-label="Date"><span style={{ whiteSpace: "nowrap" }}>{date(e.date)}</span></td>
                  <td style={{ ...gdStyles.td, minWidth: 200 }} data-label="Document">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                      <span style={{ ...drillStyles.dirBadge, ...(isIn ? drillStyles.dirIn : drillStyles.dirOut) }}>{isIn ? "IN" : "OUT"}</span>
                      <span style={gdStyles.gdNo}>{e.ref}</span>
                      <span style={gdStyles.sub}>{e.kind}</span>
                    </div>
                    {(e.detail || e.sub) && (
                      <div style={{ ...gdStyles.sub, ...gdStyles.desc }}>{[e.detail, e.sub].filter(Boolean).join(" · ")}</div>
                    )}
                    <AllocationChips allocations={e.allocations} isIn={isIn} />
                  </td>
                  {show("qtyin") && <td style={{ ...gdStyles.tdNum, color: "var(--dash-positive)", fontWeight: 600 }} data-label="Qty In">{isIn && !e.reval ? `+${num(e.qty)}` : ""}</td>}
                  {show("qtyout") && <td style={{ ...gdStyles.tdNum, color: "var(--dash-negative)", fontWeight: 600 }} data-label="Qty Out">{isIn || e.reval ? "" : `−${num(e.qty)}`}</td>}
                  {show("qtybal") && <td style={{ ...gdStyles.tdNum, fontWeight: 700, color: e.balance < 0 ? "var(--dash-negative)" : "var(--dash-primary)" }} data-label="Qty Balance">{num(e.balance)}</td>}
                  {moneyCells(e.dir, e.value, e.tax, e.actual, e.reval, false)}
                  {show("balance") && <td style={{ ...gdStyles.tdNum, fontWeight: 700, color: e.balanceValue < 0 ? "var(--dash-negative)" : "var(--dash-primary)" }} data-label="Value Balance">{money(e.balanceValue)}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {[["In", tot.in, totalIn], ["Out", tot.out, totalOut]].map(([dir, t, q]) => (
              <tr key={dir}>
                <td style={{ ...gdStyles.td, fontWeight: 700 }} colSpan={2} data-label="Total">Total {dir === "In" ? "in" : "out"}</td>
                {show("qtyin") && <td style={{ ...gdStyles.tdNum, fontWeight: 700, color: "var(--dash-positive)" }} data-label="Qty In">{dir === "In" ? `+${num(q)}` : ""}</td>}
                {show("qtyout") && <td style={{ ...gdStyles.tdNum, fontWeight: 700, color: "var(--dash-negative)" }} data-label="Qty Out">{dir === "Out" ? `−${num(q)}` : ""}</td>}
                {show("qtybal") && <td style={{ ...gdStyles.tdNum, fontWeight: 800, color: "var(--dash-primary)" }} data-label="Qty Balance">{dir === "Out" ? num(bal) : ""}</td>}
                {moneyCells(dir, t.v, t.t, t.aKnown ? t.a : null, false, true)}
                {show("balance") && <td style={{ ...gdStyles.tdNum, fontWeight: 800, color: "var(--dash-primary)" }} data-label="Value Balance">{dir === "Out" ? money(balValue) : ""}</td>}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      {(Math.abs(drift) > 0.0001 || Math.abs(valueDrift) > 0.5) && (
        <div style={gdStyles.untraced}>
          This ledger closes at {num(bal)}{unit} worth {money(balValue)}; in stock is {num(onHand)}{unit} worth {money(position?.valueExcludingTax)}.
          {restated ? " A stock-sheet restatement replaced this item's earlier GD lines, which explains the gap." : " The opening position on the Opening Balances tab explains any gap."}
        </div>
      )}
    </div>
  );
}

function ClaimMonthEditor({ line, value, onSave }) {
  const [draft, setDraft] = useState(value ? String(value).slice(0, 7) : "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await onSave(line, draft); }
    catch (e) { notify(e?.response?.data?.error || "Could not save the claim month.", "error"); }
    finally { setSaving(false); }
  };
  const dirty = draft !== (value ? String(value).slice(0, 7) : "");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
      <input type="month" value={draft} onChange={(e) => setDraft(e.target.value)}
        aria-label="Claim month for this line" title={value ? "Claim month for this line" : "Not claimed yet"}
        className="gd-claim-input"
        style={{ ...gdStyles.monthInput, ...(value ? null : gdStyles.monthInputEmpty) }} />
      <button type="button" disabled={saving || !dirty} onClick={save}
        className="gd-claim-save"
        style={{ ...gdStyles.saveBtn, ...(saving || !dirty ? gdStyles.saveBtnIdle : null) }}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function DrillPanel({ rows, loading, uom, canViewActualCost }) {
  if (loading) {
    return <div style={drillStyles.state}><div className="stk-spinner" /></div>;
  }
  if (!rows) {
    return <div style={drillStyles.state}>Loading…</div>;
  }
  if (rows.length === 0) {
    return <div style={drillStyles.state}>No movements recorded for this item yet.</div>;
  }

  const fmtQty = (q) => Number(q).toLocaleString(undefined, { maximumFractionDigits: 4 });

  // rows arrive newest-first from the API. Walk oldest→newest computing the
  // running balance, merging CONSECUTIVE rows that belong to the same source
  // document (+ direction, defensively) into one summed entry whose balance
  // is the on-hand AFTER the whole document. Rows without a SourceId
  // (adjustments, opening stock, deleted-document reversals) never merge.
  // The API's runningQuantity already counts the opening balance in, so it is
  // preferred over the local walk — which starts at zero and therefore reads
  // low by exactly the opening for every item that has one.
  const oldestFirst = [...rows].reverse();
  let bal = 0;
  const grouped = [];
  for (const m of oldestFirst) {
    bal += m.direction === "In" ? Number(m.quantity) : -Number(m.quantity);
    const runQty = m.runningQuantity != null ? Number(m.runningQuantity) : bal;
    const key = m.sourceId != null ? `${m.sourceType}:${m.sourceId}:${m.direction}` : `row:${m.id}`;
    const last = grouped[grouped.length - 1];
    if (last && last.groupKey === key) {
      last.quantity = Number(last.quantity) + Number(m.quantity);
      last.value = Number(last.value) + Number(m.value || 0);
      last.balance = runQty;
      last.runningValue = Number(m.runningValue || 0);
      // Actual-cost pool's own running total -- a point-in-time state, like
      // runningValue, so the LATEST line in the group wins rather than summing.
      last.runningActualValue = Number(m.runningActualValue || 0);
      last.lineCount += 1;
      last.allocations = [...(last.allocations || []), ...(m.allocations || [])];
      last.id = m.id;                     // newest id keeps the React key stable
      last.movementDate = m.movementDate; // same document date; keep newest
    } else {
      grouped.push({
        ...m, groupKey: key,
        quantity: Number(m.quantity),
        value: Number(m.value || 0),
        balance: runQty,
        runningValue: Number(m.runningValue || 0),
        runningActualValue: Number(m.runningActualValue || 0),
        lineCount: 1,
        allocations: [...(m.allocations || [])],
      });
    }
  }
  grouped.reverse();

  return (
    <div style={drillStyles.wrap}>
      <div style={drillStyles.heading}>
        <MdHistory size={15} /> Movement history ({grouped.length}{grouped.length !== rows.length ? ` documents · ${rows.length} line movements` : ""})
      </div>
      <div style={drillStyles.list}>
        {grouped.map((m) => {
          const isIn = m.direction === "In";
          const isAdjust = m.sourceType === "Adjustment";
          // Grouped rows: keep the note's document prefix, drop the per-line
          // detail (each line carried its own qty breakdown), and say how
          // many line items were summed.
          const noteText = m.lineCount > 1
            ? `${(m.notes || "").split(" (")[0]}${m.notes ? " — " : ""}${m.lineCount} line items summed`
            : m.notes;
          return (
            <div key={m.id} style={drillStyles.row}>
              <div style={drillStyles.rowMain}>
                <span style={{ ...drillStyles.dirBadge, ...(isIn ? drillStyles.dirIn : drillStyles.dirOut) }}>
                  {isIn ? "IN" : "OUT"}
                </span>
                <span style={{ ...drillStyles.qty, color: isIn ? "var(--dash-positive)" : "var(--dash-negative)" }}>
                  {isIn ? "+" : "−"}{fmtQty(m.quantity)}{uom ? ` ${uom}` : ""}
                </span>
                <span style={{ ...drillStyles.srcChip, ...(isAdjust ? drillStyles.srcAdjust : null) }}>
                  {m.sourceType}{m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}
                </span>
                <span style={{ ...drillStyles.qty, color: isIn ? "var(--dash-positive)" : "var(--dash-negative)" }}>
                  {isIn ? "+" : "−"}{money(m.value)}
                </span>
                <span style={drillStyles.date}>{new Date(m.movementDate).toLocaleDateString()}</span>
                <span style={drillStyles.bal}>
                  bal {fmtQty(m.balance)} · {money(m.runningValue)}
                  {canViewActualCost && ` (actual ${money(m.runningActualValue)})`}
                </span>
              </div>
              {noteText && <div style={drillStyles.notes}>{noteText}</div>}
              <AllocationChips allocations={m.allocations} isIn={isIn} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The one search box every tab shares — same value, so switching tabs keeps
// what was typed.
function SearchBox({ value, onChange }) {
  return (
    <div className="stk-search">
      <MdSearch size={16} className="stk-search-icon" aria-hidden="true" />
      <input type="text" className="stk-input" placeholder="Search item, HS code or GD number..." value={value}
        aria-label="Search item, HS code or GD number"
        onChange={e => onChange(e.target.value)} />
      {value && (
        <button type="button" className="stk-search-clear" onClick={() => onChange("")} title="Clear search" aria-label="Clear search">
          <MdClose size={16} />
        </button>
      )}
    </div>
  );
}

// GD numbers behind an item as compact chips: up to two in full, otherwise
// the first plus a "+N" chip; the tooltip lists every one. The full list is in
// the expanded GD panel, and search still matches every GD number.
function GdList({ gds }) {
  if (!gds || gds.length === 0) return <span style={{ color: "var(--dash-text)" }}>—</span>;
  const shown = gds.length <= 2 ? gds : gds.slice(0, 1);
  const rest = gds.length - shown.length;
  return (
    <div className="stk-gds" title={gds.join("\n")}>
      {shown.map(g => <span key={g} className="stk-gd">{g}</span>)}
      {rest > 0 && <span className="stk-gd more" aria-label={`${rest} more GD numbers`}>+{rest}</span>}
    </div>
  );
}

// One figure in the KPI strip (the Overview's card, compact). `tone` picks the
// accent strip: default primary, t = teal, o = amber, g = green.
function Kpi({ label, value, sub, tone, negative }) {
  return (
    <div className={`stk-kpi${tone ? ` ${tone}` : ""}`}>
      <div className="l">{label}</div>
      <div className={`v${negative ? " neg" : ""}`}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

function TabBtn({ active, children, onClick, count }) {
  return (
    <button type="button" role="tab" aria-selected={active} className="stk-tab" onClick={onClick}>
      {children}<span className="n">{count}</span>
    </button>
  );
}

// An expanded On-Hand row: the GD lots behind it, and (with the movements
// permission) its movement history, as two sub-tabs. Both panels are the ones
// the row always had; only one shows at a time.
function OnhandDrill({ row, tab, onTab, gdRows, gdLoading, moves, movesLoading, canViewMovements, canEdit, onSave, canViewActualCost }) {
  const showMoves = canViewMovements && tab === "moves";
  return (
    <div className="stk-drill">
      <div className="stk-subtabs" role="tablist" aria-label={`Details for ${row.itemTypeName}`}>
        <button type="button" role="tab" className="stk-subtab" aria-selected={!showMoves} onClick={() => onTab("gd")}>
          GD lots{gdRows ? ` (${gdRows.length})` : ""}
        </button>
        {canViewMovements && (
          <button type="button" role="tab" className="stk-subtab" aria-selected={showMoves} onClick={() => onTab("moves")}>
            Movement history
          </button>
        )}
      </div>
      {showMoves ? (
        <DrillPanel rows={moves} loading={movesLoading} uom={row.uom} canViewActualCost={canViewActualCost} />
      ) : (
        <GdPanel rows={gdRows} loading={gdLoading}
          openingQty={row.openingBalance} openingValue={row.openingValueExcludingTax}
          canEdit={canEdit} onSave={onSave} />
      )}
    </div>
  );
}

/// Opening-balance and adjustment dialog.
///
/// Uses the shared formStyles rather than a hand-rolled overlay. The
/// hand-rolled one centred the card in a backdrop with no overflow and put no
/// maxHeight on the card, so the Adjustment form -- two modes, five fields, a
/// notes box -- grew taller than the viewport and pushed Cancel, Save AND the
/// close X off-screen with no way to scroll to them. Reported from production
/// 2026-09-17: "i can't cancel or update anything".
///
/// This is the same defect CLAUDE.md section 3 records against CorrectionWizard.
/// The fix is the documented one: backdrop scrolls, card caps at 96vh, and the
/// BODY scrolls inside it so the header and footer stay put.
function SmallModal({ title, children, onClose, onSubmit, submitting }) {
  // Escape closes, because a dialog you cannot dismiss is the whole complaint.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      style={{ ...formStyles.backdrop, alignItems: "flex-start" }}
      // Clicking the backdrop dismisses; clicks inside the card must not.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      role="presentation"
    >
      <div
        className="stk"
        style={{
          ...formStyles.modal,
          maxWidth: modalSizes.md,
          // Sits just below the top of a tall viewport, but is free to grow
          // downward and scroll internally on a short one.
          margin: "auto",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{title}</h5>
          <button type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>

        <form
          onSubmit={onSubmit}
          style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}
        >
          {/* Only the body scrolls, so the footer buttons are always reachable. */}
          <div style={formStyles.body}>
            {children}
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: submitting ? 0.7 : 1 }} disabled={submitting} aria-busy={submitting || undefined}>
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={formStyles.formGroup}>
      <label style={formStyles.label}>{label}</label>
      {children}
    </div>
  );
}

const mInput = { ...formStyles.input, minHeight: 40 };
const mInputLocked = { backgroundColor: "#eef1f5", cursor: "not-allowed" };
const qtyHint = { fontSize: "11px", color: "var(--dash-text)", marginTop: "0.35rem" };
// "On record now" strip + the mode switch at the top of the Adjustment dialog.
const adjustNow = {
  display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "baseline",
  padding: "8px 10px", marginBottom: "0.7rem",
  borderRadius: 8, backgroundColor: "var(--dash-head-bg)", fontSize: "11.5px", color: "var(--dash-text)",
};
const adjustNowLabel = {
  fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.06em",
  textTransform: "uppercase", color: "var(--dash-muted)", marginRight: "0.3rem",
};
const modeRow = { display: "flex", gap: "0.4rem", marginBottom: "0.35rem" };
// 40px tall so the pair stays a comfortable tap target on a phone.
const modeBtn = {
  flex: 1, minHeight: 40, padding: "0.45rem 0.6rem", borderRadius: 8, boxShadow: "none",
  border: "1px solid", cursor: "pointer", fontSize: "12px", fontWeight: 600,
};
// Full-width card button (phone): 44px tall, stacked under the card's figures.
const cardBtn = { width: "100%", minHeight: 44, marginTop: 6 };
const gdTh = { padding: "6px 10px", backgroundColor: "var(--dash-head-bg)", borderBottom: "1px solid var(--dash-grid)", fontSize: "10px", fontWeight: 600, color: "var(--dash-text)", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" };
const gdTd = { padding: "6px 10px", borderBottom: "1px solid var(--dash-line)", verticalAlign: "top", color: "var(--dash-ink)" };
const gdStyles = {
  head: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.45rem", marginBottom: "0.35rem" },
  stat: { fontSize: "11px", color: "var(--dash-ink)", backgroundColor: "var(--dash-card)", border: "1px solid var(--dash-grid)", borderRadius: 999, padding: "1px 8px", fontVariantNumeric: "tabular-nums" },
  statWarn: { color: "var(--dash-negative)", backgroundColor: "var(--dash-negative-soft)", border: "1px solid var(--dash-negative-soft)" },
  statOk: { color: "var(--dash-positive)", backgroundColor: "var(--dash-positive-soft)", border: "1px solid var(--dash-positive-soft)" },
  help: { fontSize: "11px", color: "var(--dash-text)", marginBottom: "0.5rem", lineHeight: 1.4 },
  helpSummary: { cursor: "pointer", color: "var(--dash-primary)", fontWeight: 600, width: "fit-content" },
  box: { border: "1px solid var(--dash-grid)", borderRadius: 8, backgroundColor: "var(--dash-card)", overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "11.5px" },
  th: { ...gdTh, textAlign: "left" },
  thNum: { ...gdTh, textAlign: "right" },
  td: gdTd,
  tdNum: { ...gdTd, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  gdNo: { fontFamily: "ui-monospace, Consolas, monospace", fontWeight: 600, color: "var(--dash-primary)", whiteSpace: "nowrap" },
  sub: { fontSize: "10.5px", color: "var(--dash-muted)", marginTop: 1 },
  desc: { lineHeight: 1.3, overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  pill: { display: "inline-block", fontSize: "10.5px", fontWeight: 600, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" },
  monthInput: { height: 30, padding: "0 0.4rem", border: "1px solid var(--dash-grid)", borderRadius: 6, fontSize: "11.5px", color: "var(--dash-ink)", backgroundColor: "var(--dash-card)", minWidth: 0 },
  monthInputEmpty: { borderColor: "var(--dash-warn-line)", backgroundColor: "var(--dash-warn-soft)" },
  saveBtn: { height: 30, padding: "0 0.65rem", borderRadius: 6, border: "1px solid var(--dash-primary)", backgroundColor: "var(--dash-primary)", color: "var(--dash-card)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", boxShadow: "none", whiteSpace: "nowrap" },
  saveBtnIdle: { backgroundColor: "var(--dash-card)", color: "var(--dash-muted)", border: "1px solid var(--dash-grid)", cursor: "default" },
  untraced: { marginTop: "0.5rem", fontSize: "11px", color: "var(--dash-warn-ink)", backgroundColor: "var(--dash-warn-soft)", border: "1px solid var(--dash-warn-line)", borderRadius: 6, padding: "6px 10px" },
};

const drillStyles = {
  wrap: { padding: 0 },
  heading: { display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "10.5px", fontWeight: 600, color: "var(--dash-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" },
  state: { padding: "1rem 0.85rem", textAlign: "center", color: "var(--dash-text)", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48 },
  list: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  row: { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--dash-grid)", backgroundColor: "var(--dash-card)" },
  rowMain: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" },
  dirBadge: { fontSize: "10.5px", fontWeight: 600, padding: "1px 8px", borderRadius: 999, letterSpacing: "0.03em" },
  dirIn: { backgroundColor: "var(--dash-positive-soft)", color: "var(--dash-positive)" },
  dirOut: { backgroundColor: "var(--dash-negative-soft)", color: "var(--dash-negative)" },
  qty: { fontSize: "12.5px", fontWeight: 700, minWidth: 70, fontVariantNumeric: "tabular-nums" },
  srcChip: { fontSize: "11px", fontWeight: 600, color: "var(--dash-ink)", backgroundColor: "var(--dash-neutral-soft)", padding: "1px 7px", borderRadius: 5 },
  srcAdjust: { backgroundColor: "var(--dash-warn-soft)", color: "var(--dash-warn)" },
  date: { fontSize: "11px", color: "var(--dash-text)", marginLeft: "auto" },
  bal: { fontSize: "11px", fontWeight: 600, color: "var(--dash-primary)", backgroundColor: "var(--dash-primary-soft)", padding: "1px 7px", borderRadius: 5, fontVariantNumeric: "tabular-nums" },
  notes: { fontSize: "11px", color: "var(--dash-text)", marginTop: "0.35rem", lineHeight: 1.35 },
};
