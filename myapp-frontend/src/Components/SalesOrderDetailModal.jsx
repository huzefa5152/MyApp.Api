import { useNavigate } from "react-router-dom";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "./ConfirmDialog";
import { notify } from "../utils/notify";
import { getDeliveryChallanById, cancelChallan, deleteChallan } from "../api/challanApi";
import ChallanEditForm from "./ChallanEditForm";
import { useState, useEffect } from "react";
import RichText from "./RichText";
import {
  MdClose, MdPrint, MdLocalShipping, MdEdit, MdInventory2, MdReceiptLong, MdLink,
} from "react-icons/md";
import { getSalesOrderChallans, getSalesOrderById } from "../api/salesOrderApi";
import AttachmentManager from "./AttachmentManager";
import { formStyles } from "../theme";
import { Facts, TableWrap, Loading } from "../ui/Kit";

const FULFIL_COLORS = {
  "Not Delivered": "#5f6d7e", "Partially Delivered": "#f57c00",
  "Fully Delivered": "#28a745", "Over Delivered": "#7b1fa2",
};
const INVOICE_COLORS = { "Uninvoiced": "#5f6d7e", "Partially Invoiced": "#f57c00", "Invoiced": "#28a745" };
const LINE_COLORS = { Pending: "#5f6d7e", Partial: "#f57c00", Complete: "#28a745", Over: "#7b1fa2" };

/**
 * Read-only Sales Order detail with delivery drill-down. Shows the order
 * header, every line's ordered/delivered/remaining, and each delivery challan
 * raised against the order (with the lines it delivered). Optional action
 * callbacks (print / edit / deliver) let the parent launch those flows.
 */
