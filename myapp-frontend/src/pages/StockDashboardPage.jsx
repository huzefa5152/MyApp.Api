import { useState, useEffect, useCallback, Fragment } from "react";
import { MdInventory, MdBusiness, MdSearch, MdAdd, MdHistory, MdTune, MdClose, MdSwapHoriz, MdExpandMore, MdChevronRight, MdSyncAlt } from "react-icons/md";
import { getStockOnHand, getInventorySummary, setInventoryFlowVersion, getStockMovements, getOpeningBalances, upsertOpeningBalance, deleteOpeningBalance, adjustStock } from "../api/stockApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getAllUnits } from "../api/unitsApi";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import { isDecimalUnit } from "../utils/formatQuantity";
import SearchableItemTypeSelect from "../Components/SearchableItemTypeSelect";
import Pagination from "../Components/Pagination";
import usePageSize from "../hooks/usePageSize";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  rowAlt: "#fafbfd",
  bandBg: "#f0f7ff",
};

const money = (v) =>
  Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const num = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

export default function StockDashboardPage() {
  const { companies, selectedCompany, setSelectedCompany, refreshCompanies, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canManageOpening = has("stock.opening.manage");
  const canAdjust = has("stock.adjust.create");
  const canViewMovements = has("stock.movements.view");
  const canManagePolicy = has("stock.policy.manage");
  const flowVersion = Number(selectedCompany?.inventoryFlowVersion) === 2 ? 2 : 1;

  const [onhandPage, setOnhandPage] = useState(1);
  const [onhandPageSize, setOnhandPageSize] = usePageSize("stockOnhand");

  const [tab, setTab] = useState("onhand");
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
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // On-hand drill-down: which item-type row is expanded, plus a cache of
  // the full movement history per item type (so re-expanding is instant).
  const [expandedId, setExpandedId] = useState(null);
  const [drill, setDrill] = useState({});        // itemTypeId → movement[]
  const [drillLoading, setDrillLoading] = useState(null); // itemTypeId being fetched

  const [showOpening, setShowOpening] = useState(false);
  const [openingDraft, setOpeningDraft] = useState({ itemTypeId: "", quantity: 0, valueExcludingTax: "", salesTaxRate: "", asOfDate: todayYmd(), notes: "" });
  const [showAdjust, setShowAdjust] = useState(false);
  // "set" is the default: someone fixing a mistake knows what the figures
  // SHOULD be, not the size of their error, so the form takes the truth and
  // the server works out the change. "delta" is still there for a genuine
  // movement ("10 more arrived", "3 broke").
  const [adjustDraft, setAdjustDraft] = useState({
    itemTypeId: "", mode: "set",
    delta: 0, valueDelta: "", unitCost: "",
    targetQuantity: "", targetValue: "",
    salesTaxRate: "", movementDate: todayYmd(), notes: "",
  });
  // Set when the Adjustment modal is launched from a grid row — the item
  // is fixed (read-only display) so the operator just types the delta.
  // Null when opened from the header button (free pick).
  const [adjustLockedItem, setAdjustLockedItem] = useState(null);

  const fetchAll = useCallback(async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const [oh, sm, op, it, mov] = await Promise.all([
        getStockOnHand(selectedCompany.id),
        getInventorySummary(selectedCompany.id).catch(() => ({ data: [] })),
        canManageOpening ? getOpeningBalances(selectedCompany.id) : Promise.resolve({ data: [] }),
        getItemTypes(),
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
      setItemTypes(it.data || []);
      setMovements(mov.data?.items || []);
      setMovTotal(mov.data?.totalCount || 0);
      setMovPageSize(mov.data?.pageSize || 0);
      // A refresh can change movement history (new adjustment, edited bill),
      // so drop the drill cache; keep the expanded row open to refetch.
      setDrill({});
    } catch {
      setOnhand([]); setOpenings([]); setItemTypes([]);
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

  // Units list (carries the AllowsDecimalQuantity flag) drives whether the
  // opening-balance / adjustment quantity inputs accept decimals — the same
  // per-Unit rule the bill / challan forms use. Units are global (not
  // company-scoped), so fetch once on mount.
  useEffect(() => {
    getAllUnits().then(r => setUnits(r.data || [])).catch(() => setUnits([]));
  }, []);

  const filteredOnhand = onhand.filter(r =>
    !search || r.itemTypeName.toLowerCase().includes(search.toLowerCase()) ||
    (r.hsCode || "").toLowerCase().includes(search.toLowerCase())
  );

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
  const onhandTotals = filteredOnhand.reduce((acc, r) => ({
    qty: acc.qty + (r.onHand || 0),
    excl: acc.excl + (r.valueExcludingTax || 0),
    tax: acc.tax + (r.salesTax || 0),
    incl: acc.incl + (r.valueIncludingTax || 0),
  }), { qty: 0, excl: 0, tax: 0, incl: 0 });

  const filteredSummary = summary.filter(r =>
    !search || r.itemTypeName.toLowerCase().includes(search.toLowerCase()) ||
    (r.hsCode || "").toLowerCase().includes(search.toLowerCase())
  );

  // Switch the selected company between V1 (legacy HS-gated) and V2 (standard
  // inventory). Reversible + audited server-side. Refresh the company list so
  // the badge + selectedCompany.inventoryFlowVersion update, then refetch.
  const switchVersion = async () => {
    if (!selectedCompany) return;
    const target = flowVersion === 2 ? 1 : 2;
    const ok = await confirm({
      title: `Switch to ${target === 2 ? "V2 (Standard Inventory)" : "V1 (Legacy)"}`,
      message: target === 2
        ? "Switch this company to V2 (Standard Inventory)? ALL item types become inventory (HS code becomes FBR metadata only), and over-commit / oversell will be hard-blocked. Reversible."
        : "Switch this company back to V1 (Legacy)? Only HS-coded item types will be stock-tracked, as before. Reversible.",
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

  const submitOpening = async (e) => {
    e.preventDefault();
    if (!openingDraft.itemTypeId) return notify("Pick an item.", "error");
    try {
      await upsertOpeningBalance({
        companyId: selectedCompany.id,
        itemTypeId: parseInt(openingDraft.itemTypeId),
        quantity: parseFloat(openingDraft.quantity) || 0,
        valueExcludingTax: parseFloat(openingDraft.valueExcludingTax) || 0,
        salesTaxRate: parseFloat(openingDraft.salesTaxRate) || 0,
        asOfDate: openingDraft.asOfDate,
        notes: openingDraft.notes || null,
      });
      notify("Opening balance saved.", "success");
      setShowOpening(false);
      setOpeningDraft({ itemTypeId: "", quantity: 0, valueExcludingTax: "", salesTaxRate: "", asOfDate: todayYmd(), notes: "" });
      fetchAll();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to save opening balance.", "error");
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
      targetQuantity: "", targetValue: "", salesTaxRate: "",
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
  }, []);

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

  // Drop the drill cache + collapse whenever the company changes.
  useEffect(() => { setExpandedId(null); setDrill({}); }, [selectedCompany]);

  // A narrower search, a different company or a smaller page can all strand
  // the operator past the last page.
  useEffect(() => { setOnhandPage(1); }, [search, selectedCompany, onhandPageSize]);

  const submitAdjust = async (e) => {
    e.preventDefault();
    if (!adjustDraft.itemTypeId) return notify("Pick an item.", "error");
    if (adjustDraft.mode === "set"
        && adjustDraft.targetQuantity === "" && adjustDraft.targetValue === "")
      return notify("Say what the quantity or the value should be.", "error");
    if (adjustDraft.mode === "delta"
        && !parseFloat(adjustDraft.delta) && !parseFloat(adjustDraft.valueDelta))
      return notify("Give a quantity change, a value change, or both.", "error");
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
        salesTaxRate: parseFloat(adjustDraft.salesTaxRate) || null,
        movementDate: adjustDraft.movementDate,
        notes: adjustDraft.notes || null,
      });
      notify(data?.message || "Adjustment recorded.", "success");
      closeAdjust();
      fetchAll();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to record adjustment.", "error");
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

  const adjustItem = itemTypes.find(it => String(it.id) === String(adjustDraft.itemTypeId)) || adjustLockedItem;
  const adjustUom = adjustItem?.uom || "";
  const adjustAllowsDecimal = isDecimalUnit(adjustUom, units);

  // Modal pickers list ALL catalog item types (HS-coded or not) — opening
  // balances/adjustments are operational stock counts, not FBR submissions,
  // so items without an HS code must be selectable too. Opening Balance still
  // hides items already on the on-hand grid: those are corrected via the
  // per-row Adjust action, not by seeding a second opening.
  const onhandIds = new Set(onhand.map(r => r.itemTypeId));
  const openingPickerItems = itemTypes.filter(it => !onhandIds.has(it.id));

  return (
    <div className="stock-page">
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}><MdInventory size={28} color="#fff" /></div>
          <div>
            <h2 style={styles.title}>Stock Dashboard</h2>
            <p style={styles.subtitle}>
              {selectedCompany
                ? `On-hand inventory for ${selectedCompany.brandName || selectedCompany.name}`
                : "Select a company"}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {selectedCompany && (
            <span
              style={flowVersion === 2 ? styles.verPillV2 : styles.verPillV1}
              title={flowVersion === 2
                ? "V2 Standard Inventory — all item types are tracked; HS code is FBR metadata only."
                : "V1 Legacy — only HS-coded item types are stock-tracked."}
            >
              {flowVersion === 2 ? "Inventory V2 · Standard" : "Inventory V1 · Legacy"}
            </span>
          )}
          {canManagePolicy && selectedCompany && (
            <button
              style={styles.altBtn}
              onClick={switchVersion}
              title={flowVersion === 2 ? "Switch back to legacy tracking" : "Switch to standard inventory (V2)"}
            >
              <MdSyncAlt size={16} /> {flowVersion === 2 ? "Switch to V1" : "Switch to V2"}
            </button>
          )}
          {canManageOpening && (
            <button style={styles.altBtn} onClick={() => setShowOpening(true)}>
              <MdTune size={16} /> Opening Balance
            </button>
          )}
          {canAdjust && (
            <button style={styles.altBtn} onClick={() => { setAdjustLockedItem(null); setShowAdjust(true); }}>
              <MdSwapHoriz size={16} /> Adjustment
            </button>
          )}
        </div>
      </div>

      {loadingCompanies ? (
        <div style={styles.loading}><div style={styles.spinner} /></div>
      ) : companies.length === 0 ? (
        <div style={styles.empty}>No companies available.</div>
      ) : (
        <>
          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select style={dropdownStyles.base} value={selectedCompany?.id || ""}
                    onChange={e => setSelectedCompany(companies.find(c => parseInt(c.id) === parseInt(e.target.value)))}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </div>

          {selectedCompany && !selectedCompany.inventoryTrackingEnabled && (
            <div style={styles.warnBanner}>
              ⚠ Inventory tracking is OFF for this company. Stock IN / OUT movements are not being recorded automatically.
              You can still record opening balances and manual adjustments here, then enable tracking on the Company settings to begin auto-tracking purchases and sales.
            </div>
          )}

          <div style={styles.tabs}>
            <TabBtn active={tab === "onhand"} onClick={() => setTab("onhand")}>On-Hand ({onhand.length})</TabBtn>
            {summary.length > 0 && <TabBtn active={tab === "inventory"} onClick={() => setTab("inventory")}>Inventory ({summary.length})</TabBtn>}
            {canManageOpening && <TabBtn active={tab === "opening"} onClick={() => setTab("opening")}>Opening Balances ({openings.length})</TabBtn>}
            {canViewMovements && <TabBtn active={tab === "movements"} onClick={() => setTab("movements")}>Movements ({movTotal})</TabBtn>}
          </div>

          {tab === "onhand" && (
            <>
              {/* Search renders whenever there is ANY stock data — gating it
                  on the FILTERED list meant a no-match search unmounted the
                  box itself and the operator had no way to clear it. */}
              {onhand.length > 0 && (
                <div style={styles.searchWrap}>
                  <MdSearch style={styles.searchIcon} />
                  <input type="text" placeholder="Search item or HS code..." value={search} onChange={e => setSearch(e.target.value)} style={styles.searchInput} />
                  {search && (
                    <button type="button" style={styles.searchClear} onClick={() => setSearch("")} title="Clear search">
                      <MdClose size={16} />
                    </button>
                  )}
                </div>
              )}
              {!loading && filteredOnhand.length > 0 && (
                <div style={styles.valueStrip}>
                  <ValueTile label="Quantity" value={num(onhandTotals.qty)} />
                  <ValueTile label="Excluding tax" value={money(onhandTotals.excl)} />
                  <ValueTile label="Sales tax" value={money(onhandTotals.tax)} />
                  <ValueTile label="Including tax" value={money(onhandTotals.incl)} strong />
                </div>
              )}
              {loading ? (
                <div style={styles.loading}><div style={styles.spinner} /></div>
              ) : filteredOnhand.length === 0 ? (
                <div style={styles.empty}>
                  <MdInventory size={40} color={colors.cardBorder} />
                  {search ? (
                    <>
                      <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
                        No items match "{search}".
                      </p>
                      <button type="button" style={styles.clearSearchBtn} onClick={() => setSearch("")}>
                        Clear search
                      </button>
                    </>
                  ) : (
                    <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
                      No stock data yet. Set opening balances or post a Purchase Bill / FBR-submitted invoice to start tracking.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {/* Desktop / tablet — table */}
                  {/* Fourteen columns did not fit any laptop, so the figures
                      are grouped instead of dropped: the code, unit and last
                      movement sit under the item name, and the opening / IN /
                      OUT flow sits under the on-hand figure it explains.
                      Nothing is hidden, and the table stops scrolling
                      sideways. */}
                  <div className="stock-table" style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          {canViewMovements && <th style={styles.th} aria-label="Expand"></th>}
                          <th style={styles.th}>Item</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>On-Hand</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Excluding</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Sales Tax</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Including</th>
                          {canAdjust && <th style={styles.th} aria-label="Actions"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {onhandPageRows.map((r, idx) => {
                          const isOpen = expandedId === r.itemTypeId;
                          const rowBg = idx % 2 === 0 ? "#fff" : colors.rowAlt;
                          const colCount = 5 + (canViewMovements ? 1 : 0) + (canAdjust ? 1 : 0);
                          return (
                          <Fragment key={r.itemTypeId}>
                          <tr
                            style={{ backgroundColor: isOpen ? colors.bandBg : rowBg, cursor: canViewMovements ? "pointer" : "default" }}
                            onClick={canViewMovements ? () => toggleDrill(r.itemTypeId) : undefined}
                          >
                            {canViewMovements && (
                              <td style={{ ...styles.td, textAlign: "center", color: colors.textSecondary }}>
                                {isOpen ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}
                              </td>
                            )}
                            <td style={styles.td}>
                              {/* Clamped, never ellipsised on one line: two
                                  item names sharing a prefix must stay
                                  distinguishable (dashboard incident
                                  2026-05-13). */}
                              <div style={styles.itemName}>{r.itemTypeName}</div>
                              <div style={styles.itemMeta}>
                                <span style={styles.hsChip}>{r.hsCode || "no HS code"}</span>
                                {r.uom && <span>{r.uom}</span>}
                                <span>
                                  {r.lastMovementAt
                                    ? `moved ${new Date(r.lastMovementAt).toLocaleDateString()}`
                                    : "no movements"}
                                </span>
                              </div>
                            </td>
                            <td style={styles.tdMoney}>
                              <div style={{ fontWeight: 700, color: r.onHand < 0 ? "#c62828" : colors.blue }}>
                                {num(r.onHand)}
                              </div>
                              <div style={styles.flowMeta}>
                                <span title="Opening balance">{num(r.openingBalance)}</span>
                                <span style={{ color: "#2e7d32" }} title="Total in">+{num(r.totalIn)}</span>
                                <span style={{ color: "#c62828" }} title="Total out">−{num(r.totalOut)}</span>
                              </div>
                            </td>
                            <td style={styles.tdMoney}>{money(r.valueExcludingTax)}</td>
                            <td style={styles.tdMoney}>
                              <div>{money(r.salesTax)}</div>
                              <div style={styles.rateChip}>
                                {r.salesTaxRate ? `${num(r.salesTaxRate)}%` : "no rate"}
                              </div>
                            </td>
                            <td style={{ ...styles.tdMoney, fontWeight: 700 }}>{money(r.valueIncludingTax)}</td>
                            {canAdjust && (
                              <td style={styles.td} onClick={e => e.stopPropagation()}>
                                <button type="button" style={rowAdjustBtn} onClick={() => openAdjustForRow(r)} title={`Record a stock adjustment for ${r.itemTypeName}`}>
                                  <MdSwapHoriz size={13} /> Adjust
                                </button>
                              </td>
                            )}
                          </tr>
                          {isOpen && canViewMovements && (
                            <tr>
                              <td colSpan={colCount} style={{ padding: 0, borderBottom: `1px solid ${colors.cardBorder}`, backgroundColor: colors.bandBg }}>
                                <DrillPanel
                                  rows={drill[r.itemTypeId]}
                                  loading={drillLoading === r.itemTypeId}
                                  uom={r.uom}
                                />
                              </td>
                            </tr>
                          )}
                          </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile — On-hand stack. The "answer" the page exists to
                      show is on-hand quantity, so it goes top-right at large
                      size. IN / OUT / Opening are secondary stats below. */}
                  <div className="stock-cards">
                    {onhandPageRows.map((r) => {
                      const isOpen = expandedId === r.itemTypeId;
                      return (
                      <div key={r.itemTypeId} className="stock-card">
                        <div className="stock-card__top">
                          <div className="stock-card__top-left">
                            <span className="stock-card__name">{r.itemTypeName}</span>
                            {r.hsCode && <span className="stock-card__hs">{r.hsCode}</span>}
                          </div>
                          <div className="stock-card__onhand">
                            <span className="stock-card__onhand-label">On-Hand</span>
                            <span
                              className="stock-card__onhand-value"
                              style={{ color: r.onHand < 0 ? "#c62828" : colors.blue }}
                            >
                              {r.onHand.toLocaleString()}
                              {r.uom && <span className="stock-card__uom"> {r.uom}</span>}
                            </span>
                          </div>
                        </div>
                        <div className="stock-card__stats">
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Opening</span>
                            <span className="stock-card__stat-value">{r.openingBalance.toLocaleString()}</span>
                          </div>
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Total IN</span>
                            <span className="stock-card__stat-value" style={{ color: "#2e7d32" }}>+{r.totalIn.toLocaleString()}</span>
                          </div>
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Total OUT</span>
                            <span className="stock-card__stat-value" style={{ color: "#c62828" }}>−{r.totalOut.toLocaleString()}</span>
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
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Last Move</span>
                            <span className="stock-card__stat-value stock-card__stat-value--muted">
                              {r.lastMovementAt ? new Date(r.lastMovementAt).toLocaleDateString() : "—"}
                            </span>
                          </div>
                        </div>
                        {canViewMovements && (
                          <button type="button" style={cardDrillBtn} onClick={() => toggleDrill(r.itemTypeId)}>
                            {isOpen ? <MdExpandMore size={16} /> : <MdChevronRight size={16} />}
                            {isOpen ? "Hide movements" : "View movements"}
                          </button>
                        )}
                        {isOpen && canViewMovements && (
                          <DrillPanel rows={drill[r.itemTypeId]} loading={drillLoading === r.itemTypeId} uom={r.uom} />
                        )}
                        {canAdjust && (
                          <button type="button" style={cardAdjustBtn} onClick={() => openAdjustForRow(r)}>
                            <MdSwapHoriz size={15} /> Adjustment
                          </button>
                        )}
                      </div>
                      );
                    })}
                  </div>

                  {/* One pager below both renders -- they are the desktop and
                      phone views of the same page. The totals strip above
                      still covers the whole filtered set, not this page. */}
                  <Pagination
                    page={onhandPage}
                    totalPages={onhandTotalPages}
                    total={filteredOnhand.length}
                    onPage={setOnhandPage}
                    pageSize={onhandSize}
                    onPageSize={setOnhandPageSize}
                    unit="items"
                  />
                </>
              )}
            </>
          )}

          {tab === "inventory" && (
            <>
              {summary.length > 0 && (
                <div style={styles.searchWrap}>
                  <MdSearch style={styles.searchIcon} />
                  <input type="text" placeholder="Search item or HS code..." value={search} onChange={e => setSearch(e.target.value)} style={styles.searchInput} />
                  {search && (
                    <button type="button" style={styles.searchClear} onClick={() => setSearch("")} title="Clear search">
                      <MdClose size={16} />
                    </button>
                  )}
                </div>
              )}
              {loading ? (
                <div style={styles.loading}><div style={styles.spinner} /></div>
              ) : filteredSummary.length === 0 ? (
                <div style={styles.empty}>
                  <MdInventory size={40} color={colors.cardBorder} />
                  <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
                    {search ? `No items match "${search}".` : "No inventory activity yet."}
                  </p>
                </div>
              ) : (
                <>
                {/* Desktop / tablet — table */}
                <div className="stock-table" style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Item</th>
                        <th style={{ ...styles.th, textAlign: "right" }} title="Physical stock in hand">In Stock</th>
                        <th style={{ ...styles.th, textAlign: "right" }} title="Free to sell = In Stock - Committed">Available</th>
                        <th style={{ ...styles.th, textAlign: "right" }} title="Reserved to customers = To Deliver + Delivered">Committed</th>
                        <th style={{ ...styles.th, textAlign: "right" }} title="Ordered, not yet delivered">To Deliver</th>
                        <th style={{ ...styles.th, textAlign: "right" }} title="Delivered on a challan, not yet billed">Delivered</th>
                        <th style={{ ...styles.th, textAlign: "right" }} title="On un-billed goods receipts">Incoming</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSummary.map((r, idx) => (
                        <tr key={r.itemTypeId} style={idx % 2 ? { background: colors.rowAlt } : undefined}>
                          <td style={styles.td}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 600 }}>{r.itemTypeName}</span>
                              {!r.tracked && (
                                <span style={styles.fbrBadge} title="FBR-reporting item — not tracked as inventory">FBR-only</span>
                              )}
                              {r.reorderLevel != null && r.available <= r.reorderLevel && (
                                <span style={styles.lowBadge} title={`At/below reorder level ${r.reorderLevel}`}>Low</span>
                              )}
                            </div>
                          </td>
                          {r.tracked ? (
                            <>
                              <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: r.onHand < 0 ? "#c62828" : colors.blue }}>{r.onHand.toLocaleString()}</td>
                              <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: r.available < 0 ? "#c62828" : colors.teal }}>{r.available.toLocaleString()}</td>
                              <td style={{ ...styles.td, textAlign: "right" }}>{r.committed.toLocaleString()}</td>
                              <td style={{ ...styles.td, textAlign: "right" }}>{r.toDeliver.toLocaleString()}</td>
                              <td style={{ ...styles.td, textAlign: "right" }}>{r.delivered.toLocaleString()}</td>
                              <td style={{ ...styles.td, textAlign: "right" }}>{r.incoming.toLocaleString()}</td>
                            </>
                          ) : (
                            <td style={{ ...styles.td, textAlign: "center", color: colors.textSecondary }} colSpan={6}>—</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile — inventory (V2 buckets) stack. In Stock is the
                    headline metric; the reservation buckets are secondary
                    stats below. Untracked (FBR-only) items show a note. */}
                <div className="stock-cards">
                  {filteredSummary.map((r) => (
                    <div key={r.itemTypeId} className="stock-card">
                      <div className="stock-card__top">
                        <div className="stock-card__top-left">
                          <span className="stock-card__name">{r.itemTypeName}</span>
                          {(!r.tracked || (r.reorderLevel != null && r.available <= r.reorderLevel)) && (
                            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: 2 }}>
                              {!r.tracked && (
                                <span style={styles.fbrBadge} title="FBR-reporting item — not tracked as inventory">FBR-only</span>
                              )}
                              {r.reorderLevel != null && r.available <= r.reorderLevel && (
                                <span style={styles.lowBadge} title={`At/below reorder level ${r.reorderLevel}`}>Low</span>
                              )}
                            </div>
                          )}
                        </div>
                        {r.tracked && (
                          <div className="stock-card__onhand">
                            <span className="stock-card__onhand-label">In Stock</span>
                            <span className="stock-card__onhand-value" style={{ color: r.onHand < 0 ? "#c62828" : colors.blue }}>
                              {r.onHand.toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>
                      {r.tracked ? (
                        <div className="stock-card__stats">
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Available</span>
                            <span className="stock-card__stat-value" style={{ color: r.available < 0 ? "#c62828" : colors.teal }}>{r.available.toLocaleString()}</span>
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
                    </div>
                  ))}
                </div>
                </>
              )}
            </>
          )}

          {tab === "opening" && canManageOpening && (
            <>
              {openings.length === 0 ? (
                <div style={{ ...styles.empty, padding: "2rem 1rem" }}>
                  <p style={{ color: colors.textSecondary }}>No opening balances set yet. Click "Opening Balance" above to add one.</p>
                </div>
              ) : (
                <>
                  {/* Desktop — table */}
                  <div className="stock-table" style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Item</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Quantity</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Excluding</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>S.Tax %</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Sales Tax</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Including</th>
                          <th style={styles.th}>As Of</th>
                          <th style={styles.th}>Notes</th>
                          <th style={{ ...styles.th, width: 60 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {openings.map((o, idx) => (
                          <tr key={o.id} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : colors.rowAlt }}>
                            <td style={styles.td}><strong>{o.itemTypeName}</strong></td>
                            <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>{o.quantity.toLocaleString()}</td>
                            <td style={styles.tdMoney}>{money(o.valueExcludingTax)}</td>
                            <td style={{ ...styles.tdMoney, color: colors.textSecondary }}>{o.salesTaxRate ? `${num(o.salesTaxRate)}%` : "—"}</td>
                            <td style={styles.tdMoney}>{money(o.salesTax)}</td>
                            <td style={{ ...styles.tdMoney, fontWeight: 600 }}>{money(o.valueIncludingTax)}</td>
                            <td style={styles.td}>{new Date(o.asOfDate).toLocaleDateString()}</td>
                            <td style={{ ...styles.td, fontSize: "0.78rem", color: colors.textSecondary }}>{o.notes || "—"}</td>
                            <td style={styles.td}>
                              <button style={btnTiny} onClick={() => handleDeleteOpening(o)}><MdClose size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile — opening balance cards */}
                  <div className="stock-cards">
                    {openings.map((o) => (
                      <div key={o.id} className="stock-card">
                        <div className="stock-card__top">
                          <div className="stock-card__top-left">
                            <span className="stock-card__name">{o.itemTypeName}</span>
                            <span className="stock-card__hs">As of {new Date(o.asOfDate).toLocaleDateString()}</span>
                          </div>
                          <div className="stock-card__onhand">
                            <span className="stock-card__onhand-label">Quantity</span>
                            <span className="stock-card__onhand-value" style={{ color: colors.blue }}>
                              {o.quantity.toLocaleString()}
                            </span>
                          </div>
                        </div>
                        {o.notes && (
                          <div className="stock-card__notes">{o.notes}</div>
                        )}
                        <button
                          className="stock-card__delete"
                          onClick={() => handleDeleteOpening(o)}
                        >
                          <MdClose size={14} /> Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {tab === "movements" && canViewMovements && (
            <>
              {movements.length === 0 ? (
                <div style={styles.empty}>
                  <MdHistory size={40} color={colors.cardBorder} />
                  <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>No movements recorded yet.</p>
                </div>
              ) : (
                <>
                  {/* Desktop — table */}
                  <div className="stock-table" style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Date</th>
                          <th style={styles.th}>Item</th>
                          <th style={styles.th}>Direction</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Qty</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Unit Cost</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Value</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Balance</th>
                          <th style={styles.th}>Source</th>
                          <th style={styles.th}>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((m, idx) => (
                          <tr key={m.id} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : colors.rowAlt }}>
                            <td style={styles.td}>{new Date(m.movementDate).toLocaleDateString()}</td>
                            <td style={styles.td}>{m.itemTypeName}</td>
                            <td style={{ ...styles.td, color: m.direction === "In" ? "#2e7d32" : "#c62828", fontWeight: 600 }}>{m.direction}</td>
                            <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>
                              {m.sourceType === "Revaluation" ? "—" : m.quantity.toLocaleString()}
                            </td>
                            <td style={{ ...styles.tdMoney, color: colors.textSecondary }}>
                              {m.sourceType === "Revaluation" ? "—" : num(m.unitCost)}
                            </td>
                            <td style={{ ...styles.tdMoney, color: m.direction === "In" ? "#2e7d32" : "#c62828" }}>
                              {m.direction === "In" ? "+" : "−"}{money(m.value)}
                            </td>
                            <td style={styles.tdMoney}>{num(m.runningQuantity)} · {money(m.runningValue)}</td>
                            <td style={{ ...styles.td, fontSize: "0.78rem" }}>{m.sourceType}{m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}</td>
                            <td style={{ ...styles.td, fontSize: "0.78rem", color: colors.textSecondary }}>{m.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile — movement cards */}
                  <div className="stock-cards">
                    {movements.map((m) => (
                      <div key={m.id} className="stock-card">
                        <div className="stock-card__top">
                          <div className="stock-card__top-left">
                            <span className="stock-card__name">{m.itemTypeName}</span>
                            <span className="stock-card__hs">{new Date(m.movementDate).toLocaleDateString()}</span>
                          </div>
                          <div className="stock-card__onhand">
                            <span
                              className="stock-card__direction"
                              style={{ color: m.direction === "In" ? "#2e7d32" : "#c62828" }}
                            >
                              {m.direction === "In" ? "+" : "−"}{m.quantity.toLocaleString()}
                            </span>
                            <span className="stock-card__direction-label">{m.direction}</span>
                          </div>
                        </div>
                        <div className="stock-card__source">
                          <span className="stock-card__stat-label">Value</span>
                          <span className="stock-card__stat-value" style={{ color: m.direction === "In" ? "#2e7d32" : "#c62828" }}>
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

                  <Pagination
                    page={movPage}
                    totalPages={movPageSize > 0 ? Math.ceil(movTotal / movPageSize) : 0}
                    total={movTotal}
                    onPage={setMovPage}
                    pageSize={movSize}
                    onPageSize={(n) => { setMovSize(n); setMovPage(1); }}
                    unit="rows"
                  />
                </>
              )}
            </>
          )}
        </>
      )}

      {showOpening && (
        <SmallModal title="Set Opening Balance" onClose={() => setShowOpening(false)} onSubmit={submitOpening}>
          <Field label="Item">
            <SearchableItemTypeSelect
              items={openingPickerItems}
              value={openingDraft.itemTypeId}
              onChange={(newId) => setOpeningDraft({ ...openingDraft, itemTypeId: newId ? String(newId) : "" })}
              placeholder="Search & pick an item…"
              style={mInput}
            />
            <div style={qtyHint}>
              Items without an HS Code, or already on the stock grid, are hidden —
              use the grid's Adjust action for tracked items.
            </div>
          </Field>
          <Field label="Quantity">
            <input type="number" min={0} step={openingAllowsDecimal ? "0.0001" : "1"} required style={mInput} value={openingDraft.quantity} onChange={e => setOpeningDraft({ ...openingDraft, quantity: e.target.value })} />
            {openingItem && (
              <div style={qtyHint}>UOM: <strong>{openingUom || "—"}</strong> · {openingAllowsDecimal ? "decimals allowed" : "whole numbers only"}</div>
            )}
          </Field>
          <Field label="Value excluding sales tax">
            <input type="number" min={0} step="0.01" style={mInput} value={openingDraft.valueExcludingTax} onChange={e => setOpeningDraft({ ...openingDraft, valueExcludingTax: e.target.value })} placeholder="0.00" />
            <div style={qtyHint}>What the opening quantity is worth in total, not per unit.</div>
          </Field>
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

      {showAdjust && (
        <SmallModal title="Stock Adjustment" onClose={closeAdjust} onSubmit={submitAdjust}>
          <Field label="Item">
            {adjustLockedItem ? (
              <input
                type="text"
                readOnly
                value={`${adjustLockedItem.name}${adjustLockedItem.hsCode ? ` (${adjustLockedItem.hsCode})` : ""}`}
                style={{ ...mInput, backgroundColor: "#eef5ff", cursor: "not-allowed" }}
                title="Opened from the stock grid — item is fixed. Use the header Adjustment button to pick a different item."
              />
            ) : (
              <>
                <SearchableItemTypeSelect
                  items={itemTypes}
                  value={adjustDraft.itemTypeId}
                  onChange={(newId) => setAdjustDraft({ ...adjustDraft, itemTypeId: newId ? String(newId) : "" })}
                  placeholder="Search & pick an item…"
                  style={mInput}
                />
                <div style={qtyHint}>Items without an HS Code are hidden.</div>
              </>
            )}
          </Field>
          {adjustCurrent && (
            <div style={adjustNow}>
              <span style={adjustNowLabel}>On record now</span>
              <span>
                <strong>{num(adjustCurrent.onHand)}</strong>{adjustUom ? ` ${adjustUom}` : ""}
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
                  backgroundColor: adjustDraft.mode === m ? colors.blue : "#fff",
                  color: adjustDraft.mode === m ? "#fff" : colors.textPrimary,
                  borderColor: adjustDraft.mode === m ? colors.blue : colors.inputBorder,
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
                <input type="number" min={0} step={adjustAllowsDecimal ? "0.0001" : "1"} style={mInput}
                       value={adjustDraft.targetQuantity}
                       onChange={e => setAdjustDraft({ ...adjustDraft, targetQuantity: e.target.value })} />
                <div style={qtyHint}>
                  {adjustItem && <>UOM: <strong>{adjustUom || "—"}</strong> · {adjustAllowsDecimal ? "decimals allowed" : "whole numbers only"}. </>}
                  {adjustPlan?.qtyText}
                </div>
              </Field>
              <Field label="Value excluding sales tax it should be">
                <input type="number" min={0} step="0.01" style={mInput}
                       value={adjustDraft.targetValue}
                       onChange={e => setAdjustDraft({ ...adjustDraft, targetValue: e.target.value })} />
                <div style={qtyHint}>
                  Total worth of that quantity, not per unit. {adjustPlan?.valueText}
                </div>
              </Field>
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
                <input type="number" step={adjustAllowsDecimal ? "0.0001" : "1"} style={mInput}
                       value={adjustDraft.delta}
                       onChange={e => setAdjustDraft({ ...adjustDraft, delta: e.target.value })} />
                {adjustItem && (
                  <div style={qtyHint}>UOM: <strong>{adjustUom || "—"}</strong> · {adjustAllowsDecimal ? "decimals allowed" : "whole numbers only"}</div>
                )}
              </Field>
              <Field label="Value change excluding tax (optional)">
                <input type="number" step="0.01" style={mInput}
                       value={adjustDraft.valueDelta}
                       onChange={e => setAdjustDraft({ ...adjustDraft, valueDelta: e.target.value })}
                       placeholder="e.g. -5000 to write stock down" />
                <div style={qtyHint}>
                  Changes what the stock is worth without moving any of it. Leave blank when only the quantity changed.
                </div>
              </Field>
              {parseFloat(adjustDraft.delta) > 0 && (
                <Field label="Unit cost excluding tax">
                  <input type="number" min={0} step="0.0001" style={mInput}
                         value={adjustDraft.unitCost}
                         onChange={e => setAdjustDraft({ ...adjustDraft, unitCost: e.target.value })}
                         placeholder="leave blank to use the current average" />
                  <div style={qtyHint}>
                    Blank values the stock coming in at the average already on hand — right for a count correction.
                  </div>
                </Field>
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
function DrillPanel({ rows, loading, uom }) {
  if (loading) {
    return <div style={drillStyles.state}><div style={styles.spinner} /></div>;
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
      last.lineCount += 1;
      last.id = m.id;                     // newest id keeps the React key stable
      last.movementDate = m.movementDate; // same document date; keep newest
    } else {
      grouped.push({
        ...m, groupKey: key,
        quantity: Number(m.quantity),
        value: Number(m.value || 0),
        balance: runQty,
        runningValue: Number(m.runningValue || 0),
        lineCount: 1,
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
                <span style={{ ...drillStyles.qty, color: isIn ? "#2e7d32" : "#c62828" }}>
                  {isIn ? "+" : "−"}{fmtQty(m.quantity)}{uom ? ` ${uom}` : ""}
                </span>
                <span style={{ ...drillStyles.srcChip, ...(isAdjust ? drillStyles.srcAdjust : null) }}>
                  {m.sourceType}{m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}
                </span>
                <span style={{ ...drillStyles.qty, color: isIn ? "#2e7d32" : "#c62828" }}>
                  {isIn ? "+" : "−"}{money(m.value)}
                </span>
                <span style={drillStyles.date}>{new Date(m.movementDate).toLocaleDateString()}</span>
                <span style={drillStyles.bal}>bal {fmtQty(m.balance)} · {money(m.runningValue)}</span>
              </div>
              {noteText && <div style={drillStyles.notes}>{noteText}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ValueTile({ label, value, strong }) {
  return (
    <div style={styles.valueTile}>
      <span style={styles.valueTileLabel}>{label}</span>
      <span style={{
        display: "block",
        marginTop: "0.15rem",
        fontSize: strong ? "1.05rem" : "0.98rem",
        fontWeight: strong ? 800 : 700,
        color: strong ? colors.blue : colors.textPrimary,
        fontVariantNumeric: "tabular-nums",
      }}>{value}</span>
    </div>
  );
}

function TabBtn({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      borderRadius: 8, border: "1px solid #d0d7e2", cursor: "pointer",
      backgroundColor: active ? "#0d47a1" : "#fff", color: active ? "#fff" : "#1a2332",
      fontSize: "0.85rem", fontWeight: 600, boxShadow: "none", padding: "0.45rem 0.95rem"
    }}>{children}</button>
  );
}

function SmallModal({ title, children, onClose, onSubmit }) {
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(15,20,30,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: "2vh 1rem" }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 480, padding: "1.25rem", boxShadow: "0 20px 60px rgba(13,71,161,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#1a2332" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#5f6d7e", cursor: "pointer", padding: 0, fontSize: "1.5rem", lineHeight: 1 }}>×</button>
        </div>
        <form onSubmit={onSubmit}>
          {children}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="button" onClick={onClose} style={{ padding: "0.45rem 1rem", borderRadius: 8, border: "1px solid #d0d7e2", background: "#fff", color: "#1a2332", cursor: "pointer", boxShadow: "none" }}>Cancel</button>
            <button type="submit" style={{ padding: "0.45rem 1rem", borderRadius: 8, border: "none", background: "#0d47a1", color: "#fff", cursor: "pointer", fontWeight: 600, boxShadow: "none" }}>Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ display: "block", fontSize: "0.82rem", color: "#5f6d7e", marginBottom: "0.25rem", fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

const mInput = { width: "100%", padding: "0.45rem 0.65rem", border: "1px solid #d0d7e2", borderRadius: 8, fontSize: "0.85rem", backgroundColor: "#f8f9fb", color: "#1a2332", outline: "none" };
const qtyHint = { fontSize: "0.72rem", color: "#5f6d7e", marginTop: "0.35rem" };
// "On record now" strip + the mode switch at the top of the Adjustment dialog.
const adjustNow = {
  display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "baseline",
  padding: "0.5rem 0.7rem", marginBottom: "0.7rem",
  border: "1px solid #e8edf3", borderRadius: 8,
  backgroundColor: "#f0f7ff", fontSize: "0.85rem", color: "#1a2332",
};
const adjustNowLabel = {
  fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em",
  textTransform: "uppercase", color: "#5f6d7e", marginRight: "0.3rem",
};
const modeRow = { display: "flex", gap: "0.4rem", marginBottom: "0.35rem" };
// 40px tall so the pair stays a comfortable tap target on a phone.
const modeBtn = {
  flex: 1, minHeight: 40, padding: "0.45rem 0.6rem", borderRadius: 8,
  border: "1px solid", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600,
};
const rowAdjustBtn = { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "1px solid #90caf9", backgroundColor: "#e3f2fd", color: "#0d47a1", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer", boxShadow: "none", whiteSpace: "nowrap" };
const cardAdjustBtn = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.35rem", width: "100%", minHeight: 44, marginTop: "0.6rem", padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid #90caf9", backgroundColor: "#e3f2fd", color: "#0d47a1", fontSize: "0.84rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" };
const cardDrillBtn = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.3rem", width: "100%", minHeight: 40, marginTop: "0.6rem", padding: "0.45rem 0.75rem", borderRadius: 8, border: "1px solid #d0d7e2", backgroundColor: "#fff", color: "#5f6d7e", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" };

const drillStyles = {
  wrap: { padding: "0.6rem 0.85rem 0.85rem" },
  heading: { display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.74rem", fontWeight: 700, color: "#5f6d7e", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" },
  state: { padding: "1rem 0.85rem", textAlign: "center", color: "#5f6d7e", fontSize: "0.82rem", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48 },
  list: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  row: { padding: "0.5rem 0.65rem", borderRadius: 8, border: "1px solid #e8edf3", backgroundColor: "#fff" },
  rowMain: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" },
  dirBadge: { fontSize: "0.66rem", fontWeight: 800, padding: "0.1rem 0.4rem", borderRadius: 5, letterSpacing: "0.03em" },
  dirIn: { backgroundColor: "#e8f5e9", color: "#2e7d32" },
  dirOut: { backgroundColor: "#fdecea", color: "#c62828" },
  qty: { fontSize: "0.9rem", fontWeight: 700, minWidth: 70 },
  srcChip: { fontSize: "0.74rem", fontWeight: 600, color: "#37474f", backgroundColor: "#eef2f7", padding: "0.12rem 0.45rem", borderRadius: 5 },
  srcAdjust: { backgroundColor: "#fff3e0", color: "#e65100" },
  date: { fontSize: "0.76rem", color: "#5f6d7e", marginLeft: "auto" },
  bal: { fontSize: "0.74rem", fontWeight: 700, color: "#0d47a1", backgroundColor: "#f0f7ff", padding: "0.12rem 0.45rem", borderRadius: 5 },
  notes: { fontSize: "0.74rem", color: "#5f6d7e", marginTop: "0.35rem", lineHeight: 1.35 },
};

const styles = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" },
  headerIcon: { width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, display: "flex", alignItems: "center", justifyContent: "center" },
  title: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  subtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  altBtn: { display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.45rem 0.85rem", borderRadius: 8, border: "1px solid #d0d7e2", backgroundColor: "#fff", color: "#0d47a1", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", textAlign: "center", color: colors.textSecondary },
  warnBanner: { padding: "0.65rem 0.95rem", marginBottom: "1rem", backgroundColor: "#fff8e1", border: "1px solid #ffcc80", borderRadius: 8, color: "#bf360c", fontSize: "0.85rem" },
  tabs: { display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" },
  verPillV2: { fontSize: "0.74rem", fontWeight: 700, color: "#00695c", backgroundColor: "#e0f2f1", border: "1px solid #b2dfdb", padding: "0.3rem 0.6rem", borderRadius: 999 },
  verPillV1: { fontSize: "0.74rem", fontWeight: 700, color: "#5f6d7e", backgroundColor: "#eef2f7", border: "1px solid #d0d7e2", padding: "0.3rem 0.6rem", borderRadius: 999 },
  fbrBadge: { fontSize: "0.68rem", fontWeight: 700, color: "#6a1b9a", backgroundColor: "#f3e5f5", padding: "0.1rem 0.4rem", borderRadius: 5 },
  lowBadge: { fontSize: "0.68rem", fontWeight: 700, color: "#c62828", backgroundColor: "#ffebee", padding: "0.1rem 0.4rem", borderRadius: 5 },
  searchWrap: { position: "relative", marginBottom: "1rem", maxWidth: 360 },
  searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" },
  searchInput: { width: "100%", padding: "0.55rem 2.4rem 0.55rem 2.3rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 10, fontSize: "0.88rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none" },
  searchClear: { position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", color: "#94a3b8", cursor: "pointer", padding: 0, boxShadow: "none" },
  clearSearchBtn: { marginTop: "0.75rem", padding: "0.45rem 1rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.84rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" },
  tableWrap: { overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, backgroundColor: "#fff" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" },
  itemName: {
    fontWeight: 700, color: colors.textPrimary, lineHeight: 1.3, overflowWrap: "anywhere",
    minWidth: 0,
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  itemMeta: {
    display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.2rem",
    fontSize: "0.72rem", color: colors.textSecondary,
  },
  hsChip: { fontFamily: "monospace", color: colors.blue },
  // The flow behind the on-hand figure: opening, everything in, everything out.
  flowMeta: {
    display: "flex", justifyContent: "flex-end", gap: "0.35rem",
    marginTop: "0.15rem", fontSize: "0.72rem", color: colors.textSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  rateChip: { marginTop: "0.15rem", fontSize: "0.72rem", color: colors.textSecondary },
  valueStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))",
    gap: "0.6rem",
    margin: "0 0 0.9rem",
  },
  valueTile: {
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 10,
    padding: "0.6rem 0.8rem",
    backgroundColor: colors.inputBg,
  },
  valueTileLabel: {
    display: "block",
    fontSize: "0.7rem",
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: colors.textSecondary,
  },
  tdMoney: {
    padding: "0.55rem 0.85rem",
    borderBottom: `1px solid ${colors.cardBorder}`,
    color: colors.textPrimary,
    verticalAlign: "top",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  th: { textAlign: "left", padding: "0.6rem 0.85rem", backgroundColor: "#f5f8fc", borderBottom: `1px solid ${colors.cardBorder}`, fontSize: "0.76rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em" },
  td: { padding: "0.55rem 0.85rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textPrimary, verticalAlign: "top" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "0.75rem 0" },
  pageBtn: { padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
};
const btnTiny = { padding: 0, width: 28, height: 28, borderRadius: 6, border: "1px solid #d0d7e2", backgroundColor: "#fff", color: "#c62828", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "none" };
