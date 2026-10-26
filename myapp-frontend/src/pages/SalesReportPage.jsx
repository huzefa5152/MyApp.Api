import { useState, useEffect, useCallback, Fragment } from "react";
import { MdAssessment, MdBusiness, MdRefresh, MdDownload, MdChevronRight, MdExpandMore, MdUnfoldMore, MdUnfoldLess } from "react-icons/md";
import { getSalesReport, getSalesReportExcel } from "../api/reportApi";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import useIsNarrow from "../hooks/useIsNarrow";
import ListFilters from "../Components/ListFilters";
import RecordsViewport from "../Components/RecordsViewport";
import ColumnPicker, { useHiddenColumns } from "../Components/reports/ColumnPicker";
import { CompanyPicker, Dot, PrintPdfButtons, ReportBar, ReportKpis } from "../Components/reports/ReportChrome";
import { fileSlug, pdfReport, printReport } from "../utils/reportPrintKit";
import { excelBrandParams } from "../utils/reportExcelBrand";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  rowAlt: "#fafbfd",
  bandBg: "#f0f7ff",
  totalBg: "#eef4ff",
};

// Invoice-level columns of the on-screen table, in order. `total` marks a
// column with a grand total; the user can hide any of them.
const SR_COLS = [
  { key: "doc", label: "Doc. No" },
  { key: "date", label: "Date" },
  { key: "fbr", label: "FBR Inv. No." },
  { key: "customer", label: "Customer" },
  { key: "hs", label: "HS Code" },
  { key: "items", label: "Items", format: "int", total: true },
  { key: "qty", label: "Qty", format: "number", total: true },
  { key: "amount", label: "Amount", format: "money", total: true },
  { key: "tax", label: "Tax", format: "money", total: true },
  { key: "total", label: "Total", format: "money", total: true },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BUYER_TYPES = [
  { value: "unregistered", label: "Walk-in / Unregistered" },
  { value: "registered", label: "Registered" },
  { value: "all", label: "All buyers" },
];

// A tax year's worth of picker years around "now" (client clock is fine —
// this is just the selector range, the server does the real filtering).
const NOW = new Date();
const YEARS = Array.from({ length: 6 }, (_, i) => NOW.getFullYear() - i);

const money = (n) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
};
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const prettyDate = (s) => {
  const [y, m, d] = (s || "").split("-");
  return d ? `${d}-${m}-${y}` : s;
};

