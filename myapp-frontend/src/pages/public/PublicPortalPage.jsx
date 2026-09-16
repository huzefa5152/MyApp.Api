import { useState, useEffect, useCallback } from "react";
import {
  MdReceiptLong, MdPrint, MdSearch, MdChevronLeft, MdChevronRight, MdClose,
} from "react-icons/md";
import { colors, formStyles, modalSizes } from "../../theme";
import useIsNarrow from "../../hooks/useIsNarrow";
import { mergeTemplate } from "../../utils/templateEngine";
import { writeAndPrint } from "../../utils/printDocument";
import {
  getPortalHeader, getPortalInvoices, getPortalInvoice, getPortalPrintPayload,
} from "../../api/publicPortalApi";

const money = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS_STYLE = {
  Paid: { bg: "#e8f5e9", fg: "#1b5e20", label: "Paid" },
  PartiallyPaid: { bg: "#fff3cd", fg: "#8a5a00", label: "Part paid" },
  Overdue: { bg: "#ffebee", fg: "#b71c1c", label: "Overdue" },
  Unpaid: { bg: "#eef2ff", fg: "#0d47a1", label: "Unpaid" },
};

const PAGE_SIZE = 25;

/**
 * The customer-facing portal. Opened from a link, with no account and no login.
 *
 * Everything on this page comes from ONE token in the URL. There is no company
 * or client id anywhere in this component, because the API does not accept one:
 * an invoice is fetched by the number printed on the customer's own copy.
 *
 * Written for someone who is not an accountant and did not choose to be here —
 * plain words, the balance first, and one thing to do per row.
 */
