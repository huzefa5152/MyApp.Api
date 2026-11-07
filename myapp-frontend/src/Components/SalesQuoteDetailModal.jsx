import { useEffect, useState } from "react";
import { MdClose, MdPrint, MdRequestQuote } from "react-icons/md";
import RichText from "./RichText";
import { discountNote } from "../utils/quoteDiscount";
import { formStyles, modalSizes } from "../theme";
import AttachmentManager from "./AttachmentManager";
import { Facts, TableWrap } from "../ui/Kit";

// Read-only view of a Sales Quote: header + meta + items + totals + notes.
const STATUS_COLORS = {
  Active: "var(--k-blue)",
  Expired: "var(--k-warn-2)",
  Accepted: "var(--k-success-alt)",
};

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(dt.getDate()).padStart(2, "0")}-${m[dt.getMonth()]}-${dt.getFullYear()}`;
};
const money = (n) => "Rs " + Number(n || 0).toLocaleString();

// Below this the six-column table squeezes the description to a word per line
// and cuts the amount, so each line becomes a card.
const NARROW = 640;
export default function SalesQuoteDetailModal({ quote, companyId, canPrint, onPrint, onClose }) {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < NARROW,
  );
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  if (!quote) return null;
  const items = quote.items || [];
  return (
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div
        data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div data-admin-header="" style={formStyles.header}>
          <h5
            style={{
              ...formStyles.title,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <MdRequestQuote size={20} /> Quote #{quote.quoteNumber}
            <span
              style={{
                ...st.badge,
                background: `${STATUS_COLORS[quote.status] || "var(--k-muted)"}18`,
                color: STATUS_COLORS[quote.status] || "var(--k-muted)",
              }}
            >
              {quote.status}
            </span>
          </h5>
          <button data-admin-close="" style={formStyles.closeButton} onClick={onClose}>
            <MdClose size={18} />
          </button>
        </div>

        <div data-admin-body="" style={formStyles.body}>
          <div style={st.clientName}>{quote.clientName}</div>

          <Facts
            className="sq-detail-facts"
            facts={[
              ["Issue Date", fmtDate(quote.date) || "—"],
              ["Valid Until", quote.validUntil ? fmtDate(quote.validUntil) : "—"],
              ["Customer Enquiry", quote.customerEnquiryRef || "—"],
              ["Enquiry Date", quote.enquiryDate ? fmtDate(quote.enquiryDate) : "—"],
              ["GST Rate", `${quote.gstRate}%`],
            ]}
          />

          {quote.convertedToSalesOrderNumber && (
            <div style={st.converted}>
              → Converted to Sales Order #{quote.convertedToSalesOrderNumber}
            </div>
          )}

          <div style={st.sectionTitle}>Items ({items.length})</div>
          {isNarrow ? (
            <div style={st.cards}>
              {items.map((i, idx) => (
                <div key={i.id ?? idx} style={st.card}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={st.cardNum}>{idx + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {i.imagePath && (
                        <img
                          src={i.imagePath}
                          alt={`Photo for line ${idx + 1}`}
                          style={{
                            display: "block",
                            maxWidth: 72,
                            maxHeight: 72,
                            objectFit: "contain",
                            marginBottom: 6,
                          }}
                        />
                      )}
                      <span style={st.desc}>
                        <RichText text={i.description} />
                      </span>
                      {i.discountAmount > 0 && (
                        <div style={st.discNote}>
                          {discountNote(
                            i.discountValue,
                            i.discountIsPercent,
                            i.discountAmount,
                            i.discountReason,
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={st.cardFoot}>
                    <span>
                      {Number(i.quantity).toLocaleString()} {i.unit} × {money(i.unitPrice)}
                    </span>
                    <b style={{ whiteSpace: "nowrap", color: "var(--k-ink)" }}>
                      {money(i.lineTotal)}
                    </b>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <TableWrap data-admin-table-region="" style={st.tableWrap}>
              <table className="k-table k-table--compact">
                <thead>
                  <tr>
                    <th className="is-center" style={{ width: 28 }}>
                      #
                    </th>
                    <th>Description</th>
                    <th className="k-num">Qty</th>
                    <th>Unit</th>
                    <th className="k-num">Unit Price</th>
                    <th className="k-num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i, idx) => (
                    <tr key={i.id ?? idx}>
                      <td className="is-center k-muted">{idx + 1}</td>
                      <td>
                        {i.imagePath && (
                          <img
                            src={i.imagePath}
                            alt={`Photo for line ${idx + 1}`}
                            style={{
                              display: "block",
                              maxWidth: 72,
                              maxHeight: 72,
                              objectFit: "contain",
                              marginBottom: 6,
                            }}
                          />
                        )}
                        <span style={st.desc}>
                          <RichText text={i.description} />
                        </span>
                        {i.discountAmount > 0 && (
                          <div style={st.discNote}>
                            {discountNote(
                              i.discountValue,
                              i.discountIsPercent,
                              i.discountAmount,
                              i.discountReason,
                            )}
                          </div>
                        )}
                      </td>
                      <td className="k-num">{Number(i.quantity).toLocaleString()}</td>
                      <td>{i.unit}</td>
                      <td className="k-num">{money(i.unitPrice)}</td>
                      <td className="k-num" style={{ fontWeight: 700 }}>
                        {money(i.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}

          <div style={st.totals}>
            <div style={st.tRow}>
              <span>Subtotal</span>
              <span>{money(quote.subtotal)}</span>
            </div>
            {quote.discountAmount > 0 && (
              <div style={st.tRow}>
                <span>
                  Discount{quote.discountIsPercent ? ` (${quote.discountValue}%)` : ""}
                  {quote.discountReason ? ` — ${quote.discountReason}` : ""}
                </span>
                <span style={{ whiteSpace: "nowrap" }}>− {money(quote.discountAmount)}</span>
              </div>
            )}
            <div style={st.tRow}>
              <span>GST @ {quote.gstRate}%</span>
              <span>{money(quote.gstAmount)}</span>
            </div>
            <div style={{ ...st.tRow, ...st.grand }}>
              <span>Grand Total</span>
              <span>{money(quote.grandTotal)}</span>
            </div>
          </div>

          {quote.notes && (
            <>
              <div style={st.sectionTitle}>Notes</div>
              <div style={st.notes}>
                <RichText text={quote.notes} />
              </div>
            </>
          )}

          {companyId && (
            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager
                companyId={companyId}
                entityType="SalesQuote"
                entityId={quote.id}
                mode="view"
              />
            </div>
          )}
        </div>

        <div data-admin-footer="" style={formStyles.footer}>
          {canPrint && (
            <button
              style={{
                ...formStyles.button,
                ...formStyles.cancel,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
              onClick={() => onPrint?.(quote)}
            >
              <MdPrint size={16} /> Print
            </button>
          )}
          <button
            data-admin-close=""
            style={{ ...formStyles.button, ...formStyles.submit }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const st = {
  badge: {
    fontSize: "0.7rem",
    fontWeight: 700,
    padding: "0.1rem 0.5rem",
    borderRadius: 20,
    background: "rgba(255,255,255,0.22)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.4)",
  },
  clientName: {
    fontSize: "calc(var(--k-font) + 0.15rem)",
    fontWeight: 700,
    color: "var(--k-ink)",
    marginBottom: "0.75rem",
  },
  converted: {
    fontSize: "var(--k-font-sm)",
    color: "var(--k-teal)",
    fontWeight: 600,
    margin: "0.75rem 0",
  },
  sectionTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: "1.25rem",
    marginBottom: "0.5rem",
    fontSize: "var(--k-font)",
    fontWeight: 700,
    color: "var(--k-blue)",
  },
  tableWrap: { maxHeight: 320, overflowY: "auto" },
  desc: { whiteSpace: "pre-wrap" },
  cards: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  card: {
    border: "1px solid var(--k-line)",
    borderRadius: "var(--k-radius)",
    padding: "0.65rem 0.75rem",
    background: "var(--k-surface)",
  },
  cardNum: {
    flex: "0 0 auto",
    width: 24,
    height: 24,
    borderRadius: 7,
    background: "var(--k-surface-3)",
    color: "var(--k-muted)",
    display: "grid",
    placeItems: "center",
    fontSize: "var(--k-font-sm)",
    fontWeight: 700,
  },
  cardFoot: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.75rem",
    flexWrap: "wrap",
    marginTop: "0.5rem",
    paddingTop: "0.45rem",
    borderTop: "1px dashed var(--k-line)",
    fontSize: "var(--k-font-sm)",
    color: "var(--k-muted)",
  },
  discNote: { marginTop: 4, fontSize: "var(--k-font-sm)", fontWeight: 600, color: "var(--k-teal)" },
  totals: { marginTop: "1rem", marginLeft: "auto", width: 280, maxWidth: "100%" },
  tRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "0.75rem",
    padding: "0.25rem 0",
    fontSize: "var(--k-font)",
    color: "var(--k-muted)",
  },
  grand: {
    borderTop: "2px solid var(--k-blue)",
    marginTop: 4,
    paddingTop: 8,
    fontWeight: 800,
    fontSize: "calc(var(--k-font) + 0.1rem)",
    color: "var(--k-blue)",
  },
  notes: {
    fontSize: "var(--k-font)",
    color: "var(--k-ink)",
    whiteSpace: "pre-wrap",
    background: "var(--k-surface-2)",
    border: "1px solid var(--k-line)",
    borderRadius: 8,
    padding: "0.6rem 0.8rem",
  },
};
