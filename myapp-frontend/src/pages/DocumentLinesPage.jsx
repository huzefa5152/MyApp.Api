import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { challanPrivateColumns, defaultColumnsForType, lineColumns, lineSources, linesToTsv, saveLinesExcel } from "../utils/documentLines";
import { loadDocumentLines } from "../api/documentLinesApi";
import SearchableSelect from "../Components/SearchableSelect";
import { MdTableRows } from "react-icons/md";
import "./DocumentLinesPage.css";

const ymd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = new Date();
const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
const input = { minHeight: 40, width: "100%", boxSizing: "border-box", padding: "7px 9px", fontSize: 13, border: "1px solid #d0d7e2", borderRadius: 7, background: "#fff", color: "#1a2332" };
const action = { minHeight: 44, padding: "8px 12px", border: "1px solid #d0d7e2", borderRadius: 8, background: "#fff", color: "#0d47a1", fontSize: 13, fontWeight: 600, cursor: "pointer" };

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
    try { await saveLinesExcel(shown, columns, `${lineSources[type].label}-${period === "document" ? documentId : `${range.from}-to-${range.to}`}`); }
    catch { setError("Could not create the Excel file."); }
    finally { setExporting(false); }
  };

  if (!allowed.length) return <p>You do not have access to document lines.</p>;
  return <div className="document-lines-page">
    <header className="document-lines-heading">
      <span className="document-lines-icon"><MdTableRows size={22} /></span>
      <div><h2>Document Lines</h2><p>Filter line items, then copy or export to Excel.</p></div>
    </header>
    <div className="document-lines-filters">
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
    </div>
    <details className="document-lines-columns"><summary>Columns <span>{visibleColumns.length} selected</span></summary>
      <div className="document-lines-column-grid">
        {availableColumns.map(([key, label]) => <label key={key}>
          <input type="checkbox" checked={columns.includes(key)} onChange={() => setColumns((current) => current.includes(key) ? current.length > 1 ? current.filter((x) => x !== key) : current : lineColumns.map(([id]) => id).filter((id) => current.includes(id) || id === key))} />{label}
        </label>)}
      </div>
      <button type="button" style={action} onClick={() => setColumns(defaultColumnsForType(type))}>Reset columns</button>
    </details>
    {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
    {message && <p role="status" style={{ color: "#00695c" }}>{message}</p>}
    <section className="document-lines-results" aria-busy={busy}>
      <div className="document-lines-toolbar">
        <strong role="status">{busy ? "Loading lines…" : loaded ? `${shown.length} line${shown.length === 1 ? "" : "s"}` : "Line items"}</strong>
        <input aria-label="Find an item" style={{ ...input, width: "min(100%, 240px)" }} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Find description or item type…" disabled={!loaded} />
        <button type="button" style={action} disabled={!shown.length || busy || exporting} onClick={copy}>Copy for Excel</button>
        <button type="button" style={action} disabled={!shown.length || busy || exporting} onClick={download}>{exporting ? "Exporting…" : "Download Excel"}</button>
      </div>
    {!loaded ? <div className="document-lines-empty">{busy ? "Loading matching line items…" : error ? "Update the filters to try again." : "Select a company to view its lines."}</div> : !shown.length ? <div className="document-lines-empty">No lines match these filters. Try another period or search.</div> : <>
      <div className="document-lines-table">
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 650 }}>
          <thead><tr>{visibleColumns.map(([key, label]) => <th key={key} style={{ textAlign: "left", padding: 10, background: "#e0f2f1", borderBottom: "1px solid #cbd5e1" }}>{label}</th>)}</tr></thead>
          <tbody>{shown.slice(0, 200).map((row, index) => <tr key={`${row.documentId}-${row.line}-${index}`}>
            {visibleColumns.map(([key]) => <td key={key} style={{ padding: "7px 10px", borderBottom: "1px solid #e8edf3" }}>{row[key]}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      {shown.length > 200 && <p>Showing the first 200 lines here. Copy and Excel include all {shown.length} matching lines.</p>}
    </>}
    </section>
  </div>;
}
