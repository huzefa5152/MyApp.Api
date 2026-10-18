import DocumentNotesEditor from "./DocumentNotesEditor";
import { money } from "../utils/taxFilingRows";

export default function InvoiceDocumentView({ bill, rows, requiresReview }) {
  const subtotal = rows.reduce((sum, row) => sum + Number(row.valueExclTax || 0), 0);
  const gst = Number(bill.gstAmount || 0);
  const furtherTax = Number(bill.furtherTaxAmount || 0);
  return <div className="invoice-document">
    <div className="invoice-document-context">
      <strong>{bill.companyName}</strong>
      <span><b>Client:</b> {bill.clientName || "—"}</span>
      <span><b>Date:</b> {bill.date ? new Date(bill.date).toLocaleDateString() : "—"}</span>
      {!!bill.challanNumbers?.length && <span><b>Challans:</b> {bill.challanNumbers.join(", ")}</span>}
      {[["PO", bill.poNumber], ["Indent", bill.indentNo], ["Site", bill.site], ["FBR status", bill.fbrStatus], ["IRN", bill.fbrIRN]].filter(([, value]) => value).map(([label, value]) => <span key={label}><b>{label}:</b> {value}</span>)}
    </div>
    {requiresReview && <p className="tf-warning">The bill changed after its last review. These filing lines need review before FBR validation or submission.</p>}
    <h3>Invoice items <small>({rows.length})</small></h3>
    <div className="invoice-document-lines" role="table" aria-label="Invoice items">
      <div className="invoice-document-line invoice-document-head" role="row">{["Description", "HS code", "Quantity / unit", "Rate (Rs.)", "Amount (Rs.)"].map(label => <b role="columnheader" key={label}>{label}</b>)}</div>
      {rows.map((row, index) => <div className="invoice-document-line" role="row" key={index}>
        <span role="cell" data-label="Description"><span>{row.description || "Unclassified supply"}
          {row.saleType && <small style={{display:"block", color:"#5f6d7e"}}>{row.saleType}</small>}
          {!!row.sourceLineIds?.length && <details><summary>Original bill lines ({row.sourceLineIds.length})</summary>{(bill.items || []).filter(item => row.sourceLineIds.includes(item.id)).map(item => <p key={item.id}>{item.description || item.itemTypeName} · {item.quantity} {item.uom} · Rs. {money(item.lineTotal)}</p>)}</details>}
        </span></span>
        <span role="cell" data-label="HS code">{row.hsCode || "—"}</span>
        <span role="cell" data-label="Quantity / unit">{row.quantity} {row.uom || "—"}</span>
        <span role="cell" data-label="Rate (Rs.)">{money(Number(row.quantity) > 0 ? Number(row.valueExclTax) / Number(row.quantity) : 0)}</span>
        <strong role="cell" data-label="Amount (Rs.)">{money(row.valueExclTax)}</strong>
      </div>)}
    </div>
    <div className="invoice-document-totals">{[["Subtotal", subtotal], ["GST", gst], ["Further tax", furtherTax], ["Grand total", subtotal + gst + furtherTax]].map(([label, value]) => <div key={label}><span>{label}</span><strong>Rs. {money(value)}</strong></div>)}</div>
    {bill.notes && <DocumentNotesEditor value={bill.notes} readOnly />}
  </div>;
}
