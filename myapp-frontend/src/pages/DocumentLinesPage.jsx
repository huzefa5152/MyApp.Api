import ListFilters from "../Components/ListFilters";
import RecordsViewport from "../Components/RecordsViewport";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { challanPrivateColumns, defaultColumnsForType, lineColumns, lineSources, linesToTsv, saveLinesExcel } from "../utils/documentLines";
import { loadDocumentLines } from "../api/documentLinesApi";
import SearchableSelect from "../Components/SearchableSelect";
import { MdContentCopy, MdDownload, MdTableRows } from "react-icons/md";
import ColumnPicker from "../Components/reports/ColumnPicker";
import { Dot, PrintPdfButtons, ReportBar } from "../Components/reports/ReportChrome";
import { fileSlug, pdfReport, printReport } from "../utils/reportPrintKit";
import { excelBrandParams } from "../utils/reportExcelBrand";
import "./DocumentLinesPage.css";
import useIsNarrow from "../hooks/useIsNarrow";

const ymd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = new Date();
const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
const input = { minHeight: 40, width: "100%", boxSizing: "border-box", padding: "7px 9px", fontSize: 13, border: "1px solid #d0d7e2", borderRadius: 7, background: "#fff", color: "#1a2332" };

export default function DocumentLinesPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const [params, setParams] = useSearchParams();
  const allowed = Object.entries(lineSources).filter(([, source]) => has(source.permission));
  const type = allowed.some(([key]) => key === params.get("type")) ? params.get("type") : allowed[0]?.[0];
  const documentId = params.get("documentId");
  const [period, setPeriod] = useState(documentId ? "document" : "month");
  const [from, setFrom] = useState(ymd(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(ymd(today));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [columnPrefs, setColumnPrefs] = useState(() => Object.fromEntries(Object.keys(lineSources).map((key) => {
    try {
      const stored = JSON.parse(localStorage.getItem(`document-line-columns-${key}`) || "null");
      if (key === "challan" && JSON.stringify(stored) === JSON.stringify(["date", "number", "party", "itemType", "description", "quantity", "unit"]))
        return [key, defaultColumnsForType(key)];
      return [key, Array.isArray(stored) && stored.length && stored.every((id) => lineColumns.some(([field]) => field === id)) ? stored : defaultColumnsForType(key)];
    } catch { return [key, defaultColumnsForType(key)]; }
  })));
  const columns = columnPrefs[type] || defaultColumnsForType(type);
  const setColumns = (update) => setColumnPrefs((previous) => ({
    ...previous, [type]: typeof update === "function" ? update(previous[type] || defaultColumnsForType(type)) : update,
  }));
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState("");
  const narrow = useIsNarrow(760);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    for (const [key, selected] of Object.entries(columnPrefs))
      localStorage.setItem(`document-line-columns-${key}`, JSON.stringify(selected));
  }, [columnPrefs]);
  useEffect(() => { if (!documentId && period === "document") setPeriod("month"); }, [documentId, period]);

  const range = useMemo(() => period === "week" ? { from: ymd(startOfWeek), to: ymd(today) }
    : period === "month" ? { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) }
      : { from, to }, [period, from, to]);
  const shown = useMemo(() => rows.filter((row) => !itemSearch ||
    `${row.description} ${row.itemType} ${row.hsCode}`.toLowerCase().includes(itemSearch.toLowerCase())), [rows, itemSearch]);
  const availableColumns = lineColumns.filter(([key]) => type === "challan" || !challanPrivateColumns.includes(key));
  const visibleColumns = availableColumns.filter(([key]) => columns.includes(key));

  useEffect(() => {
    const controller = new AbortController();
    setRows([]); setLoaded(false); setMessage(""); setError(""); setBusy(false);
    if (!selectedCompany?.id || !type) return;
    if (period === "custom" && (!range.from || !range.to || range.from > range.to)) {
      setError("Choose a valid date range."); return;
    }
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const result = await loadDocumentLines(type, selectedCompany.id,
          period === "document" && documentId ? { documentId } : { ...range, search, status }, controller.signal);
        if (!controller.signal.aborted) { setRows(result); setLoaded(true); }
      } catch (err) {
        if (!controller.signal.aborted) setError(err?.response?.data?.error || "Could not load document lines. Please try again.");
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }, search ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [documentId, selectedCompany?.id, type, period, range, search, status]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(linesToTsv(shown, columns)); setMessage(`${shown.length} lines copied for Excel.`); }
    catch { setError("Clipboard is unavailable. Use Download Excel instead."); }
  };
  const download = async () => {
    setExporting(true); setError("");
    try { await saveLinesExcel(shown, columns, `${lineSources[type].label}-${period === "document" ? documentId : `${range.from}-to-${range.to}`}`, await excelBrandParams(selectedCompany)); }
    catch { setError("Could not create the Excel file."); }
    finally { setExporting(false); }
  };

  if (!allowed.length) return <p>You do not have access to document lines.</p>;

  const hiddenSet = new Set(availableColumns.map(([key]) => key).filter((key) => !columns.includes(key)));
  const typeLabel = lineSources[type]?.label || "Document lines";
  const rangeLabel = period === "document" ? "This document" : `${range.from} to ${range.to}`;
  // Print / PDF: every matching line (not only the first 200 on screen), in the
  // chosen columns, on the company letterhead.
  const envelope = () => ({
    title: `Document Lines — ${typeLabel}`,
    companyName: selectedCompany?.brandName || selectedCompany?.name,
    periodLabel: rangeLabel,
    generatedAt: new Date().toISOString(),
    filtersApplied: [search && `Search: "${search}"`, status && `Status: ${status}`, itemSearch && `Item: "${itemSearch}"`].filter(Boolean),
    sourceLabel: `${shown.length} line${shown.length === 1 ? "" : "s"}`,
    columns: visibleColumns.map(([key, label]) => ({ key, label, format: "text" })),
    rows: shown,
  });
  const print = async () => {
    setPrinting("print"); setError("");
    try { await printReport(envelope(), selectedCompany); }
    catch { setError("Could not prepare the print. Allow print pop-ups and try again."); }
    finally { setPrinting(""); }
  };
  const pdf = async () => {
    setPrinting("pdf"); setError("");
    try { await pdfReport(envelope(), selectedCompany, fileSlug(`${typeLabel}-${rangeLabel}`)); }
    catch { setError("Could not create the PDF."); }
    finally { setPrinting(""); }
  };

  return <div className="document-lines-page rw">
    <ReportBar
      icon={<MdTableRows size={20} />}
      crumb="Reports"
      title="Document Lines"
      meta={<>
        {selectedCompany && <strong>{selectedCompany.brandName || selectedCompany.name}</strong>}
        <Dot>{typeLabel}</Dot>
        <Dot>{rangeLabel}</Dot>
        <Dot>Filter line items, then copy, print or export</Dot>
      </>}
      actions={<>
        <ColumnPicker
          columns={availableColumns.map(([key, label]) => ({ key, label }))}
          hidden={hiddenSet}
          onChange={(nextHidden) => setColumns(lineColumns.map(([id]) => id).filter((id) => availableColumns.some(([key]) => key === id) && !nextHidden.has(id)))}
          onReset={() => setColumns(defaultColumnsForType(type))}
          note="Copy, Excel, Print and PDF use the columns ticked here."
        />
        <button type="button" className="rw-btn" disabled={!shown.length || busy || exporting} onClick={copy}><MdContentCopy size={16} /><span>Copy for Excel</span></button>
        <button type="button" className="rw-btn" disabled={!shown.length || busy || exporting} onClick={download}><MdDownload size={17} /><span>{exporting ? "Exporting…" : "Excel"}</span></button>
        <PrintPdfButtons onPrint={print} onPdf={pdf} busy={printing} disabled={!shown.length || busy} />
      </>}
    />
    <ListFilters><div className="document-lines-filters rw-filters">
      <div className="document-lines-company"><span className="document-lines-label">Company</span><SearchableSelect items={companies} value={selectedCompany?.id || ""} onChange={(id) => setSelectedCompany(companies.find((c) => c.id === Number(id)))} allowClear={false} style={input} /></div>
      <label>Document type<br /><select aria-label="Document type" style={input} value={type} onChange={(e) => { setStatus(""); setParams({ type: e.target.value }); }}>
        {allowed.map(([key, source]) => <option key={key} value={key}>{source.label}</option>)}
      </select></label>
      <label>Period<br /><select aria-label="Period" style={input} value={period} onChange={(e) => setPeriod(e.target.value)}>
        {documentId && <option value="document">This document</option>}
        <option value="week">This week</option><option value="month">This month</option><option value="custom">Custom range</option>
      </select></label>
      {period === "custom" && <><label>From<br /><input type="date" style={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<br /><input type="date" style={input} value={to} onChange={(e) => setTo(e.target.value)} /></label></>}
      {period !== "document" && <label>Document / buyer search<br /><input style={input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number, buyer, PO…" /></label>}
      {period !== "document" && type === "challan" && <label>Status<br /><select style={input} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All statuses</option>{["Pending", "Imported", "Invoiced", "No PO", "Cancelled"].map((x) => <option key={x} value={x}>{x}</option>)}
      </select></label>}
    </div></ListFilters>
    {error && <div className="rw-notice rw-notice--warn" role="alert">{error}</div>}
    {message && <div className="rw-notice" role="status">{message}</div>}
    <div className="rw-section-head" aria-busy={busy}>
      <strong role="status" style={{ color: "#1a2332" }}>{busy ? "Loading lines…" : loaded ? `${shown.length} line${shown.length === 1 ? "" : "s"}` : "Line items"}</strong>
      <input aria-label="Find an item" style={{ ...input, width: "min(100%, 260px)", minHeight: 36 }} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Find description or item type…" disabled={!loaded} />
    </div>
    <RecordsViewport label="Document line records" enabled={!narrow}>{!loaded ? <div className="rw-state">{busy ? "Loading matching line items…" : error ? "Update the filters to try again." : "Select a company to view its lines."}</div> : !shown.length ? <div className="rw-state">No lines match these filters. Try another period or search.</div> : <>
      {narrow ? <div className="rw-cards">
        {shown.slice(0, 200).map((row, index) => {
          const [lead, ...rest] = visibleColumns;
          return <div key={`${row.documentId}-${row.line}-${index}`} className="rw-card">
            <div className="rw-card__lead">{row[lead[0]] || "—"}</div>
            <div className="rw-card__meta" style={{ marginTop: 6 }}>
              {rest.filter(([key]) => row[key] !== "" && row[key] != null).map(([key, label]) => <div key={key} style={{ minWidth: 0 }}><span>{label}</span><b>{row[key]}</b></div>)}
            </div>
          </div>;
        })}
      </div> : <div data-admin-table-region="" className="rw-table-wrap">
        <table className="rw-table" style={{ minWidth: 650 }}>
          <thead><tr>{visibleColumns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
          <tbody>{shown.slice(0, 200).map((row, index) => <tr key={`${row.documentId}-${row.line}-${index}`}>
            {visibleColumns.map(([key]) => <td key={key} className={/date/i.test(key) ? "rw-nowrap" : undefined} style={/date/i.test(key) ? undefined : { maxWidth: 300, overflowWrap: "anywhere" }}>{row[key]}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
      {shown.length > 200 && <p className="rw-section-head" style={{ marginTop: 8 }}>Showing the first 200 lines here. Copy, Excel, Print and PDF include all {shown.length} matching lines.</p>}
    </>}</RecordsViewport>
  </div>;
}
