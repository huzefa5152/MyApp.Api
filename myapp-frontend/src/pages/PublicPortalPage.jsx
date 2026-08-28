import { useCallback, useEffect, useState } from "react";
import {
  MdSearch, MdPictureAsPdf, MdPrint, MdVisibility, MdClose, MdReceiptLong,
} from "react-icons/md";
import {
  getPortal, getPortalInvoices, getPortalInvoice, getPortalPrintPayload,
  portalTokenFromLocation,
} from "../api/portalApi";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";

// Standalone styling rather than the app's theme module: this page renders
// OUTSIDE the router and outside every provider (see main.jsx), so it must not
// depend on anything that assumes an authenticated shell.
const c = {
  blue: "#0d47a1", teal: "#00897b", ink: "#1a2332", muted: "#5f6d7e",
  line: "#e8edf3", bg: "#f7f9fc", white: "#fff",
  green: "#1b5e20", greenBg: "#e8f5e9", amber: "#b26a00", amberBg: "#fff8e1",
  red: "#b71c1c", redBg: "#ffebee", indigo: "#283593", indigoBg: "#e8eaf6",
};

const STATUS_TONES = {
  Paid: { fg: c.green, bg: c.greenBg },
  PartiallyPaid: { fg: c.amber, bg: c.amberBg },
  Unpaid: { fg: c.muted, bg: "#eceff1" },
  Overdue: { fg: c.red, bg: c.redBg },
  Overpaid: { fg: c.indigo, bg: c.indigoBg },
};

const STATUS_LABELS = {
  Paid: "Paid", PartiallyPaid: "Partially Paid", Unpaid: "Unpaid",
  Overdue: "Overdue", Overpaid: "Overpaid",
};

const FILTERS = [
  { key: "", label: "All" },
  { key: "Unpaid", label: "Unpaid" },
  { key: "PartiallyPaid", label: "Partially Paid" },
  { key: "Overdue", label: "Overdue" },
  { key: "Paid", label: "Paid" },
  { key: "Overpaid", label: "Overpaid" },
];

const money = (n) => `Rs ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(dt.getDate()).padStart(2, "0")} ${m[dt.getMonth()]} ${dt.getFullYear()}`;
};

