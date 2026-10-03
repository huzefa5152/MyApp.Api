import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { MdAssessment, MdRefresh, MdDownload, MdChevronRight, MdExpandMore, MdUnfoldMore, MdUnfoldLess, MdPerson, MdPictureAsPdf, MdFolderZip, MdClose } from "react-icons/md";
import { getSalesReport, getSalesReportExcel } from "../api/reportApi";
import { getInvoicePrintTaxInvoiceBatch } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { formStyles, modalSizes } from "../theme";
import { PageHeader, CompanyPicker, Button, IconButton, Card, Field, TableWrap, EmptyState, Loading, Alert } from "../ui/Kit";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import { mergeTemplate } from "../utils/templateEngine";
import { defaultTaxInvoiceTemplate } from "../utils/defaultTemplates";
import { exportToPdf, renderPdfBlob, buildMergedPrintDocument, printHtmlDocument } from "../utils/exportUtils";
import { saveAs } from "file-saver";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import useIsNarrow from "../hooks/useIsNarrow";

// The server caps one batch print-data request at 100 ids, so longer periods
// are fetched in successive chunks.
const PRINT_BATCH_SIZE = 100;

// ZIP builds one rasterized PDF per invoice at ~1-2s each, so it's capped.
// Merged print has no such limit — it never rasterizes.
const ZIP_MAX_INVOICES = 150;

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
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("reports.sales.view");
  const canExport = has("reports.sales.export");
  const canPrintInvoice = has("reports.sales.printinvoice");
  const isNarrow = useIsNarrow();

  // Period mode: "period" (month / year) or "custom" (date range).
  const [mode, setMode] = useState("period");
  const [year, setYear] = useState(NOW.getFullYear());
  const [month, setMonth] = useState(NOW.getMonth() + 1); // 1–12
  const [fullYear, setFullYear] = useState(false);
  const [dateFrom, setDateFrom] = useState(ymd(new Date(NOW.getFullYear(), NOW.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(ymd(NOW));
  const [buyerType, setBuyerType] = useState("all");
  const [clientId, setClientId] = useState(""); // "" = all clients
  const [clients, setClients] = useState([]);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load the company's clients for the filter; reset the filter on switch.
  useEffect(() => {
    if (!selectedCompany) { setClients([]); return; }
    setClientId("");
    getClientsByCompany(selectedCompany.id)
      .then((res) => setClients(res.data || []))
      .catch(() => setClients([]));
  }, [selectedCompany?.id]);

  // Single source of truth for the query params — used by both the on-screen
  // fetch and the Excel export so they always agree (client filter included).
  const buildParams = useCallback(() => {
    const p = { buyerType };
    if (mode === "custom") {
      p.dateFrom = dateFrom;
      p.dateTo = dateTo;
    } else {
      p.year = year;
      if (!fullYear) p.month = month;
    }
    if (clientId) p.clientId = clientId;
    return p;
  }, [mode, buyerType, dateFrom, dateTo, year, month, fullYear, clientId]);

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
      const { data } = await getSalesReportExcel(selectedCompany.id, buildParams());
      const url = URL.createObjectURL(new Blob([data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Sale-Report-${(report?.companyName || "company")}-${periodLabel}.xlsx`.replace(/\s+/g, "_");
      a.click();
      URL.revokeObjectURL(url);
      notify("Excel exported.", "success");
    } catch {
      notify("Failed to export the Excel file.", "error");
    } finally {
      setExporting(false);
    }
  };

  // ── Tax Invoice PDF download ───────────────────────────────────────────
  // Same three steps the Invoices page uses (InvoicePage.jsx:handleExportTaxPdf):
  // fetch print data → merge through the company's TaxInvoice template →
  // render. Sharing the template means a PDF pulled from the report is
  // identical to one pulled from the Invoices page.
  const tplPicker = usePrintTemplates("TaxInvoice");
  const [rowBusyId, setRowBusyId] = useState(null);
  const [bulk, setBulk] = useState(null);   // { mode, done, total, phase }
  const cancelRef = useRef(false);

  const resolveTaxTemplate = useCallback(
    () => tplPicker.resolveTemplate()?.htmlContent || defaultTaxInvoiceTemplate,
    [tplPicker]
  );

  const pdfName = (d) => `INVOICE # ${d.invoiceNumber} ${d.buyerName || d.companyBrandName || ""}`.trim();

  // Print data for many invoices, chunked to the server's per-request cap.
  // `onProgress` reports invoices fetched so far so the modal can move during
  // what is otherwise a silent wait.
  const fetchPrintData = useCallback(async (ids, onProgress) => {
    const out = [];
    for (let i = 0; i < ids.length; i += PRINT_BATCH_SIZE) {
      if (cancelRef.current) break;
      const { data } = await getInvoicePrintTaxInvoiceBatch(ids.slice(i, i + PRINT_BATCH_SIZE));
      out.push(...(data || []));
      onProgress?.(out.length);
    }
    return out;
  }, []);

  const handleRowPdf = async (inv) => {
    if (rowBusyId || bulk) return;
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    setRowBusyId(inv.invoiceId);
    try {
      const [data] = await fetchPrintData([inv.invoiceId]);
      if (!data) throw new Error("no print data");
      await exportToPdf(mergeTemplate(resolveTaxTemplate(), data), pdfName(data));
    } catch {
      notify("Failed to download the Tax Invoice PDF.", "error");
    } finally {
      setRowBusyId(null);
    }
  };

  const invoiceIds = (report?.invoices || []).map((i) => i.invoiceId).filter(Boolean);

  const startBulk = (mode, total) => { cancelRef.current = false; setBulk({ mode, done: 0, total, phase: "Fetching invoice data…" }); };
  const endBulk = () => { cancelRef.current = false; setBulk(null); };

  // Merged: one A4 document, one invoice per page, handed to the browser's
  // print engine. No rasterization, so this stays fast for a full year.
  const handleBulkMerged = async () => {
    if (bulk || rowBusyId || !invoiceIds.length) return;
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    startBulk("merged", invoiceIds.length);
    try {
      const rows = await fetchPrintData(invoiceIds, (n) => setBulk((b) => (b ? { ...b, done: n } : b)));
      if (cancelRef.current) { endBulk(); return; }
      if (!rows.length) { notify("No printable invoices in this period.", "warning"); endBulk(); return; }

      setBulk((b) => (b ? { ...b, phase: "Building the document…", done: b.total } : b));
      const tpl = resolveTaxTemplate();
      const merged = buildMergedPrintDocument(
        rows.map((d) => mergeTemplate(tpl, d)),
        `Tax Invoices — ${periodLabel}`
      );
      setBulk((b) => (b ? { ...b, phase: "Opening the print dialog…" } : b));
      await printHtmlDocument(merged);
      notify(`${rows.length} Tax Invoice(s) sent to print. Choose "Save as PDF" to keep a file.`, "success");
    } catch {
      notify("Failed to build the merged Tax Invoice PDF.", "error");
    } finally {
      endBulk();
    }
  };

  // ZIP: one PDF file per invoice. Rasterized, so it's slow and capped.
  const handleBulkZip = async () => {
    if (bulk || rowBusyId || !invoiceIds.length) return;
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    if (invoiceIds.length > ZIP_MAX_INVOICES) {
      notify(`ZIP is limited to ${ZIP_MAX_INVOICES} invoices (this period has ${invoiceIds.length}). Narrow the period, or use Merged PDF.`, "warning");
      return;
    }
    const mins = Math.max(1, Math.round((invoiceIds.length * 1.5) / 60));
    if (!window.confirm(`Build ${invoiceIds.length} individual PDF(s)? This renders each invoice separately and takes roughly ${mins} minute(s). You can cancel while it runs.`)) return;

    startBulk("zip", invoiceIds.length);
    try {
      const rows = await fetchPrintData(invoiceIds, (n) => setBulk((b) => (b ? { ...b, done: 0, phase: `Fetching invoice data… (${n}/${invoiceIds.length})` } : b)));
      if (cancelRef.current) { endBulk(); return; }

      // jszip is only ever needed by this one action — keep it out of the main bundle.
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const tpl = resolveTaxTemplate();
      let failed = 0;

      for (let i = 0; i < rows.length; i++) {
        if (cancelRef.current) break;
        setBulk((b) => (b ? { ...b, done: i, phase: "Rendering PDFs…" } : b));
        try {
          const blob = await renderPdfBlob(mergeTemplate(tpl, rows[i]));
          // Slashes in a client name would create folders inside the archive.
          zip.file(`${pdfName(rows[i]).replace(/[\\/:*?"<>|]/g, "-")}.pdf`, blob);
        } catch { failed++; }
      }

      if (cancelRef.current) { notify("Cancelled — no file was saved.", "warning"); endBulk(); return; }

      setBulk((b) => (b ? { ...b, done: b.total, phase: "Compressing…" } : b));
      const archive = await zip.generateAsync({ type: "blob" });
      saveAs(archive, `Tax-Invoices-${periodLabel}.zip`.replace(/\s+/g, "_"));
      notify(failed ? `ZIP saved — ${failed} invoice(s) failed to render.` : "ZIP saved.", failed ? "warning" : "success");
    } catch {
      notify("Failed to build the ZIP.", "error");
    } finally {
      endBulk();
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
    return <EmptyState icon={MdAssessment}>You don't have permission to view reports.</EmptyState>;
  }

  return (
    <div>
      <PageHeader
        icon={MdAssessment}
        tone="blue"
        title="Sales Report"
        subtitle={<>FBR-submitted invoices, grouped by document date. Quantities shown are what was <strong>filed to FBR</strong>.</>}
      />

      <CompanyPicker />

      {/* Controls */}
      <Card style={{ marginBottom: "var(--k-gap)" }}>
        <div style={controlsRow}>
          <Field label="Period">
            <div role="group" aria-label="Period mode" style={segWrap}>
              <button type="button" onClick={() => setMode("period")} aria-pressed={mode === "period"} style={segBtn(mode === "period")}>Month / Year</button>
              <button type="button" onClick={() => setMode("custom")} aria-pressed={mode === "custom"} style={segBtn(mode === "custom")}>Custom range</button>
            </div>
          </Field>

          {mode === "period" ? (
            <>
              <Field label="Year">
                <select className="k-select" style={ctlAuto} value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
                  {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </Field>
              <Field label="Month">
                <select
                  className="k-select"
                  style={{ ...ctlAuto, opacity: fullYear ? 0.5 : 1 }}
                  value={month}
                  disabled={fullYear}
                  onChange={(e) => setMonth(parseInt(e.target.value))}
                >
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <label style={checkLabel}>
                <input type="checkbox" checked={fullYear} onChange={(e) => setFullYear(e.target.checked)} />
                Full year
              </label>
            </>
          ) : (
            <>
              <Field label="From">
                <input
                  type="date"
                  className="k-input"
                  style={{ ...ctlAuto, ...(rangeInvalid ? { borderColor: "var(--k-danger)" } : {}) }}
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </Field>
              <Field label="To">
                <input
                  type="date"
                  className="k-input"
                  style={{ ...ctlAuto, ...(rangeInvalid ? { borderColor: "var(--k-danger)" } : {}) }}
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="Buyer type">
            <select className="k-select" style={ctlAuto} value={buyerType} onChange={(e) => setBuyerType(e.target.value)}>
              {BUYER_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </Field>

          <Field label={<><MdPerson size={15} aria-hidden="true" style={{ verticalAlign: "-3px" }} /> Client</>}>
            <SearchableClientSelect
              clients={clients}
              value={clientId}
              onChange={(id) => setClientId(id)}
              placeholder="All clients"
              style={{ minWidth: 180, maxWidth: 240 }}
            />
          </Field>

          {canPrintInvoice && (
            <Field label="Invoice template">
              <PrintTemplateSelect picker={tplPicker} style={{ flex: 1, maxWidth: 260 }} />
            </Field>
          )}

          <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto", flexWrap: "wrap" }}>
            <Button variant="primary" icon={MdRefresh} onClick={fetchReport} disabled={loading || rangeInvalid}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
            {canExport && (
              <Button variant="teal" icon={MdDownload} onClick={exportExcel} disabled={!report || loading || exporting || rangeInvalid}>
                {exporting ? "Exporting…" : "Export Excel"}
              </Button>
            )}
            {canPrintInvoice && (
              <>
                <Button
                  variant="secondary"
                  icon={MdPictureAsPdf}
                  onClick={handleBulkMerged}
                  disabled={!invoiceIds.length || loading || !!bulk || rangeInvalid || tplPicker.noTemplate}
                  title={`Print every Tax Invoice in this period as one A4 document — choose "Save as PDF" in the dialog`}
                >
                  Tax Invoices (merged)
                </Button>
                <Button
                  variant="secondary"
                  icon={MdFolderZip}
                  onClick={handleBulkZip}
                  disabled={!invoiceIds.length || loading || !!bulk || rangeInvalid || tplPicker.noTemplate}
                  title={`Download one PDF per invoice, zipped (max ${ZIP_MAX_INVOICES})`}
                >
                  ZIP of PDFs
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      {/* Report body */}
      {report && !loading && (
        <Card
          flush
          style={{ overflow: "hidden" }}
          title={report.companyName}
          actions={report.invoices.length > 0 ? (
            <>
              <Button variant="ghost" size="sm" icon={MdUnfoldMore} onClick={expandAll}>Expand all</Button>
              <Button variant="ghost" size="sm" icon={MdUnfoldLess} onClick={collapseAll}>Collapse all</Button>
            </>
          ) : null}
        >
          <div style={reportMeta}>
            Sale Report · {periodLabel} · {BUYER_TYPES.find((b) => b.value === report.buyerType)?.label || report.buyerType}
            {" · "}{report.invoiceCount} invoice(s), {report.lineCount} line(s)
          </div>

          {report.invoices.length === 0 ? (
            <EmptyState boxed={false}>
              No FBR-submitted sales for {periodLabel}.
            </EmptyState>
          ) : isNarrow ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", padding: "0.6rem" }}>
              {report.invoices.map((inv) => {
                const open = expanded.has(inv.documentNumber);
                const hsCodes = [...new Set(inv.lines.map((l) => l.hsCode).filter(Boolean))].join(", ");
                return (
                  <div key={inv.documentNumber} style={srCard}>
                    <button type="button" onClick={() => toggleInv(inv.documentNumber)} style={srCardHead}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: "var(--k-blue)" }}>
                        {open ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}
                        {inv.documentNumber}
                      </span>
                      <span style={{ fontSize: "0.76rem", color: "var(--k-muted)" }}>{new Date(inv.documentDate).toLocaleDateString()}</span>
                    </button>
                    {canPrintInvoice && (
                      <Button
                        size="sm"
                        icon={MdPictureAsPdf}
                        onClick={() => handleRowPdf(inv)}
                        disabled={!!rowBusyId || !!bulk || tplPicker.noTemplate}
                        title="Download this Tax Invoice as PDF"
                        aria-label={`Download Tax Invoice ${inv.documentNumber} as PDF`}
                        style={{ alignSelf: "flex-start", color: pdfRed, minHeight: 44 }}
                      >
                        {rowBusyId === inv.invoiceId ? "Preparing…" : "Tax Invoice PDF"}
                      </Button>
                    )}
                    <div style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--k-ink)", ...clamp2 }}>{inv.customer}</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--k-muted)", ...clamp2 }}>FBR {inv.fbrInvoiceNumber || "—"}{hsCodes ? ` · HS ${hsCodes}` : ""}</div>
                    <div style={srMeta}>
                      <div><span style={srLbl}>Items</span><span style={srVal}>{inv.lineCount}</span></div>
                      <div><span style={srLbl}>Qty</span><span style={srVal}>{qty(inv.totalQuantity)}</span></div>
                      <div><span style={srLbl}>Amount</span><span style={srVal}>{money(inv.totalAmount)}</span></div>
                      <div><span style={srLbl}>Tax</span><span style={srVal}>{money(inv.totalTax)}</span></div>
                      <div><span style={srLbl}>Total</span><span style={{ ...srVal, fontWeight: 700, color: "var(--k-blue)" }}>{money(inv.totalGross)}</span></div>
                    </div>
                    {open && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--k-line)" }}>
                        {inv.lines.map((l, idx) => (
                          <div key={idx} style={srLine}>
                            <div style={{ fontSize: "0.82rem", fontWeight: 600, ...clamp2 }}>{l.sr}. {l.product}</div>
                            <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--k-muted)" }}>HS {l.hsCode || "—"}</div>
                            <div style={srLineMeta}>
                              <span>{qty(l.quantity)} {l.unit}</span>
                              <span>@ {money(l.rate)}</span>
                              <span>Tax {money(l.taxAmount)}</span>
                              <span style={{ fontWeight: 700, color: "var(--k-blue)" }}>{money(l.totalAmount)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ ...srCard, background: totalBg, borderColor: "var(--k-blue)" }}>
                <div style={{ fontWeight: 800, color: "var(--k-blue)", marginBottom: 4 }}>TOTAL ({report.lineCount} lines)</div>
                <div style={srMeta}>
                  <div><span style={srLbl}>Qty</span><span style={{ ...srVal, fontWeight: 800 }}>{qty(report.grandQuantity)}</span></div>
                  <div><span style={srLbl}>Amount</span><span style={{ ...srVal, fontWeight: 800 }}>{money(report.grandAmount)}</span></div>
                  <div><span style={srLbl}>Tax</span><span style={{ ...srVal, fontWeight: 800 }}>{money(report.grandTax)}</span></div>
                  <div><span style={srLbl}>Total</span><span style={{ ...srVal, fontWeight: 800, color: "var(--k-blue)" }}>{money(report.grandTotal)}</span></div>
                </div>
              </div>
            </div>
          ) : (
            <TableWrap>
              <table className="k-table" style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    {["", "Doc. No", "Date", "FBR Inv. No.", "Customer", "HS Code", "Items", "Qty", "Amount", "Tax", "Total"].map((h, i) => (
                      <th key={i} className={i >= 6 ? "k-num" : undefined}>{h}</th>
                    ))}
                    {canPrintInvoice && <th className="is-center">PDF</th>}
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
                        <tr
                          onClick={() => toggleInv(inv.documentNumber)}
                          style={{ cursor: "pointer", background: open ? bandBg : undefined }}
                        >
                          <td style={{ width: 30, color: "var(--k-blue)" }}>
                            {open ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}
                          </td>
                          <td style={{ fontWeight: 700, color: "var(--k-blue)" }}>{inv.documentNumber}</td>
                          <td>{new Date(inv.documentDate).toLocaleDateString()}</td>
                          <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{inv.fbrInvoiceNumber}</td>
                          <td style={{ maxWidth: 220 }}><div style={clamp2}>{inv.customer}</div></td>
                          <td style={{ fontFamily: "monospace", fontSize: "0.75rem", maxWidth: 160 }}><div style={clamp2}>{hsCodes}</div></td>
                          <td className="k-num">{inv.lineCount}</td>
                          <td className="k-num" style={nowrap}>{qty(inv.totalQuantity)}</td>
                          <td className="k-num" style={nowrap}>{money(inv.totalAmount)}</td>
                          <td className="k-num" style={nowrap}>{money(inv.totalTax)}</td>
                          <td className="k-num" style={{ ...nowrap, fontWeight: 700 }}>{money(inv.totalGross)}</td>
                          {canPrintInvoice && (
                            <td className="is-center">
                              <IconButton
                                label="Download this Tax Invoice as PDF"
                                aria-label={`Download Tax Invoice ${inv.documentNumber} as PDF`}
                                icon={MdPictureAsPdf}
                                // The row itself toggles expansion — don't let the
                                // download also collapse/expand the line items.
                                onClick={(e) => { e.stopPropagation(); handleRowPdf(inv); }}
                                disabled={!!rowBusyId || !!bulk || tplPicker.noTemplate}
                                style={{ color: pdfRed, border: "1px solid var(--k-line-strong)" }}
                              />
                            </td>
                          )}
                        </tr>
                        {/* Expanded line items */}
                        {open && (
                          <tr>
                            <td colSpan={canPrintInvoice ? 12 : 11} style={{ padding: 0, background: "var(--k-surface-2)" }}>
                              <div style={{ overflowX: "auto", padding: "4px 8px 10px 38px" }}>
                                <table className="k-table k-table--compact" style={{ minWidth: 720, background: "transparent" }}>
                                  <thead>
                                    <tr>
                                      {["Sr.", "HS Code", "Product", "Qty", "Unit", "Rate", "Amount", "Dis Amt", "Tax Amt", "Total"].map((h, i) => (
                                        <th key={i} className={i >= 3 && i !== 4 ? "k-num" : undefined} style={{ position: "static" }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {inv.lines.map((l, idx) => (
                                      <tr key={idx}>
                                        <td>{l.sr}</td>
                                        <td style={{ fontFamily: "monospace" }}>{l.hsCode}</td>
                                        <td style={{ maxWidth: 280 }}><div style={clamp2}>{l.product}</div></td>
                                        <td className="k-num" style={nowrap}>{qty(l.quantity)}</td>
                                        <td>{l.unit}</td>
                                        <td className="k-num" style={nowrap}>{money(l.rate)}</td>
                                        <td className="k-num" style={nowrap}>{money(l.amount)}</td>
                                        <td className="k-num" style={nowrap}>{money(l.discountAmount)}</td>
                                        <td className="k-num" style={nowrap}>{money(l.taxAmount)}</td>
                                        <td className="k-num" style={{ ...nowrap, fontWeight: 600 }}>{money(l.totalAmount)}</td>
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
                <tfoot>
                  {/* Grand total across all invoices */}
                  <tr>
                    <td style={{ ...totalCell, fontWeight: 800, color: "var(--k-blue)" }} colSpan={6}>TOTAL (all invoices)</td>
                    <td className="k-num" style={{ ...totalCell, fontWeight: 800 }}>{report.lineCount}</td>
                    <td className="k-num" style={{ ...totalCell, ...nowrap, fontWeight: 800 }}>{qty(report.grandQuantity)}</td>
                    <td className="k-num" style={{ ...totalCell, ...nowrap, fontWeight: 800 }}>{money(report.grandAmount)}</td>
                    <td className="k-num" style={{ ...totalCell, ...nowrap, fontWeight: 800 }}>{money(report.grandTax)}</td>
                    <td className="k-num" style={{ ...totalCell, ...nowrap, fontWeight: 800, color: "var(--k-blue)" }}>{money(report.grandTotal)}</td>
                    {canPrintInvoice && <td style={totalCell} />}
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      {loading && <Loading>Loading report…</Loading>}

      {bulk && (
        <div style={formStyles.backdrop} role="dialog" aria-modal="true" aria-label="Building Tax Invoice PDFs">
          <div style={{ ...formStyles.modal, maxWidth: modalSizes.sm }}>
            <div style={formStyles.header}>
              <h3 style={{ ...formStyles.title, display: "flex", alignItems: "center", gap: 8 }}>
                {bulk.mode === "zip" ? <MdFolderZip size={20} aria-hidden="true" /> : <MdPictureAsPdf size={20} aria-hidden="true" />}
                {bulk.mode === "zip" ? "Building ZIP of Tax Invoices" : "Building merged Tax Invoices"}
              </h3>
            </div>
            <div style={formStyles.body}>
              <div style={{ color: "var(--k-muted)", fontSize: "var(--k-font)", marginBottom: 10 }}>{bulk.phase}</div>
              <div style={{ height: 8, background: "var(--k-surface-3)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${bulk.total ? Math.round((bulk.done / bulk.total) * 100) : 0}%`,
                  background: "var(--k-blue)",
                  transition: "width 0.2s ease",
                }} />
              </div>
              <div style={{ marginTop: 8, fontSize: "var(--k-font-sm)", color: "var(--k-ink)" }}>
                {bulk.done} of {bulk.total} invoice(s)
              </div>
              {bulk.mode === "merged" && (
                <div style={{ marginTop: 12, fontSize: "0.78rem", color: "var(--k-muted)" }}>
                  Your browser's print dialog opens when this finishes — pick <strong>Save as PDF</strong> as the destination to keep a file.
                </div>
              )}
            </div>
            <div style={formStyles.footer}>
              <button
                type="button"
                onClick={() => { cancelRef.current = true; }}
                style={{ ...formStyles.button, ...formStyles.cancel, display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <MdClose size={15} /> Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };
const nowrap = { whiteSpace: "nowrap" };
// Page-specific tints (expanded invoice band, grand-total band, PDF glyph).
const bandBg = "#f0f7ff";
const totalBg = "#eef4ff";
const pdfRed = "#b71c1c";
const totalCell = { background: totalBg, borderTop: "2px solid var(--k-blue)" };

// Filter row inside the controls card — wraps on narrow screens.
const controlsRow = { display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" };
const ctlAuto = { width: "auto", maxWidth: "100%" };
const checkLabel = { display: "flex", alignItems: "center", gap: 6, fontSize: "var(--k-font)", color: "var(--k-ink)", minHeight: "var(--k-h)", cursor: "pointer" };
const reportMeta = { padding: "0.6rem var(--k-td-pad-x)", color: "var(--k-muted)", fontSize: "var(--k-font-sm)", borderBottom: "1px solid var(--k-line)" };

// Mobile card styles — phones get stacked, tappable invoice cards (no
// horizontal scroll) instead of the wide table.
const srCard = { border: "1px solid var(--k-line)", borderRadius: "var(--k-radius)", padding: "0.7rem 0.8rem", background: "var(--k-surface)", display: "flex", flexDirection: "column", gap: 3 };
const srCardHead = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, boxShadow: "none", cursor: "pointer", width: "100%", textAlign: "left" };
const srMeta = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(90px, 100%), 1fr))", gap: "0.35rem 0.7rem", marginTop: 4 };
const srLbl = { display: "block", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--k-muted)" };
const srVal = { display: "block", fontSize: "0.84rem", fontWeight: 600, color: "var(--k-ink)" };
const srLine = { background: "var(--k-surface-2)", borderRadius: 8, padding: "0.5rem 0.6rem", display: "flex", flexDirection: "column", gap: 2 };
const srLineMeta = { display: "flex", flexWrap: "wrap", gap: "0.3rem 0.7rem", fontSize: "0.78rem", color: "var(--k-muted)", marginTop: 2 };

// Segmented control (Month / Year vs Custom range) — kit has no segmented
// control, so it is built locally from the --k-* tokens.
const segWrap = { display: "inline-flex", border: "1px solid var(--k-line-strong)", borderRadius: "var(--k-radius)", overflow: "hidden", background: "var(--k-surface)" };
const segBtn = (active) => ({
  border: "none",
  borderRadius: 0,
  background: active ? "var(--k-blue)" : "transparent",
  color: active ? "#fff" : "var(--k-muted)",
  padding: "0 0.85rem",
  fontSize: "var(--k-font-sm)",
  fontWeight: 600,
  cursor: "pointer",
  minHeight: "var(--k-h)",
  whiteSpace: "nowrap",
  boxShadow: "none",
  transform: "none",
});
