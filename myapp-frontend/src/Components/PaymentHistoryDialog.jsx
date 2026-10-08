import { useState, useEffect } from "react";
import { MdClose, MdReceiptLong } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import StatusBadge from "./StatusBadge";
import { getPaymentsForInvoice, getPaymentsForBill } from "../api/paymentApi";
import { StatGrid, StatCard, TableWrap, Loading, EmptyState } from "../ui/Kit";

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
  const total = isReceipt
    ? (doc.commercialTotal ?? ((Number(doc.grandTotal) || 0) + (Number(doc.freightCharges) || 0)))
    : doc.grandTotal;
  const collectible = isReceipt
    ? (doc.collectible ?? Math.max(0, total - (Number(doc.withholdingTaxAmount) || 0)))
    : doc.grandTotal;
  const balanceDue = isReceipt
    ? (doc.balanceDue ?? Math.max(0, collectible - (doc.amountPaid || 0)))
    : doc.balanceDue;

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
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>{noun}s for {docLabel} #{doc.number}</h5>
          <button data-admin-close="" style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>

        <div data-admin-body="" style={formStyles.body}>
          {/* Summary: total / paid / balance + status */}
          <StatGrid>
            <StatCard tone="blue" label="Total" value={money(doc.grandTotal)} />
            <StatCard tone="teal" label={isReceipt ? "Received" : "Paid"}
              value={<span style={{ color: colors.teal }}>{money(doc.amountPaid)}</span>} />
            <StatCard tone={(doc.balanceDue || 0) > 0 ? "red" : "slate"} label="Balance due"
              value={<span style={{ color: (doc.balanceDue || 0) > 0 ? "var(--k-danger)" : undefined }}>{money(doc.balanceDue)}</span>} />
            <StatCard tone="slate" label="Status" value={paymentStatusBadge(doc.paymentStatus, doc.daysOverdue)} />
          </StatGrid>

          {loading ? (
            <Loading>Loading…</Loading>
          ) : rows.length === 0 ? (
            <EmptyState icon={MdReceiptLong}>No {noun.toLowerCase()}s recorded against this {docLabel.toLowerCase()} yet.</EmptyState>
          ) : (
            <TableWrap data-admin-table-region="">
              <table className="k-table">
                <thead>
                  <tr>
                    <th>{noun} #</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Bank / Cash</th>
                    <th className="k-num">Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} style={{ opacity: p.isCancelled ? 0.5 : 1 }}>
                      <td>
                        <strong>{p.reference}</strong>
                        {p.isCancelled && <span style={{ marginLeft: 6, color: "var(--k-danger)", fontSize: "0.7rem", fontWeight: 700 }}>VOID</span>}
                        {p.isPostDated && <span style={{ marginLeft: 6, color: "#b26a00", fontSize: "0.7rem", fontWeight: 700 }}>PDC</span>}
                      </td>
                      <td>{p.date ? new Date(p.date).toLocaleDateString() : "—"}</td>
                      <td>{p.method}{p.chequeNumber ? ` · ${p.chequeNumber}` : ""}</td>
                      <td>{p.bankAccountName || "—"}</td>
                      <td className="k-num" style={{ fontWeight: 600 }}>{money(appliedToDoc(p))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </div>

        <div data-admin-footer="" style={formStyles.footer}>
          <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
