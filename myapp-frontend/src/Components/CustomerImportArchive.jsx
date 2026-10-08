import { useEffect, useState } from "react";
import http from "../api/httpClient";

export default function CustomerImportArchive({ companyId }) {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => { setPage(1); }, [companyId]);
  useEffect(() => {
    let active = true; setRows([]); setError("");
    http.get("/poimport/archives", { params: { companyId, page, pageSize: 20 } }).then(r => {
      if (active) { setRows(r.data.rows); setTotal(r.data.total); }
    }).catch(() => { if (active) setError("Could not load source files. Please try again."); });
    return () => { active = false; };
  }, [companyId, page]);
  async function download(row) {
    try {
      const r = await http.get(`/poimport/archives/${row.id}/file`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data); const a = document.createElement("a");
      a.href = url; a.download = row.originalFileName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("The original file is unavailable. The import record is still retained."); }
  }
  const names = { salesquote: "Quotation", salesorder: "Sales order", challan: "Delivery challan" };
  return <section style={{ marginTop: 24 }}>
    <h2>Imported source files</h2>
    <p>Original customer files are retained here. A linked record confirms the document was created.</p>
    {error && <p role="alert">{error}</p>}
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map(row => <article key={row.id} style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: 12, overflowWrap: "anywhere" }}>
        <strong>{row.originalFileName}</strong>
        <p>{row.parseOutcome} · {row.itemsExtracted} lines · {new Date(row.uploadedAt).toLocaleDateString()}</p>
        <p>{row.documentId ? `${names[row.documentKind] || "Document"} record ${row.documentId}` : "No document attachment recorded"}</p>
        <button type="button" style={{ minHeight: 44 }} onClick={() => download(row)}>Download original</button>
      </article>)}
      {!rows.length && !error && <p>No source files on this page.</p>}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 12 }}>
      <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
      <span>Page {page} · {total} uploads</span>
      <button type="button" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
    </div>
  </section>;
}
