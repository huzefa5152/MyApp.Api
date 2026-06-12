// Top-N list — used for "Top 5 clients", "Top 5 suppliers", "Top 5
// items by movement". Renders a clean ranked table with progress bars
// proportional to each row's share of the total.
//
// Mobile-first: rows stack vertically, value + secondary text wrap
// gracefully. No fixed widths; flex+gap does the work.

function formatNumber(v, mode) {
  if (v == null || isNaN(v)) return "—";
  if (mode === "money") return `Rs. ${Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
  return Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 });
}

export default function TopList({
  items,
  accent = "#0d47a1",
  // "money" formats as Rs. X,YYY ; "qty" or anything else as plain
  // numbers. Used for stock-movement top items where Value = qty.
  valueMode = "money",
  // Optional secondary metric label (e.g. "3 invoices") — falls back
  // to count if present.
  secondary = (it) => (it.count ? `${it.count} item${it.count !== 1 ? "s" : ""}` : ""),
  emptyText = "No data in this period.",
}) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return <div style={{ fontSize: "0.85rem", color: "#5f6d7e", fontStyle: "italic", padding: "0.5rem 0" }}>{emptyText}</div>;
  }
  const max = Math.max(...list.map((x) => Number(x.value) || 0), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
      {list.map((it, idx) => {
        const widthPct = (Number(it.value) / max) * 100;
        return (
          <div key={`${it.id}-${idx}`} style={{ display: "flex", flexDirection: "column", gap: "0.28rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#0c1830", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ fontFamily: '"IBM Plex Mono", ui-monospace, monospace', color: "#8593ab", fontSize: "0.72rem", marginRight: "0.45rem" }}>{String(idx + 1).padStart(2, "0")}</span>
                {it.name || "(unknown)"}
              </span>
              <span style={{ fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace', fontVariantNumeric: "tabular-nums", fontSize: "0.82rem", fontWeight: 600, color: "#0c1830", flexShrink: 0 }}>
                {formatNumber(it.value, valueMode)}
              </span>
            </div>
            {/* progress bar — proportion of #1's value */}
            <div style={{ height: 5, borderRadius: 99, backgroundColor: "#edf2f9", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${widthPct}%`, background: `linear-gradient(90deg, ${accent} 0%, ${accent}99 100%)`, borderRadius: 99 }} />
            </div>
            {secondary(it) && (
              <span style={{ fontSize: "0.73rem", color: "#69788f" }}>{secondary(it)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
