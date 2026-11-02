import ListFilters from "../Components/ListFilters";
import RecordsViewport from "../Components/RecordsViewport";
import { useEffect, useMemo, useRef, useState } from "react";
import { MdAssessment, MdBusiness, MdDownload, MdRefresh } from "react-icons/md";
import { CompanyPicker, Dot, PrintPdfButtons, ReportBar } from "../Components/reports/ReportChrome";
import { fileSlug, pdfReport, printReport } from "../utils/reportPrintKit";
import { getInvoiceSalesDetail, getInvoiceSalesDetailExcel } from "../api/reportApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { colors, dropdownStyles } from "../theme";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import Pagination from "../Components/Pagination";
import useIsNarrow from "../hooks/useIsNarrow";
import InvoiceSalesDetailGrid from "../Components/reports/InvoiceSalesDetailGrid";
import { ISD_PERIOD_OPTIONS, FBR_STATUS_OPTIONS, emptyText, excelFileName, fmtDay, groupBills, pageOfBills, toApiParams, totalsFor } from "../utils/invoiceSalesDetail";

const defaults = companyId => ({ companyId, period: "thisMonth", search: "", status: "", clientId: "", from: "", to: "" });
const money = n => Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InvoiceSalesDetailPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has, loading: permissionsLoading } = usePermissions();
  const canView = has("reports.invoicedetail.view"), canExport = has("reports.invoicedetail.export");
  const companyId = selectedCompany?.id;
  const [stored, setStored] = useState(() => defaults(companyId));
  const filters = useMemo(() => stored.companyId === companyId ? stored : defaults(companyId), [stored, companyId]);
  const change = (key, value) => { setStored({ ...filters, [key]: value }); setPage(1); };
  const params = useMemo(() => toApiParams(filters), [filters]);
  const key = JSON.stringify([companyId, params]);
  const latestKey = useRef(key); latestKey.current = key;
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false), [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(50);
  const [printing, setPrinting] = useState("");
  const narrow = useIsNarrow(760);
  const invalid = filters.period === "custom" && (!filters.from || !filters.to || filters.from > filters.to);
  const report = answer?.key === key && canView && !invalid ? answer.data : null;

  useEffect(() => {
    if (!companyId || !canView || invalid) { setLoading(false); return; }
    const controller = new AbortController();
    let live = true;
    setLoading(true); setError("");
    getInvoiceSalesDetail(companyId, params, { signal: controller.signal })
      .then(({ data }) => { if (live) { setAnswer({ key, data }); setPage(1); } })
      .catch(e => { if (live) { setAnswer(null); setError(e.response?.data?.message || "Could not load invoice sales detail."); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [companyId, canView, invalid, key, params, revision]);

  const bills = useMemo(() => groupBills(report?.rows || []), [report]);
  const view = useMemo(() => pageOfBills(bills, page, pageSize), [bills, page, pageSize]);
  const tiles = report ? totalsFor(report) : null;
  // Options remain the whole period's buyers, including while another filter loads.
  const buyerOptions = answer && answer.data.companyId === companyId ? answer.data.buyers || [] : [];
  async function exportExcel() {
    if (!report || loading || exporting || !canExport) return;
    const exportKey = key;
    setExporting(true);
    try {
      const { data } = await getInvoiceSalesDetailExcel(companyId, params);
      if (latestKey.current !== exportKey) return;
      const url = URL.createObjectURL(data), link = document.createElement("a");
      link.href = url; link.download = excelFileName(report); link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (latestKey.current === exportKey) setError("Could not export invoice sales detail."); }
    finally { setExporting(false); }
  }
  // Print / PDF: every bill in the selection (not just this page), on the company letterhead.
  const envelope = () => ({
    title: "Invoice Sales Detail",
    companyName: report.companyName,
    periodLabel: report.periodLabel,
    generatedAt: new Date().toISOString(),
    filtersApplied: [filters.status && `FBR status: ${filters.status}`, filters.search && `Search: "${filters.search}"`,
      filters.clientId && buyerOptions.find(b => String(b.clientId) === String(filters.clientId))?.name].filter(Boolean),
    sourceLabel: `${bills.length} bills · ${report.rows.length} lines`,
    columns: [
      { key: "bill", label: "Bill #" }, { key: "date", label: "Date" }, { key: "buyer", label: "Client" },
      { key: "ntn", label: "NTN" }, { key: "excl", label: "Excl. tax", format: "money", totalled: true },
      { key: "gst", label: "GST", format: "money", totalled: true }, { key: "total", label: "Total", format: "money", totalled: true },
      { key: "status", label: "FBR status" },
    ],
    rows: bills.map(b => ({ bill: b.first.invoiceNumber, date: fmtDay(b.first.date), buyer: b.first.buyer, ntn: b.first.buyerNtn || "",
      excl: b.totals.excl, gst: b.totals.gst, total: b.totals.total, status: b.first.fbrStatus })),
    totals: { excl: bills.reduce((t, b) => t + Number(b.totals.excl || 0), 0), gst: bills.reduce((t, b) => t + Number(b.totals.gst || 0), 0),
      total: bills.reduce((t, b) => t + Number(b.totals.total || 0), 0) },
  });
  async function doPrint() {
    setPrinting("print");
    try { await printReport(envelope(), selectedCompany); } catch { setError("Could not prepare the print. Allow print pop-ups and try again."); }
    finally { setPrinting(""); }
  }
  async function doPdf() {
    setPrinting("pdf");
    try { await pdfReport(envelope(), selectedCompany, fileSlug(`Invoice-Sales-Detail-${report.periodLabel}`)); } catch { setError("Could not build the PDF."); }
    finally { setPrinting(""); }
  }
  if (permissionsLoading) return <p role="status">Loading permissions…</p>;
  if (!canView) return <p>You don’t have permission to view this report.</p>;
  return <div className="rw" style={{ minWidth: 0 }}>
    <ReportBar
      icon={<MdAssessment size={20} />}
      crumb="Reports"
      title="Invoice Sales Detail"
      meta={<>Bill-by-bill sales, tax and filing status<Dot>filters update automatically</Dot></>}
      actions={<>
        <CompanyPicker icon={<MdBusiness size={18} />} companies={companies} selectedCompany={selectedCompany} onChange={setSelectedCompany} />
        <button type="button" className="rw-btn" disabled={!companyId || loading || invalid} onClick={() => setRevision(n => n + 1)}><MdRefresh size={17} />Refresh</button>
        {canExport && <button type="button" className="rw-btn" disabled={!report || loading || exporting} onClick={exportExcel}><MdDownload size={17} />{exporting ? "Exporting…" : "Excel"}</button>}
        <PrintPdfButtons onPrint={doPrint} onPdf={doPdf} busy={printing} disabled={!report || loading || !bills.length} />
      </>}
    />
    <ListFilters><div className="rw-filters" style={styles.filters}>
      <Field label="Period"><select aria-label="Period" style={styles.input} value={filters.period} onChange={e => change("period", e.target.value)}>{ISD_PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
      {filters.period === "custom" && <>
        <Field label="From"><input aria-label="From" type="date" style={styles.input} value={filters.from} onChange={e => change("from", e.target.value)} /></Field>
        <Field label="To"><input aria-label="To" type="date" style={styles.input} value={filters.to} onChange={e => change("to", e.target.value)} /></Field>
      </>}
      <Field label="Client"><SearchableClientSelect clients={buyerOptions.map(b => ({ id: b.clientId, name: b.name, ntn: b.ntn }))} value={filters.clientId} onChange={id => change("clientId", id)} placeholder="All clients" style={{ width: "100%", minHeight: 38, maxWidth: "100%" }} /></Field>
      <Field label="FBR status"><select aria-label="FBR status" style={styles.input} value={filters.status} onChange={e => change("status", e.target.value)}><option value="">All statuses</option>{FBR_STATUS_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      <Field label="Search"><input aria-label="Search bills" type="search" maxLength={100} placeholder="Bill, party, NTN, HS code, item…" style={styles.input} value={filters.search} onChange={e => change("search", e.target.value)} /></Field>
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <button type="button" className="rw-btn" onClick={() => { setStored(defaults(companyId)); setPage(1); }}>Clear filters</button>
      </div>
    </div></ListFilters>
    {!companyId && <div className="rw-state">Select a company to view this report.</div>}
    {invalid && <div className="rw-notice rw-notice--warn" role="alert">Choose both dates, with the start on or before the end date.</div>}
    {error && !invalid && <div className="rw-notice rw-notice--warn" role="alert">{error}</div>}
    {report && <div className="rw-kpis">{Object.entries(tiles.totals).map(([name, value]) => <div key={name} className={`rw-kpi${name === "total" ? " rw-kpi--lead" : ""}`}><span className="rw-kpi__label">{tiles.totalLabels[name]}</span><span className="rw-kpi__value">{name.endsWith("Count") ? value : `Rs ${money(value)}`}</span>{tiles.notes?.[name] && <span className="rw-kpi__sub">{tiles.notes[name]}</span>}</div>)}</div>}
    <RecordsViewport label="Invoice sales detail records" enabled={!narrow}><div aria-busy={loading}>
      {loading && <div className="rw-state" role="status">Loading report…</div>}
      {report && <>
        <h2 className="rw-period">{report.companyName} · {report.periodLabel}</h2>
        <details className="isd-notes"><summary>About these figures</summary><p>Totals cover all filtered bills. Saved commercial values are shown; consultant grouping does not change these lines. Cancelled bills remain included. Total includes freight; GST does not. Buyer address and NTN are current details.</p></details>
        <InvoiceSalesDetailGrid key={companyId} report={report} bills={view.bills} allBillCount={bills.length} loading={loading} emptyText={emptyText(report, filters)} />
        <Pagination page={view.page} totalPages={view.totalPages} total={bills.length} unit="bills" onPage={setPage} pageSize={pageSize} onPageSize={size => { setPageSize(size); setPage(1); }} />
      </>}
    </div></RecordsViewport>
  </div>;
}
function Field({ label, children }) { return <label style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, color: colors.textSecondary, fontSize: "0.64rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}{children}</label>; }
const styles = {
  filters: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(190px,100%),1fr))", gap: "8px 10px", background: colors.cardBg, border: `1px solid ${colors.cardBorder}` },
  input: { ...dropdownStyles.base, width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", minHeight: 38 },
};
