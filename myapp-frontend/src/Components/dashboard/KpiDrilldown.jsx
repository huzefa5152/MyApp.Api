// Drill-down behind one KPI card.
//
// The contract this exists to keep: the rows add up to the card. The server
// computes both from the same walk, and this panel shows the sum next to the
// card's own figure so a drift would be visible rather than silent — a
// breakdown that quietly disagreed with the number it opened from would be
// worse than no breakdown at all.
//
// Layout follows the house modal rules (CLAUDE.md 3 / formStyles): the backdrop
// scrolls, the card caps at 96vh, and only the body scrolls, so the header and
// the reconciliation footer stay put. On a phone the table becomes stacked
// cards rather than a wide table with horizontal scroll.
import { useEffect, useState } from "react";
import { MdClose, MdWarningAmber } from "react-icons/md";
import { formStyles, modalSizes } from "../../theme";

const NARROW = 760;

function money(v) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 });
}

function num(v) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString("en-PK", { maximumFractionDigits: 4 });
}

export default function KpiDrilldown({ open, onClose, loading, error, data, cardValue }) {
  const [isNarrow, setIsNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < NARROW : false);

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // A panel you cannot dismiss is the complaint this codebase already had once.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const rows = data?.rows || [];
  const rowSum = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const headline = cardValue == null ? data?.total : cardValue;
  // Tolerant to the last paisa only — anything larger is a real disagreement.
  const reconciles = headline == null || Math.abs(rowSum - Number(headline)) < 0.05;

  return (
    <div
      style={{ ...formStyles.backdrop, alignItems: "flex-start" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      role="presentation"
    >
      <div
        style={{ ...formStyles.modal, maxWidth: modalSizes.lg, margin: "auto" }}
        role="dialog"
        aria-modal="true"
        aria-label={data?.title || "Breakdown"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          gap: "0.75rem", padding: "1rem 1.25rem", borderBottom: "1px solid #e6ecf4",
          flexShrink: 0,
        }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: "1.02rem", color: "#0c1830" }}>
              {data?.title || "Breakdown"}
            </h3>
            {data?.note && (
              <p style={{
                margin: "0.3rem 0 0", color: "#69788f", fontSize: "0.8rem",
                lineHeight: 1.45, maxWidth: "62ch",
              }}>{data.note}</p>
            )}
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            style={{
              background: "none", border: "none", color: "#5f6d7e", cursor: "pointer",
              // padding 0 + no shadow, or index.css's global button rule
              // stretches this into a pill and shoves the glyph off-centre.
              padding: 0, boxShadow: "none",
              display: "grid", placeItems: "center", width: 44, height: 44, flexShrink: 0,
            }}
          ><MdClose size={20} /></button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "0.9rem 1.25rem" }}>
          {loading && <p style={{ color: "#69788f", margin: 0 }}>Loading…</p>}
          {error && <p style={{ color: "#c62828", margin: 0 }}>{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p style={{ color: "#69788f", margin: 0 }}>Nothing to show for this period.</p>
          )}

          {!loading && !error && rows.length > 0 && (
            isNarrow ? (
              // Phone: stacked cards. A wide table with horizontal scroll is
              // the anti-pattern CLAUDE.md 3 calls out explicitly.
              <div style={{ display: "grid", gap: "0.5rem" }}>
                {rows.map((r, i) => (
                  <div key={r.id ?? i} style={{
                    border: "1px solid #e6ecf4", borderRadius: 10, padding: "0.65rem 0.75rem",
                    background: r.flagged ? "#fff8f5" : "#fff",
                  }}>
                    <div style={{
                      display: "flex", justifyContent: "space-between",
                      gap: "0.6rem", alignItems: "baseline",
                    }}>
                      <span style={{
                        fontWeight: 600, color: "#0c1830", fontSize: "0.88rem",
                        // Never nowrap+ellipsis on operator-supplied names —
                        // it collapsed similar-prefix items into identical rows.
                        display: "-webkit-box", WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical", overflow: "hidden",
                      }}>{r.label}</span>
                      <span style={{
                        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
                        fontVariantNumeric: "tabular-nums", fontWeight: 600,
                        color: Number(r.amount) < 0 ? "#c62828" : "#0c1830",
                        whiteSpace: "nowrap",
                      }}>{money(r.amount)}</span>
                    </div>
                    <div style={{
                      marginTop: "0.25rem", color: "#69788f", fontSize: "0.76rem",
                      display: "flex", gap: "0.6rem", flexWrap: "wrap",
                    }}>
                      {r.sub && <span>{r.sub}</span>}
                      {r.secondary != null && (
                        <span>{r.secondaryLabel || "Also"}: {num(r.secondary)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#69788f" }}>
                    <th style={th}>Item</th>
                    <th style={th}>Detail</th>
                    <th style={{ ...th, textAlign: "right" }}>
                      {rows.some(r => r.secondaryLabel) ? rows.find(r => r.secondaryLabel).secondaryLabel : ""}
                    </th>
                    <th style={{ ...th, textAlign: "right" }}>{data?.amountLabel || "Amount"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id ?? i} style={{ background: r.flagged ? "#fff8f5" : undefined }}>
                      <td style={{ ...td, fontWeight: 600, color: "#0c1830" }}>
                        <span style={{
                          display: "-webkit-box", WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical", overflow: "hidden",
                        }}>{r.label}</span>
                      </td>
                      <td style={{ ...td, color: "#69788f" }}>{r.sub || "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: "#69788f", ...mono }}>
                        {r.secondary != null ? num(r.secondary) : "—"}
                      </td>
                      <td style={{
                        ...td, textAlign: "right", fontWeight: 600, ...mono,
                        color: Number(r.amount) < 0 ? "#c62828" : "#0c1830",
                      }}>{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>

        {/* The reconciliation, stated rather than assumed. */}
        {!loading && !error && rows.length > 0 && (
          <div style={{
            padding: "0.8rem 1.25rem", borderTop: "1px solid #e6ecf4",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            gap: "0.75rem", flexWrap: "wrap", flexShrink: 0,
            background: reconciles ? "#f7fbf8" : "#fff5f5",
          }}>
            <span style={{
              display: "flex", alignItems: "center", gap: "0.4rem",
              color: reconciles ? "#2e7d32" : "#c62828", fontSize: "0.8rem",
            }}>
              {!reconciles && <MdWarningAmber size={16} />}
              {reconciles
                ? `${rows.length} row${rows.length === 1 ? "" : "s"}, adding up to the card`
                : "These rows do not add up to the card — please report this"}
            </span>
            <span style={{
              fontWeight: 700, fontSize: "0.95rem", ...mono,
              color: rowSum < 0 ? "#c62828" : "#0c1830",
            }}>Rs. {money(rowSum)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const mono = {
  fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontVariantNumeric: "tabular-nums",
};
const th = { padding: "0.4rem 0.5rem", borderBottom: "1px solid #e6ecf4", fontWeight: 600, fontSize: "0.76rem", textTransform: "uppercase", letterSpacing: "0.06em" };
const td = { padding: "0.5rem", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
