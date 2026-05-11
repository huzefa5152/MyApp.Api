import { useState, useEffect, useMemo, useRef } from "react";
import { MdInfo, MdAdd, MdCheckCircle, MdWarning, MdInventory2, MdLightbulb, MdRefresh, MdError, MdExpandMore, MdExpandLess, MdAutoAwesome } from "react-icons/md";
import { getInvoiceById, updateInvoice, updateInvoiceItemTypes, updateInvoiceItemTypesAndQty } from "../api/invoiceApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getClientsByCompany } from "../api/clientApi";
import { getAllUnits } from "../api/unitsApi";
import { getClaimSummary } from "../api/taxClaimApi";
import QuantityInput from "./QuantityInput";
import { getFbrApplicableScenarios } from "../api/fbrApi";
import { formStyles, modalSizes } from "../theme";
import { usePermissions } from "../contexts/PermissionsContext";
import { useAuth } from "../contexts/AuthContext";
import LookupAutocomplete from "./LookupAutocomplete";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import QuickItemTypeForm from "./QuickItemTypeForm";

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
export default function EditBillForm({ invoiceId, onClose, onSaved, readOnly = false, billsMode = false, forceItemTypeAndQty = false }) {
  // billsMode: true when this form is mounted from the Bills tab. Hides
  // the Item Type column + picker and the bulk-apply toolbar (item-type
  // classification is the Invoices tab's responsibility). Existing item-
  // type bindings on the bill are preserved on save — Bills mode just
  // doesn't expose editing them. HS Code, Sale Type, scenario stay visible.
  //
  // forceItemTypeAndQty: true when this form is mounted from the Invoices
  // tab. Forces the existing itemTypeAndQtyMode flow regardless of the
  // user's permission tier — only Item Type and Qty are editable, every
  // other field locks read-only. Use case: FBR officer classifies items
  // and corrects qty without touching prices/dates that the bookkeeper
  // set on Bills.
  const { has } = usePermissions();
  // 2026-05-09: pull the live narrow-edit tolerance from the user object
  // (populated by /api/auth/me from the server's appsettings). Falls back
  // to 2 if the field hasn't loaded yet (e.g. during the first render
  // before AuthContext finishes refreshUser). Pre-fix this was hardcoded
  // to 2 even when production had it set to 10 — the running diff showed
  // "exceeds Rs. 2 tolerance" while the server happily saved.
  const { user } = useAuth();
  // Three permission tiers for editing a bill, ordered narrowest → broadest:
  //   • invoices.manage.update.itemtype       → ONLY Item Type column
  //   • invoices.manage.update.itemtype.qty   → Item Type + Quantity columns
  //   • invoices.manage.update                → full edit (price, all fields)
  //
  // The narrow paths are for operators who classify or correct quantities
  // but shouldn't touch commercial values. When the user has only a narrow
  // permission, every input on this form outside its scope becomes
  // read-only and Save POSTs to the matching narrow PATCH endpoint.
  const canFullEdit          = has("bills.manage.update");
  const canEditItemTypeAndQty = has("invoices.manage.update.itemtype.qty");
  const canEditItemType       = has("invoices.manage.update.itemtype");
  // Inline "+ New Item Type" availability — same gate the create-bill
  // forms use. Hidden in Bills mode (item-type management is the
  // Invoices tab's responsibility).
  const canCreateItemType    = has("itemtypes.manage.create");
  // Mode flags — exactly one of these is true at a time (in priority order).
  // canFullEdit takes precedence: a full-editor doesn't need the narrow modes.
  // forceItemTypeAndQty (caller override, set when launched from Invoices tab)
  // wins over the permission-derived flags so the form locks down to
  // ItemType + Qty editing regardless of how broad the user's perms are.
  const itemTypeOnlyMode     = !forceItemTypeAndQty && (!canFullEdit && !canEditItemTypeAndQty && canEditItemType);
  const itemTypeAndQtyMode   = forceItemTypeAndQty || (!canFullEdit && canEditItemTypeAndQty);

  // Effective read-only: caller-forced OR no edit permission at all.
  const effectiveReadOnly = readOnly || (!canFullEdit && !canEditItemTypeAndQty && !canEditItemType);

  const [invoice, setInvoice] = useState(null);
  const [items, setItems] = useState([]);

  // Bill-mode source-of-truth snapshot (2026-05-11).
  //
  // Captured ONCE when the bill loads. Represents whatever qty +
  // unit_price the operator saved in Bill mode — those are legitimate
  // bill values and act as the floor we return to whenever an
  // Invoice-mode tweak needs to be undone.
  //
  // Two places consume this:
  //   1. updateItemType / applyItemTypeToAll: in invoice mode
  //      (!billsMode), switching a row's HS code resets that row's
  //      qty + unit_price + lineTotal back to its original index entry.
  //      The optimization suggestion is HS-code-specific, so the
  //      qty/price applied for the OLD HS no longer make sense once
  //      the operator picks a different HS.
  //   2. resetItemsToOriginal: the panel's "Reset to original bill
  //      values" button restores the entire items[] array.
  //
  // Stored as a ref (not state) so mutations to items[] don't trigger
  // re-renders that would also bump this. Set exactly once in the
  // load useEffect.
  const originalItemsRef = useRef([]);
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
  // ── Inline "+ New Item Type" + HS Stock panel state ────────────────
  // showAddItemType: drives the QuickItemTypeForm modal.
  // hsStockSummary:  cache of the latest /tax-claim/hs-stock-summary
  //                  payload, indexed by HS code for O(1) lookup.
  // hsStockLoading:  spinner flag while the panel re-fetches after
  //                  the operator picks a new ItemType.
  const [showAddItemType, setShowAddItemType] = useState(false);
  // claimSummary holds the full Phase-B response: rows[], totals,
  // warnings, period, config. Frontend renders it directly.
  const [claimSummary, setClaimSummary] = useState(null);
  const [claimLoading, setClaimLoading] = useState(false);
  // Period override — null = service default ("this-month" derived
  // from bill date). Operator can pick last-month / this-quarter /
  // year-to-date / all-time for analysis.
  const [claimPeriod, setClaimPeriod] = useState("this-month");

  useEffect(() => {
    const load = async () => {
      try {
        // Invoice fetch is sequential because the next two calls need
        // its companyId — the item-types endpoint sorts by per-company
        // on-hand qty when companyId is passed (2026-05-12), so dropdowns
        // surface what the operator can actually sell first.
        const { data } = await getInvoiceById(invoiceId);
        const [typesRes, unitsRes] = await Promise.all([
          getItemTypes(data?.companyId).catch(() => ({ data: [] })),
          getAllUnits().catch(() => ({ data: [] })),
        ]);
        setInvoice(data);
        // Bill-mode source-of-truth: every InvoiceItem field as the
        // bill carries it. Used to seed both `items[]` (when no
        // Invoice-mode overlay applies) AND originalItemsRef (which
        // anchors the HS-change reset + the "Reset to bill values"
        // button).
        const billItems = data.items.map((it) => ({ ...it }));

        // Invoice-mode overlay (2026-05-12 — narrowed scope):
        // The InvoiceItemAdjustment overlay carries ONLY the
        // numerical decomposition the operator filed for FBR
        // tax-claim optimization (qty / unit_price / line_total).
        // Item Type / UOM / HS Code / Sale Type / Description are
        // legitimate bill data and live on InvoiceItem — those
        // always render off bi.* directly so the printed bill and
        // Tax Invoice stay accurate. Bill mode ignores the overlay
        // entirely.
        const editableItems = billItems.map((bi) => {
          if (!forceItemTypeAndQty || !bi.adjustment) return { ...bi };
          const adj = bi.adjustment;
          const next = { ...bi };
          if (adj.adjustedQuantity != null)  next.quantity  = adj.adjustedQuantity;
          if (adj.adjustedUnitPrice != null) next.unitPrice = adj.adjustedUnitPrice;
          if (adj.adjustedLineTotal != null) next.lineTotal = adj.adjustedLineTotal;
          return next;
        });
        setItems(editableItems);
        // originalItemsRef ALWAYS holds the raw bill values — the
        // overlay is never the source of truth.
        originalItemsRef.current = billItems.map((it) => ({ ...it }));
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

  // ── HS Stock panel — derive unique HS codes + per-HS bill totals ────
  //
  // We aggregate the bill's items by their HS Code (taken from the
  // picked Item Type, since the row's HSCode field comes from the
  // catalog). This drives:
  //   • the request to /tax-claim/hs-stock-summary (which HS codes
  //     does this bill touch?)
  //   • the per-HS rows in the panel (current bill's qty + value
  //     contribution to each HS)
  //
  // Items without an HS code (rows that haven't picked an Item Type
  // yet) are silently dropped — they show up as "—" in the row and
  // contribute nothing to any HS bucket.
  const billHsAggregate = useMemo(() => {
    const map = new Map(); // hsCode → { hsCode, name, qty, value }
    for (const it of items) {
      const hs = (it.hsCode || "").trim();
      if (!hs) continue;
      const qty = parseFloat(it.quantity) || 0;
      const lineTotal = parseFloat(it.lineTotal)
        || (qty * (parseFloat(it.unitPrice) || 0));
      const existing = map.get(hs) || {
        hsCode: hs,
        name: it.itemTypeName || "",
        qty: 0,
        value: 0,
      };
      existing.qty += qty;
      existing.value += lineTotal;
      // Keep the most-recently-seen item-type name as the display
      // label. If two item types share an HS code (rare but legal),
      // last-write-wins is fine for the panel header.
      if (it.itemTypeName) existing.name = it.itemTypeName;
      map.set(hs, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [items]);

  // Stable key over all the inputs that affect the claim summary —
  // HS codes, qty/value per HS, bill date, GST rate, period. Changing
  // any one re-fetches; identical state means the same payload to the
  // server so we don't refetch on unrelated re-renders.
  const claimRequestKey = useMemo(() => {
    const rows = billHsAggregate.map((r) => `${r.hsCode}:${r.qty}:${r.value}`).join("|");
    return `${rows}|${billDate}|${gstRate}|${claimPeriod}`;
  }, [billHsAggregate, billDate, gstRate, claimPeriod]);

  // Manual refresh trigger — bumped by the panel's "↻ Refresh" button.
  // Lets the operator pull fresh numbers if a colleague imported FBR
  // Annexure-A or recorded purchases in another tab while this bill is
  // open. Without it the panel only refetches when bill state changes.
  const [claimRefreshTick, setClaimRefreshTick] = useState(0);

  // Tax Claim Panel collapse state.
  // Default closed — keeps the form quiet on first open.
  // Auto-opens ONCE the first time the bill has any HS-mapped row
  // (i.e. the operator picks an item type), so the warnings are
  // immediately visible. After that initial auto-open, the user
  // controls the toggle and we never auto-reopen even when content
  // changes — they've already read the warnings, no need to nag.
  const [claimPanelOpen, setClaimPanelOpen] = useState(false);
  const [claimAutoOpened, setClaimAutoOpened] = useState(false);
  useEffect(() => {
    if (!claimAutoOpened && billHsAggregate.length > 0) {
      setClaimPanelOpen(true);
      setClaimAutoOpened(true);
    }
  }, [billHsAggregate.length, claimAutoOpened]);

  useEffect(() => {
    if (!forceItemTypeAndQty) return;
    if (!invoice?.companyId) return;
    if (billHsAggregate.length === 0) { setClaimSummary(null); return; }
    let cancelled = false;
    // 250ms debounce — typing "100" in qty fires 3 state updates
    // back-to-back; without this the server sees 3 requests and the
    // panel flickers. Cancelled-flag still guards against late
    // resolves from now-stale fetches.
    const timer = setTimeout(async () => {
      setClaimLoading(true);
      try {
        const res = await getClaimSummary({
          companyId: invoice.companyId,
          billDate: billDate || new Date().toISOString(),
          billGstRate: parseFloat(gstRate) || 0,
          billRows: billHsAggregate.map((r) => ({
            hsCode: r.hsCode,
            itemTypeName: r.name,
            qty: r.qty,
            value: r.value,
          })),
          periodCode: claimPeriod,
        });
        if (cancelled) return;
        setClaimSummary(res);
      } catch {
        if (!cancelled) setClaimSummary(null);
      } finally {
        if (!cancelled) setClaimLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceItemTypeAndQty, invoice?.companyId, claimRequestKey, claimRefreshTick]);

  // Inline "+ New Item Type" handler — when the operator saves a new
  // catalog row, append it to the in-memory itemTypes list AND
  // refetch the canonical list so usage counters / FBR-derived fields
  // stay current. The QuickItemTypeForm's onSaved hands back the
  // newly-created row.
  const onItemTypeCreated = (created) => {
    if (created) {
      setItemTypes((prev) => {
        const exists = prev.some((it) => it.id === created.id);
        return exists ? prev : [...prev, created];
      });
    }
    // Best-effort refresh; if it fails the inline append above keeps
    // the dropdown usable. Pass companyId so the refreshed list keeps
    // the per-company on-hand sort applied on initial load.
    getItemTypes(invoice?.companyId)
      .then((r) => setItemTypes(r.data || []))
      .catch(() => { /* silent */ });
    setShowAddItemType(false);
  };

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

  // Reset all bill rows back to their bill-mode source-of-truth values.
  // Restores qty + unit_price + lineTotal + item type + HS code +
  // description + everything else exactly as it was loaded — undoes
  // every invoice-mode tweak in one shot. Lets the operator "start
  // over" with the tax-claim optimization without manually unwinding
  // each row.
  //
  // 2026-05-11: added. Triggered by the Tax Claim panel's "Reset to
  // original bill values" button (panel header).
  const resetItemsToOriginal = () => {
    setItems(originalItemsRef.current.map((it) => ({ ...it })));
  };

  // Apply a tax-claim optimization suggestion to the bill row(s) for a
  // given HS code. Three outcomes:
  //   • "applied"     — exactly one row carries this HS; we set its qty
  //                     + unitPrice and recompute lineTotal. Subtotal
  //                     is preserved (the backend's clean-factorization
  //                     guarantees qty × unitPrice === original lineTotal).
  //   • "distributed" — multiple rows share this HS (2026-05-11). We
  //                     distribute the suggested aggregate qty across
  //                     the contributing rows proportionally to each
  //                     row's lineTotal share, snapping each row to a
  //                     clean integer divisor of its lineTotal cents so
  //                     qty_i × unit_price_i = the row's original
  //                     subtotal EXACTLY. The aggregate qty sums to
  //                     (≈) the HS-level suggested qty — the §8B claim
  //                     math runs on the HS total so small deltas are
  //                     fine. Per-row unit prices differ when the row
  //                     lineTotals differ.
  //   • "missing"     — no row found (shouldn't happen if panel is
  //                     showing this HS, but guard anyway).
  // Returns the outcome so the panel can render an inline notice with
  // the actual per-row breakdown.
  const applyOptimizationToHs = (hsCode, opt) => {
    // Back-compat: callers that still pass (hsCode, qty, unitPrice) get
    // a synthetic opt object. New callers pass the full optimization
    // snapshot which carries the realistic band needed for per-row
    // band-aware divisor selection.
    if (typeof opt === "number") {
      opt = {
        suggestedQty: arguments[1],
        suggestedUnitPrice: arguments[2],
        realisticBandLow: 0,
        realisticBandHigh: Number.POSITIVE_INFINITY,
      };
    }
    const totalQty = Number(opt.suggestedQty) || 0;
    const suggestedUnitPrice = Number(opt.suggestedUnitPrice) || 0;
    const bandLow = Number(opt.realisticBandLow) || 0;
    const bandHigh = Number(opt.realisticBandHigh) || Number.POSITIVE_INFINITY;
    const bandLowCents = Math.round(bandLow * 100);
    const bandHighCents = Number.isFinite(bandHigh)
      ? Math.round(bandHigh * 100)
      : Number.MAX_SAFE_INTEGER;

    const matchingIndices = items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => (it.hsCode || "").trim() === hsCode)
      .map(({ i }) => i);
    if (matchingIndices.length === 0) return { status: "missing", count: 0 };

    // ── Single-row path (fast & exact) ──
    if (matchingIndices.length === 1) {
      const idx = matchingIndices[0];
      setItems((prev) => {
        const next = [...prev];
        const qty = totalQty;
        const price = suggestedUnitPrice;
        next[idx] = {
          ...next[idx],
          quantity: qty,
          unitPrice: price,
          lineTotal: Math.round(qty * price * 100) / 100,
        };
        return next;
      });
      return { status: "applied", count: 1 };
    }

    // ── Multi-row distribution path (2026-05-11) ──
    // Each contributing row keeps its own lineTotal exactly preserved;
    // qty + unit_price are re-decomposed so the SUM of qty across rows
    // approximates the HS-level suggested total qty.
    //
    // Algorithm per row:
    //   1. Compute the "fair share" target qty
    //          = totalQty × (lineTotal_i / totalValue)
    //      (last row inherits whatever qty is left so the sum lands as
    //      close to totalQty as the clean-factorization grid allows).
    //   2. Enumerate ALL integer divisors of lineTotal_i × 100. Each
    //      divisor d gives a clean unit_price = lineTotal_i / d to two
    //      decimals — no drift on that row.
    //   3. Among divisors whose unit_price lands in [bandLow, bandHigh]
    //      pick the one closest to the target qty (audit-defensible).
    //   4. If no in-band divisor exists, fall back to the divisor
    //      closest to target regardless of band, and flag the row as
    //      out-of-band so the inline notice warns the operator.
    const contributing = matchingIndices.map((idx) => {
      const it = items[idx];
      const q = parseFloat(it.quantity) || 0;
      const p = parseFloat(it.unitPrice) || 0;
      const lt = parseFloat(it.lineTotal) || q * p;
      return { idx, lineTotal: lt };
    });
    const totalValue = contributing.reduce((s, r) => s + r.lineTotal, 0);

    let remainingQty = totalQty;
    const distributions = [];
    for (let i = 0; i < contributing.length; i++) {
      const isLast = i === contributing.length - 1;
      const row = contributing[i];
      const cents = Math.round(row.lineTotal * 100);

      // Target qty for THIS row. Last row absorbs the rounding so the
      // aggregate sum matches the suggestion as closely as possible.
      let target;
      if (isLast) {
        target = Math.max(1, remainingQty);
      } else {
        const ideal = totalValue > 0 ? totalQty * (row.lineTotal / totalValue) : totalQty / contributing.length;
        target = Math.max(1, Math.round(ideal));
        // Leave at least 1 qty available per remaining row.
        const minLeft = contributing.length - i - 1;
        target = Math.min(target, Math.max(1, remainingQty - minLeft));
      }

      // Enumerate divisors. We don't cap availableQty here — the bank
      // ceiling was already enforced when the HS-level suggestion was
      // built. Tier 1 = unit_price in band; Tier 3 = best non-in-band.
      let bestInBand = 0;
      let bestInBandDist = Number.POSITIVE_INFINITY;
      let bestAny = 0;
      let bestAnyDist = Number.POSITIVE_INFINITY;
      if (cents > 0) {
        for (let d = 1; d * d <= cents; d++) {
          if (cents % d !== 0) continue;
          const d2 = cents / d;
          for (const cand of [d, d2]) {
            if (cand < 1) continue;
            const unitCents = cents / cand;
            const dist = Math.abs(cand - target);
            const inBand = unitCents >= bandLowCents && unitCents <= bandHighCents;
            if (inBand && dist < bestInBandDist) {
              bestInBandDist = dist;
              bestInBand = cand;
            }
            if (dist < bestAnyDist) {
              bestAnyDist = dist;
              bestAny = cand;
            }
          }
        }
      }
      const chosenQty = bestInBand > 0 ? bestInBand : (bestAny > 0 ? bestAny : target);
      const chosenInBand = bestInBand > 0;
      const unitPrice = chosenQty > 0 ? Math.round(cents / chosenQty) / 100 : 0;
      const recomposed = Math.round(chosenQty * unitPrice * 100) / 100;

      distributions.push({
        idx: row.idx,
        qty: chosenQty,
        unitPrice,
        lineTotal: recomposed,
        originalLineTotal: row.lineTotal,
        inBand: chosenInBand,
      });

      remainingQty -= chosenQty;
    }

    // Commit the distribution to items[] in a single setItems pass.
    setItems((prev) => {
      const next = [...prev];
      for (const d of distributions) {
        next[d.idx] = {
          ...next[d.idx],
          quantity: d.qty,
          unitPrice: d.unitPrice,
          lineTotal: d.lineTotal,
        };
      }
      return next;
    });

    const distributedTotalQty = distributions.reduce((s, d) => s + d.qty, 0);
    const anyOutOfBand = distributions.some((d) => !d.inBand);
    return {
      status: "distributed",
      count: distributions.length,
      distributions,
      distributedTotalQty,
      suggestedTotalQty: totalQty,
      anyOutOfBand,
    };
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
      const oldHs = (next[index].hsCode || "").trim();
      const newHs = (pickedType?.hsCode || "").trim();
      const hsChanged = oldHs !== newHs;
      next[index] = _applyItemTypeToRow(next[index], newId, pickedType);

      // Invoice-mode rule (2026-05-11): when the operator switches the
      // HS code on a row, the qty + unit_price applied for the previous
      // HS's optimization suggestion no longer make sense — the new HS
      // has a different bank, a different break-even, a different
      // realistic price band. Reset that row's qty + unit_price +
      // lineTotal back to the bill-mode source-of-truth values so the
      // operator starts the new HS's optimization from a clean slate.
      //
      // We do NOT touch other fields (item type, UOM, description,
      // saleType) — _applyItemTypeToRow already set those to the new
      // catalog row's values. Only the price/qty primitives reset.
      //
      // Bill mode (`billsMode`) is the source of truth — never auto-
      // reset there. The operator's typed qty/price IS the bill.
      if (!billsMode && hsChanged) {
        const orig = originalItemsRef.current[index];
        if (orig) {
          next[index] = {
            ...next[index],
            quantity: orig.quantity,
            unitPrice: orig.unitPrice,
            lineTotal: orig.lineTotal,
          };
        }
      }
      return next;
    });
  };

  // Bulk apply — sets the same ItemType on every row in one shot.
  // Good when the operator has 20+ items that should all be classified
  // the same way (typical for single-category sale bills).
  // Passing newId=null + pickedType=null clears ItemType + UoM + HS Code
  // + Sale Type on every row (the dedicated "Clear from all" button).
  const applyItemTypeToAll = (newId, pickedType, mode = "all") => {
    setItems((prev) => prev.map((row, idx) => {
      // mode === "empty" → only fill rows that don't have an Item Type yet
      if (mode === "empty" && row.itemTypeId) return row;
      const oldHs = (row.hsCode || "").trim();
      const newHs = (pickedType?.hsCode || "").trim();
      const hsChanged = oldHs !== newHs;
      let nextRow = _applyItemTypeToRow(row, newId, pickedType);
      // Same invoice-mode reset rule as updateItemType — applied per
      // row when the bulk apply actually changed the HS code on it.
      if (!billsMode && hsChanged) {
        const orig = originalItemsRef.current[idx];
        if (orig) {
          nextRow = {
            ...nextRow,
            quantity: orig.quantity,
            unitPrice: orig.unitPrice,
            lineTotal: orig.lineTotal,
          };
        }
      }
      return nextRow;
    }));
  };

  // Derived: what's the common Item Type across rows? Used to drive
  // the bulk picker's `value` so the dropdown actually reflects what's
  // applied (pre-fix it always showed the placeholder even after apply).
  // Falls back to "" when rows diverge — operator can still re-pick or
  // clear from there.
  const commonItemTypeId = useMemo(() => {
    if (!items || items.length === 0) return "";
    const first = items[0]?.itemTypeId;
    if (!first) return "";
    return items.every((r) => r.itemTypeId === first) ? String(first) : "";
  }, [items]);

  const subtotal = items.reduce((s, i) => s + (parseFloat(i.lineTotal) || 0), 0);
  const gstAmount = Math.round(subtotal * (parseFloat(gstRate) || 0) / 100 * 100) / 100;
  const grandTotal = subtotal + gstAmount;

  // Field-level gating booleans, derived once for clarity:
  //   • lockNonItemType — locks every BILL-level field outside the
  //     Item Type picker (GST rate, dates, payment terms, etc.) AND
  //     the line-item fields that aren't qty/price (description, UOM,
  //     HS code, sale type). True in both narrow modes.
  //   • lockQty — locks the Qty cell. Unlocks in ItemType+Qty mode.
  //   • lockPrice — locks the UnitPrice cell. Unlocks in ItemType+Qty
  //     mode (the "narrow" mode now covers price too — used during
  //     FBR classification when an operator splits one line into
  //     multiple HS-coded lines and redistributes the price). Backend
  //     enforces a total-preservation guard so this can't be abused
  //     to alter the bill amount.
  //   • lockItemType — locks the Item Type picker (full read-only).
  const lockNonItemType = readOnly || itemTypeOnlyMode || itemTypeAndQtyMode;
  const lockQty         = readOnly || itemTypeOnlyMode;
  const lockPrice       = readOnly || itemTypeOnlyMode;
  const lockItemType    = readOnly;

  // ── Total preservation (narrow-edit guard) ───────────────────────
  // When the operator can edit qty/price (itemTypeAndQtyMode), the
  // server enforces "new subtotal must equal original subtotal within
  // a small tolerance" so the bill amount the buyer paid can't change.
  // Mirror the check client-side so Save is disabled with a clear
  // running diff instead of producing a 400 from the server.
  // Pulled from the server (Invoice:NarrowEditTotalTolerancePkr in appsettings)
  // via /api/auth/me → AuthContext → user.appConfig. Fallback 2 keeps the
  // form functional during the brief window before /me has resolved.
  const NARROW_EDIT_TOLERANCE_PKR = user?.appConfig?.narrowEditTolerancePkr ?? 2;
  // Original subtotal — captured ONCE when the bill loads, before any
  // edits. Lives separately from the live `items` so the diff stays
  // meaningful as the operator types.
  const originalSubtotal = useMemo(
    () => Number(invoice?.subtotal) || 0,
    [invoice?.id], // re-pin only when the bill switches
  );
  const currentSubtotal = useMemo(() => {
    return items.reduce((acc, i) => {
      const q = parseFloat(i.quantity) || 0;
      const p = parseFloat(i.unitPrice) || 0;
      return acc + q * p;
    }, 0);
  }, [items]);
  const subtotalDiff = currentSubtotal - originalSubtotal;
  const totalsMatch = Math.abs(subtotalDiff) <= NARROW_EDIT_TOLERANCE_PKR;
  // Show the indicator only when narrow edit + price/qty are unlocked,
  // i.e. itemTypeAndQtyMode. Full-edit mode lets the operator change
  // the total freely; itemTypeOnlyMode locks both qty and price so
  // there's nothing to indicate.
  const showTotalsGuard = itemTypeAndQtyMode;
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
        // Narrow path — Item Type + Qty + UnitPrice. Same back-end
        // model (UpdateInvoiceItemTypesDto), but the .qty endpoint sets
        // allowQuantityEdit=true so the service honours qty AND price.
        // Total-preservation guard: new Σ(qty × unitPrice) must equal
        // the original Subtotal within ±2 PKR (server-side enforced).
        if (items.some((i) => (parseFloat(i.quantity) || 0) <= 0)) {
          return setError("Quantity must be greater than 0.");
        }
        if (items.some((i) => (parseFloat(i.unitPrice) || 0) <= 0)) {
          return setError("Unit price must be greater than 0.");
        }
        if (!totalsMatch) {
          return setError(
            `Bill total mismatch: original Rs. ${originalSubtotal.toLocaleString("en-PK", { maximumFractionDigits: 2 })} ` +
            `vs current Rs. ${currentSubtotal.toLocaleString("en-PK", { maximumFractionDigits: 2 })} ` +
            `(diff Rs. ${subtotalDiff.toLocaleString("en-PK", { maximumFractionDigits: 2 })}). ` +
            `Adjust qty / unit price so totals match within Rs. ${NARROW_EDIT_TOLERANCE_PKR}, or use full-edit access to change the bill amount.`
          );
        }
        // writeMode (2026-05-11): Invoice-mode saves go through the
        // dual-book overlay so the printed bill keeps its real
        // qty/price. Bill-mode saves on this narrow path (rare —
        // billsMode normally takes the full-edit branch) stay on the
        // original "write straight to InvoiceItem" semantics.
        const writeMode = forceItemTypeAndQty && !billsMode ? "adjustment" : "bill";
        await updateInvoiceItemTypesAndQty(
          invoiceId,
          items.map((i) => ({
            id: i.id || 0,
            itemTypeId: i.itemTypeId || null,
            quantity: parseFloat(i.quantity) || 0,
            unitPrice: parseFloat(i.unitPrice) || 0,
          })),
          writeMode,
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
                <div style={styles.sectionHeadingRow}>
                  <h6 style={{ ...styles.sectionHeading, margin: 0 }}>Items ({items.length})</h6>
                  {/* "+ New Item Type" fallback — single-item bills don't
                      render the bulk-apply bar, so the button lives here
                      for that case. Multi-item bills get the button
                      inside the bulk-apply row below. Same permission
                      gate (itemtypes.manage.create). */}
                  {forceItemTypeAndQty && canCreateItemType && items.length <= 1 && (
                    <button
                      type="button"
                      onClick={() => setShowAddItemType(true)}
                      style={styles.inlineAddBtn}
                      title="Add a new Item Type to your catalog without leaving this form"
                    >
                      <MdAdd size={14} /> New Item Type
                    </button>
                  )}
                </div>

                {!readOnly && (
                  <p style={styles.gridHint}>
                    Pick an <b>Item Type</b> — UOM, HS Code &amp; Sale Type auto-fill from the catalog and
                    <b> cannot be edited inline</b>. To change them, pick a different Item Type or edit the Item Type row on the catalog page.
                  </p>
                )}

                {/* Tax Claim Panel — Phase B (Pakistan-compliance).
                    Shows §8A aging, §8B 90% cap, IRIS-reconciled bank
                    only, per-sale qty matching, pending-not-yet-
                    claimable totals, and a carry-forward proxy. Stays
                    informational — the operator can save the bill even
                    when a row reports "no purchase on record" and
                    record the matching purchase later. */}
                {forceItemTypeAndQty && billHsAggregate.length > 0 && (
                  <TaxClaimPanel
                    summary={claimSummary}
                    loading={claimLoading}
                    period={claimPeriod}
                    onPeriodChange={setClaimPeriod}
                    onRefresh={() => setClaimRefreshTick((t) => t + 1)}
                    open={claimPanelOpen}
                    onToggle={() => setClaimPanelOpen((v) => !v)}
                    onApplyOptimization={applyOptimizationToHs}
                    onResetToOriginal={resetItemsToOriginal}
                  />
                )}

                {/* Bulk Item Type apply — saves operator the pain of picking
                    the same catalog row 20+ times. Two modes:
                      - "All rows": overwrites Item Type on every row
                      - "Empty rows only": fills only rows that don't have one
                    Available to narrow-perm users too — it's still just an
                    Item Type pick. Hidden in Bills mode. */}
                {!billsMode && !lockItemType && items.length > 1 && (
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
                        // value derived from the rows themselves so the
                        // dropdown reflects the applied selection. When
                        // all rows share an Item Type, that one shows;
                        // when they diverge (e.g. partial apply, manual
                        // edits) the placeholder returns.
                        value={commonItemTypeId}
                        onChange={(newId, picked) => {
                          // Clearing the picker (× icon) wipes the row
                          // selection too — same behaviour as the
                          // dedicated "Clear from all" button below.
                          if (!newId) {
                            applyItemTypeToAll(null, null, bulkApplyMode);
                            return;
                          }
                          applyItemTypeToAll(parseInt(newId), picked, bulkApplyMode);
                        }}
                        placeholder={bulkApplyMode === "all"
                          ? "— pick to apply to all —"
                          : "— pick to fill empty rows —"}
                        style={styles.tableInput}
                      />
                    </div>
                    {/* Dedicated "Clear from all" — clears Item Type +
                        UoM + HS Code + Sale Type on every row in scope.
                        Disabled when there's nothing to clear so the
                        button doesn't pretend to be active. Important:
                        the row-level clear (× on each row's picker)
                        already wipes those fields per-row; this is the
                        same operation in bulk. */}
                    {(() => {
                      const hasAnyItemType = items.some((r) => r.itemTypeId);
                      return (
                        <button
                          type="button"
                          // Always passes mode="all" — clearing only "empty"
                          // rows is a no-op (they're already empty), so the
                          // button intent is unambiguous: wipe ItemType +
                          // HS Code + UoM + Sale Type from every row.
                          onClick={() => applyItemTypeToAll(null, null, "all")}
                          disabled={!hasAnyItemType}
                          style={{
                            ...styles.inlineAddBtn,
                            color: hasAnyItemType ? "#c62828" : "#98a4b3",
                            borderColor: hasAnyItemType ? "#ef9a9a" : "#dde1e6",
                            backgroundColor: hasAnyItemType ? "#fff5f5" : "#f5f7fa",
                            cursor: hasAnyItemType ? "pointer" : "not-allowed",
                          }}
                          title="Clear Item Type, HS Code, UoM, and Sale Type from every row"
                        >
                          Clear from all
                        </button>
                      );
                    })()}
                    {/* "+ New Item Type" — placed AFTER the item-type
                        picker so the operator's natural left-to-right
                        flow is "try to find it → can't → add it here". */}
                    {forceItemTypeAndQty && canCreateItemType && (
                      <button
                        type="button"
                        onClick={() => setShowAddItemType(true)}
                        style={styles.inlineAddBtn}
                        title="Add a new Item Type to your catalog without leaving this form"
                      >
                        <MdAdd size={14} /> New Item Type
                      </button>
                    )}
                  </div>
                )}

                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr style={styles.thead}>
                        {!billsMode && (
                          <th style={{ ...styles.th, width: 180, minWidth: 180 }}>Item Type (FBR)</th>
                        )}
                        <th style={{ ...styles.th, minWidth: 140 }}>Description</th>
                        <th style={{ ...styles.th, width: 120, minWidth: 120 }}>Qty</th>
                        <th style={{ ...styles.th, width: 110, minWidth: 110 }}>UOM</th>
                        <th style={{ ...styles.th, width: 100, minWidth: 100 }}>Unit Price</th>
                        <th style={{ ...styles.th, width: 100, minWidth: 100 }}>Line Total</th>
                        {/* HS Code is FBR data — only relevant on the Invoices
                            tab. Bills mode is pre-FBR data entry, so hide it. */}
                        {!billsMode && (
                          <th style={{ ...styles.th, width: 90, minWidth: 90 }}>HS Code</th>
                        )}
                        <th style={{ ...styles.th, minWidth: 140 }}>Sale Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => {
                        const hasItemType = !!item.itemTypeId;
                        return (
                          <tr key={item.id || `new-${idx}`}>
                            {!billsMode && (
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
                            )}
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
                                style={{ ...styles.tableInput, ...(lockPrice ? styles.readOnlyInput : {}), textAlign: "right" }}
                                value={item.unitPrice ?? 0}
                                onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                                min={0}
                                step={0.01}
                                readOnly={lockPrice}
                              />
                            </td>
                            <td style={{ ...styles.td, fontWeight: 600, color: colors.textPrimary, textAlign: "right" }}>
                              {(parseFloat(item.lineTotal) || 0).toLocaleString()}
                            </td>
                            {!billsMode && (
                              <td style={{ ...styles.td, ...styles.readOnlyCell, fontFamily: "monospace" }} title="Comes from Item Type">
                                {item.hsCode || <span style={styles.muted}>—</span>}
                              </td>
                            )}
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

                {/* Total-preservation guard — only shown in itemType+qty
                    (+price) mode. Lets the operator see in real time
                    whether their qty/price edits balance back to the
                    original subtotal. Save is blocked until they do. */}
                {showTotalsGuard && (
                  <div style={{
                    ...styles.totalsBox,
                    background: totalsMatch ? "#e8f5e9" : "#fff4e0",
                    borderColor: totalsMatch ? "#a5d6a7" : "#ffcc80",
                    borderLeft: `4px solid ${totalsMatch ? "#2e7d32" : "#e65100"}`,
                    marginTop: "0.6rem",
                  }}>
                    <div style={{ fontSize: "0.78rem", color: colors.textSecondary, marginBottom: "0.4rem", fontWeight: 600 }}>
                      Total-preservation guard
                      <span style={{ color: colors.textSecondary, fontWeight: 400, marginLeft: "0.4rem" }}>
                        — qty / price edits must keep the bill total within ±Rs. {NARROW_EDIT_TOLERANCE_PKR} of the original
                      </span>
                    </div>
                    <div style={styles.totalsRow}>
                      <span>Original subtotal (locked):</span>
                      <strong>Rs. {originalSubtotal.toLocaleString("en-PK", { maximumFractionDigits: 2 })}</strong>
                    </div>
                    <div style={styles.totalsRow}>
                      <span>Current subtotal:</span>
                      <strong>Rs. {currentSubtotal.toLocaleString("en-PK", { maximumFractionDigits: 2 })}</strong>
                    </div>
                    <div style={{ ...styles.totalsRow, borderTop: `1px dashed ${colors.cardBorder}`, paddingTop: "0.4rem", marginTop: "0.4rem" }}>
                      <span style={{ fontWeight: 700 }}>Difference:</span>
                      <strong style={{
                        fontSize: "1rem",
                        color: totalsMatch ? "#2e7d32" : "#c62828",
                      }}>
                        {totalsMatch ? "✓ " : "✗ "}
                        Rs. {subtotalDiff.toLocaleString("en-PK", { maximumFractionDigits: 2 })}
                        {totalsMatch
                          ? " (within tolerance — Save enabled)"
                          : ` (exceeds Rs. ${NARROW_EDIT_TOLERANCE_PKR} tolerance — Save blocked)`}
                      </strong>
                    </div>
                  </div>
                )}

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
            {!readOnly && invoice?.isEditable && (canFullEdit || canEditItemTypeAndQty || canEditItemType) && (() => {
              // In itemType+qty(+price) mode, block save when totals
              // drift past the tolerance. Tooltip explains the gap.
              const blockedByTotals = showTotalsGuard && !totalsMatch;
              const disabled = saving || blockedByTotals;
              return (
                <button
                  type="submit"
                  style={{ ...formStyles.button, ...formStyles.submit, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
                  disabled={disabled}
                  title={blockedByTotals
                    ? `Bill total mismatch: Rs. ${Math.abs(subtotalDiff).toLocaleString("en-PK", { maximumFractionDigits: 2 })} off (tolerance Rs. ${NARROW_EDIT_TOLERANCE_PKR}). Adjust qty / unit price to balance.`
                    : ""}
                >
                  {saving
                    ? "Saving..."
                    : itemTypeOnlyMode
                      ? "Save Item Types"
                      : itemTypeAndQtyMode
                        ? "Save Item Types, Qty & Price"
                        : "Save Changes"}
                </button>
              );
            })()}
          </div>
        </form>
      </div>

      {/* Inline Add Item Type modal — same QuickItemTypeForm the
          create-bill forms use. Inherits the bill's scenario so Sale
          Type is locked and the HS-code typeahead filters by it. After
          save, the new item type is appended to the dropdown so the
          operator can immediately pick it for a row. */}
      {showAddItemType && (
        <QuickItemTypeForm
          companyId={invoice?.companyId}
          scenarioCode={chosenScenario?.code}
          scenarioSaleType={chosenScenario?.saleType}
          onClose={() => setShowAddItemType(false)}
          onSaved={(created) => onItemTypeCreated(created)}
        />
      )}
    </div>
  );
}

// ── Tax Claim Panel (Phase B — Pakistan-compliance shape) ─────────────
//
// Renders the full /tax-claim/claim-summary response:
//
//   • Period selector (this/last month, this quarter, YTD, all-time)
//   • Headline: output tax · matched input · §8B cap · claimable ·
//     §8B carry-forward · prior carry-forward · net new tax
//   • Per HS-code card: bill qty/value, MATCHED qty/value (per-sale
//     match at weighted-avg unit cost) vs available bank, pending-
//     not-yet-claimable totals, aging warnings
//   • Warnings list at bottom for §8B engaged / IRIS-pending /
//     no-purchase situations
//
// Compliance footnote shown at bottom: "Computed under §8A {N}mo / §8B
// {P}% / IRIS ({statuses})" — operators can audit which rules ran.
//
// Strictly informational. The form's Save buttons don't depend on
// this state — operators can save with shortfalls / no purchases and
// reconcile later.
function TaxClaimPanel({ summary, loading, period, onPeriodChange, onRefresh, open, onToggle, onApplyOptimization, onResetToOriginal }) {
  const fmtMoney = (v) =>
    v == null || isNaN(v) ? "—" :
    `Rs. ${Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
  const fmtQty = (v) =>
    v == null || isNaN(v) ? "—" :
    Number(v).toLocaleString("en-PK", { maximumFractionDigits: 4 });

  const totals = summary?.totals;
  const rows = summary?.rows || [];
  const cfg = summary?.config;
  const periodLabel = summary?.period?.label || "—";
  const warnings = summary?.warnings || [];

  // ── Snapshot store (2026-05-11) ──────────────────────────────────
  // The /tax-claim/claim-summary endpoint recomputes the optimization
  // every time the operator edits qty/unit_price. If we render
  // row.optimization directly, the "Apply this qty+unit_price" target
  // shifts under the operator's foot as soon as they start typing the
  // suggested numbers in. Freeze the FIRST hasSuggestion result per
  // HS code, and only re-snapshot when:
  //   • The HS code drops out of the bill (operator deleted that
  //     line) → garbage-collect its snapshot.
  //   • The operator clicks "↻ Recalculate" on that card.
  //   • The Refresh button at the top is clicked (we wipe all
  //     snapshots so a fresh fetch starts a new freeze).
  const [frozenOptByHs, setFrozenOptByHs] = useState({});
  // Per-HS apply-result indicator: "applied" | "ambiguous" | "missing"
  // | null. Renders an inline notice inside the optimization card.
  const [applyResultByHs, setApplyResultByHs] = useState({});
  // Per-HS "Why this price?" expanded state.
  const [whyOpenByHs, setWhyOpenByHs] = useState({});

  useEffect(() => {
    if (!summary?.rows) return;
    setFrozenOptByHs((prev) => {
      const next = { ...prev };
      // 1) Capture new suggestions
      for (const r of summary.rows) {
        if (r?.optimization?.hasSuggestion && !next[r.hsCode]) {
          next[r.hsCode] = r.optimization;
        }
      }
      // 2) Drop entries for HS codes no longer in the bill
      const liveHs = new Set(summary.rows.map((r) => r.hsCode));
      for (const k of Object.keys(next)) {
        if (!liveHs.has(k)) delete next[k];
      }
      return next;
    });
  }, [summary]);

  // Recalculate one HS — drop the frozen snapshot so the next render
  // re-captures from the current (fresh) row.optimization.
  const handleRecalculate = (hsCode) => {
    setFrozenOptByHs((prev) => {
      const next = { ...prev };
      delete next[hsCode];
      return next;
    });
    setApplyResultByHs((prev) => {
      const next = { ...prev };
      delete next[hsCode];
      return next;
    });
  };

  // Top-level refresh now wipes all snapshots so the operator can
  // re-start with fresh anchors after a colleague imported new
  // Annexure-A rows in another tab.
  const handleTopRefresh = () => {
    setFrozenOptByHs({});
    setApplyResultByHs({});
    if (onRefresh) onRefresh();
  };

  // Reset to original bill values — restores every row's qty +
  // unit_price + lineTotal + item type to what the bill carried when
  // the form first loaded. Wipes our local snapshot store too so the
  // operator starts the optimization journey fresh.
  const handleResetAll = () => {
    if (onResetToOriginal) onResetToOriginal();
    setFrozenOptByHs({});
    setApplyResultByHs({});
    setWhyOpenByHs({});
  };

  const handleApply = (hsCode, opt) => {
    if (!onApplyOptimization) return;
    // Pass the full optimization snapshot so the parent can use the
    // realistic band when distributing across multiple rows that
    // share this HS code (2026-05-11). Falls back to qty/price-only
    // for parents that haven't adopted the new signature.
    const result = onApplyOptimization(hsCode, opt);
    setApplyResultByHs((prev) => ({ ...prev, [hsCode]: result }));
  };

  // When collapsed: show ONLY the title row + a one-line summary chip
  // (claimable Rs / net new tax) so the operator can see "the answer"
  // at a glance without expanding. Click anywhere on the header to
  // toggle.
  const collapsedSummary = (() => {
    const t = summary?.totals || {};
    const claimable = t.claimableThisBill ?? 0;
    const net = t.netNewTax ?? 0;
    const warnCount = (summary?.warnings || []).length;
    return { claimable, net, warnCount };
  })();

  return (
    <section style={styles.taxPanelCard}>
      <header style={styles.taxPanelHeader}>
        <button
          type="button"
          onClick={onToggle}
          style={styles.taxPanelToggle}
          aria-expanded={open}
          title={open ? "Click to collapse" : "Click to expand and review claim details"}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <MdInventory2 size={16} color={colors.teal} />
            <strong style={{ fontSize: "0.88rem", color: colors.textPrimary }}>
              Tax Claim Snapshot
            </strong>
            {loading && <span style={{ fontSize: "0.72rem", color: colors.textSecondary, fontStyle: "italic" }}>updating…</span>}
            {/* Collapsed-state quick-glance chip — shows the punchline
                even when the body is hidden. */}
            {!open && summary && (
              <span style={styles.taxCollapsedSummary}>
                <span>Claimable: <strong>{fmtMoney(collapsedSummary.claimable)}</strong></span>
                <span style={{ color: colors.textSecondary }}>·</span>
                <span>Net tax: <strong>{fmtMoney(collapsedSummary.net)}</strong></span>
                {collapsedSummary.warnCount > 0 && (
                  <span style={styles.taxCollapsedWarnPill}>
                    ⚠ {collapsedSummary.warnCount} warning{collapsedSummary.warnCount !== 1 ? "s" : ""}
                  </span>
                )}
              </span>
            )}
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", color: colors.blue, flexShrink: 0 }}>
            {open ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
          </span>
        </button>
        {open && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
              {onRefresh && (
                <button
                  type="button"
                  onClick={handleTopRefresh}
                  style={styles.refreshBtn}
                  title="Refresh — pull latest purchases / sales (e.g. after running FBR Annexure-A import in another tab). Also re-anchors any frozen optimization suggestions."
                  disabled={loading}
                >
                  <MdRefresh size={14} /> Refresh
                </button>
              )}
              {onResetToOriginal && (
                <button
                  type="button"
                  onClick={handleResetAll}
                  style={styles.resetBillBtn}
                  title="Reset Qty + Unit Price on every row back to the original bill values (Bill mode source of truth). Undoes any optimization suggestions you've applied in this session."
                >
                  ↺ Reset to bill values
                </button>
              )}
              <select
                value={period}
                onChange={(e) => onPeriodChange(e.target.value)}
                style={styles.periodSelect}
                aria-label="Period"
              >
                <option value="this-month">This Month</option>
                <option value="last-month">Last Month</option>
                <option value="this-quarter">This Quarter</option>
                <option value="year-to-date">Year to Date</option>
                <option value="all-time">All Time</option>
              </select>
            </div>
            <div style={{ fontSize: "0.78rem", color: colors.textSecondary, marginTop: "0.4rem" }}>
              Per-sale match at weighted-avg cost · §8A {cfg?.agingMonths ?? 6}-month aging · §8B {cfg?.section8BCapPercent ?? 90}% cap · IRIS reconciliation gate · informational only — operator can save freely.
            </div>
          </>
        )}
      </header>

      {!open && (
        // Collapsed: stop here. Body, headline, warnings, footer all hidden.
        null
      )}
      {open && (<>


      {/* Headline strip — the punchline. 6 numbers on desktop, stacks
          on mobile via auto-fit. Operator's eye lands here first. */}
      <div style={styles.taxPanelHeadline}>
        <HeadlineCell label="This bill — output tax" value={fmtMoney(totals?.billOutputTax)} />
        <HeadlineCell label="Matched input" value={fmtMoney(totals?.matchedInputTax)} />
        <HeadlineCell
          label={`§8B cap (${cfg?.section8BCapPercent ?? 90}%)`}
          value={fmtMoney(totals?.section8BCap)}
          flag={totals?.section8BCapApplied ? "engaged" : null}
        />
        <HeadlineCell
          label="Claimable this bill"
          value={fmtMoney(totals?.claimableThisBill)}
          tone={(totals?.claimableThisBill ?? 0) > 0 ? "good" : "muted"}
        />
        <HeadlineCell label="Carry-fwd from prior" value={fmtMoney(totals?.carryForwardFromPrior)} />
        <HeadlineCell
          label="Net new tax"
          value={fmtMoney(totals?.netNewTax)}
          tone="strong"
        />
      </div>

      <div style={styles.taxPanelGrid}>
        {rows.map((row) => {
          const bill = row.bill || {};
          const bank = row.bank || {};
          const pending = row.pending || {};
          const manualOnly = row.manualOnly || {};
          const disputed = row.disputed || {};
          const match = row.match || {};
          const status = row.status || "good";

          // Status → colour band + icon + headline copy
          const cfgByStatus = {
            "good":           { kind: "good",   icon: MdCheckCircle, text: "Within input bank" },
            "headroom":       { kind: "good",   icon: MdCheckCircle, text: "Headroom available" },
            "shortfall":      { kind: "warn",   icon: MdWarning,     text: "Selling more than matched" },
            "no-purchase":    { kind: "danger", icon: MdWarning,     text: "No purchases on record" },
            "pending-only":   { kind: "warn",   icon: MdInfo,        text: "Pending IRIS reconciliation" },
            "manual-only":    { kind: "warn",   icon: MdInfo,        text: "Inventory exists, IRN missing" },
            "disputed-only":  { kind: "danger", icon: MdError,       text: "Disputed by IRIS" },
          };
          const sc = cfgByStatus[status] || cfgByStatus["good"];
          const StatusIcon = sc.icon;
          const styleKind = sc.kind === "good" ? styles.taxRowGood
            : sc.kind === "warn" ? styles.taxRowWarn
            : styles.taxRowDanger;

          // Row hint copy — situation-specific, references actual
          // numbers from the response.
          let hint = "";
          if (status === "no-purchase") {
            hint = "No eligible purchases for this HS code in the period. Output tax has no input backing — record the supplier bill (or import Annexure-A) and re-open this bill to refresh. You can still save now.";
          } else if (status === "disputed-only") {
            hint = `Found ${disputed.billCount} purchase bill${disputed.billCount !== 1 ? "s" : ""} (${fmtQty(disputed.qty)} qty, ${fmtMoney(disputed.value)} value) with status Disputed — IRIS rejected the supplier match. Until you re-issue the bill or contact the supplier to refile, this won't back any input-tax claim.`;
          } else if (status === "manual-only") {
            hint = `Found ${manualOnly.billCount} purchase bill${manualOnly.billCount !== 1 ? "s" : ""} (${fmtQty(manualOnly.qty)} qty, ${fmtMoney(manualOnly.value)} value) entered manually without an IRN. The Stock Dashboard counts this as inventory but FBR won't accept the input-tax claim — backfill the SupplierIRN on the Purchase Bill to unlock ${fmtMoney(manualOnly.tax)} of claimable input tax.`;
          } else if (status === "pending-only") {
            hint = `Found ${pending.billCount} purchase bill${pending.billCount !== 1 ? "s" : ""} (${fmtMoney(pending.tax)} input tax) but they're not yet IRIS-reconciled. Claimable as soon as the supplier files in IRIS.`;
          } else if (status === "shortfall") {
            hint = `${fmtQty(match.unmatchedQty)} qty has no matching purchase — output tax on that portion is pure cost (~${fmtMoney(match.unmatchedQty * (bill.value > 0 ? bill.value / bill.qty : 0) * (totals?.billOutputTax && totals.matchedInputTax >= 0 ? (totals.section8BCap > 0 ? cfg?.section8BCapPercent / 100 : 0) : 0))}). Either record more supplier purchases for this HS or move qty onto a different HS where you have headroom.`;
          } else if (status === "headroom") {
            const extraQty = Math.max(0, bank.availableQty - bill.qty);
            const extraValue = Math.max(0, bank.availableValue - bill.value);
            hint = `${fmtQty(extraQty)} qty / ${fmtMoney(extraValue)} still available under this HS. Tagging more lines here would consume more of the input-tax bank.`;
          } else {
            hint = "Bill qty fully matches available bank — input claim aligned.";
          }

          return (
            <div key={row.hsCode} style={{ ...styles.taxRowCard, ...styleKind }}>
              <div style={styles.taxRowHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", minWidth: 0 }}>
                  <span style={styles.taxRowHs}>{row.hsCode}</span>
                  {row.itemTypeName && <span style={styles.taxRowName}>{row.itemTypeName}</span>}
                </div>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: "0.25rem",
                  fontSize: "0.74rem", fontWeight: 700,
                  color: sc.kind === "good" ? "#2e7d32" : sc.kind === "warn" ? "#8a4b00" : "#b71c1c",
                  flexShrink: 0,
                }}>
                  <StatusIcon size={14} />
                  {sc.text}
                </span>
              </div>

              {/* Stats — bill / matched / available / sold (period) */}
              <div style={styles.taxRowStats}>
                <RowStat label="This bill" qty={bill.qty} value={bill.value} fmtMoney={fmtMoney} fmtQty={fmtQty} />
                <RowStat
                  label="Matched (claim)"
                  qty={match.matchedQty}
                  value={null}
                  extra={match.matchedInputTax > 0 ? `Rs. ${Number(match.matchedInputTax).toLocaleString("en-PK", { maximumFractionDigits: 0 })} input tax` : null}
                  fmtMoney={fmtMoney} fmtQty={fmtQty}
                  highlight
                />
                <RowStat
                  label="Available bank"
                  qty={bank.availableQty}
                  value={bank.availableValue}
                  extra={bank.availableTax > 0 ? `Rs. ${Number(bank.availableTax).toLocaleString("en-PK", { maximumFractionDigits: 0 })} input` : null}
                  fmtMoney={fmtMoney} fmtQty={fmtQty}
                />
                <RowStat
                  label={`Sold (${periodLabel.toLowerCase()})`}
                  qty={bank.soldQty}
                  value={bank.soldValue}
                  fmtMoney={fmtMoney} fmtQty={fmtQty}
                />
              </div>

              {/* Aging + pending + manual-only + disputed sub-line.
                  Shows whichever signals apply. Each is non-intrusive
                  but visible enough to act on. */}
              {(bank.expiringWithin30Days || pending.billCount > 0 || manualOnly.billCount > 0 || disputed.billCount > 0) && (
                <div style={styles.taxRowSubMeta}>
                  {bank.expiringWithin30Days && (
                    <span style={styles.taxRowAging}>
                      ⏰ Oldest purchase ages out within 30 days
                    </span>
                  )}
                  {pending.billCount > 0 && (
                    <span style={styles.taxRowPending}>
                      ℹ {pending.billCount} bill{pending.billCount !== 1 ? "s" : ""} pending IRIS · {fmtMoney(pending.tax)}
                    </span>
                  )}
                  {manualOnly.billCount > 0 && (
                    <span style={styles.taxRowManualOnly}>
                      ⚠ {manualOnly.billCount} bill{manualOnly.billCount !== 1 ? "s" : ""} no IRN · {fmtQty(manualOnly.qty)} qty · would unlock {fmtMoney(manualOnly.tax)} input tax
                    </span>
                  )}
                  {disputed.billCount > 0 && (
                    <span style={styles.taxRowDisputed}>
                      ✗ {disputed.billCount} bill{disputed.billCount !== 1 ? "s" : ""} disputed by IRIS · {fmtMoney(disputed.tax)} input tax blocked
                    </span>
                  )}
                </div>
              )}

              <div style={styles.taxRowHint}>
                <MdLightbulb size={13} color="#5f6d7e" style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{hint}</span>
              </div>

              {/* Optimization suggestion — 2026-05-09 (audit-anchored
                  2026-05-11). We render a FROZEN snapshot of the first
                  meaningful suggestion seen for this HS, not the live
                  row.optimization. That way the target qty + unit_price
                  stays stable while the operator types the suggested
                  values in. "↻ Recalculate" drops the snapshot and
                  re-anchors to the current state. The "Apply" button
                  writes qty + unit_price directly into the matching
                  bill row (when there's exactly one). */}
              {(() => {
                const frozenOpt = frozenOptByHs[row.hsCode];
                const liveOpt = row.optimization;
                // Show the snapshot if we have one; otherwise fall back
                // to the live one for the first render before useEffect
                // captures it.
                const opt = frozenOpt || (liveOpt?.hasSuggestion ? liveOpt : null);
                if (!opt) return null;
                const isFrozen = !!frozenOpt;
                const isStale = isFrozen && liveOpt?.hasSuggestion && (
                  Number(frozenOpt.suggestedQty) !== Number(liveOpt.suggestedQty)
                  || Number(frozenOpt.suggestedUnitPrice) !== Number(liveOpt.suggestedUnitPrice)
                );
                const applyRes = applyResultByHs[row.hsCode];
                const whyOpen = !!whyOpenByHs[row.hsCode];

                const riskCfg = opt.auditRiskLevel === "high"
                  ? { style: styles.taxRowOptimizationRiskHigh, label: "High audit risk", icon: MdError }
                  : opt.auditRiskLevel === "moderate"
                  ? { style: styles.taxRowOptimizationRiskModerate, label: "Moderate audit risk", icon: MdWarning }
                  : { style: styles.taxRowOptimizationRiskLow, label: "Audit-defensible", icon: MdCheckCircle };
                const RiskIcon = riskCfg.icon;
                const refBills = opt.referencePurchaseBills || [];

                return (
                <div style={styles.taxRowOptimization}>
                  <div style={styles.taxRowOptimizationHeader}>
                    <MdAutoAwesome size={14} color="#0d47a1" />
                    <span style={styles.taxRowOptimizationTitle}>
                      Maximum-claim suggestion for this HS
                    </span>
                    <span style={styles.taxRowOptimizationDelta}>
                      +{fmtMoney(opt.additionalClaimableInputTax)} extra input tax
                    </span>
                  </div>
                  <div style={styles.taxRowOptimizationGrid}>
                    <div>
                      <div style={styles.taxRowOptimizationLabel}>Suggested Qty</div>
                      <div style={styles.taxRowOptimizationValue}>{fmtQty(opt.suggestedQty)}</div>
                    </div>
                    <div>
                      <div style={styles.taxRowOptimizationLabel}>Suggested Unit Price</div>
                      <div style={styles.taxRowOptimizationValue}>Rs. {Number(opt.suggestedUnitPrice).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div>
                      <div style={styles.taxRowOptimizationLabel}>Current claim</div>
                      <div style={styles.taxRowOptimizationValueMuted}>{fmtMoney(opt.currentMatchedInputTax)}</div>
                    </div>
                    <div>
                      <div style={styles.taxRowOptimizationLabel}>Suggested claim</div>
                      <div style={styles.taxRowOptimizationValueHighlight}>{fmtMoney(opt.suggestedMatchedInputTax)}</div>
                    </div>
                  </div>
                  {/* Audit-risk pill — sits prominently right under the
                      headline numbers so the operator can't miss the
                      "is this safe?" signal. */}
                  <div style={{ ...styles.taxRowOptimizationRiskPill, ...riskCfg.style }}>
                    <RiskIcon size={13} />
                    <strong>{riskCfg.label}</strong>
                    <span style={{ fontWeight: 400 }}>· {opt.auditRiskNote}</span>
                  </div>
                  {/* Subtotal-preservation receipt — proves to the operator
                      that qty × unit_price recomposes to the same bill
                      amount. Green check when exact; amber when there's a
                      tiny rounding drift (rare prime-cents fallback). */}
                  <div style={styles.taxRowOptimizationSubtotalProof}>
                    <span style={{ color: colors.textSecondary }}>Recomposed subtotal:</span>{" "}
                    <strong style={{ fontFamily: "ui-monospace, monospace" }}>
                      {fmtQty(opt.suggestedQty)} × Rs. {Number(opt.suggestedUnitPrice).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} = {fmtMoney(opt.recomposedSubtotal)}
                    </strong>{" "}
                    <span style={{ color: colors.textSecondary }}>(original: {fmtMoney(row.bill.value)})</span>{" "}
                    {opt.exactSubtotalPreserved ? (
                      <span style={styles.taxRowOptimizationExactBadge}>
                        <MdCheckCircle size={12} /> Exact match — no change to bill amount
                      </span>
                    ) : (
                      <span style={styles.taxRowOptimizationDriftBadge}>
                        <MdWarning size={12} /> Drift Rs. {fmtMoney(Math.abs((opt.recomposedSubtotal || 0) - (row.bill.value || 0))).replace("Rs. ", "")} — within narrow-edit tolerance
                      </span>
                    )}
                  </div>
                  <div style={styles.taxRowOptimizationRationale}>{opt.rationale}</div>

                  {/* Apply + Recalculate controls */}
                  <div style={styles.taxRowOptimizationActions}>
                    <button
                      type="button"
                      style={styles.taxRowOptimizationApplyBtn}
                      onClick={() => handleApply(row.hsCode, opt)}
                      title="Set Qty + Unit Price on the matching bill row(s). When multiple lines share this HS, the qty is distributed across them proportionally to each line's subtotal, with per-row clean factorizations."
                    >
                      <MdCheckCircle size={13} /> Apply suggestion
                    </button>
                    <button
                      type="button"
                      style={styles.taxRowOptimizationRecalcBtn}
                      onClick={() => handleRecalculate(row.hsCode)}
                      title="Re-anchor the suggestion to the current bill state"
                    >
                      <MdRefresh size={13} /> Recalculate
                    </button>
                    <button
                      type="button"
                      style={styles.taxRowOptimizationWhyBtn}
                      onClick={() => setWhyOpenByHs((p) => ({ ...p, [row.hsCode]: !p[row.hsCode] }))}
                      aria-expanded={whyOpen}
                    >
                      {whyOpen ? <MdExpandLess size={13} /> : <MdExpandMore size={13} />}
                      Why this price?
                    </button>
                    {isStale && (
                      <span style={styles.taxRowOptimizationStaleHint}>
                        Underlying bill state changed — click Recalculate for a fresh anchor.
                      </span>
                    )}
                  </div>

                  {/* Inline apply-result notice */}
                  {applyRes?.status === "applied" && (
                    <div style={styles.taxRowOptimizationApplyOk}>
                      <MdCheckCircle size={13} /> Applied to the matching bill row. Subtotal preserved.
                    </div>
                  )}
                  {applyRes?.status === "distributed" && (
                    <div style={applyRes.anyOutOfBand
                        ? styles.taxRowOptimizationApplyWarn
                        : styles.taxRowOptimizationApplyOk}>
                      {applyRes.anyOutOfBand
                        ? <MdWarning size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                        : <MdCheckCircle size={13} style={{ flexShrink: 0, marginTop: 2 }} />}
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: 1, minWidth: 0 }}>
                        <span>
                          <strong>Distributed across {applyRes.count} line items.</strong>{" "}
                          Aggregate qty {applyRes.distributedTotalQty.toLocaleString("en-PK")}
                          {applyRes.distributedTotalQty !== applyRes.suggestedTotalQty &&
                            ` (suggestion was ${applyRes.suggestedTotalQty.toLocaleString("en-PK")} — rounded to clean per-row factorization)`}
                          . Each row's subtotal preserved exactly.
                          {applyRes.anyOutOfBand && " One or more rows landed outside the audit-defensible band — review before saving."}
                        </span>
                        <div style={styles.taxRowOptimizationDistTable}>
                          {applyRes.distributions.map((d, di) => (
                            <div key={d.idx} style={styles.taxRowOptimizationDistRow}>
                              <span style={styles.taxRowOptimizationDistLabel}>Row {di + 1}</span>
                              <span style={styles.taxRowOptimizationDistQty}>
                                {Number(d.qty).toLocaleString("en-PK")} × Rs. {Number(d.unitPrice).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                              <span style={styles.taxRowOptimizationDistTotal}>
                                = Rs. {Number(d.lineTotal).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                              <span style={d.inBand ? styles.taxRowOptimizationDistBadgeOk : styles.taxRowOptimizationDistBadgeWarn}>
                                {d.inBand ? "in band" : "out of band"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {applyRes?.status === "missing" && (
                    <div style={styles.taxRowOptimizationApplyWarn}>
                      <MdWarning size={13} />
                      <span>No bill row found for this HS — open the relevant line and edit manually.</span>
                    </div>
                  )}

                  {/* Why-this-price disclosure — collapsible.
                      Renders the realistic band, math optimum, and the
                      top reference purchase bills that JUSTIFY the
                      suggested unit price. Without this the operator
                      can't defend the number in an audit. */}
                  {whyOpen && (
                    <div style={styles.taxRowOptimizationWhy}>
                      <div style={styles.taxRowOptimizationWhyHeader}>Audit anchor</div>
                      <div style={styles.taxRowOptimizationWhyGrid}>
                        <div>
                          <div style={styles.taxRowOptimizationLabel}>Math optimum</div>
                          <div style={styles.taxRowOptimizationWhyValueMuted}>
                            Rs. {Number(opt.mathOptimalUnitPrice || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/unit
                          </div>
                          <div style={styles.taxRowOptimizationWhyHint}>
                            Price that would fully bind the §8B cap. Ignored if outside the realistic band.
                          </div>
                        </div>
                        <div>
                          <div style={styles.taxRowOptimizationLabel}>Realistic band</div>
                          <div style={styles.taxRowOptimizationWhyValue}>
                            Rs. {Number(opt.realisticBandLow || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            {" – "}
                            Rs. {Number(opt.realisticBandHigh || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/unit
                          </div>
                          <div style={styles.taxRowOptimizationWhyHint}>
                            Min actual purchase price → 1.5× weighted-avg cost.
                          </div>
                        </div>
                        <div>
                          <div style={styles.taxRowOptimizationLabel}>Weighted-avg cost</div>
                          <div style={styles.taxRowOptimizationWhyValue}>
                            Rs. {Number(opt.avgPurchaseUnitCost || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/unit
                          </div>
                          <div style={styles.taxRowOptimizationWhyHint}>
                            Across {bank.purchaseBillCount || refBills.length} purchase bill{(bank.purchaseBillCount || refBills.length) === 1 ? "" : "s"}.
                          </div>
                        </div>
                      </div>
                      {refBills.length > 0 && (
                        <>
                          <div style={styles.taxRowOptimizationWhySubheader}>
                            Reference purchase bills (audit cross-check)
                          </div>
                          <div style={styles.taxRowOptimizationRefBills}>
                            {refBills.map((rb) => (
                              <div key={rb.purchaseBillId} style={styles.taxRowOptimizationRefBill}>
                                <div style={styles.taxRowOptimizationRefBillNum}>{rb.billNumber}</div>
                                <div style={styles.taxRowOptimizationRefBillMeta}>
                                  {new Date(rb.date).toLocaleDateString("en-PK")} ·{" "}
                                  {fmtQty(rb.qty)} qty · {fmtMoney(rb.value)}
                                </div>
                                <div style={styles.taxRowOptimizationRefBillPrice}>
                                  Rs. {Number(rb.unitPrice || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/unit
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div style={styles.taxRowOptimizationWarning}>
                    <MdWarning size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      <strong>Only apply this if it reflects the real sale.</strong>{" "}
                      Use it when invoice granularity should match purchase granularity
                      (kit-priced item bought per-piece, bundled accessories, bulk
                      consumables, etc.). Fabricating qty / under-pricing to harvest
                      input tax is an FBR §3A violation — auditors cross-check qty
                      against delivery challans, stock movements, and the buyer's
                      Annexure-A. Bill-wide §8B cap still applies on save.
                    </span>
                  </div>
                </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Warnings list — surfaces §8B engaged, IRIS-pending,
          no-purchase situations once at the bottom. Concise, scannable. */}
      {warnings.length > 0 && (
        <div style={styles.taxWarnings}>
          {warnings.map((w, i) => (
            <div key={i} style={styles.taxWarningRow}>
              <MdInfo size={13} color="#8a4b00" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Compliance footer — operators can audit which rules fired */}
      {cfg && (
        <div style={styles.taxComplianceFooter}>
          Computed under §8A {cfg.agingMonths}-month aging · §8B {cfg.section8BCapPercent}% cap · IRIS allow-list:&nbsp;
          {(cfg.claimableReconciliationStatuses || []).join(", ")}
        </div>
      )}
      </>)}
    </section>
  );
}

function HeadlineCell({ label, value, flag, tone }) {
  let valueColor = "#1a2332";
  if (tone === "good") valueColor = "#2e7d32";
  else if (tone === "muted") valueColor = "#5f6d7e";
  else if (tone === "strong") valueColor = "#0d47a1";
  return (
    <div>
      <div style={styles.taxPanelHeadlineLabel}>
        {label}
        {flag === "engaged" && (
          <span style={styles.taxFlagPill}>engaged</span>
        )}
      </div>
      <div style={{ ...styles.taxPanelHeadlineValue, color: valueColor }}>{value}</div>
    </div>
  );
}

function RowStat({ label, qty, value, extra, fmtMoney, fmtQty, highlight = false }) {
  return (
    <div style={{ minWidth: 0, ...(highlight ? styles.taxStatHighlight : {}) }}>
      <div style={styles.taxStatLabel}>{label}</div>
      <div style={styles.taxStatQty}>{fmtQty(qty)} <span style={styles.taxStatUnit}>qty</span></div>
      {value != null && <div style={styles.taxStatValue}>{fmtMoney(value)}</div>}
      {extra && <div style={styles.taxStatExtra}>{extra}</div>}
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
  // Header row that pairs the section title with an inline action
  // (e.g. "+ New Item Type"). Wraps on phones via flex-wrap so the
  // button drops below the heading rather than crushing it.
  sectionHeadingRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flexWrap: "wrap",
    margin: "1rem 0 0.5rem",
  },
  inlineAddBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.3rem",
    padding: "0.35rem 0.7rem",
    border: `1px solid ${colors.blue}`,
    borderRadius: 8,
    backgroundColor: "#fff",
    color: colors.blue,
    fontSize: "0.78rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
  },
  // ── Tax Claim Panel styles ────────────────────────────────────────
  taxPanelCard: {
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 12,
    background: "#fbfdff",
    padding: "0.85rem 1rem",
    margin: "0.5rem 0 1rem",
    boxShadow: "0 1px 2px rgba(13,71,161,0.04)",
  },
  taxPanelHeader: {
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
    marginBottom: "0.7rem",
    paddingBottom: "0.55rem",
    borderBottom: `1px dashed ${colors.cardBorder}`,
  },
  taxPanelHeadline: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
    gap: "0.7rem",
    padding: "0.5rem 0.75rem",
    background: "#fff",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 10,
    marginBottom: "0.85rem",
  },
  taxPanelHeadlineLabel: {
    fontSize: "0.7rem",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    fontWeight: 600,
    marginBottom: "0.15rem",
  },
  taxPanelHeadlineValue: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "1rem",
    fontWeight: 800,
    color: colors.textPrimary,
  },
  taxPanelGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
    gap: "0.65rem",
  },
  taxRowCard: {
    border: "1px solid",
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: "0.6rem 0.75rem",
    background: "#fff",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    minWidth: 0,
  },
  taxRowGood:    { borderColor: "#a5d6a7", borderLeftColor: "#2e7d32" },
  taxRowWarn:    { borderColor: "#ffcc80", borderLeftColor: "#e65100" },
  taxRowDanger:  { borderColor: "#ef9a9a", borderLeftColor: "#b71c1c" },
  taxRowHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  taxRowHs: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.85rem",
    fontWeight: 700,
    color: colors.blue,
    flexShrink: 0,
  },
  taxRowName: {
    fontSize: "0.78rem",
    color: colors.textPrimary,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  taxRowStats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100px, 100%), 1fr))",
    gap: "0.5rem",
  },
  taxStatLabel: {
    fontSize: "0.66rem",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: 600,
    marginBottom: "0.1rem",
  },
  taxStatQty: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.85rem",
    fontWeight: 700,
    color: colors.textPrimary,
  },
  taxStatUnit: {
    fontFamily: "inherit",
    fontSize: "0.66rem",
    fontWeight: 500,
    color: colors.textSecondary,
    marginLeft: 2,
  },
  taxStatValue: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.78rem",
    color: colors.textSecondary,
    marginTop: 1,
  },
  taxStatExtra: {
    fontSize: "0.7rem",
    color: "#2e7d32",
    fontWeight: 600,
    marginTop: 1,
  },
  taxRowHint: {
    display: "flex",
    gap: "0.4rem",
    padding: "0.4rem 0.55rem",
    background: "#f7f9fc",
    borderRadius: 6,
    fontSize: "0.74rem",
    color: colors.textPrimary,
    lineHeight: 1.4,
  },
  // Optimization-suggestion card (2026-05-09).
  // Distinct visual style (blue accent border + light gradient) so it
  // doesn't blend into the regular row stats. The amber warning line
  // at the bottom is the legal caveat — visually heavy on purpose.
  taxRowOptimization: {
    marginTop: "0.5rem",
    padding: "0.6rem 0.7rem",
    background: "linear-gradient(135deg, #e3f2fd 0%, #f0f7ff 70%, #fbfdff 100%)",
    border: "1px solid #90caf9",
    borderLeft: "3px solid #0d47a1",
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    gap: "0.45rem",
  },
  taxRowOptimizationHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    flexWrap: "wrap",
  },
  taxRowOptimizationTitle: {
    fontSize: "0.78rem",
    fontWeight: 700,
    color: "#0d47a1",
    flex: 1,
    minWidth: 0,
  },
  taxRowOptimizationDelta: {
    fontSize: "0.74rem",
    fontWeight: 700,
    color: "#1b5e20",
    background: "#e8f5e9",
    border: "1px solid #a5d6a7",
    padding: "0.15rem 0.45rem",
    borderRadius: 999,
  },
  taxRowOptimizationGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: "0.5rem",
  },
  taxRowOptimizationLabel: {
    fontSize: "0.68rem",
    color: colors.textSecondary,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    marginBottom: "0.1rem",
  },
  taxRowOptimizationValue: {
    fontSize: "0.95rem",
    fontWeight: 800,
    color: "#0d47a1",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  taxRowOptimizationValueMuted: {
    fontSize: "0.88rem",
    fontWeight: 600,
    color: colors.textSecondary,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    textDecoration: "line-through",
  },
  taxRowOptimizationValueHighlight: {
    fontSize: "0.95rem",
    fontWeight: 800,
    color: "#1b5e20",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  // Subtotal-preservation receipt — proves qty × unit_price recomposes
  // to the original bill amount. Sits between the grid and rationale.
  // Lives on a white card to stand apart from the gradient background.
  taxRowOptimizationSubtotalProof: {
    fontSize: "0.74rem",
    color: colors.textPrimary,
    lineHeight: 1.55,
    background: "#fff",
    border: "1px solid #cfe3f6",
    borderRadius: 6,
    padding: "0.4rem 0.55rem",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.35rem",
  },
  taxRowOptimizationExactBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    fontSize: "0.68rem",
    fontWeight: 700,
    color: "#1b5e20",
    background: "#e8f5e9",
    border: "1px solid #a5d6a7",
    padding: "0.15rem 0.45rem",
    borderRadius: 999,
    whiteSpace: "nowrap",
  },
  taxRowOptimizationDriftBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    fontSize: "0.68rem",
    fontWeight: 700,
    color: "#8a4b00",
    background: "#fff4e0",
    border: "1px solid #ffcc80",
    padding: "0.15rem 0.45rem",
    borderRadius: 999,
    whiteSpace: "nowrap",
  },
  taxRowOptimizationRationale: {
    fontSize: "0.74rem",
    color: colors.textPrimary,
    lineHeight: 1.45,
    background: "#fff",
    border: "1px dashed #b3d4f0",
    borderRadius: 6,
    padding: "0.4rem 0.55rem",
  },
  taxRowOptimizationWarning: {
    display: "flex",
    gap: "0.4rem",
    padding: "0.4rem 0.55rem",
    background: "#fff4e0",
    border: "1px solid #ffcc80",
    borderRadius: 6,
    fontSize: "0.72rem",
    color: "#8a4b00",
    lineHeight: 1.45,
  },
  // ── Audit-risk pill (2026-05-11) ─────────────────────────────────
  // Sits directly under the headline grid so the "can this survive an
  // audit?" signal is impossible to miss. Background swaps to match
  // severity.
  taxRowOptimizationRiskPill: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.4rem",
    padding: "0.4rem 0.55rem",
    borderRadius: 6,
    fontSize: "0.72rem",
    lineHeight: 1.45,
  },
  taxRowOptimizationRiskLow: {
    background: "#e8f5e9",
    border: "1px solid #a5d6a7",
    color: "#1b5e20",
  },
  taxRowOptimizationRiskModerate: {
    background: "#fff4e0",
    border: "1px solid #ffcc80",
    color: "#8a4b00",
  },
  taxRowOptimizationRiskHigh: {
    background: "#ffebee",
    border: "1px solid #ef9a9a",
    color: "#b71c1c",
  },
  // ── Action row (Apply / Recalculate / Why) ────────────────────────
  taxRowOptimizationActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    flexWrap: "wrap",
  },
  taxRowOptimizationApplyBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.35rem 0.7rem",
    background: "#1b5e20",
    color: "#fff",
    border: "1px solid #1b5e20",
    borderRadius: 6,
    fontSize: "0.74rem",
    fontWeight: 700,
    cursor: "pointer",
  },
  taxRowOptimizationRecalcBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.35rem 0.65rem",
    background: "#fff",
    color: "#0d47a1",
    border: "1px solid #90caf9",
    borderRadius: 6,
    fontSize: "0.72rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  taxRowOptimizationWhyBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.35rem 0.55rem",
    background: "transparent",
    color: "#0d47a1",
    border: "1px dashed #90caf9",
    borderRadius: 6,
    fontSize: "0.72rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  taxRowOptimizationStaleHint: {
    fontSize: "0.7rem",
    color: "#8a4b00",
    fontStyle: "italic",
  },
  taxRowOptimizationApplyOk: {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
    fontSize: "0.72rem",
    color: "#1b5e20",
    background: "#e8f5e9",
    border: "1px solid #a5d6a7",
    borderRadius: 6,
    padding: "0.35rem 0.55rem",
  },
  taxRowOptimizationApplyWarn: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.4rem",
    fontSize: "0.72rem",
    color: "#8a4b00",
    background: "#fff4e0",
    border: "1px solid #ffcc80",
    borderRadius: 6,
    padding: "0.4rem 0.55rem",
    lineHeight: 1.45,
  },
  // Per-row distribution breakdown — rendered inside the apply-result
  // notice when multiple rows share an HS and we auto-split the
  // suggestion (2026-05-11). Compact grid: row-label | qty × unit |
  // line total | in/out-of-band badge.
  taxRowOptimizationDistTable: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    marginTop: "0.2rem",
  },
  taxRowOptimizationDistRow: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto auto",
    gap: "0.45rem",
    alignItems: "center",
    padding: "0.3rem 0.45rem",
    background: "#fff",
    border: "1px solid #e0eef8",
    borderRadius: 5,
    fontSize: "0.72rem",
  },
  taxRowOptimizationDistLabel: {
    fontWeight: 700,
    color: "#0d47a1",
  },
  taxRowOptimizationDistQty: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: colors.textPrimary,
  },
  taxRowOptimizationDistTotal: {
    fontWeight: 700,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: colors.textPrimary,
  },
  taxRowOptimizationDistBadgeOk: {
    fontSize: "0.66rem",
    fontWeight: 700,
    color: "#1b5e20",
    background: "#e8f5e9",
    border: "1px solid #a5d6a7",
    padding: "0.1rem 0.4rem",
    borderRadius: 999,
    whiteSpace: "nowrap",
  },
  taxRowOptimizationDistBadgeWarn: {
    fontSize: "0.66rem",
    fontWeight: 700,
    color: "#8a4b00",
    background: "#fff4e0",
    border: "1px solid #ffcc80",
    padding: "0.1rem 0.4rem",
    borderRadius: 999,
    whiteSpace: "nowrap",
  },
  // ── Why-this-price disclosure ─────────────────────────────────────
  // Audit-anchor card that opens on click. Shows the math optimum, the
  // realistic band, weighted-avg cost, and the top reference purchase
  // bills the suggestion was anchored against.
  taxRowOptimizationWhy: {
    background: "#fff",
    border: "1px solid #cfe3f6",
    borderRadius: 6,
    padding: "0.55rem 0.7rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.45rem",
  },
  taxRowOptimizationWhyHeader: {
    fontSize: "0.74rem",
    fontWeight: 700,
    color: "#0d47a1",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  taxRowOptimizationWhyGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "0.55rem",
  },
  taxRowOptimizationWhyValue: {
    fontSize: "0.86rem",
    fontWeight: 700,
    color: "#0d47a1",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  taxRowOptimizationWhyValueMuted: {
    fontSize: "0.86rem",
    fontWeight: 700,
    color: colors.textSecondary,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  taxRowOptimizationWhyHint: {
    fontSize: "0.68rem",
    color: colors.textSecondary,
    lineHeight: 1.4,
    marginTop: "0.15rem",
  },
  taxRowOptimizationWhySubheader: {
    fontSize: "0.72rem",
    fontWeight: 700,
    color: colors.textPrimary,
    marginTop: "0.2rem",
  },
  taxRowOptimizationRefBills: {
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
  },
  taxRowOptimizationRefBill: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    gap: "0.5rem",
    alignItems: "center",
    padding: "0.35rem 0.5rem",
    background: "#f5fbff",
    border: "1px solid #e0eef8",
    borderRadius: 5,
    fontSize: "0.72rem",
  },
  taxRowOptimizationRefBillNum: {
    fontWeight: 700,
    color: "#0d47a1",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  taxRowOptimizationRefBillMeta: {
    color: colors.textSecondary,
  },
  taxRowOptimizationRefBillPrice: {
    fontWeight: 700,
    color: colors.textPrimary,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  // Phase B additions ───────────────────────────────────────────────
  periodSelect: {
    background: "#fff",
    color: colors.textPrimary,
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: 8,
    padding: "0.3rem 0.55rem",
    fontSize: "0.78rem",
    fontWeight: 600,
    cursor: "pointer",
    outline: "none",
    minWidth: 130,
  },
  taxFlagPill: {
    display: "inline-block",
    marginLeft: "0.35rem",
    padding: "0 0.35rem",
    borderRadius: 99,
    fontSize: "0.62rem",
    fontWeight: 700,
    color: "#8a4b00",
    backgroundColor: "#fff4e0",
    border: "1px solid #ffcc80",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    verticalAlign: "middle",
  },
  taxStatHighlight: {
    padding: "0.3rem 0.4rem",
    background: "#e8f5e9",
    border: "1px solid #a5d6a7",
    borderRadius: 6,
  },
  taxRowSubMeta: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    fontSize: "0.7rem",
    color: colors.textSecondary,
  },
  taxRowAging: {
    color: "#8a4b00",
    fontWeight: 600,
  },
  taxRowPending: {
    color: "#0277bd",
    fontWeight: 600,
  },
  taxRowManualOnly: {
    color: "#8a4b00",
    fontWeight: 600,
  },
  taxRowDisputed: {
    color: "#b71c1c",
    fontWeight: 600,
  },
  refreshBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.3rem 0.6rem",
    background: "#fff",
    color: colors.blue,
    border: `1px solid ${colors.blue}`,
    borderRadius: 8,
    fontSize: "0.74rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  // Reset-to-original button — sits beside Refresh in the panel header.
  // Muted amber so it reads as "undo / revert" rather than "destructive".
  resetBillBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.3rem 0.6rem",
    background: "#fff4e0",
    color: "#8a4b00",
    border: "1px solid #ffcc80",
    borderRadius: 8,
    fontSize: "0.74rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  // Click-target for the entire title row of the Tax Claim Snapshot.
  // Looks like a row, behaves like a button.
  taxPanelToggle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    width: "100%",
    padding: 0,
    margin: 0,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
  },
  // Inline summary shown next to the title when the panel is collapsed —
  // gives the operator the punchline (claimable + net + warning count)
  // without expanding.
  taxCollapsedSummary: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    flexWrap: "wrap",
    fontSize: "0.78rem",
    color: colors.textPrimary,
  },
  taxCollapsedWarnPill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.1rem 0.45rem",
    borderRadius: 99,
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#8a4b00",
    backgroundColor: "#fff4e0",
    border: "1px solid #ffcc80",
  },
  taxWarnings: {
    marginTop: "0.85rem",
    padding: "0.6rem 0.75rem",
    background: "#fff8e1",
    border: "1px solid #ffe082",
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  },
  taxWarningRow: {
    display: "flex",
    gap: "0.35rem",
    fontSize: "0.75rem",
    color: "#5d4037",
    lineHeight: 1.4,
  },
  taxComplianceFooter: {
    marginTop: "0.65rem",
    padding: "0.4rem 0",
    fontSize: "0.7rem",
    color: colors.textSecondary,
    fontStyle: "italic",
    borderTop: `1px dashed ${colors.cardBorder}`,
    textAlign: "center",
  },
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
