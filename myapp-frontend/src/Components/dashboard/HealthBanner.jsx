// Data-health items from the KPI response: [{ key, severity: "warn"|"info", count, amount?, message }].
// Each is a button -> onDrill(key). Renders nothing when there are none.
export default function HealthBanner({ items, onDrill }) {
  if (!items?.length) return null;
  const Tag = onDrill ? "button" : "div";
  return (
    <div role="region" aria-label="Data health" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: "0.5rem", marginBottom: "1rem" }}>
      {items.map((it) => {
        const c = it.severity === "warn" ? "var(--dash-warn)" : "var(--dash-primary)";
        // The server's message already starts with the count; show it once, in bold.
        const n = String(it.count);
        const rest = it.message?.startsWith(n) ? it.message.slice(n.length) : ` ${it.message || ""}`;
        return (
          <Tag key={it.key} {...(onDrill ? { type: "button", onClick: () => onDrill(it.key) } : {})}
            style={{ minHeight: 44, textAlign: "left", padding: "0.5rem 0.9rem", borderRadius: 10, border: `1px solid ${c}`, borderLeftWidth: 4, background: "var(--dash-card)", color: "var(--dash-ink)", cursor: onDrill ? "pointer" : "default", fontSize: "0.85rem", overflowWrap: "anywhere" }}>
            <strong style={{ color: c }}>{it.count}</strong>{rest}
          </Tag>
        );
      })}
    </div>
  );
}
