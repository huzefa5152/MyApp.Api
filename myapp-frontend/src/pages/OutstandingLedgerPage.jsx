import ListFilters from "../Components/ListFilters";
import RecordsViewport from "../Components/RecordsViewport";
import { useState, useEffect, useCallback } from "react";
import { MdAccountBalanceWallet, MdBusiness, MdRefresh, MdDownload, MdPerson } from "react-icons/md";
import { getOutstandingLedger, getOutstandingLedgerExcel } from "../api/reportApi";
import { getClientsByCompany } from "../api/clientApi";
import { dropdownStyles } from "../theme";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { excelBrandParams } from "../utils/reportExcelBrand";
import useIsNarrow from "../hooks/useIsNarrow";
import ColumnPicker, { useHiddenColumns } from "../Components/reports/ColumnPicker";
import { CompanyPicker, Dot, PrintPdfButtons, ReportBar, ReportKpis } from "../Components/reports/ReportChrome";
import { pdfReport, printReport } from "../utils/reportPrintKit";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBorder: "#d0d7e2",
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
  Unpaid: { bg: "#fff4e0", fg: "#8a4b00" },
  PartiallyPaid: { bg: "#e3f2fd", fg: "#0277bd" },
  Paid: { bg: "#e8f5e9", fg: "#2e7d32" },
  Overdue: { bg: "#ffebee", fg: "#c62828" },
};

