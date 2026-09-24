import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { challanPrivateColumns, defaultColumnsForType, lineColumns, lineSources, linesToTsv, saveLinesExcel } from "../utils/documentLines";
import { loadDocumentLines } from "../api/documentLinesApi";

const ymd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = new Date();
const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
const input = { minHeight: 44, padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 8, maxWidth: "100%" };
const action = { minHeight: 44, padding: "9px 14px", border: "1px solid #80cbc4", borderRadius: 8, background: "#e0f2f1", color: "#00695c", fontWeight: 700, cursor: "pointer" };

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
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    for (const [key, selected] of Object.entries(columnPrefs))
      localStorage.setItem(`document-line-columns-${key}`, JSON.stringify(selected));
  }, [columnPrefs]);
  useEffect(() => { if (!documentId && period === "document") setPeriod("month"); }, [documentId, period]);
  useEffect(() => { setRows([]); setLoaded(false); setMessage(""); }, [selectedCompany?.id, type, period, from, to, search, status, documentId]);

  const range = useMemo(() => period === "week" ? { from: ymd(startOfWeek), to: ymd(today) }
    : period === "month" ? { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) }
      : { from, to }, [period, from, to]);
  const shown = useMemo(() => rows.filter((row) => !itemSearch ||
    `${row.description} ${row.itemType} ${row.hsCode}`.toLowerCase().includes(itemSearch.toLowerCase())), [rows, itemSearch]);
  const availableColumns = lineColumns.filter(([key]) => type === "challan" || !challanPrivateColumns.includes(key));
  const visibleColumns = availableColumns.filter(([key]) => columns.includes(key));

  const load = async () => {
    if (!selectedCompany || !type) return;
    if (period === "custom" && (!range.from || !range.to || range.from > range.to)) {
      setError("Choose a valid date range."); return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await loadDocumentLines(type, selectedCompany.id,
        period === "document" && documentId ? { documentId } : { ...range, search, status });
      setRows(result); setLoaded(true);
    } catch (err) { setError(err?.response?.data?.error || err.message || "Could not load document lines."); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (documentId && selectedCompany && type) load();
    // The document deep link loads once when its identity or company changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, selectedCompany?.id, type]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(linesToTsv(shown, columns)); setMessage(`${shown.length} lines copied for Excel.`); }
    catch { setError("Clipboard is unavailable. Use Download Excel instead."); }
  };
  const download = async () => {
    setBusy(true); setError("");
    try { await saveLinesExcel(shown, columns, `${lineSources[type].label}-${period === "document" ? documentId : `${range.from}-to-${range.to}`}`); }
    catch { setError("Could not create the Excel file."); }
    finally { setBusy(false); }
  };

  if (!allowed.length) return <p>You do not have access to document lines.</p>;
  return <div style={{ padding: "20px", maxWidth: 1500, margin: "0 auto" }}>
    <h2 style={{ marginTop: 0 }}>Document Lines</h2>
    <p style={{ color: "#64748b" }}>Review, copy, or download every line matching your document and date filters.</p>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
      <label>Company<br /><select style={input} value={selectedCompany?.id || ""} onChange={(e) => setSelectedCompany(companies.find((c) => c.id === Number(e.target.value)))}>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      <label>Document type<br /><select style={input} value={type} onChange={(e) => { setStatus(""); setParams({ type: e.target.value }); }}>
        {allowed.map(([key, source]) => <option key={key} value={key}>{source.label}</option>)}
      </select></label>
      <label>Period<br /><select style={input} value={period} onChange={(e) => setPeriod(e.target.value)}>
        {documentId && <option value="document">This document</option>}
        <option value="week">This week</option><option value="month">This month</option><option value="custom">Custom range</option>
      </select></label>
      {period === "custom" && <><label>From<br /><input type="date" style={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<br /><input type="date" style={input} value={to} onChange={(e) => setTo(e.target.value)} /></label></>}
      {period !== "document" && <label>Document / buyer search<br /><input style={input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number, buyer, PO…" /></label>}
      {period !== "document" && type === "challan" && <label>Status<br /><select style={input} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All statuses</option>{["Pending", "Imported", "Invoiced", "No PO", "Cancelled"].map((x) => <option key={x} value={x}>{x}</option>)}
      </select></label>}
      <button type="button" style={action} disabled={busy} onClick={load}>{busy ? "Loading…" : "Show lines"}</button>
    </div>
    <details style={{ margin: "18px 0" }}><summary style={{ cursor: "pointer", fontWeight: 700 }}>Choose columns ({columns.length})</summary>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 12 }}>
        {availableColumns.map(([key, label]) => <label key={key} style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 5, padding: "0 8px", border: "1px solid #cbd5e1", borderRadius: 8 }}>
          <input type="checkbox" checked={columns.includes(key)} onChange={() => setColumns((current) => current.includes(key) ? current.length > 1 ? current.filter((x) => x !== key) : current : lineColumns.map(([id]) => id).filter((id) => current.includes(id) || id === key))} />{label}
        </label>)}
      </div>
    </details>
    {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
    {message && <p role="status" style={{ color: "#00695c" }}>{message}</p>}
    {loaded && <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", margin: "18px 0" }}>
        <strong>{shown.length} line{shown.length === 1 ? "" : "s"}</strong>
        <label>Find an item<br /><input style={input} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Description or item type" /></label>
        <button type="button" style={action} disabled={!shown.length || busy} onClick={copy}>Copy for Excel</button>
        <button type="button" style={action} disabled={!shown.length || busy} onClick={download}>Download Excel</button>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 650 }}>
          <thead><tr>{visibleColumns.map(([key, label]) => <th key={key} style={{ textAlign: "left", padding: 10, background: "#e0f2f1", borderBottom: "1px solid #cbd5e1" }}>{label}</th>)}</tr></thead>
          <tbody>{shown.slice(0, 200).map((row, index) => <tr key={`${row.documentId}-${row.line}-${index}`}>
            {visibleColumns.map(([key]) => <td key={key} style={{ padding: 9, borderBottom: "1px solid #e2e8f0" }}>{row[key]}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      {shown.length > 200 && <p>Showing the first 200 lines here. Copy and Excel include all {shown.length} matching lines.</p>}
    </>}
  </div>;
}
