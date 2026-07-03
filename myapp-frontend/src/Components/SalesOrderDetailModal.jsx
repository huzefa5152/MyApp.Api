import { useState, useEffect } from "react";
import {
  MdClose, MdPrint, MdLocalShipping, MdEdit, MdInventory2, MdReceiptLong,
} from "react-icons/md";
import { getSalesOrderChallans } from "../api/salesOrderApi";
import AttachmentManager from "./AttachmentManager";
import RichText from "./RichText";

const colors = {
  blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332", textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3", inputBorder: "#d0d7e2", bg: "#f7f9fc",
};

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
export default function SalesOrderDetailModal({ order, onClose, onPrint, onEdit, onDeliver, onGenerateBill, canDeliver }) {
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

  const items = order.items || [];
  const totalOrdered = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  const totalDelivered = items.reduce((s, i) => s + (Number(i.deliveredQuantity) || 0), 0);
  const totalRemaining = items.reduce((s, i) => s + (Number(i.remainingQuantity) || 0), 0);
  const activeChallans = challans.filter((c) => c.status !== "Cancelled");
  // Only "Pending"/"Imported" challans can be billed (the create path rejects
  // "No PO"/"Setup Required" — they need a PO / FBR setup first).
  const billableChallans = activeChallans.filter((c) => c.status === "Pending" || c.status === "Imported");

  return (
    <div style={st.backdrop} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={st.header}>
          <div>
            <div style={st.hTitleRow}>
              <span style={st.hTitle}>Sales Order #{order.salesOrderNumber}</span>
              <span style={{ ...st.badge, background: `${FULFIL_COLORS[order.fulfillmentStatus] || "#5f6d7e"}22`, color: FULFIL_COLORS[order.fulfillmentStatus] || "#5f6d7e" }}>
                {order.fulfillmentStatus}
              </span>
              <span style={{ ...st.badge, background: "#ffffff33", color: "#fff", border: "1px solid #ffffff55" }}>{order.status}</span>
              <span style={{ ...st.badge, background: "#ffffffee", color: INVOICE_COLORS[order.invoiceStatus] || "#5f6d7e" }}>{order.invoiceStatus}</span>
            </div>
            <div style={st.hClient}>{order.clientName}</div>
          </div>
          <button style={st.close} onClick={onClose} title="Close"><MdClose size={22} /></button>
        </div>

        <div style={st.body}>
          {/* Meta */}
          <div style={st.metaGrid}>
            <Meta label="Order Date" value={fmtDate(order.orderDate)} />
            {order.requiredDate && <Meta label="Required Date" value={fmtDate(order.requiredDate)} />}
            {order.customerPoNumber && <Meta label="Customer PO" value={order.customerPoNumber + (order.customerPoDate ? ` (${fmtDate(order.customerPoDate)})` : "")} />}
            {order.salesQuoteNumber && <Meta label="Source Quote" value={`#${order.salesQuoteNumber}`} />}
            {order.divisionName && <Meta label="Division" value={order.divisionName} />}
            {order.site && <Meta label="Site" value={order.site} />}
            {order.isImported && <Meta label="Origin" value="Imported (PO)" />}
          </div>

          {/* Line items */}
          <div style={st.sectionTitle}><MdInventory2 size={16} color={colors.blue} /> Items ({items.length})</div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={{ ...st.th, width: 28 }}>#</th>
                  <th style={st.th}>Description</th>
                  <th style={{ ...st.th, ...st.num }}>Ordered</th>
                  <th style={{ ...st.th, ...st.num }}>Delivered</th>
                  <th style={{ ...st.th, ...st.num }}>Remaining</th>
                  <th style={{ ...st.th, textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={i.id ?? idx}>
                    <td style={st.td}>{idx + 1}</td>
                    <td style={st.td}>
                      <div style={st.itemDesc}><RichText text={i.description} /></div>
                      {i.itemTypeName && <div style={st.itemType}>{i.itemTypeName}</div>}
                    </td>
                    <td style={{ ...st.td, ...st.num }}>{fmtQty(i.quantity)} {i.unit}</td>
                    <td style={{ ...st.td, ...st.num, fontWeight: 700, color: colors.teal }}>{fmtQty(i.deliveredQuantity)}</td>
                    <td style={{ ...st.td, ...st.num }}>{fmtQty(i.remainingQuantity)}</td>
                    <td style={{ ...st.td, textAlign: "center" }}>
                      <span style={{ ...st.lineBadge, background: `${LINE_COLORS[i.lineStatus] || "#5f6d7e"}18`, color: LINE_COLORS[i.lineStatus] || "#5f6d7e" }}>{i.lineStatus}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={st.tfoot} colSpan={2}>Total Quantity</td>
                  <td style={{ ...st.tfoot, ...st.num }}>{fmtQty(totalOrdered)}</td>
                  <td style={{ ...st.tfoot, ...st.num, color: colors.teal }}>{fmtQty(totalDelivered)}</td>
                  <td style={{ ...st.tfoot, ...st.num }}>{fmtQty(totalRemaining)}</td>
                  <td style={st.tfoot}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Attached challans */}
          <div style={st.sectionTitle}>
            <MdLocalShipping size={16} color={colors.blue} /> Delivery Challans ({activeChallans.length})
          </div>
          {loading ? (
            <div style={st.dim}>Loading challans…</div>
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
                      <span style={{ ...st.challanStatus, color: cancelled ? "#dc3545" : colors.teal, background: cancelled ? "#fff0f1" : "#e6f4f1" }}>
                        {c.status}{c.isImported ? " · Imported" : ""}
                      </span>
                      {c.invoiceId
                        ? <span style={st.billedPill}>Billed</span>
                        : (!cancelled && <span style={st.unbilledPill}>Unbilled</span>)}
                      <span style={st.challanQty}>{fmtQty(c.totalQuantity)} delivered</span>
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

          {/* Attachments — read-only (preview + download). */}
          <AttachmentManager companyId={order.companyId} entityType="SalesOrder" entityId={order.id} mode="view" />
        </div>

        {/* Footer actions */}
        <div style={st.footer}>
          <button style={st.btnGhost} onClick={onClose}>Close</button>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {onEdit && order.isEditable && <button style={st.btnGhost} onClick={() => { onClose(); onEdit(order); }}><MdEdit size={15} /> Edit</button>}
            {onPrint && <button style={st.btnGhost} onClick={() => onPrint(order)}><MdPrint size={15} /> Print</button>}
            {onDeliver && canDeliver && <button style={st.btnTeal} onClick={() => { onClose(); onDeliver(order); }}><MdLocalShipping size={15} /> Create Challan</button>}
            {onGenerateBill && billableChallans.length > 0 && <button style={st.btnBlue} onClick={() => { onClose(); onGenerateBill(order); }}><MdReceiptLong size={15} /> Generate Bill</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

const Meta = ({ label, value }) => (
  <div>
    <div style={st.metaLabel}>{label}</div>
    <div style={st.metaValue}>{value}</div>
  </div>
);

const fmtDate = (d) => { if (!d) return "—"; const dt = new Date(d); const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${String(dt.getDate()).padStart(2,"0")}-${m[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`; };
const fmtQty = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(4)).toString(); };

const st = {
  // zIndex 1100 matches the app's modal layer (theme.js formStyles.backdrop)
  // and sits above the sticky header/sidebar (z-index 1030–1040), so the app
  // chrome no longer clips the modal header.
  backdrop: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "2rem 1rem", zIndex: 1100, overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 760, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", maxHeight: "92vh", overflow: "hidden" },
  header: { background: `linear-gradient(135deg, ${colors.teal}, ${colors.blue})`, color: "#fff", padding: "1rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" },
  hTitleRow: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" },
  hTitle: { fontSize: "1.15rem", fontWeight: 800 },
  hClient: { marginTop: "0.3rem", fontSize: "0.95rem", opacity: 0.95 },
  badge: { fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.6rem", borderRadius: 20 },
  close: { background: "rgba(255,255,255,0.18)", border: "none", color: "#fff", width: 34, height: 34, borderRadius: 8, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 },
  body: { padding: "1.1rem 1.25rem", overflowY: "auto" },
  metaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: "0.75rem 1rem", marginBottom: "1.1rem" },
  metaLabel: { fontSize: "0.72rem", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em", fontWeight: 600 },
  metaValue: { fontSize: "0.88rem", color: colors.textPrimary, fontWeight: 600, marginTop: "0.1rem" },
  sectionTitle: { display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.92rem", fontWeight: 700, color: colors.textPrimary, margin: "0.4rem 0 0.6rem" },
  tableWrap: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: "1.2rem" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" },
  th: { textAlign: "left", padding: "0.55rem 0.7rem", background: colors.bg, color: colors.textSecondary, fontWeight: 700, fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.02em", borderBottom: `1px solid ${colors.cardBorder}` },
  td: { padding: "0.55rem 0.7rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textPrimary, verticalAlign: "top" },
  num: { textAlign: "right", whiteSpace: "nowrap" },
  itemDesc: { fontWeight: 600, color: colors.textPrimary, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" },
  itemType: { fontSize: "0.72rem", color: colors.textSecondary, marginTop: "0.1rem" },
  lineBadge: { fontSize: "0.7rem", fontWeight: 700, padding: "0.12rem 0.5rem", borderRadius: 20, whiteSpace: "nowrap" },
  tfoot: { padding: "0.6rem 0.7rem", background: colors.bg, fontWeight: 800, color: colors.textPrimary, borderTop: `2px solid ${colors.cardBorder}` },
  challanList: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  challanCard: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, overflow: "hidden" },
  challanHead: { display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.55rem 0.75rem", background: colors.bg, borderBottom: `1px solid ${colors.cardBorder}` },
  challanNo: { display: "inline-flex", alignItems: "center", gap: "0.3rem", fontWeight: 800, color: colors.blue, fontSize: "0.85rem" },
  challanDate: { fontSize: "0.78rem", color: colors.textSecondary },
  challanStatus: { fontSize: "0.72rem", fontWeight: 700, padding: "0.12rem 0.55rem", borderRadius: 20 },
  billedPill: { fontSize: "0.68rem", fontWeight: 700, padding: "0.1rem 0.5rem", borderRadius: 20, color: "#0d47a1", background: "#e3f0ff" },
  unbilledPill: { fontSize: "0.68rem", fontWeight: 700, padding: "0.1rem 0.5rem", borderRadius: 20, color: "#8a6d00", background: "#fff6db" },
  challanQty: { marginLeft: "auto", fontSize: "0.82rem", fontWeight: 800, color: colors.teal },
  challanLines: { padding: "0.4rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.25rem" },
  challanLine: { display: "flex", justifyContent: "space-between", gap: "0.75rem", fontSize: "0.8rem" },
  clDesc: { color: colors.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  clQty: { fontWeight: 700, color: colors.textPrimary, flexShrink: 0, whiteSpace: "nowrap" },
  dim: { color: colors.textSecondary, fontSize: "0.85rem", padding: "0.5rem 0" },
  empty: { color: colors.textSecondary, fontSize: "0.85rem", fontStyle: "italic", padding: "0.75rem", border: `1px dashed ${colors.inputBorder}`, borderRadius: 10, background: colors.bg },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", padding: "0.85rem 1.25rem", borderTop: `1px solid ${colors.cardBorder}`, flexWrap: "wrap" },
  btnGhost: { display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.5rem 1rem", borderRadius: 9, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textSecondary, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" },
  btnBlue: { display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.5rem 1rem", borderRadius: 9, border: "none", background: colors.blue, color: "#fff", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" },
  btnTeal: { display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.5rem 1rem", borderRadius: 9, border: "none", background: colors.teal, color: "#fff", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" },
};
