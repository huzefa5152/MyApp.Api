import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiDownload, FiX, FiChevronLeft, FiChevronRight, FiExternalLink, FiPaperclip, FiFile, FiFileText, FiImage, FiGrid } from "react-icons/fi";

/**
 * An email's attachments as cards, opening into a full-screen viewer, the way
 * Gmail shows them.
 *
 * `fetchBlob(attachment)` is the page's existing download request; nothing new
 * is asked of the server. Each file is fetched at most once per message and
 * shared between its thumbnail, the viewer and Download.
 *
 * The bytes are the sender's, so what is rendered is decided by an ALLOWLIST
 * on the file's extension, and the blob is re-typed to that allowlisted type
 * before it is shown. An HTML or SVG attachment is never rendered: as a blob
 * URL it would run with this app's origin. Those, and anything else, get a
 * card and a Download button.
 */
const IMAGE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
const TEXT = ["txt", "log", "json", "xml", "md"];
const ext = name => (String(name || "").match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
export const attachmentKind = a => {
  const e = ext(a.fileName);
  if (IMAGE[e]) return "image";
  if (e === "pdf") return "pdf";
  if (e === "csv") return "csv";
  if (e === "xlsx" || e === "xlsm") return "sheet";
  if (TEXT.includes(e)) return "text";
  return "none";
};
const TILE = { pdf: "#d93025", sheet: "#188038", csv: "#188038", image: "#e37400", text: "#1a73e8", doc: "#1a73e8", none: "#5f6368" };
const tileOf = a => { const k = attachmentKind(a), e = ext(a.fileName); return k === "none" && ["doc", "docx"].includes(e) ? "doc" : k === "none" && ["xls"].includes(e) ? "sheet" : k; };
const IconOf = ({ a, size = 18 }) => { const t = tileOf(a); const I = t === "image" ? FiImage : t === "sheet" || t === "csv" ? FiGrid : t === "none" ? FiFile : FiFileText; return <I size={size} aria-hidden="true" />; };
export const fileSize = n => (!n ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const MAX_ROWS = 300, MAX_COLS = 40, MAX_TEXT = 200000;
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length && rows.length < MAX_ROWS; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row.slice(0, MAX_COLS)); row = []; cell = ""; }
    else cell += c;
  }
  if ((cell || row.length) && rows.length < MAX_ROWS) { row.push(cell); rows.push(row.slice(0, MAX_COLS)); }
  return rows;
}
async function readSheets(blob) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb.worksheets.slice(0, 12).map(ws => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, r => {
      if (rows.length >= MAX_ROWS) return;
      const cells = [];
      for (let c = 1; c <= Math.min(ws.actualColumnCount || r.cellCount, MAX_COLS); c++) cells.push(r.getCell(c).text ?? "");
      cells.n = r.number; // empty rows are skipped; keep the sheet's own numbering
      rows.push(cells);
    });
    return { name: ws.name, rows, more: ws.actualRowCount > MAX_ROWS };
  });
}

