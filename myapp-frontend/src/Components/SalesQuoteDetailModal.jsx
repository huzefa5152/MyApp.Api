import { MdClose, MdPrint, MdRequestQuote } from "react-icons/md";
import { formStyles, modalSizes } from "../theme";
import AttachmentManager from "./AttachmentManager";

// Read-only view of a Sales Quote: header + meta + items + totals + notes.
const colors = { blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3" };
const STATUS_COLORS = { Active: "#1565c0", Expired: "#f57c00", Accepted: "#28a745" };

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(dt.getDate()).padStart(2, "0")}-${m[dt.getMonth()]}-${dt.getFullYear()}`;
};
const money = (n) => "Rs " + Number(n || 0).toLocaleString();

const Meta = ({ label, value }) => (
  <div style={st.metaItem}>
    <div style={st.metaLabel}>{label}</div>
    <div style={st.metaValue}>{value || "—"}</div>
  </div>
);

export default function SalesQuoteDetailModal({ quote, companyId, canPrint, onPrint, onClose }) {
  if (!quote) return null;
  const items = quote.items || [];
  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={{ ...formStyles.title, display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <MdRequestQuote size={20} /> Quote #{quote.quoteNumber}
            <span style={{ ...st.badge, background: `${STATUS_COLORS[quote.status] || "#5f6d7e"}18`, color: STATUS_COLORS[quote.status] || "#5f6d7e" }}>{quote.status}</span>
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}><MdClose size={18} /></button>
        </div>

        <div style={formStyles.body}>
          <div style={st.clientName}>{quote.clientName}</div>

          <div style={st.metaGrid}>
            <Meta label="Issue Date" value={fmtDate(quote.date)} />
            <Meta label="Valid Until" value={quote.validUntil ? fmtDate(quote.validUntil) : "—"} />
            <Meta label="Customer Enquiry" value={quote.customerEnquiryRef || "—"} />
            <Meta label="Enquiry Date" value={quote.enquiryDate ? fmtDate(quote.enquiryDate) : "—"} />
            <Meta label="GST Rate" value={`${quote.gstRate}%`} />
          </div>

          {quote.convertedToSalesOrderNumber && (
            <div style={st.converted}>→ Converted to Sales Order #{quote.convertedToSalesOrderNumber}</div>
          )}

          <div style={st.sectionTitle}>Items ({items.length})</div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={{ ...st.th, width: 28, textAlign: "center" }}>#</th>
                  <th style={st.th}>Description</th>
                  <th style={{ ...st.th, textAlign: "right" }}>Qty</th>
                  <th style={st.th}>Unit</th>
                  <th style={{ ...st.th, textAlign: "right" }}>Unit Price</th>
                  <th style={{ ...st.th, textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={i.id ?? idx}>
                    <td style={{ ...st.td, textAlign: "center", color: colors.textSecondary }}>{idx + 1}</td>
                    <td style={st.td}><span style={st.desc}>{i.description}</span></td>
                    <td style={{ ...st.td, textAlign: "right" }}>{Number(i.quantity).toLocaleString()}</td>
                    <td style={st.td}>{i.unit}</td>
                    <td style={{ ...st.td, textAlign: "right" }}>{money(i.unitPrice)}</td>
                    <td style={{ ...st.td, textAlign: "right", fontWeight: 700 }}>{money(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={st.totals}>
            <div style={st.tRow}><span>Subtotal</span><span>{money(quote.subtotal)}</span></div>
            <div style={st.tRow}><span>GST @ {quote.gstRate}%</span><span>{money(quote.gstAmount)}</span></div>
            <div style={{ ...st.tRow, ...st.grand }}><span>Grand Total</span><span>{money(quote.grandTotal)}</span></div>
          </div>

          {quote.notes && (
            <>
              <div style={st.sectionTitle}>Notes</div>
              <div style={st.notes}>{quote.notes}</div>
            </>
          )}

          {companyId && (
            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager companyId={companyId} entityType="SalesQuote" entityId={quote.id} mode="view" />
            </div>
          )}
        </div>

        <div style={formStyles.footer}>
          {canPrint && (
            <button style={{ ...formStyles.button, ...formStyles.cancel, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => onPrint?.(quote)}>
              <MdPrint size={16} /> Print
            </button>
          )}
          <button style={{ ...formStyles.button, ...formStyles.submit }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const st = {
  badge: { fontSize: "0.7rem", fontWeight: 700, padding: "0.1rem 0.5rem", borderRadius: 20, background: "rgba(255,255,255,0.22)", color: "#fff", border: "1px solid rgba(255,255,255,0.4)" },
  clientName: { fontSize: "1.05rem", fontWeight: 700, color: colors.textPrimary, marginBottom: "0.75rem" },
  metaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: "0.75rem", marginBottom: "1rem" },
  metaItem: {},
  metaLabel: { fontSize: "0.68rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em" },
  metaValue: { fontSize: "0.9rem", color: colors.textPrimary, marginTop: "0.15rem" },
  converted: { fontSize: "0.82rem", color: colors.teal, fontWeight: 600, marginBottom: "0.75rem" },
  sectionTitle: { display: "flex", alignItems: "center", gap: 6, marginTop: "1.25rem", marginBottom: "0.5rem", fontSize: "0.9rem", fontWeight: 700, color: colors.blue },
  tableWrap: { maxHeight: 320, overflowY: "auto", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 10 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.02em", fontWeight: 700, color: colors.textSecondary, padding: "0.5rem 0.5rem", borderBottom: `2px solid ${colors.cardBorder}`, whiteSpace: "nowrap", background: "#fafbfc", position: "sticky", top: 0 },
  td: { padding: "0.4rem 0.5rem", verticalAlign: "middle", borderBottom: `1px solid ${colors.cardBorder}`, fontSize: "0.88rem", color: colors.textPrimary },
  desc: { whiteSpace: "pre-wrap" },
  totals: { marginTop: "1rem", marginLeft: "auto", width: 280 },
  tRow: { display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.9rem", color: colors.textSecondary },
  grand: { borderTop: `2px solid ${colors.blue}`, marginTop: 4, paddingTop: 8, fontWeight: 800, fontSize: "1rem", color: colors.blue },
  notes: { fontSize: "0.86rem", color: colors.textPrimary, whiteSpace: "pre-wrap", background: "#fafbfc", border: `1px solid ${colors.cardBorder}`, borderRadius: 8, padding: "0.6rem 0.8rem" },
};
