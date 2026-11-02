import { useState } from "react";
import { MdExpandMore, MdExpandLess } from "react-icons/md";
import useIsNarrow from "../../hooks/useIsNarrow";
import DataTable from "../DataTable";
import { fbrTone, fmtDay, fmtQty, fmtRate } from "../../utils/invoiceSalesDetail";
import "./InvoiceSalesDetailGrid.css";

const money = n => Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The standard bill register, with full original line detail revealed inline.
 *  The page owns scrolling; the workbook keeps its separate, unchanged layout. */
export default function InvoiceSalesDetailGrid({ report, bills, allBillCount, loading = false, emptyText }) {
  const compact = useIsNarrow(1280);
  const [openId, setOpenId] = useState(null);
  const toggle = bill => setOpenId(id => id === bill.invoiceId ? null : bill.invoiceId);
  const action = bill => <button className="isd-detail-button" type="button" aria-label={`${openId === bill.invoiceId ? "Hide items" : `View ${bill.lines.length} ${bill.lines.length === 1 ? "item" : "items"}`} for bill ${bill.first.invoiceNumber}`} aria-expanded={openId === bill.invoiceId} aria-controls={`isd-detail-${bill.invoiceId}`} onClick={() => toggle(bill)}>
    {openId === bill.invoiceId ? <MdExpandLess aria-hidden="true" /> : <MdExpandMore aria-hidden="true" />}
    {openId === bill.invoiceId ? "Hide items" : `View ${bill.lines.length} ${bill.lines.length === 1 ? "item" : "items"}`}
    <span className="isd-sr"> for bill {bill.first.invoiceNumber}</span>
  </button>;
  const detail = bill => openId === bill.invoiceId ? <BillDetail bill={bill} compact={compact} /> : null;
  const columns = [
    { key: "bill", header: "Bill / date", width: "16%", hideable: false, accessor: b => Number(b.first.invoiceNumber), render: b => <div className="isd-cell-stack"><strong className="isd-reference">#{b.first.invoiceNumber}</strong><span className="isd-muted">{fmtDay(b.first.date)}</span><span className="isd-muted">{b.lines.length} {b.lines.length === 1 ? "item" : "items"}</span></div> },
    { key: "buyer", header: "Client", width: "27%", hideable: false, accessor: b => b.first.buyer, render: b => <div className="isd-cell-stack"><strong>{b.first.buyer}</strong>{b.first.buyerNtn && <span className="isd-muted">NTN {b.first.buyerNtn}</span>}{b.first.deliveryChallanNumbers && <span className="isd-muted">DC {b.first.deliveryChallanNumbers}</span>}</div> },
    { key: "excl", header: "Excl. tax", align: "right", width: "15%", accessor: b => b.totals.excl, render: b => money(b.totals.excl) },
    { key: "gst", header: "GST", align: "right", width: "13%", accessor: b => b.totals.gst, render: b => money(b.totals.gst) },
    { key: "total", header: "Total", align: "right", width: "16%", hideable: false, accessor: b => b.totals.total, render: b => <strong className="isd-reference">{money(b.totals.total)}</strong> },
    { key: "status", header: "FBR status", width: "13%", accessor: b => b.first.fbrStatus, render: b => <Status bill={b} /> },
  ];
  if (!bills.length) return <div className="isd-empty" role="status">{emptyText}</div>;
  return <section className="isd-register" aria-label="Invoice sales bill register" aria-busy={loading}>
    <div className="isd-register-heading"><div><h3>Bill register</h3><p>Open a bill to review its original items and tax details.</p></div><span>{bills.length} of {allBillCount} bills · {report.rows.length} lines in this report</span></div>
    {compact ? <div className="isd-bill-cards">{bills.map(bill => <article key={bill.invoiceId} className="isd-bill-card">
      <header><div className="isd-cell-stack"><strong className="isd-reference">Bill #{bill.first.invoiceNumber}</strong><span className="isd-muted">{fmtDay(bill.first.date)}</span></div><Status bill={bill} /></header>
      <h4>{bill.first.buyer}</h4><p className="isd-muted">{[bill.first.buyerNtn && `NTN ${bill.first.buyerNtn}`, bill.first.deliveryChallanNumbers && `DC ${bill.first.deliveryChallanNumbers}`].filter(Boolean).join(" · ")}</p>
      <div className="isd-money-grid"><Figure label="Excl. tax" value={bill.totals.excl} /><Figure label="GST" value={bill.totals.gst} /><Figure label="Total" value={bill.totals.total} strong /></div>
      <div className="isd-card-action">{action(bill)}</div>{detail(bill)}
    </article>)}</div> : <DataTable columns={columns} rows={bills} rowKey={b => b.invoiceId} actions={action} actionsHeader="Details" pageScroll renderExpandedRow={detail} storageKey="invoice-sales-detail-register-v2" />}
  </section>;
}

function Status({ bill }) {
  return <div className="isd-status-stack"><span className={`isd-status isd-status--${fbrTone(bill.first.fbrStatus)}`}>{bill.first.fbrStatus}</span>{bill.cancelled && <span className="isd-status isd-status--bad">Bill cancelled</span>}</div>;
}
function BillDetail({ bill, compact }) {
  const first = bill.first;
  const freight = bill.lines.reduce((sum, r) => sum + Number(r.freightCharges || 0), 0);
  return <section id={`isd-detail-${bill.invoiceId}`} aria-label={`Bill ${first.invoiceNumber} original items`} className="isd-detail">
    <div className="isd-detail-heading"><h4>Bill #{first.invoiceNumber} · Original items</h4><span>{bill.lines.length} {bill.lines.length === 1 ? "line" : "lines"}</span></div>
    <dl className="isd-metadata"><Meta label="Client" value={first.buyer} /><Meta label="Address" value={first.buyerAddress} /><Meta label="NTN" value={first.buyerNtn} /><Meta label="Delivery challan" value={first.deliveryChallanNumbers} /><Meta label="FBR invoice number" value={first.fbrInvoiceNumber} /><Meta label="Bill status" value={first.billStatus} /></dl>
    {compact ? <ol className="isd-line-cards">{bill.lines.map(line => <li key={line.lineNumber}>
      <div className="isd-line-heading"><strong>{line.description || "Description unavailable"}</strong><strong>{money(line.total)}</strong></div>
      <div className="isd-line-meta">{fmtQty(line.quantity)} {line.unit} × {money(line.rate)}{line.hsCode && <span> · HS {line.hsCode}</span>}</div>
      <div className="isd-line-money"><span>Excl. tax {money(line.excludingTax)}</span><span>GST ({fmtRate(line.taxRate)}) {money(line.salesTax)}</span>{Number(line.furtherTax || 0) !== 0 && <span>Further tax {money(line.furtherTax)}</span>}{Number(line.freightCharges || 0) !== 0 && <span>Freight {money(line.freightCharges)}</span>}</div>
    </li>)}</ol> : <table className="isd-lines-table"><caption className="isd-sr">Original line items for bill {first.invoiceNumber}</caption><thead><tr><th>Item / HS code</th><th>Qty / unit</th><th>Rate</th><th>Excl. tax</th><th>GST</th><th>Total</th></tr></thead><tbody>{bill.lines.map(line => <tr key={line.lineNumber}>
      <td><strong>{line.description || "Description unavailable"}</strong><div className="isd-muted">{line.hsCode ? `HS ${line.hsCode}` : "HS code not selected"}</div></td><td>{fmtQty(line.quantity)} {line.unit}</td><td>{money(line.rate)}</td><td>{money(line.excludingTax)}</td><td>{money(line.salesTax)}<div className="isd-muted">{fmtRate(line.taxRate)}</div></td><td><strong>{money(line.total)}</strong>{Number(line.furtherTax || 0) !== 0 && <div className="isd-muted">Further {money(line.furtherTax)}</div>}{Number(line.freightCharges || 0) !== 0 && <div className="isd-muted">Freight {money(line.freightCharges)}</div>}</td>
    </tr>)}</tbody></table>}
    <div className="isd-detail-totals"><Figure label="Excl. tax" value={bill.totals.excl} /><Figure label="GST" value={bill.totals.gst} />{bill.totals.further !== 0 && <Figure label="Further tax" value={bill.totals.further} />}{freight !== 0 && <Figure label="Freight" value={freight} />}<Figure label="Bill total" value={bill.totals.total} strong /></div>
  </section>;
}
function Meta({ label, value }) { return <div><dt>{label}</dt><dd>{value || "—"}</dd></div>; }
function Figure({ label, value, strong = false }) { return <div className="isd-figure"><span>{label}</span><strong className={strong ? "isd-reference" : undefined}>{money(value)}</strong></div>; }
