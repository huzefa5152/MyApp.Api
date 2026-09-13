import { useState, useEffect, useCallback } from "react";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import Pagination from "./Pagination";
import { getStockCostChanges } from "../api/stockApi";

const money = (n) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const stamp = (s) => (s ? new Date(s).toLocaleString(undefined, {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—");

// Helpers/StockCostChangeSources — the writers of a cost change, in the words
// an operator would use for them.
const SOURCE_LABEL = {
  GdCostingImport: "GD costing import",
  GdLineCorrection: "GD line corrected",
  ConsignmentDelete: "Consignment deleted",
  OpeningBalanceEdit: "Opening balance",
  OpeningBalanceDelete: "Opening balance removed",
  StockAdjustment: "Stock adjustment",
};

/**
 * An item's cost history — the audit trail behind its actual cost.
 *
 * The reason this exists: the actual-cost pool is SET, not accumulated. A
 * Backfill import overwrites it outright, a New Arrivals import adds to it, a
 * hand edit replaces it. Before this table there was no record of what a
 * figure had been, so "the margin looks wrong" could only be answered by
 * re-deriving it from the sheets — which is exactly what the person asking no
 * longer trusts.
 *
 * Every figure here is landed cost or margin, so the screen is behind
 * stock.actualcost.view, the same key that redacts the grid's own cost
 * columns. The endpoint enforces it; this dialog is simply not offered
 * without it.
 */
export default function CostHistoryDialog({ companyId, item, onClose }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await getStockCostChanges(companyId, {
        itemTypeId: item?.itemTypeId || undefined, page, pageSize,
      });
      setRows(data.items || []);
      setTotal(data.totalCount || 0);
      setTotalPages(data.totalPages || 1);
    } catch {
      setError("Could not load the cost history.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, item?.itemTypeId, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={formStyles.backdrop} onMouseDown={onClose}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.xxl}px` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>
            Cost history{item?.itemTypeName ? ` — ${item.itemTypeName}` : ""}
          </h3>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close">
            <MdClose size={18} />
          </button>
        </div>

        <div style={formStyles.body}>
          {error && <div style={formStyles.error}>{error}</div>}

          <p style={{ fontSize: 13, color: colors.textSecondary, marginTop: 0, lineHeight: 1.5 }}>
            Every recorded change to this item's actual cost, quantity and selling value —
            newest first. An empty list means nothing has moved the figures since the audit
            trail started recording (2026-09-13); changes made before then were not kept.
          </p>

          {loading ? (
            <p style={{ fontSize: 13, color: colors.textSecondary }}>Loading…</p>
          ) : rows.length === 0 ? (
            <p style={{ fontSize: 13, color: colors.textSecondary }}>No recorded changes.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={th}>When</th>
                    <th style={th}>Who</th>
                    <th style={th}>What</th>
                    {!item?.itemTypeId && <th style={th}>Item</th>}
                    <th style={{ ...th, textAlign: "right" }}>Quantity</th>
                    <th style={{ ...th, textAlign: "right" }}>Actual cost</th>
                    <th style={{ ...th, textAlign: "right" }}>Selling value</th>
                    <th style={th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{stamp(r.changedAt)}</td>
                      <td style={td}>{r.changedByUserName || "—"}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{SOURCE_LABEL[r.source] || r.source}</div>
                        {r.sourceRef && (
                          <div style={{ fontSize: 12, color: colors.textSecondary }}>{r.sourceRef}</div>
                        )}
                      </td>
                      {!item?.itemTypeId && (
                        <td style={td}>
                          <div style={wrap2}>{r.itemTypeName}</div>
                          {r.hsCode && (
                            <div style={{ fontSize: 12, color: colors.textSecondary }}>{r.hsCode}</div>
                          )}
                        </td>
                      )}
                      <Delta was={qty(r.oldQuantity)} now={qty(r.newQuantity)} moved={r.quantityDelta !== 0} />
                      <Delta was={money(r.oldActualCostExcludingTax)} now={money(r.newActualCostExcludingTax)} moved={r.actualCostDelta !== 0} />
                      <Delta was={money(r.oldValueExcludingTax)} now={money(r.newValueExcludingTax)} moved={r.valueDelta !== 0} />
                      <td style={td}><div style={wrap3}>{r.note || "—"}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              onPage={setPage}
              pageSize={pageSize}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
            />
          )}
        </div>

        <div style={formStyles.footer}>
          <button style={{ ...formStyles.button, ...formStyles.cancel, minHeight: 40 }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Before struck through, after in bold — but only when the figure actually
 *  moved, so a row that changed cost alone does not shout about a quantity
 *  that stayed put. */
function Delta({ was, now, moved }) {
  return (
    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {moved ? (
        <>
          <span style={{ textDecoration: "line-through", color: colors.textSecondary }}>{was}</span>
          <strong style={{ marginLeft: 8 }}>{now}</strong>
        </>
      ) : (
        <span style={{ color: colors.textSecondary }}>{now}</span>
      )}
    </td>
  );
}

const th = {
  textAlign: "left", padding: "0.5rem 0.6rem", fontSize: 12, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.03em", color: colors.textSecondary,
  borderBottom: `1px solid ${colors.cardBorder}`, whiteSpace: "nowrap",
};
const td = {
  padding: "0.55rem 0.6rem", fontSize: 13.5, color: colors.textPrimary,
  borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "top",
};
// User-supplied names and notes clamp by LINE, never by nowrap+ellipsis —
// CLAUDE.md 3: two similar-prefix names must not collapse into identical rows.
const wrap2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };
const wrap3 = { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", minWidth: 200 };