function Table({ rows }) {
  if (!rows.length) return <p className="em-viewer-note">This sheet is empty.</p>;
  return <div className="em-table-wrap"><table className="em-table"><tbody>
    {rows.map((r, i) => <tr key={i}><th scope="row">{r.n ?? i + 1}</th>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
  </tbody></table></div>;
}

export default function EmailAttachments({ attachments, fetchBlob, onDownload, busy = false }) {
  const cache = useRef(new Map()); // id -> Promise<Blob>
  const urls = useRef([]);
  const thumbed = useRef(new Set());
  // The page's request may be a new function every render; the cache must not be.
  const fetchRef = useRef(fetchBlob);
  fetchRef.current = fetchBlob;
  const [thumbs, setThumbs] = useState({});
  const [open, setOpen] = useState(null); // index
  const opener = useRef(null);

  const getBlob = useCallback(a => {
    if (!cache.current.has(a.id)) {
      const p = fetchRef.current(a);
      cache.current.set(a.id, p);
      p.catch(() => cache.current.delete(a.id));
    }
    return cache.current.get(a.id);
  }, []);
  // Download hands over the file already fetched for the preview, if there is one.
  const save = useCallback(a => onDownload(a, cache.current.get(a.id)), [onDownload]);
  const typedUrl = useCallback((blob, type) => { const u = URL.createObjectURL(type ? new Blob([blob], { type }) : blob); urls.current.push(u); return u; }, []);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; urls.current.forEach(URL.revokeObjectURL); urls.current = []; }; }, []);

  // Image thumbnails, as Gmail shows them. Small files only, a few at most.
  useEffect(() => {
    attachments.filter(a => attachmentKind(a) === "image" && (!a.size || a.size <= 3 * 1048576)).slice(0, 8).forEach(a => {
      if (thumbed.current.has(a.id)) return;
      thumbed.current.add(a.id);
      getBlob(a).then(b => { if (mounted.current) setThumbs(t => ({ ...t, [a.id]: typedUrl(b, IMAGE[ext(a.fileName)]) })); }).catch(() => thumbed.current.delete(a.id));
    });
  }, [attachments, getBlob, typedUrl]);

  if (!attachments?.length) return null;
  const show = (i, e) => { opener.current = e?.currentTarget || null; setOpen(i); };
  const close = () => { setOpen(null); setTimeout(() => opener.current?.focus?.(), 0); };

  return <section className="em-attachments" aria-label="Attachments">
    <h3 className="em-attachments-title"><FiPaperclip aria-hidden="true" />{attachments.length} attachment{attachments.length === 1 ? "" : "s"}</h3>
    <ul className="em-cards">
      {attachments.map((a, i) => <li key={a.id} className="em-card" style={{ "--em-tile": TILE[tileOf(a)] }}>
        <button type="button" className="em-card-open" onClick={e => show(i, e)} aria-label={`Preview ${a.fileName}`}>
          <span className="em-card-preview">
            {thumbs[a.id] ? <img src={thumbs[a.id]} alt="" /> : <span className="em-card-tile"><IconOf a={a} size={30} /><span className="em-card-ext">{ext(a.fileName).toUpperCase() || "FILE"}</span></span>}
          </span>
          <span className="em-card-foot"><span className="em-card-badge"><IconOf a={a} size={13} /></span><span className="em-card-name" title={a.fileName}>{a.fileName}</span></span>
          {a.size > 0 && <span className="em-card-size">{fileSize(a.size)}</span>}
        </button>
        <button type="button" className="em-card-download" disabled={busy} onClick={() => save(a)} aria-label={`Download ${a.fileName}`} title="Download"><FiDownload size={16} aria-hidden="true" /></button>
      </li>)}
    </ul>
    {open !== null && <Viewer attachments={attachments} index={open} setIndex={setOpen} onClose={close} getBlob={getBlob} typedUrl={typedUrl} onDownload={save} busy={busy} />}
  </section>;
}

