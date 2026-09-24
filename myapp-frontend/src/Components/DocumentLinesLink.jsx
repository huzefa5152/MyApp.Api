import { Link } from "react-router-dom";
import { MdTableRows } from "react-icons/md";

export default function DocumentLinesLink({ type, documentId, compact = false }) {
  return <Link to={`/reports/document-lines?type=${encodeURIComponent(type)}&documentId=${encodeURIComponent(documentId)}`}
    title="Copy or download this document's lines" aria-label="Open document lines"
    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
      minHeight: 44, minWidth: compact ? 44 : undefined, padding: compact ? "0 10px" : "0 12px",
      borderRadius: 8, border: "1px solid #80cbc4", background: "#e0f2f1", color: "#00695c",
      fontWeight: 700, fontSize: "0.8rem", textDecoration: "none" }}>
    <MdTableRows size={16} aria-hidden="true" />{compact ? null : "Lines"}
  </Link>;
}
