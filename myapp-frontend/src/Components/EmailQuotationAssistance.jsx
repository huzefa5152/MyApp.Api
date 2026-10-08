import { useEffect, useRef, useState } from "react";
import http from "../api/httpClient";

export default function EmailQuotationAssistance({ root, message, draft, onDraft, changeItems, busy, run }) {
  const [preview, setPreview] = useState(null), [suggestions, setSuggestions] = useState(null), [progress, setProgress] = useState("");
  const epoch = useRef(0);
  useEffect(() => { ++epoch.current; setPreview(null); setSuggestions(null); setProgress(""); }, [draft.items, draft.clientId, message.id]);
  useEffect(() => () => { ++epoch.current; }, []);
  const base = `${root}/messages/${message.id}`;
  const saveCurrent = async seq => {
    const { data } = await http.put(`${base}/draft`, draft);
    if (seq !== epoch.current) return null;
    const saved = { ...draft, revision: data.revision };
    onDraft(saved); return saved;
  };
  const readAttachment = attachment => run(async () => {
    const seq = epoch.current;
    const saved = await saveCurrent(seq);
    if (!saved) return;
    const request = { attachmentId: attachment.id, revision: saved.revision };
    const { data } = await http.post(`${base}/attachment-preview`, request);
    if (seq === epoch.current) setPreview({ data, request, attachment });
  });
  const readOcr = () => run(async () => {
    const seq = epoch.current, current = preview;
    setProgress("Preparing attachment…");
    try {
      const { data: bytes } = await http.get(`${base}/attachment`, { params: { attachmentId: current.attachment.id }, responseType: "blob" });
      const { readPoFile } = await import("../utils/poOcr.js");
      const pages = await readPoFile(new File([bytes], current.attachment.fileName, { type: current.attachment.mimeType }),
        (_fraction, label) => { if (seq === epoch.current) setProgress(label); });
      if (seq !== epoch.current) return;
      const request = { ...current.request, pages };
      const { data } = await http.post(`${base}/attachment-preview`, request);
      if (seq === epoch.current) setPreview({ ...current, data, request });
    } finally { if (seq === epoch.current) setProgress(""); }
  });
  const applyAttachment = mode => run(async () => {
    const seq = epoch.current;
    const { data } = await http.post(`${base}/attachment-items`, { ...preview.request, mode });
    if (seq === epoch.current) { onDraft(data); setPreview(null); setSuggestions(null); }
  });
  const assist = () => run(async () => {
    const seq = epoch.current;
    const saved = await saveCurrent(seq);
    if (!saved) return;
    const { data } = await http.post(`${base}/item-assistance`, { revision: saved.revision, clientId: saved.clientId, items: saved.items });
    if (seq === epoch.current) setSuggestions(data);
  });
  const applyMatch = (index, candidate) => changeItems(draft.items.map((item, i) => i === index
    ? { ...item, sourceDescription: item.sourceDescription || item.description, description: candidate.description, unit: candidate.unit || item.unit, unitPrice: null } : item));
  const applyPrice = (index, candidate) => changeItems(draft.items.map((item, i) => i === index ? { ...item, unitPrice: candidate.lastQuote.unitPrice } : item));
  return <section className="ew-assistance" aria-label="Quotation assistance">
    <h3>Build from attachments and your records</h3>
    <p className="ew-muted">Reading an attachment or finding suggestions saves the current draft first. You choose which items and prices to use. Every change clears the review confirmation.</p>
    <div className="ew-actions">{message.attachments.map(a => <button key={a.id} disabled={busy} onClick={() => readAttachment(a)}>Read items from {a.fileName}</button>)}
      <button disabled={busy || !draft.items.length} onClick={assist}>Find catalogue matches and prices</button></div>
    {progress && <p role="status">{progress}</p>}
    {preview && <article className="ew-attachment-preview"><h4>Attachment preview: {preview.data.fileName}</h4>
      <ul className="ew-warnings">{preview.data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      <details><summary>Extracted source text</summary><pre className="ew-body">{preview.data.text || "No readable text yet."}</pre></details>
      {preview.data.requiresOcr ? <button disabled={busy} onClick={readOcr}>Read with OCR</button> : <>
        <p>{preview.data.items.length} items found. Existing items: {draft.items.length}.</p>
        <ol>{preview.data.items.map((item, i) => <li key={i}>{item.description} · {item.quantity} {item.unit || "(unit needs review)"}</li>)}</ol>
        <div className="ew-actions"><button disabled={busy || !preview.data.items.length || draft.items.length + preview.data.items.length > 200} onClick={() => applyAttachment("Append")}>Append attachment items</button>
          <button disabled={busy || !preview.data.items.length} onClick={() => applyAttachment("Replace")}>Replace draft items with attachment</button></div>
        {!preview.data.items.length && /\.pdf$/i.test(preview.attachment.fileName) && <button disabled={busy} onClick={readOcr}>Try OCR instead</button>}
      </>}
      <button disabled={busy} onClick={() => setPreview(null)}>Dismiss preview</button>
    </article>}
    {suggestions && <div aria-label="Item suggestions">{suggestions.map(row => {
      const item = draft.items[row.index]; if (!item) return null;
      return <article key={row.index} className="ew-suggestion"><h4>Item {row.index + 1}: {item.description}</h4>
        {!row.candidates.length && <p>No matching records found. Keep the enquiry description and enter a price.</p>}
        {row.candidates.map((candidate, i) => {
          const same = candidate.description === item.description && candidate.unit === item.unit;
          const margin = candidate.lastPurchase && Number(item.unitPrice) > 0 && same
            ? ((Number(item.unitPrice) - candidate.lastPurchase.unitPrice) / Number(item.unitPrice) * 100).toFixed(1) : null;
          return <div className="ew-candidate" key={i}><strong>{candidate.description}</strong><p>{candidate.unit} · {candidate.reason} · match score {candidate.score}/100</p>
            {!same && <button disabled={busy} onClick={() => applyMatch(row.index, candidate)}>Use this catalogue description for item {row.index + 1}</button>}
            {candidate.lastQuote && <p>Last quotation for this customer: {candidate.lastQuote.unitPrice} per {candidate.unit} · Quote {candidate.lastQuote.documentNumber} · {candidate.lastQuote.date.slice(0, 10)}</p>}
            {candidate.lastQuote && same && <button disabled={busy} onClick={() => applyPrice(row.index, candidate)}>Use last quoted price for item {row.index + 1}</button>}
            {candidate.lastPurchase && <p>Latest recorded purchase cost: {candidate.lastPurchase.unitPrice} per {candidate.unit} · Bill {candidate.lastPurchase.documentNumber} · {candidate.lastPurchase.date.slice(0, 10)}{margin !== null ? ` · Gross margin at current price: ${margin}%` : ""}</p>}
          </div>;
        })}
      </article>;
    })}<p className="ew-muted">History is limited to recent records in this company and the selected customer. Units must match; no unit or currency conversion is performed. Purchase cost is shown only with purchase-view access. Prices exclude tax and additional landed costs.</p></div>}
  </section>;
}
