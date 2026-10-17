export default function CostingStatus({ document, onOpen }) {
  const total = document.costingLineCount;
  const count = document.costedLineCount;
  if (total == null || count == null) return null;
  const complete = total > 0 && count === total;
  const label = complete ? "Fully costed" : count > 0 ? "Partially costed" : "Costing not added";
  const Tag = onOpen ? "button" : "span";
  return <Tag type={onOpen ? "button" : undefined} onClick={onOpen} aria-label={onOpen ? `Edit costing: ${label}, ${count} of ${total} lines` : undefined} style={{ border: "none", cursor: onOpen ? "pointer" : "default", minHeight: onOpen ? 44 : undefined, textAlign: "left", display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center", padding: "4px 8px", borderRadius: 6, fontSize: 12, lineHeight: 1.5,
    background: complete ? "#e8f5e9" : count > 0 ? "#fff3e0" : "#f1f5f9", color: complete ? "#256029" : count > 0 ? "#92400e" : "#475569" }}>
    <strong>{label}</strong><span>· {count}/{total} lines</span>
  </Tag>;
}
