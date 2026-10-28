import { MdBlock, MdUndo } from "react-icons/md";
import DataTable from "./DataTable";
import TaxRateBadge from "./TaxRateBadge";
import { documentReference } from "../utils/invoiceReference";
import { colors } from "../theme";

// No per-document payment status column (2026-09-03) — see the note in
// InvoicePage.jsx. Receipts are taken on account, so the pill described the
// allocation rather than the customer.

export default function InvoiceTable({
  invoices,
  // Note tabs — rows are Credit Notes or Debit Notes in their own
  // numbering sequences; number column reads "Credit Note # / Debit Note #".
  isReturnsMode = false,
  noteDocType = null,
  perms,
  // The FBR chip and the action bar come from the page (utils/invoiceActions),
  // so the table and the cards offer the same actions in the same words.
  renderFbr,
  renderActions,
  onShowPayments,
}) {
  const columns = [
    {
      key: "invoiceNumber",
      header: isReturnsMode ? (noteDocType === 10 ? "Credit Note #" : "Debit Note #") : "Invoice #",
      width: 130,
      accessor: (i) => Number(i.invoiceNumber) || i.invoiceNumber,
      render: (i) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <strong>{i.invoiceNumber}</strong>
          {/* The company's own prefix ("PTC-52") — the reference on the
              customer's copy. Suppressed when it adds nothing (see
              documentReference), so a company with no prefix set reads
              exactly as it does today. */}
          {documentReference(i) && (
            <span
              style={{ fontFamily: "monospace", fontSize: "0.7rem", lineHeight: 1.2, color: colors.textSecondary }}
              title="Invoice reference (company prefix + number)"
            >
              {documentReference(i)}
            </span>
          )}
          {(i.documentType === 9 || i.documentType === 10) && (
            <span
              style={{
                fontSize: 10, fontWeight: 700, lineHeight: 1.2,
                color: i.documentType === 10 ? colors.violet : colors.tealDark,
              }}
              title={i.originalInvoiceNumber ? `Against bill #${i.originalInvoiceNumber}${i.originalInvoiceRefIRN ? ` (IRN ${i.originalInvoiceRefIRN})` : ""}` : undefined}
            >
              {i.documentType === 10 ? "CREDIT NOTE" : "DEBIT NOTE"}
              {i.originalInvoiceNumber ? ` ↩ #${i.originalInvoiceNumber}` : ""}
            </span>
          )}
          {i.documentType !== 9 && i.documentType !== 10 && i.fbrCancelledAt && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 3, alignSelf: "flex-start",
                fontSize: 10, fontWeight: 700, lineHeight: 1.2, padding: "2px 6px",
                borderRadius: 6, background: colors.errorSoft, color: colors.error, border: `1px solid ${colors.errorLine}`,
              }}
              title={`Cancelled on the FBR portal on ${new Date(i.fbrCancelledAt).toLocaleDateString()}`
                + (i.fbrCancelledReason ? ` — ${i.fbrCancelledReason}` : "")
                + ". The bill keeps its number and IRN but no longer counts as a sale."}
            >
              <MdBlock size={11} /> FBR CANCELLED
            </span>
          )}
          {i.documentType !== 9 && i.documentType !== 10 && i.reversedByCreditNoteNumber && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 3, alignSelf: "flex-start",
                fontSize: 10, fontWeight: 700, lineHeight: 1.2, padding: "2px 6px",
                borderRadius: 6, background: colors.violetSoft, color: colors.violet, border: `1px solid ${colors.violetLine}`,
              }}
              title={`A Credit Note (#${i.reversedByCreditNoteNumber}) has been created against this invoice — it reverses this sale.`}
            >
              <MdUndo size={11} /> REVERSED · CN #{i.reversedByCreditNoteNumber}
            </span>
          )}
          {i.documentType !== 9 && i.documentType !== 10 && i.adjustedByDebitNoteNumber && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 3, alignSelf: "flex-start",
                fontSize: 10, fontWeight: 700, lineHeight: 1.2, padding: "2px 6px",
                borderRadius: 6, background: colors.tealSoft, color: colors.tealDark, border: `1px solid ${colors.tealLine}`,
              }}
              title={`A Debit Note (#${i.adjustedByDebitNoteNumber}) adjusts this invoice upward.`}
            >
              <MdUndo size={11} /> ADJUSTED · DN #{i.adjustedByDebitNoteNumber}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "clientName",
      header: "Client",
      // A floor on the width so a long buyer name reads on two lines, not
      // three or four squeezed beside empty columns.
      render: (i) => (
        <span style={{ display: "block", minWidth: 115 }}>
          {i.clientName || "—"}
          {i.divisionName && <span style={divisionChip}>{i.divisionName}</span>}
        </span>
      ),
    },
    // Returns tab only: which invoice the note reverses + the FBR reason.
    ...(isReturnsMode ? [{
      key: "against",
      header: "Against / Reason",
      render: (i) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            Bill #{i.originalInvoiceNumber ?? "—"}
          </div>
          <div style={{ fontSize: "0.75rem", color: colors.textSecondary }} title={i.noteReasonRemarks || undefined}>
            {i.noteReason || "—"}
          </div>
        </div>
      ),
    }] : []),
    {
      key: "poNumber",
      header: "PO",
      defaultHidden: true,
      render: (i) => i.poNumber || "—",
    },
    {
      key: "indentNo",
      header: "Indent",
      defaultHidden: true,
      render: (i) => i.indentNo || "—",
    },
    {
      key: "challanNumbers",
      header: "DC #",
      // Most importer invoices have no challan; the column is one click away
      // under Columns for those that do.
      defaultHidden: true,
      width: 120,
      accessor: (i) => (i.challanNumbers || []).join(","),
      render: (i) => (i.challanNumbers && i.challanNumbers.length > 0
        ? `#${i.challanNumbers.join(", #")}`
        : "—"),
    },
    {
      key: "date",
      header: "Date",
      width: 110,
      accessor: (i) => i.date ? new Date(i.date).getTime() : 0,
      render: (i) => i.date ? new Date(i.date).toLocaleDateString() : "—",
    },
    {
      key: "items",
      header: "Lines",
      width: 70,
      align: "right",
      accessor: (i) => i.items?.length || 0,
      render: (i) => i.items?.length || 0,
    },
    {
      key: "grandTotal",
      header: "Grand Total",
      width: 140,
      align: "right",
      accessor: (i) => i.grandTotal || 0,
      render: (i) => `Rs. ${(i.grandTotal ?? 0).toLocaleString()}`,
    },
    {
      key: "balanceDue",
      header: "Balance Due",
      width: 130,
      align: "right",
      accessor: (i) => i.balanceDue ?? 0,
      render: (i) => `Rs. ${(i.balanceDue ?? 0).toLocaleString()}`,
    },
    {
      key: "receipts",
      header: "Receipts",
      width: 100,
      accessor: () => "",
      render: (i) => (perms.canViewReceipts && onShowPayments && !i.isCancelled) ? (
        <button type="button" onClick={() => onShowPayments(i)} title="What has been applied to this document"
          style={{ all: "unset", cursor: "pointer", color: colors.blue, fontWeight: 700, fontSize: "0.78rem" }}>
          View
        </button>
      ) : "—",
    },
    {
      key: "dueDate",
      header: "Due Date",
      width: 110,
      defaultHidden: true,
      accessor: (i) => i.dueDate ? new Date(i.dueDate).getTime() : 0,
      render: (i) => i.dueDate ? new Date(i.dueDate).toLocaleDateString() : "—",
    },
    {
      key: "fbrStatus",
      header: "FBR Status",
      width: 140,
      accessor: (i) => i.fbrStatus || "",
      // The rate check sits beside the filing status: a rate conflict is what
      // the person about to file needs to see.
      render: (i) => (
        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          {renderFbr?.(i)}
          <TaxRateBadge inv={i} />
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={invoices}
      rowKey={(i) => i.id}
      actions={renderActions}
      quickSearchPlaceholder="Quick filter visible rows..."
      storageKey="invoices"
      emptyMessage="No invoices on this page."
    />
  );
}

// Same chip ChallanTable uses — wraps with the client name, no
// nowrap/ellipsis, so long division names never mask each other.
const divisionChip = {
  display: "inline-block",
  marginLeft: 6,
  fontSize: "0.7rem",
  fontWeight: 700,
  color: colors.blue,
  background: colors.infoSoft,
  padding: "0.1rem 0.5rem",
  borderRadius: 6,
};

