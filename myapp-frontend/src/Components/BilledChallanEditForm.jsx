import { useEffect, useState } from "react";
import useScrollToError from "../hooks/useScrollToError";
import LineItemsEditor from "./LineItemsEditor";
import { getBilledChallanEdit, updateBilledChallanEdit } from "../api/challanApi";
import { getAllUnits } from "../api/unitsApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getNonInventoryItemsByCompany } from "../api/nonInventoryItemApi";
import { usePermissions } from "../contexts/PermissionsContext";
import { deliveryBillImpact } from "../utils/billedChallanEdit";
import { formStyles, colors } from "../theme";

// Ported from the Trader line: edit a billed challan's delivery and its bill in
// one step. Quantity / description / rate edits follow onto the bill, a removed
// delivery line leaves it, a new delivery line joins it at the entered rate.
const money = n => Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blank = () => ({ id: 0, description: "", quantity: 1, unit: "", itemTypeId: null, nonInventoryItemId: null, unitPrice: "" });

export default function BilledChallanEditForm({ challan, onClose, onSaved }) {
  const { has } = usePermissions();
  const permitted = has("challans.manage.update") && has("bills.manage.update");
  const [snapshot, setSnapshot] = useState(null);
  const [items, setItems] = useState([]);
  const [units, setUnits] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [nonInvItems, setNonInvItems] = useState([]);
  const [error, setError] = useState("");
  const errorRef = useScrollToError(error);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    if (permitted) {
      getBilledChallanEdit(challan.id).then(({ data }) => {
        if (!active) return;
        setSnapshot(data);
        setItems(data.challan.items.map(i => ({ ...i, unitPrice: data.bill.items.find(b => b.deliveryItemId === i.id)?.unitPrice ?? "" })));
      }).catch(e => { if (active) setError(e.response?.data?.error || "Could not load the linked bill. Close and refresh before trying again."); });
      getAllUnits().then(({ data }) => { if (active) setUnits(data); }).catch(() => {});
      getItemTypes(challan.companyId).then(({ data }) => { if (active) setItemTypes(data || []); }).catch(() => {});
      getNonInventoryItemsByCompany(challan.companyId, true).then(({ data }) => { if (active) setNonInvItems(data || []); }).catch(() => {});
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
      await updateBilledChallanEdit(challan.id, { version: snapshot.challan.version, billVersion: snapshot.billVersion,
        items: items.map(i => ({ id: i.id || 0, itemTypeId: i.nonInventoryItemId ? null : (i.itemTypeId || null),
          nonInventoryItemId: i.nonInventoryItemId || null, salesOrderItemId: i.salesOrderItemId || null,
          description: i.description.trim(), quantity: Number(i.quantity), unit: (i.unit || "").trim(), billUnitPrice: Number(i.unitPrice),
          supplierId: i.supplierId || null, actualUnitCost: i.actualUnitCost ?? null, itemTypeName: "" })) });
      setSaved(true);
    } catch(e) { setError(e.response?.data?.error || "Could not update the delivery and bill. Refresh before trying again."); }
    finally { setSaving(false); }
  }
  const button = { ...formStyles.button, minHeight: 44 };
  return <div data-admin-backdrop="" style={{ ...formStyles.backdrop, zIndex: 1600 }}>
    <form aria-label="Edit delivery and update bill" data-admin-dialog="" onSubmit={submit} style={{ ...formStyles.modal, width: "96vw", maxWidth: 1100, minWidth: 0 }}>
      <div data-admin-header="" style={formStyles.header}>
        <h5 style={formStyles.title}>Edit delivery · Challan #{challan.challanNumber}</h5>
        <button type="button" aria-label="Close delivery editor" style={{ ...formStyles.closeButton, minHeight: 44, minWidth: 44 }} disabled={saving} onClick={saved ? () => onSaved(snapshot.bill) : onClose}>×</button>
      </div>
      <div data-admin-body="" style={{ ...formStyles.body, minWidth: 0 }}>
        {!permitted && <p role="alert">Challan-edit and bill-edit permissions are required.</p>}
        {error && <p ref={errorRef} role="alert" style={{ padding: 12, background: colors.dangerLight, color: colors.danger, borderRadius: 8 }}>{error}</p>}
        {permitted && !snapshot && !error && <p role="status">Loading delivery and linked bill…</p>}
        {saved ? <div role="status"><h3>Challan and bill saved</h3><p>Bill #{snapshot.bill.invoiceNumber} now reflects this delivery. Rates, taxes, stock and accounting were reconciled together.</p></div> : snapshot && <>
          <p style={{ overflowWrap: "anywhere" }}><strong>{snapshot.bill.clientName}</strong> · Bill #{snapshot.bill.invoiceNumber}</p>
          <p>Changes apply to this challan and its linked bill together. Existing rates are filled in. Enter rates excluding GST, including 0 explicitly for free items. Delivery changes are locked once FBR submission starts.</p>
          {!review ? <LineItemsEditor items={items} onItemsChange={setItems} makeBlankItem={blank} units={units}
            itemTypes={itemTypes} nonInventoryItems={nonInvItems} divisionId={challan.divisionId || null}
            showUnitPrice coerceEmptyQtyToOne itemsLabel="Delivery items and bill rates" /> : <>
            <h3>Review delivery changes</h3>
            <p>{impact.added} added · {impact.removed} removed · {changes.filter(i => i.label === "Changed").length} changed</p>
            {changes.map((i,index) => <div key={i.id || `new-${index}`} style={{ padding: 10, borderBottom: `1px solid ${colors.cardBorder}`, overflowWrap: "anywhere" }}>
              <strong>{i.label}</strong> · {i.description}<div>{i.quantity} {i.unit} × Rs {money(i.unitPrice)} = Rs {money(Number(i.quantity) * Number(i.unitPrice))}</div>
            </div>)}
            {snapshot.challan.items.filter(i => !items.some(row => row.id === i.id)).map(i => <p key={i.id} style={{ color: colors.danger, overflowWrap: "anywhere" }}>Removed: {i.description} ({i.quantity} {i.unit})</p>)}
          </>}
          <section aria-label="Estimated bill impact" aria-live="polite" style={{ background: colors.inputBg, padding: 14, marginTop: 16, borderRadius: 10, border: `1px solid ${colors.cardBorder}` }}>
            <strong>Estimated bill totals</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px,100%),1fr))", gap: 10, marginTop: 10 }}>
              <span>Subtotal: Rs {money(impact.subtotal)}</span><span>GST: Rs {money(impact.gst)}</span>
              <span>Freight unchanged: Rs {money(snapshot.bill.freightCharges)}</span>
              <strong>Previous total: Rs {money(Number(snapshot.bill.grandTotal) + Number(snapshot.bill.freightCharges || 0))}</strong>
              <strong>New total: Rs {money(impact.total)}</strong>
              <span>Collectible: Rs {money(impact.collectible)}</span><span>Receipts allocated: Rs {money(snapshot.bill.amountPaid)}</span>
            </div>
            {paidConflict && <p role="alert" style={{ color: colors.danger }}>The new collectible amount is below allocated receipts. Reallocate receipts before reducing this bill.</p>}
          </section>
        </>}
      </div>
      <div data-admin-footer="" style={{ ...formStyles.footer, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {saved ? <button type="button" style={{ ...button, ...formStyles.submit }} onClick={() => onSaved(snapshot.bill)}>Done</button> : <>
          <button type="button" style={{ ...button, ...formStyles.cancel }} disabled={saving} onClick={review ? () => setReview(false) : onClose}>{review ? "Back to items" : "Cancel"}</button>
          {snapshot && permitted && <button type="submit" style={{ ...button, ...formStyles.submit, opacity: saving || !impact?.valid || paidConflict || !changed ? 0.6 : 1 }} disabled={saving || !impact?.valid || paidConflict || !changed}>{saving ? "Saving…" : review ? "Save challan & update bill" : "Review changes"}</button>}
        </>}
      </div>
    </form>
  </div>;
}
