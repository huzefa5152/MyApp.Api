import { useEffect, useMemo, useState } from "react";
import { MdClose, MdLocalShipping, MdSearch } from "react-icons/md";
import { getOpenChallanLinesForPurchase } from "../api/purchaseBillApi";
import { formStyles } from "../theme";
import SearchableSelect from "./SearchableSelect";

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

/**
 * Picks challan lines to buy on one purchase bill: any lines, from any number
 * of challans. Shows only what is still left to purchase (the server's
 * remaining, less what this form already holds in `taken`), so a line that is
 * fully bought never appears. With a supplier chosen it lists that supplier's
 * planned lines and lines with no supplier yet; "All suppliers" lists the rest.
 */
export default function ChallanLinePicker({
  companyId,
  suppliers,
  supplierId,
  onSupplierChange,
  onSupplierCreated,
  supplierLocked = false,
  excludeBillId = null,
  taken = {},
  onAdd,
  onClose,
}) {
  const [allSuppliers, setAllSuppliers] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [challans, setChallans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // deliveryItemId -> quantity typed (string while editing)
  const [picked, setPicked] = useState({});

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    getOpenChallanLinesForPurchase(companyId, {
      supplierId: supplierId || undefined,
      allSuppliers: allSuppliers || undefined,
      search: query || undefined,
      excludeBillId: excludeBillId || undefined,
    })
      .then(({ data }) => live && setChallans(data || []))
      .catch(() => live && setError("Could not load challans. Try again."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [companyId, supplierId, allSuppliers, query, excludeBillId]);

  // Lines still open after what the form already holds.
  const open = useMemo(
    () =>
      challans
        .map((c) => ({
          ...c,
          lines: c.lines
            .map((l) => ({ ...l, left: l.remaining - (taken[l.deliveryItemId] || 0) }))
            .filter((l) => l.left > 0),
        }))
        .filter((c) => c.lines.length > 0),
    [challans, taken],
  );

  const lineById = useMemo(() => {
    const m = new Map();
    for (const c of open) for (const l of c.lines) m.set(l.deliveryItemId, { line: l, challan: c });
    return m;
  }, [open]);

  const toggleLine = (l) =>
    setPicked((p) => {
      const next = { ...p };
      if (l.deliveryItemId in next) delete next[l.deliveryItemId];
      else next[l.deliveryItemId] = String(l.left);
      return next;
    });

  const toggleChallan = (c, on) =>
    setPicked((p) => {
      const next = { ...p };
      for (const l of c.lines) {
        if (on) next[l.deliveryItemId] = next[l.deliveryItemId] ?? String(l.left);
        else delete next[l.deliveryItemId];
      }
      return next;
    });

  const pickedIds = Object.keys(picked)
    .map(Number)
    .filter((id) => lineById.has(id));
  const challanCount = new Set(pickedIds.map((id) => lineById.get(id).challan.challanId)).size;
  const badQty = pickedIds.find((id) => {
    const q = parseFloat(picked[id]);
    return !(q > 0) || q > lineById.get(id).line.left;
  });

  const pickedTotal = pickedIds.reduce((sum, id) => {
    const { line } = lineById.get(id);
    return sum + (parseFloat(picked[id]) || 0) * (line.actualUnitCost || 0);
  }, 0);

  const add = () => {
    onAdd(
      pickedIds.map((id) => {
        const { line, challan } = lineById.get(id);
        return {
          deliveryItemId: id,
          quantity: parseFloat(picked[id]),
          unitPrice: line.actualUnitCost ?? 0,
          description: line.description,
          itemTypeId: line.itemTypeId,
          nonInventoryItemId: line.nonInventoryItemId,
          uom: line.unit,
          left: line.left,
          challanId: challan.challanId,
          challanNumber: challan.challanNumber,
          clientName: challan.clientName,
        };
      }),
    );
  };

  const supplierName = suppliers.find((s) => String(s.id) === String(supplierId))?.name;

  return (
    <div data-admin-backdrop="" style={{ ...formStyles.backdrop, zIndex: 1200 }} onClick={onClose}>
      <div
        data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: 920, width: "96vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>
            <MdLocalShipping style={{ verticalAlign: "-3px", marginRight: 6 }} />
            Add lines from delivery challans
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
                placeholder="Challan #, customer, PO or item"
                style={s.search}
              />
            </div>
          </div>
          {supplierId && (
            <label style={s.toggle}>
              <input
                type="checkbox"
                checked={allSuppliers}
                onChange={(e) => setAllSuppliers(e.target.checked)}
              />
              Show lines planned for other suppliers
            </label>
          )}
        </div>
        <div style={s.hint}>
          {supplierId
            ? `Lines planned for ${supplierName || "this supplier"}, and lines with no supplier yet. Lower a quantity to buy part of a line.`
            : "Choose a supplier, then tick lines from as many challans as you need."}
        </div>

        <div data-admin-body="" style={{ ...formStyles.body, background: "#f6f8fb" }}>
          {loading ? (
            <div style={s.empty}>Loading challans…</div>
          ) : error ? (
            <div style={{ ...s.empty, color: "#c62828" }}>{error}</div>
          ) : open.length === 0 ? (
            <div style={s.empty}>
              Nothing left to purchase{query ? " for this search" : ""}.
              {supplierId && !allSuppliers && " Lines planned for other suppliers are hidden."}
            </div>
          ) : (
            open.map((c) => {
              const ticked = c.lines.filter((l) => l.deliveryItemId in picked).length;
              return (
                <div key={c.challanId} style={s.card}>
                  <label style={s.cardHead}>
                    <input
                      type="checkbox"
                      checked={ticked === c.lines.length}
                      ref={(el) => el && (el.indeterminate = ticked > 0 && ticked < c.lines.length)}
                      onChange={(e) => toggleChallan(c, e.target.checked)}
                      aria-label={`Select all lines of challan ${c.challanNumber}`}
                    />
                    <span style={s.challanNo}>Challan #{c.challanNumber}</span>
                    <span style={s.client}>{c.clientName}</span>
                    <span style={s.count}>
                      {ticked ? `${ticked} of ${c.lines.length}` : c.lines.length} line
                      {c.lines.length > 1 ? "s" : ""}
                    </span>
                    <span style={s.meta}>
                      {c.deliveryDate ? new Date(c.deliveryDate).toLocaleDateString() : ""}
                      {c.poNumber ? ` · PO ${c.poNumber}` : ""}
                    </span>
                  </label>
                  {c.lines.map((l) => {
                    const on = l.deliveryItemId in picked;
                    const q = picked[l.deliveryItemId];
                    const qBad = on && (!(parseFloat(q) > 0) || parseFloat(q) > l.left);
                    const other =
                      supplierId && l.supplierId && String(l.supplierId) !== String(supplierId);
                    return (
                      <div
                        key={l.deliveryItemId}
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
                            {l.itemTypeName && <span>{l.itemTypeName}</span>}
                            <span>
                              {fmt(l.delivered)} delivered
                              {l.delivered - l.left > 0 && ` · ${fmt(l.delivered - l.left)} bought`}
                            </span>
                            {l.supplierId && (
                              <span style={{ ...s.chip, ...(other ? s.chipWarn : s.chipOk) }}>
                                {other ? "Planned for " : ""}
                                {l.supplierName}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={s.qtyBox} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="number"
                            min={0}
                            max={l.left}
                            aria-label={`Quantity of ${l.description} to buy`}
                            step="any"
                            disabled={!on}
                            value={on ? q : ""}
                            placeholder={fmt(l.left)}
                            onChange={(e) =>
                              setPicked((p) => ({ ...p, [l.deliveryItemId]: e.target.value }))
                            }
                            style={{ ...s.qty, ...(qBad ? s.qtyBad : {}) }}
                          />
                          <div style={s.left}>
                            of {fmt(l.left)} left
                            {l.actualUnitCost != null && ` · Rs ${fmt(l.actualUnitCost)}`}
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

        <div data-admin-footer="" style={{ ...formStyles.footer, justifyContent: "space-between" }}>
          <span style={{ fontSize: "0.85rem", color: "#5f6d7e" }}>
            {pickedIds.length === 0
              ? "No lines selected"
              : `${pickedIds.length} line${pickedIds.length > 1 ? "s" : ""} from ${challanCount} challan${challanCount > 1 ? "s" : ""}`}
            {pickedTotal > 0 && (
              <strong style={{ color: "#1a2332" }}> · Rs {fmt(pickedTotal)}</strong>
            )}
            {badQty && (
              <span style={{ color: "#c62828" }}> · a quantity is above what is left</span>
            )}
          </span>
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
              style={{
                ...formStyles.button,
                ...formStyles.submit,
                opacity: pickedIds.length && supplierId && !badQty ? 1 : 0.5,
              }}
              disabled={!pickedIds.length || !supplierId || !!badQty}
              title={!supplierId ? "Choose the supplier first" : undefined}
              onClick={add}
            >
              Add {pickedIds.length || ""} line{pickedIds.length === 1 ? "" : "s"} to bill
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
  toggle: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    fontSize: "0.82rem",
    color: "#1a2332",
    minHeight: 40,
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
  challanNo: { fontWeight: 700, color: "#0d47a1" },
  client: { fontWeight: 600, color: "#1a2332", minWidth: 0, overflowWrap: "anywhere" },
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
  chip: { fontSize: "0.7rem", padding: "0 8px", borderRadius: 999, lineHeight: "18px" },
  chipOk: { background: "#e8f5e9", color: "#1b5e20" },
  chipWarn: { background: "#fff3e0", color: "#e65100" },
  qtyBox: { flex: "0 0 132px", marginLeft: "auto", textAlign: "right" },
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
  left: { fontSize: "0.7rem", color: "#5f6d7e", marginTop: 2, whiteSpace: "nowrap" },
};