export default function PublicPortalPage() {
  // Read straight from the path: this page renders OUTSIDE the router (see
  // main.jsx), so there are no route params to read. The regex is the same one
  // main.jsx used to decide to render this page at all.
  const token = (window.location.pathname.match(/^\/portal\/([A-Za-z0-9_-]+)/) || [])[1] || "";
  const isNarrow = useIsNarrow(760);

  const [header, setHeader] = useState(null);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);
  const [detail, setDetail] = useState(null);
  const [printing, setPrinting] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getPortalHeader(token)
      .then(({ data }) => { if (!cancelled) setHeader(data); })
      .catch(() => { if (!cancelled) setGone(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const loadInvoices = useCallback(async () => {
    if (gone) return;
    try {
      const params = { page, pageSize: PAGE_SIZE };
      if (applied.trim()) params.search = applied.trim();
      if (status) params.status = status;
      const { data } = await getPortalInvoices(token, params);
      setRows(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(data.totalPages || 0);
    } catch {
      setRows([]); setTotalCount(0); setTotalPages(0);
    }
  }, [token, page, applied, status, gone]);

  useEffect(() => { if (header) loadInvoices(); }, [header, loadInvoices]);
  useEffect(() => { setPage(1); }, [applied, status]);

  const openDetail = async (invoiceNumber) => {
    try {
      const { data } = await getPortalInvoice(token, invoiceNumber);
      setDetail(data);
    } catch { /* the row came from this portal; a failure here is transient */ }
  };

  const print = async (invoiceNumber) => {
    if (printing) return;
    setPrinting(invoiceNumber);
    const w = window.open("", "_blank");
    if (!w) { setPrinting(null); return; }
    w.document.write("<p style='font-family:sans-serif'>Preparing your invoice…</p>");
    try {
      const { data } = await getPortalPrintPayload(token, invoiceNumber);
      // Merged and rendered exactly the way the office's own copy is — there is
      // no second renderer here to disagree with the document they were sent.
      writeAndPrint(w, mergeTemplate(data.templateHtml, data.data));
    } catch {
      w.document.body.innerHTML =
        "<p style='font-family:sans-serif'>This invoice can't be printed right now.</p>";
    } finally { setPrinting(null); }
  };

  if (loading) {
    return <div style={st.centered}>Loading…</div>;
  }

  // One message for every reason a link might not work — expired, disabled,
  // revoked, mistyped. The customer is told what to do rather than which of
  // those it was.
  if (gone || !header) {
    return (
      <div style={st.centered}>
        <div style={st.goneCard}>
          <MdReceiptLong size={34} color={colors.textSecondary} />
          <h2 style={{ margin: "0.6rem 0 0.3rem", fontSize: "1.15rem", color: colors.textPrimary }}>
            This link is no longer available
          </h2>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: "0.9rem", lineHeight: 1.5 }}>
            It may have expired or been replaced. Please ask your supplier for a new link.
          </p>
        </div>
      </div>
    );
  }

  const s = header.summary || {};

  return (
    <div style={st.page}>
      <header style={st.header}>
        <div style={st.headerInner}>
          <div style={{ minWidth: 0 }}>
            <div style={st.company}>{header.companyName}</div>
            {header.companyAddress && <div style={st.companyMeta}>{header.companyAddress}</div>}
            {(header.companyPhone || header.companyNtn) && (
              <div style={st.companyMeta}>
                {header.companyPhone}
                {header.companyPhone && header.companyNtn ? " · " : ""}
                {header.companyNtn ? `NTN ${header.companyNtn}` : ""}
              </div>
            )}
          </div>
          <div style={st.forWhom}>
            <span style={st.forLabel}>Invoices for</span>
            <span style={st.clientName}>{header.clientName}</span>
          </div>
        </div>
      </header>

      <main style={st.main}>
        <div style={st.summaryGrid}>
          <div style={st.sumCard}>
            <span style={st.sumLabel}>Outstanding</span>
            <span style={{ ...st.sumValue, color: s.outstandingAmount > 0 ? colors.danger : colors.success }}>
              Rs. {money(s.outstandingAmount)}
            </span>
            <span style={st.sumHint}>
              {s.overdueCount > 0 ? `${s.overdueCount} overdue` : "nothing overdue"}
            </span>
          </div>
          <div style={st.sumCard}>
            <span style={st.sumLabel}>Invoiced</span>
            <span style={st.sumValue}>Rs. {money(s.totalAmount)}</span>
            <span style={st.sumHint}>{s.totalInvoices} invoice{s.totalInvoices === 1 ? "" : "s"}</span>
          </div>
          <div style={st.sumCard}>
            <span style={st.sumLabel}>Paid</span>
            <span style={st.sumValue}>Rs. {money(s.paidAmount)}</span>
            <span style={st.sumHint}>{s.paidCount} settled in full</span>
          </div>
        </div>

        <div style={st.filters}>
          <form onSubmit={(e) => { e.preventDefault(); setApplied(search); }} style={st.searchForm}>
            <span style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <MdSearch size={18} style={st.searchIcon} />
              <input
                style={{ ...formStyles.input, paddingLeft: "2.1rem" }}
                placeholder="Invoice or PO number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search invoices"
              />
            </span>
            <button type="submit" style={st.searchBtn}>Search</button>
          </form>
          <div style={st.statusRow}>
            {["", "Unpaid", "PartiallyPaid", "Overdue", "Paid"].map((v) => (
              <button
                key={v || "all"}
                style={{ ...st.statusBtn, ...(status === v ? st.statusBtnOn : null) }}
                onClick={() => setStatus(v)}
              >
                {v === "" ? "All" : (STATUS_STYLE[v]?.label || v)}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <div style={st.emptyList}>
            {applied || status ? "No invoices match that." : "There are no invoices to show yet."}
          </div>
        ) : isNarrow ? (
          // A phone gets a card per invoice. An invoice table is seven columns
          // wide and a customer opening this on their phone should not have to
          // scroll sideways to find what they owe.
          <div style={{ display: "grid", gap: "0.7rem" }}>
            {rows.map((r) => {
              const badge = STATUS_STYLE[r.paymentStatus] || STATUS_STYLE.Unpaid;
              return (
                <div key={r.invoiceNumber} style={st.card}>
                  <div style={st.cardTop}>
                    <span style={st.invNo}>#{r.invoiceNumber}</span>
                    <span style={{ ...st.badge, background: badge.bg, color: badge.fg }}>
                      {badge.label}{r.daysOverdue > 0 ? ` · ${r.daysOverdue}d` : ""}
                    </span>
                  </div>
                  <div style={st.cardMeta}>
                    {fmtDate(r.date)}{r.dueDate ? ` · due ${fmtDate(r.dueDate)}` : ""}
                    {r.poNumber ? ` · PO ${r.poNumber}` : ""}
                  </div>
                  <div style={st.cardAmounts}>
                    <span>Invoiced <strong>Rs. {money(r.amount)}</strong></span>
                    <span>Balance <strong>Rs. {money(r.balanceDue)}</strong></span>
                  </div>
                  <div style={st.cardBtns}>
                    <button style={st.rowBtn} onClick={() => openDetail(r.invoiceNumber)}>View</button>
                    {header.canPrint && (
                      <button style={st.rowBtn} onClick={() => print(r.invoiceNumber)} disabled={printing === r.invoiceNumber}>
                        <MdPrint size={15} /> {printing === r.invoiceNumber ? "Preparing…" : "Print"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Invoice</th>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Due</th>
                  <th style={st.th}>PO</th>
                  <th style={{ ...st.th, textAlign: "right" }}>Invoiced</th>
                  <th style={{ ...st.th, textAlign: "right" }}>Paid</th>
                  <th style={{ ...st.th, textAlign: "right" }}>Balance</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const badge = STATUS_STYLE[r.paymentStatus] || STATUS_STYLE.Unpaid;
                  return (
                    <tr key={r.invoiceNumber}>
                      <td style={st.td}><strong>#{r.invoiceNumber}</strong></td>
                      <td style={st.td}>{fmtDate(r.date)}</td>
                      <td style={st.td}>{fmtDate(r.dueDate)}</td>
                      <td style={{ ...st.td, overflowWrap: "anywhere" }}>{r.poNumber || "—"}</td>
                      <td style={{ ...st.td, textAlign: "right" }}>{money(r.amount)}</td>
                      <td style={{ ...st.td, textAlign: "right" }}>{money(r.amountPaid)}</td>
                      <td style={{ ...st.td, textAlign: "right", fontWeight: 700 }}>{money(r.balanceDue)}</td>
                      <td style={st.td}>
                        <span style={{ ...st.badge, background: badge.bg, color: badge.fg }}>
                          {badge.label}{r.daysOverdue > 0 ? ` · ${r.daysOverdue}d` : ""}
                        </span>
                      </td>
                      <td style={{ ...st.td, whiteSpace: "nowrap" }}>
                        <button style={st.rowBtn} onClick={() => openDetail(r.invoiceNumber)}>View</button>
                        {header.canPrint && (
                          <button style={{ ...st.rowBtn, marginLeft: 6 }}
                            onClick={() => print(r.invoiceNumber)} disabled={printing === r.invoiceNumber}>
                            <MdPrint size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={st.pager}>
            <button style={st.pageBtn} disabled={page <= 1} aria-label="Previous page"
              onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <MdChevronLeft size={18} />
            </button>
            <span style={{ fontSize: "0.82rem", color: colors.textSecondary }}>
              Page {page} of {totalPages} · {totalCount} invoices
            </span>
            <button style={st.pageBtn} disabled={page >= totalPages} aria-label="Next page"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              <MdChevronRight size={18} />
            </button>
          </div>
        )}
      </main>

      {detail && (
        <div style={formStyles.backdrop} onClick={() => setDetail(null)}>
          <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={formStyles.header}>
              <h5 style={formStyles.title}>Invoice #{detail.invoiceNumber}</h5>
              <button type="button" style={formStyles.closeButton} onClick={() => setDetail(null)} aria-label="Close">
                <MdClose size={18} />
              </button>
            </div>
            <div style={formStyles.body}>
              <div style={st.detailMeta}>
                <span>{fmtDate(detail.date)}</span>
                {detail.dueDate && <span>Due {fmtDate(detail.dueDate)}</span>}
                {detail.poNumber && <span>PO {detail.poNumber}</span>}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={st.table}>
                  <thead>
                    <tr>
                      <th style={st.th}>Description</th>
                      <th style={{ ...st.th, textAlign: "right" }}>Qty</th>
                      <th style={st.th}>UOM</th>
                      <th style={{ ...st.th, textAlign: "right" }}>Rate</th>
                      <th style={{ ...st.th, textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l, i) => (
                      <tr key={i}>
                        <td style={{ ...st.td, overflowWrap: "anywhere" }}>{l.description}</td>
                        <td style={{ ...st.td, textAlign: "right" }}>{l.quantity}</td>
                        <td style={st.td}>{l.uom}</td>
                        <td style={{ ...st.td, textAlign: "right" }}>{money(l.unitPrice)}</td>
                        <td style={{ ...st.td, textAlign: "right" }}>{money(l.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={st.totals}>
                <div style={st.totalRow}><span>Subtotal</span><span>Rs. {money(detail.subtotal)}</span></div>
                <div style={st.totalRow}><span>Sales tax ({detail.gstRate}%)</span><span>Rs. {money(detail.gstAmount)}</span></div>
                {detail.furtherTaxAmount > 0 && (
                  <div style={st.totalRow}><span>Further tax</span><span>Rs. {money(detail.furtherTaxAmount)}</span></div>
                )}
                <div style={{ ...st.totalRow, fontWeight: 800, borderTop: `1px solid ${colors.cardBorder}`, paddingTop: 6 }}>
                  <span>Invoice total</span><span>Rs. {money(detail.grandTotal)}</span>
                </div>
                {detail.withholdingTaxAmount > 0 && (
                  <>
                    <div style={st.totalRow}>
                      <span>Less tax withheld at source</span>
                      <span>− Rs. {money(detail.withholdingTaxAmount)}</span>
                    </div>
                    <div style={{ ...st.totalRow, fontWeight: 800 }}>
                      <span>Payable to us</span><span>Rs. {money(detail.amount)}</span>
                    </div>
                  </>
                )}
                <div style={st.totalRow}><span>Paid</span><span>Rs. {money(detail.amountPaid)}</span></div>
                <div style={{ ...st.totalRow, fontWeight: 800, color: detail.balanceDue > 0 ? colors.danger : colors.success }}>
                  <span>Balance due</span><span>Rs. {money(detail.balanceDue)}</span>
                </div>
              </div>
            </div>
            <div style={formStyles.footer}>
              {header.canPrint && (
                <button style={{ ...formStyles.button, ...formStyles.submit }}
                  onClick={() => print(detail.invoiceNumber)}>
                  <MdPrint size={16} style={{ verticalAlign: "-3px", marginRight: 5 }} /> Print / Save PDF
                </button>
              )}
              <button style={{ ...formStyles.button, ...formStyles.cancel }} onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", background: "#f5f7fa" },
  centered: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", background: "#f5f7fa", color: colors.textSecondary },
  goneCard: { background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 14, padding: "2rem 1.5rem", textAlign: "center", maxWidth: 420, boxShadow: "0 2px 14px rgba(0,0,0,0.06)" },
  header: { background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", padding: "1.1rem clamp(0.9rem, 3vw, 2rem)" },
  headerInner: { maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" },
  company: { fontSize: "1.2rem", fontWeight: 800, overflowWrap: "anywhere" },
  companyMeta: { fontSize: "0.8rem", opacity: 0.9, marginTop: 2, overflowWrap: "anywhere" },
  forWhom: { display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 0 },
  forLabel: { fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.85 },
  clientName: { fontSize: "1rem", fontWeight: 700, overflowWrap: "anywhere", textAlign: "right" },
  main: { maxWidth: 1200, margin: "0 auto", padding: "clamp(0.9rem, 2vw, 1.5rem)" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "0.85rem", marginBottom: "1.1rem" },
  sumCard: { background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.9rem 1rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
  sumLabel: { fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary },
  sumValue: { fontSize: "1.3rem", fontWeight: 800, color: colors.textPrimary, overflowWrap: "anywhere" },
  sumHint: { fontSize: "0.74rem", color: colors.textSecondary },
  filters: { display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.9rem", alignItems: "center" },
  searchForm: { display: "flex", gap: "0.4rem", flex: "1 1 240px", minWidth: 0 },
  searchIcon: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.textSecondary },
  searchBtn: { padding: "0 1rem", height: 44, borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  statusRow: { display: "flex", gap: "0.35rem", flexWrap: "wrap" },
  statusBtn: { padding: "0 0.8rem", height: 44, borderRadius: 999, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textSecondary, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  statusBtnOn: { background: colors.blue, borderColor: colors.blue, color: "#fff" },
  table: { width: "100%", borderCollapse: "collapse", background: "#fff", minWidth: 320 },
  th: { padding: "0.55rem 0.6rem", textAlign: "left", fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary, borderBottom: `1px solid ${colors.cardBorder}`, whiteSpace: "nowrap" },
  td: { padding: "0.5rem 0.6rem", fontSize: "0.84rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textPrimary },
  badge: { display: "inline-block", fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" },
  card: { background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.8rem 0.9rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  invNo: { fontWeight: 800, fontSize: "0.98rem", color: colors.textPrimary },
  cardMeta: { fontSize: "0.76rem", color: colors.textSecondary, margin: "0.35rem 0 0.5rem", overflowWrap: "anywhere" },
  cardAmounts: { display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.84rem", color: colors.textSecondary, flexWrap: "wrap" },
  cardBtns: { display: "flex", gap: "0.45rem", marginTop: "0.6rem", paddingTop: "0.55rem", borderTop: `1px solid ${colors.cardBorder}` },
  rowBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "0 0.85rem", height: 44, minWidth: 44, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  emptyList: { padding: "2.5rem 1rem", textAlign: "center", color: colors.textSecondary, background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 12 },
  pager: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", marginTop: "1rem" },
  pageBtn: { display: "grid", placeItems: "center", width: 44, height: 44, padding: 0, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, cursor: "pointer", boxShadow: "none" },
  detailMeta: { display: "flex", flexWrap: "wrap", gap: "0.9rem", fontSize: "0.82rem", color: colors.textSecondary, marginBottom: "0.8rem" },
  totals: { marginTop: "0.9rem", display: "grid", gap: "0.25rem", maxWidth: 420, marginLeft: "auto" },
  totalRow: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.86rem", color: colors.textPrimary },
};
