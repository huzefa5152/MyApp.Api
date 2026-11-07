import ListFilters from "../Components/ListFilters";
import RecordsViewport from "../Components/RecordsViewport";
import { useState, useEffect, useCallback } from "react";
import {
  MdAccountBalanceWallet,
  MdRefresh,
  MdDownload,
  MdPictureAsPdf,
  MdPrint,
  MdPerson,
} from "react-icons/md";
import { getOutstandingLedger, getOutstandingLedgerExcel } from "../api/reportApi";
import { getClientsByCompany } from "../api/clientApi";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import {
  PageHeader,
  CompanyPicker,
  Button,
  Field,
  Card,
  TableWrap,
  Alert,
  EmptyState,
  Loading,
  StatGrid,
  StatCard,
} from "../ui/Kit";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { excelBrandParams } from "../utils/reportExcelBrand";
import useIsNarrow from "../hooks/useIsNarrow";
import ColumnPicker, { useHiddenColumns } from "../Components/reports/ColumnPicker";
import "../Components/reports/ReportWorkspace.css";
import { pdfReport, printReport } from "../utils/reportPrintKit";

const colors = {
  blue: "var(--k-blue)",
  teal: "var(--k-teal)",
  textPrimary: "var(--k-ink)",
  textSecondary: "var(--k-muted)",
  cardBorder: "var(--k-line)",
  inputBorder: "var(--k-line-strong)",
  rowAlt: "#fafbfd",
  totalBg: "#eef4ff",
};

// Columns of the on-screen ledger. `total` marks a column with a grand total.
const OL_COLS = [
  { key: "serialNo", label: "S.No" },
  { key: "poNumber", label: "P.O #" },
  { key: "deliveryDate", label: "Delivery" },
  { key: "invoiceDate", label: "Invoice Date" },
  { key: "dcNumbers", label: "D.C #" },
  { key: "billNumber", label: "Bill #" },
  { key: "amount", label: "Amount", format: "money", total: true },
  { key: "paid", label: "Paid", format: "money", total: true },
  { key: "balance", label: "Balance", format: "money", total: true },
  { key: "status", label: "Status" },
  { key: "paymentSummary", label: "Payment Details" },
];

const STATUSES = [
  { value: "unpaid", label: "Unpaid" },
  { value: "paid", label: "Paid" },
  { value: "all", label: "All" },
];

// Payment-status pill colours (mirrors the invoice list badges).
const STATUS_STYLE = {
  Unpaid: { bg: "var(--k-warn-bg-3)", fg: "var(--k-warn-ink)" },
  PartiallyPaid: { bg: "var(--k-info-bg)", fg: "#0277bd" },
  Paid: { bg: "var(--k-success-bg)", fg: "var(--k-success)" },
  Overdue: { bg: "var(--k-danger-bg-2)", fg: "var(--k-danger-ink)" },
};

