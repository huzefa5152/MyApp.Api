// A titled group of KPI cards in an auto-fit grid.
export default function KpiGroup({ title, children }) {
  return (
    <section style={{ marginBottom: "1.25rem" }}>
      {title && <h3 style={{ margin: "0 0 0.6rem", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dash-text)" }}>{title}</h3>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "1rem" }}>{children}</div>
    </section>
  );
}
