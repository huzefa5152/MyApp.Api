import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MdSearch, MdPictureAsPdf, MdPrint, MdArrowForward, MdClose, MdReceiptLong,
  MdOutlineInbox, MdErrorOutline, MdCheckCircle,
} from "react-icons/md";
import {
  getPortal, getPortalInvoices, getPortalInvoice, getPortalPrintPayload,
  portalTokenFromLocation,
} from "../api/portalApi";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";

/**
 * The public Customer Portal.
 *
 * This is the only screen in the product a CUSTOMER ever sees, so it is built as
 * a finance document rather than an admin table: one figure leads (what they
 * owe), everything else supports it, and money is set in tabular numerals so
 * the columns line up the way a statement does.
 *
 * Design system "Soft UI Evolution" — navy authority, restrained depth, WCAG AA+
 * contrast — with IBM Plex Sans, the pairing intended for banking and finance.
 * Tokens live in T; no raw hex is written inline.
 *
 * The page renders outside the app shell (see main.jsx), so it carries its own
 * reset, type and tokens and shares no styling with the internal ERP.
 */

const T = {
  primary: "#1E3A5F",
  primarySoft: "#EEF2F7",
  secondary: "#2563EB",
  accent: "#059669",
  accentSoft: "#ECFDF5",
  bg: "#F8FAFC",
  surface: "#FFFFFF",
  fg: "#0F172A",
  muted: "#64748B",
  faint: "#94A3B8",
  border: "#E4E7EB",
  danger: "#DC2626",
  dangerSoft: "#FEF2F2",
  warn: "#B45309",
  warnSoft: "#FFFBEB",
  info: "#1D4ED8",
  infoSoft: "#EFF6FF",
  slateSoft: "#F1F5F9",
  shadow: "0 1px 2px rgba(15,23,42,0.04), 0 2px 8px rgba(15,23,42,0.04)",
  shadowLift: "0 2px 4px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.08)",
  radius: 12,
};

const STATUS = {
  Paid:          { label: "Paid",           fg: T.accent, bg: T.accentSoft, dot: T.accent },
  PartiallyPaid: { label: "Partially paid", fg: T.warn,   bg: T.warnSoft,   dot: T.warn },
  Unpaid:        { label: "Unpaid",         fg: T.muted,  bg: T.slateSoft,  dot: T.faint },
  Overdue:       { label: "Overdue",        fg: T.danger, bg: T.dangerSoft, dot: T.danger },
  Overpaid:      { label: "Overpaid",       fg: T.info,   bg: T.infoSoft,   dot: T.info },
};

/** Rows per page offered to the customer; the API caps the request at 200. */
const PAGE_SIZES = [10, 20, 50, 100, 200];

