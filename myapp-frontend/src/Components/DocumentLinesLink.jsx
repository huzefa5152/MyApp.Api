import { Link } from "react-router-dom";
import { MdTableRows } from "react-icons/md";

// "header" is the small pill beside a page title; the default and compact
// forms are unchanged for the places that already use them.
const HEADER = {
  minHeight: 30,
  padding: "0 10px",
  gap: 5,
  fontSize: "0.76rem",
  borderRadius: 999,
  background: "var(--k-pill-bg, #f4f8fd)",
  border: "1px solid #d6e3f3",
  flexShrink: 0,
  whiteSpace: "nowrap",
};

export default function DocumentLinesLink({
  type,
  documentId,
  compact = false,
  variant,
  className,
}) {
  const header = variant === "header";
  return (
    <Link
      to={`/reports/document-lines?type=${encodeURIComponent(type)}${documentId ? `&documentId=${encodeURIComponent(documentId)}` : ""}`}
      className={
        [header ? "doc-lines-pill" : null, className].filter(Boolean).join(" ") || undefined
      }
      title="Review, copy or export document lines"
      aria-label="Open document lines"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        minHeight: "var(--k-btn-h)",
        minWidth: compact ? 44 : undefined,
        padding: compact ? "0 10px" : "0 12px",
        borderRadius: 8,
        border: "1px solid var(--k-line)",
        background: "var(--k-surface)",
        color: "var(--k-blue)",
        fontWeight: 700,
        fontSize: "0.8rem",
        textDecoration: "none",
        ...(header ? HEADER : null),
      }}
    >
      <MdTableRows size={header ? 14 : 16} aria-hidden="true" />
      {compact ? null : "Document lines"}
    </Link>
  );
}