export default function PublicPortalPage() {
  const token = portalTokenFromLocation();

  const [header, setHeader] = useState(null);
  const [fatal, setFatal] = useState("");
  const [loading, setLoading] = useState(true);

  const [rows, setRows] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Keyed by invoice number so one row's spinner never blocks another, and a
  // double-click can't start two generations of the same document.
  const [busy, setBusy] = useState({});
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!token) { setFatal("This customer portal is no longer available."); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await getPortal(token);
        if (!cancelled) setHeader(data);
      } catch (err) {
        if (!cancelled) setFatal(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const loadInvoices = useCallback(async () => {
    if (!token || fatal) return;
    setListLoading(true);
    try {
      const data = await getPortalInvoices(token, {
        page, pageSize: 10, status, search, dateFrom, dateTo,
      });
      setRows(data.items || []);
      setTotalPages(data.totalPages || 0);
      setTotalCount(data.totalCount || 0);
    } catch (err) {
      setRows([]); setTotalPages(0); setTotalCount(0);
      setNotice(err.message);
    } finally {
      setListLoading(false);
    }
  }, [token, fatal, page, status, search, dateFrom, dateTo]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);
  // Any filter change restarts paging — otherwise page 3 of "All" becomes an
  // empty page 3 of "Overpaid".
  useEffect(() => { setPage(1); }, [status, search, dateFrom, dateTo]);

  const openDetail = async (invoiceNumber) => {
    setDetailLoading(true);
    setDetail({ invoiceNumber });
    try {
      setDetail(await getPortalInvoice(token, invoiceNumber));
    } catch (err) {
      setDetail(null);
      setNotice(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  /**
   * Print and PDF both go through the SAME merge + render path the internal app
   * uses (mergeTemplate → writeAndPrint / exportToPdf). The server picks the
   * company's configured default template and hands down only that one, so the
   * customer's copy is the same document the office prints.
   */
  const withTemplate = async (invoiceNumber, kind, run) => {
    const key = `${invoiceNumber}-${kind}`;
    if (busy[key]) return;
    setBusy((b) => ({ ...b, [key]: true }));
    setNotice("");
    try {
      const payload = await getPortalPrintPayload(token, invoiceNumber);
      const stampUrl = Object.values(payload.stampMap || {})[0] || null;
      const merged = mergeTemplate(payload.templateHtml, { ...payload.printData, stamp: stampUrl });
      await run(merged, payload.fileNameBase);
    } catch (err) {
      setNotice(err.message || "Could not prepare the document.");
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const handlePrint = (n) => withTemplate(n, "print", async (html) => {
    // Opened before the await chain resolves would be nicer for popup blockers,
    // but the internal app has the same shape and operators live with it.
    const w = window.open("", "_blank");
    if (!w) throw new Error("Allow pop-ups for this site to print the invoice.");
    writeAndPrint(w, html);
  });

  const handlePdf = (n) => withTemplate(n, "pdf", async (html, base) => {
    await exportToPdf(html, `${base}.pdf`);
  });

  if (loading) return <Centered><Spinner /><p style={s.muted}>Loading your invoices…</p></Centered>;

  if (fatal) {
    return (
      <Centered>
        <MdReceiptLong size={44} color={c.line} />
        <h1 style={s.emptyTitle}>This customer portal is no longer available.</h1>
        <p style={s.muted}>Please contact your supplier for an up-to-date link.</p>
      </Centered>
    );
  }

  const sum = header.summary || {};

  return (
    <div style={s.page}>
      <div style={s.shell}>
        <header style={s.header}>
          <div style={s.brandRow}>
            {header.companyLogoPath && (
              <img src={header.companyLogoPath} alt="" style={s.logo} />
            )}
            <div style={{ minWidth: 0 }}>
              <h1 style={s.company}>{header.companyName}</h1>
              <p style={s.sub}>Customer Portal</p>
            </div>
          </div>
          <div style={s.customerBox}>
            <span style={s.customerLabel}>Customer</span>
            <span style={s.customerName}>{header.clientName}</span>
          </div>
        </header>

        <section style={s.cards}>
          <Card label="Total Invoices" value={sum.totalInvoices ?? 0} />
          <Card label="Total Amount" value={money(sum.totalAmount)} />
          <Card label="Outstanding" value={money(sum.outstandingAmount)} tone={c.red} />
          <Card label="Paid" value={money(sum.paidAmount)} tone={c.green} />
          {sum.overpaidAmount > 0 && (
            <Card label="Overpaid" value={money(sum.overpaidAmount)} tone={c.indigo} />
          )}
        </section>

        <section style={s.controls}>
          <div style={s.filterRow}>
            {FILTERS.map((f) => (
              <button
                key={f.key || "all"}
                type="button"
                onClick={() => setStatus(f.key)}
                style={{ ...s.filterBtn, ...(status === f.key ? s.filterBtnActive : null) }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div style={s.searchRow}>
            <div style={s.searchWrap}>
              <MdSearch size={16} style={s.searchIcon} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by invoice number"
                style={s.searchInput}
                inputMode="numeric"
              />
            </div>
            <label style={s.dateWrap}>
              <span style={s.dateLabel}>From</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={s.date} />
            </label>
            <label style={s.dateWrap}>
              <span style={s.dateLabel}>To</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={s.date} />
            </label>
          </div>
        </section>

        {notice && <div style={s.notice}>{notice}</div>}

        {listLoading ? (
          <Centered><Spinner /></Centered>
        ) : rows.length === 0 ? (
          <div style={s.empty}>
            <MdReceiptLong size={36} color={c.line} />
            <p style={s.muted}>
              {status
                ? `You have no ${(STATUS_LABELS[status] || status).toLowerCase()} invoices.`
                : "No invoices are available for this account."}
            </p>
          </div>
        ) : (
          <>
            {/* Table on desktop, stacked cards on phones — same convention as
                the internal document lists. */}
            <div style={s.tableWrap} className="portal-table">
              <table style={s.table}>
                <thead>
                  <tr>
                    <Th>Invoice #</Th><Th>Date</Th><Th>Due Date</Th>
                    <Th right>Total</Th><Th right>Paid</Th><Th right>Balance</Th>
                    <Th>Status</Th><Th right>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.invoiceNumber} style={s.tr}>
                      <td style={s.tdStrong}>#{r.invoiceNumber}</td>
                      <td style={s.td}>{fmtDate(r.date)}</td>
                      <td style={s.td}>{fmtDate(r.dueDate)}</td>
                      <td style={s.tdRight}>{money(r.total)}</td>
                      <td style={s.tdRight}>{money(r.paid)}</td>
                      <td style={s.tdRight}>
                        {r.credit > 0
                          ? <span style={{ color: c.indigo }}>{money(r.credit)} over</span>
                          : money(r.balance)}
                      </td>
                      <td style={s.td}><StatusPill status={r.status} days={r.daysOverdue} /></td>
                      <td style={{ ...s.tdRight, whiteSpace: "nowrap" }}>
                        <RowActions
                          n={r.invoiceNumber}
                          busy={busy}
                          canPrint={header.canPrint}
                          onView={openDetail}
                          onPdf={handlePdf}
                          onPrint={handlePrint}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="portal-cards" style={s.cardList}>
              {rows.map((r) => (
                <div key={r.invoiceNumber} style={s.invCard}>
                  <div style={s.invCardTop}>
                    <span style={s.invNum}>#{r.invoiceNumber}</span>
                    <StatusPill status={r.status} days={r.daysOverdue} />
                  </div>
                  <div style={s.invMeta}>{fmtDate(r.date)} · due {fmtDate(r.dueDate)}</div>
                  <div style={s.invMoney}>
                    <span>Total <strong>{money(r.total)}</strong></span>
                    <span>Paid <strong>{money(r.paid)}</strong></span>
                    <span>
                      {r.credit > 0 ? "Overpaid " : "Balance "}
                      <strong style={r.credit > 0 ? { color: c.indigo } : undefined}>
                        {money(r.credit > 0 ? r.credit : r.balance)}
                      </strong>
                    </span>
                  </div>
                  <div style={s.invActions}>
                    <RowActions
                      n={r.invoiceNumber}
                      busy={busy}
                      canPrint={header.canPrint}
                      onView={openDetail}
                      onPdf={handlePdf}
                      onPrint={handlePrint}
                      wide
                    />
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div style={s.pager}>
                <button type="button" style={s.pageBtn} disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
                <span style={s.muted}>Page {page} of {totalPages} · {totalCount} invoices</span>
                <button type="button" style={s.pageBtn} disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            )}
          </>
        )}

        <footer style={s.footer}>
          {header.companyAddress && <div>{header.companyAddress}</div>}
          <div>
            {header.companyPhone && <span>{header.companyPhone}</span>}
            {header.companyNTN && <span style={{ marginLeft: 12 }}>NTN {header.companyNTN}</span>}
            {header.companySTRN && <span style={{ marginLeft: 12 }}>STRN {header.companySTRN}</span>}
          </div>
        </footer>
      </div>

      {detail && (
        <InvoiceDetailModal
          detail={detail}
          loading={detailLoading}
          busy={busy}
          canPrint={header.canPrint}
          onClose={() => setDetail(null)}
          onPdf={handlePdf}
          onPrint={handlePrint}
        />
      )}

      <style>{RESPONSIVE_CSS}</style>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function RowActions({ n, busy, canPrint, onView, onPdf, onPrint, wide }) {
  const btn = wide ? s.actionBtnWide : s.actionBtn;
  return (
    <>
      <button type="button" style={btn} onClick={() => onView(n)} title="View invoice">
        <MdVisibility size={15} />{wide && " View"}
      </button>
      {/* Hidden outright when the company has no Bill template — a download
          button that can only fail is worse than no button. */}
      {!canPrint ? null : <>
      <button
        type="button"
        style={{ ...btn, ...(busy[`${n}-pdf`] ? s.actionBtnBusy : null) }}
        disabled={!!busy[`${n}-pdf`]}
        onClick={() => onPdf(n)}
        title="Download PDF"
      >
        <MdPictureAsPdf size={15} />{wide && (busy[`${n}-pdf`] ? " Preparing…" : " PDF")}
      </button>
      <button
        type="button"
        style={{ ...btn, ...(busy[`${n}-print`] ? s.actionBtnBusy : null) }}
        disabled={!!busy[`${n}-print`]}
        onClick={() => onPrint(n)}
        title="Print invoice"
      >
        <MdPrint size={15} />{wide && " Print"}
      </button>
      </>}
    </>
  );
}

function StatusPill({ status, days }) {
  const tone = STATUS_TONES[status] || STATUS_TONES.Unpaid;
  return (
    <span style={{ ...s.pill, color: tone.fg, backgroundColor: tone.bg }}>
      {STATUS_LABELS[status] || status}
      {status === "Overdue" && days > 0 ? ` ${days}d` : ""}
    </span>
  );
}

function Card({ label, value, tone }) {
  return (
    <div style={s.card}>
      <span style={s.cardLabel}>{label}</span>
      <span style={{ ...s.cardValue, ...(tone ? { color: tone } : null) }}>{value}</span>
    </div>
  );
}

function InvoiceDetailModal({ detail, loading, busy, canPrint, onClose, onPdf, onPrint }) {
  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <h2 style={s.modalTitle}>Invoice #{detail.invoiceNumber}</h2>
          <button type="button" style={s.closeBtn} onClick={onClose} aria-label="Close">
            <MdClose size={20} />
          </button>
        </div>

        {loading || !detail.items ? (
          <div style={s.modalBody}><Centered><Spinner /></Centered></div>
        ) : (
          <>
            <div style={s.modalBody}>
              <div style={s.detailGrid}>
                <Field label="Invoice Date" value={fmtDate(detail.date)} />
                <Field label="Due Date" value={fmtDate(detail.dueDate)} />
                <Field label="Status" value={<StatusPill status={detail.status} />} />
                {detail.poNumber && <Field label="Your PO" value={detail.poNumber} />}
                {detail.paymentTerms && <Field label="Payment Terms" value={detail.paymentTerms} />}
              </div>

              <div style={s.detailBlock}>
                <div style={s.blockTitle}>Billed To</div>
                <div style={s.blockBody}>
                  <div style={{ fontWeight: 700 }}>{detail.clientName}</div>
                  {detail.clientAddress && <div>{detail.clientAddress}</div>}
                  {detail.clientPhone && <div>{detail.clientPhone}</div>}
                  {detail.clientNTN && <div>NTN {detail.clientNTN}</div>}
                </div>
              </div>

              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <Th>Description</Th><Th right>Qty</Th><Th>Unit</Th>
                      <Th right>Unit Price</Th><Th right>Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((it, i) => (
                      <tr key={i} style={s.tr}>
                        <td style={s.td}>{it.description}</td>
                        <td style={s.tdRight}>{it.quantity}</td>
                        <td style={s.td}>{it.uom}</td>
                        <td style={s.tdRight}>{money(it.unitPrice)}</td>
                        <td style={s.tdRight}>{money(it.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={s.totals}>
                <Total label="Subtotal" value={money(detail.subtotal)} />
                <Total label={`GST (${detail.gstRate}%)`} value={money(detail.gstAmount)} />
                {detail.withholdingTaxAmount > 0 && (
                  <Total label="Withholding Tax" value={`− ${money(detail.withholdingTaxAmount)}`} />
                )}
                <Total label="Invoice Total" value={money(detail.total)} strong />
                <Total label="Paid" value={money(detail.paid)} />
                {detail.credit > 0
                  ? <Total label="Overpaid" value={money(detail.credit)} strong tone={c.indigo} />
                  : <Total label="Outstanding" value={money(detail.balance)} strong tone={detail.balance > 0 ? c.red : c.green} />}
              </div>

              {detail.amountInWords && <p style={s.words}>{detail.amountInWords}</p>}
            </div>

            <div style={s.modalFoot}>
              {!canPrint ? (
                <span style={s.muted}>Printable copies aren't available for this account.</span>
              ) : <>
              <button type="button" style={s.footBtn}
                disabled={!!busy[`${detail.invoiceNumber}-pdf`]}
                onClick={() => onPdf(detail.invoiceNumber)}>
                <MdPictureAsPdf size={15} />{busy[`${detail.invoiceNumber}-pdf`] ? " Preparing…" : " Download PDF"}
              </button>
              <button type="button" style={{ ...s.footBtn, ...s.footBtnPrimary }}
                disabled={!!busy[`${detail.invoiceNumber}-print`]}
                onClick={() => onPrint(detail.invoiceNumber)}>
                <MdPrint size={15} /> Print
              </button>
              </>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const Th = ({ children, right }) => (
  <th style={{ ...s.th, textAlign: right ? "right" : "left" }}>{children}</th>
);
const Field = ({ label, value }) => (
  <div><span style={s.fieldLabel}>{label}</span><span style={s.fieldValue}>{value}</span></div>
);
const Total = ({ label, value, strong, tone }) => (
  <div style={s.totalRow}>
    <span style={strong ? s.totalLabelStrong : s.totalLabel}>{label}</span>
    <span style={{ ...(strong ? s.totalValueStrong : s.totalValue), ...(tone ? { color: tone } : null) }}>{value}</span>
  </div>
);
const Spinner = () => <div style={s.spinner} />;
const Centered = ({ children }) => <div style={s.centered}>{children}</div>;

// Phones get the stacked cards, desktops get the table. Plain CSS because the
// page runs outside the app shell and its stylesheet conventions.
const RESPONSIVE_CSS = `
@keyframes portal-spin { to { transform: rotate(360deg); } }
.portal-cards { display: none; }
@media (max-width: 820px) {
  .portal-table { display: none; }
  .portal-cards { display: grid; }
}
`;

const s = {
  page: { minHeight: "100vh", backgroundColor: c.bg, padding: "1.25rem 1rem 3rem", color: c.ink,
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" },
  shell: { maxWidth: 1120, margin: "0 auto" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    gap: "1rem", flexWrap: "wrap", padding: "1.25rem", backgroundColor: c.white,
    border: `1px solid ${c.line}`, borderRadius: 14, marginBottom: "1rem" },
  brandRow: { display: "flex", alignItems: "center", gap: "0.9rem", minWidth: 0 },
  logo: { height: 52, width: "auto", maxWidth: 180, objectFit: "contain" },
  company: { margin: 0, fontSize: "1.35rem", fontWeight: 800, color: c.ink,
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  sub: { margin: "0.15rem 0 0", fontSize: "0.85rem", color: c.muted, letterSpacing: "0.02em" },
  customerBox: { display: "flex", flexDirection: "column", gap: "0.15rem" },
  customerLabel: { fontSize: "0.7rem", textTransform: "uppercase", fontWeight: 700,
    letterSpacing: "0.04em", color: c.muted },
  customerName: { fontSize: "1rem", fontWeight: 700, color: c.blue,
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },

  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
    gap: "0.75rem", marginBottom: "1rem" },
  card: { backgroundColor: c.white, border: `1px solid ${c.line}`, borderRadius: 12,
    padding: "0.85rem 1rem", display: "flex", flexDirection: "column", gap: "0.3rem" },
  cardLabel: { fontSize: "0.74rem", textTransform: "uppercase", fontWeight: 700,
    letterSpacing: "0.03em", color: c.muted },
  cardValue: { fontSize: "1.15rem", fontWeight: 800, color: c.ink },

  controls: { backgroundColor: c.white, border: `1px solid ${c.line}`, borderRadius: 12,
    padding: "0.85rem 1rem", marginBottom: "1rem", display: "flex",
    flexDirection: "column", gap: "0.75rem" },
  filterRow: { display: "flex", gap: "0.4rem", flexWrap: "wrap" },
  filterBtn: { padding: "0.5rem 0.95rem", minHeight: 44, borderRadius: 999,
    border: `1px solid ${c.line}`, backgroundColor: c.white, color: c.muted,
    fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" },
  filterBtnActive: { backgroundColor: c.blue, borderColor: c.blue, color: c.white },
  searchRow: { display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" },
  searchWrap: { position: "relative", flex: "1 1 220px", minWidth: 0 },
  searchIcon: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: c.muted },
  searchInput: { width: "100%", padding: "0.6rem 0.75rem 0.6rem 2rem", minHeight: 44,
    borderRadius: 10, border: `1px solid ${c.line}`, fontSize: "0.9rem",
    backgroundColor: c.bg, color: c.ink, boxSizing: "border-box" },
  dateWrap: { display: "flex", flexDirection: "column", gap: "0.2rem" },
  dateLabel: { fontSize: "0.72rem", fontWeight: 700, color: c.muted, textTransform: "uppercase" },
  date: { padding: "0.55rem 0.7rem", minHeight: 44, borderRadius: 10,
    border: `1px solid ${c.line}`, fontSize: "0.85rem", backgroundColor: c.bg, color: c.ink },

  notice: { backgroundColor: c.amberBg, color: c.amber, border: `1px solid #ffecb5`,
    borderRadius: 10, padding: "0.65rem 1rem", marginBottom: "1rem", fontSize: "0.86rem" },

  tableWrap: { backgroundColor: c.white, border: `1px solid ${c.line}`, borderRadius: 12,
    overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 720 },
  th: { padding: "0.7rem 0.9rem", fontSize: "0.72rem", textTransform: "uppercase",
    fontWeight: 700, letterSpacing: "0.03em", color: c.muted,
    borderBottom: `2px solid ${c.line}`, whiteSpace: "nowrap" },
  tr: { borderBottom: `1px solid ${c.line}` },
  td: { padding: "0.7rem 0.9rem", fontSize: "0.88rem", color: c.ink },
  tdStrong: { padding: "0.7rem 0.9rem", fontSize: "0.88rem", fontWeight: 700, color: c.blue },
  tdRight: { padding: "0.7rem 0.9rem", fontSize: "0.88rem", color: c.ink, textAlign: "right" },

  cardList: { gap: "0.75rem" },
  invCard: { backgroundColor: c.white, border: `1px solid ${c.line}`, borderRadius: 12, padding: "0.9rem" },
  invCardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" },
  invNum: { fontWeight: 800, color: c.blue },
  invMeta: { marginTop: "0.3rem", fontSize: "0.8rem", color: c.muted },
  invMoney: { marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.15rem",
    fontSize: "0.85rem", color: c.muted },
  invActions: { marginTop: "0.75rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" },

  pill: { display: "inline-block", padding: "0.2rem 0.6rem", borderRadius: 999,
    fontSize: "0.74rem", fontWeight: 700, whiteSpace: "nowrap" },

  actionBtn: { display: "inline-grid", placeItems: "center", width: 34, height: 34,
    marginLeft: 4, borderRadius: 8, border: `1px solid ${c.line}`,
    backgroundColor: c.white, color: c.blue, cursor: "pointer" },
  actionBtnWide: { display: "inline-flex", alignItems: "center", gap: 5,
    padding: "0.5rem 0.8rem", minHeight: 44, borderRadius: 8,
    border: `1px solid ${c.line}`, backgroundColor: c.white, color: c.blue,
    fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  actionBtnBusy: { opacity: 0.55, cursor: "progress" },

  pager: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem",
    padding: "1rem 0", flexWrap: "wrap" },
  pageBtn: { padding: "0.5rem 1rem", minHeight: 44, borderRadius: 8,
    border: `1px solid ${c.line}`, backgroundColor: c.white, color: c.blue,
    fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" },

  empty: { backgroundColor: c.white, border: `1px solid ${c.line}`, borderRadius: 12,
    padding: "3rem 1rem", textAlign: "center" },
  emptyTitle: { fontSize: "1.1rem", fontWeight: 700, margin: "0.75rem 0 0.25rem" },
  centered: { display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: "0.75rem", padding: "3rem 1rem", textAlign: "center" },
  muted: { color: c.muted, fontSize: "0.9rem", margin: 0 },
  spinner: { width: 28, height: 28, border: `3px solid ${c.line}`, borderTopColor: c.blue,
    borderRadius: "50%", animation: "portal-spin 0.8s linear infinite" },

  footer: { marginTop: "1.5rem", textAlign: "center", fontSize: "0.78rem",
    color: c.muted, lineHeight: 1.6 },

  backdrop: { position: "fixed", inset: 0, backgroundColor: "rgba(15,23,42,0.55)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 50 },
  modal: { backgroundColor: c.white, borderRadius: 14, width: "100%", maxWidth: 820,
    maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "1rem 1.25rem", borderBottom: `1px solid ${c.line}` },
  modalTitle: { margin: 0, fontSize: "1.1rem", fontWeight: 800 },
  closeBtn: { display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 8,
    border: "none", backgroundColor: "transparent", color: c.muted, cursor: "pointer" },
  modalBody: { padding: "1.25rem", overflowY: "auto" },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: "0.5rem",
    padding: "0.9rem 1.25rem", borderTop: `1px solid ${c.line}`, flexWrap: "wrap" },
  footBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.6rem 1rem",
    minHeight: 44, borderRadius: 10, border: `1px solid ${c.line}`,
    backgroundColor: c.white, color: c.blue, fontSize: "0.88rem", fontWeight: 600, cursor: "pointer" },
  footBtnPrimary: { backgroundColor: c.blue, borderColor: c.blue, color: c.white },

  detailGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))",
    gap: "0.75rem", marginBottom: "1rem" },
  fieldLabel: { display: "block", fontSize: "0.72rem", textTransform: "uppercase",
    fontWeight: 700, color: c.muted, marginBottom: 2 },
  fieldValue: { fontSize: "0.9rem", fontWeight: 600 },
  detailBlock: { marginBottom: "1rem" },
  blockTitle: { fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700,
    color: c.muted, marginBottom: "0.3rem" },
  blockBody: { fontSize: "0.88rem", lineHeight: 1.5 },
  totals: { marginTop: "1rem", marginLeft: "auto", maxWidth: 340,
    display: "flex", flexDirection: "column", gap: "0.25rem" },
  totalRow: { display: "flex", justifyContent: "space-between", gap: "1rem" },
  totalLabel: { fontSize: "0.85rem", color: c.muted },
  totalValue: { fontSize: "0.85rem" },
  totalLabelStrong: { fontSize: "0.9rem", fontWeight: 700 },
  totalValueStrong: { fontSize: "0.95rem", fontWeight: 800 },
  words: { marginTop: "1rem", fontSize: "0.8rem", color: c.muted, fontStyle: "italic" },
};