const money = (n) =>
  (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const fmtDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const statusText = (s) => (s === "PartiallyPaid" ? "Partial" : s);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const NOW = new Date();
const YEARS = Array.from({ length: 6 }, (_, i) => NOW.getFullYear() - i);
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function OutstandingLedgerPage() {
  const { companies, selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("reports.outstanding.view");
  const canExport = has("reports.outstanding.export");
  const isNarrow = useIsNarrow();
  const [hiddenCols, setHiddenCols] = useHiddenColumns("outstanding-ledger");

  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState("unpaid");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(""); // "excel" | "pdf" | ""
  const [mode, setMode] = useState("period"); // "period" | "custom"
  const [year, setYear] = useState(NOW.getFullYear());
  const [month, setMonth] = useState(NOW.getMonth() + 1);
  const [fullYear, setFullYear] = useState(true);
  const [dateFrom, setDateFrom] = useState(ymd(new Date(NOW.getFullYear(), NOW.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(ymd(NOW));

  // Load clients on company switch; reset selection.
  useEffect(() => {
    if (!selectedCompany) {
      setClients([]);
      return;
    }
    setClientId("");
    setReport(null);
    getClientsByCompany(selectedCompany.id)
      .then((res) => setClients(res.data || []))
      .catch(() => setClients([]));
  }, [selectedCompany?.id]);

  const rangeInvalid = mode === "custom" && dateFrom && dateTo && dateFrom > dateTo;

  // Period + client + status params — shared by the report and both exports.
  const buildParams = useCallback(() => {
    const p = mode === "custom" ? { dateFrom, dateTo } : { year, ...(fullYear ? {} : { month }) };
    if (clientId) p.clientId = clientId; // omit → all clients
    p.status = status;
    return p;
  }, [mode, dateFrom, dateTo, year, month, fullYear, clientId, status]);

  const fetchReport = useCallback(async () => {
    if (!selectedCompany || !canView) {
      setReport(null);
      return;
    }
    if (mode === "custom" && (!dateFrom || !dateTo)) return;
    if (rangeInvalid) {
      setError("Start date must be on or before the end date.");
      setReport(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data } = await getOutstandingLedger(selectedCompany.id, buildParams());
      setReport(data);
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to load the outstanding ledger.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, canView, mode, dateFrom, dateTo, rangeInvalid, buildParams]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const clientName = clients.find((c) => String(c.id) === String(clientId))?.name || "";

  const exportExcel = async () => {
    if (!selectedCompany || rangeInvalid) return;
    setExporting("excel");
    try {
      // The workbook carries the company's letterhead and template colours.
      const { data } = await getOutstandingLedgerExcel(selectedCompany.id, {
        ...buildParams(),
        ...(await excelBrandParams(selectedCompany)),
      });
      const url = URL.createObjectURL(
        new Blob([data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `Outstanding-Ledger-${clientName || "All-Clients"}-${status}.xlsx`.replace(
        /\s+/g,
        "_",
      );
      a.click();
      URL.revokeObjectURL(url);
      notify("Outstanding ledger exported.", "success");
    } catch {
      notify("Failed to export the outstanding ledger.", "error");
    } finally {
      setExporting("");
    }
  };

  // Print and PDF carry the company's letterhead and the columns on screen.
  const envelope = () => {
    const shown = OL_COLS.filter((c) => !hiddenCols.has(c.key));
    return {
      title: "Outstanding Ledger",
      companyName: report.companyName,
      periodLabel: report.periodLabel,
      generatedAt: new Date().toISOString(),
      filtersApplied: [
        report.clientName || clientName || "All clients",
        STATUSES.find((s) => s.value === status)?.label,
      ],
      sourceLabel: `${report.invoiceCount} invoice(s) · amount, paid and balance per bill`,
      columns: (shown.length ? shown : OL_COLS).map((c) => ({
        key: c.key,
        label: c.label,
        format: c.format || "text",
        totalled: !!c.total,
      })),
      rows: report.rows.map((r) => ({
        ...r,
        deliveryDate: fmtDate(r.deliveryDate),
        invoiceDate: fmtDate(r.invoiceDate),
        poNumber: r.poNumber || "",
        dcNumbers: r.dcNumbers || "",
        status: statusText(r.status),
        paymentSummary: r.paymentSummary || "",
      })),
      totals: { amount: report.grandAmount, paid: report.grandPaid, balance: report.grandBalance },
    };
  };
  const doPrint = async () => {
    if (!report || !report.rows?.length) return;
    setExporting("print");
    try {
      await printReport(envelope(), selectedCompany);
    } catch {
      notify("Could not prepare the report. Allow print pop-ups and try again.", "error");
    } finally {
      setExporting("");
    }
  };

  const exportPdf = async () => {
    if (!report || !report.rows?.length) return;
    setExporting("pdf");
    try {
      await pdfReport(
        envelope(),
        selectedCompany,
        `Outstanding-Ledger-${clientName || "All-Clients"}-${status}`,
      );
      notify("PDF generated.", "success");
    } catch {
      notify("Failed to generate the PDF.", "error");
    } finally {
      setExporting("");
    }
  };

  if (!canView) {
    return (
      <EmptyState icon={MdAccountBalanceWallet}>
        You don't have permission to view reports.
      </EmptyState>
    );
  }

  const visibleCols = OL_COLS.filter((c) => !hiddenCols.has(c.key));
  const cols = visibleCols.length ? visibleCols : OL_COLS;
  const statusLabel = STATUSES.find((s) => s.value === status)?.label;

  const cell = (row, key) => {
    const ss = STATUS_STYLE[row.status] || STATUS_STYLE.Unpaid;
    switch (key) {
      case "serialNo":
        return (
          <td key={key} className="k-muted" style={td}>
            {row.serialNo}
          </td>
        );
      case "poNumber":
        return (
          <td key={key} style={td}>
            <span style={clamp2}>{row.poNumber || "—"}</span>
          </td>
        );
      case "deliveryDate":
        return (
          <td key={key} style={{ ...td, whiteSpace: "nowrap" }}>
            {fmtDate(row.deliveryDate)}
          </td>
        );
      case "invoiceDate":
        return (
          <td key={key} style={{ ...td, whiteSpace: "nowrap" }}>
            {fmtDate(row.invoiceDate)}
          </td>
        );
      case "dcNumbers":
        return (
          <td
            key={key}
            style={{ ...td, fontFamily: "monospace", fontSize: "0.75rem", maxWidth: 140 }}
          >
            {row.dcNumbers || "—"}
          </td>
        );
      case "billNumber":
        return (
          <td
            key={key}
            style={{ ...td, whiteSpace: "nowrap", fontWeight: 700, color: "var(--k-blue)" }}
          >
            {row.billNumber}
          </td>
        );
      case "amount":
        return (
          <td key={key} className="k-num" style={tdR}>
            {money(row.amount)}
          </td>
        );
      case "paid":
        return (
          <td key={key} className="k-num" style={tdR}>
            {money(row.paid)}
          </td>
        );
      case "balance":
        return (
          <td
            key={key}
            className="k-num"
            style={{
              ...tdR,
              fontWeight: 700,
              color: row.balance > 0 ? "var(--k-danger-ink-2)" : "var(--k-teal)",
            }}
          >
            {money(row.balance)}
          </td>
        );
      case "status":
        return (
          <td key={key} className="is-center" style={td}>
            <span
              style={{
                background: ss.bg,
                color: ss.fg,
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: "0.72rem",
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {statusText(row.status)}
            </span>
          </td>
        );
      case "paymentSummary":
        return (
          <td
            key={key}
            style={{
              ...td,
              maxWidth: 320,
              minWidth: 160,
              fontSize: "0.76rem",
              color: "var(--k-muted)",
            }}
          >
            {row.paymentSummary || "—"}
          </td>
        );
      default:
        return <td key={key} />;
    }
  };
  const totalTd = (key, idx) => {
    const v = { amount: report.grandAmount, paid: report.grandPaid, balance: report.grandBalance }[
      key
    ];
    if (v !== undefined)
      return (
        <td
          key={key}
          className="k-num"
          style={{
            ...tdR,
            ...totalStyle,
            ...(key === "balance" ? { color: "var(--k-blue)" } : {}),
          }}
        >
          {money(v)}
        </td>
      );
    return (
      <td
        key={key}
        style={{
          ...totalStyle,
          ...(idx === 0 ? { color: "var(--k-blue)", whiteSpace: "nowrap" } : {}),
        }}
      >
        {idx === 0 ? `Total (${report.invoiceCount})` : ""}
      </td>
    );
  };

  const labelWithIcon = (Icon, text) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <Icon size={15} aria-hidden="true" /> {text}
    </span>
  );

  return (
    <div>
      <PageHeader
        icon={MdAccountBalanceWallet}
        tone="blue"
        title="Outstanding Ledger"
        subtitle={
          report
            ? `${report.companyName || ""}${report.periodLabel ? ` · ${report.periodLabel}` : ""} · ${report.clientName || clientName || "All clients"} · ${statusLabel}`
            : "Per-client receivables — each bill's amount, what's paid, the balance, its payment status and the receipts that settled it."
        }
        actions={
          <>
            <Button
              variant="primary"
              icon={MdRefresh}
              onClick={fetchReport}
              disabled={loading || rangeInvalid}
            >
              {loading ? "Loading…" : "Refresh"}
            </Button>
            {report && (
              <ColumnPicker columns={OL_COLS} hidden={hiddenCols} onChange={setHiddenCols} />
            )}
            {canExport && (
              <>
                <Button
                  variant="teal"
                  icon={MdDownload}
                  onClick={exportExcel}
                  disabled={!report?.rows?.length || !!exporting}
                >
                  {exporting === "excel" ? "Exporting…" : "Excel"}
                </Button>
                <Button
                  icon={MdPrint}
                  onClick={doPrint}
                  disabled={!report?.rows?.length || !!exporting}
                  title="Print this report on the company letterhead"
                >
                  Print
                </Button>
                <Button
                  variant="danger"
                  icon={MdPictureAsPdf}
                  onClick={exportPdf}
                  disabled={!report?.rows?.length || !!exporting}
                  title="Save this report as a PDF on the company letterhead"
                >
                  {exporting === "pdf" ? "Building…" : "PDF"}
                </Button>
              </>
            )}
          </>
        }
      />

      {companies.length > 0 && <CompanyPicker label="Company" />}

      {/* Controls */}
      <ListFilters>
        <Card style={{ marginBottom: "var(--k-gap)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <Field label={labelWithIcon(MdPerson, "Client")}>
              <div style={{ minWidth: "min(280px, 100%)" }}>
                <SearchableClientSelect
                  clients={clients}
                  value={clientId}
                  onChange={(id) => setClientId(id)}
                  placeholder="All clients"
                  allowClear={true}
                  ariaLabel="Client"
                />
              </div>
            </Field>
            <Field label="Period">
              <div style={seg.group}>
                <button
                  type="button"
                  onClick={() => setMode("period")}
                  aria-pressed={mode === "period"}
                  style={{ ...seg.btn, ...(mode === "period" ? seg.on : seg.off) }}
                >
                  Month / Year
                </button>
                <button
                  type="button"
                  onClick={() => setMode("custom")}
                  aria-pressed={mode === "custom"}
                  style={{ ...seg.btn, ...(mode === "custom" ? seg.on : seg.off) }}
                >
                  Custom range
                </button>
              </div>
            </Field>
            {mode === "period" ? (
              <>
                <Field label="Year">
                  <select
                    className="k-select"
                    aria-label="Year"
                    style={{ width: "auto" }}
                    value={year}
                    onChange={(e) => setYear(parseInt(e.target.value))}
                  >
                    {YEARS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Month">
                  <select
                    className="k-select"
                    aria-label="Month"
                    style={{ width: "auto", opacity: fullYear ? 0.5 : 1 }}
                    value={month}
                    disabled={fullYear}
                    onChange={(e) => setMonth(parseInt(e.target.value))}
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "var(--k-font)",
                    color: "var(--k-ink)",
                    minHeight: "var(--k-h)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={fullYear}
                    onChange={(e) => setFullYear(e.target.checked)}
                  />
                  Full year
                </label>
              </>
            ) : (
              <>
                <Field label="From">
                  <input
                    type="date"
                    className="k-input"
                    aria-label="From"
                    style={rangeInvalid ? { borderColor: "#dc2626" } : undefined}
                    value={dateFrom}
                    max={dateTo || undefined}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </Field>
                <Field label="To">
                  <input
                    type="date"
                    className="k-input"
                    aria-label="To"
                    style={rangeInvalid ? { borderColor: "#dc2626" } : undefined}
                    value={dateTo}
                    min={dateFrom || undefined}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </Field>
              </>
            )}
            <Field label="Status">
              <div style={seg.group} role="tablist" aria-label="Payment status filter">
                {STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="tab"
                    aria-selected={status === s.value}
                    onClick={() => setStatus(s.value)}
                    style={{ ...seg.btn, ...(status === s.value ? seg.on : seg.off) }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Card>
      </ListFilters>

      {error && <Alert tone="error">{error}</Alert>}

      {report && !loading && (
        <StatGrid>
          <StatCard label="Invoices" value={report.invoiceCount} tone="slate" />
          <StatCard label="Billed" value={money(report.grandAmount)} tone="blue" />
          <StatCard label="Received" value={money(report.grandPaid)} tone="green" />
          <StatCard label="Balance" value={money(report.grandBalance)} tone="red" />
        </StatGrid>
      )}

      <RecordsViewport label="Outstanding Ledger records" enabled={!isNarrow}>
        {loading ? (
          <Loading>Loading…</Loading>
        ) : (
          report &&
          (report.rows.length === 0 ? (
            <EmptyState>
              No {status === "paid" ? "paid" : status === "all" ? "" : "outstanding"} invoices for{" "}
              {report.periodLabel}.
            </EmptyState>
          ) : isNarrow ? (
            /* ── Mobile: stacked cards ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {report.rows.map((row) => {
                const ss = STATUS_STYLE[row.status] || STATUS_STYLE.Unpaid;
                return (
                  <div key={row.invoiceId} style={card.box}>
                    <div style={card.top}>
                      <span style={{ fontWeight: 700, color: "var(--k-blue)" }}>
                        Bill #{row.billNumber}
                      </span>
                      <span
                        style={{
                          background: ss.bg,
                          color: ss.fg,
                          padding: "2px 8px",
                          borderRadius: 6,
                          fontSize: "0.72rem",
                          fontWeight: 700,
                        }}
                      >
                        {statusText(row.status)}
                      </span>
                    </div>
                    {row.poNumber && (
                      <div style={{ fontSize: "0.8rem", color: "var(--k-muted)" }}>
                        PO: {row.poNumber}
                      </div>
                    )}
                    <div style={card.meta}>
                      <div>
                        <span style={card.lbl}>Delivery</span>
                        <span style={card.val}>{fmtDate(row.deliveryDate)}</span>
                      </div>
                      <div>
                        <span style={card.lbl}>Invoice Date</span>
                        <span style={card.val}>{fmtDate(row.invoiceDate)}</span>
                      </div>
                      <div>
                        <span style={card.lbl}>D.C #</span>
                        <span style={card.val}>{row.dcNumbers || "—"}</span>
                      </div>
                      <div>
                        <span style={card.lbl}>Amount</span>
                        <span style={card.val}>{money(row.amount)}</span>
                      </div>
                      <div>
                        <span style={card.lbl}>Paid</span>
                        <span style={card.val}>{money(row.paid)}</span>
                      </div>
                      <div>
                        <span style={card.lbl}>Balance</span>
                        <span
                          style={{
                            ...card.val,
                            fontWeight: 800,
                            color: row.balance > 0 ? "var(--k-danger-ink-2)" : "var(--k-teal)",
                          }}
                        >
                          {money(row.balance)}
                        </span>
                      </div>
                    </div>
                    {row.paymentSummary && (
                      <div
                        style={{
                          marginTop: 6,
                          paddingTop: 6,
                          borderTop: `1px dashed var(--k-line)`,
                          fontSize: "0.78rem",
                          color: "var(--k-muted)",
                        }}
                      >
                        <span style={card.lbl}>Payments</span>
                        {row.paymentSummary}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Desktop/tablet: table ── */
            <Card flush style={{ overflow: "hidden" }}>
              <TableWrap data-admin-table-region="">
                <table className="k-table k-table--compact" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      {cols.map((c) => (
                        <th
                          key={c.key}
                          className={
                            c.total ? "k-num" : c.key === "status" ? "is-center" : undefined
                          }
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <tr key={row.invoiceId}>{cols.map((c) => cell(row, c.key))}</tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>{cols.map((c, i) => totalTd(c.key, i))}</tr>
                  </tfoot>
                </table>
              </TableWrap>
            </Card>
          ))
        )}
      </RecordsViewport>
    </div>
  );
}

// Ledger rows top-align (the payment-details cell can wrap to several lines).
const td = { verticalAlign: "top" };
const tdR = { ...td, whiteSpace: "nowrap" };
const totalStyle = {
  fontWeight: 800,
  background: colors.totalBg,
  borderTop: `2px solid var(--k-blue)`,
};
// Long P.O numbers wrap to two lines instead of widening the table.
const clamp2 = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  overflowWrap: "anywhere",
};

// Segmented control (the kit has none) — built on the kit tokens so it matches
// the control height and palette of whichever theme is active.
const seg = {
  group: {
    display: "inline-flex",
    border: "1px solid var(--k-line-strong)",
    borderRadius: "var(--k-radius)",
    overflow: "hidden",
    background: "var(--k-surface)",
  },
  btn: {
    border: "none",
    borderRadius: 0,
    padding: "0 14px",
    fontSize: "var(--k-font-sm)",
    fontWeight: 600,
    cursor: "pointer",
    minHeight: "var(--k-h)",
    boxShadow: "none",
    whiteSpace: "nowrap",
  },
  on: { background: "var(--k-blue)", color: "#fff" },
  off: { background: "transparent", color: "var(--k-muted)" },
};

const card = {
  box: {
    border: "1px solid var(--k-line)",
    borderRadius: "var(--k-radius)",
    padding: "0.7rem 0.8rem",
    background: "var(--k-surface)",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  meta: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(90px, 100%), 1fr))",
    gap: "0.35rem 0.7rem",
    marginTop: 4,
  },
  lbl: {
    display: "block",
    fontSize: "0.6rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--k-muted)",
  },
  val: {
    display: "block",
    fontSize: "var(--k-td-font)",
    fontWeight: 600,
    color: "var(--k-ink)",
    fontVariantNumeric: "tabular-nums",
  },
};
