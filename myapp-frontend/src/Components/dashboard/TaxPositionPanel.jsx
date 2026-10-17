// Tax position (spec §7). data = GET /api/dashboard/tax-position; onDrill(line)
// with line in output | further | input | 236G | 236H | wht.
import { formatMoneyShort } from "./chartTheme";

const row = { display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", width: "100%", minHeight: 44, padding: "0.35rem 0", background: "none", border: 0, borderBottom: "1px solid var(--dash-grid)", font: "inherit", color: "#0c1830", textAlign: "left" };

export default function TaxPositionPanel({ data, onDrill }) {
  if (!data) return null;
  const gl = (v) => (data.ledgerEnabled ? formatMoneyShort(v) : "Ledger not enabled");
  const lines = [
    { key: "output", label: "Output tax", v: data.outputTax, fmt: formatMoneyShort },
    { key: "further", label: "Further tax", v: data.furtherTax, fmt: formatMoneyShort },
    { key: "input", label: data.inputBasis === "gl-before-cap" ? "Input tax claimed (before 8B cap)" : "Input tax claimed", v: -data.inputTaxClaimed, fmt: formatMoneyShort },
    { key: "236G", label: "Advance tax 236G", v: data.adv236G, fmt: gl },
    { key: "236H", label: "Advance tax 236H", v: data.adv236H, fmt: gl },
    { key: "wht", label: "Withholding payable", v: data.whtPayable, fmt: gl },
  ];
  return (
    <section style={{ background: "#fff", border: "1px solid var(--dash-grid)", borderRadius: 16, padding: "1rem 1.1rem", minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>Tax position</h3>
      <div style={{ fontSize: "0.76rem", color: "var(--dash-text)", marginBottom: "0.4rem" }}>Months: {data.fromMonth} – {data.toMonth}</div>
      {lines.map((l) => (
        <button key={l.key} type="button" onClick={() => onDrill?.(l.key)} style={{ ...row, cursor: "pointer" }}>
          <span style={{ overflowWrap: "anywhere" }}>{l.label}</span>
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, textAlign: "right" }}>{l.fmt(l.v)}</span>
        </button>
      ))}
      <div style={{ ...row, borderBottom: 0, fontWeight: 700 }}>
        <span>Total payable</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoneyShort(data.totalPayable)}</span>
      </div>
    </section>
  );
}
