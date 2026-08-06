import { MdEdit, MdDelete, MdContentCopy } from "react-icons/md";
import { deleteClient, getClientDeleteImpact } from "../api/clientApi";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import useIsNarrow from "../hooks/useIsNarrow";

// ── Local formatters (kept inline so the table has no cross-module coupling) ──
const money = (n) => {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "-Rs. " : "Rs. ") + s;
};
// Quantities: show up to 2 decimals but drop trailing ".00" so whole numbers
// read cleanly (matches the reference product's mixed integer/decimal column).
const qty = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return "";
  return Number.isInteger(v) ? v.toLocaleString("en-PK") : v.toLocaleString("en-PK", { maximumFractionDigits: 2 });
};

const STATUS_STYLES = {
  Paid: { bg: "#e8f5e9", fg: "#2e7d32", border: "#a5d6a7" },
  Unpaid: { bg: "#fff8e1", fg: "#b26a00", border: "#ffe082" },
  Overpaid: { bg: "#e3f2fd", fg: "#0d47a1", border: "#90caf9" },
};

// Empty per-client summary so a client with no activity still renders zeros.
const EMPTY = {
  salesQuotes: 0, salesOrders: 0, salesInvoices: 0, creditNotes: 0, deliveryNotes: 0,
  qtyToDeliver: 0, qtyToInvoice: 0, accountsReceivable: 0, withholdingTaxReceivable: 0, status: "Paid",
};

