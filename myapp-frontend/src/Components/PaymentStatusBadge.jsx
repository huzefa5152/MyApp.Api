import { MdCheckCircle, MdSchedule, MdWarningAmber, MdRadioButtonUnchecked } from "react-icons/md";

// Payment-status pill for the Invoice / Bill and Purchase Bill list screens.
// Purely presentational — the CALLER gates rendering on the
// `accounting.paymentstatus.view` permission (a user without it must see no
// badge at all). Status strings come from the server
// (PaymentStatusCalculator): Paid / PartiallyPaid / Overdue / Unpaid.
const MAP = {
  Paid:          { bg: "#e8f5e9", color: "#2e7d32", border: "#a5d6a7", label: "Paid",      Icon: MdCheckCircle },
  PartiallyPaid: { bg: "#e3f2fd", color: "#1565c0", border: "#90caf9", label: "Partial",   Icon: MdSchedule },
  Overdue:       { bg: "#ffebee", color: "#c62828", border: "#ef9a9a", label: "Overdue",   Icon: MdWarningAmber },
  Unpaid:        { bg: "#eceff1", color: "#546e7a", border: "#b0bec5", label: "Unpaid",     Icon: MdRadioButtonUnchecked },
};

const money = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * @param {string} status       "Paid" | "PartiallyPaid" | "Overdue" | "Unpaid"
 * @param {number} balanceDue   remaining balance (shown in the tooltip / label)
 * @param {number} daysOverdue  whole days past due (appended when Overdue)
 * @param {boolean} showBalance when true, appends "· Rs N" for a non-zero balance
 */
export default function PaymentStatusBadge({ status, balanceDue = 0, daysOverdue = 0, showBalance = true }) {
  const s = MAP[status] || MAP.Unpaid;
  const { Icon } = s;
  const bal = Number(balanceDue || 0);
  const label =
    status === "Overdue" && daysOverdue > 0 ? `Overdue ${daysOverdue}d` : s.label;
  const title =
    status === "Paid"
      ? "Paid in full"
      : bal > 0
        ? `Balance due: Rs ${money(bal)}${status === "Overdue" && daysOverdue > 0 ? ` · ${daysOverdue} day(s) overdue` : ""}`
        : s.label;

  return (
    <div
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "0.35rem 0.7rem", borderRadius: 8,
        background: s.bg, color: s.color, border: `1px solid ${s.border}`,
        fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap",
      }}
      title={title}
    >
      <Icon size={14} color={s.color} />
      <span>{label}</span>
      {showBalance && bal > 0 && status !== "Paid" && (
        <span style={{ fontWeight: 600, opacity: 0.85 }}>· Rs {money(bal)}</span>
      )}
    </div>
  );
}
