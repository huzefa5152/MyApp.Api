// Tax position (spec §7). data = GET /api/dashboard/tax-position; onDrill(line)
// with line in output | further | input | 236G | 236H | wht.
import { formatMoneyShort } from "./chartTheme";
import { taxPanelRows } from "./taxPanelRows";

const row = { display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", width: "100%", minHeight: 44, padding: "0.35rem 0", background: "none", border: 0, borderBottom: "1px solid var(--dash-grid)", font: "inherit", color: "var(--dash-ink)", textAlign: "left" };

export default function TaxPositionPanel({ data, onDrill }) {
  if (!data) return null;
  const rows = taxPanelRows(data);
  const cell = (r) => (
    <>
      <span style={{ overflowWrap: "anywhere" }}>{r.label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, textAlign: "right" }}>{r.unavailable || formatMoneyShort(r.value)}</span>
    </>
  );
  const one = (r) => {
    const bold = r.kind === "result" || r.kind === "total";
    const st = { ...row, fontWeight: bold ? 700 : 400 };
    return (
      <div key={r.key}>
        {r.drill
          ? <button type="button" onClick={() => onDrill?.(r.drill)} style={{ ...st, cursor: "pointer" }}>{cell(r)}</button>
          : <div style={st}>{cell(r)}</div>}
        {r.note && <div style={{ fontSize: "0.72rem", color: "var(--dash-text)", marginTop: 2 }}>{r.note}</div>}
      </div>
    );
  };
  return (
    <section style={{ background: "var(--dash-card)", border: "1px solid var(--dash-grid)", borderRadius: 16, padding: "1rem 1.1rem", minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "var(--dash-ink)" }}>Tax position</h3>
      <div style={{ fontSize: "0.76rem", color: "var(--dash-text)", marginBottom: "0.4rem" }}>Months: {data.fromMonth} – {data.toMonth}</div>
      {rows.filter((r) => r.kind !== "recoverable").map(one)}
      <h4 style={{ margin: "0.9rem 0 0.2rem", fontSize: "0.78rem", fontWeight: 600, color: "var(--dash-text)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Recoverable</h4>
      {rows.filter((r) => r.kind === "recoverable").map(one)}
    </section>
  );
}