export default function ClientList({ clients, summaryById = {}, onEdit, onCopy, fetchClients, onOpenDetail }) {
  const confirm = useConfirm();
  const { has } = usePermissions();
  const isNarrow = useIsNarrow();
  const canUpdate = has("clients.manage.update");
  const canDelete = has("clients.manage.delete");
  const canCopy = has("clients.manage.copy");
  const showActions = canUpdate || canDelete || canCopy;

  // A count/amount cell renders as a drill-down link (opens the detail popup
  // at `section`) when there's data behind it; otherwise plain text.
  const drill = (client, enabled, section, text) =>
    enabled && onOpenDetail ? (
      <button
        type="button"
        style={styles.drill}
        title="View details"
        onClick={() => onOpenDetail(client, section)}
        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
      >
        {text}
      </button>
    ) : (text || "");

  // Mobile-card counterpart of `drill`: always shows a value ("0" when empty)
  // so a stacked card reads cleanly, and stays a drill-down link when there's
  // data behind it. `isQty` formats decimals; otherwise it's a plain count.
  const metric = (client, value, section, isQty = false) => {
    const hasData = isQty ? !!value : value > 0;
    const text = isQty ? (qty(value) || "0") : String(value || 0);
    return hasData && onOpenDetail ? (
      <button type="button" style={styles.drill} title="View details" onClick={() => onOpenDetail(client, section)}>{text}</button>
    ) : text;
  };

  const handleDelete = async (client) => {
    // Look up what the wipe will cascade-delete (best-effort; falls back to a
    // plain confirm if the impact call isn't available).
    let impact = null;
    try { ({ data: impact } = await getClientDeleteImpact(client.id)); } catch { /* plain confirm */ }

    // FBR-submitted bills block the delete (compliance).
    if (impact && impact.fbrSubmittedInvoices > 0) {
      await confirm({
        title: "Can't delete this client",
        message: `"${client.name}" has ${impact.fbrSubmittedInvoices} FBR-submitted bill${impact.fbrSubmittedInvoices !== 1 ? "s" : ""}, which can't be deleted for compliance. Handle those in the Invoices tab first.`,
        variant: "warning", confirmText: "OK", cancelText: "Close",
      });
      return;
    }

    const parts = [];
    if (impact) {
      if (impact.invoices) parts.push(`${impact.invoices} bill/invoice${impact.invoices !== 1 ? "s" : ""}`);
      if (impact.deliveryChallans) parts.push(`${impact.deliveryChallans} delivery challan${impact.deliveryChallans !== 1 ? "s" : ""}`);
      if (impact.salesOrders) parts.push(`${impact.salesOrders} sales order${impact.salesOrders !== 1 ? "s" : ""}`);
      if (impact.salesQuotes) parts.push(`${impact.salesQuotes} sales quote${impact.salesQuotes !== 1 ? "s" : ""}`);
    }
    const message = parts.length
      ? `Deleting "${client.name}" will also permanently delete ${parts.join(", ")} (and their attachments). This cannot be undone.`
      : `Delete "${client.name}"? This cannot be undone.`;

    const ok = await confirm({ title: "Delete Client?", message, variant: "danger", confirmText: parts.length ? "Delete client + documents" : "Delete" });
    if (!ok) return;
    try {
      await deleteClient(client.id);
      fetchClients();
      notify("Client deleted.", "success");
    } catch (err) {
      notify(err.response?.data?.error || err.response?.data?.message || "Failed to delete client.", "error");
    }
  };

  // Phones (<768px): stacked cards instead of the wide, horizontally-scrolling
  // table. Every column is preserved; the customer name is line-clamped (never
  // nowrap+ellipsis) so similar-prefix names stay distinguishable.
  if (isNarrow) {
    return (
      <div style={styles.cards}>
        {clients.map((client) => {
          const s = summaryById[client.id] || EMPTY;
          const stt = STATUS_STYLES[s.status] || STATUS_STYLES.Paid;
          return (
            <div key={client.id} style={styles.mCard}>
              <div style={styles.mHead}>
                {onOpenDetail ? (
                  <button
                    type="button"
                    style={styles.nameBtn}
                    title="View this customer's documents"
                    onClick={() => onOpenDetail(client, null)}
                  >
                    {client.name}
                  </button>
                ) : (
                  <div style={styles.name}>{client.name}</div>
                )}
                <span style={{ ...styles.pill, background: stt.bg, color: stt.fg, borderColor: stt.border }}>{s.status}</span>
              </div>
              {(client.ntn || client.phone) && (
                <div style={styles.sub}>{client.ntn ? `NTN ${client.ntn}` : client.phone}</div>
              )}

              <div style={styles.mGrid}>
                <div style={styles.mCell}><span style={styles.mLbl}>Quotes</span><span style={styles.mVal}>{metric(client, s.salesQuotes, "quotes")}</span></div>
                <div style={styles.mCell}><span style={styles.mLbl}>Orders</span><span style={styles.mVal}>{metric(client, s.salesOrders, "orders")}</span></div>
                <div style={styles.mCell}><span style={styles.mLbl}>Invoices</span><span style={styles.mVal}>{metric(client, s.salesInvoices, "invoices")}</span></div>
                <div style={styles.mCell}><span style={styles.mLbl}>Cr. Notes</span><span style={styles.mVal}>{metric(client, s.creditNotes, "creditNotes")}</span></div>
                <div style={styles.mCell}><span style={styles.mLbl}>Delivery</span><span style={styles.mVal}>{metric(client, s.deliveryNotes, "challans")}</span></div>
                <div style={styles.mCell}><span style={styles.mLbl}>To Deliver</span><span style={styles.mVal}>{metric(client, s.qtyToDeliver, "orders", true)}</span></div>
                <div style={styles.mCell}><span style={styles.mLbl}>To Invoice</span><span style={styles.mVal}>{metric(client, s.qtyToInvoice, "challans", true)}</span></div>
              </div>

              <div style={styles.mMoneyRow}>
                <div style={styles.mCell}><span style={styles.mLbl}>A/R</span><span style={styles.mMoneyVal}>{drill(client, s.salesInvoices > 0, "statement", money(s.accountsReceivable))}</span></div>
                <div style={styles.mCell}><span style={styles.mLbl}>WHT Rec.</span><span style={styles.mMoneyVal}>{drill(client, !!s.withholdingTaxReceivable, "wht", money(s.withholdingTaxReceivable))}</span></div>
              </div>

              {showActions && (
                <div style={styles.mActions}>
                  {canUpdate && (
                    <button style={{ ...styles.mIconBtn, ...styles.edit }} title="Edit" onClick={() => onEdit(client)}><MdEdit size={18} /></button>
                  )}
                  {canCopy && onCopy && (
                    <button style={{ ...styles.mIconBtn, ...styles.copy }} title="Copy to another company" onClick={() => onCopy(client)}><MdContentCopy size={17} /></button>
                  )}
                  {canDelete && (
                    <button style={{ ...styles.mIconBtn, ...styles.del }} title="Delete" onClick={() => handleDelete(client)}><MdDelete size={18} /></button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    // Wide table → own horizontal-scroll container so the page body never
    // scrolls sideways on phones (mobile-first rule).
    <div style={styles.scroll}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...styles.th, ...styles.thLeft, ...styles.stickyName }}>Customer</th>
            <th style={styles.thNum} title="Sales Quotes">Quotes</th>
            <th style={styles.thNum} title="Sales Orders">Orders</th>
            <th style={styles.thNum} title="Sales Invoices">Invoices</th>
            <th style={styles.thNum} title="Credit Notes">Cr. Notes</th>
            <th style={styles.thNum} title="Delivery Notes / Challans">Delivery</th>
            <th style={styles.thNum} title="Quantity still to deliver (ordered − delivered)">To Deliver</th>
            <th style={styles.thNum} title="Delivered quantity not yet invoiced">To Invoice</th>
            <th style={styles.thMoney} title="Accounts Receivable (outstanding)">A/R</th>
            <th style={styles.thMoney} title="Withholding Tax Receivable">WHT Rec.</th>
            <th style={styles.thStatus}>Status</th>
            {showActions && <th style={styles.thActions}></th>}
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => {
            const s = summaryById[client.id] || EMPTY;
            const st = STATUS_STYLES[s.status] || STATUS_STYLES.Paid;
            return (
              <tr key={client.id} style={styles.tr}>
                <td style={{ ...styles.tdLeft, ...styles.stickyName }}>
                  {onOpenDetail ? (
                    <button
                      type="button"
                      style={styles.nameBtn}
                      title="View this customer's documents"
                      onClick={() => onOpenDetail(client, null)}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#0d47a1"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "#1a2332"; }}
                    >
                      {client.name}
                    </button>
                  ) : (
                    <div style={styles.name}>{client.name}</div>
                  )}
                  {(client.ntn || client.phone) && (
                    <div style={styles.sub}>{client.ntn ? `NTN ${client.ntn}` : client.phone}</div>
                  )}
                </td>
                <td style={styles.tdNum}>{drill(client, s.salesQuotes > 0, "quotes", s.salesQuotes || "")}</td>
                <td style={styles.tdNum}>{drill(client, s.salesOrders > 0, "orders", s.salesOrders || "")}</td>
                <td style={styles.tdNum}>{drill(client, s.salesInvoices > 0, "invoices", s.salesInvoices || "")}</td>
                <td style={styles.tdNum}>{drill(client, s.creditNotes > 0, "creditNotes", s.creditNotes || "")}</td>
                <td style={styles.tdNum}>{drill(client, s.deliveryNotes > 0, "challans", s.deliveryNotes || "")}</td>
                <td style={styles.tdNum}>{drill(client, !!s.qtyToDeliver, "orders", qty(s.qtyToDeliver))}</td>
                <td style={styles.tdNum}>{drill(client, !!s.qtyToInvoice, "challans", qty(s.qtyToInvoice))}</td>
                <td style={styles.tdMoney}>{drill(client, s.salesInvoices > 0, "statement", money(s.accountsReceivable))}</td>
                <td style={styles.tdMoney}>{drill(client, !!s.withholdingTaxReceivable, "wht", money(s.withholdingTaxReceivable))}</td>
                <td style={styles.tdStatus}>
                  <span style={{ ...styles.pill, background: st.bg, color: st.fg, borderColor: st.border }}>{s.status}</span>
                </td>
                {showActions && (
                  <td style={styles.tdActions}>
                    <div style={styles.actionRow}>
                      {canUpdate && (
                        <button style={{ ...styles.iconBtn, ...styles.edit }} title="Edit" onClick={() => onEdit(client)}>
                          <MdEdit size={16} />
                        </button>
                      )}
                      {canCopy && onCopy && (
                        <button style={{ ...styles.iconBtn, ...styles.copy }} title="Copy to another company" onClick={() => onCopy(client)}>
                          <MdContentCopy size={15} />
                        </button>
                      )}
                      {canDelete && (
                        <button style={{ ...styles.iconBtn, ...styles.del }} title="Delete" onClick={() => handleDelete(client)}>
                          <MdDelete size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  scroll: {
    width: "100%",
    overflowX: "auto",
    border: "1px solid #e8edf3",
    borderRadius: 12,
    background: "#fff",
    WebkitOverflowScrolling: "touch",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 920 },
  th: { textAlign: "left", padding: "0.6rem 0.7rem", fontWeight: 700, color: "#5f6d7e", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.02em", background: "#f8f9fb", borderBottom: "2px solid #e8edf3", whiteSpace: "nowrap" },
  thLeft: { textAlign: "left" },
  thNum: { textAlign: "right", padding: "0.6rem 0.55rem", fontWeight: 700, color: "#5f6d7e", fontSize: "0.7rem", background: "#f8f9fb", borderBottom: "2px solid #e8edf3", whiteSpace: "nowrap" },
  thMoney: { textAlign: "right", padding: "0.6rem 0.7rem", fontWeight: 700, color: "#5f6d7e", fontSize: "0.7rem", background: "#f8f9fb", borderBottom: "2px solid #e8edf3", whiteSpace: "nowrap" },
  thStatus: { textAlign: "center", padding: "0.6rem 0.7rem", fontWeight: 700, color: "#5f6d7e", fontSize: "0.7rem", background: "#f8f9fb", borderBottom: "2px solid #e8edf3" },
  thActions: { padding: "0.6rem 0.5rem", background: "#f8f9fb", borderBottom: "2px solid #e8edf3", width: 1 },
  stickyName: { position: "sticky", left: 0, zIndex: 1 },
  tr: { borderBottom: "1px solid #eef2f7" },
  tdLeft: { padding: "0.55rem 0.7rem", background: "#fff", verticalAlign: "middle", minWidth: 200 },
  tdNum: { padding: "0.55rem 0.55rem", textAlign: "right", color: "#334155", verticalAlign: "middle", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  tdMoney: { padding: "0.55rem 0.7rem", textAlign: "right", color: "#1a2332", fontWeight: 600, verticalAlign: "middle", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  tdStatus: { padding: "0.55rem 0.7rem", textAlign: "center", verticalAlign: "middle" },
  tdActions: { padding: "0.4rem 0.5rem", verticalAlign: "middle" },
  name: { fontWeight: 700, color: "#1a2332", lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  nameBtn: { background: "none", border: "none", padding: 0, margin: 0, textAlign: "left", cursor: "pointer", fontWeight: 700, color: "#1a2332", lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontFamily: "inherit", fontSize: "inherit", transition: "color 0.15s" },
  drill: { background: "none", border: "none", padding: 0, margin: 0, font: "inherit", color: "#0d47a1", fontWeight: 600, cursor: "pointer", fontVariantNumeric: "tabular-nums" },
  sub: { fontSize: "0.7rem", color: "#94a3b8", marginTop: 2 },
  pill: { display: "inline-block", padding: "0.15rem 0.55rem", borderRadius: 12, border: "1px solid", fontSize: "0.7rem", fontWeight: 700 },
  actionRow: { display: "flex", gap: 4, justifyContent: "flex-end" },
  iconBtn: { display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, border: "none", cursor: "pointer" },
  edit: { background: "#e3f2fd", color: "#0d47a1" },
  copy: { background: "#ede7f6", color: "#4527a0" },
  del: { background: "#ffebee", color: "#c62828" },

  // ── Mobile cards (<768px) ──
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: "0.75rem" },
  mCard: { border: "1px solid #e8edf3", borderRadius: 12, background: "#fff", padding: "0.8rem 0.9rem", display: "flex", flexDirection: "column", gap: "0.55rem", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  mHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  mGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(84px, 100%), 1fr))", gap: "0.45rem 0.6rem" },
  mCell: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 },
  mLbl: { fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#94a3b8" },
  mVal: { fontSize: "0.9rem", fontWeight: 600, color: "#334155", fontVariantNumeric: "tabular-nums" },
  mMoneyRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", borderTop: "1px dashed #e8edf3", paddingTop: "0.55rem" },
  mMoneyVal: { fontSize: "0.92rem", fontWeight: 700, color: "#1a2332", fontVariantNumeric: "tabular-nums" },
  mActions: { display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid #eef2f7", paddingTop: "0.55rem" },
  mIconBtn: { display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 10, border: "none", cursor: "pointer" },
};
