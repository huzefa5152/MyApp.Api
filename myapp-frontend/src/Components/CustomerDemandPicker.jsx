import { useEffect, useMemo, useState } from "react";
import { MdClose, MdSearch, MdShoppingCart } from "react-icons/md";
import { getAwaitingLinesForPurchase } from "../api/purchaseBillApi";
import { formStyles } from "../theme";
import { docTrail } from "../utils/demandTags";
import SearchableSelect from "./SearchableSelect";

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

const GROUPS = [
  { value: "latest", label: "Latest step" },
  { value: "order", label: "Sales order" },
  { value: "challan", label: "Delivery challan" },
  { value: "bill", label: "Sale bill" },
];

const STAGE = {
  Ordered: { color: "#1565c0", bg: "#e3f2fd" },
  Delivered: { color: "#00796b", bg: "#e0f2f1" },
  Billed: { color: "#6a1b9a", bg: "#f3e5f5" },
};

/**
 * Picks customer-document lines to buy on one purchase bill. A sales order
 * line, the challan lines that deliver it and the sale bill lines that bill it
 * are one demand ("trail"): the server counts what is bought across all of
 * them, so whatever stage a line is picked at, the rest of its trail shrinks
 * too. `taken` maps trail key → quantity this form already holds, so a line
 * added once is not offered again.
 */
