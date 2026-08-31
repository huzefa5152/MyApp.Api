import { useMemo, useState } from "react";
import {
  MdArrowBack, MdChevronRight, MdInfoOutline, MdOpenInNew,
  MdPictureAsPdf, MdPrint, MdTableChart,
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
export default function ReportShell({
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
  categoryTitle,
}) {
  const narrow = useIsNarrow(820);
  const [busy, setBusy] = useState(null);

  const columns = report?.columns || [];
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
    () => [...columns].reverse().find((c) => c.totalled) || null,
    [columns]
  );

  const totalPages = report?.pageSize
    ? Math.max(1, Math.ceil((report.totalCount || 0) / report.pageSize))
    : 1;

  const doPrint = async () => {
    setBusy("print");
    try {
      const w = window.open("", "_blank");
      if (w) writeAndPrint(w, buildReportHtml(report));
    } finally { setBusy(null); }
  };

  const doPdf = async () => {
    setBusy("pdf");
    try {
      await exportToPdf(buildReportHtml(report), `${slug(report.title)}.pdf`);
    } finally { setBusy(null); }
  };

  return (
    <div>
      {/* ── 1. Identity + actions ─────────────────────────────────────────── */}
      <div style={st.header}>
        <div style={st.headerBar} />
        <div style={st.headerInner}>
          <div style={{ minWidth: 0, flex: "1 1 260px" }}>
            {onBack && (
              <button type="button" style={st.backBtn} onClick={onBack}>
                <MdArrowBack size={16} />
                <span>All reports</span>
              </button>
            )}
            {categoryTitle && (
              <div style={st.crumb}>
                <span>{categoryTitle}</span>
                <MdChevronRight size={14} />
              </div>
            )}
            <h2 style={st.title}>{report?.title || "Report"}</h2>
            <div style={st.metaLine}>
              {report?.companyName && <strong style={st.company}>{report.companyName}</strong>}
              {report?.periodLabel && <Dot>{report.periodLabel}</Dot>}
              {report?.generatedAt && <Dot>Generated {fmtDateTime(report.generatedAt)}</Dot>}
            </div>
            {(report?.filtersApplied || []).length > 0 && (
              <div style={st.provenance}>
                {report.filtersApplied.join("  ·  ")}
              </div>
            )}
          </div>

          <div style={st.actionRow}>
            {canExport && (
              <button
                type="button"
                style={st.actionBtn}
                onClick={async () => { setBusy("excel"); try { await onExportExcel?.(); } finally { setBusy(null); } }}
                disabled={!!busy}
                title="Download as Excel"
              >
                <MdTableChart size={17} />
                <span>{busy === "excel" ? "Preparing…" : "Excel"}</span>
              </button>
            )}
            <button type="button" style={st.actionBtn} onClick={doPrint} disabled={!!busy} title="Print this report">
              <MdPrint size={17} />
              <span>Print</span>
            </button>
            <button type="button" style={st.actionBtn} onClick={doPdf} disabled={!!busy} title="Save as PDF">
              <MdPictureAsPdf size={17} />
              <span>{busy === "pdf" ? "Building…" : "PDF"}</span>
            </button>
          </div>
        </div>
      </div>

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

      {/* ── 2. The answer ─────────────────────────────────────────────────── */}
      {report && Object.keys(totals).length > 0 && (
        <div style={st.totalsStrip}>
          {Object.entries(totals).map(([key, value]) => (
            <div key={key} style={st.totalTile}>
              <span style={st.totalLabel}>{totalLabels[key] || humanise(key)}</span>
              <span style={{ ...st.totalValue, ...(isCount(key) ? st.totalValueCount : {}) }}>
                {isCount(key) ? fmtInt(value) : fmtMoney(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* A statement is a document you send, so it leads with the letterhead,
          the addressee and the amount due rather than a row of tiles. */}
      {report?.party && <StatementHead report={report} />}

      {/* Books and party ledgers both state opening → closing, which a column
          total cannot express. */}
      {report?.openingBalance !== undefined
        && (report?.accountName !== undefined || report?.partyType) && (
        <div style={st.bookStrip}>
          <BookFigure label="Opening balance" value={report.openingBalance} />
          <BookFigure label="Closing balance" value={report.closingBalance} strong />
          {report.accountName && <BookFigure label="Account" text={report.accountName} />}
          {!report.accountName && report.partyName && (
            <BookFigure
              label={report.partyType === "Supplier" ? "Supplier" : "Customer"}
              text={report.partyName}
            />
          )}
        </div>
      )}

      {/* ── 3. The rows ───────────────────────────────────────────────────── */}
      {loading ? (
        <div style={st.stateBox}>Loading report…</div>
      ) : error ? (
        <div style={{ ...st.stateBox, color: colors.danger }}>{error}</div>
      ) : rows.length === 0 ? (
        <div style={st.stateBox}>
          Nothing to show for this period and filter combination.
        </div>
      ) : narrow ? (
        <div style={st.cardList}>
          {rows.map((row, i) => (
            <RowCard
              key={i}
              row={row}
              columns={columns}
              leadCol={leadCol}
              amountCol={amountCol}
              onOpenRow={onOpenRow}
            />
          ))}
        </div>
      ) : (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={isNumeric(c.format) ? st.thNum : st.th}>{c.label}</th>
                ))}
                {onOpenRow && <th style={st.thNum} aria-label="Open" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={st.tr}>
                  {columns.map((c) => (
                    <td key={c.key} style={cellStyle(c, row)}>
                      {c.format === "text"
                        ? <span style={st.clamp2}>{renderCell(row, c)}</span>
                        : renderCell(row, c)}
                    </td>
                  ))}
                  {onOpenRow && (
                    <td style={st.tdAction}>
                      {canOpen(row) && (
                        <button
                          type="button"
                          style={st.openBtn}
                          onClick={() => onOpenRow(row)}
                          title="Open the source document"
                          aria-label="Open the source document"
                        >
                          <MdOpenInNew size={16} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {Object.keys(totals).length > 0 && columns.some((c) => c.totalled) && (
              <tfoot>
                <tr style={st.totalsRow}>
                  {columns.map((c, idx) => (
                    <td key={c.key} style={isNumeric(c.format) ? st.tdNum : st.td}>
                      {c.totalled && totals[c.key] !== undefined
                        ? fmtMoney(totals[c.key])
                        : idx === 0 ? "Total" : ""}
                    </td>
                  ))}
                  {onOpenRow && <td style={st.tdAction} />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

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

      {/* How old the debt is — the part of a statement that prompts payment. */}
      {report?.aging && Number(report.aging.total || 0) !== 0 && (
        <AgingFooter aging={report.aging} owed={report.closingBalance} />
      )}

      {/* ── 4. The breakdown ──────────────────────────────────────────────── */}
      {(report?.groupSummaries || []).map((group) => (
        <GroupSummary key={group.title} group={group} onDrill={onDrill} />
      ))}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Dot({ children }) {
  return (
    <>
      <span style={st.dot} aria-hidden="true">·</span>
      <span>{children}</span>
    </>
  );
}

function Notice({ tone, children }) {
  const palette = tone === "warn"
    ? { bg: "#fff8e1", border: "#ffe0a3", fg: "#8a5a00" }
    : { bg: "#eef4fd", border: "#d6e4f7", fg: colors.blue };
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "flex-start",
      background: palette.bg, border: `1px solid ${palette.border}`,
      color: palette.fg, borderRadius: 12, padding: "0.7rem 0.9rem",
      fontSize: "0.84rem", lineHeight: 1.45, marginBottom: "1rem",
    }}>
      <MdInfoOutline size={18} style={{ flexShrink: 0, marginTop: 1 }} />
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
    <div style={st.statement}>
      <div style={st.statementGrid}>
        <div style={{ minWidth: 0 }}>
          <span style={st.statementLabel}>From</span>
          <div style={st.statementName}>{from.name || report.companyName}</div>
          <ContactLines c={from} />
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={st.statementLabel}>
            {isSupplier ? "Statement of account with" : "Statement for"}
          </span>
          <div style={st.statementName}>{to.name || report.partyName}</div>
          <ContactLines c={to} />
        </div>
        <div style={st.dueBox}>
          <span style={st.statementLabel}>
            {isSupplier ? "Balance we owe" : "Amount due"}
          </span>
          <span style={st.dueAmount}>Rs {fmtMoney(owed)}</span>
          <span style={st.duePeriod}>{report.periodLabel}</span>
        </div>
      </div>
    </div>
  );
}

function ContactLines({ c }) {
  const lines = [c.address, c.phone, c.email].filter(Boolean);
  const tax = [c.ntn && `NTN ${c.ntn}`, c.strn && `STRN ${c.strn}`].filter(Boolean).join("  ·  ");
  return (
    <div style={st.contactLines}>
      {lines.map((l, i) => <div key={i}>{l}</div>)}
      {tax && <div style={{ marginTop: 2 }}>{tax}</div>}
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
    <div style={st.agingCard}>
      <div style={st.groupHead}>
        <h3 style={st.groupTitle}>How old is this balance</h3>
        <span style={st.groupTotal}>Rs {fmtMoney(owed)}</span>
      </div>
      <div style={st.agingGrid}>
        {buckets.map((b) => {
          const amount = Number(aging[b.key] || 0);
          const pct = Math.max(0, Math.min(100, (Math.abs(amount) / total) * 100));
          const tone = amount === 0 ? "zero" : b.tone;
          return (
            <div key={b.key} style={st.agingCell}>
              <span style={st.totalLabel}>{b.label}</span>
              <span style={{ ...st.agingAmount, ...AGING_TONE[tone] }}>{fmtMoney(amount)}</span>
              <div style={st.barTrack}>
                <div style={{ ...st.barFill, width: `${pct}%`, ...AGING_BAR[tone] }} />
              </div>
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
  ok: { background: `linear-gradient(90deg, ${colors.blue}, ${colors.teal})` },
  warn: { background: "#f0a000" },
  bad: { background: colors.danger },
};

function BookFigure({ label, value, text, strong }) {
  return (
    <div style={st.bookFigure}>
      <span style={st.totalLabel}>{label}</span>
      <span style={{ ...st.bookValue, ...(strong ? { color: colors.blue, fontWeight: 800 } : {}) }}>
        {text !== undefined ? text : fmtMoney(value)}
      </span>
    </div>
  );
}

/**
 * Phone layout. A 10-column table cannot be read on a 375px screen, so each row
 * becomes a card: who/what on top, the figure in its own band, the rest as a
 * label/value grid that reflows to one column.
 */
function RowCard({ row, columns, leadCol, amountCol, onOpenRow }) {
  const meta = columns.filter((c) => c !== leadCol && c !== amountCol);
  return (
    <div style={st.card}>
      <div style={st.cardTop}>
        <span style={st.cardLead}>{renderCell(row, leadCol) || "—"}</span>
        {onOpenRow && canOpen(row) && (
          <button
            type="button"
            style={st.openBtnMobile}
            onClick={() => onOpenRow(row)}
            aria-label="Open source document"
          >
            <MdOpenInNew size={18} />
          </button>
        )}
      </div>

      {amountCol && (
        <div style={st.cardAmountBox}>
          <span style={st.totalLabel}>{amountCol.label}</span>
          <span style={st.cardAmount}>{renderCell(row, amountCol)}</span>
        </div>
      )}

      <div style={st.cardMetaGrid}>
        {meta.map((c) => {
          const v = renderCell(row, c);
          if (v === "" || v === null || v === undefined) return null;
          return (
            <div key={c.key} style={{ minWidth: 0 }}>
              <span style={st.metaLabel}>{c.label}</span>
              <span style={st.metaValue}>{v}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A grouped breakdown with a proportion bar, so the biggest lines read instantly. */
function GroupSummary({ group, onDrill }) {
  const rows = group.rows || [];
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => Math.abs(Number(r.amount || 0))), 1);
  const clickable = !!group.drillFilter && typeof onDrill === "function";

  return (
    <div style={st.groupCard}>
      <div style={st.groupHead}>
        <h3 style={st.groupTitle}>{group.title}</h3>
        <span style={st.groupTotal}>Rs {fmtMoney(group.total)}</span>
      </div>
      <div>
        {rows.map((r, i) => {
          const pct = Math.min(100, (Math.abs(Number(r.amount || 0)) / max) * 100);
          const canClick = clickable && !!r.drillKey;
          return (
            <div
              key={`${r.label}-${i}`}
              style={{ ...st.groupRow, ...(canClick ? st.groupRowClickable : {}) }}
              onClick={canClick ? () => onDrill(group.drillFilter, r.drillKey) : undefined}
              role={canClick ? "button" : undefined}
              tabIndex={canClick ? 0 : undefined}
              onKeyDown={canClick ? (e) => (e.key === "Enter" || e.key === " ") && onDrill(group.drillFilter, r.drillKey) : undefined}
              title={canClick ? `Show the transactions behind ${r.label}` : undefined}
            >
              <div style={st.groupRowTop}>
                <span style={st.groupLabel}>{r.label}</span>
                <span style={st.groupAmount}>{fmtMoney(r.amount)}</span>
              </div>
              <div style={st.barTrack}>
                <div style={{ ...st.barFill, width: `${pct}%` }} />
              </div>
              <div style={st.groupSub}>
                {r.count ? `${fmtInt(r.count)} transaction${r.count === 1 ? "" : "s"}` : ""}
                {Number(r.tax) ? `  ·  tax ${fmtMoney(r.tax)}` : ""}
                {canClick && <span style={st.groupDrillHint}>View detail →</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Formatting ──────────────────────────────────────────────────────────────

const isNumeric = (format) => format === "money" || format === "int";
const isCount = (key) => /count$/i.test(key);

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
    case "int": return fmtInt(v);
    case "date": return fmtDate(v);
    case "status": return <StatusChip value={String(v)} />;
    default: return String(v);
  }
}

function StatusChip({ value }) {
  const v = value.toLowerCase();
  const tone =
    v.includes("cancel") || v.includes("bounce") ? { bg: colors.dangerLight, fg: colors.danger, bd: "#f5c6cb" }
    : v.includes("pending") || v.includes("deposit") ? { bg: "#fff8e1", fg: "#8a5a00", bd: "#ffe0a3" }
    : v.includes("clear") || v.includes("reconcil") ? { bg: "#e8f5e9", fg: colors.success, bd: "#c8e6c9" }
    : { bg: colors.inputBg, fg: colors.textSecondary, bd: colors.inputBorder };
  return (
    <span style={{
      display: "inline-block", padding: "0.15rem 0.5rem", borderRadius: 20,
      background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}`,
      fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap",
    }}>{value}</span>
  );
}

function cellStyle(col, row) {
  if (isNumeric(col.format)) {
    const n = Number(row?.[col.key] || 0);
    return { ...st.tdNum, ...(n < 0 ? { color: colors.danger } : {}) };
  }
  // A date is short and atomic: wrapping it to "19 / Oct / 2024" over three
  // lines triples the row height and reads as broken.
  if (col.format === "date") return st.tdDate;
  if (col.format === "status") return st.tdStatus;
  return st.td;
}

/** A row is openable when it carries a source document id. */
const canOpen = (row) =>
  !!(row?.sourceId || row?.paymentId || row?.journalEntryId);

const humanise = (key) =>
  key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();

const slug = (s) => (s || "report").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

/**
 * Standalone HTML for print and PDF. Built here rather than printing the live
 * DOM so the output carries the full company header, the filters that shaped it
 * and the totals — an emailed report has to explain itself. Both consumers
 * (writeAndPrint, exportToPdf) take a full document with a <style> block.
 */
function buildReportHtml(report) {
  if (!report) return "<html><body></body></html>";
  const cols = report.columns || [];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const head = cols.map((c) =>
    `<th class="${isNumeric(c.format) ? "num" : ""}">${esc(c.label)}</th>`).join("");

  const body = (report.rows || []).map((row) => {
    const tds = cols.map((c) => {
      const raw = row?.[c.key];
      const text = c.format === "money" ? fmtMoney(raw)
        : c.format === "int" ? fmtInt(raw)
        : c.format === "date" ? fmtDate(raw)
        : raw ?? "";
      return `<td class="${isNumeric(c.format) ? "num" : ""}">${esc(text)}</td>`;
    }).join("");
    return `<tr>${tds}</tr>`;
  }).join("");

  const foot = cols.some((c) => c.totalled)
    ? `<tfoot><tr>${cols.map((c, i) =>
        `<td class="${isNumeric(c.format) ? "num" : ""}">${
          c.totalled && report.totals?.[c.key] !== undefined ? esc(fmtMoney(report.totals[c.key]))
          : i === 0 ? "Total" : ""}</td>`).join("")}</tr></tfoot>`
    : "";

  const totals = Object.entries(report.totals || {}).map(([k, v]) =>
    `<div class="kpi"><span>${esc(report.totalLabels?.[k] || humanise(k))}</span>`
    + `<strong>${esc(isCount(k) ? fmtInt(v) : fmtMoney(v))}</strong></div>`).join("");

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

  const openClose = (report.openingBalance !== undefined && (report.partyType || report.accountName))
    ? `<table class="grp"><tbody>
         <tr><td>Opening balance</td><td class="num">${esc(fmtMoney(report.openingBalance))}</td></tr>
         <tr class="grp-total"><td>Closing balance</td><td class="num">${esc(fmtMoney(report.closingBalance))}</td></tr>
       </tbody></table>` : "";

  const aging = report.aging && Number(report.aging.total || 0) !== 0 ? `
    <h3>How old is this balance</h3>
    <table class="grp"><tbody>
      ${[["Current", "current"], ["1–30 days", "days1To30"], ["31–60 days", "days31To60"],
         ["61–90 days", "days61To90"], ["Over 90 days", "over90"]]
        .map(([label, key]) =>
          `<tr><td>${esc(label)}</td><td class="num">${esc(fmtMoney(report.aging[key]))}</td></tr>`)
        .join("")}
    </tbody></table>` : "";

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
</style></head><body>
  <div class="co">${esc(report.companyName)}</div>
  <div class="ttl">${esc(report.title)}</div>
  <div class="meta">${esc(report.periodLabel)}${
    (report.filtersApplied || []).length ? "  ·  " + esc(report.filtersApplied.join("  ·  ")) : ""
  }<br/>${esc(report.ledgerSourced ? "Source: general ledger" : "Source: payment records (GL posting off)")}
   ·  Generated ${esc(fmtDateTime(report.generatedAt))}</div>
  <div class="rule"></div>
  ${statement}
  ${totals ? `<div class="kpis">${totals}</div>` : ""}
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
  ${openClose}
  ${aging}
  ${groups}
</body></html>`;
}

// ── Styles ──────────────────────────────────────────────────────────────────
const st = {
  // Header: a thin gradient band echoing the app's blue→teal identity, then
  // white content. Reads as part of the product, not a bolted-on report tool.
  header: {
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
    borderRadius: 14, overflow: "hidden", marginBottom: "1rem",
    boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
  },
  headerBar: { height: 4, background: `linear-gradient(90deg, ${colors.blue}, ${colors.teal})` },
  headerInner: {
    display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-start",
    padding: "1rem clamp(0.85rem, 1.8vw, 1.3rem)",
  },
  backBtn: {
    display: "inline-flex", alignItems: "center", gap: 5,
    // 44px minimum tap target, and padding on the right so the hit area extends
    // past the short label on a phone.
    minHeight: 44, padding: "0 0.75rem 0 0", marginBottom: 2,
    border: "none", background: "none", boxShadow: "none",
    color: colors.textSecondary, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
  },
  crumb: {
    display: "inline-flex", alignItems: "center", gap: 2,
    fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.06em", color: colors.teal, marginBottom: 2,
  },
  title: { margin: "0 0 0.35rem", fontSize: "clamp(1.15rem, 2.4vw, 1.5rem)", fontWeight: 800, color: colors.textPrimary, lineHeight: 1.2 },
  metaLine: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, fontSize: "0.84rem", color: colors.textSecondary },
  company: { color: colors.textPrimary, fontWeight: 700 },
  dot: { opacity: 0.5 },
  provenance: { marginTop: 5, fontSize: "0.78rem", color: colors.teal, fontWeight: 600, lineHeight: 1.4 },

  actionRow: { display: "flex", flexWrap: "wrap", gap: "0.45rem", marginLeft: "auto" },
  actionBtn: {
    display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44,
    padding: "0 0.9rem", borderRadius: 10, border: `1px solid ${colors.inputBorder}`,
    background: colors.inputBg, color: colors.textPrimary,
    fontWeight: 600, fontSize: "0.84rem", cursor: "pointer", whiteSpace: "nowrap",
  },

  // The answer first: a responsive strip of figures above the detail.
  totalsStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))",
    gap: "0.75rem", marginBottom: "1rem",
  },
  totalTile: {
    display: "flex", flexDirection: "column", gap: 3,
    padding: "0.8rem 0.95rem", borderRadius: 12,
    background: "linear-gradient(135deg, rgba(13,71,161,0.06), rgba(0,137,123,0.07))",
    border: `1px solid ${colors.cardBorder}`,
  },
  totalLabel: {
    fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.05em", color: colors.textSecondary,
  },
  totalValue: { fontSize: "1.35rem", fontWeight: 800, color: colors.blue, letterSpacing: "-0.015em", fontVariantNumeric: "tabular-nums" },
  totalValueCount: { color: colors.textPrimary, fontSize: "1.2rem" },

  // Statement letterhead: three columns that collapse to one on a phone.
  statement: {
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
    borderRadius: 14, padding: "1rem clamp(0.85rem, 1.8vw, 1.25rem)",
    marginBottom: "1rem", boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
  },
  statementGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))",
    gap: "1rem",
  },
  statementLabel: {
    display: "block", fontSize: "0.64rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.06em", color: colors.textSecondary, marginBottom: 3,
  },
  statementName: { fontSize: "1rem", fontWeight: 800, color: colors.textPrimary, lineHeight: 1.3 },
  contactLines: { fontSize: "0.78rem", color: colors.textSecondary, lineHeight: 1.5, marginTop: 3 },
  dueBox: {
    display: "flex", flexDirection: "column", gap: 2, justifyContent: "flex-start",
    padding: "0.75rem 0.9rem", borderRadius: 12,
    background: "linear-gradient(135deg, rgba(13,71,161,0.07), rgba(0,137,123,0.08))",
    border: `1px solid ${colors.cardBorder}`,
  },
  dueAmount: {
    fontSize: "1.5rem", fontWeight: 800, color: colors.blue,
    letterSpacing: "-0.015em", fontVariantNumeric: "tabular-nums",
  },
  duePeriod: { fontSize: "0.74rem", color: colors.textSecondary },

  agingCard: {
    marginTop: "1.25rem", background: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`, borderRadius: 14,
    boxShadow: "0 2px 12px rgba(0,0,0,0.05)", overflow: "hidden",
  },
  agingGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))",
    gap: "0.9rem", padding: "0.9rem 1rem",
  },
  agingCell: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
  agingAmount: { fontSize: "1.02rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" },

  bookStrip: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))",
    gap: "0.75rem", marginBottom: "1rem",
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
    borderRadius: 12, padding: "0.85rem 1rem",
  },
  bookFigure: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  bookValue: { fontSize: "1.05rem", fontWeight: 700, color: colors.textPrimary, fontVariantNumeric: "tabular-nums", wordBreak: "break-word" },

  stateBox: {
    padding: "2.5rem 1rem", textAlign: "center", color: colors.textSecondary,
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
    borderRadius: 14, fontSize: "0.9rem",
  },

  // Wide tables scroll inside their own box — the page never scrolls sideways.
  tableWrap: {
    overflowX: "auto", background: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`, borderRadius: 14,
    boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" },
  th: {
    position: "sticky", top: 0, zIndex: 1,
    textAlign: "left", padding: "0.7rem 0.8rem", background: "#f7f9fc",
    fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase",
    letterSpacing: "0.05em", color: colors.blue,
    borderBottom: `2px solid ${colors.cardBorder}`, whiteSpace: "nowrap",
  },
  get thNum() { return { ...this.th, textAlign: "right" }; },
  tr: { borderBottom: `1px solid ${colors.cardBorder}` },
  td: {
    padding: "0.55rem 0.8rem", color: colors.textPrimary, verticalAlign: "top",
    // Never nowrap+ellipsis user-supplied names: similar-prefix names would
    // render identically. Two lines, then clip.
    maxWidth: 260,
    display: "table-cell",
  },
  tdDate: {
    padding: "0.55rem 0.8rem", color: colors.textPrimary,
    whiteSpace: "nowrap", verticalAlign: "top",
  },
  tdStatus: { padding: "0.55rem 0.8rem", verticalAlign: "top", whiteSpace: "nowrap" },
  tdNum: {
    padding: "0.55rem 0.8rem", textAlign: "right", whiteSpace: "nowrap",
    color: colors.textPrimary, fontVariantNumeric: "tabular-nums", verticalAlign: "top",
  },
  // Two lines then clip — never nowrap+ellipsis on user-supplied names, which
  // would render "MEKO FABRICS" and "MEKO DENIM" identically.
  clamp2: {
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
    overflow: "hidden", lineHeight: 1.35,
  },
  tdAction: { padding: "0.4rem 0.6rem", textAlign: "right", width: 44 },
  totalsRow: { fontWeight: 800, background: colors.inputBg, borderTop: `2px solid ${colors.blue}` },
  openBtn: {
    display: "grid", placeItems: "center", width: 30, height: 30,
    padding: 0, borderRadius: 8, border: `1px solid ${colors.inputBorder}`,
    background: colors.inputBg, color: colors.blue, cursor: "pointer", boxShadow: "none",
  },
  // Mobile card: a full 44px thumb target, per the mobile-first standard.
  openBtnMobile: {
    display: "grid", placeItems: "center", width: 44, height: 44,
    padding: 0, borderRadius: 10, border: `1px solid ${colors.inputBorder}`,
    background: colors.inputBg, color: colors.blue, cursor: "pointer",
    boxShadow: "none", flexShrink: 0,
  },

  // Phone cards
  cardList: { display: "flex", flexDirection: "column", gap: "0.7rem" },
  card: {
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
    borderRadius: 12, padding: "0.85rem 0.95rem",
    boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
  },
  cardTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: "0.6rem" },
  cardLead: {
    fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary, lineHeight: 1.3,
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  cardAmountBox: {
    display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8,
    padding: "0.5rem 0.7rem", borderRadius: 10, marginBottom: "0.6rem",
    background: "linear-gradient(135deg, rgba(13,71,161,0.06), rgba(0,137,123,0.07))",
  },
  cardAmount: { fontSize: "1.15rem", fontWeight: 800, color: colors.blue, fontVariantNumeric: "tabular-nums" },
  cardMetaGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(130px, 100%), 1fr))",
    gap: "0.5rem 0.9rem",
  },
  metaLabel: {
    display: "block", fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.05em", color: colors.textSecondary, marginBottom: 1,
  },
  metaValue: { fontSize: "0.83rem", fontWeight: 600, color: colors.textPrimary, lineHeight: 1.3, wordBreak: "break-word" },

  // Grouped breakdowns
  groupCard: {
    marginTop: "1.25rem", background: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`, borderRadius: 14,
    boxShadow: "0 2px 12px rgba(0,0,0,0.05)", overflow: "hidden",
  },
  groupHead: {
    display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between",
    gap: 8, padding: "0.85rem 1rem", borderBottom: `1px solid ${colors.cardBorder}`,
    background: "#f7f9fc",
  },
  groupTitle: { margin: 0, fontSize: "0.98rem", fontWeight: 800, color: colors.textPrimary },
  groupTotal: { fontSize: "1rem", fontWeight: 800, color: colors.blue, fontVariantNumeric: "tabular-nums" },
  groupRow: { padding: "0.7rem 1rem", borderBottom: `1px solid ${colors.cardBorder}` },
  groupRowClickable: { cursor: "pointer" },
  groupRowTop: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  groupLabel: {
    fontSize: "0.88rem", fontWeight: 600, color: colors.textPrimary, minWidth: 0,
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  groupAmount: { fontSize: "0.9rem", fontWeight: 700, color: colors.textPrimary, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  // A proportion bar turns a column of numbers into a shape you can scan.
  barTrack: { height: 5, borderRadius: 3, background: "#eef1f6", margin: "0.4rem 0 0.3rem", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${colors.blue}, ${colors.teal})` },
  groupSub: { display: "flex", flexWrap: "wrap", gap: 8, fontSize: "0.74rem", color: colors.textSecondary },
  groupDrillHint: { marginLeft: "auto", color: colors.blue, fontWeight: 700 },
};
