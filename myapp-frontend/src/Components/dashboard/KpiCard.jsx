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
      style={{
        position: "relative",
        background: "#fff",
        border: "1px solid #e8edf3",
        borderRadius: 14,
        padding: "1rem 1.1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.55rem",
        overflow: "hidden",
        minHeight: 140,
      }}
      title={title}
    >
      {/* Top accent strip — keeps section identity readable at a glance,
          even when the card is collapsed under its peers on mobile. */}
      <div style={{ position: "absolute", inset: "0 0 auto 0", height: 3, backgroundColor: accent }} />

      <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "#5f6d7e", fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.02em", textTransform: "uppercase" }}>
        {icon && <span style={{ display: "inline-flex", color: accent }}>{icon}</span>}
        <span>{label}</span>
      </div>

      <div style={{ fontSize: "clamp(1.2rem, 4.2vw, 1.8rem)", fontWeight: 800, color: "#1a2332", lineHeight: 1.1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
        {format(value)}
      </div>

      {(deltaPct != null) && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", color: deltaColor, fontSize: "0.78rem", fontWeight: 600 }}>
          <DeltaIconComp size={14} />
          {deltaPct === Infinity ? "new" : formatPct(deltaPct)}
          <span style={{ color: "#5f6d7e", fontWeight: 400 }}> vs prev</span>
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
