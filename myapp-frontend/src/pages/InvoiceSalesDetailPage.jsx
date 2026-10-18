import ListFilters from "../Components/ListFilters";
import RecordsViewport from "../Components/RecordsViewport";
import { useEffect, useMemo, useRef, useState } from "react";
import { MdAssessment, MdDownload, MdRefresh } from "react-icons/md";
import { getInvoiceSalesDetail, getInvoiceSalesDetailExcel } from "../api/reportApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { colors, dropdownStyles } from "../theme";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import Pagination from "../Components/Pagination";
import InvoiceSalesDetailGrid from "../Components/reports/InvoiceSalesDetailGrid";
import { ISD_PERIOD_OPTIONS, FBR_STATUS_OPTIONS, emptyText, excelFileName, groupBills, pageOfBills, toApiParams, totalsFor } from "../utils/invoiceSalesDetail";

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
  if (permissionsLoading) return <p role="status">Loading permissions…</p>;
  if (!canView) return <p>You don’t have permission to view this report.</p>;
  return <div style={{ minWidth: 0 }}>
    <h1 style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 8px", fontSize: "clamp(1.2rem,3vw,1.6rem)", color: colors.textPrimary }}><MdAssessment color={colors.blue} />Invoice Sales Detail</h1>
    <p style={{ color: colors.textSecondary, margin: "0 0 16px" }}>Bill-by-bill sales, tax and filing status. Filters update automatically.</p>
    <ListFilters><div style={styles.filters}>
      {companies.length > 1 && <Field label="Company"><select aria-label="Company" style={styles.input} value={companyId || ""} onChange={e => setSelectedCompany(companies.find(c => String(c.id) === e.target.value))}>{companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}</select></Field>}
      <Field label="Period"><select aria-label="Period" style={styles.input} value={filters.period} onChange={e => change("period", e.target.value)}>{ISD_PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
      {filters.period === "custom" && <>
        <Field label="From"><input aria-label="From" type="date" style={styles.input} value={filters.from} onChange={e => change("from", e.target.value)} /></Field>
        <Field label="To"><input aria-label="To" type="date" style={styles.input} value={filters.to} onChange={e => change("to", e.target.value)} /></Field>
      </>}
      <Field label="Client"><SearchableClientSelect clients={buyerOptions.map(b => ({ id: b.clientId, name: b.name, ntn: b.ntn }))} value={filters.clientId} onChange={id => change("clientId", id)} placeholder="All clients" style={{ width: "100%", minHeight: 44, maxWidth: "100%" }} /></Field>
      <Field label="FBR status"><select aria-label="FBR status" style={styles.input} value={filters.status} onChange={e => change("status", e.target.value)}><option value="">All statuses</option>{FBR_STATUS_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      <Field label="Search"><input aria-label="Search bills" type="search" maxLength={100} placeholder="Bill, party, NTN, HS code, item…" style={styles.input} value={filters.search} onChange={e => change("search", e.target.value)} /></Field>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "flex-end", gridColumn: "1 / -1" }}>
        <button type="button" style={styles.button} disabled={!companyId || loading || invalid} onClick={() => setRevision(n => n + 1)}><MdRefresh />Refresh</button>
        <button type="button" style={styles.button} onClick={() => { setStored(defaults(companyId)); setPage(1); }}>Clear filters</button>
        {canExport && <button type="button" style={{ ...styles.button, background: colors.teal, color: "white" }} disabled={!report || loading || exporting} onClick={exportExcel}><MdDownload />{exporting ? "Exporting…" : "Excel"}</button>}
      </div>
    </div></ListFilters>
    {!companyId && <p>Select a company to view this report.</p>}
    {invalid && <p role="alert">Choose both dates, with the start on or before the end date.</p>}
    {error && !invalid && <p role="alert" style={{ color: colors.danger }}>{error}</p>}
    <RecordsViewport label="Invoice sales detail records"><div aria-busy={loading}>
      {loading && <p role="status">Loading report…</p>}
      {report && <>
        <h2 style={{ fontSize: "1.05rem", color: colors.textPrimary }}>{report.companyName} · {report.periodLabel}</h2>
        <div style={styles.tiles}>{Object.entries(tiles.totals).map(([name, value]) => <div key={name} style={styles.tile}><span style={{ color: colors.textSecondary }}>{tiles.totalLabels[name]}</span><strong style={{ color: colors.blue, fontSize: "1.12rem" }}>{name.endsWith("Count") ? value : `Rs ${money(value)}`}</strong></div>)}</div>
        <details className="isd-notes"><summary>About these figures</summary><p>Totals cover all filtered bills. Saved commercial values are shown; consultant grouping does not change these lines. Cancelled bills remain included. Total includes freight; GST does not. Buyer address and NTN are current details.</p></details>
        <InvoiceSalesDetailGrid key={companyId} report={report} bills={view.bills} allBillCount={bills.length} loading={loading} emptyText={emptyText(report, filters)} />
        <Pagination page={view.page} totalPages={view.totalPages} total={bills.length} unit="bills" onPage={setPage} pageSize={pageSize} onPageSize={size => { setPageSize(size); setPage(1); }} />
      </>}
    </div></RecordsViewport>
  </div>;
}
function Field({ label, children }) { return <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, color: colors.textSecondary, fontSize: "0.85rem", fontWeight: 600 }}>{label}{children}</label>; }
const styles = {
  filters: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))", gap: 12, background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: 14, marginBottom: 16 },
  input: { ...dropdownStyles.base, width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", minHeight: 44 },
  button: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 12px", minHeight: 44, background: colors.inputBg, color: colors.blue, border: `1px solid ${colors.inputBorder}`, borderRadius: 8, cursor: "pointer" },
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(150px,100%),1fr))", gap: 10 },
  tile: { display: "flex", flexDirection: "column", gap: 6, padding: 14, background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 10 },
};
