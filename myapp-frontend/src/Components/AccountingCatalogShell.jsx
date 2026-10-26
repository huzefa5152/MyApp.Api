import RecordsViewport from "./RecordsViewport";
import { useMemo, useState } from "react";
import {
  MdArrowBack, MdCheckCircle, MdChevronRight, MdInfoOutline, MdOpenInNew,
  MdPictureAsPdf, MdPrint, MdTableChart, MdWarning,
} from "react-icons/md";
import { colors } from "../theme";
import useIsNarrow from "../hooks/useIsNarrow";
import Pagination from "./Pagination";
// Static, not dynamic: both already sit in the main bundle (every document page
// imports them), so a dynamic import here only produced a chunking warning
// without splitting anything. exportUtils lazy-loads html2canvas/jsPDF itself,
// which is where the real saving is.
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";
import { useCompany } from "../contexts/CompanyContext";
import { getAccountingReportInvoiceLayout } from "../api/printTemplateApi";
import { buildCustomerLedgerHtml, selectLedgerInvoiceTemplate } from "../utils/customerLedgerPrint";
import { brandAccountingReport } from "../utils/accountingReportPrint";
import "./AccountingCatalogShell.css";
import "./reports/ReportWorkspace.css";
import ColumnPicker, { useHiddenColumns } from "./reports/ColumnPicker";
import { excelBrandParams } from "../utils/reportExcelBrand";

/**
 * The one renderer every accounting report uses.
 *
 * Columns, totals and their labels all travel inside the report envelope, so
 * this component never knows which report it is showing. That is what keeps a
 * hundred reports looking like one product — and it means a new report is
 * backend work only.
 *
 * Information order is deliberate, top to bottom:
 *   1. What am I looking at        — title, period, provenance
 *   2. What is the answer          — the totals, before any detail
 *   3. What is it made of          — the rows
 *   4. How does it break down      — grouped summaries
 * A business owner asking "how much did we spend?" gets the number without
 * scrolling; the transactions are there when they want to know why.
 */