export default function SalesReportPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("reports.sales.view");
  const canExport = has("reports.sales.export");
  const isNarrow = useIsNarrow();
  const [hiddenCols, setHiddenCols] = useHiddenColumns("sales-report");
  const [printBusy, setPrintBusy] = useState(null);

  // Period mode: "period" (month / year) or "custom" (date range).
  const [mode, setMode] = useState("period");
  const [year, setYear] = useState(NOW.getFullYear());
  const [month, setMonth] = useState(NOW.getMonth() + 1); // 1–12
  const [fullYear, setFullYear] = useState(false);
  const [dateFrom, setDateFrom] = useState(ymd(new Date(NOW.getFullYear(), NOW.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(ymd(NOW));
  const [buyerType, setBuyerType] = useState("all");

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Single source of truth for the query params — used by both the on-screen
  // fetch and the Excel export so they always agree.
  const buildParams = useCallback(() => {
    const p = { buyerType };
    if (mode === "custom") {
      p.dateFrom = dateFrom;
      p.dateTo = dateTo;
    } else {
      p.year = year;
      if (!fullYear) p.month = month;
    }
    return p;
  }, [mode, buyerType, dateFrom, dateTo, year, month, fullYear]);

  const rangeInvalid = mode === "custom" && dateFrom && dateTo && dateFrom > dateTo;

  const fetchReport = useCallback(async () => {
    if (!selectedCompany || !canView) return;
    if (mode === "custom" && (!dateFrom || !dateTo)) return;
    if (mode === "custom" && dateFrom > dateTo) {
      setError("Start date must be on or before the end date.");
      setReport(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data } = await getSalesReport(selectedCompany.id, buildParams());
      setReport(data);
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to load the sales report.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, canView, mode, dateFrom, dateTo, buildParams]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const periodLabel = mode === "custom"
    ? `${prettyDate(dateFrom)} – ${prettyDate(dateTo)}`
    : fullYear ? `Year ${year}` : `${MONTHS[month - 1]} ${year}`;

  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    if (!selectedCompany || rangeInvalid) return;
    setExporting(true);
    try {
      // The workbook carries the company's letterhead and template colours.
      const { data } = await getSalesReportExcel(selectedCompany.id, { ...buildParams(), ...(await excelBrandParams(selectedCompany)) });
      const url = URL.createObjectURL(new Blob([data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Sale-Report-${(report?.companyName || "company")}-${periodLabel}.xlsx`.replace(/\s+/g, "_");
      a.click();
      URL.revokeObjectURL(url);
      notify.success("Excel exported.");
    } catch {
      notify.error("Failed to export the Excel file.");
    } finally {
      setExporting(false);
    }
  };

  // Which invoices (by Doc No) are expanded to show their line items.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleInv = (key) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  const expandAll = () => setExpanded(new Set((report?.invoices || []).map((i) => i.documentNumber)));
  const collapseAll = () => setExpanded(new Set());

  if (!canView) {
    return <div style={{ padding: 24, color: colors.textSecondary }}>You don't have permission to view reports.</div>;
  }

  const visibleCols = SR_COLS.filter((c) => !hiddenCols.has(c.key));
  const cols = visibleCols.length ? visibleCols : SR_COLS;
  const buyerLabel = BUYER_TYPES.find((b) => b.value === (report?.buyerType || buyerType))?.label || buyerType;

  // The report as printed: the same rows and totals the table shows, in the
  // columns the user chose, on the company's own letterhead.
  const envelope = () => ({
    title: "Sales Report",
    companyName: report.companyName,
    periodLabel,
    generatedAt: new Date().toISOString(),
    filtersApplied: [buyerLabel],
    sourceLabel: "FBR-submitted invoices · quantities as filed to FBR",
    columns: cols.map((c) => ({ key: c.key, label: c.label, format: c.format || "text", totalled: !!c.total })),
    rows: report.invoices.map((inv) => ({
      doc: inv.documentNumber,
      date: new Date(inv.documentDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      fbr: inv.fbrInvoiceNumber || "",
      customer: inv.customer,
      hs: [...new Set(inv.lines.map((l) => l.hsCode).filter(Boolean))].join(", "),
      items: inv.lineCount, qty: inv.totalQuantity, amount: inv.totalAmount, tax: inv.totalTax, total: inv.totalGross,
    })),
    totals: { items: report.lineCount, qty: report.grandQuantity, amount: report.grandAmount, tax: report.grandTax, total: report.grandTotal },
  });
  const doPrint = async () => {
    setPrintBusy("print");
    try { await printReport(envelope(), selectedCompany); }
    catch { notify.error("Could not prepare the report. Allow print pop-ups and try again."); }
    finally { setPrintBusy(null); }
  };
  const doPdf = async () => {
    setPrintBusy("pdf");
    try { await pdfReport(envelope(), selectedCompany, fileSlug(`Sales-Report-${periodLabel}`)); }
    catch { notify.error("Could not build the PDF."); }
    finally { setPrintBusy(null); }
  };

  const cell = (inv, key, hsCodes) => {
    switch (key) {
      case "doc": return <td key={key} className="rw-nowrap" style={{ fontWeight: 700, color: colors.blue }}>{inv.documentNumber}</td>;
      case "date": return <td key={key} className="rw-nowrap">{new Date(inv.documentDate).toLocaleDateString()}</td>;
      case "fbr": return <td key={key} className="rw-code">{inv.fbrInvoiceNumber}</td>;
      case "customer": return <td key={key} className="rw-text"><span className="rw-clamp">{inv.customer}</span></td>;
      case "hs": return <td key={key} className="rw-code" style={{ whiteSpace: "normal", maxWidth: 160 }}><span className="rw-clamp">{hsCodes}</span></td>;
      case "items": return <td key={key} className="rw-num">{inv.lineCount}</td>;
      case "qty": return <td key={key} className="rw-num">{qty(inv.totalQuantity)}</td>;
      case "amount": return <td key={key} className="rw-num">{money(inv.totalAmount)}</td>;
      case "tax": return <td key={key} className="rw-num">{money(inv.totalTax)}</td>;
      case "total": return <td key={key} className="rw-num rw-strong">{money(inv.totalGross)}</td>;
      default: return <td key={key} />;
    }
  };
  const totalCell = (key, idx) => {
    const v = { items: report.lineCount, qty: qty(report.grandQuantity), amount: money(report.grandAmount),
      tax: money(report.grandTax), total: money(report.grandTotal) }[key];
    if (v !== undefined) return <td key={key} className="rw-num">{v}</td>;
    return <td key={key}>{idx === 0 ? "Total (all invoices)" : ""}</td>;
  };

  return (
    <div className="rw">
      <ReportBar
        icon={<MdAssessment size={20} />}
        crumb="Reports"
        title="Sales Report"
        meta={<>
          {report?.companyName && <strong>{report.companyName}</strong>}
          <Dot>{periodLabel}</Dot>
          <Dot>{buyerLabel}</Dot>
          <Dot>FBR-submitted · quantities as filed</Dot>
        </>}
        actions={<>
          <CompanyPicker icon={<MdBusiness size={18} />} companies={companies} selectedCompany={selectedCompany} onChange={setSelectedCompany} />
          <button type="button" className="rw-btn" onClick={fetchReport} disabled={loading || rangeInvalid} title="Reload the report">
            <MdRefresh size={17} /><span>{loading ? "Loading…" : "Refresh"}</span>
          </button>
          {report && <ColumnPicker columns={SR_COLS} hidden={hiddenCols} onChange={setHiddenCols} />}
          {canExport && (
            <button type="button" className="rw-btn" onClick={exportExcel} disabled={!report || loading || exporting || rangeInvalid}>
              <MdDownload size={17} /><span>{exporting ? "Exporting…" : "Excel"}</span>
            </button>
          )}
          <PrintPdfButtons onPrint={doPrint} onPdf={doPdf} busy={printBusy} disabled={!report || loading || !report.invoices.length} />
        </>}
      />

      {/* Controls */}
      <ListFilters><div className="rw-filters" style={{
        display: "flex", flexWrap: "wrap", gap: "8px 10px", alignItems: "flex-end",
        background: "#fff", border: `1px solid ${colors.cardBorder}`,
      }}>
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
              <select
                style={{ ...dropdownStyles.base, opacity: fullYear ? 0.5 : 1 }}
                value={month}
                disabled={fullYear}
                onChange={(e) => setMonth(parseInt(e.target.value))}
              >
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
              <input
                type="date"
                style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: "#dc2626" } : {}) }}
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: "#dc2626" } : {}) }}
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </Field>
          </>
        )}

        <Field label="Buyer type">
          <select style={dropdownStyles.base} value={buyerType} onChange={(e) => setBuyerType(e.target.value)}>
            {BUYER_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </Field>

      </div></ListFilters>

      {error && <div className="rw-notice rw-notice--warn" role="alert">{error}</div>}

      {report && !loading && (
        <ReportKpis items={[
          { label: "Invoices", value: report.invoiceCount },
          { label: "Lines", value: report.lineCount },
          { label: "Quantity", value: qty(report.grandQuantity) },
          { label: "Amount", value: money(report.grandAmount) },
          { label: "Sales tax", value: money(report.grandTax) },
          { label: "Total", value: money(report.grandTotal), tone: "lead" },
        ]} />
      )}

      {report && !loading && report.invoices.length > 0 && (
        <div className="rw-section-head">
          <span>{report.invoiceCount} invoice{report.invoiceCount === 1 ? "" : "s"} · click a row to see its items</span>
          <span style={{ display: "flex", gap: 6 }}>
            <button type="button" className="rw-btn" onClick={expandAll}><MdUnfoldMore size={16} /><span>Expand all</span></button>
            <button type="button" className="rw-btn" onClick={collapseAll}><MdUnfoldLess size={16} /><span>Collapse all</span></button>
          </span>
        </div>
      )}

      {/* Report body */}
      <RecordsViewport label="Sales Report records" enabled={!isNarrow}>{loading ? (
        <div className="rw-state" role="status">Loading report…</div>
      ) : report && (
        report.invoices.length === 0 ? (
          <div className="rw-state">No FBR-submitted sales for {periodLabel}.</div>
        ) : isNarrow ? (
          <div className="rw-cards">
            {report.invoices.map((inv) => {
              const open = expanded.has(inv.documentNumber);
              const hsCodes = [...new Set(inv.lines.map((l) => l.hsCode).filter(Boolean))].join(", ");
              return (
                <div key={inv.documentNumber} className="rw-card" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <button type="button" onClick={() => toggleInv(inv.documentNumber)} style={srCardHead}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: colors.blue }}>
                      {open ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}
                      {inv.documentNumber}
                    </span>
                    <span style={{ fontSize: "0.76rem", color: colors.textSecondary }}>{new Date(inv.documentDate).toLocaleDateString()}</span>
                  </button>
                  <div style={{ fontSize: "0.86rem", fontWeight: 600, color: colors.textPrimary, ...clamp2 }}>{inv.customer}</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: colors.textSecondary, ...clamp2 }}>FBR {inv.fbrInvoiceNumber || "—"}{hsCodes ? ` · HS ${hsCodes}` : ""}</div>
                  <div style={srMeta}>
                    <div><span style={srLbl}>Items</span><span style={srVal}>{inv.lineCount}</span></div>
                    <div><span style={srLbl}>Qty</span><span style={srVal}>{qty(inv.totalQuantity)}</span></div>
                    <div><span style={srLbl}>Amount</span><span style={srVal}>{money(inv.totalAmount)}</span></div>
                    <div><span style={srLbl}>Tax</span><span style={srVal}>{money(inv.totalTax)}</span></div>
                    <div><span style={srLbl}>Total</span><span style={{ ...srVal, fontWeight: 700, color: colors.blue }}>{money(inv.totalGross)}</span></div>
                  </div>
                  {open && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${colors.cardBorder}` }}>
                      {inv.lines.map((l, idx) => (
                        <div key={idx} style={srLine}>
                          <div style={{ fontSize: "0.82rem", fontWeight: 600, ...clamp2 }}>{l.sr}. {l.product}</div>
                          <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: colors.textSecondary }}>HS {l.hsCode || "—"}</div>
                          <div style={srLineMeta}>
                            <span>{qty(l.quantity)} {l.unit}</span>
                            <span>@ {money(l.rate)}</span>
                            <span>Tax {money(l.taxAmount)}</span>
                            <span style={{ fontWeight: 700, color: colors.blue }}>{money(l.totalAmount)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div data-admin-table-region="" className="rw-table-wrap">
            <table className="rw-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ width: 30 }} aria-label="Expand" />
                  {cols.map((c) => <th key={c.key} className={c.total || c.num ? "rw-num" : undefined}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.invoices.map((inv) => {
                  const open = expanded.has(inv.documentNumber);
                  // Distinct HS codes on this invoice: one if all lines share
                  // it, otherwise comma-separated.
                  const hsCodes = [...new Set(inv.lines.map((l) => l.hsCode).filter(Boolean))].join(", ");
                  return (
                    <Fragment key={inv.documentNumber}>
                      {/* Invoice summary row — click to expand its items */}
                      <tr onClick={() => toggleInv(inv.documentNumber)} style={{ cursor: "pointer" }} className={open ? "sr-open" : undefined}>
                        <td style={{ color: colors.blue, width: 30 }}>
                          {open ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}
                        </td>
                        {cols.map((c) => cell(inv, c.key, hsCodes))}
                      </tr>
                      {/* Expanded line items */}
                      {open && (
                        <tr className="sr-lines">
                          <td colSpan={cols.length + 1} style={{ padding: 0 }}>
                            <div style={{ overflowX: "auto", padding: "4px 8px 10px 38px", background: "#f6f9fd" }}>
                              <table className="rw-table" style={{ minWidth: 640, background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 8 }}>
                                <thead>
                                  <tr>
                                    {["Sr.", "HS Code", "Product", "Qty", "Unit", "Rate", "Amount", "Dis Amt", "Tax Amt", "Total"].map((h, i) => (
                                      <th key={i} style={{ position: "static", background: "#eef3fa" }} className={i >= 3 && i !== 4 ? "rw-num" : undefined}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {inv.lines.map((l, idx) => (
                                    <tr key={idx}>
                                      <td>{l.sr}</td>
                                      <td className="rw-code">{l.hsCode}</td>
                                      <td className="rw-text"><span className="rw-clamp">{l.product}</span></td>
                                      <td className="rw-num">{qty(l.quantity)}</td>
                                      <td className="rw-nowrap">{l.unit}</td>
                                      <td className="rw-num">{money(l.rate)}</td>
                                      <td className="rw-num">{money(l.amount)}</td>
                                      <td className="rw-num">{money(l.discountAmount)}</td>
                                      <td className="rw-num">{money(l.taxAmount)}</td>
                                      <td className="rw-num rw-strong">{money(l.totalAmount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              {/* Grand total across all invoices */}
              <tfoot>
                <tr>
                  <td />
                  {cols.map((c, i) => totalCell(c.key, i))}
                </tr>
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

const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

// Mobile card styles — phones get stacked, tappable invoice cards (no
// horizontal scroll) instead of the wide table.
const srCardHead = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, boxShadow: "none", cursor: "pointer", width: "100%", textAlign: "left" };
const srMeta = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(90px, 100%), 1fr))", gap: "0.35rem 0.7rem", marginTop: 4 };
const srLbl = { display: "block", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary };
const srVal = { display: "block", fontSize: "0.84rem", fontWeight: 600, color: colors.textPrimary };
const srLine = { background: colors.rowAlt, borderRadius: 8, padding: "0.5rem 0.6rem", display: "flex", flexDirection: "column", gap: 2 };
const srLineMeta = { display: "flex", flexWrap: "wrap", gap: "0.3rem 0.7rem", fontSize: "0.78rem", color: colors.textSecondary, marginTop: 2 };

// Segmented-control button — active segment filled blue, inactive plain.
const segBtn = (active) => ({
  border: "none",
  background: active ? colors.blue : "transparent",
  color: active ? "#fff" : colors.textSecondary,
  padding: "9px 14px",
  fontSize: "0.82rem",
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 40,
  whiteSpace: "nowrap",
});
