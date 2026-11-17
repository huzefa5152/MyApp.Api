import ListFilters from "../Components/ListFilters";
import RecordsViewport from "../Components/RecordsViewport";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MdBusiness, MdDownload, MdFactCheck, MdRefresh } from "react-icons/md";
import { CompanyPicker, Dot, PrintPdfButtons, ReportBar } from "../Components/reports/ReportChrome";
import { fileSlug, pdfReport, printReport } from "../utils/reportPrintKit";
import { getReadyForFbr, getReadyForFbrExcel } from "../api/reportApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { colors, dropdownStyles } from "../theme";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import Pagination from "../Components/Pagination";
import useIsNarrow from "../hooks/useIsNarrow";
import {
  ISD_PERIOD_OPTIONS,
  fmtDay,
  fmtQty,
  pageOfBills,
  toApiParams,
} from "../utils/invoiceSalesDetail";
import "../Components/reports/InvoiceSalesDetailGrid.css";

// Reports > Ready for FBR: bills the consultant has classified that are not yet sent, each shown as
// the original bill beside what will be filed (HS code, item, filing quantity, FBR unit, value, tax).
// The server picks the bills and builds the rows; this screen only draws them.

const defaults = (companyId) => ({
  companyId,
  period: "thisMonth",
  search: "",
  clientId: "",
  from: "",
  to: "",
});
const money = (n) =>
  Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// # | description | qty | rate | excl || HS | filed item | filed qty | FBR unit | filed excl | tax
// Money and codes never wrap, so their columns are sized for the longest amount (1,234,567.89);
// description and filed item share what is left and wrap.
const COLUMN_WIDTHS = [32, null, 84, 108, 108, 84, null, 72, 96, 108, 96];
// The table needs its fixed columns plus room for the two text columns; narrower than that, each
// filed row is shown as a card. Measured on the list itself, so the sidebar cannot push it over.
const TABLE_MIN_WIDTH = COLUMN_WIDTHS.reduce((s, w) => s + (w || 116), 0) + 40;
const tone = (s) => (s === "Failed" ? "bad" : s === "Validated" ? "ok" : "info");

