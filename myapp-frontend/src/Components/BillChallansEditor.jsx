import { createPortal } from "react-dom";
import BilledChallanEditForm from "./BilledChallanEditForm";
import { useEffect, useRef, useState } from "react";
import { getBillChallans, updateBillChallans } from "../api/invoiceApi";
import { notify } from "../utils/notify";
import { formStyles } from "../theme";

const amount = (n) => Number(n).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lineRow = { display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid #d8e1eb", marginTop: 10, paddingTop: 10, minHeight: 44, cursor: "pointer" };
const tick = { width: 20, height: 20, flexShrink: 0, cursor: "pointer" };
const button = { minHeight: 44, padding: "0.5rem 0.8rem", border: "1px solid #ccd6e2", borderRadius: 6, background: "#fff", color: "#183c68", cursor: "pointer" };

export default function BillChallansEditor({ invoice, onClose, onSaved, canAttachToOrder = false }) {
  const [deliveryEdit, setDeliveryEdit] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [attachAdded, setAttachAdded] = useState(canAttachToOrder);
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState(new Map());
  const [rates, setRates] = useState({});
  // Lines of the selected challans to leave off this bill. Each goes back to a
  // pending row of its challan (same number) and can be billed later.
  const [leaveOut, setLeaveOut] = useState(new Set());
  const toggleLine = (id) => setLeaveOut(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  async function load(term, initial = false) {
    const seq = ++request.current;
    setLoading(true);
    setError("");
    try {
      const { data } = await getBillChallans(invoice.id, term);
      if (seq !== request.current) return;
      setOptions(data.available);
      setHasMore(data.hasMore);
      if (initial) {
        setSnapshot(data);
        setSelected(new Map(data.linked.map(c => [c.id, c])));
      }
    } catch (e) {
      if (seq === request.current) setError(e.response?.data?.error || e.response?.data?.message || "Could not load challans. Close this window and refresh the bill.");
    } finally {
      if (seq === request.current) setLoading(false);
    }
  }
  useEffect(() => { load("", true); return () => { request.current += 1; }; }, [invoice.id]);
  // Search as the user types: challan number, PO or item, matched server-side.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) return;
    const t = setTimeout(() => load(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const bill = snapshot?.bill || invoice;
  const linked = new Set(snapshot?.linked.map(c => c.id) || []);
  const added = [...selected.values()].filter(c => !linked.has(c.id));
  const removed = snapshot?.linked.filter(c => !selected.has(c.id)) || [];
  const removedItemIds = new Set(removed.flatMap(c => c.items.map(i => i.id)));
  const selectedLineIds = new Set([...selected.values()].flatMap(c => c.items.map(i => i.id)));
  const leftOut = [...leaveOut].filter(id => selectedLineIds.has(id));
  const billed = (i) => !leaveOut.has(i.id);
  // Lines this bill actually carries. A challan attached for reference has none.
  const onBill = new Set((bill.items || []).map(i => i.deliveryItemId).filter(Boolean));
  const emptied = [...selected.values()].find(c => c.items.length > 0 && c.items.every(i => leaveOut.has(i.id)));
  const retainedLines = bill.items.filter(i => !removedItemIds.has(i.deliveryItemId) && !leaveOut.has(i.deliveryItemId));
  const validRates = added.every(c => c.items.length > 0 && c.items.filter(billed).every(i => rates[i.id] !== undefined
    && rates[i.id] !== "" && Number.isFinite(Number(rates[i.id])) && Number(rates[i.id]) >= 0 && Number(rates[i.id]) < 1000000));
  const rounded = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const subtotal = rounded(retainedLines.reduce((s, i) => s + Number(i.lineTotal), 0)
    + added.flatMap(c => c.items).filter(billed).reduce((s, i) => s + rounded(Number(i.quantity) * Number(rates[i.id] || 0)), 0));
  const gst = rounded(subtotal * Number(bill.gstRate || 0) / 100);
  const further = rounded(subtotal * Number(bill.furtherTaxRate || 0) / 100);
  const grandTotal = rounded(subtotal + gst + further);
  const withholding = Math.max(0, Math.min(grandTotal, bill.withholdingTaxRate != null ? rounded(grandTotal * Number(bill.withholdingTaxRate) / 100)
    : Number(bill.withholdingTaxAmount || 0)));
  const collectible = Math.max(0, rounded(grandTotal + Number(bill.freightCharges || 0) - withholding));
  const changed = added.length > 0 || removed.length > 0 || leftOut.length > 0;
  const hasItems = retainedLines.length + added.reduce((n, c) => n + c.items.filter(billed).length, 0) > 0;

  function toggle(c) {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id); else next.set(c.id, c);
      return next;
    });
  }
  async function save(e) {
    e.preventDefault();
    if (!snapshot || !changed || !validRates || !hasItems || emptied || saving) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await updateBillChallans(invoice.id, {
        version: snapshot.version,
        ...(canAttachToOrder && bill.salesOrders?.length === 1 ? { attachAddedChallansToOrder: attachAdded } : {}),
        challanIds: [...selected.keys()],
        addedChallanVersions: Object.fromEntries(added.map(c => [c.id, c.version])),
        unitPrices: Object.fromEntries(added.flatMap(c => c.items.filter(billed).map(i => [i.id, Number(rates[i.id])]))),
        leaveOutDeliveryItemIds: leftOut
      });
      if (data.stockWarnings?.length) notify(data.stockWarnings.map(w => `${w.itemTypeName}: stock is ${w.onHand}`).join("; "), "warning");
      notify("Bill saved. Next: the tax consultant must review all current items in Invoices and choose Complete review. FBR submission is blocked until then.", "info");
      onSaved(data);
    } catch (e) {
      setError(e.response?.data?.error || e.response?.data?.message || "Could not save challans. Refresh the bill and review your selection.");
    } finally { setSaving(false); }
  }

  const visible = [...(snapshot?.linked || []), ...[...selected.values()].filter(c => !linked.has(c.id)),
    ...options.filter(c => !selected.has(c.id) && !linked.has(c.id))];
  return <div data-admin-backdrop="" style={{ ...formStyles.backdrop, zIndex: 1500 }}>
    <form data-admin-dialog="" onSubmit={save} aria-label="Manage bill challans" style={{ ...formStyles.modal, width: "96vw", maxWidth: 820 }}>
      <div data-admin-header="" style={formStyles.header}>
        <h5 style={formStyles.title}>Manage challans · Bill #{bill.invoiceNumber}</h5>
        <button data-admin-close="" type="button" disabled={saving} style={{ ...formStyles.closeButton, minHeight: 44, minWidth: 44 }} onClick={onClose} aria-label="Close challan selection">×</button>
      </div>
      <div data-admin-body="" style={{ ...formStyles.body, minWidth: 0 }}>
        <p>Choose challans for <strong>{bill.clientName}</strong>. Retained items keep their rates and adjustments. Removed challans become available for billing again. Untick a single line to bill it later: it goes back to its challan as pending.</p>
        <p role="note"><strong>Next step after saving:</strong> consultant review is required, even when totals still match. The consultant checks the changed bill in Invoices and completes review before FBR validation or submission.</p>
        {error && <div role="alert" style={{ color: "#a21525", background: "#fff0f1", padding: 12, marginBottom: 12 }}>{error}</div>}
        <div style={{ marginBottom: 12 }}>
          <input type="search" aria-label="Search challans" placeholder="Search by challan number, PO or item" value={search} disabled={saving}
            onChange={e => { typed.current = true; setSearch(e.target.value); }}
            onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }}
            style={{ boxSizing: "border-box", width: "100%", minHeight: 44, padding: 8 }} />
        </div>
        {hasMore && <p>Showing 100 available challans. Search by number or PO to find more.</p>}
        {loading && <p role="status">Loading challans…</p>}
        {!loading && snapshot && visible.length === 0 && <p>No available challans for this customer.</p>}
        {visible.map(c => <section key={c.id} style={{ border: "1px solid #d8e1eb", borderRadius: 8, padding: 12, marginBottom: 12, background: selected.has(c.id) ? "#f5f9ff" : "white" }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              <strong>DC#{c.challanNumber}</strong> · {c.deliveryDate?.slice(0, 10) || "No date"} · {linked.has(c.id) ? "Currently on bill" : c.splitFromChallanId ? "Remaining lines" : "Available"}
              <div>PO: {c.poNumber || "None"} · Record {c.id}</div>
            </div>
            <button type="button" style={button} disabled={saving || loading || (!linked.has(c.id) && c.items.length === 0)} onClick={() => toggle(c)}
              aria-label={`${selected.has(c.id) ? "Remove" : "Add"} challan ${c.challanNumber} record ${c.id}`}>
              {selected.has(c.id) ? "Remove" : linked.has(c.id) ? "Keep" : "Add"}
            </button>
          </div>
          {canAttachToOrder && linked.has(c.id) && !c.hasAutoPurchaseBills && <button type="button" style={{ ...button, marginTop: 8 }} disabled={saving || loading || changed}
            onClick={() => setDeliveryEdit({ id: c.id, companyId: bill.companyId, challanNumber: c.challanNumber })}>Edit delivery & update bill</button>}
          {selected.has(c.id) && linked.has(c.id) && !c.items.some(i => onBill.has(i.id)) && <p style={{ marginTop: 10, color: "#5f6d7e" }}>Attached for reference: its lines are not billed on this bill.</p>}
          {selected.has(c.id) && linked.has(c.id) && c.items.filter(i => onBill.has(i.id)).map(i => <label key={i.id} style={{ ...lineRow, opacity: leaveOut.has(i.id) ? 0.55 : 1 }}>
            <input type="checkbox" checked={!leaveOut.has(i.id)} disabled={saving} onChange={() => toggleLine(i.id)} aria-label={`Bill ${i.description} on this bill`} style={tick} />
            <span style={{ overflowWrap: "anywhere", minWidth: 0 }}>{i.description} <small>· {i.quantity} {i.unit}</small>
              {leaveOut.has(i.id) && <small style={{ display: "block", color: "#8a5a00" }}>Will go back to the challan as pending</small>}</span>
          </label>)}
          {selected.has(c.id) && !linked.has(c.id) && c.items.map(i => <div key={i.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", borderTop: "1px solid #d8e1eb", marginTop: 10, paddingTop: 10, opacity: leaveOut.has(i.id) ? 0.55 : 1 }}>
            <input type="checkbox" checked={!leaveOut.has(i.id)} disabled={saving} onChange={() => toggleLine(i.id)} aria-label={`Bill ${i.description} now`} style={tick} />
            <span style={{ overflowWrap: "anywhere", flex: "1 1 160px", minWidth: 0 }}>{i.description}<br /><small>{i.quantity} {i.unit}{leaveOut.has(i.id) ? " · billed later" : ""}</small></span>
            {!leaveOut.has(i.id) && <label style={{ flex: "1 1 220px", minWidth: 0 }}>Unit rate excluding GST
              <input aria-label={`Unit rate for ${i.description}`} type="number" min="0" max="999999.999999999999" step="any" required value={rates[i.id] ?? ""} disabled={saving}
                onChange={e => setRates(prev => ({ ...prev, [i.id]: e.target.value }))}
                style={{ display: "block", boxSizing: "border-box", width: "100%", minHeight: 44, padding: 8 }} />
            </label>}
          </div>)}
          {!selected.has(c.id) && linked.has(c.id) && <p style={{ color: "#a21525" }}>Will be removed from this bill. Its source items will be preserved.</p>}
          {c.items.length === 0 && <p>This challan has no items and cannot be added.</p>}
        </section>)}
        {snapshot && bill.salesOrders?.length === 1 && canAttachToOrder && <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
          <input type="checkbox" checked={attachAdded} onChange={e => setAttachAdded(e.target.checked)} />Attach newly added unlinked challans to sales order #{bill.salesOrders[0].number || bill.salesOrders[0].id}. Matching ordered lines and customer PO are required. Untick to keep their delivery independent.
        </label>}
        {snapshot && bill.salesOrders?.length > 1 && <p>This bill spans multiple orders. Existing order links are preserved. Attach unlinked challans to the intended order on the Sales Orders page first.</p>}
        {snapshot && <div aria-live="polite" style={{ padding: 12, border: "1px solid #d8e1eb", borderRadius: 8 }}>
          <div>Selected: {selected.size} challan(s) · Adding {added.length} · Removing {removed.length}</div>
          <div>Subtotal: Rs {amount(subtotal)} · GST: Rs {amount(gst)}{further > 0 && ` · Further tax: Rs ${amount(further)}`}</div>
          <strong>New bill total: Rs {amount(grandTotal)}</strong>
          <div>Withholding: Rs {amount(withholding)} · Freight: Rs {amount(bill.freightCharges || 0)}</div>
          <div>Collectible: Rs {amount(collectible)}</div>
          {!validRates && <p>Enter a rate for every newly added item. Enter 0 explicitly for a free item.</p>}
          {!hasItems && <p role="alert">Keep at least one item. To remove the final challan, replace it or void the bill.</p>}
          {leftOut.length > 0 && <div>Leaving out {leftOut.length} line(s): they go back to their challans as pending.</div>}
          {emptied && <p role="alert">Every line of DC#{emptied.challanNumber} is unticked. Remove the whole challan instead.</p>}
        </div>}
      </div>
      {deliveryEdit && createPortal(<BilledChallanEditForm challan={deliveryEdit} onClose={() => setDeliveryEdit(null)}
        onSaved={() => { setDeliveryEdit(null); onSaved(bill); }} />, document.body)}
      <div style={{ ...formStyles.footer, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button data-admin-close="" type="button" style={button} disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" style={{ ...button, background: "#0d47a1", color: "white" }} disabled={!snapshot || loading || saving || !changed || !validRates || !hasItems || !!emptied}>
          {saving ? "Saving…" : "Save challans"}
        </button>
      </div>
    </form>
  </div>;
}
