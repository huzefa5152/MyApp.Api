import { useState, useEffect } from "react";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import StatusBadge from "./StatusBadge";
import { getPaymentsForInvoice, getPaymentsForBill } from "../api/paymentApi";

const money = (n) => `Rs ${(Number(n) || 0).toLocaleString()}`;

function paymentStatusBadge(status, daysOverdue) {
  if (status === "Paid") return <StatusBadge tone="success">Paid</StatusBadge>;
  if (status === "Overdue") return <StatusBadge tone="danger">Overdue{daysOverdue ? ` ${daysOverdue}d` : ""}</StatusBadge>;
  if (status === "PartiallyPaid") return <StatusBadge tone="info">Partial</StatusBadge>;
  return <StatusBadge tone="neutral">Unpaid</StatusBadge>;
}

/**
 * Read-only history of the receipts (sales invoice) or payments (purchase bill)
 * applied to a single document, with the running total / amount paid / balance.
 * mode = "receipts" (invoice) | "payments" (bill). `doc` carries the summary
 * numbers already computed server-side (grandTotal / amountPaid / balanceDue /
 * paymentStatus) so the header is correct even before the rows load.
 */
export default function PaymentHistoryDialog({ mode, companyId, doc, onClose }) {
  const isReceipt = mode === "receipts";
  const noun = isReceipt ? "Receipt" : "Payment";
  const docLabel = isReceipt ? "Invoice" : "Bill";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetcher = isReceipt
      ? getPaymentsForInvoice(companyId, doc.id)
      : getPaymentsForBill(companyId, doc.id);
    fetcher
      .then(({ data }) => { if (!cancelled) setRows(data || []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, doc.id, isReceipt]);

  // Amount of a payment actually applied to THIS document (a single payment can
  // settle several documents — show only this document's slice).
  const appliedToDoc = (p) =>
    (p.allocations || [])
      .filter((a) => (isReceipt ? a.invoiceId === doc.id : a.purchaseBillId === doc.id))
      .reduce((s, a) => s + (a.amount || 0), 0);

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{noun}s for {docLabel} #{doc.number}</h5>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>

        <div style={formStyles.body}>
          {/* Summary: total / paid / balance + status */}
          <div style={summaryGrid}>
            <div style={summaryCell}>
              <span style={summaryLabel}>Total</span>
              <span style={summaryValue}>{money(doc.grandTotal)}</span>
            </div>
            <div style={summaryCell}>
              <span style={summaryLabel}>{isReceipt ? "Received" : "Paid"}</span>
              <span style={{ ...summaryValue, color: colors.teal }}>{money(doc.amountPaid)}</span>
            </div>
            <div style={summaryCell}>
              <span style={summaryLabel}>Balance due</span>
              <span style={{ ...summaryValue, color: (doc.balanceDue || 0) > 0 ? "#c62828" : colors.textPrimary }}>{money(doc.balanceDue)}</span>
            </div>
            <div style={{ ...summaryCell, alignItems: "flex-start", justifyContent: "center" }}>
              <span style={summaryLabel}>Status</span>
              {paymentStatusBadge(doc.paymentStatus, doc.daysOverdue)}
            </div>
          </div>

          {loading ? (
            <div style={hintBox}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={hintBox}>No {noun.toLowerCase()}s recorded against this {docLabel.toLowerCase()} yet.</div>
          ) : (
            <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
              <table style={tbl}>
                <thead>
                  <tr>
                    <th style={th}>{noun} #</th>
                    <th style={th}>Date</th>
                    <th style={th}>Method</th>
                    <th style={th}>Bank / Cash</th>
                    <th style={{ ...th, textAlign: "right" }}>Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} style={{ opacity: p.isCancelled ? 0.5 : 1 }}>
                      <td style={td}>
                        <strong>{p.reference}</strong>
                        {p.isCancelled && <span style={{ marginLeft: 6, color: "#c62828", fontSize: "0.7rem", fontWeight: 700 }}>VOID</span>}
                        {p.isPostDated && <span style={{ marginLeft: 6, color: "#b26a00", fontSize: "0.7rem", fontWeight: 700 }}>PDC</span>}
                      </td>
                      <td style={td}>{p.date ? new Date(p.date).toLocaleDateString() : "—"}</td>
                      <td style={td}>{p.method}{p.chequeNumber ? ` · ${p.chequeNumber}` : ""}</td>
                      <td style={td}>{p.bankAccountName || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money(appliedToDoc(p))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const summaryGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(130px, 100%), 1fr))", gap: "0.5rem", marginBottom: "0.5rem" };
const summaryCell = { display: "flex", flexDirection: "column", gap: 2, padding: "0.6rem 0.75rem", background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 8 };
const summaryLabel = { fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary };
const summaryValue = { fontSize: "1.05rem", fontWeight: 800, color: colors.textPrimary };
const hintBox = { padding: "0.9rem", background: colors.inputBg, border: `1px dashed ${colors.inputBorder}`, borderRadius: 8, color: colors.textSecondary, fontSize: "0.85rem", marginTop: "0.5rem" };
const tbl = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const th = { textAlign: "left", padding: "0.4rem 0.5rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textSecondary, fontWeight: 700, whiteSpace: "nowrap" };
const td = { padding: "0.4rem 0.5rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textPrimary };