export default function ReadyForFbrPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has, loading: permissionsLoading } = usePermissions();
  const canView = has("reports.readyforfbr.view"),
    canExport = has("reports.readyforfbr.export");
  const companyId = selectedCompany?.id;
  const [stored, setStored] = useState(() => defaults(companyId));
  const filters = useMemo(
    () => (stored.companyId === companyId ? stored : defaults(companyId)),
    [stored, companyId],
  );
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20);
  const change = (key, value) => {
    setStored({ ...filters, [key]: value });
    setPage(1);
  };
  const params = useMemo(() => toApiParams(filters), [filters]);
  const key = JSON.stringify([companyId, params]);
  const latestKey = useRef(key);
  latestKey.current = key;
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false),
    [exporting, setExporting] = useState(false),
    [printing, setPrinting] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const narrow = useIsNarrow(760);
  const invalid =
    filters.period === "custom" && (!filters.from || !filters.to || filters.from > filters.to);
  const report = answer?.key === key && canView && !invalid ? answer.data : null;
  // The list's own width (a callback ref, so the observer follows the element as it mounts).
  const [listEl, setListEl] = useState(null);
  const [listWidth, setListWidth] = useState(Infinity);
  // Measured when the list mounts and on every window resize; the observer also catches the
  // sidebar opening or closing, which changes the list's width without resizing the window.
  useLayoutEffect(() => {
    if (!listEl) return;
    const measure = () => setListWidth(listEl.getBoundingClientRect().width);
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(listEl);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [listEl]);
  const cards = narrow || listWidth < TABLE_MIN_WIDTH;

  useEffect(() => {
    if (!companyId || !canView || invalid) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    setError("");
    getReadyForFbr(companyId, params, { signal: controller.signal })
      .then(({ data }) => live && setAnswer({ key, data }))
      .catch((e) => {
        if (!live) return;
        setAnswer(null);
        setError(e.response?.data?.message || "Could not load the Ready for FBR report.");
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
      controller.abort();
    };
  }, [companyId, canView, invalid, key, params, revision]);

  const bills = report?.bills || [];
  const view = useMemo(() => pageOfBills(bills, page, pageSize), [bills, page, pageSize]);
  const buyerOptions =
    answer && answer.data.companyId === companyId ? answer.data.buyers || [] : [];

  async function exportExcel() {
    if (!report || loading || exporting || !canExport) return;
    const exportKey = key;
    setExporting(true);
    try {
      const { data } = await getReadyForFbrExcel(companyId, params);
      if (latestKey.current !== exportKey) return;
      const url = URL.createObjectURL(data),
        link = document.createElement("a");
      link.href = url;
      link.download = `${fileSlug(`Ready-for-FBR-${report.companyName}-${report.periodLabel}`)}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (latestKey.current === exportKey) setError("Could not export the Ready for FBR report.");
    } finally {
      setExporting(false);
    }
  }
  // Print / PDF: every bill in the selection, one row per filed row with the bill lines it files.
  const envelope = () => ({
    title: "Ready for FBR",
    companyName: report.companyName,
    periodLabel: report.periodLabel,
    generatedAt: new Date().toISOString(),
    filtersApplied: [
      filters.search && `Search: "${filters.search}"`,
      filters.clientId &&
        buyerOptions.find((b) => String(b.clientId) === String(filters.clientId))?.name,
    ].filter(Boolean),
    sourceLabel: `${report.billCount} bills · ${report.originalLineCount} bill lines · ${report.filingRowCount} filed rows`,
    columns: [
      { key: "bill", label: "Bill #" },
      { key: "date", label: "Date" },
      { key: "buyer", label: "Client" },
      { key: "original", label: "Original lines" },
      { key: "hs", label: "HS code" },
      { key: "item", label: "Filed item" },
      { key: "qty", label: "Filed qty" },
      { key: "excl", label: "Filed excl", format: "money", totalled: true },
      { key: "tax", label: "Sales tax", format: "money", totalled: true },
    ],
    rows: bills.flatMap((b) =>
      b.filingRows.map((r) => ({
        bill: b.invoiceNumber,
        date: fmtDay(b.date),
        buyer: b.buyer,
        original: b.originalLines
          .filter((l) => l.filingRow === r.rowNumber)
          .map((l) => `${l.description} (${fmtQty(l.quantity)} ${l.unit})`)
          .join("; "),
        hs: r.hsCode,
        item: r.item,
        qty: `${fmtQty(r.quantity)} ${r.unit}`,
        excl: r.excludingTax,
        tax: r.salesTax,
      })),
    ),
    totals: {
      excl: bills.reduce((t, b) => t + b.filingRows.reduce((s, r) => s + r.excludingTax, 0), 0),
      tax: report.salesTax,
    },
  });
  async function run(kind) {
    setPrinting(kind);
    try {
      if (kind === "print") await printReport(envelope(), selectedCompany);
      else
        await pdfReport(
          envelope(),
          selectedCompany,
          fileSlug(`Ready-for-FBR-${report.periodLabel}`),
        );
    } catch {
      setError(
        kind === "print"
          ? "Could not prepare the print. Allow print pop-ups and try again."
          : "Could not build the PDF.",
      );
    } finally {
      setPrinting("");
    }
  }

  if (permissionsLoading) return <p role="status">Loading permissions…</p>;
  if (!canView) return <p>You don’t have permission to view this report.</p>;
  return (
    <div className="rw" style={{ minWidth: 0 }}>
      <ReportBar
        icon={<MdFactCheck size={20} />}
        crumb="Reports"
        title="Ready for FBR"
        meta={
          <>
            Classified bills not yet sent: the original bill beside what will be filed
            <Dot>filters update automatically</Dot>
          </>
        }
        actions={
          <>
            <CompanyPicker
              icon={<MdBusiness size={18} />}
              companies={companies}
              selectedCompany={selectedCompany}
              onChange={setSelectedCompany}
            />
            <button
              type="button"
              className="rw-btn"
              disabled={!companyId || loading || invalid}
              onClick={() => setRevision((n) => n + 1)}
            >
              <MdRefresh size={17} />
              Refresh
            </button>
            {canExport && (
              <button
                type="button"
                className="rw-btn"
                disabled={!report || loading || exporting}
                onClick={exportExcel}
              >
                <MdDownload size={17} />
                {exporting ? "Exporting…" : "Excel"}
              </button>
            )}
            <PrintPdfButtons
              onPrint={() => run("print")}
              onPdf={() => run("pdf")}
              busy={printing}
              disabled={!report || loading || !bills.length}
            />
          </>
        }
      />
      <ListFilters>
        <div className="rw-filters" style={styles.filters}>
          <Field label="Period">
            <select
              aria-label="Period"
              style={styles.input}
              value={filters.period}
              onChange={(e) => change("period", e.target.value)}
            >
              {ISD_PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {filters.period === "custom" && (
            <>
              <Field label="From">
                <input
                  aria-label="From"
                  type="date"
                  style={styles.input}
                  value={filters.from}
                  onChange={(e) => change("from", e.target.value)}
                />
              </Field>
              <Field label="To">
                <input
                  aria-label="To"
                  type="date"
                  style={styles.input}
                  value={filters.to}
                  onChange={(e) => change("to", e.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="Client">
            <SearchableClientSelect
              clients={buyerOptions.map((b) => ({ id: b.clientId, name: b.name, ntn: b.ntn }))}
              value={filters.clientId}
              onChange={(id) => change("clientId", id)}
              placeholder="All clients"
              style={{ width: "100%", minHeight: 38, maxWidth: "100%" }}
            />
          </Field>
          <Field label="Search">
            <input
              aria-label="Search bills"
              type="search"
              maxLength={100}
              placeholder="Bill, party, NTN, HS code, item…"
              style={styles.input}
              value={filters.search}
              onChange={(e) => change("search", e.target.value)}
            />
          </Field>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              className="rw-btn"
              onClick={() => {
                setStored(defaults(companyId));
                setPage(1);
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
      </ListFilters>
      {!companyId && <div className="rw-state">Select a company to view this report.</div>}
      {invalid && (
        <div className="rw-notice rw-notice--warn" role="alert">
          Choose both dates, with the start on or before the end date.
        </div>
      )}
      {error && !invalid && (
        <div className="rw-notice rw-notice--warn" role="alert">
          {error}
        </div>
      )}
      {report && (
        <div className="rw-kpis">
          <Kpi label="Bills" value={report.billCount} />
          <Kpi label="Bill lines" value={report.originalLineCount} />
          <Kpi label="Filed rows" value={report.filingRowCount} />
          <Kpi label="Excl" value={`Rs ${money(report.excludingTax)}`} />
          <Kpi label="G. S. T" value={`Rs ${money(report.salesTax)}`} />
          {!!report.furtherTax && (
            <Kpi label="Further tax" value={`Rs ${money(report.furtherTax)}`} />
          )}
          <Kpi label="Total incl taxes" value={`Rs ${money(report.total)}`} lead />
        </div>
      )}
      <RecordsViewport label="Ready for FBR records" enabled={!narrow}>
        <div aria-busy={loading}>
          {loading && (
            <div className="rw-state" role="status">
              Loading report…
            </div>
          )}
          {report && (
            <>
              <h2 className="rw-period">
                {report.companyName} · {report.periodLabel}
              </h2>
              <details className="isd-notes">
                <summary>About these figures</summary>
                <p>
                  Lists FBR bills whose every line the tax consultant has classified and that are
                  not yet submitted; bills excluded from FBR, cancelled or outside FBR are left out.
                  Each bill shows its original lines beside the row each one will be filed under. A
                  filed row can combine several bill lines and use a different quantity and FBR
                  unit. Nothing here is sent to FBR.
                </p>
              </details>
              {!bills.length && (
                <div className="isd-empty" role="status">
                  No classified bills waiting for FBR in this period
                  {filters.clientId || filters.search ? " for these filters" : ""}.
                </div>
              )}
              <div ref={setListEl} style={{ display: "grid", gap: 12, minWidth: 0 }}>
                {view.bills.map((b) => (
                  <BillComparison key={b.invoiceId} bill={b} narrow={cards} />
                ))}
              </div>
              {bills.length > 0 && (
                <Pagination
                  page={view.page}
                  totalPages={view.totalPages}
                  total={bills.length}
                  unit="bills"
                  onPage={setPage}
                  pageSize={pageSize}
                  onPageSize={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                />
              )}
            </>
          )}
        </div>
      </RecordsViewport>
    </div>
  );
}

/** One bill: header, then each filed row with the original lines it files. */
function BillComparison({ bill, narrow }) {
  const groups = bill.filingRows.map((r) => ({
    row: r,
    lines: bill.originalLines.filter((l) => l.filingRow === r.rowNumber),
  }));
  const filedExcl = bill.filingRows.reduce((s, r) => s + r.excludingTax, 0);
  return (
    <article
      className="isd-bill-card"
      style={styles.billCard}
      aria-label={`Bill ${bill.invoiceNumber}`}
    >
      <div style={styles.billHead}>
        <div className="isd-cell-stack" style={styles.billWho}>
          <strong className="isd-reference">
            Bill #{bill.invoiceNumber} · {fmtDay(bill.date)}
          </strong>
          <span style={styles.clamp}>{bill.buyer}</span>
          {bill.buyerNtn && <span className="isd-muted">NTN {bill.buyerNtn}</span>}
        </div>
        <div className="isd-status-stack">
          <span className={`isd-status isd-status--${tone(bill.fbrStatus)}`}>{bill.fbrStatus}</span>
          {bill.fbrMessage && <span className="isd-muted">{bill.fbrMessage}</span>}
        </div>
        <div style={styles.billMoney}>
          <Money label="Excl" value={bill.excludingTax} />
          <Money label={`GST ${bill.taxRate}%`} value={bill.salesTax} />
          {!!bill.furtherTax && <Money label="Further tax" value={bill.furtherTax} />}
          <Money label="Total" value={bill.total} strong />
        </div>
      </div>
      {narrow ? (
        <ol style={styles.cards}>
          {groups.map(({ row, lines }) => (
            <li key={row.rowNumber} style={styles.card}>
              <div style={styles.filed}>
                <span style={styles.side}>Filed row {row.rowNumber}</span>
                <strong>
                  HS <span className="rw-code">{row.hsCode}</span> · {row.item}
                </strong>
                <span>
                  {fmtQty(row.quantity)} {row.unit} · Rs {money(row.excludingTax)} · tax Rs{" "}
                  {money(row.salesTax)}
                </span>
                {row.saleType && <span className="isd-muted">{row.saleType}</span>}
              </div>
              <span style={styles.side}>From the bill</span>
              {lines.map((l) => (
                <div key={l.lineNumber} style={styles.origLine}>
                  <span>
                    {l.lineNumber}. {l.description}
                  </span>
                  <span className="isd-muted">
                    {fmtQty(l.quantity)} {l.unit} × {money(l.rate)} = Rs {money(l.excludingTax)}
                  </span>
                </div>
              ))}
            </li>
          ))}
        </ol>
      ) : (
        <div className="rw-table-wrap">
          <table className="rw-table" style={styles.table}>
            {/* Fixed widths so every bill's columns line up down the page. */}
            <colgroup>
              {COLUMN_WIDTHS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th colSpan={5} style={styles.bandOrig}>
                  Original bill
                </th>
                <th colSpan={6} style={styles.bandFiled}>
                  Filed with FBR
                </th>
              </tr>
              <tr>
                <th>#</th>
                <th>Description</th>
                <th className="rw-num">Qty</th>
                <th className="rw-num">Rate</th>
                <th className="rw-num">Excl</th>
                <th>HS code</th>
                <th>Filed item</th>
                <th className="rw-num">Filed qty</th>
                <th>FBR unit</th>
                <th className="rw-num">Filed excl</th>
                <th className="rw-num">Sales tax</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ row, lines }) => (
                <Fragment key={row.rowNumber}>
                  {lines.map((l, i) => (
                    <tr key={l.lineNumber}>
                      <td>{l.lineNumber}</td>
                      <td style={styles.desc}>{l.description}</td>
                      <td className="rw-num">
                        {fmtQty(l.quantity)} {l.unit}
                      </td>
                      <td className="rw-num">{money(l.rate)}</td>
                      <td className="rw-num">{money(l.excludingTax)}</td>
                      {i === 0 && (
                        <>
                          <td rowSpan={lines.length} style={styles.filedCell}>
                            <span className="rw-code">{row.hsCode}</span>
                          </td>
                          <td
                            rowSpan={lines.length}
                            style={{ ...styles.filedCell, ...styles.desc }}
                          >
                            {row.item}
                            {row.saleType && <div className="isd-muted">{row.saleType}</div>}
                          </td>
                          <td rowSpan={lines.length} className="rw-num" style={styles.filedCell}>
                            {fmtQty(row.quantity)}
                          </td>
                          <td rowSpan={lines.length} style={styles.filedCell}>
                            {row.unit}
                          </td>
                          <td rowSpan={lines.length} className="rw-num" style={styles.filedCell}>
                            {money(row.excludingTax)}
                          </td>
                          <td rowSpan={lines.length} className="rw-num" style={styles.filedCell}>
                            {money(row.salesTax)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="rw-stmt--subtotal">
                <td colSpan={4} className="rw-strong">
                  Bill total
                </td>
                <td className="rw-num rw-strong">{money(bill.excludingTax)}</td>
                <td colSpan={4} />
                <td className="rw-num rw-strong">{money(filedExcl)}</td>
                <td className="rw-num rw-strong">{money(bill.salesTax)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function Kpi({ label, value, lead }) {
  return (
    <div className={`rw-kpi${lead ? " rw-kpi--lead" : ""}`}>
      <span className="rw-kpi__label">{label}</span>
      <span className="rw-kpi__value">{value}</span>
    </div>
  );
}
function Money({ label, value, strong }) {
  return (
    <div className="isd-cell-stack" style={{ textAlign: "right" }}>
      <span className="isd-muted">{label}</span>
      {strong ? <strong>{money(value)}</strong> : <span>{money(value)}</span>}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label style={styles.field}>
      {label}
      {children}
    </label>
  );
}
const styles = {
  filters: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(min(190px,100%),1fr))",
    gap: "8px 10px",
    background: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`,
  },
  input: {
    ...dropdownStyles.base,
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
    minHeight: 38,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
    color: colors.textSecondary,
    fontSize: "0.64rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  billCard: { padding: "14px 16px 12px" },
  billHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: "8px 16px",
    marginBottom: 12,
  },
  billWho: { flex: "1 1 220px", minWidth: 0 },
  billMoney: { display: "flex", gap: 18, marginLeft: "auto", flexWrap: "wrap" },
  table: { width: "100%", minWidth: 0, tableLayout: "fixed" },
  clamp: {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  desc: { whiteSpace: "normal", overflowWrap: "anywhere" },
  bandOrig: { textAlign: "center", background: "#edf4ff" },
  bandFiled: { textAlign: "center", background: "#e1f3ef" },
  filedCell: { background: "#f3faf8", verticalAlign: "top" },
  cards: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 },
  card: {
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 8,
    padding: 10,
    display: "grid",
    gap: 6,
  },
  filed: {
    display: "grid",
    gap: 2,
    padding: 8,
    borderRadius: 6,
    background: "#f3faf8",
  },
  side: {
    fontSize: "0.64rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: colors.textSecondary,
  },
  origLine: {
    display: "grid",
    gap: 2,
    paddingLeft: 6,
    borderLeft: `3px solid ${colors.cardBorder}`,
  },
};
