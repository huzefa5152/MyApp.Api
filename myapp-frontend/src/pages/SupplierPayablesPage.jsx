import PurchaseDebitNoteForm from "../Components/PurchaseDebitNoteForm";
import { useEffect, useRef, useState } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { supplierSummary, supplierLedger } from "../api/commercialCostApi";
import { getPaymentById } from "../api/paymentApi";
import CommercialCostDialog from "../Components/CommercialCostDialog";
import PurchaseBillForm from "../Components/PurchaseBillForm";
import PaymentForm from "../Components/PaymentForm";
import { formStyles } from "../theme";
import { todayYmd } from "../utils/dateInput";
import { MdMenuBook, MdPayments, MdShoppingCart, MdAccountBalanceWallet } from "react-icons/md";
import "../Components/CommercialCosts.css";
import "./SupplierPayablesPage.css";

const money = n => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const stateFor = p => p.outstanding <= 0 ? "paid" : p.cashPaid + p.creditAmount + p.adjustment > 0 ? "partial" : "unpaid";
const stateLabel = { paid: "Settled", partial: "Partially settled", unpaid: "Unpaid" };

export default function SupplierPayablesPage() {
  const { selectedCompany, companies, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const [summary, setSummary] = useState([]);
  const [ledger, setLedger] = useState(null);
  const [supplierId, setSupplierId] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [asOf, setAsOf] = useState("");
  const [category, setCategory] = useState("");
  const [settlement, setSettlement] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const [transactionPurchase, setTransactionPurchase] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [bill, setBill] = useState(null);
  const [challanCost, setChallanCost] = useState(null);
  const [purchase, setPurchase] = useState(null);
  const [payment, setPayment] = useState(null);
  const [paymentDetail, setPaymentDetail] = useState(null);
  const [credit, setCredit] = useState(null);
  const [creditDetail, setCreditDetail] = useState(null);
  const [openingPayment, setOpeningPayment] = useState(false);
  const company = useRef(selectedCompany?.id);
  company.current = selectedCompany?.id;
  const history = useRef(null);
  const paymentDialog = useRef(null);
  useEffect(() => {
    setNotice(""); setSearch(""); setFrom(""); setOpeningPayment(false); setSupplierId(""); setLedger(null); setSummary([]); setBill(null); setChallanCost(null); setPurchase(null); setPayment(null); setCredit(null); setPaymentDetail(null); setCreditDetail(null); setTransactionPurchase(null);
  }, [selectedCompany?.id]);
  useEffect(() => { setCategory(""); setSettlement(""); setDocumentSearch(""); setTransactionPurchase(null); }, [supplierId]);
  useEffect(() => {
    let active = true;
    setLedger(null); setLoading(true); setError("");
    if (!selectedCompany?.id) { setSummary([]); setLoading(false); return; }
    if (from && asOf && from > asOf) { setError("Ledger start date must be on or before the balance date."); setLoading(false); return; }
    const params = { asOf: asOf || undefined, from: supplierId ? from || undefined : undefined };
    const query = supplierId ? supplierLedger(selectedCompany.id, supplierId, params) : supplierSummary(selectedCompany.id, params);
    query.then(({ data }) => { if (active) supplierId ? setLedger(data) : setSummary(data); })
      .catch(() => { if (active) { setSummary([]); setError("Could not load supplier balances. Please refresh to try again."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedCompany?.id, supplierId, from, asOf, revision]);
  useEffect(() => {
    if (!paymentDetail) return;
    const previous = document.activeElement;
    paymentDialog.current?.querySelector("button")?.focus();
    const key = e => {
      if (e.key === "Escape") setPaymentDetail(null);
      if (e.key !== "Tab") return;
      const controls = [...paymentDialog.current.querySelectorAll("button:not(:disabled),a[href]")];
      if (!controls.length) return;
      if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === controls.at(-1)) { e.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus?.(); };
  }, [paymentDetail]);
  const rows = summary.filter(s => s.supplierName.toLowerCase().includes(search.toLowerCase()));
  const purchases = ledger?.purchases.filter(p => (!category || p.category === category) && (!settlement || stateFor(p) === settlement) &&
    `${p.number} ${p.supplierBillNumber || ""} ${p.invoiceNumbers.join(" ")} ${p.challanNumbers.join(" ")}`.toLowerCase().includes(documentSearch.toLowerCase())) || [];
  const allPurchases = ledger?.purchases || [];
  const outstanding = sum(allPurchases, "outstanding");
  const unallocatedChange = Number(ledger?.netBalance || 0) - outstanding;
  const transactionRows = ledger?.rows.filter(r => !transactionPurchase || r.purchaseBillIds.includes(transactionPurchase.id)) || [];
  const openHistory = p => { setTransactionPurchase(p); setTimeout(() => { history.current?.scrollIntoView({ behavior: "smooth", block: "start" }); history.current?.focus(); }); };
  const openPayment = async (id, dir = "payments") => {
    const requestedCompany = company.current;
    setOpeningPayment(true); setError("");
    try {
      const { data } = await getPaymentById(dir, id);
      if (company.current === requestedCompany) setPaymentDetail({ ...data, dir });
    } catch { if (company.current === requestedCompany) setError("Could not open payment details. Please try again."); }
    finally { if (company.current === requestedCompany) setOpeningPayment(false); }
  };
  const sourceLinks = p => <div className="supplier-source-links">
    {p.invoiceIds.map((id, index) => has("bills.costs.view") ? <button className="supplier-link" key={`bill-${id}`} onClick={() => setBill(id)}>Customer bill #{p.invoiceNumbers[index] || id}</button> : <span key={id}>Customer bill #{p.invoiceNumbers[index] || id}</span>)}
    {p.challanIds.map((id, index) => has("bills.costs.view") ? <button className="supplier-link" key={`challan-${id}`} onClick={() => setChallanCost(id)}>Challan #{p.challanNumbers[index]}{!p.invoiceIds.length ? " · Not billed yet" : ""}</button> : <span key={`challan-${id}`}>Challan #{p.challanNumbers[index]}</span>)}
    {!p.invoiceIds.length && !p.challanIds.length && <small>No customer bill linked</small>}
  </div>;
  const actions = p => <div className="supplier-row-actions">
    {has("accounting.payments.create") && p.outstanding > 0 && <button className="supplier-primary" onClick={() => setPayment({ contactType: "Supplier", contactId: ledger.supplierId, documentId: p.id })}>Pay purchase</button>}
    <details><summary>Details</summary><div>
      {has("purchasebills.list.view") && <button className="supplier-button" onClick={() => setPurchase(p.id)}>View purchase</button>}
      <button className="supplier-button" onClick={() => openHistory(p)}>View transactions</button>
      {has("purchasedebitnotes.manage.create") && has("purchasebills.list.view") && <button className="supplier-button" onClick={() => setCredit({ supplierId: ledger.supplierId, purchaseBillId: p.id })}>Record supplier credit</button>}
    </div></details>
  </div>;
  const reference = row => {
    if (row.kind === "Purchase" && has("purchasebills.list.view")) return <button className="supplier-link" onClick={() => setPurchase(row.id)}>{row.reference}</button>;
    const dir = row.kind === "Supplier refund" ? "receipts" : "payments";
    if (["Payment", "Supplier refund"].includes(row.kind) && has(`accounting.${dir}.view`)) return <button className="supplier-link" disabled={openingPayment} onClick={() => openPayment(row.id, dir)}>{row.reference}</button>;
    if (row.kind === "Supplier credit" && has("purchasedebitnotes.list.view")) return <button className="supplier-link" onClick={() => setCreditDetail(row.id)}>{row.reference}</button>;
    return <span>{row.reference}</span>;
  };
  return <main className="supplier-payables">
    <header className="supplier-page-heading supplier-hero"><div className="supplier-hero-title"><span className="supplier-hero-icon"><MdMenuBook aria-hidden="true" /></span><div><h1>Supplier payables</h1><p>{selectedCompany?.name || "Select a company"} · Balances through {asOf || todayYmd()}</p></div></div>
      {supplierId && <button className="supplier-button" onClick={() => setSupplierId("")}>All suppliers</button>}
    </header>
    <div className="commercial-toolbar supplier-toolbar">
      {companies.length > 1 && <label>Company<select aria-label="Company" value={selectedCompany?.id || ""} onChange={e => setSelectedCompany(companies.find(c => c.id === Number(e.target.value)))}>{companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}</select></label>}
      {!supplierId && <label>Find supplier<input placeholder="Search by supplier name" value={search} onChange={e => setSearch(e.target.value)} /></label>}
      {supplierId && <label>Transactions from<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>}
      <label>Balance as of<input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} /></label>
      {(from || asOf) && <button className="supplier-button" onClick={() => { setFrom(""); setAsOf(""); }}>Reset dates</button>}
      <button className="supplier-button" disabled={loading} onClick={() => setRevision(n => n + 1)}>Refresh</button>
    </div>
    {notice && <p role="status" className="supplier-notice">{notice}</p>}
    {error && <p className="commercial-feedback" role="alert">{error}</p>}{loading && <p role="status">Loading supplier balances…</p>}
    {!loading && !error && !supplierId && <>
      <div className="supplier-metrics">
        <Metric label="Total payable" value={summary.reduce((s, r) => s + Math.max(0, r.netBalance), 0)} note="Amount still owed to suppliers" primary />
        <Metric label="Total paid to suppliers" value={sum(summary, "cashPaid")} note="Bill payments + advances, less refunds" />
        <Metric label="Total purchases" value={sum(summary, "purchases")} note="Payable value after withholding" />
        <Metric label="Supplier credit balances" value={summary.reduce((s, r) => s + Math.max(0, -r.netBalance), 0)} note="Balances in your favour; kept separate" />
      </div>
      <section className="supplier-panel" aria-labelledby="supplier-list-title"><div className="supplier-panel-heading"><h2 id="supplier-list-title">Suppliers</h2><span>{rows.length} of {summary.length} suppliers</span></div>
      <p className="supplier-hint">Totals cover all suppliers. Search narrows this list; open a ledger for purchases, payments and adjustments.</p>
      <table className="commercial-ledger-table supplier-table"><thead><tr><th>Supplier</th><th>Purchases</th><th>Paid</th><th>Credits / adjustments</th><th>Still payable</th><th /></tr></thead><tbody>{rows.map(s => <tr key={s.supplierId}><td><strong>{s.supplierName}</strong>{s.unappliedAdvances > 0 && <small>Advance balance Rs. {money(s.unappliedAdvances)}</small>}</td><td className="supplier-number">{money(s.purchases)}</td><td className="supplier-number">{money(s.cashPaid)}</td><td className="supplier-number">{money(s.totalCredits + s.otherSettlement)}</td><td className="supplier-number"><strong>{s.netBalance >= 0 ? `Rs. ${money(s.netBalance)}` : `Credit Rs. ${money(-s.netBalance)}`}</strong></td><td><button className="supplier-button" onClick={() => setSupplierId(s.supplierId)}>Open ledger</button></td></tr>)}</tbody></table>
      <div className="commercial-ledger-mobile supplier-mobile-list">{rows.map(s => <article key={s.supplierId}><h2>{s.supplierName}</h2><dl><Pair label="Purchases" value={s.purchases} /><Pair label="Paid" value={s.cashPaid} /><Pair label={s.netBalance >= 0 ? "Still payable" : "Credit balance"} value={Math.abs(s.netBalance)} /></dl><button className="supplier-button" onClick={() => setSupplierId(s.supplierId)}>Open ledger</button></article>)}</div>
      {!rows.length && <p role="status">{search ? "No suppliers match your search." : "No suppliers yet. Add a supplier to start recording purchases and payments."}</p>}
      </section>
    </>}
    {!loading && !error && ledger && <>
      <div className="supplier-page-heading supplier-account-header"><div><span className="supplier-eyebrow">SUPPLIER ACCOUNT</span><h2>{ledger.supplierName}</h2><p>Purchases, payments and settlements through {asOf || todayYmd()}. The start date only filters transaction history.</p></div>
        {has("accounting.payments.create") && <button className="supplier-primary" onClick={() => setPayment({ contactType: "Supplier", contactId: ledger.supplierId })}>Record payment / advance</button>}
      </div>
      <div className="supplier-metrics">
        <Metric label={ledger.netBalance >= 0 ? "Payable to supplier" : "Supplier credit balance"} value={Math.abs(ledger.netBalance)} note={ledger.netBalance >= 0 ? "Net balance after payments and credits" : "Amount in your favour"} primary />
        <Metric label="Total paid to supplier" value={ledger.cashPaid} note="Bill payments + advances, less refunds" />
        <Metric label="Purchase bills outstanding" value={outstanding} note={`${allPurchases.filter(p => p.outstanding > 0).length} unpaid or partly settled purchases`} />
        <Metric label="Total purchases" value={sum(allPurchases, "liability")} note="Payable value after withholding" />
      </div>
      <details className="supplier-reconciliation"><summary>How the payable balance is calculated</summary><dl>
        <Pair label="Purchase bills outstanding" value={outstanding} /><Pair label="Unallocated advances, credits & journal changes" value={unallocatedChange} /><Pair label="Net supplier balance" value={ledger.netBalance} />
      </dl><p>Bill balances are reduced only by payments and credits linked to those bills. Advances and unallocated credits reduce the supplier balance separately.</p>
      <p>Unallocated advances: Rs. {money(ledger.unappliedAdvances)} · Unallocated credits: Rs. {money(ledger.unallocatedCredits)}</p></details>
      <section className="supplier-panel" aria-labelledby="supplier-purchase-title"><h3 id="supplier-purchase-title">Bill-wise outstanding</h3><p className="supplier-hint">Purchase amounts, payments and outstanding balances. Open source links for the customer bill or challan.</p>
        <div className="commercial-toolbar supplier-toolbar">
          <label>Find bill<input placeholder="Purchase, supplier reference, bill or challan no." value={documentSearch} onChange={e => setDocumentSearch(e.target.value)} /></label>
          <label>Settlement status<select aria-label="Settlement status" value={settlement} onChange={e => setSettlement(e.target.value)}><option value="">All purchases</option><option value="unpaid">Unpaid</option><option value="partial">Partially settled</option><option value="paid">Settled</option></select></label>
          <label>Purchase category<select aria-label="Purchase category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option><option value="LocalDirect">Local direct purchases</option><option value="Inventory">Inventory purchases</option></select></label>
        </div>
        <p className="supplier-filter-result">Showing {purchases.length} of {allPurchases.length} purchases · Outstanding in these results: <strong>Rs. {money(sum(purchases, "outstanding"))}</strong></p>
        <table className="commercial-ledger-table supplier-table"><thead><tr><th>Purchase / customer bill</th><th>Purchase amount</th><th>Paid</th><th>Credits / settlement</th><th>Outstanding</th><th>Actions</th></tr></thead><tbody>{purchases.map(p => <tr key={p.id}>
          <td><strong>Purchase #{p.number}</strong><small>{p.date.slice(0, 10)} · {p.category === "LocalDirect" ? "Local direct" : "Inventory"}{p.supplierBillNumber ? ` · Supplier ref: ${p.supplierBillNumber}` : ""}</small>{sourceLinks(p)}{p.costChanged && <small className="supplier-cost-change">Costing changed; booked payable stays unchanged.</small>}</td>
          <td className="supplier-number">{money(p.liability)}</td><td className="supplier-number">{money(p.cashPaid)}</td><td className="supplier-number">{money(p.creditAmount + p.adjustment)}</td><td className="supplier-number"><strong>Rs. {money(p.outstanding)}</strong><span className={`supplier-settlement supplier-settlement--${stateFor(p)}`}>{stateLabel[stateFor(p)]}</span></td><td>{actions(p)}</td>
        </tr>)}</tbody></table>
        <div className="commercial-ledger-mobile supplier-mobile-list">{purchases.map(p => <article key={p.id}><div className="supplier-page-heading"><strong>Purchase #{p.number}</strong><span className={`supplier-settlement supplier-settlement--${stateFor(p)}`}>{stateLabel[stateFor(p)]}</span></div><small>{p.date.slice(0, 10)} · {p.category === "LocalDirect" ? "Local direct" : "Inventory"}{p.supplierBillNumber ? ` · Supplier ref: ${p.supplierBillNumber}` : ""}</small>{sourceLinks(p)}<dl><Pair label="Purchase amount" value={p.liability} /><Pair label="Paid" value={p.cashPaid} /><Pair label="Credits / settlement" value={p.creditAmount + p.adjustment} /><Pair label="Outstanding" value={p.outstanding} /></dl>{p.costChanged && <p className="supplier-cost-change">Costing changed; booked payable stays unchanged.</p>}{actions(p)}</article>)}</div>
        {!purchases.length && <p role="status">No purchases match these filters.</p>}
      </section>
      <section ref={history} tabIndex={-1} className="supplier-history supplier-panel" aria-labelledby="supplier-history-title"><div className="supplier-page-heading"><h3 id="supplier-history-title">{transactionPurchase ? `Transactions for Purchase #${transactionPurchase.number}` : "Complete transaction ledger"}</h3>{transactionPurchase && <button className="supplier-button" onClick={() => setTransactionPurchase(null)}>Show complete ledger</button>}</div>
        <p>Opening balance{from ? ` before ${from}` : ""}: <strong>Rs. {money(ledger.openingBalance)}</strong>. Running balances show the whole supplier account{transactionPurchase ? "; this view only includes linked transactions. Payment amounts are whole-payment totals; open a payment to see its allocation to this purchase" : ""}.</p>
        <table className="commercial-ledger-table supplier-table"><thead><tr><th>Date</th><th>Transaction</th><th>Purchases / increases</th><th>Paid</th><th>Credits / settlement</th><th>Running balance</th></tr></thead><tbody>{transactionRows.map((r, index) => <tr key={index}><td>{r.date.slice(0, 10)}</td><td>{reference(r)}</td><td className="supplier-number">{money(r.increase)}</td><td className="supplier-number">{money(r.cashPaid)}</td><td className="supplier-number">{money(r.adjustment)}</td><td className="supplier-number"><strong>{money(r.balance)}</strong></td></tr>)}</tbody></table>
        <div className="commercial-ledger-mobile supplier-mobile-list">{transactionRows.map((r, index) => <article key={index}><small>{r.date.slice(0, 10)}</small><div>{reference(r)}</div><dl><Pair label="Purchases / increases" value={r.increase} /><Pair label="Paid" value={r.cashPaid} /><Pair label="Credits / settlement" value={r.adjustment} /><Pair label="Running supplier balance" value={r.balance} /></dl></article>)}</div>
        {!transactionRows.length && <p role="status">No transactions in this view.</p>}
      </section>
    </>}
    {challanCost && <CommercialCostDialog kind="challan" id={challanCost} companyId={selectedCompany.id} onClose={() => { setChallanCost(null); setRevision(n => n + 1); }} />}
    {bill && <CommercialCostDialog id={bill} companyId={selectedCompany.id} onClose={() => { setBill(null); setRevision(n => n + 1); }} />}
    {credit && <PurchaseDebitNoteForm companyId={selectedCompany.id} preset={credit} onClose={() => setCredit(null)} onSaved={() => { setNotice("Supplier credit saved."); setCredit(null); setRevision(n => n + 1); }} />}
    {creditDetail && <PurchaseDebitNoteForm companyId={selectedCompany.id} noteId={creditDetail} readOnly onClose={() => setCreditDetail(null)} />}
    {purchase && <PurchaseBillForm companyId={selectedCompany.id} billId={purchase} readOnly onClose={() => setPurchase(null)} />}
    {payment && <PaymentForm mode={payment.dir || "payments"} companyId={selectedCompany.id} preset={payment} editPayment={payment.editPayment} onClose={() => setPayment(null)} onSaved={() => { setNotice("Payment saved."); setPayment(null); setRevision(n => n + 1); }} />}
    {paymentDetail && <div style={formStyles.backdrop}><section ref={paymentDialog} role="dialog" aria-modal="true" aria-label="Supplier payment details" style={{ ...formStyles.modal, maxWidth: 800 }}><header style={formStyles.header}><h2 style={formStyles.title}>{paymentDetail.dir === "receipts" ? "Supplier refund" : "Payment"} #{paymentDetail.number}</h2><button aria-label="Close payment details" style={formStyles.closeButton} onClick={() => setPaymentDetail(null)}>×</button></header><div style={formStyles.body}>
      <h3>{paymentDetail.contactName || ledger?.supplierName}</h3><div className="supplier-metrics"><Metric label={paymentDetail.dir === "receipts" ? "Refund received" : "Amount paid"} value={paymentDetail.amount} note={`${paymentDetail.date?.slice(0, 10)} · ${paymentDetail.method}`} /><Metric label="Other settlement" value={sum(paymentDetail.allocations || [], "adjustmentAmount")} note="Non-cash amount applied to bills" /></div>
      {paymentDetail.bankAccountName && <p>{paymentDetail.dir === "receipts" ? "Received into" : "Paid from"}: {paymentDetail.bankAccountName}</p>}{paymentDetail.description && <p>{paymentDetail.description}</p>}
      <h3>Payment allocation</h3><div className="supplier-allocation-list">{paymentDetail.allocations?.map((a, i) => {
        const target = allPurchases.find(p => p.id === a.purchaseBillId);
        return <article key={i}><div>{a.purchaseBillId ? has("purchasebills.list.view") ? <button className="supplier-link" onClick={() => { setPaymentDetail(null); setPurchase(a.purchaseBillId); }}>{target ? `Purchase #${target.number}` : "View linked purchase"}</button> : <strong>{target ? `Purchase #${target.number}` : "Linked purchase"}</strong> : <strong>{a.kind === "OnAccount" ? "Supplier advance / on account" : "Other allocation"}</strong>}{target?.supplierBillNumber && <small>Supplier ref: {target.supplierBillNumber}</small>}</div><dl><Pair label="Paid" value={a.amount} /><Pair label="Other settlement" value={a.adjustmentAmount} /></dl></article>;
      })}</div>
    </div><footer style={formStyles.footer}><button className="supplier-button" onClick={() => setPaymentDetail(null)}>Close</button>{has(`accounting.${paymentDetail.dir}.create`) && !paymentDetail.isCancelled && <button className="supplier-primary" onClick={() => { setPayment({ dir: paymentDetail.dir, editPayment: paymentDetail }); setPaymentDetail(null); }}>Edit payment</button>}</footer></section></div>}
  </main>;
}

function Metric({ label, value, note, primary }) { const Icon = label.toLowerCase().includes("paid") ? MdPayments : label.toLowerCase().includes("purchase") ? MdShoppingCart : MdAccountBalanceWallet; return <div className={primary ? "supplier-metric supplier-metric--primary" : "supplier-metric"}><span className="supplier-metric-icon"><Icon aria-hidden="true" /></span><span>{label}</span><strong>Rs. {money(value)}</strong><small>{note}</small></div>; }
function Pair({ label, value }) { return <div><dt>{label}</dt><dd>Rs. {money(value)}</dd></div>; }
