import { useEffect, useState } from "react";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import { getSupplierStatement } from "../api/supplierApi";
import useIsNarrow from "../hooks/useIsNarrow";

/**
 * Supplier ledger — the payables mirror of the customer Statement tab.
 *
 * Every purchase bill, payment, advance and refund for one supplier in date
 * order with a running amount owed. Sides follow AP convention: a bill is a
 * credit (it increases what we owe), a payment is a debit. The closing balance
 * is reported as the amount OWED, so a positive figure reads the way an
 * operator expects and a negative one means we have paid ahead.
 */
export default function SupplierStatementDialog({ supplier, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const isNarrow = useIsNarrow();

  useEffect(() => {
    if (!supplier?.id) return;
    let cancelled = false;
    setData(null);
    setError("");
    getSupplierStatement(supplier.id)
      .then(({ data: d }) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError("Could not load this supplier's ledger."); });
    return () => { cancelled = true; };
  }, [supplier?.id]);

  if (!supplier) return null;
  const money = (n) => (n ? Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <div>
            <h5 style={formStyles.title}>{supplier.name}</h5>
            <div style={st.sub}>Supplier ledger — bills, payments and advances</div>
          </div>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>

        <div style={formStyles.body}>
          {error && <div style={formStyles.error}>{error}</div>}
          {!data && !error && <div style={st.hint}>Loading…</div>}

          {data && (
            <>
              <div style={st.summary}>
                <span style={st.summaryLabel}>
                  {Number(data.closingBalance) < 0 ? "They owe you" : "You owe"}
                </span>
                <span style={st.summaryValue}>
                  Rs {money(Math.abs(Number(data.closingBalance) || 0))}
                </span>
              </div>

              {data.entries?.length === 0 ? (
                <div style={st.hint}>Nothing recorded for this supplier yet.</div>
              ) : isNarrow ? (
                // Phone: one card per entry — a five-column ledger can't be read
                // at 375px, and a horizontally scrolling table hides the balance.
                <div>
                  {data.entries.map((e) => (
                    <div key={`${e.reference}-${e.docId}`} style={st.card}>
                      <div style={st.cardTop}>
                        <span style={st.ref}>{e.reference}</span>
                        <span style={st.date}>{new Date(e.date).toLocaleDateString()}</span>
                      </div>
                      <div style={st.type}>{e.type}</div>
                      {e.description && <div style={st.desc}>{e.description}</div>}
                      <div style={st.cardRow}>
                        <span style={st.cardLabel}>{e.credit ? "Billed" : "Paid"}</span>
                        <span style={st.num}>Rs {money(e.credit || e.debit)}</span>
                      </div>
                      <div style={st.cardRow}>
                        <span style={st.cardLabel}>Balance</span>
                        <span style={{ ...st.num, fontWeight: 700 }}>Rs {money(e.balance)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={st.table}>
                    <thead>
                      <tr>
                        <th style={st.th}>Date</th>
                        <th style={st.th}>Reference</th>
                        <th style={st.th}>Type</th>
                        <th style={{ ...st.th, textAlign: "right" }}>Paid</th>
                        <th style={{ ...st.th, textAlign: "right" }}>Billed</th>
                        <th style={{ ...st.th, textAlign: "right" }}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.entries.map((e) => (
                        <tr key={`${e.reference}-${e.docId}`}>
                          <td style={st.td}>{new Date(e.date).toLocaleDateString()}</td>
                          <td style={st.td}>{e.reference}</td>
                          <td style={st.td}>
                            {e.type}
                            {e.description && <div style={st.desc}>{e.description}</div>}
                          </td>
                          <td style={{ ...st.td, ...st.numCell }}>{money(e.debit)}</td>
                          <td style={{ ...st.td, ...st.numCell }}>{money(e.credit)}</td>
                          <td style={{ ...st.td, ...st.numCell, fontWeight: 700 }}>{money(e.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.capped && (
                <div style={st.hint}>
                  Showing the {data.entries.length} most recent of {data.total} entries.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const st = {
  sub: { marginTop: "0.15rem", color: colors.textSecondary, fontSize: "0.78rem" },
  hint: { padding: "0.75rem", color: colors.textSecondary, fontSize: "0.85rem" },
  summary: {
    display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between",
    gap: "0.5rem", padding: "0.7rem 0.85rem", marginBottom: "0.85rem",
    background: colors.inputBg, border: `1px solid ${colors.inputBorder}`, borderRadius: 8,
  },
  summaryLabel: { color: colors.textSecondary, fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" },
  summaryValue: { fontSize: "1.1rem", fontWeight: 800, color: colors.blue, minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word", lineHeight: 1.15, fontVariantNumeric: "tabular-nums" },

  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.83rem", minWidth: 560 },
  th: { padding: "0.45rem 0.55rem", borderBottom: `2px solid ${colors.inputBorder}`, color: colors.textSecondary, fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", whiteSpace: "nowrap" },
  td: { padding: "0.45rem 0.55rem", borderBottom: `1px solid ${colors.inputBorder}`, color: colors.textPrimary, verticalAlign: "top" },
  numCell: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  desc: { marginTop: "0.15rem", color: colors.textSecondary, fontSize: "0.75rem" },

  card: { padding: "0.6rem 0.7rem", marginBottom: "0.5rem", background: colors.cardBg, border: `1px solid ${colors.inputBorder}`, borderRadius: 8 },
  cardTop: { display: "flex", justifyContent: "space-between", gap: "0.5rem" },
  ref: { fontWeight: 700, fontSize: "0.85rem", color: colors.textPrimary },
  date: { color: colors.textSecondary, fontSize: "0.78rem" },
  type: { marginTop: "0.15rem", fontSize: "0.8rem", color: colors.textPrimary },
  cardRow: { display: "flex", justifyContent: "space-between", gap: "0.5rem", marginTop: "0.3rem" },
  cardLabel: { color: colors.textSecondary, fontSize: "0.78rem" },
  num: { fontVariantNumeric: "tabular-nums", fontSize: "0.85rem", color: colors.textPrimary },
};
