import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { challanPrivateColumns, defaultColumnsForType, lineColumns, lineSources, linesToTsv, saveLinesExcel } from "../utils/documentLines";
import { loadDocumentLines } from "../api/documentLinesApi";
import { MdTableRows } from "react-icons/md";
import { PageHeader, CompanyPicker, Button, Card, Field, SearchBox, TableWrap, EmptyState, Loading, Alert } from "../ui/Kit";
import "./DocumentLinesPage.css";

const ymd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = new Date();
const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));

export default function DocumentLinesPage() {
  const { selectedCompany } = useCompany();
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

  if (!allowed.length) return <EmptyState icon={MdTableRows}>You do not have access to document lines.</EmptyState>;
  return <div>
    <PageHeader icon={MdTableRows} tone="brand" title="Document Lines" subtitle="Filter line items, then copy or export to Excel." />
    <CompanyPicker />
    <Card style={{ marginBottom: "var(--k-gap)" }}>
      <div style={filterGrid}>
        <Field label="Document type"><select className="k-select" aria-label="Document type" value={type} onChange={(e) => { setStatus(""); setParams({ type: e.target.value }); }}>
          {allowed.map(([key, source]) => <option key={key} value={key}>{source.label}</option>)}
        </select></Field>
        <Field label="Period"><select className="k-select" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {documentId && <option value="document">This document</option>}
          <option value="week">This week</option><option value="month">This month</option><option value="custom">Custom range</option>
        </select></Field>
        {period === "custom" && <><Field label="From"><input type="date" className="k-input" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="k-input" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}
        {period !== "document" && <Field label="Document / buyer search"><input className="k-input" aria-label="Document / buyer search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number, buyer, PO…" /></Field>}
        {period !== "document" && type === "challan" && <Field label="Status"><select className="k-select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{["Pending", "Imported", "Invoiced", "No PO", "Cancelled"].map((x) => <option key={x} value={x}>{x}</option>)}
        </select></Field>}
      </div>
    </Card>
    <details className="document-lines-columns" style={columnsBox}><summary>Columns <span>{visibleColumns.length} selected</span></summary>
      <div className="document-lines-column-grid" style={{ borderTopColor: "var(--k-line)" }}>
        {availableColumns.map(([key, label]) => <label key={key}>
          <input type="checkbox" checked={columns.includes(key)} onChange={() => setColumns((current) => current.includes(key) ? current.length > 1 ? current.filter((x) => x !== key) : current : lineColumns.map(([id]) => id).filter((id) => current.includes(id) || id === key))} />{label}
        </label>)}
      </div>
      <Button size="sm" onClick={() => setColumns(defaultColumnsForType(type))}>Reset columns</Button>
    </details>
    {error && <Alert tone="error">{error}</Alert>}
    {message && <Alert tone="success">{message}</Alert>}
    <Card
      flush
      aria-busy={busy}
      style={{ overflow: "hidden" }}
      title={<span role="status">{busy ? "Loading lines…" : loaded ? `${shown.length} line${shown.length === 1 ? "" : "s"}` : "Line items"}</span>}
      actions={<>
        <SearchBox label="Find an item" value={itemSearch} onChange={setItemSearch} placeholder="Find description or item type…" disabled={!loaded} />
        <Button disabled={!shown.length || busy || exporting} onClick={copy}>Copy for Excel</Button>
        <Button disabled={!shown.length || busy || exporting} onClick={download}>{exporting ? "Exporting…" : "Download Excel"}</Button>
      </>}
    >
    {!loaded ? (busy ? <Loading>Loading matching line items…</Loading> : <EmptyState boxed={false}>{error ? "Update the filters to try again." : "Select a company to view its lines."}</EmptyState>)
      : !shown.length ? <EmptyState boxed={false}>No lines match these filters. Try another period or search.</EmptyState> : <>
      <TableWrap data-admin-table-region="" style={{ overflow: "auto", maxHeight: "65vh" }}>
        <table className="k-table" style={{ minWidth: 650 }}>
          <thead><tr>{visibleColumns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
          <tbody>{shown.slice(0, 200).map((row, index) => <tr key={`${row.documentId}-${row.line}-${index}`}>
            {visibleColumns.map(([key]) => <td key={key} style={{ maxWidth: 300, overflowWrap: "anywhere" }}>{row[key]}</td>)}
          </tr>)}</tbody>
        </table>
      </TableWrap>
      {shown.length > 200 && <p style={{ margin: 0, padding: "0.6rem var(--k-td-pad-x)", color: "var(--k-muted)", fontSize: "var(--k-font-sm)", borderTop: "1px solid var(--k-line)" }}>Showing the first 200 lines here. Copy and Excel include all {shown.length} matching lines.</p>}
    </>}
    </Card>
  </div>;
}

// Filter grid — auto-fit, one column on phones.
const filterGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: "0.75rem", alignItems: "end" };
// Column chooser (native <details>) — surface follows the kit tokens.
const columnsBox = { margin: "0 0 var(--k-gap)", borderColor: "var(--k-line)", borderRadius: "var(--k-radius)", background: "var(--k-surface)", color: "var(--k-ink)", fontSize: "var(--k-font)" };