const money = (n) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const statusText = (s) => (s === "PartiallyPaid" ? "Partial" : s);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NOW = new Date();
const YEARS = Array.from({ length: 6 }, (_, i) => NOW.getFullYear() - i);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const segBtn = (active) => ({ border: "none", background: active ? colors.blue : "transparent", color: active ? "#fff" : colors.textSecondary, padding: "9px 14px", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", minHeight: 40 });

export default function OutstandingLedgerPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
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
  const [mode, setMode] = useState("period");     // "period" | "custom"
  const [year, setYear] = useState(NOW.getFullYear());
  const [month, setMonth] = useState(NOW.getMonth() + 1);
  const [fullYear, setFullYear] = useState(true);
  const [dateFrom, setDateFrom] = useState(ymd(new Date(NOW.getFullYear(), NOW.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(ymd(NOW));

  // Load clients on company switch; reset selection.
  useEffect(() => {
    if (!selectedCompany) { setClients([]); return; }
    setClientId(""); setReport(null);
    getClientsByCompany(selectedCompany.id)
      .then((res) => setClients(res.data || []))
      .catch(() => setClients([]));
  }, [selectedCompany?.id]);

  const rangeInvalid = mode === "custom" && dateFrom && dateTo && dateFrom > dateTo;

  // Period + client + status params — shared by the report and both exports.
  const buildParams = useCallback(() => {
    const p = mode === "custom" ? { dateFrom, dateTo } : { year, ...(fullYear ? {} : { month }) };
    if (clientId) p.clientId = clientId;   // omit → all clients
    p.status = status;
    return p;
  }, [mode, dateFrom, dateTo, year, month, fullYear, clientId, status]);

  const fetchReport = useCallback(async () => {
    if (!selectedCompany || !canView) { setReport(null); return; }
    if (mode === "custom" && (!dateFrom || !dateTo)) return;
    if (rangeInvalid) { setError("Start date must be on or before the end date."); setReport(null); return; }
    setLoading(true); setError("");
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

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const clientName = clients.find((c) => String(c.id) === String(clientId))?.name || "";

  const exportExcel = async () => {
    if (!selectedCompany || rangeInvalid) return;
    setExporting("excel");
    try {
      // The workbook carries the company's letterhead and template colours.
      const { data } = await getOutstandingLedgerExcel(selectedCompany.id, { ...buildParams(), ...(await excelBrandParams(selectedCompany)) });
      const url = URL.createObjectURL(new Blob([data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Outstanding-Ledger-${clientName || "All-Clients"}-${status}.xlsx`.replace(/\s+/g, "_");
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
      filtersApplied: [report.clientName || clientName || "All clients", STATUSES.find((s) => s.value === status)?.label],
      sourceLabel: `${report.invoiceCount} invoice(s) · amount, paid and balance per bill`,
      columns: (shown.length ? shown : OL_COLS).map((c) => ({ key: c.key, label: c.label, format: c.format || "text", totalled: !!c.total })),
      rows: report.rows.map((r) => ({
        ...r, deliveryDate: fmtDate(r.deliveryDate), invoiceDate: fmtDate(r.invoiceDate),
        poNumber: r.poNumber || "", dcNumbers: r.dcNumbers || "", status: statusText(r.status), paymentSummary: r.paymentSummary || "",
      })),
      totals: { amount: report.grandAmount, paid: report.grandPaid, balance: report.grandBalance },
    };
  };
  const doPrint = async () => {
    if (!report || !report.rows?.length) return;
    setExporting("print");
    try { await printReport(envelope(), selectedCompany); }
    catch { notify("Could not prepare the report. Allow print pop-ups and try again.", "error"); }
    finally { setExporting(""); }
  };

  const exportPdf = async () => {
    if (!report || !report.rows?.length) return;
    setExporting("pdf");
    try {
      await pdfReport(envelope(), selectedCompany, `Outstanding-Ledger-${clientName || "All-Clients"}-${status}`);
      notify("PDF generated.", "success");
    } catch {
      notify("Failed to generate the PDF.", "error");
    } finally {
      setExporting("");
    }
  };

  if (!canView) {
    return <div style={{ padding: 24, color: colors.textSecondary }}>You don't have permission to view reports.</div>;
  }

  const visibleCols = OL_COLS.filter((c) => !hiddenCols.has(c.key));
  const cols = visibleCols.length ? visibleCols : OL_COLS;
  const statusLabel = STATUSES.find((s) => s.value === status)?.label;

  const cell = (row, key) => {
    const ss = STATUS_STYLE[row.status] || STATUS_STYLE.Unpaid;
    switch (key) {
      case "serialNo": return <td key={key} className="rw-muted">{row.serialNo}</td>;
      case "poNumber": return <td key={key} className="rw-text"><span className="rw-clamp">{row.poNumber || "—"}</span></td>;
      case "deliveryDate": return <td key={key} className="rw-nowrap">{fmtDate(row.deliveryDate)}</td>;
      case "invoiceDate": return <td key={key} className="rw-nowrap">{fmtDate(row.invoiceDate)}</td>;
      case "dcNumbers": return <td key={key} className="rw-code" style={{ whiteSpace: "normal", maxWidth: 140 }}>{row.dcNumbers || "—"}</td>;
      case "billNumber": return <td key={key} className="rw-nowrap" style={{ fontWeight: 700, color: colors.blue }}>{row.billNumber}</td>;
      case "amount": return <td key={key} className="rw-num">{money(row.amount)}</td>;
      case "paid": return <td key={key} className="rw-num">{money(row.paid)}</td>;
      case "balance": return <td key={key} className="rw-num rw-strong" style={{ color: row.balance > 0 ? "#b71c1c" : colors.teal }}>{money(row.balance)}</td>;
      case "status": return (
        <td key={key} style={{ textAlign: "center" }}>
          <span style={{ background: ss.bg, color: ss.fg, padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" }}>{statusText(row.status)}</span>
        </td>
      );
      case "paymentSummary": return <td key={key} style={{ maxWidth: 320, minWidth: 160, fontSize: "0.78rem", color: colors.textSecondary }}>{row.paymentSummary || "—"}</td>;
      default: return <td key={key} />;
    }
  };
  const totalCell = (key, idx) => {
    const v = { amount: report.grandAmount, paid: report.grandPaid, balance: report.grandBalance }[key];
    if (v !== undefined) return <td key={key} className="rw-num">{money(v)}</td>;
    return <td key={key}>{idx === 0 ? `Total (${report.invoiceCount})` : ""}</td>;
  };

  return (
    <div className="rw">
      <ReportBar
        icon={<MdAccountBalanceWallet size={20} />}
        crumb="Reports"
        title="Outstanding Ledger"
        meta={<>
          {report?.companyName && <strong>{report.companyName}</strong>}
          {report?.periodLabel && <Dot>{report.periodLabel}</Dot>}
          <Dot>{report?.clientName || clientName || "All clients"}</Dot>
          <Dot>{statusLabel}</Dot>
        </>}
        actions={<>
          <CompanyPicker icon={<MdBusiness size={18} />} companies={companies} selectedCompany={selectedCompany} onChange={setSelectedCompany} />
          <button type="button" className="rw-btn" onClick={fetchReport} disabled={loading || rangeInvalid}>
            <MdRefresh size={17} /><span>{loading ? "Loading…" : "Refresh"}</span>
          </button>
          {report && <ColumnPicker columns={OL_COLS} hidden={hiddenCols} onChange={setHiddenCols} />}
          {canExport && (
            <>
              <button type="button" className="rw-btn" onClick={exportExcel} disabled={!report?.rows?.length || !!exporting}>
                <MdDownload size={17} /><span>{exporting === "excel" ? "Exporting…" : "Excel"}</span>
              </button>
              <PrintPdfButtons onPrint={doPrint} onPdf={exportPdf} busy={exporting} disabled={!report?.rows?.length} />
            </>
          )}
        </>}
      />

      {/* Controls */}
      <ListFilters><div className="rw-filters" style={{
        display: "flex", flexWrap: "wrap", gap: "8px 10px", alignItems: "flex-end",
        background: "#fff", border: `1px solid ${colors.cardBorder}`,
      }}>
        <Field label="Client" icon={<MdPerson size={15} />}>
          <div style={{ minWidth: "min(280px, 100%)" }}>
            <SearchableClientSelect
              clients={clients}
              value={clientId}
              onChange={(id) => setClientId(id)}
              placeholder="All clients"
              allowClear={true}
            />
          </div>
        </Field>
        <Field label="Period">
          <div style={{ display: "inline-flex", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
            <button type="button" onClick={() => setMode("period")} style={segBtn(mode === "period")}>Month / Year</button>
            <button type="button" onClick={() => setMode("custom")} style={segBtn(mode === "custom")}>Custom range</button>
          </div>
        </Field>
        {mode === "period" ? (
          <>
            <Field label="Year">
              <select style={dropdownStyles.base} value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="Month">
              <select style={{ ...dropdownStyles.base, opacity: fullYear ? 0.5 : 1 }} value={month} disabled={fullYear} onChange={(e) => setMonth(parseInt(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: colors.textPrimary, paddingBottom: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={fullYear} onChange={(e) => setFullYear(e.target.checked)} />
              Full year
            </label>
          </>
        ) : (
          <>
            <Field label="From">
              <input type="date" style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: "#dc2626" } : {}) }} value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <input type="date" style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: "#dc2626" } : {}) }} value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Status">
          <div style={seg.group} role="tablist" aria-label="Payment status filter">
            {STATUSES.map((s) => (
              <button key={s.value} type="button" role="tab" aria-selected={status === s.value}
                onClick={() => setStatus(s.value)}
                style={{ ...seg.btn, ...(status === s.value ? seg.on : seg.off) }}>
                {s.label}
              </button>
            ))}
          </div>
        </Field>
      </div></ListFilters>

      {error && <div className="rw-notice rw-notice--warn" role="alert">{error}</div>}

      {report && !loading && (
        <ReportKpis items={[
          { label: "Invoices", value: report.invoiceCount },
          { label: "Billed", value: money(report.grandAmount) },
          { label: "Received", value: money(report.grandPaid), tone: "good" },
          { label: "Balance", value: money(report.grandBalance), tone: "lead" },
        ]} />
      )}

      <RecordsViewport label="Outstanding Ledger records" enabled={!isNarrow}>{loading ? (
        <div className="rw-state" role="status">Loading…</div>
      ) : report && (
        report.rows.length === 0 ? (
          <div className="rw-state">
            No {status === "paid" ? "paid" : status === "all" ? "" : "outstanding"} invoices for {report.periodLabel}.
          </div>
        ) : isNarrow ? (
          /* ── Mobile: stacked cards ── */
          <div className="rw-cards">
            {report.rows.map((row) => {
              const ss = STATUS_STYLE[row.status] || STATUS_STYLE.Unpaid;
              return (
                <div key={row.invoiceId} className="rw-card" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={card.top}>
                    <span style={{ fontWeight: 700, color: colors.blue }}>Bill #{row.billNumber}</span>
                    <span style={{ background: ss.bg, color: ss.fg, padding: "2px 8px", borderRadius: 6, fontSize: "0.72rem", fontWeight: 700 }}>{statusText(row.status)}</span>
                  </div>
                  {row.poNumber && <div style={{ fontSize: "0.8rem", color: colors.textSecondary }}>PO: {row.poNumber}</div>}
                  <div style={card.meta}>
                    <div><span style={card.lbl}>Delivery</span><span style={card.val}>{fmtDate(row.deliveryDate)}</span></div>
                    <div><span style={card.lbl}>Invoice Date</span><span style={card.val}>{fmtDate(row.invoiceDate)}</span></div>
                    <div><span style={card.lbl}>D.C #</span><span style={card.val}>{row.dcNumbers || "—"}</span></div>
                    <div><span style={card.lbl}>Amount</span><span style={card.val}>{money(row.amount)}</span></div>
                    <div><span style={card.lbl}>Paid</span><span style={card.val}>{money(row.paid)}</span></div>
                    <div><span style={card.lbl}>Balance</span><span style={{ ...card.val, fontWeight: 800, color: row.balance > 0 ? "#b71c1c" : colors.teal }}>{money(row.balance)}</span></div>
                  </div>
                  {row.paymentSummary && (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${colors.cardBorder}`, fontSize: "0.78rem", color: colors.textSecondary }}>
                      <span style={card.lbl}>Payments</span>{row.paymentSummary}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Desktop/tablet: table ── */
          <div data-admin-table-region="" className="rw-table-wrap">
            <table className="rw-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>{cols.map((c) => <th key={c.key} className={c.total ? "rw-num" : undefined} style={c.key === "status" ? { textAlign: "center" } : undefined}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {report.rows.map((row) => <tr key={row.invoiceId}>{cols.map((c) => cell(row, c.key))}</tr>)}
              </tbody>
              <tfoot>
                <tr>{cols.map((c, i) => totalCell(c.key, i))}</tr>
              </tfoot>
            </table>
          </div>
        )
      )}</RecordsViewport>
    </div>
  );
}

function Field({ label, icon, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: "0.72rem", fontWeight: 600, color: colors.textSecondary, display: "flex", alignItems: "center", gap: 4 }}>
        {icon} {label}
      </label>
      {children}
    </div>
  );
}


const seg = {
  group: { display: "inline-flex", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, overflow: "hidden", background: "#fff" },
  btn: { border: "none", padding: "9px 16px", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", minHeight: 40 },
  on: { background: colors.blue, color: "#fff" },
  off: { background: "transparent", color: colors.textSecondary },
};

const card = {
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  meta: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(90px, 100%), 1fr))", gap: "0.35rem 0.7rem", marginTop: 4 },
  lbl: { display: "block", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary },
  val: { display: "block", fontSize: "0.84rem", fontWeight: 600, color: colors.textPrimary },
};