const money = (n) =>
  "Rs " + Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(dt.getDate()).padStart(2, "0")} ${m[dt.getMonth()]} ${dt.getFullYear()}`;
};

const balanceColour = (r) =>
  r.credit > 0 ? T.info : r.balance > 0 ? (r.status === "Overdue" ? T.danger : T.fg) : T.accent;

export default function PublicPortalPage() {
  const token = portalTokenFromLocation();

  const [header, setHeader] = useState(null);
  const [fatal, setFatal] = useState(false);
  const [loading, setLoading] = useState(true);

  const [rows, setRows] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Keyed per invoice + action, so one row's spinner never blocks another and a
  // double-click can't start two generations of the same document.
  const [busy, setBusy] = useState({});
  const [notice, setNotice] = useState("");

  // Typing shouldn't fire a request per keystroke on someone's mobile data.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    if (!token) { setFatal(true); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await getPortal(token);
        if (!cancelled) setHeader(data);
      } catch {
        if (!cancelled) setFatal(true);
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
      const data = await getPortalInvoices(token, { page, pageSize, status, search, dateFrom, dateTo });
      setRows(data.items || []);
      setTotalPages(data.totalPages || 0);
      setTotalCount(data.totalCount || 0);
    } catch (err) {
      setRows([]); setTotalPages(0); setTotalCount(0);
      setNotice(err.message);
    } finally {
      setListLoading(false);
    }
  }, [token, fatal, page, pageSize, status, search, dateFrom, dateTo]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);
  // Any filter change restarts paging — otherwise page 3 of "All" becomes an
  // empty page 3 of "Overpaid".
  useEffect(() => { setPage(1); }, [status, search, dateFrom, dateTo]);

  // "Showing 21–40 of 137" — derived, so it can never disagree with the server.
  const firstOnPage = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastOnPage = Math.min(page * pageSize, totalCount);

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

  /** Print and PDF share the app's one merge + render path — no second renderer. */
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
    const w = window.open("", "_blank");
    if (!w) throw new Error("Allow pop-ups for this site to print the invoice.");
    writeAndPrint(w, html);
  });

  const handlePdf = (n) => withTemplate(n, "pdf", async (html, base) => {
    await exportToPdf(html, `${base}.pdf`);
  });

  const sum = header?.summary || {};
  const openCount = (sum.unpaidCount || 0) + (sum.partiallyPaidCount || 0) + (sum.overdueCount || 0);
  // A chip with nothing behind it is a dead control — and six of them push the
  // filter bar onto a second line, which costs a row of invoices. "All" always
  // shows, and so does whatever is currently selected even once it empties.
  // Payment status is not shown on the portal (2026-09-03). A status here is
  // derived from receipts ALLOCATED to a specific invoice, and this business
  // takes receipts on account -- so a customer who had paid in full still saw
  // every document marked "Unpaid", or worse "Overdue". Telling a customer they
  // owe money they have already sent is the most damaging place to get this
  // wrong, so the document list states the figures and leaves the verdict out.
  const filters = useMemo(() => ([
    { key: "", label: "All", count: sum.totalInvoices },
  ]), [sum]);

  if (loading) {
    return <Frame><div style={s.centre}><Spinner /><p style={s.centreText}>Loading your account…</p></div></Frame>;
  }

  if (fatal) {
    return (
      <Frame>
        <div style={s.centre}>
          <div style={s.emptyIcon}><MdErrorOutline size={30} color={T.faint} /></div>
          <h1 style={s.emptyTitle}>This portal is no longer available</h1>
          <p style={s.centreText}>
            The link may have been turned off or replaced. Please contact your supplier for an up-to-date link.
          </p>
        </div>
      </Frame>
    );
  }

  const hasCredit = (sum.overpaidAmount || 0) > 0;

  return (
    <Frame>
      <header style={s.masthead}>
        <div className="portal-masthead" style={s.mastheadInner}>
          <div style={s.brand}>
            {header.companyLogoPath
              ? <img src={header.companyLogoPath} alt="" style={s.logo} />
              : <div style={s.logoFallback}><MdReceiptLong size={22} color={T.primary} /></div>}
            <div style={{ minWidth: 0 }}>
              <div style={s.companyName}>{header.companyName}</div>
              <div style={s.eyebrow}>Customer portal</div>
            </div>
          </div>
          <div style={s.customerChip}>
            <span style={s.customerLabel}>Account</span>
            <span style={s.customerName}>{header.clientName}</span>
          </div>
        </div>
      </header>

      {/* Static band: the figures and the filters stay put, so the customer
          never loses "what do I owe" or the status chips while scrolling a
          long list. Only the grid below moves. */}
      <div className="portal-static" style={s.staticBand}>
        <div className="portal-band" style={s.bandInner}>
        {/* One horizontal strip rather than a stack of cards: the figures still
            read at a glance, but they cost ~75px instead of ~390px, and every
            pixel saved here is another invoice row visible without scrolling. */}
        <section className="portal-hero" style={s.hero} aria-label="Account summary">
          <div style={s.heroPrimary}>
            <span style={s.heroLabel}>Amount outstanding</span>
            <span className="portal-herovalue"
                  style={{ ...s.heroValue, color: (sum.outstandingAmount || 0) > 0 ? T.fg : T.accent }}>
              {money(sum.outstandingAmount)}
            </span>
            <span style={s.heroHint}>
              {(sum.outstandingAmount || 0) > 0
                ? `across ${openCount} open invoice${openCount === 1 ? "" : "s"}`
                : "Everything is settled — thank you"}
            </span>
          </div>

          {(sum.overdueCount || 0) > 0 && (
            <span style={s.heroFlag}>
              <span style={{ ...s.dot, background: T.danger }} aria-hidden="true" />
              {sum.overdueCount} overdue
            </span>
          )}

          <div style={s.heroStats}>
            <Stat label="Invoices" value={sum.totalInvoices ?? 0} />
            <Stat label="Total billed" value={money(sum.totalAmount)} />
            <Stat label="Total paid" value={money(sum.paidAmount)} tone={T.accent} />
            {hasCredit && <Stat label="Credit held" value={money(sum.overpaidAmount)} tone={T.info} />}
          </div>
        </section>

        <section className="portal-controls" style={s.controls} aria-label="Filter invoices">
          <div style={s.chipRow} role="tablist" aria-label="Filter by status">
            {filters.map((f) => {
              const active = status === f.key;
              return (
                <button
                  key={f.key || "all"}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatus(f.key)}
                  className="portal-chip"
                  style={{ ...s.chip, ...(active ? s.chipActive : null) }}
                >
                  {f.label}
                  {typeof f.count === "number" && (
                    <span style={{ ...s.chipCount, ...(active ? s.chipCountActive : null) }}>{f.count}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="portal-filterrow" style={s.filterRow}>
            <div style={s.searchWrap}>
              <MdSearch size={17} style={s.searchIcon} aria-hidden="true" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search invoice number"
                aria-label="Search by invoice number"
                inputMode="numeric"
                className="portal-search"
                style={s.search}
              />
            </div>
            <div className="portal-dategroup" style={s.dateGroup}>
              <label style={s.dateField}>
                <span style={s.dateLabel}>From</span>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="portal-date" style={s.date} />
              </label>
              <label style={s.dateField}>
                <span style={s.dateLabel}>To</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="portal-date" style={s.date} />
              </label>
            </div>
            {(dateFrom || dateTo || search) && (
              <button type="button" className="portal-clear" style={s.clearFilters}
                      onClick={() => { setDateFrom(""); setDateTo(""); setSearchInput(""); }}>
                Clear
              </button>
            )}
          </div>
        </section>

        {notice && (
          <div style={s.notice} role="status">
            <MdErrorOutline size={17} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        </div>
      </div>

      <main className="portal-main" style={s.main}>
        <div className="portal-inner" style={s.mainInner}>
        {listLoading ? (
          <SkeletonList />
        ) : rows.length === 0 ? (
          <EmptyState status={status} />
        ) : (
          <>
            <div style={s.tableCard} className="portal-table">
              <table style={s.table}>
                <caption style={s.srOnly}>Your invoices</caption>
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Issued</Th>
                    <Th>Due</Th>
                    <Th align="right">Amount</Th>
                    <Th align="right">Paid</Th>
                    <Th align="right">Balance</Th>
                    <Th align="right"><span style={s.srOnly}>Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.invoiceNumber} className="portal-row" style={s.row}>
                      <td style={s.cell}>
                        <button type="button" className="portal-link"
                                onClick={() => openDetail(r.invoiceNumber)} style={s.invLink}>
                          #{r.invoiceNumber}
                        </button>
                      </td>
                      <td style={s.cellMuted}>{fmtDate(r.date)}</td>
                      <td style={s.cellMuted}>{fmtDate(r.dueDate)}</td>
                      <td style={s.num}>{money(r.total)}</td>
                      <td style={s.num}>{money(r.paid)}</td>
                      <td style={{ ...s.num, ...s.numStrong, color: balanceColour(r) }}>
                        {r.credit > 0 ? `+${money(r.credit)}` : money(r.balance)}
                      </td>
                      <td style={{ ...s.cell, textAlign: "right", whiteSpace: "nowrap" }}>
                        <Actions r={r} busy={busy} canPrint={header.canPrint}
                                 onView={openDetail} onPdf={handlePdf} onPrint={handlePrint} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="portal-cards" style={s.cardList}>
              {rows.map((r) => (
                <article key={r.invoiceNumber} style={s.card}>
                  <div style={s.cardHead}>
                    <button type="button" className="portal-link"
                            onClick={() => openDetail(r.invoiceNumber)} style={s.invLinkLg}>
                      #{r.invoiceNumber}
                    </button>
                  </div>
                  <div style={s.cardDates}>
                    Issued {fmtDate(r.date)}{r.dueDate ? ` · Due ${fmtDate(r.dueDate)}` : ""}
                  </div>
                  <dl style={s.cardFigures}>
                    <div style={s.figure}>
                      <dt style={s.figureLabel}>Amount</dt>
                      <dd style={s.figureValue}>{money(r.total)}</dd>
                    </div>
                    <div style={s.figure}>
                      <dt style={s.figureLabel}>Paid</dt>
                      <dd style={s.figureValue}>{money(r.paid)}</dd>
                    </div>
                    <div style={s.figure}>
                      <dt style={s.figureLabel}>{r.credit > 0 ? "Credit" : "Balance"}</dt>
                      <dd style={{ ...s.figureValue, ...s.figureStrong, color: balanceColour(r) }}>
                        {r.credit > 0 ? `+${money(r.credit)}` : money(r.balance)}
                      </dd>
                    </div>
                  </dl>
                  <div style={s.cardActions}>
                    <Actions r={r} busy={busy} canPrint={header.canPrint} wide
                             onView={openDetail} onPdf={handlePdf} onPrint={handlePrint} />
                  </div>
                </article>
              ))}
            </div>

          </>
        )}
        </div>
      </main>

      {/* Pinned below the scroller, so the pager is reachable without scrolling
          to the end of the page. It shows for any non-empty result set, not just
          multi-page ones — the rows-per-page picker lives here. */}
      {totalCount > 0 && (
        <div className="portal-pagerbar" style={s.pagerBar}>
          <nav style={s.pager} aria-label="Pagination">
            <label style={s.pageSizeWrap}>
              <span style={s.pageSizeLabel}>Rows</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="portal-pagesize"
                style={s.pageSize}
                aria-label="Invoices per page"
              >
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>

            <span style={s.pagerGroup}>
              <button type="button" style={s.pageBtn} disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
              <span style={s.pageInfo}>
                {firstOnPage}–{lastOnPage} of {totalCount}
                {totalPages > 1 && ` · page ${page} of ${totalPages}`}
              </span>
              <button type="button" style={s.pageBtn} disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}>Next</button>
            </span>

            {/* Mirrors the picker's width so the controls above stay centred. */}
            <span style={s.pagerBalance} aria-hidden="true" />
          </nav>
        </div>
      )}

      <footer className="portal-footer" style={s.footer}>
        <div style={s.footerName}>{header.companyName}</div>
        {header.companyAddress && <div>{header.companyAddress}</div>}
        <div style={s.footerMeta}>
          {header.companyPhone && <span>{header.companyPhone}</span>}
          {header.companyNTN && <span>NTN {header.companyNTN}</span>}
          {header.companySTRN && <span>STRN {header.companySTRN}</span>}
        </div>
      </footer>

      {detail && (
        <DetailModal detail={detail} loading={detailLoading} busy={busy}
                     canPrint={header.canPrint} onClose={() => setDetail(null)}
                     onPdf={handlePdf} onPrint={handlePrint} />
      )}
    </Frame>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function Frame({ children }) {
  return (
    <div className="portal-page" style={s.page}>
      {children}
      <style>{CSS}</style>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div style={s.stat}>
      <span style={s.statLabel}>{label}</span>
      <span style={{ ...s.statValue, ...(tone ? { color: tone } : null) }}>{value}</span>
    </div>
  );
}

function Actions({ r, busy, canPrint, wide, onView, onPdf, onPrint }) {
  const n = r.invoiceNumber;
  const base = wide ? s.actionWide : s.action;
  return (
    <>
      <button type="button" className="portal-action"
              style={wide ? s.actionWidePrimary : s.actionPrimary}
              onClick={() => onView(n)} aria-label={`View invoice ${n}`}>
        {wide ? <>View invoice <MdArrowForward size={15} /></> : <MdArrowForward size={16} />}
      </button>
      {/* Hidden outright when the company has no template for the document this
          portal serves — a download that can only fail is worse than no button. */}
      {canPrint && (
        <>
          <button type="button" className="portal-action"
                  style={{ ...base, ...(busy[`${n}-pdf`] ? s.actionBusy : null) }}
                  disabled={!!busy[`${n}-pdf`]} onClick={() => onPdf(n)}
                  aria-label={`Download invoice ${n} as PDF`}>
            <MdPictureAsPdf size={16} />{wide && (busy[`${n}-pdf`] ? " Preparing…" : " PDF")}
          </button>
          <button type="button" className="portal-action"
                  style={{ ...base, ...(busy[`${n}-print`] ? s.actionBusy : null) }}
                  disabled={!!busy[`${n}-print`]} onClick={() => onPrint(n)}
                  aria-label={`Print invoice ${n}`}>
            <MdPrint size={16} />{wide && " Print"}
          </button>
        </>
      )}
    </>
  );
}

/** Skeleton rows hold the page height steady, so nothing jumps when data lands. */
function SkeletonList() {
  return (
    <div style={s.tableCard} aria-busy="true" aria-label="Loading invoices">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={s.skelRow}>
          <span className="portal-skel" style={{ ...s.skel, width: 72 }} />
          <span className="portal-skel" style={{ ...s.skel, width: 96 }} />
          <span className="portal-skel" style={{ ...s.skel, width: 96, marginLeft: "auto" }} />
          <span className="portal-skel" style={{ ...s.skel, width: 104 }} />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ status }) {
  const label = (STATUS[status] || {}).label;
  return (
    <div style={s.empty}>
      <div style={s.emptyIcon}>
        {status ? <MdCheckCircle size={28} color={T.accent} /> : <MdOutlineInbox size={28} color={T.faint} />}
      </div>
      <h2 style={s.emptyTitle}>{status ? `No ${label.toLowerCase()} invoices` : "No invoices yet"}</h2>
      <p style={s.centreText}>
        {status
          ? "Try a different filter to see the rest of your account."
          : "Invoices raised for your account will appear here."}
      </p>
    </div>
  );
}

function DetailModal({ detail, loading, busy, canPrint, onClose, onPdf, onPrint }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const ready = !loading && detail.items;
  return (
    <div style={s.backdrop} onClick={onClose} role="dialog" aria-modal="true"
         aria-label={`Invoice ${detail.invoiceNumber}`}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <header style={s.modalHead}>
          <div>
            <div style={s.modalEyebrow}>Invoice</div>
            <h2 style={s.modalTitle}>#{detail.invoiceNumber}</h2>
          </div>
          <button type="button" style={s.close} onClick={onClose} aria-label="Close">
            <MdClose size={20} />
          </button>
        </header>

        <div style={s.modalBody}>
          {!ready ? (
            <div style={s.centre}><Spinner /></div>
          ) : (
            <>
              <div style={s.metaGrid}>
                <Meta label="Issued" value={fmtDate(detail.date)} />
                <Meta label="Due" value={fmtDate(detail.dueDate)} />
                {detail.poNumber && <Meta label="Your PO" value={detail.poNumber} />}
                {detail.paymentTerms && <Meta label="Terms" value={detail.paymentTerms} />}
              </div>

              <section style={s.billedTo}>
                <div style={s.sectionLabel}>Billed to</div>
                <div style={s.billedName}>{detail.clientName}</div>
                {detail.clientAddress && <div style={s.billedLine}>{detail.clientAddress}</div>}
                {detail.clientPhone && <div style={s.billedLine}>{detail.clientPhone}</div>}
                {detail.clientNTN && <div style={s.billedLine}>NTN {detail.clientNTN}</div>}
              </section>

              <div style={s.lineWrap}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <Th>Description</Th>
                      <Th align="right">Qty</Th>
                      <Th>Unit</Th>
                      <Th align="right">Rate</Th>
                      <Th align="right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((it, i) => (
                      <tr key={i} style={s.row}>
                        <td style={s.cell}>{it.description}</td>
                        <td style={s.num}>{it.quantity}</td>
                        <td style={s.cellMuted}>{it.uom}</td>
                        <td style={s.num}>{money(it.unitPrice)}</td>
                        <td style={{ ...s.num, ...s.numStrong }}>{money(it.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={s.totalsCard}>
                <Row label="Subtotal" value={money(detail.subtotal)} />
                <Row label={`Sales tax (${detail.gstRate}%)`} value={money(detail.gstAmount)} />
                {detail.withholdingTaxAmount > 0 && (
                  <Row label="Withholding tax" value={`− ${money(detail.withholdingTaxAmount)}`} />
                )}
                <div style={s.totalsRule} />
                <Row label="Invoice total" value={money(detail.total)} strong />
                <Row label="Paid to date" value={money(detail.paid)} />
                {detail.credit > 0
                  ? <Row label="Credit in your favour" value={money(detail.credit)} strong tone={T.info} />
                  : <Row label="Balance due" value={money(detail.balance)} strong
                         tone={detail.balance > 0 ? T.danger : T.accent} />}
              </div>

              {detail.amountInWords && <p style={s.words}>{detail.amountInWords}</p>}
            </>
          )}
        </div>

        {ready && (
          <footer style={s.modalFoot}>
            {!canPrint ? (
              <span style={s.footNote}>Printable copies aren’t available for this account.</span>
            ) : (
              <>
                <button type="button" style={s.btnGhost} disabled={!!busy[`${detail.invoiceNumber}-pdf`]}
                        onClick={() => onPdf(detail.invoiceNumber)}>
                  <MdPictureAsPdf size={16} />
                  {busy[`${detail.invoiceNumber}-pdf`] ? " Preparing…" : " Download PDF"}
                </button>
                <button type="button" style={s.btnPrimary} disabled={!!busy[`${detail.invoiceNumber}-print`]}
                        onClick={() => onPrint(detail.invoiceNumber)}>
                  <MdPrint size={16} /> Print
                </button>
              </>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

const Th = ({ children, align }) => (
  <th scope="col" style={{ ...s.th, textAlign: align || "left" }}>{children}</th>
);
const Meta = ({ label, value }) => (
  <div><div style={s.metaLabel}>{label}</div><div style={s.metaValue}>{value}</div></div>
);
const Row = ({ label, value, strong, tone }) => (
  <div style={s.totalRow}>
    <span style={strong ? s.totalLabelStrong : s.totalLabel}>{label}</span>
    <span style={{ ...(strong ? s.totalValueStrong : s.totalValue), ...(tone ? { color: tone } : null) }}>{value}</span>
  </div>
);
const Spinner = () => <div style={s.spinner} role="status" aria-label="Loading" />;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; background: ${T.bg}; }

@keyframes portal-spin { to { transform: rotate(360deg); } }
@keyframes portal-pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }

.portal-skel { animation: portal-pulse 1.4s ease-in-out infinite; }
.portal-row { transition: background-color 160ms ease; }
.portal-row:hover { background: ${T.primarySoft}; }

button { font: inherit; cursor: pointer;
  transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease, box-shadow 180ms ease; }
button:disabled { cursor: not-allowed; }
:focus-visible { outline: 2px solid ${T.secondary}; outline-offset: 2px; border-radius: 6px; }

/* Cards on phones and tablets, table from 900px up — below that a table either
   scrolls sideways or shrinks the figures past reading size. */
.portal-cards { display: none; }
@media (max-width: 899px) {
  .portal-table { display: none; }
  .portal-cards { display: grid; }
  .portal-filterrow { flex-wrap: wrap !important; margin-left: 0 !important; }
  .portal-filterrow > div:first-child { flex: 1 1 100%; }
  /* The no-wrap/no-shrink date pair is a desktop trick; on a phone it is wider
     than the screen. */
  .portal-dategroup { flex-wrap: wrap !important; flex-shrink: 1 !important;
                      flex: 1 1 100%; min-width: 0; }
  .portal-dategroup label { flex: 1 1 140px; min-width: 0; }
  .portal-date { min-width: 0; width: 100%; }
  .portal-pagerbar nav { justify-content: center; }
  .portal-pagerbar nav > span:last-child { display: none; }
}

/* Touch devices wide enough for the table (an iPad in landscape is 1024px) still
   need finger-sized targets; width alone can't tell a laptop from a tablet. */
@media (pointer: coarse) {
  .portal-action { min-width: 44px; min-height: 44px; }
  /* The desktop filter bar is deliberately compact; on a touch screen every one
     of those controls goes back to a 44px target. */
  /* !important because these carry a compact min-height inline, and an
     inline declaration beats a class selector on the same property. */
  .portal-chip, .portal-search, .portal-date, .portal-clear,
  .portal-pagesize, .portal-pagerbar button { min-height: 44px !important; }
  /* The invoice number is the main way to open an invoice on a phone, so it
     needs a thumb-sized hit area even though it reads as a text link. */
  .portal-link { display: inline-flex; align-items: center; min-height: 44px; padding-right: 8px; }
}

/* Desktop and landscape tablets: a fixed-height shell — masthead and footer
   stay put, only the invoice area scrolls. Below that the page stays in normal
   flow: pinning a 3-line footer on a phone would eat a fifth of the screen, and
   100dvh shells fight mobile browser chrome. The flex column above still keeps
   the footer at the bottom there when content is short. */
/* Below 620px of height there isn't enough room to pin five bands and still
   show invoices, so the shell is dropped and the page scrolls normally. */
@media (min-width: 900px) and (min-height: 620px) {
  html, body, #root { height: 100%; }
  .portal-page { height: 100dvh; }
  /* Masthead, figures, filters, pager and footer are all fixed bands. The only
     thing that moves is the grid — and the scroll lives on the card itself, so
     the scrollbar sits against the table instead of the window edge. */
  .portal-main { overflow: hidden; }
  .portal-static, .portal-pagerbar, .portal-footer { flex: 0 0 auto; }
}

/* Scrollbar styled to belong to the card. */
.portal-table { scrollbar-width: thin; scrollbar-color: ${T.border} transparent; }
.portal-table::-webkit-scrollbar { width: 10px; height: 10px; }
.portal-table::-webkit-scrollbar-track { background: transparent; }
.portal-table::-webkit-scrollbar-thumb {
  background: #CBD5E1; border-radius: 999px; border: 3px solid ${T.surface};
}
.portal-table::-webkit-scrollbar-thumb:hover { background: #94A3B8; }

/* Laptops are commonly 768px or 720px tall. At full spacing the pinned bands
   eat 635px of that and the grid is left with one row, so everything above and
   below the grid tightens up to hand the rows back their space. The inline
   styles are the base, hence !important. */
/* Netbook-class heights: squeeze the last few pixels out of the pinned bands
   so the grid still shows a useful number of rows. */
@media (min-width: 900px) and (max-height: 700px) {
  .portal-masthead { padding-top: 0.45rem !important; padding-bottom: 0.45rem !important; }
  .portal-band { padding-top: 0.5rem !important; }
  .portal-hero { padding-top: 0.45rem !important; padding-bottom: 0.45rem !important;
                 margin-bottom: 0.45rem !important; }
  .portal-controls { margin-bottom: 0.45rem !important; }
  .portal-inner { padding-bottom: 0.55rem !important; }
  .portal-footer { padding-top: 0.45rem !important; padding-bottom: 0.45rem !important; }
}

/* The hairline dividers only make sense while the figures sit on one line;
   once they wrap onto their own row the leading one would dangle. */
@media (max-width: 1100px) {
  .portal-hero > div:last-child > div:first-child { padding-left: 0; border-left: 0; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
`;