export default function SalesOrderDetailModal({ order: initialOrder, onChanged, companyId, onClose, onPrint, onEdit, onDeliver, canDeliver, canBill, canAttach, onGenerateBill, onAttach, onViewChallans }) {
  const [order, setOrder] = useState(initialOrder);
  const [editingChallan, setEditingChallan] = useState(null);
  const [busy, setBusy] = useState(false);
  const { has } = usePermissions();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [narrow, setNarrow] = useState(window.innerWidth < 760);
  useEffect(() => { const resize = () => setNarrow(window.innerWidth < 760); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  const refresh = async () => {
    const [nextOrder, nextChallans] = await Promise.all([getSalesOrderById(order.id), getSalesOrderChallans(order.id)]);
    setOrder(nextOrder.data); setChallans(nextChallans.data || []); onChanged?.(nextOrder.data);
  };
  const editChallan = async c => {
    try { const { data } = await getDeliveryChallanById(c.id); setEditingChallan(data); }
    catch (e) { notify(e.response?.data?.error || "Could not open challan.", "error"); }
  };
  const removeChallan = async (c, action) => {
    if (!await confirm({ title: `${action === "delete" ? "Delete" : "Cancel"} challan #${c.challanNumber}?`,
      message: `Delivered quantities and order status will update.${c.invoiceId ? ` Bill #${c.invoiceNumber} will lose this challan's items, its totals will recalculate, and consultant review will be required. An empty bill is refused: replace its challan or cancel the bill first.` : ""}`,
      confirmText: action === "delete" ? "Delete challan" : "Cancel challan", variant: "danger" })) return;
    setBusy(true);
    try { await (action === "delete" ? deleteChallan(c.id) : cancelChallan(c.id)); await refresh(); notify("Challan, bill and order updated. Check the bill's consultant review status.", "success"); }
    catch (e) { notify(e.response?.data?.error || "Could not change challan.", "error"); }
    finally { setBusy(false); }
  };
  const [challans, setChallans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!order?.id) return;
    let cancelled = false;
    setLoading(true);
    getSalesOrderChallans(order.id)
      .then(({ data }) => { if (!cancelled) setChallans(data || []); })
      .catch(() => { if (!cancelled) setChallans([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [order?.id]);

  if (!order) return null;
  if (editingChallan) return <ChallanEditForm challan={editingChallan} onClose={() => setEditingChallan(null)} onSaved={async () => { setEditingChallan(null); await refresh(); notify("Delivery and bill updated. Review the bill before FBR submission.", "success"); }} />;

  const items = order.items || [];
  const totalOrdered = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  const totalDelivered = items.reduce((s, i) => s + (Number(i.deliveredQuantity) || 0), 0);
  const totalRemaining = items.reduce((s, i) => s + (Number(i.remainingQuantity) || 0), 0);
  const activeChallans = challans.filter((c) => c.status !== "Cancelled");
  const billedChallans = activeChallans.filter((c) => c.invoiceId);
  const billableChallans = activeChallans.filter((c) => !c.invoiceId && (c.status === "Pending" || c.status === "Imported"));
  const distinctBills = new Set(billedChallans.map((c) => c.invoiceId)).size;

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ ...formStyles.header, alignItems: "flex-start", gap: "1rem" }}>
          <div style={{ minWidth: 0 }}>
            <div style={st.hTitleRow}>
              <h5 style={formStyles.title}>Sales Order #{order.salesOrderNumber}</h5>
              <span style={{ ...st.badge, background: `${FULFIL_COLORS[order.fulfillmentStatus] || "#5f6d7e"}22`, color: FULFIL_COLORS[order.fulfillmentStatus] || "#5f6d7e" }}>
                {order.fulfillmentStatus}
              </span>
              <span style={{ ...st.badge, ...st.statusBadge }}>{order.status}</span>
              <span style={{ ...st.badge, background: "#ffffffee", color: INVOICE_COLORS[order.invoiceStatus] || "#5f6d7e" }}>{({ Invoiced: "Billed", "Partially Invoiced": "Partially billed", Uninvoiced: "Unbilled" })[order.invoiceStatus] || order.invoiceStatus}</span>
            </div>
            <div style={st.hClient}>{order.clientName}</div>
          </div>
          <button data-admin-close="" style={formStyles.closeButton} onClick={onClose} title="Close" aria-label="Close"><MdClose size={22} /></button>
        </div>

        <div style={{ ...formStyles.body, maxHeight: "none" }}>
          {/* Meta */}
          <Facts
            facts={[
              ["Order Date", fmtDate(order.orderDate)],
              order.requiredDate && ["Required Date", fmtDate(order.requiredDate)],
              order.customerPoNumber && ["Customer PO", order.customerPoNumber + (order.customerPoDate ? ` (${fmtDate(order.customerPoDate)})` : "")],
              order.salesQuoteNumber && ["Source Quote", `#${order.salesQuoteNumber}`],
              order.site && ["Site", order.site],
              order.isImported && ["Origin", "Imported (PO)"],
            ]}
          />

          {order.needsAttention && <p role="status" style={{ color: "#b45309" }}>This order was manually closed but delivery or billing is incomplete. Reopen it to continue fulfillment.</p>}
          <p style={{ color: colors.textSecondary }}>Ordered quantities record the customer's commitment. Delivery and billing changes update delivered, remaining and billed status automatically.</p>
          {/* Line items */}
          <div style={st.sectionTitle}><MdInventory2 size={16} color="var(--k-blue)" /> Items ({items.length})</div>
          {narrow ? <div>{items.map(i => <div key={i.id} style={{ ...st.challanCard, padding: 12, marginBottom: 8 }}><RichText text={i.description} /><div>Ordered: {fmtQty(i.quantity)} {i.unit}</div><div>Delivered: {fmtQty(i.deliveredQuantity)} · Remaining: {fmtQty(i.remainingQuantity)}</div><strong>{i.lineStatus}</strong></div>)}</div> : <TableWrap data-admin-table-region="" style={st.tableWrap}>
            <table className="k-table k-table--compact">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th>Description</th>
                  <th className="k-num">Ordered</th>
                  <th className="k-num">Delivered</th>
                  <th className="k-num">Remaining</th>
                  <th className="is-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={i.id ?? idx}>
                    <td style={st.top}>{idx + 1}</td>
                    <td style={st.top}>
                      <div style={st.itemDesc}><RichText text={i.description} /></div>
                      {i.itemTypeName && <div style={st.itemType}>{i.itemTypeName}</div>}
                      {i.unitPrice != null && Number(i.unitPrice) > 0 && (
                        <div style={st.itemType}>@ Rs {Number(i.unitPrice).toLocaleString()}</div>
                      )}
                    </td>
                    <td className="k-num" style={st.numCell}>{fmtQty(i.quantity)} {i.unit}</td>
                    <td className="k-num" style={{ ...st.numCell, fontWeight: 700, color: "var(--k-teal)" }}>{fmtQty(i.deliveredQuantity)}</td>
                    <td className="k-num" style={st.numCell}>{fmtQty(i.remainingQuantity)}</td>
                    <td className="is-center" style={st.top}>
                      <span style={{ ...st.lineBadge, background: `${LINE_COLORS[i.lineStatus] || "#5f6d7e"}18`, color: LINE_COLORS[i.lineStatus] || "#5f6d7e" }}>{i.lineStatus}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total Quantity</td>
                  <td className="k-num">{fmtQty(totalOrdered)}</td>
                  <td className="k-num" style={{ color: "var(--k-teal)" }}>{fmtQty(totalDelivered)}</td>
                  <td className="k-num">{fmtQty(totalRemaining)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>

          }

          {/* Attached challans */}
          <div style={st.sectionTitle}>
            <MdLocalShipping size={16} color="var(--k-blue)" /> Delivery Challans ({activeChallans.length})
          </div>
          {activeChallans.length > 0 && (
            <div style={st.billSummary}>
              <span><strong>{billedChallans.length}</strong>/{activeChallans.length} billed{distinctBills > 0 ? ` · ${distinctBills} bill${distinctBills !== 1 ? "s" : ""}` : ""}</span>
              <span style={{ color: billableChallans.length ? "var(--k-teal)" : "var(--k-muted)" }}>
                {billableChallans.length} billable now
              </span>
            </div>
          )}
          {loading ? (
            <Loading>Loading challans…</Loading>
          ) : challans.length === 0 ? (
            <div style={st.empty}>No delivery challans raised against this order yet.</div>
          ) : (
            <div style={st.challanList}>
              {challans.map((c) => {
                const cancelled = c.status === "Cancelled";
                return (
                  <div key={c.id} style={{ ...st.challanCard, opacity: cancelled ? 0.6 : 1 }}>
                    <div style={st.challanHead}>
                      <span style={st.challanNo}><MdReceiptLong size={15} /> Challan #{c.challanNumber}</span>
                      <span style={st.challanDate}>{fmtDate(c.deliveryDate)}</span>
                      <span style={{ ...st.challanStatus, color: cancelled ? "#dc3545" : "var(--k-teal)", background: cancelled ? "#fff0f1" : "#e6f4f1" }}>
                        {c.status}{c.isImported ? " · Imported" : ""}
                      </span>
                      {c.invoiceId
                        ? <span style={st.billedPill}>Billed{c.invoiceNumber ? ` · #${c.invoiceNumber}` : ""}</span>
                        : (!cancelled && <span style={st.unbilledPill}>Unbilled</span>)}
                      <span style={st.challanQty}>{fmtQty(c.totalQuantity)} delivered</span>
                    </div>
                    <div style={{ padding: "8px 12px", display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {c.invoiceId && <span>FBR: {c.fbrStatus || "Not submitted"}{c.needsConsultantReview ? " · Needs consultant review" : ""}</span>}
                      {c.invoiceId && has("bills.list.view") && <button style={st.btnGhost} onClick={() => navigate(`/bills?viewBill=${c.invoiceId}`)}>Open bill #{c.invoiceNumber}</button>}
                      {c.isEditable && (!c.invoiceId || has("bills.manage.update")) && <>
                        {has("challans.manage.update") && <button disabled={busy} style={st.btnGhost} onClick={() => editChallan(c)}>Edit challan</button>}
                        {has("challans.manage.update") && <button disabled={busy} style={st.btnGhost} onClick={() => removeChallan(c, "cancel")}>Cancel challan</button>}
                        {c.canDelete && has("challans.manage.delete") && <button disabled={busy} style={st.btnGhost} onClick={() => removeChallan(c, "delete")}>Delete challan</button>}
                      </>}
                      {!cancelled && !c.isEditable && <span>Delivery locked: the linked bill is cancelled or FBR submission has started.</span>}
                    </div>
                    <div style={st.challanLines}>
                      {(c.lines || []).map((l, li) => (
                        <div key={li} style={st.challanLine}>
                          <span style={st.clDesc}><RichText text={l.description} /></span>
                          <span style={st.clQty}>{fmtQty(l.quantity)} {l.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {companyId && (
            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager companyId={companyId} entityType="SalesOrder" entityId={order.id} mode="view" />
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ ...formStyles.footer, justifyContent: "space-between", alignItems: "center" }}>
          <button data-admin-close="" style={st.btnGhost} onClick={onClose}>Close</button>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {onEdit && order.isEditable && <button data-admin-close="" style={st.btnGhost} onClick={() => { onClose(); onEdit(order); }}><MdEdit size={15} /> Edit</button>}
            {onViewChallans && activeChallans.length > 0 && <button style={st.btnGhost} onClick={() => onViewChallans(order)}><MdLocalShipping size={15} /> View Challans</button>}
            {onAttach && canAttach && <button style={st.btnGhost} onClick={() => onAttach(order)}><MdLink size={15} /> Attach Challan</button>}
            {onPrint && <button style={st.btnGhost} onClick={() => onPrint(order)}><MdPrint size={15} /> Print</button>}
            {onDeliver && canDeliver && <button data-admin-close="" style={st.btnTeal} onClick={() => { onClose(); onDeliver(order); }}><MdLocalShipping size={15} /> Create Challan</button>}
            {onGenerateBill && canBill && <button style={st.btnBlue} onClick={() => onGenerateBill(order)}><MdReceiptLong size={15} /> Generate Bill</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

const fmtDate = (d) => { if (!d) return "—"; const dt = new Date(d); const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${String(dt.getDate()).padStart(2,"0")}-${m[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`; };
const fmtQty = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(4)).toString(); };

const btnBase = { ...formStyles.button, display: "inline-flex", alignItems: "center", gap: "0.35rem" };

const st = {
  hTitleRow: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" },
  // The client line sits in the dialog header, so it follows the header's title colour
  // (white on the classic gradient, ink on the workspace light header).
  hClient: { marginTop: "0.3rem", fontSize: "calc(var(--k-font) + 0.05rem)", opacity: 0.95, color: "var(--ui-modal-title-color, #fff)" },
  badge: { fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.6rem", borderRadius: 20 },
  statusBadge: { background: "rgba(255,255,255,0.2)", color: "var(--ui-modal-title-color, #fff)", border: "1px solid var(--ui-modal-title-color, rgba(255,255,255,0.33))" },
  sectionTitle: { display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "var(--k-font)", fontWeight: 700, color: "var(--k-ink)", margin: "1.1rem 0 0.6rem" },
  tableWrap: { marginBottom: "0.4rem", boxShadow: "none" },
  top: { verticalAlign: "top" },
  numCell: { verticalAlign: "top", whiteSpace: "nowrap" },
  itemDesc: { fontWeight: 600, color: "var(--k-ink)", whiteSpace: "pre-wrap" },
  itemType: { fontSize: "0.72rem", color: "var(--k-muted)", marginTop: "0.1rem" },
  lineBadge: { fontSize: "0.7rem", fontWeight: 700, padding: "0.12rem 0.5rem", borderRadius: 20, whiteSpace: "nowrap" },
  challanList: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  challanCard: { border: "1px solid var(--k-line)", borderRadius: "var(--k-radius)", overflow: "hidden" },
  challanHead: { display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.55rem 0.75rem", background: "var(--k-surface-2)", borderBottom: "1px solid var(--k-line)" },
  challanNo: { display: "inline-flex", alignItems: "center", gap: "0.3rem", fontWeight: 800, color: "var(--k-blue)", fontSize: "var(--k-font)" },
  challanDate: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  challanStatus: { fontSize: "0.72rem", fontWeight: 700, padding: "0.12rem 0.55rem", borderRadius: 20 },
  billedPill: { fontSize: "0.68rem", fontWeight: 700, padding: "0.1rem 0.5rem", borderRadius: 20, color: "#0d47a1", background: "#e3f0ff" },
  unbilledPill: { fontSize: "0.68rem", fontWeight: 700, padding: "0.1rem 0.5rem", borderRadius: 20, color: "#8a6d00", background: "#fff6db" },
  challanQty: { marginLeft: "auto", fontSize: "var(--k-font-sm)", fontWeight: 800, color: "var(--k-teal)" },
  challanLines: { padding: "0.4rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.25rem" },
  challanLine: { display: "flex", justifyContent: "space-between", gap: "0.75rem", fontSize: "var(--k-font-sm)" },
  clDesc: { color: "var(--k-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 },
  clQty: { fontWeight: 700, color: "var(--k-ink)", flexShrink: 0, whiteSpace: "nowrap" },
  empty: { color: "var(--k-muted)", fontSize: "var(--k-font)", fontStyle: "italic", padding: "0.75rem", border: "1px dashed var(--k-line-strong)", borderRadius: "var(--k-radius)", background: "var(--k-surface-2)" },
  btnGhost: { ...btnBase, ...formStyles.cancel },
  btnTeal: { ...btnBase, background: "var(--k-teal)", color: "#fff" },
  btnBlue: { ...btnBase, ...formStyles.submit },
  billSummary: { display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", fontSize: "var(--k-font-sm)", color: "var(--k-muted)", background: "var(--k-surface-2)", border: "1px solid var(--k-line)", borderRadius: 8, padding: "0.5rem 0.75rem", marginBottom: "0.6rem" },
};
