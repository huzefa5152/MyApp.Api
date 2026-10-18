import { purchaseBillTotals } from "../utils/purchaseBillTotals.mjs";
import { validChallanPurchaseRate } from "../utils/challanPurchaseTotals.mjs";
import { todayYmd } from "../utils/dateInput";
import { useEffect, useRef, useState } from "react";
import { readCosts, saveCosts, createLocalPurchases, billPayables } from "../api/commercialCostApi";
import { Link } from "react-router-dom";
import ChallanPrivateCosts, { useChallanSuppliers } from "./ChallanPrivateCosts";
import { usePermissions } from "../contexts/PermissionsContext";
import { formStyles } from "../theme";
import "./CommercialCosts.css";

const money = n => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CommercialCostDialog({ kind = "bill", id, companyId, onClose }) {
  const [data, setData] = useState(null);
  const [validatePurchase, setValidatePurchase] = useState(false);
  const reviewHeading = useRef(null);
  const feedback = useRef(null);
  const explain = message => { setError(message); setTimeout(() => { feedback.current?.scrollIntoView?.({ block: "nearest" }); feedback.current?.focus(); }); };
  const hasCost = i => i.actualUnitCost !== "" && i.actualUnitCost != null && Number.isFinite(Number(i.actualUnitCost)) && Number(i.actualUnitCost) >= 0;
  const remainingFor = i => Number(i.remainingQuantity ?? (i.purchaseRecorded ? 0 : i.quantity) ?? 0);
  const purchasedQtyFor = i => Number(i.purchasedQuantity ?? (i.purchaseRecorded ? i.quantity : 0) ?? 0);
  const purchasedAmountFor = i => Number(i.purchasedAmount ?? 0);
  const persistCosts = async () => {
    const { data: result } = await saveCosts(kind, id, { version: data.version, items: items.map(i => ({ id: i.id, supplierId: i.supplierId ? Number(i.supplierId) : null, actualUnitCost: i.actualUnitCost == null || i.actualUnitCost === "" ? null : Number(i.actualUnitCost) })) });
    setData(result); setItems(result.items); setDirty(false);
    return result;
  };
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [review, setReview] = useState(false);
  const [payables, setPayables] = useState([]);
  const [selected, setSelected] = useState([]);
  const [supplierSettings, setSupplierSettings] = useState({});
  const [date, setDate] = useState(todayYmd());
  const suppliers = useChallanSuppliers(companyId);
  const { has } = usePermissions();
  const dialog = useRef(null);
  useEffect(() => {
    if (review) {
      const body = dialog.current?.querySelector(".commercial-dialog-body");
      if (body) body.scrollTop = 0;
      reviewHeading.current?.focus({ preventScroll: true });
    }
  }, [review]);

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
  }, [busy, onClose]);
  const run = async action => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (e) { setError(e.response?.data?.error || "Could not complete the action. Reload and try again."); }
    finally { setBusy(false); }
  };
  const ready = items.filter(i => remainingFor(i) > 0 && i.supplierId && hasCost(i));
  const actualFor = i => Number(i.actualAmount ?? purchaseBillTotals([{ quantity: i.quantity, unitPrice: i.actualUnitCost || 0 }], 0).subtotal);
  const actual = items.reduce((s, i) => s + actualFor(i), 0);
  const complete = items.length > 0 && items.every(i => remainingFor(i) <= 0 || i.actualUnitCost !== "" && i.actualUnitCost != null);
  const groups = [...new Set(ready.filter(i => selected.includes(i.id)).map(i => Number(i.supplierId)))];
  const purchaseGroups = [...new Map(ready.filter(i => selected.includes(i.id)).map(i => {
    const key = `${i.supplierId}:${i.sourceChallanId || "bill"}`;
    return [key, { key, supplierId: Number(i.supplierId), challanId: i.sourceChallanId || null, challanNumber: i.sourceChallanNumber }];
  })).values()];
  const invalidSettings = purchaseGroups.some(g => !validChallanPurchaseRate(String(supplierSettings[g.key]?.gstRate ?? 0)));
  const purchaseTotal = purchaseGroups.reduce((sum, g) => {
    const net = ready.filter(i => selected.includes(i.id) && Number(i.supplierId) === g.supplierId && (i.sourceChallanId || null) === g.challanId).reduce((s, i) => s + remainingFor(i) * Number(i.actualUnitCost || 0), 0);
    return sum + purchaseBillTotals([{ quantity: 1, unitPrice: net }], supplierSettings[g.key]?.gstRate || 0).grandTotal;
  }, 0);
  return <div data-admin-backdrop="" style={formStyles.backdrop}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="commercial-cost-title" className="commercial-dialog" style={{ ...formStyles.modal, maxWidth: 1050 }}>
      <header style={formStyles.header}><h2 id="commercial-cost-title" style={formStyles.title}>{kind === "bill" ? "Bill" : "Challan"} #{data?.number} · Costs & suppliers</h2><button aria-label="Close costs" disabled={busy} style={formStyles.closeButton} onClick={onClose}>×</button></header>
      <div className="commercial-dialog-body" style={formStyles.body}>
        {!review && <p>Supplier and actual cost are optional. Private costing can be corrected after billing or FBR submission. Existing supplier liabilities stay unchanged; review their adjustments separately.</p>}
        {error && <div ref={feedback} tabIndex={-1} role="alert" className="commercial-feedback"><strong>Check before continuing</strong><p>{error}</p></div>}{message && <p role="status">{message}</p>}
        {!data ? <p>Loading costs…</p> : <>
          {!review && <><div className="commercial-metrics"><div>Selling value<strong>Rs. {money(data.sellingAmount)}</strong></div><div>Actual cost<strong>Rs. {money(actual)}</strong></div><div>{complete ? "Commercial profit" : "Provisional profit · Cost incomplete"}<strong>Rs. {money(data.sellingAmount - actual)}</strong></div><div>Margin<strong>{data.sellingAmount ? `${((data.sellingAmount - actual) / data.sellingAmount * 100).toFixed(2)}%` : "—"}</strong></div></div>
          <ChallanPrivateCosts companyId={companyId} suppliers={suppliers} items={items} getActualLineTotal={actualFor} showPurchaseValidation={validatePurchase} readOnly={busy || review || !has("bills.costs.update")} onItemsChange={rows => { setItems(rows); setDirty(true); }} />
          <p role="status">{items.filter(i => purchasedQtyFor(i) > 0 || hasCost(i)).length} of {items.length} lines costed · {ready.length} ready for a supplier purchase. A supplier is only needed when recording a payable.</p>
          <div className="commercial-grid">{items.map(i => <article key={i.id}><strong>{i.description}</strong><p>{remainingFor(i) <= 0 ? `Fully purchased · Rs. ${money(purchasedAmountFor(i))} recorded` : purchasedQtyFor(i) > 0 ? `Partially purchased ${purchasedQtyFor(i)} of ${i.quantity} · Rs. ${money(purchasedAmountFor(i))} recorded` : "Payable not recorded"}</p><span>Profit: {remainingFor(i) > 0 && !hasCost(i) ? "Cost missing" : `Rs. ${money(i.sellingAmount - actualFor(i))}`}</span></article>)}</div>
          {payables.length > 0 && <section><h3>Supplier payables for this bill</h3><div className="commercial-grid">{payables.map(p => <article key={p.id}><strong>{p.supplierName} · Purchase #{p.number}</strong><p>Liability Rs. {money(p.liability)} · Cash paid Rs. {money(p.cashPaid)}</p><p>Credits Rs. {money(p.creditAmount)} · Other settlement Rs. {money(p.adjustment)} · Outstanding Rs. {money(p.outstanding)}</p>{p.costChanged && <p>Costing changed. Review this supplier liability.</p>}</article>)}</div><Link to="/supplier-payables">Open supplier payables & ledger</Link></section>}
          </>}
          {review && <section aria-label="Review local supplier purchases" className="purchase-review">
            <div className="purchase-review-heading"><div><h3 ref={reviewHeading} tabIndex={-1}>Review local supplier purchases</h3><p>Confirm the suppliers and amounts. Reference numbers and GST are optional. No inventory will be added.</p></div>
              <label>Purchase date<input aria-label="Purchase date" type="date" value={date} onChange={e => setDate(e.target.value)} /></label></div>
            <div className="purchase-review-summary"><span><strong>{groups.length}</strong> suppliers · <strong>{purchaseGroups.length}</strong> purchase bills · <strong>{selected.length}</strong> lines selected</span><span>Total payable <strong>Rs. {money(purchaseTotal)}</strong></span></div>
            {ready.length < items.filter(i => remainingFor(i) > 0).length && <p role="status">Only ready lines are included. Lines missing a supplier or actual cost will stay unpurchased; complete them later.</p>}
            <div className="supplier-review-head" aria-hidden="true"><span>Supplier / source</span><span>Supplier invoice reference</span><span>GST %</span><span>Payable</span></div>
            <div className="supplier-review-list">{purchaseGroups.map(g => {
              const lines = ready.filter(i => selected.includes(i.id) && Number(i.supplierId) === g.supplierId && (i.sourceChallanId || null) === g.challanId);
              const amount = purchaseBillTotals(lines.map(i => ({ quantity: remainingFor(i), unitPrice: i.actualUnitCost })), supplierSettings[g.key]?.gstRate || 0).grandTotal;
              const name = suppliers.find(s => s.id === g.supplierId)?.name || `Supplier #${g.supplierId}`;
              return <article className="supplier-review-row" key={g.key}>
                <div className="supplier-review-identity"><strong>{name}</strong><small>{lines.length} line{lines.length === 1 ? "" : "s"}{kind === "bill" ? g.challanId ? ` · Challan #${g.challanNumber || g.challanId}` : " · Standalone bill" : ""}</small></div>
                <label><span className="supplier-review-mobile-label">Invoice reference (optional)</span><input aria-label={`Invoice reference for ${name}${g.challanId ? ` challan ${g.challanNumber || g.challanId}` : ""}`} placeholder="Optional" maxLength={100} value={supplierSettings[g.key]?.supplierBillNumber || ""} onChange={e => setSupplierSettings(s => ({ ...s, [g.key]: { ...s[g.key], supplierBillNumber: e.target.value } }))} /></label>
                <label><span className="supplier-review-mobile-label">GST %</span><input aria-label={`GST rate for ${name}${g.challanId ? ` challan ${g.challanNumber || g.challanId}` : ""}`} type="number" min="0" max="100" step="0.01" value={supplierSettings[g.key]?.gstRate ?? 0} onChange={e => setSupplierSettings(s => ({ ...s, [g.key]: { ...s[g.key], gstRate: e.target.value } }))} /></label>
                <div className="supplier-review-amount"><span className="supplier-review-mobile-label">Payable</span><strong>Rs. {money(amount)}</strong></div>
              </article>;
            })}</div>
            {invalidSettings && <p role="alert">Enter GST rates from 0 to 100 with up to two decimal places.</p>}
            <details className="purchase-review-lines"><summary>Selected lines ({selected.length} of {ready.length}) · Change selection</summary><div>
              {ready.map(i => <label className="commercial-choice" key={i.id}><input type="checkbox" checked={selected.includes(i.id)} onChange={e => setSelected(s => e.target.checked ? [...s, i.id] : s.filter(x => x !== i.id))} /><span>{i.description}<small>{suppliers.find(s => s.id === Number(i.supplierId))?.name || `Supplier #${i.supplierId}`} · Rs. {money(actualFor(i))}</small></span></label>)}
            </div></details>
          </section>}
        </>}
      </div>
      {!review && data && has("purchasebills.manage.create") && <p style={{ padding: "0 20px", fontSize: 13 }}>Preview saves your cost edits. Supplier purchases are created only after you confirm the review.</p>}
      <footer style={{ ...formStyles.footer, flexWrap: "wrap" }}>
        <button style={{ ...formStyles.button, ...formStyles.cancel }} disabled={busy} onClick={onClose}>Close</button>
        {data && !review && has("bills.costs.update") && <button style={{ ...formStyles.button, ...formStyles.submit }} disabled={busy || !dirty || review} onClick={() => run(async () => {
          if (items.some(i => i.actualUnitCost != null && i.actualUnitCost !== "" && !hasCost(i))) { explain("Enter a valid actual cost of zero or more. Leave it blank if you do not know it yet."); return; }
          await persistCosts(); setMessage("Private costs saved. Filed sales data and existing supplier liabilities are unchanged.");
        })}>{busy ? "Working…" : "Save costs"}</button>}
        {data && has("purchasebills.manage.create") && !review && <button style={{ ...formStyles.button, ...formStyles.submit }} disabled={busy} onClick={() => run(async () => {
          setValidatePurchase(true);
          const pending = items.filter(i => remainingFor(i) > 0);
          if (!pending.length) { explain("Supplier purchases are already recorded for all lines. Review the supplier payables below or open the supplier ledger."); return; }
          if (!ready.length) { explain("No lines are ready yet. Add an actual cost and choose a supplier on at least one line. You can leave the other lines for later."); return; }
          if (items.some(i => i.actualUnitCost != null && i.actualUnitCost !== "" && !hasCost(i))) { explain("Correct the invalid actual costs before continuing. Costs must be zero or more."); return; }
          if (dirty) {
            if (!has("bills.costs.update")) { explain("You do not have permission to save cost changes."); return; }
            await persistCosts();
          }
          setSelected(ready.map(i => i.id)); setReview(true);
        })}>{busy ? "Working…" : "Preview supplier purchases"}</button>}
        {review && <><button style={formStyles.button} disabled={busy} onClick={() => setReview(false)}>Back</button><button style={{ ...formStyles.button, ...formStyles.submit }} disabled={busy} onClick={() => run(async () => {
          if (!date) { explain("Choose a purchase date."); return; }
          if (!selected.length) { explain("Select at least one line to create a supplier purchase."); return; }
          if (invalidSettings) { explain("Enter GST rates from 0 to 100 with up to two decimal places."); return; }
          await createLocalPurchases(kind, id, { version: data.version, date, itemIds: selected, suppliers: purchaseGroups.map(g => ({ supplierId: g.supplierId, challanId: g.challanId, supplierBillNumber: supplierSettings[g.key]?.supplierBillNumber || null, gstRate: Number(supplierSettings[g.key]?.gstRate || 0) })) }); await load(); setReview(false); setMessage("Supplier purchases created. Record supplier payments from Payments.");
        })}>Create supplier purchases</button></>}
      </footer>
    </section>
  </div>;
}
