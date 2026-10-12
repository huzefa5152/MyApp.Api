import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formStyles } from "../theme";
import { createPurchaseBillsFromChallan, previewPurchaseBillsFromChallan } from "../api/purchaseBillApi";
import { notify } from "../utils/notify";
import RichText from "./RichText";
import { challanPurchaseTax, validChallanPurchaseRate } from "../utils/challanPurchaseTotals.mjs";
import "./ChallanPurchasePreview.css";

const money = value => Number(value).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitPrice = value => Number(value).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 12 });
export function useChallanPurchasePreview() {
  const [preview, setPreview] = useState(null);
  const resolver = useRef(null);
  const lastSettings = useRef(null);
  useEffect(() => () => { resolver.current?.(null); }, []);
  const finish = settings => { resolver.current?.(settings); resolver.current = null; setPreview(null); };
  const create = async challanId => {
    const { data } = await previewPurchaseBillsFromChallan(challanId);
    if (data.alreadyCreated) { notify("Purchase bills already exist for this challan.", "info"); return true; }
    const previous = lastSettings.current?.challanId === challanId ? lastSettings.current : null;
    const review = previous ? { ...data, date: previous.date, suppliers: data.suppliers.map(s => ({ ...s, ...previous.suppliers.find(row => row.supplierId === s.supplierId) })) } : data;
    const settings = await new Promise(resolve => { resolver.current = resolve; setPreview(review); });
    if (!settings) return false;
    lastSettings.current = { challanId, ...settings };
    const { data: bills } = await createPurchaseBillsFromChallan(challanId, settings);
    notify(`${bills.length} purchase bill${bills.length === 1 ? "" : "s"} created. Settle suppliers from Payments.`, "success");
    return true;
  };
  return { create, dialog: preview ? <ChallanPurchasePreview preview={preview} onFinish={finish} /> : null };
}

export default function ChallanPurchasePreview({ preview, onFinish }) {
  const [date, setDate] = useState(preview.date.slice(0, 10));
  const [suppliers, setSuppliers] = useState(preview.suppliers.map(s => ({ ...s, gstRate: String(s.gstRate ?? 0), supplierBillNumber: s.supplierBillNumber || "" })));
  const first = useRef(null);
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    first.current?.focus();
    const key = e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onFinish(null); }
      if (e.key === "Tab") {
        const fields = [...dialog.current.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
        const target = e.shiftKey ? fields[0] : fields.at(-1);
        if (document.activeElement === target) { e.preventDefault(); (e.shiftKey ? fields.at(-1) : fields[0]).focus(); }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); previous?.focus?.(); };
  }, []);
  const invalid = !date || suppliers.some(s => !validChallanPurchaseRate(s.gstRate));
  const patch = (id, value) => setSuppliers(rows => rows.map(s => s.supplierId === id ? { ...s, ...value } : s));
  const subtotal = s => s.items.reduce((sum, line) => sum + Number(line.lineTotal), 0);
  const tax = s => validChallanPurchaseRate(s.gstRate) ? challanPurchaseTax(subtotal(s).toFixed(2), s.gstRate) : 0;
  const total = suppliers.reduce((sum, s) => sum + subtotal(s) + tax(s), 0);
  return createPortal(<div style={{ ...formStyles.backdrop, zIndex: 12000 }} onClick={e => e.stopPropagation()} onSubmit={e => e.stopPropagation()}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="challan-purchase-title" className="challan-purchase-preview" style={{ ...formStyles.modal, maxWidth: 960 }}>
      <header style={formStyles.header}><h2 id="challan-purchase-title" style={formStyles.title}>Review supplier purchase bills</h2><button type="button" aria-label="Close purchase preview" style={formStyles.closeButton} onClick={() => onFinish(null)}>×</button></header>
      <div style={formStyles.body}>
        <p>Challan #{preview.challanNumber} is saved. Review one unpaid bill per supplier before creating them.</p>
        <p className="challan-purchase-hint">{preview.tracksStock ? "These purchases retain the challan item types and follow this company's inventory rules." : "These supplier purchases create amounts owed without item types, HS codes or stock movements."}</p>
        <label className="challan-purchase-field">Purchase bill date<input ref={first} type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <div className="challan-purchase-suppliers">{suppliers.map(s => <article key={s.supplierId} className="challan-purchase-supplier">
          <h3>{s.supplierName}</h3><span className="challan-purchase-hint">Supplier #{s.supplierId} · {s.items.length} line{s.items.length === 1 ? "" : "s"}</span>
          <div className="challan-purchase-fields">
            <label className="challan-purchase-field">Supplier invoice reference (optional)<input maxLength={100} value={s.supplierBillNumber} onChange={e => patch(s.supplierId, { supplierBillNumber: e.target.value })} /></label>
            <label className="challan-purchase-field">GST (%)<input type="number" min="0" max="100" step="0.01" inputMode="decimal" value={s.gstRate} onChange={e => patch(s.supplierId, { gstRate: e.target.value })} aria-invalid={!validChallanPurchaseRate(s.gstRate)} /><small>0% means no GST. Up to two decimal places.</small>{!validChallanPurchaseRate(s.gstRate) && <small role="alert" style={{ color: "#dc3545" }}>Enter a GST rate from 0 to 100, with up to two decimal places.</small>}</label>
          </div>
          <div className="challan-purchase-lines">{s.items.map(line => <div className="challan-purchase-line" key={line.id}><RichText text={line.description} /><span>{line.quantity} {line.uom} × Rs. {unitPrice(line.unitPrice)}</span><strong>Rs. {money(line.lineTotal)}</strong></div>)}</div>
          <dl className="challan-purchase-totals"><div><dt>Subtotal</dt><dd>Rs. {money(subtotal(s))}</dd></div><div><dt>GST ({s.gstRate || 0}%)</dt><dd>Rs. {money(tax(s))}</dd></div><div><dt>Supplier amount owed</dt><dd>Rs. {money(subtotal(s) + tax(s))}</dd></div></dl>
        </article>)}</div>
      </div>
      <footer style={formStyles.footer} className="challan-purchase-footer"><strong>Total payable: Rs. {money(total)}</strong><button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={() => onFinish(null)}>Not now</button><button type="button" disabled={invalid} style={{ ...formStyles.button, ...formStyles.submit, opacity: invalid ? 0.5 : 1 }} onClick={() => onFinish({ revision: preview.revision, date, suppliers: suppliers.map(s => ({ supplierId: s.supplierId, gstRate: Number(s.gstRate), supplierBillNumber: s.supplierBillNumber })) })}>Create {suppliers.length} purchase bill{suppliers.length === 1 ? "" : "s"}</button></footer>
    </section>
  </div>, document.body);
}
