// Card shell for a chart: title, loading / error+retry / empty states.
export default function ChartCard({ title, subtitle, loading, error, onRetry, empty, emptyText = "No data for this period.", height = 260, children }) {
  let body;
  if (loading) body = <Msg height={height}>Loading…</Msg>;
  else if (error) {
    body = (
      <Msg height={height}>
        <span>{error}</span>
        {onRetry && <button type="button" onClick={onRetry} style={{ minHeight: 44, minWidth: 44, padding: "0 1rem", borderRadius: 8, border: "1px solid var(--dash-grid)", background: "transparent", color: "var(--dash-primary)", cursor: "pointer", fontWeight: 600 }}>Retry</button>}
      </Msg>
    );
  } else if (empty) body = <Msg height={height}>{emptyText}</Msg>;
  else body = <div style={{ width: "100%", height }}>{children}</div>;
  return (
    <section style={{ background: "var(--dash-card)", border: "1px solid var(--dash-grid)", borderRadius: 16, padding: "1rem 1.1rem", boxShadow: "0 1px 2px rgba(12,24,48,0.04), 0 10px 28px -18px rgba(12,24,48,0.18)", minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "var(--dash-ink)", overflowWrap: "anywhere" }}>{title}</h3>
      {subtitle && <div style={{ fontSize: "0.76rem", color: "var(--dash-text)", marginBottom: "0.5rem" }}>{subtitle}</div>}
      {body}
    </section>
  );
}

function Msg({ height, children }) {
  return <div role="status" style={{ minHeight: height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.6rem", color: "var(--dash-text)", fontSize: "0.85rem", textAlign: "center" }}>{children}</div>;
}