const s = {
  // Column layout so the footer is pushed to the bottom of the viewport when
  // there is little content, instead of floating just under a short table.
  // On wide screens the CSS below turns this into a fixed-height shell where
  // only the middle scrolls; see the media query for why phones differ.
  page: { minHeight: "100dvh", background: T.bg, color: T.fg,
    display: "flex", flexDirection: "column",
    fontFamily: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    fontSize: 15, lineHeight: 1.5 },

  masthead: { flex: "0 0 auto", background: T.surface, borderBottom: `1px solid ${T.border}` },
  mastheadInner: { maxWidth: 1180, margin: "0 auto", padding: "0.7rem 1.25rem",
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" },
  brand: { display: "flex", alignItems: "center", gap: "0.85rem", minWidth: 0 },
  logo: { height: 38, width: "auto", maxWidth: 170, objectFit: "contain" },
  logoFallback: { width: 38, height: 38, borderRadius: 10, background: T.primarySoft,
    display: "grid", placeItems: "center", flexShrink: 0 },
  companyName: { fontSize: "1.0625rem", fontWeight: 700, letterSpacing: "-0.01em", color: T.fg,
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  eyebrow: { fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.08em",
    textTransform: "uppercase", color: T.faint, marginTop: 1 },
  customerChip: { display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 0 },
  customerLabel: { fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.08em",
    textTransform: "uppercase", color: T.faint },
  customerName: { fontSize: "0.95rem", fontWeight: 600, color: T.primary,
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },

  staticBand: { flex: "0 0 auto" },
  bandInner: { maxWidth: 1180, margin: "0 auto", padding: "0.75rem 1.25rem 0" },
  // The one scrolling region. minHeight:0 is load-bearing — without it a flex
  // child refuses to shrink below its content and the whole page scrolls again.
  // minHeight:0 is load-bearing on both of these — without it a flex child
  // refuses to shrink below its content and the page scrolls instead of the card.
  main: { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" },
  mainInner: { maxWidth: 1180, width: "100%", margin: "0 auto", padding: "0 1.25rem 0.85rem",
    flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" },
  pagerBar: { flex: "0 0 auto", borderTop: `1px solid ${T.border}`, background: T.surface },

  hero: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
    boxShadow: T.shadow, padding: "0.6rem 1.15rem", marginBottom: "0.6rem",
    display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: "1.5rem", rowGap: "0.6rem" },
  heroPrimary: { display: "flex", flexDirection: "column", gap: "0.1rem", minWidth: 0 },
  heroLabel: { fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.07em",
    textTransform: "uppercase", color: T.muted },
  heroValue: { fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums", lineHeight: 1.15 },
  heroHint: { fontSize: "0.8rem", color: T.muted },
  heroFlag: { display: "inline-flex", alignItems: "center", gap: 6,
    padding: "0.3rem 0.7rem", borderRadius: 999,
    background: T.dangerSoft, color: T.danger, fontSize: "0.78rem", fontWeight: 600 },

  // Pushed to the right of the strip; each figure is a plain label/value pair
  // separated by a hairline rather than its own card.
  heroStats: { marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center",
    columnGap: "1.4rem", rowGap: "0.5rem" },
  stat: { display: "flex", flexDirection: "column", gap: "0.05rem", paddingLeft: "1.4rem",
    borderLeft: `1px solid ${T.border}` },
  statLabel: { fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.06em",
    textTransform: "uppercase", color: T.faint, whiteSpace: "nowrap" },
  statValue: { fontSize: "1rem", fontWeight: 700, color: T.fg, fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap" },

  controls: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
    boxShadow: T.shadow, padding: "0.45rem 0.9rem", marginBottom: "0.6rem",
    display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: "0.9rem", rowGap: "0.5rem" },
  chipRow: { display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center", minWidth: 0 },
  chip: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 34,
    padding: "0.3rem 0.65rem", borderRadius: 999, border: `1px solid ${T.border}`,
    background: T.surface, color: T.muted, fontSize: "0.82rem", fontWeight: 600 },
  chipActive: { background: T.primary, borderColor: T.primary, color: "#fff" },
  chipCount: { display: "inline-grid", placeItems: "center", minWidth: 20, height: 18,
    padding: "0 5px", borderRadius: 999, background: T.slateSoft, color: T.muted,
    fontSize: "0.7rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  chipCountActive: { background: "rgba(255,255,255,0.22)", color: "#fff" },

  filterRow: { display: "flex", gap: "0.6rem", flexWrap: "nowrap", alignItems: "center",
    marginLeft: "auto", minWidth: 0 },
  searchWrap: { position: "relative", flex: "0 1 210px", minWidth: 140 },
  searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.faint },
  search: { width: "100%", minHeight: 34, padding: "0.35rem 0.8rem 0.35rem 2.2rem",
    borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, color: T.fg, fontSize: "0.9rem" },
  // Never wraps: it is the search box that gives up width when the filter bar
  // is tight, otherwise the date pair folds and costs the grid a whole row.
  dateGroup: { display: "flex", gap: "0.5rem", flexWrap: "nowrap", alignItems: "center",
    flexShrink: 0 },
  // Label sits beside the field, not above it: stacked labels doubled the height
  // of the whole filter bar and pushed invoice rows off the screen.
  dateField: { display: "flex", alignItems: "center", gap: 6 },
  dateLabel: { fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em",
    textTransform: "uppercase", color: T.faint },
  date: { minHeight: 34, padding: "0.3rem 0.5rem", borderRadius: 9,
    border: `1px solid ${T.border}`, background: T.bg, color: T.fg, fontSize: "0.82rem" },
  clearFilters: { minHeight: 34, padding: "0.3rem 0.7rem", borderRadius: 9,
    border: `1px solid ${T.border}`, background: T.surface, color: T.muted,
    fontSize: "0.82rem", fontWeight: 600 },

  notice: { display: "flex", gap: "0.6rem", alignItems: "center", background: T.warnSoft,
    color: T.warn, border: "1px solid #FDE68A", borderRadius: 10,
    padding: "0.7rem 1rem", marginBottom: "1rem", fontSize: "0.875rem" },

  // The scroller. Sits inside the card's own border so the scrollbar rides the
  // grid rather than the far right edge of the window.
  tableCard: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
    boxShadow: T.shadow, overflow: "auto", flex: "1 1 auto", minHeight: 0 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 760 },
  th: { padding: "0.5rem 1rem", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.07em",
    textTransform: "uppercase", color: T.faint, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
    position: "sticky", top: 0, zIndex: 1, background: T.surface },
  row: { borderBottom: `1px solid ${T.border}` },
  cell: { padding: "0.45rem 1rem", fontSize: "0.9rem", color: T.fg },
  cellMuted: { padding: "0.45rem 1rem", fontSize: "0.875rem", color: T.muted, whiteSpace: "nowrap" },
  num: { padding: "0.45rem 1rem", fontSize: "0.9rem", color: T.fg, textAlign: "right",
    fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  numStrong: { fontWeight: 700 },
  invLink: { background: "none", border: "none", padding: 0, color: T.secondary,
    fontWeight: 700, fontSize: "0.9rem" },
  invLinkLg: { background: "none", border: "none", padding: 0, color: T.secondary,
    fontWeight: 700, fontSize: "1.05rem" },

  pill: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.25rem 0.65rem",
    borderRadius: 999, fontSize: "0.76rem", fontWeight: 600, whiteSpace: "nowrap" },
  dot: { width: 6, height: 6, borderRadius: "50%", flexShrink: 0 },

  action: { display: "inline-grid", placeItems: "center", width: 32, height: 32, marginLeft: 6,
    borderRadius: 9, border: `1px solid ${T.border}`, background: T.surface, color: T.muted },
  actionPrimary: { display: "inline-grid", placeItems: "center", width: 32, height: 32, marginLeft: 6,
    borderRadius: 9, border: `1px solid ${T.border}`, background: T.primarySoft, color: T.primary },
  actionWide: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44,
    padding: "0.55rem 0.9rem", borderRadius: 10, border: `1px solid ${T.border}`,
    background: T.surface, color: T.muted, fontSize: "0.85rem", fontWeight: 600 },
  actionWidePrimary: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44,
    padding: "0.55rem 0.9rem", borderRadius: 10, border: `1px solid ${T.primary}`,
    background: T.primary, color: "#fff", fontSize: "0.85rem", fontWeight: 600 },
  actionBusy: { opacity: 0.55 },

  cardList: { gap: "0.85rem" },
  card: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
    boxShadow: T.shadow, padding: "1rem" },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem" },
  cardDates: { marginTop: "0.3rem", fontSize: "0.8rem", color: T.muted },
  cardFigures: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem",
    margin: "0.85rem 0 0", padding: "0.75rem 0 0", borderTop: `1px solid ${T.border}` },
  figure: { margin: 0, minWidth: 0 },
  figureLabel: { fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.05em",
    textTransform: "uppercase", color: T.faint },
  figureValue: { margin: 0, fontSize: "0.9rem", color: T.fg, fontVariantNumeric: "tabular-nums" },
  figureStrong: { fontWeight: 700 },
  cardActions: { marginTop: "0.85rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" },

  pager: { maxWidth: 1180, margin: "0 auto", display: "flex", justifyContent: "space-between",
    alignItems: "center", gap: "1rem", padding: "0.45rem 1.25rem", flexWrap: "wrap" },
  pagerGroup: { display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap",
    justifyContent: "center" },
  pagerBalance: { width: 92 },
  pageSizeWrap: { display: "flex", alignItems: "center", gap: 6 },
  pageSizeLabel: { fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em",
    textTransform: "uppercase", color: T.faint },
  pageSize: { minHeight: 34, padding: "0.3rem 0.5rem", borderRadius: 9,
    border: `1px solid ${T.border}`, background: T.surface, color: T.fg,
    fontSize: "0.82rem", fontWeight: 600 },
  pageBtn: { minHeight: 34, padding: "0.35rem 0.9rem", borderRadius: 9,
    border: `1px solid ${T.border}`, background: T.surface, color: T.primary,
    fontSize: "0.875rem", fontWeight: 600 },
  pageInfo: { fontSize: "0.85rem", color: T.muted, fontVariantNumeric: "tabular-nums" },

  skelRow: { display: "flex", alignItems: "center", gap: "1rem", padding: "1rem",
    borderBottom: `1px solid ${T.border}` },
  skel: { display: "block", height: 12, borderRadius: 6, background: T.slateSoft },

  empty: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
    boxShadow: T.shadow, padding: "3.5rem 1.5rem", textAlign: "center" },
  emptyIcon: { width: 56, height: 56, borderRadius: "50%", background: T.slateSoft,
    display: "grid", placeItems: "center", margin: "0 auto 0.9rem" },
  emptyTitle: { margin: "0 0 0.35rem", fontSize: "1.05rem", fontWeight: 700, color: T.fg },
  centre: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: "0.8rem", padding: "4rem 1.5rem", textAlign: "center" },
  centreText: { margin: 0, color: T.muted, fontSize: "0.9rem", maxWidth: 420 },
  spinner: { width: 30, height: 30, border: `3px solid ${T.border}`, borderTopColor: T.primary,
    borderRadius: "50%", animation: "portal-spin .8s linear infinite" },

  footer: { flex: "0 0 auto", background: T.surface, borderTop: `1px solid ${T.border}`,
    padding: "0.6rem 1.25rem", textAlign: "center", fontSize: "0.78rem",
    color: T.muted, lineHeight: 1.4 },
  footerName: { fontWeight: 600, color: T.fg },
  footerMeta: { display: "flex", gap: "0.9rem", justifyContent: "center", flexWrap: "wrap", marginTop: 1 },

  backdrop: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 60 },
  modal: { background: T.surface, borderRadius: 14, width: "100%", maxWidth: 840,
    maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
    boxShadow: T.shadowLift },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    padding: "1.1rem 1.35rem", borderBottom: `1px solid ${T.border}` },
  modalEyebrow: { fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase", color: T.faint },
  modalTitle: { margin: 0, fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-0.01em" },
  close: { display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 10,
    border: "none", background: "transparent", color: T.muted },
  modalBody: { padding: "1.35rem", overflowY: "auto" },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: "0.6rem", alignItems: "center",
    padding: "0.9rem 1.35rem", borderTop: `1px solid ${T.border}`, background: T.bg, flexWrap: "wrap" },
  footNote: { fontSize: "0.85rem", color: T.muted },

  metaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px,100%), 1fr))",
    gap: "0.9rem", marginBottom: "1.25rem" },
  metaLabel: { fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em",
    textTransform: "uppercase", color: T.faint, marginBottom: 3 },
  metaValue: { fontSize: "0.9rem", fontWeight: 600, color: T.fg },

  billedTo: { background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10,
    padding: "0.9rem 1rem", marginBottom: "1.25rem" },
  sectionLabel: { fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em",
    textTransform: "uppercase", color: T.faint, marginBottom: 4 },
  billedName: { fontWeight: 700, color: T.fg },
  billedLine: { fontSize: "0.86rem", color: T.muted },

  lineWrap: { border: `1px solid ${T.border}`, borderRadius: 10, overflowX: "auto" },

  totalsCard: { marginTop: "1.25rem", marginLeft: "auto", maxWidth: 360, background: T.bg,
    border: `1px solid ${T.border}`, borderRadius: 10, padding: "0.9rem 1rem",
    display: "flex", flexDirection: "column", gap: "0.35rem" },
  totalsRule: { height: 1, background: T.border, margin: "0.25rem 0" },
  totalRow: { display: "flex", justifyContent: "space-between", gap: "1rem" },
  totalLabel: { fontSize: "0.86rem", color: T.muted },
  totalValue: { fontSize: "0.86rem", fontVariantNumeric: "tabular-nums" },
  totalLabelStrong: { fontSize: "0.9rem", fontWeight: 700, color: T.fg },
  totalValueStrong: { fontSize: "1rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  words: { marginTop: "1rem", fontSize: "0.8rem", color: T.muted, fontStyle: "italic" },

  btnGhost: { display: "inline-flex", alignItems: "center", gap: 7, minHeight: 44,
    padding: "0.6rem 1.05rem", borderRadius: 10, border: `1px solid ${T.border}`,
    background: T.surface, color: T.fg, fontSize: "0.88rem", fontWeight: 600 },
  btnPrimary: { display: "inline-flex", alignItems: "center", gap: 7, minHeight: 44,
    padding: "0.6rem 1.05rem", borderRadius: 10, border: `1px solid ${T.primary}`,
    background: T.primary, color: "#fff", fontSize: "0.88rem", fontWeight: 600 },

  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
    overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 },
};
