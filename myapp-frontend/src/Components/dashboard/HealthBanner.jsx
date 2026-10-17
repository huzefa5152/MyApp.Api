// Data-health items from the KPI response: [{ key, severity: "warn"|"info", count, amount?, message }].
// Each is a button -> onDrill(key). Renders nothing when there are none.
export default function HealthBanner({ items, onDrill }) {
  if (!items?.length) return null;
  return (
    <div role="region" aria-label="Data health" style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "1rem" }}>
      {items.map((it) => {
        const c = it.severity === "warn" ? "var(--dash-warn)" : "var(--dash-primary)";
        return (
          <button key={it.key} type="button" onClick={() => onDrill?.(it.key)}
            style={{ minHeight: 44, textAlign: "left", padding: "0.5rem 0.9rem", borderRadius: 10, border: `1px solid ${c}`, borderLeftWidth: 4, background: "var(--dash-card)", color: "var(--dash-ink)", cursor: "pointer", fontSize: "0.85rem", overflowWrap: "anywhere" }}>
            <strong style={{ color: c }}>{it.count}</strong> {it.message}
          </button>
        );
      })}
    </div>
  );
}