function Viewer({ attachments, index, setIndex, onClose, getBlob, typedUrl, onDownload, busy }) {
  const a = attachments[index];
  const kind = attachmentKind(a);
  const [state, setState] = useState({ status: "loading" });
  const [sheet, setSheet] = useState(0);
  const closeBtn = useRef(null);
  const many = attachments.length > 1;
  const go = useCallback(d => setIndex(i => (i + d + attachments.length) % attachments.length), [attachments.length, setIndex]);

  useEffect(() => {
    let alive = true;
    setSheet(0);
    if (kind === "none") { setState({ status: "none" }); return undefined; }
    setState({ status: "loading" });
    getBlob(a).then(async blob => {
      let next;
      if (kind === "image") next = { url: typedUrl(blob, IMAGE[ext(a.fileName)]) };
      else if (kind === "pdf") next = { url: typedUrl(blob, "application/pdf") };
      else if (kind === "text") next = { text: (await blob.slice(0, MAX_TEXT).text()) };
      else if (kind === "csv") next = { sheets: [{ name: a.fileName, rows: parseCsv(await blob.slice(0, MAX_TEXT * 5).text()) }] };
      else next = { sheets: await readSheets(blob) };
      if (alive) setState({ status: "ready", ...next });
    }).catch(() => { if (alive) setState({ status: "error" }); });
    return () => { alive = false; };
  }, [a, kind, getBlob, typedUrl]);

  useEffect(() => {
    closeBtn.current?.focus();
    const key = e => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (many && e.key === "ArrowRight") go(1);
      else if (many && e.key === "ArrowLeft") go(-1);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; };
  }, [onClose, go, many]);

  const sheets = state.sheets || [];
  const current = sheets[sheet];
  return createPortal(<div className="em-viewer" role="dialog" aria-modal="true" aria-label={`Preview of ${a.fileName}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <header className="em-viewer-bar">
      <span className="em-viewer-icon" style={{ background: TILE[tileOf(a)] }}><IconOf a={a} size={16} /></span>
      <span className="em-viewer-name"><strong title={a.fileName}>{a.fileName}</strong><span>{[fileSize(a.size), many ? `${index + 1} of ${attachments.length}` : ""].filter(Boolean).join(" · ")}</span></span>
      {kind === "pdf" && state.url && <a className="em-viewer-btn" href={state.url} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab"><FiExternalLink size={18} aria-hidden="true" /></a>}
      <button type="button" className="em-viewer-btn" disabled={busy} onClick={() => onDownload(a)} aria-label="Download" title="Download"><FiDownload size={18} aria-hidden="true" /></button>
      <button type="button" ref={closeBtn} className="em-viewer-btn" onClick={onClose} aria-label="Close preview" title="Close (Esc)"><FiX size={20} aria-hidden="true" /></button>
    </header>
    <div className="em-viewer-stage" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      {many && <button type="button" className="em-viewer-nav em-viewer-nav--prev" onClick={() => go(-1)} aria-label="Previous attachment"><FiChevronLeft size={26} aria-hidden="true" /></button>}
      {state.status === "loading" && <div className="em-viewer-card em-viewer-loading" role="status"><span className="em-spinner" aria-hidden="true" />Loading preview…</div>}
      {state.status === "error" && <div className="em-viewer-card" role="alert"><strong>This file could not be loaded.</strong><span>Try again, or download it.</span></div>}
      {state.status === "none" && <div className="em-viewer-card">
        <span className="em-viewer-big" style={{ background: TILE[tileOf(a)] }}><IconOf a={a} size={34} /></span>
        <strong>No preview available</strong><span>{ext(a.fileName) ? `.${ext(a.fileName)} files` : "This file"} can't be shown here. Download it to open it.</span>
        <button type="button" className="em-viewer-download" disabled={busy} onClick={() => onDownload(a)}><FiDownload aria-hidden="true" /> Download</button>
      </div>}
      {state.status === "ready" && kind === "image" && <img className="em-viewer-image" src={state.url} alt={a.fileName} />}
      {state.status === "ready" && kind === "pdf" && <iframe className="em-viewer-pdf" src={state.url} title={a.fileName} />}
      {state.status === "ready" && kind === "text" && <pre className="em-viewer-doc em-viewer-text">{state.text}</pre>}
      {state.status === "ready" && (kind === "sheet" || kind === "csv") && <div className="em-viewer-doc em-viewer-sheet">
        {sheets.length > 1 && <div className="em-sheet-tabs" role="tablist">{sheets.map((s, i) => <button type="button" role="tab" key={s.name + i} aria-selected={i === sheet} onClick={() => setSheet(i)}>{s.name}</button>)}</div>}
        {current ? <Table rows={current.rows} /> : <p className="em-viewer-note">This workbook has no sheets.</p>}
        {current?.more && <p className="em-viewer-note">Showing the first {MAX_ROWS} rows. Download the file to see the rest.</p>}
      </div>}
      {many && <button type="button" className="em-viewer-nav em-viewer-nav--next" onClick={() => go(1)} aria-label="Next attachment"><FiChevronRight size={26} aria-hidden="true" /></button>}
    </div>
  </div>, document.body);
}
