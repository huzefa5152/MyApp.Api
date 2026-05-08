// Hero KPI card — large value, optional subtitle, optional delta vs
// previous period, optional sparkline.
//
// Mobile-first: card is full-width on small screens; the parent grid
// handles the multi-column layout at md breakpoint via
// minmax(min-content, 1fr) auto-fit. No media queries here.
import { MdTrendingUp, MdTrendingDown, MdTrendingFlat } from "react-icons/md";
import Sparkline from "./Sparkline";

function formatPkr(v) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 });
}

function formatPct(v) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

export default function KpiCard({
  label,
  value,
  prevValue,
  // Color of the accent strip + sparkline. Each section uses its own.
  accent = "#0d47a1",
  // Override formatter for non-money values (counts, etc).
  format = formatPkr,
  // 12-point trend array for the sparkline. Optional.
  trend = null,
  // Whether higher = better for the delta arrow direction. Sales: yes.
  // For tax owed: would be false (less owed is good).
  higherIsBetter = true,
  // Tooltip for the whole card.
  title = "",
  // Icon shown next to the label.
  icon = null,
}) {
  // Compute % delta vs previous when both numbers are available.
  let deltaPct = null;
  if (prevValue != null && prevValue !== 0) {
    deltaPct = ((value - prevValue) / Math.abs(prevValue)) * 100;
  } else if (prevValue === 0 && value > 0) {
    // From zero — show "new" instead of percent.
    deltaPct = Infinity;
  }

  // Pick the colour + icon based on direction × goodness.
  let deltaColor = "#5f6d7e";
  let deltaIcon = MdTrendingFlat;
  if (deltaPct != null && deltaPct !== 0 && deltaPct !== Infinity) {
    const positive = deltaPct > 0;
    const good = higherIsBetter ? positive : !positive;
    deltaColor = good ? "#2e7d32" : "#c62828";
    deltaIcon = positive ? MdTrendingUp : MdTrendingDown;
  } else if (deltaPct === Infinity) {
    deltaColor = "#2e7d32";
    deltaIcon = MdTrendingUp;
  }
  const DeltaIconComp = deltaIcon;

  return (
    <div
      className="dash-kpi-card"
      style={{
        position: "relative",
        background: `
          radial-gradient(circle at 100% 0%, ${accent}14 0%, transparent 55%),
          linear-gradient(160deg, #ffffff 0%, ${accent}06 100%)
        `,
        border: `1px solid ${accent}26`,
        borderRadius: 14,
        padding: "0.95rem 1.05rem 0.85rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        overflow: "hidden",
        minHeight: 132,
        boxShadow: `0 4px 14px -6px ${accent}40, 0 1px 2px rgba(13, 71, 161, 0.04)`,
      }}
      title={title}
    >
      {/* Top accent strip — keeps section identity readable at a glance,
          even when the card is collapsed under its peers on mobile. */}
      <div style={{
        position: "absolute", inset: "0 0 auto 0", height: 4,
        background: `linear-gradient(90deg, ${accent} 0%, ${accent}cc 50%, ${accent}66 100%)`,
      }} />

      <div className="dash-kpi-card__label" style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#5f6d7e", fontSize: "0.74rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {icon && (
          <span className="dash-kpi-card__icon" style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 24, height: 24, borderRadius: 7,
            background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`,
            color: "#fff",
            boxShadow: `0 3px 8px -2px ${accent}55`,
            flexShrink: 0,
          }}>{icon}</span>
        )}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>

      <div className="dash-kpi-card__value" style={{ fontSize: "clamp(1.25rem, 4.2vw, 1.85rem)", fontWeight: 800, color: "#0f1724", lineHeight: 1.1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
        {format(value)}
      </div>

      {(deltaPct != null) && (
        <div className="dash-kpi-card__delta" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", color: deltaColor, fontSize: "0.78rem", fontWeight: 600 }}>
          <DeltaIconComp size={14} />
          {deltaPct === Infinity ? "new" : formatPct(deltaPct)}
          <span className="dash-kpi-card__delta-suffix" style={{ color: "#5f6d7e", fontWeight: 400 }}> vs prev</span>
        </div>
      )}

      {Array.isArray(trend) && trend.length > 0 && (
        <div style={{ marginTop: "auto" }}>
          <Sparkline data={trend.map((t) => Number(t.value || 0))} color={accent} height={32} />
        </div>
      )}
    </div>
  );
}
