// Title row: company (picker when there is more than one), period picker (+ custom range), as-of stamp.
const PERIODS = [
  ["this-week", "This week"], ["last-week", "Last week"], ["this-month", "This month"], ["last-month", "Last month"],
  ["this-year", "This year"], ["last-year", "Last year"], ["all-time", "All time"], ["custom", "Custom range"],
];
const field = { minHeight: 44, padding: "0 0.6rem", borderRadius: 8, border: "1px solid var(--dash-grid)", background: "var(--dash-card)", color: "var(--dash-ink)", fontSize: "0.85rem" };

export default function DashboardHeader({ company, companies, onCompanyChange, period, from, to, onChange, asOf }) {
  return (
    <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, overflowWrap: "anywhere" }}>{company?.name || "Dashboard"}</h2>
        {asOf && <div style={{ fontSize: "0.75rem", color: "var(--dash-text)" }}>As of {asOf}</div>}
      </div>
      {onCompanyChange && companies?.length > 1 && (
        <select aria-label="Company" value={company?.id ?? ""} onChange={(e) => onCompanyChange(Number(e.target.value))} style={{ ...field, flex: "1 1 180px", maxWidth: 260 }}>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      <select aria-label="Period" value={period} onChange={(e) => onChange(e.target.value === "custom" ? { period: "custom", from, to } : { period: e.target.value })} style={{ ...field, flex: "1 1 160px", maxWidth: 260 }}>
        {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {period === "custom" && (
        <>
          <input aria-label="From" type="date" value={from || ""} onChange={(e) => onChange({ period: "custom", from: e.target.value, to })} style={{ ...field, flex: "1 1 140px" }} />
          <input aria-label="To" type="date" value={to || ""} onChange={(e) => onChange({ period: "custom", from, to: e.target.value })} style={{ ...field, flex: "1 1 140px" }} />
        </>
      )}
    </header>
  );
}
