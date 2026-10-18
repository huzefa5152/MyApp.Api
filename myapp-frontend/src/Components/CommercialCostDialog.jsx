import { purchaseBillTotals } from "../utils/purchaseBillTotals.mjs";
import { useEffect, useRef, useState } from "react";
import { readCosts, saveCosts, billPayables } from "../api/commercialCostApi";
import { Link } from "react-router-dom";
import ChallanPrivateCosts, { useChallanSuppliers } from "./ChallanPrivateCosts";
import PurchaseBillForm from "./PurchaseBillForm";
import { usePermissions } from "../contexts/PermissionsContext";
import { formStyles } from "../theme";
import "./CommercialCosts.css";

const money = n => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Supplier and actual cost per line. Saving books every line with both as a
 * purchase from that supplier (one per supplier); the server keeps those
 * purchases in step with the costs until they are paid or credited.
 */
export default function CommercialCostDialog({ kind = "bill", id, companyId, onClose }) {
  const [data, setData] = useState(null);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [payables, setPayables] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const feedback = useRef(null);
  const dialog = useRef(null);
  const suppliers = useChallanSuppliers(companyId);
  const { has } = usePermissions();
  const hasCost = i => i.actualUnitCost !== "" && i.actualUnitCost != null && Number.isFinite(Number(i.actualUnitCost)) && Number(i.actualUnitCost) >= 0;
  const remainingFor = i => Number(i.remainingQuantity ?? (i.purchaseRecorded ? 0 : i.quantity) ?? 0);
  const purchasedQtyFor = i => Number(i.purchasedQuantity ?? (i.purchaseRecorded ? i.quantity : 0) ?? 0);
  const purchasedAmountFor = i => Number(i.purchasedAmount ?? 0);
  // Booked purchases at their price, plus the estimate for anything not booked.
  const estimatedFor = i => hasCost(i) ? purchaseBillTotals([{ quantity: remainingFor(i), unitPrice: Number(i.actualUnitCost) }], 0).subtotal : 0;
  const actualFor = i => purchasedAmountFor(i) + estimatedFor(i);
  const actual = items.reduce((s, i) => s + actualFor(i), 0);
  const complete = items.length > 0 && items.every(i => remainingFor(i) <= 0 || hasCost(i));

  const load = async () => {
    const { data: result } = await readCosts(kind, id);
    setData(result); setItems(result.items); setDirty(false);
    if (kind === "bill" && has("purchasebills.payables.view")) setPayables((await billPayables(id)).data);
  };
  useEffect(() => {
    let active = true;
    if (kind === "bill" && has("purchasebills.payables.view")) billPayables(id).then(({ data }) => { if (active) setPayables(data); }).catch(() => { if (active) setError("Could not load supplier payables."); });
    return () => { active = false; };
  }, [kind, id, has]);
  useEffect(() => { let active = true; readCosts(kind, id).then(({ data: result }) => {
    if (active) { setData(result); setItems(result.items); }
  }).catch(() => { if (active) setError("Could not load costs."); }); return () => { active = false; }; }, [kind, id]);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector("button")?.focus();
    const handle = e => {
      if (formOpen) return;
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab") {
        const fields = [...dialog.current.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex='0']")];
        if (!fields.length) return;
        if (e.shiftKey && document.activeElement === fields[0]) { e.preventDefault(); fields.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === fields.at(-1)) { e.preventDefault(); fields[0].focus(); }
      }
    };
    document.addEventListener("keydown", handle);
    return () => { document.removeEventListener("keydown", handle); previous?.focus?.(); };
  }, [busy, onClose, formOpen]);
  const run = async action => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (e) {
      setError(e.response?.data?.error || "Could not complete the action. Reload and try again.");
      setTimeout(() => { feedback.current?.scrollIntoView?.({ block: "nearest" }); feedback.current?.focus(); });
    }
    finally { setBusy(false); }
  };
  const save = () => run(async () => {
    if (items.some(i => i.actualUnitCost != null && i.actualUnitCost !== "" && !hasCost(i))) throw { response: { data: { error: "Enter a valid actual cost of zero or more. Leave it blank if you do not know it yet." } } };
    const { data: result } = await saveCosts(kind, id, { version: data.version, items: items.map(i => ({ id: i.id, supplierId: i.supplierId ? Number(i.supplierId) : null, actualUnitCost: i.actualUnitCost == null || i.actualUnitCost === "" ? null : Number(i.actualUnitCost) })) });
    setData(result); setItems(result.items); setDirty(false);
    if (kind === "bill" && has("purchasebills.payables.view")) setPayables((await billPayables(id)).data);
    setMessage("Saved. Lines with a supplier and cost are booked as supplier purchases.");
  });
  const lineStatus = i => remainingFor(i) <= 0 ? `Booked to suppliers · Rs. ${money(purchasedAmountFor(i))}`
    : purchasedQtyFor(i) > 0 ? `${purchasedQtyFor(i)} of ${i.quantity} booked · Rs. ${money(purchasedAmountFor(i))}`
    : "Payable not recorded";

  return <div data-admin-backdrop="" style={formStyles.backdrop}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="commercial-cost-title" className="commercial-dialog" style={{ ...formStyles.modal, maxWidth: 1050 }}>
      <header style={formStyles.header}><h2 id="commercial-cost-title" style={formStyles.title}>{kind === "bill" ? "Bill" : "Challan"} #{data?.number} · Costs & suppliers</h2><button aria-label="Close costs" disabled={busy} style={formStyles.closeButton} onClick={onClose}>×</button></header>
      <div className="commercial-dialog-body" style={formStyles.body}>
        <p>Supplier and actual cost are optional and can be changed after billing or FBR submission. Customer prints and filed sales data never change.</p>
        {error && <div ref={feedback} tabIndex={-1} role="alert" className="commercial-feedback"><strong>Check before continuing</strong><p>{error}</p></div>}{message && <p role="status">{message}</p>}
        {!data ? <p>Loading costs…</p> : <>
          <div className="commercial-metrics"><div>Selling value<strong>Rs. {money(data.sellingAmount)}</strong></div><div>Actual cost<strong>Rs. {money(actual)}</strong></div><div>{complete ? "Commercial profit" : "Provisional profit · Cost incomplete"}<strong>Rs. {money(data.sellingAmount - actual)}</strong></div><div>Margin<strong>{data.sellingAmount ? `${((data.sellingAmount - actual) / data.sellingAmount * 100).toFixed(2)}%` : "—"}</strong></div></div>
          <ChallanPrivateCosts companyId={companyId} suppliers={suppliers} items={items} getActualLineTotal={actualFor} readOnly={busy || !has("bills.costs.update")} onItemsChange={rows => { setItems(rows); setDirty(true); }} />
          <div className="commercial-grid">{items.map(i => <article key={i.id}><strong>{i.description}</strong><p>{lineStatus(i)}</p><span>Profit: {remainingFor(i) > 0 && !hasCost(i) ? "Cost missing" : `Rs. ${money(i.sellingAmount - actualFor(i))}`}</span></article>)}</div>
          {payables.length > 0 && <section><h3>Supplier payables for this bill</h3><div className="commercial-grid">{payables.map(p => <article key={p.id}><strong>{p.supplierName} · Purchase #{p.number}</strong><p>Liability Rs. {money(p.liability)} · Cash paid Rs. {money(p.cashPaid)}</p><p>Credits Rs. {money(p.creditAmount)} · Other settlement Rs. {money(p.adjustment)} · Outstanding Rs. {money(p.outstanding)}</p>{p.costChanged && <p>Costing changed. Review this supplier liability.</p>}</article>)}</div><Link to="/supplier-payables">Open supplier payables & ledger</Link></section>}
        </>}
      </div>
      <footer style={{ ...formStyles.footer, flexWrap: "wrap" }}>
        <button style={{ ...formStyles.button, ...formStyles.cancel }} disabled={busy} onClick={onClose}>Close</button>
        {data && has("purchasebills.manage.create") && <button style={formStyles.button} disabled={busy || dirty} title={dirty ? "Save costs first" : "For a supplier invoice that differs from these costs"} onClick={() => setFormOpen(true)}>Enter supplier bill</button>}
        {data && has("bills.costs.update") && <button style={{ ...formStyles.button, ...formStyles.submit }} disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save costs"}</button>}
      </footer>
    </section>
    {formOpen && <PurchaseBillForm companyId={companyId} localSource={{ kind, id }} onClose={() => setFormOpen(false)}
      onSaved={() => run(async () => { await load(); setMessage("Supplier purchase saved."); })} />}
  </div>;
}
