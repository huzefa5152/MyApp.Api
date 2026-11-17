export default function CostingStatus({ document, onOpen }) {
  const total = document.costingLineCount;
  const count = document.costedLineCount;
  if (total == null || count == null) return null;
  const complete = total > 0 && count === total;
  const label = complete ? "Fully costed" : count > 0 ? "Partially costed" : "Costing not added";
  const Tag = onOpen ? "button" : "span";
  return (
    <Tag
      type={onOpen ? "button" : undefined}
      onClick={onOpen}
      className="costing-status"
      aria-label={onOpen ? `Edit costing: ${label}, ${count} of ${total} lines` : undefined}
      style={{
        border: "none",
        cursor: onOpen ? "pointer" : "default",
        textAlign: "left",
        display: "inline-flex",
        flexWrap: "wrap",
        gap: 4,
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: "var(--k-r-sm)",
        fontSize: "var(--k-fs-xs)",
        lineHeight: 1.5,
        background: complete
          ? "var(--k-success-bg)"
          : count > 0
            ? "var(--k-warn-bg)"
            : "var(--k-surface-3)",
        color: complete
          ? "var(--k-success-strong)"
          : count > 0
            ? "var(--k-warn-ink)"
            : "var(--k-muted)",
      }}
    >
      <strong>{label}</strong>
      <span>
        · {count}/{total} lines
      </span>
    </Tag>
  );
}
