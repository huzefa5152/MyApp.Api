import { useEffect, useState } from "react";
import useScrollToError from "../hooks/useScrollToError";
import LineItemsEditor from "./LineItemsEditor";
import { getBilledChallanEdit, updateBilledChallanEdit } from "../api/challanApi";
import { getAllUnits } from "../api/unitsApi";
import { usePermissions } from "../contexts/PermissionsContext";
import { deliveryBillImpact } from "../utils/billedChallanEdit";
import { formStyles, colors } from "../theme";


const money = n => Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blank = () => ({ id: 0, description: "", quantity: 1, unit: "", itemTypeId: null, unitPrice: "" });

export default function BilledChallanEditForm({ challan, onClose, onSaved, onOpenBill }) {
  const { has } = usePermissions();
  const permitted = has("challans.manage.update") && has("bills.manage.update");
  const [snapshot, setSnapshot] = useState(null);
  const [items, setItems] = useState([]);
  const [units, setUnits] = useState([]);
  const [error, setError] = useState("");
  const errorRef = useScrollToError(error);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stockWarnings, setStockWarnings] = useState([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    if (permitted) {
      getBilledChallanEdit(challan.id).then(({ data }) => {
        if (!active) return;
        setSnapshot(data);
        setItems(data.challan.items.map(i => ({ ...i, unitPrice: data.bill.items.find(b => b.deliveryItemId === i.id)?.unitPrice ?? "" })));
      }).catch(e => { if (active) setError(e.response?.data?.error || "Could not load the linked bill. Close and refresh before trying again."); });
      getAllUnits(challan.companyId).then(({ data }) => { if (active) setUnits(data); }).catch(() => {});
    }
    return () => { active = false; };
  }, [challan.id, challan.companyId, permitted]);
  const impact = snapshot ? deliveryBillImpact(snapshot, items) : null;
  const paidConflict = impact && impact.collectible < Number(snapshot.bill.amountPaid || 0);
  const changes = items.map(i => {
    const old = snapshot?.challan.items.find(c => c.id === i.id);
    const billLine = snapshot?.bill.items.find(b => b.deliveryItemId === i.id);
    return { ...i, label: !old ? "Added" : old.quantity !== Number(i.quantity) || old.description !== i.description || old.unit !== i.unit || Number(billLine?.unitPrice) !== Number(i.unitPrice) ? "Changed" : "Unchanged" };
  });
  const changed = !!impact && (impact.added > 0 || impact.removed > 0 || changes.some(i => i.label === "Changed"));
  async function submit(event) {
    event.preventDefault();
    if (!impact?.valid || saving || paidConflict || !changed) { setError("Check descriptions, units, quantities and rates. Enter 0 explicitly for a free item."); return; }
    if (!review) { setError(""); setReview(true); return; }
    setSaving(true); setError("");
    try {
      const { data } = await updateBilledChallanEdit(challan.id, { version: snapshot.challan.version, billVersion: snapshot.billVersion,
        items: items.map(i => ({ id: i.id || 0, itemTypeId: i.itemTypeId || null, salesOrderItemId: i.salesOrderItemId || null,
          description: i.description.trim(), quantity: Number(i.quantity), unit: i.unit.trim(), billUnitPrice: Number(i.unitPrice),
          supplierId: i.supplierId || null, actualUnitCost: i.actualUnitCost ?? null })) });
      setStockWarnings(data.stockWarnings || []);
      setSaved(true);
    } catch(e) { setError(e.response?.data?.error || "Could not update the delivery and bill. Refresh before trying again."); }
    finally { setSaving(false); }
  }
  const button = { ...formStyles.button, minHeight: 44 };
  return <div data-admin-backdrop="" style={{ ...formStyles.backdrop, zIndex: 1600 }}>
    <form aria-label="Edit delivery and update bill" data-admin-dialog="" onSubmit={submit} style={{ ...formStyles.modal, width: "96vw", maxWidth: 1100, minWidth: 0 }}>
      <div data-admin-header="" style={formStyles.header}>
        <h5 style={formStyles.title}>Edit delivery · Challan #{challan.challanNumber}</h5>
        <button type="button" aria-label="Close delivery editor" style={formStyles.closeButton} disabled={saving} onClick={saved ? () => onSaved(snapshot.bill) : onClose}>×</button>
      </div>
      <div data-admin-body="" style={{ ...formStyles.body, minWidth: 0 }}>
        {!permitted && <p role="alert">Challan-edit and bill-edit permissions are required.</p>}
        {error && <p ref={errorRef} role="alert" style={{ padding: 12, background: colors.dangerLight, color: colors.danger, borderRadius: 8 }}>{error}</p>}
        {permitted && !snapshot && !error && <p role="status">Loading delivery and linked bill…</p>}
        {saved ? <div role="status"><h3>Challan and bill saved</h3><p>Bill #{snapshot.bill.invoiceNumber} now reflects this delivery. Rates, taxes, stock and accounting were reconciled together. Check Invoices for any consultant review required before FBR submission.</p>{stockWarnings.length > 0 && <div role="alert" style={{ color: colors.danger }}><strong>Saved with stock warnings</strong>{stockWarnings.map(w => <p key={w.itemTypeId}>{w.itemTypeName}: on-hand is {w.onHand}. Receive stock or review the delivery quantity.</p>)}</div>}</div> : snapshot && <>
          <p><strong>{snapshot.bill.clientName}</strong> · Bill #{snapshot.bill.invoiceNumber}</p>
          <p>Changes apply to this challan and its linked bill together. Existing rates are filled in. Enter rates excluding GST, including 0 explicitly for free items. Delivery changes are locked once FBR submission starts.</p>
          {snapshot.challan.salesOrderId && <p role="note">New items must match a line on the linked sales order. Add the ordered line first when needed.</p>}
          {!review ? <LineItemsEditor companyId={challan.companyId} items={items} onItemsChange={setItems} makeBlankItem={blank} units={units} showUnitPrice itemsLabel="Delivery items and bill rates" /> : <>
            <h3>Review delivery changes</h3>
            <p>{impact.added} added · {impact.removed} removed · {changes.filter(i => i.label === "Changed").length} changed</p>
            {changes.map((i,index) => <div key={i.id || `new-${index}`} style={{ padding: 10, borderBottom: `1px solid ${colors.cardBorder}`, overflowWrap: "anywhere" }}>
              <strong>{i.label}</strong> · {i.description}<div>{i.quantity} {i.unit} × Rs {money(i.unitPrice)} = Rs {money(Number(i.quantity) * Number(i.unitPrice))}</div>
            </div>)}
            {snapshot.challan.items.filter(i => !items.some(row => row.id === i.id)).map(i => <p key={i.id} style={{ color: colors.danger }}>Removed: {i.description} ({i.quantity} {i.unit})</p>)}
          </>}
          <section aria-label="Estimated bill impact" aria-live="polite" style={{ background: colors.inputBg, padding: 14, marginTop: 16, borderRadius: 10, border: `1px solid ${colors.cardBorder}` }}>
            <strong>Estimated bill totals</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px,100%),1fr))", gap: 10, marginTop: 10 }}>
              <span>Subtotal: Rs {money(impact.subtotal)}</span><span>GST: Rs {money(impact.gst)}</span>
              {impact.further > 0 && <span>Further tax: Rs {money(impact.further)}</span>}
              <span>Freight unchanged: Rs {money(snapshot.bill.freightCharges)}</span>
              <strong>Previous total: Rs {money(Number(snapshot.bill.grandTotal) + Number(snapshot.bill.freightCharges || 0))}</strong>
              <strong>New total: Rs {money(impact.total)}</strong>
              <span>Collectible: Rs {money(impact.collectible)}</span><span>Receipts allocated: Rs {money(snapshot.bill.amountPaid)}</span>
            </div>
            {paidConflict && <p role="alert" style={{ color: colors.danger }}>The new collectible amount is below allocated receipts. Reallocate receipts before reducing this bill.</p>}
          </section>
          {review && <p role="note">Saving preserves existing consultant work. If the commercial bill changes after adjustment, the consultant must review it again. Supplier purchase bills, accounting locks and stock safeguards are checked before saving.</p>}
        </>}
      </div>
      <div style={{ ...formStyles.footer, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {saved ? <>
          <button type="button" style={button} onClick={() => onSaved(snapshot.bill)}>Done</button>
          {onOpenBill && <button type="button" style={{ ...button, ...formStyles.submit }} onClick={() => onOpenBill(snapshot.bill)}>Open bill #{snapshot.bill.invoiceNumber}</button>}
        </> : <>
          <button type="button" style={button} disabled={saving} onClick={review ? () => setReview(false) : onClose}>{review ? "Back to items" : "Cancel"}</button>
          {snapshot && permitted && <button type="submit" style={{ ...button, ...formStyles.submit }} disabled={saving || !impact?.valid || paidConflict || !changed}>{saving ? "Saving…" : review ? "Save challan & update bill" : "Review changes"}</button>}
        </>}
      </div>
    </form>
  </div>;
}