export default function AccountingCatalogShell({
  report,
  loading,
  error,
  onBack,
  onPage,
  onPageSize,
  pageSize,
  onExportExcel,
  canExport = false,
  onDrill,          // (filterKey, value, targetReportId) => void
  onOpenRow,        // (row) => void — jump to the source document
  onOpenAccount,    // (accountId) => void — statement line -> that account's ledger
  categoryTitle,
  printReportId,
  printCompanyId,
  loadPrintReport,
  headerExtra,      // e.g. the company picker, rendered beside the actions
  toolbar,          // the filter bar, rendered under the identity bar
}) {
  const { selectedCompany } = useCompany();
  const narrow = useIsNarrow(820);
  const [busy, setBusy] = useState(null);
  const [printError, setPrintError] = useState("");
  const customerLedger = printReportId === "customer-ledger";
  const printable = !!report && !loading && !error;
  const printHtml = async () => {
    const company = { ...selectedCompany };
    if (Number(company.id) !== Number(printCompanyId)) throw new Error("Report company changed");
    const [{ data: invoiceLayout }, ledger] = await Promise.all([
      getAccountingReportInvoiceLayout(company.id), loadPrintReport ? loadPrintReport() : report,
    ]);
    const template = selectLedgerInvoiceTemplate(invoiceLayout ? [invoiceLayout] : [], company.id);
    // Print and PDF carry the same columns the screen shows.
    const shaped = ledger?.statement ? ledger : { ...ledger, columns };
    return customerLedger ? buildCustomerLedgerHtml(shaped, company, template)
      : brandAccountingReport(buildReportHtml(shaped), company, template);
  };

  const allColumns = report?.columns || [];
  // The user's own column choice, per report. Statements keep their fixed shape.
  const [hiddenCols, setHiddenCols] = useHiddenColumns(printReportId || report?.title || "report");
  const columns = useMemo(() => {
    const shown = allColumns.filter((c) => !hiddenCols.has(String(c.key)));
    return shown.length ? shown : allColumns;
  }, [allColumns, hiddenCols]);
  const rows = report?.rows || [];
  const totals = report?.totals || {};
  const totalLabels = report?.totalLabels || {};

  // Lead / amount / meta split for the mobile card layout: the first text column
  // identifies the row, the last totalled money column is the figure that
  // matters, everything else is supporting detail.
  const leadCol = useMemo(
    () => columns.find((c) => c.format === "text") || columns[0],
    [columns]
  );
  const amountCol = useMemo(
    () => (customerLedger ? columns.find((c) => c.key === "balance") : null)
      || [...columns].reverse().find((c) => c.totalled) || null,
    [columns, customerLedger]
  );

  // A report whose rows each stand for something with its own ledger (a
  // customer) names the filter; a row carrying a drillKey then opens it.
  const drillRow = report?.rowDrillFilter && typeof onDrill === "function"
    ? (row) => onDrill(report.rowDrillFilter, row.drillKey)
    : null;

  const totalPages = report?.pageSize
    ? Math.max(1, Math.ceil((report.totalCount || 0) / report.pageSize))
    : 1;

  const doPrint = async () => {
    setBusy("print");
    setPrintError("");
    const w = window.open("", "_blank");
    try {
      if (!w) throw new Error("Popup blocked");
      writeAndPrint(w, await printHtml());
    } catch {
      w?.close();
      setPrintError("Could not prepare the report. Check template access and allow print popups, then try again.");
    } finally { setBusy(null); }
  };

  const doPdf = async () => {
    setBusy("pdf");
    setPrintError("");
    try {
      await exportToPdf(await printHtml(), slug(report.title), customerLedger
        ? { marginMm: 12, repeatTableHeader: ".ledger-table" }
        : { marginMm: 12, repeatTableHeader: ".accounting-table", orientation: report.statement ? "portrait" : "landscape" });
    } catch {
      setPrintError("Could not build the PDF. Check template access and try again.");
    } finally { setBusy(null); }
  };

  const hasTotals = Object.keys(totals).length > 0;
  // The headline figure: a "total…" if the report has one, else its first amount.
  const totalKeys = Object.keys(totals).filter((k) => !isCount(k) && !isPercentKey(k));
  const leadTotal = totalKeys.find((k) => /^total|total$/i.test(k)) || totalKeys[0];
  const showBook = !customerLedger && report?.openingBalance !== undefined
    && (report?.accountName !== undefined || report?.partyType);

  return (
    <div className={`rw report-shell${customerLedger ? " customer-ledger" : ""}`} aria-busy={loading}>
      {/* ── 1. Identity + actions, one compact bar ─────────────────────────── */}
      <header className="rw-head report-heading">
        <div className="rw-head__id">
          {onBack && (
            <button type="button" className="rw-back" onClick={onBack} title="All reports" aria-label="All reports">
              <MdArrowBack size={18} />
            </button>
          )}
          <div className="rw-head__text">
            {categoryTitle && <span className="rw-crumb">{categoryTitle}</span>}
            <h2 className="rw-title">{report?.title || "Report"}</h2>
            <div className="rw-meta">
              {report?.companyName && <strong>{report.companyName}</strong>}
              {report?.periodLabel && <Dot>{report.periodLabel}</Dot>}
              {report?.generatedAt && <Dot>Generated {fmtDateTime(report.generatedAt)}</Dot>}
              {(report?.filtersApplied || []).length > 0 && (
                <Dot><span className="rw-meta__filters">{report.filtersApplied.join("  ·  ")}</span></Dot>
              )}
            </div>
          </div>
        </div>

        <div className="rw-head__actions">
          {headerExtra}
          {report && !report.statement && (
            <ColumnPicker columns={allColumns} hidden={hiddenCols} onChange={setHiddenCols} />
          )}
          {canExport && (
            <button
              type="button"
              className="rw-btn"
              onClick={async () => {
                setBusy("excel");
                try {
                  // The workbook carries the company's letterhead and the columns on screen.
                  const brand = await excelBrandParams({ ...selectedCompany });
                  const chosen = columns.length < allColumns.length ? { columns: columns.map((c) => c.key).join(",") } : {};
                  await onExportExcel?.({ ...brand, ...chosen });
                } finally { setBusy(null); }
              }}
              disabled={!!busy || !printable}
              title="Download as Excel"
            >
              <MdTableChart size={17} />
              <span>{busy === "excel" ? "Preparing…" : "Excel"}</span>
            </button>
          )}
          <button type="button" className="rw-btn" onClick={doPrint} disabled={!!busy || !printable} title="Print this report">
            <MdPrint size={17} />
            <span>Print</span>
          </button>
          <button type="button" className="rw-btn rw-btn--primary" onClick={doPdf} disabled={!!busy || !printable} title="Save as PDF">
            <MdPictureAsPdf size={17} />
            <span>{busy === "pdf" ? "Building…" : "PDF"}</span>
          </button>
        </div>
      </header>

      {toolbar}

      {printError && <Notice tone="warn">{printError}</Notice>}

      {/* Provenance and truncation warnings, stated rather than implied.
          The generic banner is a FALLBACK only. A report that knows why it is not
          ledger-sourced sends its own notice — "the ledger was imported and its
          entries are not attributed to individual customers" — and showing both
          put a wrong sentence ("GL posting switched off") above a right one. */}
      {report && report.ledgerSourced === false && !report.notice && (
        <Notice tone="warn">
          These figures come from the documents rather than the general ledger, so
          they cannot include journal entries that moved the balance.
        </Notice>
      )}
      {report?.notice && (
        <Notice tone={report.ledgerSourced === false ? "warn" : "info"}>
          {report.notice}
        </Notice>
      )}

      {/* A balance sheet that does not balance has to say so where it cannot be
          missed, and one that does should reassure at a glance. */}
      {report?.statement === "BalanceSheet" && report.difference !== undefined && (
        <div className={report.isBalanced ? "rw-chip-ok" : "rw-chip-bad"}>
          {report.isBalanced
            ? <><MdCheckCircle size={16} /> Assets = Liabilities + Equity</>
            : <><MdWarning size={16} /> Out of balance by {fmtMoney(report.difference)}</>}
        </div>
      )}

      {/* ── 2. The answer: every figure in one band, above the detail ──────── */}
      {report && customerLedger && (
        <div className="rw-kpis ledger-overview">
          {[["Opening balance", report.openingBalance], ["Invoiced / debits", report.totalDebit],
            ["Received / credits", report.totalCredit], ["Closing balance", report.closingBalance]].map(([label, value], i) => (
            <div key={label} className={`rw-kpi${i === 3 ? " rw-kpi--lead" : ""}`}>
              <span className="rw-kpi__label">{label}</span>
              <span className="rw-kpi__value">{fmtMoney(value)}</span>
            </div>
          ))}
        </div>
      )}
      {report && !customerLedger && (hasTotals || showBook) && (
        <div className="rw-kpis">
          {/* Books and party ledgers both state opening → closing, which a column
              total cannot express. */}
          {showBook && <Kpi label="Opening balance" value={fmtMoney(report.openingBalance)} />}
          {showBook && <Kpi label="Closing balance" value={fmtMoney(report.closingBalance)} lead />}
          {showBook && report.accountName && <Kpi label="Account" value={report.accountName} />}
          {/* A statement names its party in the letterhead below; a ledger has no
              letterhead, so the band says whose it is. */}
          {showBook && !report.accountName && report.partyName && !report.party && (
            <Kpi label={report.partyType === "Supplier" ? "Supplier" : "Customer"} value={report.partyName} />
          )}
          {Object.entries(totals).map(([key, value]) => (
            <Kpi
              key={key}
              label={totalLabels[key] || humanise(key)}
              value={fmtTotal(key, value)}
              lead={!showBook && key === leadTotal}
            />
          ))}
        </div>
      )}

      {/* ── 3. The rows: they fill the window and scroll on their own ─────── */}
      <RecordsViewport label="Accounting ledger records" enabled={!narrow}>
        {/* A statement is a document you send, so it leads with the letterhead,
            the addressee and the amount due. */}
        {report?.party && !customerLedger && <StatementHead report={report} />}

        {customerLedger && report && (
          <div className="rw-section-head ledger-transactions-heading">
            <h3>Transactions <span style={{ fontWeight: 600, color: colors.textSecondary }}>· {report.partyName || "All customers"}</span></h3>
            <span>{fmtInt(report.totalCount)} transaction{report.totalCount === 1 ? "" : "s"}</span>
          </div>
        )}

        {loading ? (
          <div className="rw-state" role="status">Loading report…</div>
        ) : error ? (
          <div className="rw-state rw-state--error">{error}</div>
        ) : rows.length === 0 ? (
          <div className="rw-state">Nothing to show for this period and filter combination.</div>
        ) : report?.statement ? (
          // A statement is a hierarchy, not a grid: indented groups, subtotals at
          // every level, and one figure per line. It reads the same on a phone as on
          // a desktop, so there is no separate narrow layout.
          <StatementTable report={report} rows={rows} onDrill={onOpenAccount} />
        ) : narrow ? (
          <div className="rw-cards">
            {rows.map((row, i) => (
              <RowCard
                key={i}
                row={row}
                columns={columns}
                leadCol={leadCol}
                amountCol={amountCol}
                onOpenRow={onOpenRow}
                onDrillRow={drillRow}
              />
            ))}
          </div>
        ) : (
          <div data-admin-table-region="" className="rw-table-wrap report-table-wrap">
            <table className="rw-table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={isNumeric(c.format) ? "rw-num" : undefined}>{c.label}</th>
                  ))}
                  {(onOpenRow || drillRow) && <th className="rw-num" aria-label="Open" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.key} className={cellClass(c, row)}>
                        {c.format === "text"
                          ? <span className="rw-clamp">{renderCell(row, c)}</span>
                          : renderCell(row, c)}
                      </td>
                    ))}
                    {(onOpenRow || drillRow) && (
                      <td className="rw-act">
                        {drillRow && row?.drillKey && (
                          <button
                            type="button"
                            className="rw-open"
                            onClick={() => drillRow(row)}
                            title={`Open the ledger behind ${rowLabel(row, leadCol)}`}
                            aria-label={`Open the ledger behind ${rowLabel(row, leadCol)}`}
                          >
                            <MdChevronRight size={18} />
                          </button>
                        )}
                        {onOpenRow && canOpen(row) && (
                          <button
                            type="button"
                            className="rw-open"
                            onClick={() => onOpenRow(row)}
                            title="Open the source document"
                            aria-label="Open the source document"
                          >
                            <MdOpenInNew size={15} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              {hasTotals && columns.some((c) => c.totalled) && (
                <tfoot>
                  <tr>
                    {columns.map((c, idx) => (
                      <td key={c.key} className={isNumeric(c.format) ? "rw-num" : undefined}>
                        {c.totalled && totals[c.key] !== undefined
                          ? fmtMoney(totals[c.key])
                          : idx === 0 ? "Total" : ""}
                      </td>
                    ))}
                    {(onOpenRow || drillRow) && <td className="rw-act" />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* How old the debt is — the part of a statement that prompts payment. */}
        {report?.aging && Number(report.aging.total || 0) !== 0 && (
          <AgingFooter aging={report.aging} owed={report.closingBalance} />
        )}

        {/* ── 4. The breakdown ──────────────────────────────────────────────── */}
        {(report?.groupSummaries || []).map((group) => (
          <GroupSummary key={group.title} group={group} onDrill={onDrill} />
        ))}
      </RecordsViewport>

      {report && report.totalCount > 0 && (
        <Pagination
          page={report.page || 1}
          totalPages={totalPages}
          total={report.totalCount}
          onPage={onPage}
          pageSize={pageSize}
          onPageSize={onPageSize}
          unit="rows"
        />
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Dot({ children }) {
  return (
    <>
      <span className="rw-meta__dot" aria-hidden="true">·</span>
      <span>{children}</span>
    </>
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

function Notice({ tone, children }) {
  return (
    <div className={`rw-notice${tone === "warn" ? " rw-notice--warn" : ""}`}>
      <MdInfoOutline size={17} />
      <span>{children}</span>
    </div>
  );
}

/**
 * Statement letterhead and addressee.
 *
 * A statement is not a screen, it is a document that leaves the building: who
 * it is from, who it is to, the period, and what is owed. The amount due is
 * given its own panel because it is the only number the recipient reads first.
 */
function StatementHead({ report }) {
  const from = report.companyContact || {};
  const to = report.party || {};
  const owed = Number(report.closingBalance || 0);
  const isSupplier = report.partyType === "Supplier";

  return (
    <div className="rw-statement">
      <div style={{ minWidth: 0 }}>
        <span className="rw-statement__label">From</span>
        <div className="rw-statement__name">{from.name || report.companyName}</div>
        <ContactLines c={from} />
      </div>
      <div style={{ minWidth: 0 }}>
        <span className="rw-statement__label">
          {isSupplier ? "Statement of account with" : "Statement for"}
        </span>
        <div className="rw-statement__name">{to.name || report.partyName}</div>
        <ContactLines c={to} />
      </div>
      <div className="rw-statement__due">
        <span className="rw-statement__label">
          {isSupplier ? "Balance we owe" : "Amount due"}
        </span>
        <span className="rw-statement__amount">Rs {fmtMoney(owed)}</span>
        <span className="rw-statement__period">{report.periodLabel}</span>
      </div>
    </div>
  );
}

function ContactLines({ c }) {
  const lines = [c.address, c.phone, c.email].filter(Boolean);
  const tax = [c.ntn && `NTN ${c.ntn}`, c.strn && `STRN ${c.strn}`].filter(Boolean).join("  ·  ");
  return (
    <div className="rw-statement__lines">
      {lines.map((l, i) => <div key={i}>{l}</div>)}
      {tax && <div>{tax}</div>}
    </div>
  );
}

/**
 * Age breakdown of the closing balance, with a proportion bar per bucket.
 * Overdue buckets are tinted so "90+" cannot be skimmed past.
 */
function AgingFooter({ aging, owed }) {
  const buckets = [
    { key: "current", label: "Current", tone: "ok" },
    { key: "days1To30", label: "1–30 days", tone: "ok" },
    { key: "days31To60", label: "31–60 days", tone: "warn" },
    { key: "days61To90", label: "61–90 days", tone: "warn" },
    { key: "over90", label: "Over 90 days", tone: "bad" },
  ];
  const total = Math.abs(Number(aging.total || 0)) || 1;

  return (
    <div className="rw-panel">
      <div className="rw-panel__head">
        <h3>How old is this balance</h3>
        <strong>Rs {fmtMoney(owed)}</strong>
      </div>
      <div className="rw-panel__grid">
        {buckets.map((b) => {
          const amount = Number(aging[b.key] || 0);
          const pct = Math.max(0, Math.min(100, (Math.abs(amount) / total) * 100));
          const tone = amount === 0 ? "zero" : b.tone;
          return (
            <div key={b.key} className="rw-bucket">
              <span className="rw-kpi__label">{b.label}</span>
              <strong style={AGING_TONE[tone]}>{fmtMoney(amount)}</strong>
              <div className="rw-bar"><i style={{ width: `${pct}%`, ...AGING_BAR[tone] }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const AGING_TONE = {
  zero: { color: colors.textSecondary, fontWeight: 600 },
  ok: { color: colors.textPrimary },
  warn: { color: "#b26a00" },
  bad: { color: colors.danger },
};
const AGING_BAR = {
  zero: { background: "#e3e8ef" },
  ok: {},
  warn: { background: "#f0a000" },
  bad: { background: colors.danger },
};

/**
 * Phone layout. A 10-column table cannot be read on a 375px screen, so each row
 * becomes a card: who/what on top, the figure in its own band, the rest as a
 * label/value grid that reflows to one column.
 */
function RowCard({ row, columns, leadCol, amountCol, onOpenRow, onDrillRow }) {
  const meta = columns.filter((c) => c !== leadCol && c !== amountCol);
  return (
    <div className="rw-card report-row-card">
      <div className="rw-card__top">
        <span className="rw-card__lead">{renderCell(row, leadCol) || "—"}</span>
        {onDrillRow && row?.drillKey && (
          <button
            type="button"
            className="rw-open"
            onClick={() => onDrillRow(row)}
            aria-label={`Open the ledger behind ${rowLabel(row, leadCol)}`}
          >
            <MdChevronRight size={20} />
          </button>
        )}
        {onOpenRow && canOpen(row) && (
          <button
            type="button"
            className="rw-open"
            onClick={() => onOpenRow(row)}
            aria-label="Open source document"
          >
            <MdOpenInNew size={18} />
          </button>
        )}
      </div>

      {amountCol && (
        <div className="rw-card__amount">
          <span className="rw-kpi__label">{amountCol.label}</span>
          <strong>{renderCell(row, amountCol)}</strong>
        </div>
      )}

      <div className="rw-card__meta">
        {meta.map((c) => {
          const v = renderCell(row, c);
          if (v === "" || v === null || v === undefined) return null;
          return (
            <div key={c.key} style={{ minWidth: 0 }}>
              <span>{c.label}</span>
              <b>{v}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A financial statement.
 *
 * The server flattens the account-group hierarchy into lines carrying a `level`
 * and a `kind`, so this draws indentation and weight without knowing anything
 * about charts of accounts. Account lines are clickable — a statement figure you
 * cannot open is a dead end, and "why is this account this number" is the whole
 * reason to look at one.
 */
function StatementTable({ report, rows, onDrill }) {
  const hasComparative = (report.columns || []).some((c) => c.key === "comparative");

  return (
    <div data-admin-table-region="" className="rw-table-wrap">
      <table className="rw-table rw-stmt" style={{ minWidth: hasComparative ? 620 : 0 }}>
        <thead>
          <tr>
            <th />
            <th className="rw-num">{report.periodLabel}</th>
            {hasComparative && <th className="rw-num">{report.comparativeLabel}</th>}
            {hasComparative && <th className="rw-num">Change</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((line, i) => {
            if (line.kind === "spacer") {
              return <tr key={i}><td colSpan={hasComparative ? 4 : 2} style={{ height: 8, padding: 0, border: 0 }} /></tr>;
            }
            const clickable = line.kind === "account" && line.accountId && onDrill;
            return (
              <tr
                key={i}
                className={`rw-stmt--${line.kind}${clickable ? " rw-stmt--click" : ""}`}
                onClick={clickable ? () => onDrill(line.accountId) : undefined}
                title={clickable ? `Open the ledger for ${line.label}` : undefined}
              >
                <td style={{ paddingLeft: `calc(10px + ${line.level * 1.1}rem)` }}>
                  <span className="rw-stmt-label">
                    {line.label}
                    {line.code && <span className="rw-stmt-code">{line.code}</span>}
                  </span>
                </td>
                <td className="rw-num">{fmtLine(line, line.amount)}</td>
                {hasComparative && (
                  <td className="rw-num" style={{ color: colors.textSecondary }}>
                    {line.comparative === null || line.comparative === undefined
                      ? "" : fmtLine(line, line.comparative)}
                  </td>
                )}
                {hasComparative && (
                  <td className="rw-num" style={changeTone(line.change)}>
                    {line.change === null || line.change === undefined ? "" : (
                      <>
                        {line.kind === "ratio" ? fmtPoints(line.change) : fmtMoney(line.change)}
                        {line.changePercent !== null && line.changePercent !== undefined && (
                          <span className="rw-stmt-pct">
                            {line.changePercent > 0 ? "+" : ""}{line.changePercent}%
                          </span>
                        )}
                      </>
                    )}
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

/** A negative change is not automatically bad — it depends on the line — so the
 *  tint is deliberately neutral-leaning: red only for a real decline. */
function changeTone(change) {
  const n = Number(change || 0);
  if (!change) return { color: colors.textSecondary };
  return n < 0 ? { color: colors.danger } : { color: colors.success };
}

/** A grouped breakdown with a proportion bar, so the biggest lines read instantly. */
function GroupSummary({ group, onDrill }) {
  const rows = group.rows || [];
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => Math.abs(Number(r.amount || 0))), 1);
  const clickable = !!group.drillFilter && typeof onDrill === "function";

  return (
    <div className="rw-panel">
      <div className="rw-panel__head">
        <h3>{group.title}</h3>
        <strong>Rs {fmtMoney(group.total)}</strong>
      </div>
      <div>
        {rows.map((r, i) => {
          const pct = Math.min(100, (Math.abs(Number(r.amount || 0)) / max) * 100);
          const canClick = clickable && !!r.drillKey;
          return (
            <div
              key={`${r.label}-${i}`}
              className={`rw-group-row${canClick ? " rw-group-row--click" : ""}`}
              onClick={canClick ? () => onDrill(group.drillFilter, r.drillKey) : undefined}
              role={canClick ? "button" : undefined}
              tabIndex={canClick ? 0 : undefined}
              onKeyDown={canClick ? (e) => (e.key === "Enter" || e.key === " ") && onDrill(group.drillFilter, r.drillKey) : undefined}
              title={canClick ? `Show the transactions behind ${r.label}` : undefined}
            >
              <div className="rw-group-row__top">
                <span className="rw-group-row__label">{r.label}</span>
                <span className="rw-group-row__amount">{fmtMoney(r.amount)}</span>
              </div>
              <div className="rw-bar"><i style={{ width: `${pct}%` }} /></div>
              <div className="rw-group-row__sub">
                {r.count ? `${fmtInt(r.count)} transaction${r.count === 1 ? "" : "s"}` : ""}
                {Number(r.tax) ? `  ·  tax ${fmtMoney(r.tax)}` : ""}
                {canClick && <em>View detail →</em>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Formatting ──────────────────────────────────────────────────────────────

const isNumeric = (format) => format === "money" || format === "int" || format === "percent" || format === "number";

/** A quantity: whole numbers plain, fractions to 4 places. */
const fmtNumber = (v) => Number(v || 0).toLocaleString("en-PK", { maximumFractionDigits: 4 });
// "invoiceCount", but also plain tallies such as "postings" — never money.
const isCount = (key) => /(count|postings|entries|transactions)$/i.test(key);
// Totals keyed "...Percent" (gross margin) are a percentage, not money.
const isPercentKey = (key) => /percent$/i.test(key);

/** 23.5 -> "23.5%". The server sends the percentage itself, never a fraction. */
export function fmtPercent(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return `${n.toLocaleString("en-PK", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** A change in a percentage, in percentage points. */
const fmtPoints = (v) => {
  const n = Number(v || 0);
  return `${n > 0 ? "+" : ""}${n.toLocaleString("en-PK", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts`;
};

const fmtTotal = (key, value) =>
  isCount(key) ? fmtInt(value) : isPercentKey(key) ? fmtPercent(value) : fmtMoney(value);

/** A statement line's figure — a ratio line carries a percentage. */
const fmtLine = (line, v) => (line.kind === "ratio" ? fmtPercent(v) : fmtMoney(v));

const rowLabel = (row, col) => String((col && row?.[col.key]) || "this row");

/** Negatives in parentheses — accounting convention, not a minus sign. */
export function fmtMoney(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

const fmtInt = (v) => Number(v || 0).toLocaleString("en-PK");

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }) : "";

function renderCell(row, col) {
  if (!col) return "";
  const v = row?.[col.key];
  if (v === null || v === undefined) return "";
  switch (col.format) {
    case "money": return fmtMoney(v);
    case "number": return fmtNumber(v);
    case "int": return fmtInt(v);
    case "percent": return fmtPercent(v);
    case "date": return fmtDate(v);
    case "status": return <StatusChip value={String(v)} />;
    default: return String(v);
  }
}

function StatusChip({ value }) {
  const v = value.toLowerCase();
  const tone =
    v.includes("cancel") || v.includes("bounce") ? " rw-status--bad"
    : v.includes("pending") || v.includes("deposit") ? " rw-status--warn"
    : v.includes("clear") || v.includes("reconcil") ? " rw-status--ok"
    : "";
  return <span className={`rw-status${tone}`}>{value}</span>;
}

function cellClass(col, row) {
  if (isNumeric(col.format)) {
    const n = Number(row?.[col.key] || 0);
    return n < 0 ? "rw-num rw-neg" : "rw-num";
  }
  // A date is short and atomic: wrapping it to "19 / Oct / 2024" over three
  // lines triples the row height and reads as broken.
  if (col.format === "date" || col.format === "status") return "rw-nowrap";
  return "rw-text";
}

/** A row is openable when it carries a source document id. */
const canOpen = (row) =>
  !!(row?.sourceId || row?.paymentId || row?.journalEntryId);

const humanise = (key) => {
  const aged = /^days(\d+)To(\d+)$/i.exec(key);
  if (aged) return `${aged[1]}–${aged[2]} days`;
  if (/^over(\d+)$/i.test(key)) return `Over ${key.replace(/\D/g, "")} days`;
  return key.replace(/([A-Z])/g, " $1").replace(/([a-z])(\d)/gi, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase()).trim();
};

const slug = (s) => (s || "report").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

/**
 * Standalone HTML for print and PDF. Built here rather than printing the live
 * DOM so the output carries the full company header, the filters that shaped it
 * and the totals — an emailed report has to explain itself. Both consumers
 * (writeAndPrint, exportToPdf) take a full document with a <style> block.
 */
export function buildReportHtml(report) {
  if (!report) return "<html><body></body></html>";
  const cols = report.columns || [];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const head = cols.map((c) =>
    `<th class="${isNumeric(c.format) ? "num" : ""}">${esc(c.label)}</th>`).join("");

  // A statement prints as its hierarchy. Running it through the generic grid
  // would lose the indentation that carries the meaning.
  if (report.statement) {
    const hasComp = (report.columns || []).some((c) => c.key === "comparative");
    const stmtRows = (report.rows || []).map((l) => {
      if (l.kind === "spacer") return `<tr><td colspan="${hasComp ? 4 : 2}" style="height:8px"></td></tr>`;
      const cls = l.kind === "group" ? "g" : l.kind === "subtotal" ? "s"
                : l.kind === "total" ? "t" : "";
      const indent = 2 + (l.level || 0) * 10;
      return `<tr class="${cls}">`
        + `<td style="padding-left:${indent}px">${esc(l.label)}</td>`
        + `<td class="num">${esc(fmtLine(l, l.amount))}</td>`
        + (hasComp ? `<td class="num">${l.comparative == null ? "" : esc(fmtLine(l, l.comparative))}</td>` : "")
        + (hasComp ? `<td class="num">${l.change == null ? "" : esc(l.kind === "ratio" ? fmtPoints(l.change) : fmtMoney(l.change))}</td>` : "")
        + `</tr>`;
    }).join("");

    const check = report.statement === "BalanceSheet"
      ? `<div class="chk">${report.isBalanced
          ? "Assets = Liabilities + Equity"
          : "OUT OF BALANCE BY " + esc(fmtMoney(report.difference))}</div>`
      : "";

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1a2332; font-size: 11px; margin: 0; }
  .co { font-size: 19px; font-weight: 700; }
  .ttl { font-size: 15px; font-weight: 600; color: #0d47a1; margin-top: 2px; }
  .meta { font-size: 10px; color: #5f6d7e; margin-top: 4px; }
  .rule { border-bottom: 2px solid #0d47a1; margin: 8px 0 12px; }
  .chk { font-size: 10px; font-weight: 700; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 3px 6px; }
  th { background: #f1f4f8; font-size: 9px; text-transform: uppercase; color: #0d47a1; text-align: right; }
  th.l { text-align: left; }
  .num { text-align: right; white-space: nowrap; }
  tr.g td { font-weight: 700; color: #0d47a1; text-transform: uppercase; font-size: 9px; padding-top: 9px; }
  tr.s td { font-weight: 700; border-top: 1px solid #e8edf3; }
  tr.t td { font-weight: 700; border-top: 2px solid #0d47a1; font-size: 12px; }
  thead { display: table-header-group; }
</style></head><body>
  <div class="co">${esc(report.companyName)}</div>
  <div class="ttl">${esc(report.title)}</div>
  <div class="meta">${esc(report.periodLabel)}  ·  Generated ${esc(fmtDateTime(report.generatedAt))}</div>
  <div class="rule"></div>
  ${check}
  <table><thead><tr><th class="l"></th><th>${esc(report.periodLabel)}</th>
    ${hasComp ? `<th>${esc(report.comparativeLabel || "")}</th><th>Change</th>` : ""}</tr></thead>
    <tbody>${stmtRows}</tbody></table>
</body></html>`;
  }

  const body = (report.rows || []).map((row) => {
    const tds = cols.map((c) => {
      const raw = row?.[c.key];
      const text = c.format === "money" ? fmtMoney(raw)
        : c.format === "number" ? fmtNumber(raw)
        : c.format === "int" ? fmtInt(raw)
        : c.format === "percent" ? fmtPercent(raw)
        : c.format === "date" ? fmtDate(raw)
        : raw ?? "";
      return `<td class="${isNumeric(c.format) ? "num" : ""}">${esc(text)}</td>`;
    }).join("");
    return `<tr>${tds}</tr>`;
  }).join("");

  const foot = cols.some((c) => c.totalled)
    ? `<tfoot><tr>${cols.map((c, i) =>
        `<td class="${isNumeric(c.format) ? "num" : ""}">${
          c.totalled && report.totals?.[c.key] !== undefined
            ? esc(c.format === "number" ? fmtNumber(report.totals[c.key]) : c.format === "int" ? fmtInt(report.totals[c.key]) : fmtMoney(report.totals[c.key]))
          : i === 0 ? "Total" : ""}</td>`).join("")}</tr></tfoot>`
    : "";

  const totals = Object.entries(report.totals || {}).map(([k, v]) =>
    `<div class="kpi"><span>${esc(report.totalLabels?.[k] || humanise(k))}</span>`
    + `<strong>${esc(fmtTotal(k, v))}</strong></div>`).join("");

  const groups = (report.groupSummaries || []).map((g) => `
    <h3>${esc(g.title)}</h3>
    <table class="grp">
      <tbody>
        ${(g.rows || []).map((r) =>
          `<tr><td>${esc(r.label)}</td><td class="num">${esc(fmtMoney(r.amount))}</td></tr>`).join("")}
        <tr class="grp-total"><td>Total</td><td class="num">${esc(fmtMoney(g.total))}</td></tr>
      </tbody>
    </table>`).join("");

  // A printed statement needs the letterhead and addressee, or it is just a
  // table of numbers with no indication of who owes whom.
  const statement = report.party ? `
    <table class="stmt"><tr>
      <td>
        <div class="lbl">From</div>
        <div class="nm">${esc(report.companyContact?.name || report.companyName)}</div>
        <div class="sm">${[report.companyContact?.address, report.companyContact?.phone]
          .filter(Boolean).map(esc).join("<br/>")}</div>
      </td>
      <td>
        <div class="lbl">${report.partyType === "Supplier" ? "Account with" : "Statement for"}</div>
        <div class="nm">${esc(report.party?.name || report.partyName)}</div>
        <div class="sm">${[report.party?.address, report.party?.phone, report.party?.email]
          .filter(Boolean).map(esc).join("<br/>")}</div>
      </td>
      <td class="due">
        <div class="lbl">${report.partyType === "Supplier" ? "Balance we owe" : "Amount due"}</div>
        <div class="dueamt">Rs ${esc(fmtMoney(report.closingBalance))}</div>
      </td>
    </tr></table>` : "";

  // Opening → closing reads as two figures beside the totals, not a table.
  const openClose = (report.openingBalance !== undefined && (report.partyType || report.accountName))
    ? `<div class="kpi"><span>Opening balance</span><strong>${esc(fmtMoney(report.openingBalance))}</strong></div>`
      + `<div class="kpi"><span>Closing balance</span><strong>${esc(fmtMoney(report.closingBalance))}</strong></div>`
    : "";

  const agingBuckets = [["Current", "current"], ["1–30 days", "days1To30"], ["31–60 days", "days31To60"],
    ["61–90 days", "days61To90"], ["Over 90 days", "over90"]];
  const aging = report.aging && Number(report.aging.total || 0) !== 0 ? `
    <div class="no-break">
    <h3>How old is this balance</h3>
    <table class="age"><thead><tr>${agingBuckets.map(([label]) => `<th class="num">${esc(label)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody><tr>${agingBuckets.map(([, key]) => `<td class="num">${esc(fmtMoney(report.aging[key]))}</td>`).join("")}
        <td class="num"><b>${esc(fmtMoney(report.closingBalance))}</b></td></tr></tbody>
    </table></div>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 10mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1a2332; font-size: 11px; margin: 0; }
  .co { font-size: 19px; font-weight: 700; }
  .ttl { font-size: 15px; font-weight: 600; color: #0d47a1; margin-top: 2px; }
  .meta { font-size: 10px; color: #5f6d7e; margin-top: 4px; }
  .rule { border-bottom: 2px solid #0d47a1; margin: 8px 0 12px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  .kpi { border: 1px solid #e8edf3; border-radius: 6px; padding: 6px 10px; min-width: 120px; }
  .kpi span { display: block; font-size: 8px; text-transform: uppercase; letter-spacing: .05em; color: #5f6d7e; }
  .kpi strong { font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #e8edf3; text-align: left; vertical-align: top; }
  th { background: #f1f4f8; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #0d47a1; }
  .num { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 2px solid #0d47a1; background: #f8f9fb; }
  thead { display: table-header-group; }  /* repeat the header on every page */
  tr { page-break-inside: avoid; }
  h3 { font-size: 12px; margin: 14px 0 4px; color: #0d47a1; }
  .grp { width: 60%; }
  .grp-total td { font-weight: 700; border-top: 1px solid #0d47a1; }
  .stmt { width: 100%; margin-bottom: 12px; }
  .stmt td { border: none; vertical-align: top; padding: 0 12px 0 0; width: 33%; }
  .stmt .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: .05em; color: #5f6d7e; }
  .stmt .nm { font-size: 13px; font-weight: 700; margin: 2px 0; }
  .stmt .sm { font-size: 9px; color: #5f6d7e; line-height: 1.45; }
  .stmt .due { text-align: right; }
  .stmt .dueamt { font-size: 20px; font-weight: 800; color: #0d47a1; }
  tbody tr:nth-child(even) td { background: #fafbfd; }
  .age { width: 100%; margin-top: 2px; }
  .age td { font-size: 12px; }
  .grp { margin-top: 2px; }
  .foot { margin-top: 18px; padding-top: 6px; border-top: 1px solid #e8edf3; font-size: 9px; color: #5f6d7e; text-align: center; }
</style></head><body>
  <div class="co">${esc(report.companyName)}</div>
  <div class="ttl">${esc(report.title)}</div>
  <div class="meta">${esc(report.periodLabel)}${
    (report.filtersApplied || []).length ? "  ·  " + esc(report.filtersApplied.join("  ·  ")) : ""
  }<br/>${esc(report.sourceLabel || (report.ledgerSourced ? "Source: general ledger" : "Source: payment records (GL posting off)"))}
   ·  Generated ${esc(fmtDateTime(report.generatedAt))}</div>
  <div class="rule"></div>
  ${statement}
  ${totals || openClose ? `<div class="kpis">${openClose}${totals}</div>` : ""}
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
  ${aging}
  ${groups}
  <div class="foot">${esc(report.companyName)} · ${esc(report.title)} · ${esc(report.periodLabel)} · Printed ${esc(fmtDateTime(new Date()))}</div>
</body></html>`;
}
