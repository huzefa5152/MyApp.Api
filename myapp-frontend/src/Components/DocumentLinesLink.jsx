import { Link } from "react-router-dom";
import { MdTableRows } from "react-icons/md";

export default function DocumentLinesLink({ type, documentId, compact = false }) {
  return <Link to={`/reports/document-lines?type=${encodeURIComponent(type)}${documentId ? `&documentId=${encodeURIComponent(documentId)}` : ""}`}
    title="Review, copy or export document lines" aria-label="Open document lines"
    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
      minHeight: 44, minWidth: compact ? 44 : undefined, padding: compact ? "0 10px" : "0 12px",
      borderRadius: 8, border: "1px solid #dce5ef", background: "#fff", color: "#0d47a1",
      fontWeight: 700, fontSize: "0.8rem", textDecoration: "none" }}>
    <MdTableRows size={16} aria-hidden="true" />{compact ? null : "Document lines"}
  </Link>;
}
