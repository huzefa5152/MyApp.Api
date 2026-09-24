import { billColors } from "./billTheme";

const money = (n) => `Rs. ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/**
 * The bill's totals, the same panel on create, edit and view. Rows come from
 * utils/billEntry.billTotalsRows with the amounts the screen already worked
 * out; each row says where its figure comes from, so "GST (25%)" is never a
 * mystery number to the person typing the bill. A row may carry `sign`
 * ("−" / "+") where the screen shows a deduction or an addition.
 */
export default function BillTotals({ rows = [] }) {
  return (
    <div
      style={{
        marginLeft: "auto", width: "100%", maxWidth: 480, padding: "0.75rem 0.9rem",
        border: `1px solid ${billColors.cardBorder}`, borderRadius: 10, backgroundColor: billColors.inputBg,
      }}
    >
      {rows.map((r) => (
        <div
          key={r.key}
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem",
            padding: r.strong ? "0.5rem 0 0.35rem" : "0.3rem 0",
            borderTop: r.strong ? `2px solid ${billColors.textPrimary}` : "none",
            marginTop: r.strong ? "0.25rem" : 0,
          }}
        >
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block", fontSize: r.strong ? "0.98rem" : "0.88rem",
                fontWeight: r.strong ? 800 : 600, color: billColors.textPrimary,
              }}
            >
              {r.label}
            </span>
            {r.note && (
              <span style={{ display: "block", fontSize: "0.72rem", color: billColors.textSecondary, lineHeight: 1.35 }}>
                {r.note}
              </span>
            )}
          </span>
          <span
            style={{
              flexShrink: 0, fontVariantNumeric: "tabular-nums",
              fontSize: r.strong ? "1.02rem" : "0.9rem", fontWeight: r.strong ? 800 : 600,
              color: billColors.textPrimary,
            }}
          >
            {r.sign ? `${r.sign} ` : ""}{money(r.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}