export default function CustomerDemandPicker({
  companyId,
  suppliers,
  supplierId,
  onSupplierChange,
  onSupplierCreated,
  supplierLocked = false,
  excludeBillId = null,
  taken = {},
  forDoc = null,
  onAdd,
  onClose,
}) {
  const [groupBy, setGroupBy] = useState(forDoc?.kind || "latest");
  const [allSuppliers, setAllSuppliers] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [doc, setDoc] = useState(forDoc);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [combine, setCombine] = useState(false);
  // trailKey -> quantity typed (string while editing)
  const [picked, setPicked] = useState({});

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    getAwaitingLinesForPurchase(companyId, {
      supplierId: supplierId || undefined,
      allSuppliers: allSuppliers || undefined,
      search: query || undefined,
      groupBy,
      excludeBillId: excludeBillId || undefined,
      forKind: doc?.kind,
      forId: doc?.id,
    })
      .then(({ data }) => live && setCards(data || []))
      .catch(() => live && setError("Could not load customer documents. Try again."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [companyId, supplierId, allSuppliers, query, groupBy, excludeBillId, doc]);

  // Lines still open after what the form already holds.
  const open = useMemo(
    () =>
      cards
        .map((c) => ({
          ...c,
          lines: c.lines
            .map((l) => ({ ...l, left: l.left - (taken[l.trailKey] || 0) }))
            .filter((l) => l.left > 0),
        }))
        .filter((c) => c.lines.length > 0),
    [cards, taken],
  );

  const lineByKey = useMemo(() => {
    const m = new Map();
    for (const c of open) for (const l of c.lines) m.set(l.trailKey, { line: l, card: c });
    return m;
  }, [open]);

  const toggleLine = (l) =>
    setPicked((p) => {
      const next = { ...p };
      if (l.trailKey in next) delete next[l.trailKey];
      else next[l.trailKey] = String(l.left);
      return next;
    });

  const toggleCard = (c, on) =>
    setPicked((p) => {
      const next = { ...p };
      for (const l of c.lines) {
        if (on) next[l.trailKey] = next[l.trailKey] ?? String(l.left);
        else delete next[l.trailKey];
      }
      return next;
    });

  const pickedKeys = Object.keys(picked).filter((k) => lineByKey.has(k));
  const docCount = new Set(
    pickedKeys.map((k) => lineByKey.get(k).card.kind + lineByKey.get(k).card.documentId),
  ).size;
  const badQty = pickedKeys.find((k) => {
    const q = parseFloat(picked[k]);
    return !(q > 0) || q > lineByKey.get(k).line.left + 1e-9;
  });
  const pickedTotal = pickedKeys.reduce(
    (sum, k) => sum + (parseFloat(picked[k]) || 0) * (lineByKey.get(k).line.cost || 0),
    0,
  );

  const add = () => {
    const rows = [];
    const byGroup = new Map();
    for (const k of pickedKeys) {
      const { line } = lineByKey.get(k);
      const quantity = parseFloat(picked[k]);
      const source = { kind: line.kind, lineId: line.lineId, quantity };
      const group = combine
        ? `${line.itemTypeId || ""}|${line.nonInventoryItemId || ""}|${(line.unit || "").toLowerCase()}|${line.cost ?? ""}`
        : k;
      const existing = byGroup.get(group);
      if (existing) {
        existing.quantity += quantity;
        existing.sources.push(source);
        existing.trailKeys.push(k);
        for (const t of line.trail)
          if (!existing.tags.some((x) => x.kind === t.kind && x.documentId === t.documentId))
            existing.tags.push(t);
        continue;
      }
      const row = {
        description: line.description,
        itemTypeId: line.itemTypeId,
        nonInventoryItemId: line.nonInventoryItemId,
        uom: line.unit,
        unitPrice: line.cost ?? 0,
        quantity,
        sources: [source],
        tags: [...line.trail],
        trailKeys: [k],
      };
      byGroup.set(group, row);
      rows.push(row);
    }
    onAdd(rows);
  };

  const supplierName = suppliers.find((s) => String(s.id) === String(supplierId))?.name;
  const canAdd = pickedKeys.length > 0 && supplierId && !badQty;

  return (
    <div data-admin-backdrop="" style={{ ...formStyles.backdrop, zIndex: 1200 }} onClick={onClose}>
      <div
        data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: 960, width: "96vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>
            <MdShoppingCart style={{ verticalAlign: "-3px", marginRight: 6 }} />
            What are you buying for?
          </h5>
          <button
            data-admin-close=""
            style={formStyles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            <MdClose size={20} />
          </button>
        </div>

        <div style={s.toolbar}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <label style={s.toolLabel}>Supplier</label>
            <SearchableSelect
              quickCreate={supplierLocked ? undefined : "supplier"}
              companyId={companyId}
              onCreated={onSupplierCreated}
              items={suppliers}
              value={supplierId}
              onChange={(id) => onSupplierChange(id ? String(id) : "")}
              disabled={supplierLocked}
              placeholder="Choose the supplier you are buying from…"
            />
          </div>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <label style={s.toolLabel}>Search</label>
            <div style={{ position: "relative" }}>
              <MdSearch style={s.searchIcon} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Order, challan or bill #, customer, PO or item"
                style={s.search}
              />
            </div>
          </div>
        </div>
        <div style={s.toolbar2}>
          <div role="group" aria-label="Group by" style={s.segment}>
            {GROUPS.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => setGroupBy(g.value)}
                aria-pressed={groupBy === g.value}
                style={{ ...s.segBtn, ...(groupBy === g.value ? s.segOn : {}) }}
              >
                {g.label}
              </button>
            ))}
          </div>
          {supplierId && (
            <label style={s.toggle}>
              <input
                type="checkbox"
                checked={allSuppliers}
                onChange={(e) => setAllSuppliers(e.target.checked)}
              />
              Also show lines planned for other suppliers
            </label>
          )}
          {doc && (
            <button type="button" style={s.docFilter} onClick={() => setDoc(null)}>
              Only this{" "}
              {doc.kind === "order" ? "sales order" : doc.kind === "challan" ? "challan" : "bill"} ✕
            </button>
          )}
        </div>
        <div style={s.hint}>
          {supplierId
            ? `Lines planned for ${supplierName || "this supplier"}, and lines with no supplier yet. Buying a line at any step also covers its order, challan and bill.`
            : "Choose a supplier, then tick lines from as many customer documents as you need."}
        </div>

        <div
          data-admin-body=""
          style={{
            ...formStyles.body,
            background: "#f6f8fb",
            opacity: loading && cards.length ? 0.6 : 1,
          }}
        >
          {loading && cards.length === 0 ? (
            <div style={s.empty}>Loading customer documents…</div>
          ) : error ? (
            <div style={{ ...s.empty, color: "#c62828" }}>{error}</div>
          ) : open.length === 0 ? (
            <div style={s.empty}>
              Nothing left to buy{query || doc ? " for this search" : ""}.
              {supplierId && !allSuppliers && " Lines planned for other suppliers are hidden."}
            </div>
          ) : (
            open.map((c) => {
              const ticked = c.lines.filter((l) => l.trailKey in picked).length;
              return (
                <div key={c.kind + (c.documentId ?? "")} style={s.card}>
                  <label style={s.cardHead}>
                    <input
                      type="checkbox"
                      checked={ticked === c.lines.length}
                      ref={(el) => el && (el.indeterminate = ticked > 0 && ticked < c.lines.length)}
                      onChange={(e) => toggleCard(c, e.target.checked)}
                      aria-label={`Select all lines of ${c.title}`}
                      style={s.check}
                    />
                    <span style={s.cardTitle}>{c.title}</span>
                    {c.clientName && <span style={s.client}>{c.clientName}</span>}
                    {c.from?.length > 0 && <span style={s.from}>from {docTrail(c.from)}</span>}
                    <span style={s.count}>
                      {ticked ? `${ticked} of ${c.lines.length}` : c.lines.length} line
                      {c.lines.length > 1 ? "s" : ""}
                    </span>
                    <span style={s.meta}>
                      {c.date ? new Date(c.date).toLocaleDateString() : ""}
                      {c.poNumber ? ` · PO ${c.poNumber}` : ""}
                    </span>
                  </label>
                  {c.lines.map((l) => {
                    const on = l.trailKey in picked;
                    const q = picked[l.trailKey];
                    const qBad = on && (!(parseFloat(q) > 0) || parseFloat(q) > l.left + 1e-9);
                    const other =
                      supplierId &&
                      l.plannedSupplierId &&
                      String(l.plannedSupplierId) !== String(supplierId);
                    const stage = STAGE[l.stage] || STAGE.Ordered;
                    return (
                      <div
                        key={l.trailKey}
                        style={{ ...s.line, ...(on ? s.lineOn : {}) }}
                        onClick={() => toggleLine(l)}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleLine(l)}
                          onClick={(e) => e.stopPropagation()}
                          style={s.check}
                          aria-label={`Buy ${l.description}`}
                        />
                        <div style={s.main}>
                          <div style={s.desc}>{l.description}</div>
                          <div style={s.sub}>
                            <span style={{ ...s.chip, color: stage.color, background: stage.bg }}>
                              {l.stage}
                            </span>
                            <span>
                              {[
                                l.ordered > 0 && `${fmt(l.ordered)} ordered`,
                                l.delivered > 0 && `${fmt(l.delivered)} delivered`,
                                l.billed > 0 && `${fmt(l.billed)} billed`,
                                l.bought > 0 && `${fmt(l.bought)} bought`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            {l.plannedSupplierId && (
                              <span style={{ ...s.chip, ...(other ? s.chipWarn : s.chipOk) }}>
                                {other ? "Planned for " : ""}
                                {l.plannedSupplierName}
                              </span>
                            )}
                          </div>
                          {l.trail.length > 1 && <div style={s.trail}>{docTrail(l.trail)}</div>}
                        </div>
                        <div style={s.qtyBox} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="number"
                            min={0}
                            max={l.left}
                            step="any"
                            aria-label={`Quantity of ${l.description} to buy`}
                            disabled={!on}
                            value={on ? q : ""}
                            placeholder={fmt(l.left)}
                            onChange={(e) =>
                              setPicked((p) => ({ ...p, [l.trailKey]: e.target.value }))
                            }
                            style={{ ...s.qty, ...(qBad ? s.qtyBad : {}) }}
                          />
                          <div style={s.left}>
                            of {fmt(l.left)} {l.unit} left
                            {l.cost != null && ` · Rs ${fmt(l.cost)}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div
          data-admin-footer=""
          style={{
            ...formStyles.footer,
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.35rem 0.9rem",
            }}
          >
            <label style={s.toggle}>
              <input
                type="checkbox"
                checked={combine}
                onChange={(e) => setCombine(e.target.checked)}
              />
              Combine same items
            </label>
            <span style={{ fontSize: "0.85rem", color: "#5f6d7e" }}>
              {pickedKeys.length === 0
                ? "No lines selected"
                : `${pickedKeys.length} line${pickedKeys.length > 1 ? "s" : ""} from ${docCount} document${docCount > 1 ? "s" : ""}`}
              {pickedTotal > 0 && (
                <strong style={{ color: "#1a2332" }}> · Rs {fmt(pickedTotal)}</strong>
              )}
              {badQty && (
                <span style={{ color: "#c62828" }}> · a quantity is above what is left</span>
              )}
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto" }}>
            <button
              type="button"
              style={{ ...formStyles.button, ...formStyles.cancel }}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: canAdd ? 1 : 0.5 }}
              disabled={!canAdd}
              title={!supplierId ? "Choose the supplier first" : undefined}
              onClick={add}
            >
              Add to bill
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const s = {
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.75rem",
    alignItems: "flex-end",
    padding: "0.85rem 1.25rem 0.4rem",
  },
  toolbar2: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem 1rem",
    alignItems: "center",
    padding: "0.2rem 1.25rem 0.4rem",
  },
  toolLabel: {
    display: "block",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#5f6d7e",
    marginBottom: 4,
  },
  searchIcon: {
    position: "absolute",
    left: 10,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#94a3b8",
  },
  search: {
    width: "100%",
    boxSizing: "border-box",
    padding: "0.55rem 0.75rem 0.55rem 2.1rem",
    border: "1px solid #d0d7e2",
    borderRadius: 8,
    fontSize: "0.88rem",
    minHeight: 40,
  },
  segment: {
    display: "inline-flex",
    border: "1px solid #d0d7e2",
    borderRadius: 8,
    overflow: "hidden",
  },
  segBtn: {
    padding: "0 0.8rem",
    minHeight: 36,
    border: "none",
    borderRadius: 0,
    boxShadow: "none",
    background: "#fff",
    color: "#455a64",
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  segOn: { background: "#0d47a1", color: "#fff" },
  toggle: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    fontSize: "0.82rem",
    color: "#1a2332",
    minHeight: 36,
  },
  docFilter: {
    border: "1px solid #90caf9",
    background: "#e3f2fd",
    color: "#0d47a1",
    borderRadius: 999,
    padding: "0 0.75rem",
    minHeight: 32,
    fontSize: "0.78rem",
    fontWeight: 600,
    boxShadow: "none",
    cursor: "pointer",
  },
  hint: { padding: "0 1.25rem 0.7rem", fontSize: "0.76rem", color: "#5f6d7e" },
  empty: { padding: "2.5rem 1rem", textAlign: "center", color: "#5f6d7e", fontSize: "0.9rem" },
  card: {
    background: "#fff",
    border: "1px solid #e3e8ef",
    borderRadius: 10,
    marginBottom: "0.6rem",
    overflow: "hidden",
  },
  cardHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.25rem 0.6rem",
    padding: "0.5rem 0.85rem",
    background: "#f8fafc",
    borderBottom: "1px solid #eef1f5",
    cursor: "pointer",
    fontSize: "0.86rem",
  },
  cardTitle: { fontWeight: 700, color: "#0d47a1" },
  client: { fontWeight: 600, color: "#1a2332", minWidth: 0, overflowWrap: "anywhere" },
  from: { fontSize: "0.74rem", color: "#5f6d7e" },
  count: {
    fontSize: "0.72rem",
    color: "#5f6d7e",
    background: "#eef1f5",
    borderRadius: 999,
    padding: "1px 8px",
  },
  meta: { fontSize: "0.76rem", color: "#5f6d7e", marginLeft: "auto" },
  line: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.35rem 0.75rem",
    alignItems: "center",
    padding: "0.5rem 0.85rem",
    borderTop: "1px solid #f0f3f7",
    borderLeft: "3px solid transparent",
    cursor: "pointer",
  },
  lineOn: { background: "#f3faf4", borderLeftColor: "#2e7d32" },
  check: { width: 18, height: 18, flex: "0 0 auto", cursor: "pointer" },
  main: { minWidth: 0, flex: "1 1 220px" },
  desc: { fontWeight: 600, color: "#1a2332", fontSize: "0.88rem", overflowWrap: "anywhere" },
  sub: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.15rem 0.6rem",
    fontSize: "0.75rem",
    color: "#5f6d7e",
    marginTop: 2,
  },
  trail: { fontSize: "0.7rem", color: "#7a8899", marginTop: 2 },
  chip: {
    fontSize: "0.7rem",
    padding: "0 8px",
    borderRadius: 999,
    lineHeight: "18px",
    fontWeight: 600,
  },
  chipOk: { background: "#e8f5e9", color: "#1b5e20" },
  chipWarn: { background: "#fff3e0", color: "#e65100" },
  qtyBox: { flex: "0 0 140px", marginLeft: "auto", textAlign: "right" },
  qty: {
    width: "100%",
    boxSizing: "border-box",
    padding: "0.35rem 0.55rem",
    border: "1px solid #d0d7e2",
    borderRadius: 6,
    textAlign: "right",
    minHeight: 36,
    fontSize: "0.88rem",
  },
  qtyBad: { borderColor: "#c62828", background: "#fff5f5" },
  left: { fontSize: "0.7rem", color: "#5f6d7e", marginTop: 2 },
};
