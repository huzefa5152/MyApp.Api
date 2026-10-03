import { useState, useEffect, useCallback } from "react";
import { MdAccountBalanceWallet, MdRefresh, MdDownload, MdPictureAsPdf, MdPerson } from "react-icons/md";
import { getOutstandingLedger, getOutstandingLedgerExcel } from "../api/reportApi";
import { getClientsByCompany } from "../api/clientApi";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import {
  PageHeader, CompanyPicker, Button, Field, Card, TableWrap, Alert, EmptyState, Loading,
} from "../ui/Kit";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { exportToPdf } from "../utils/exportUtils";
import useIsNarrow from "../hooks/useIsNarrow";

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

export default function OutstandingLedgerPage() {
  const { companies, selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("reports.outstanding.view");
  const canExport = has("reports.outstanding.export");
  const isNarrow = useIsNarrow();

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
      const { data } = await getOutstandingLedgerExcel(selectedCompany.id, buildParams());
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

  const exportPdf = async () => {
    if (!report || !report.rows?.length) return;
    setExporting("pdf");
    try {
      await exportToPdf(buildLedgerHtml(report), `Outstanding-Ledger-${clientName || "All-Clients"}-${status}`);
      notify("PDF generated.", "success");
    } catch {
      notify("Failed to generate the PDF.", "error");
    } finally {
      setExporting("");
    }
  };

  if (!canView) {
    return <EmptyState icon={MdAccountBalanceWallet}>You don't have permission to view reports.</EmptyState>;
  }

  const labelWithIcon = (Icon, text) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon size={15} aria-hidden="true" /> {text}</span>
  );

  return (
    <div>
      <PageHeader
        icon={MdAccountBalanceWallet}
        tone="blue"
        title="Outstanding Ledger"
        subtitle="Per-client receivables — each bill's amount, what's paid, the balance, its payment status and the receipts that settled it."
      />

      {companies.length > 0 && <CompanyPicker label="Company" />}

      {/* Controls */}
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
              <button type="button" onClick={() => setMode("period")} aria-pressed={mode === "period"} style={{ ...seg.btn, ...(mode === "period" ? seg.on : seg.off) }}>Month / Year</button>
              <button type="button" onClick={() => setMode("custom")} aria-pressed={mode === "custom"} style={{ ...seg.btn, ...(mode === "custom" ? seg.on : seg.off) }}>Custom range</button>
            </div>
          </Field>
          {mode === "period" ? (
            <>
              <Field label="Year">
                <select className="k-select" aria-label="Year" style={{ width: "auto" }} value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
                  {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </Field>
              <Field label="Month">
                <select className="k-select" aria-label="Month" style={{ width: "auto", opacity: fullYear ? 0.5 : 1 }} value={month} disabled={fullYear} onChange={(e) => setMonth(parseInt(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--k-font)", color: "var(--k-ink)", minHeight: "var(--k-h)", cursor: "pointer" }}>
                <input type="checkbox" checked={fullYear} onChange={(e) => setFullYear(e.target.checked)} />
                Full year
              </label>
            </>
          ) : (
            <>
              <Field label="From">
                <input type="date" className="k-input" aria-label="From" style={rangeInvalid ? { borderColor: "#dc2626" } : undefined} value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input type="date" className="k-input" aria-label="To" style={rangeInvalid ? { borderColor: "#dc2626" } : undefined} value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
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
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            <Button variant="primary" icon={MdRefresh} onClick={fetchReport} disabled={loading || rangeInvalid}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
            {canExport && (
              <>
                <Button variant="teal" icon={MdDownload} onClick={exportExcel} disabled={!report?.rows?.length || !!exporting}>
                  {exporting === "excel" ? "Exporting…" : "Excel"}
                </Button>
                <Button variant="danger" icon={MdPictureAsPdf} onClick={exportPdf} disabled={!report?.rows?.length || !!exporting}>
                  {exporting === "pdf" ? "Generating…" : "PDF"}
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <Loading>Loading…</Loading>
      ) : report && (
        <Card flush style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--k-line)" }}>
            <div style={{ fontWeight: 700, color: "var(--k-ink)" }}>{report.companyName}</div>
            <div style={{ color: "var(--k-muted)", fontSize: "var(--k-td-font)" }}>
              {report.periodLabel} · {report.clientName || clientName || "All clients"} · {STATUSES.find((s) => s.value === status)?.label} · {report.invoiceCount} invoice(s)
            </div>
          </div>

          {report.rows.length === 0 ? (
            <EmptyState boxed={false}>
              No {status === "paid" ? "paid" : status === "all" ? "" : "outstanding"} invoices for {report.periodLabel}.
            </EmptyState>
          ) : isNarrow ? (
            /* ── Mobile: stacked cards ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 8px" }}>
              {report.rows.map((row) => {
                const ss = STATUS_STYLE[row.status] || STATUS_STYLE.Unpaid;
                return (
                  <div key={row.invoiceId} style={card.box}>
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
              <div style={{ ...card.box, background: colors.totalBg, borderColor: colors.blue }}>
                <div style={{ fontWeight: 800, color: colors.blue, marginBottom: 4 }}>TOTAL ({report.invoiceCount})</div>
                <div style={card.meta}>
                  <div><span style={card.lbl}>Amount</span><span style={{ ...card.val, fontWeight: 800 }}>{money(report.grandAmount)}</span></div>
                  <div><span style={card.lbl}>Paid</span><span style={{ ...card.val, fontWeight: 800 }}>{money(report.grandPaid)}</span></div>
                  <div><span style={card.lbl}>Balance</span><span style={{ ...card.val, fontWeight: 800, color: colors.blue }}>{money(report.grandBalance)}</span></div>
                </div>
              </div>
            </div>
          ) : (
            /* ── Desktop/tablet: table (scrolls inside its own box) ── */
            <TableWrap>
              <table className="k-table k-table--compact" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    {["S.No", "P.O #", "Delivery", "Invoice Date", "D.C #", "Bill #", "Amount", "Paid", "Balance", "Status", "Payment Details"].map((h, i) => (
                      <th key={i} className={i >= 6 && i <= 8 ? "k-num" : undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => {
                    const ss = STATUS_STYLE[row.status] || STATUS_STYLE.Unpaid;
                    return (
                      <tr key={row.invoiceId}>
                        <td style={td}>{row.serialNo}</td>
                        <td style={td}>{row.poNumber || "—"}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDate(row.deliveryDate)}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDate(row.invoiceDate)}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: "0.75rem" }}>{row.dcNumbers || "—"}</td>
                        <td style={{ ...td, fontWeight: 600, color: "var(--k-blue)" }}>{row.billNumber}</td>
                        <td className="k-num" style={tdR}>{money(row.amount)}</td>
                        <td className="k-num" style={tdR}>{money(row.paid)}</td>
                        <td className="k-num" style={{ ...tdR, fontWeight: 700, color: row.balance > 0 ? "#b71c1c" : colors.teal }}>{money(row.balance)}</td>
                        <td className="is-center" style={td}>
                          <span style={{ background: ss.bg, color: ss.fg, padding: "2px 8px", borderRadius: 6, fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" }}>{statusText(row.status)}</span>
                        </td>
                        <td style={{ ...td, maxWidth: 320, fontSize: "0.76rem", color: "var(--k-muted)" }}>{row.paymentSummary || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ ...totalCell, color: "var(--k-blue)" }} colSpan={6}>TOTAL</td>
                    <td className="k-num" style={{ ...tdR, ...totalCell }}>{money(report.grandAmount)}</td>
                    <td className="k-num" style={{ ...tdR, ...totalCell }}>{money(report.grandPaid)}</td>
                    <td className="k-num" style={{ ...tdR, ...totalCell, color: "var(--k-blue)" }}>{money(report.grandBalance)}</td>
                    <td style={totalCell} colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          )}
        </Card>
      )}
    </div>
  );
}

// Build a styled, printable HTML doc for the PDF export (parsed by exportToPdf).
function buildLedgerHtml(report) {
  const money2 = (n) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (s) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
  const esc = (v) => String(v ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
  const statusLabel = report.statusFilter === "paid" ? "Paid" : report.statusFilter === "all" ? "All invoices" : "Outstanding (Unpaid)";
  const rows = report.rows.map((r) => `
    <tr>
      <td class="c">${r.serialNo}</td><td>${esc(r.poNumber)}</td><td class="c">${d(r.deliveryDate)}</td>
      <td class="c">${d(r.invoiceDate)}</td><td class="c">${esc(r.dcNumbers)}</td><td class="c">${esc(r.billNumber)}</td>
      <td class="r">${money2(r.amount)}</td><td class="r">${money2(r.paid)}</td><td class="r b">${money2(r.balance)}</td>
      <td class="c">${esc(r.status === "PartiallyPaid" ? "Partial" : r.status)}</td><td class="pd">${esc(r.paymentSummary)}</td>
    </tr>`).join("");
  return `<!DOCTYPE html><html><head><style>
    body { font-family: Arial, sans-serif; color: #1a2332; }
    .title { text-align:center; font-size:22px; font-weight:800; background:#ebebeb; padding:10px; }
    .sub { text-align:center; font-size:14px; font-weight:700; background:#ebebeb; padding:4px; }
    .meta { text-align:center; font-size:11px; color:#5f6d7e; font-style:italic; margin-bottom:8px; }
    table { border-collapse:collapse; width:100%; font-size:10px; }
    th, td { border:1px solid #d0d7e2; padding:4px 5px; vertical-align:top; }
    th { background:#ebebeb; font-weight:700; text-align:center; }
    td.c { text-align:center; } td.r { text-align:right; white-space:nowrap; } td.b { font-weight:700; }
    td.pd { font-size:8.5px; color:#5f6d7e; }
    tr.total td { background:#eef4ff; font-weight:800; border-top:2px solid #0d47a1; }
  </style></head><body>
    <div class="title">${esc(report.companyName)}</div>
    <div class="sub">Outstanding Ledger — ${esc(report.clientName || "Client")}</div>
    <div class="meta">${statusLabel} &middot; ${report.invoiceCount} invoice(s)</div>
    <table>
      <thead><tr>
        <th>S.No</th><th>P.O #</th><th>Delivery</th><th>Invoice Date</th><th>D.C #</th><th>Bill #</th>
        <th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th><th>Payment Details</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="total"><td colspan="6" style="text-align:right">TOTAL</td>
          <td class="r">${money2(report.grandAmount)}</td><td class="r">${money2(report.grandPaid)}</td>
          <td class="r">${money2(report.grandBalance)}</td><td colspan="2"></td></tr>
      </tbody>
    </table>
  </body></html>`;
}

// Ledger rows top-align (the payment-details cell can wrap to several lines).
const td = { verticalAlign: "top" };
const tdR = { ...td, whiteSpace: "nowrap" };
const totalCell = { fontWeight: 800, background: colors.totalBg, borderTop: `2px solid ${colors.blue}` };

// Segmented control (the kit has none) — built on the kit tokens so it matches
// the control height and palette of whichever theme is active.
const seg = {
  group: { display: "inline-flex", border: "1px solid var(--k-line-strong)", borderRadius: "var(--k-radius)", overflow: "hidden", background: "var(--k-surface)" },
  btn: { border: "none", borderRadius: 0, padding: "0 14px", fontSize: "var(--k-font-sm)", fontWeight: 600, cursor: "pointer", minHeight: "var(--k-h)", boxShadow: "none", whiteSpace: "nowrap" },
  on: { background: "var(--k-blue)", color: "#fff" },
  off: { background: "transparent", color: "var(--k-muted)" },
};

const card = {
  box: { border: "1px solid var(--k-line)", borderRadius: "var(--k-radius)", padding: "0.7rem 0.8rem", background: "var(--k-surface)", display: "flex", flexDirection: "column", gap: 3 },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  meta: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(90px, 100%), 1fr))", gap: "0.35rem 0.7rem", marginTop: 4 },
  lbl: { display: "block", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--k-muted)" },
  val: { display: "block", fontSize: "var(--k-td-font)", fontWeight: 600, color: "var(--k-ink)", fontVariantNumeric: "tabular-nums" },
};
