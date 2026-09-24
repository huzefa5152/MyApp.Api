import { useRef } from "react";
import RichText from "./RichText";

// The print renderer supports these three tags and line breaks. Keep the
// editor's output in that same small, safe format for view and print parity.
export default function DocumentNotesEditor({ value = "", onChange, label = "Notes", readOnly = false }) {
  const input = useRef(null);
  const wrap = (tag) => {
    const el = input.current;
    if (!el || readOnly) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selection = value.slice(start, end) || "text";
    const insert = `<${tag}>${selection}</${tag}>`;
    onChange(value.slice(0, start) + insert + value.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + tag.length + 2, start + tag.length + 2 + selection.length); });
  };
  return <div style={{ marginTop: 14 }}>
    <label htmlFor="document-notes" style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>{label}</label>
    {!readOnly && <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
      {[["b", "Bold"], ["i", "Italic"], ["u", "Underline"]].map(([tag, title]) =>
        <button key={tag} type="button" onClick={() => wrap(tag)} aria-label={title} title={title} style={{ minWidth: 44, minHeight: 44, border: "1px solid #cbd5e1", borderRadius: 7, background: "#fff", fontWeight: tag === "b" ? 700 : 400, fontStyle: tag === "i" ? "italic" : "normal", textDecoration: tag === "u" ? "underline" : "none" }}>{tag.toUpperCase()}</button>)}
    </div>}
    {!readOnly && <textarea id="document-notes" ref={input} rows={4} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Add optional notes" style={{ boxSizing: "border-box", width: "100%", minHeight: 100, padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, resize: "vertical" }} />}
    {value && <div style={{ marginTop: 6, padding: 10, border: "1px solid #e2e8f0", borderRadius: 8 }}><div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Preview</div><RichText text={value} /></div>}
  </div>;
}
