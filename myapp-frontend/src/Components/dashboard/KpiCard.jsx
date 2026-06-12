// Hero KPI card — large value, optional subtitle, optional delta vs
// previous period, optional sparkline.
//
// Mobile-first: card is full-width on small screens; the parent grid
// handles the multi-column layout at md breakpoint via
// minmax(min-content, 1fr) auto-fit. No media queries here.
//
// Presentation: calm white surface with a thin accent strip + tinted
// icon chip carrying the section identity (sales/purchases/fbr/inv).
// Hover lift + entrance animation live in DashboardPage.css via the
// .dash-kpi-card class; the accent reaches CSS through `--acc`.
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
  let deltaBg = "rgba(95, 109, 126, 0.10)";
  let deltaIcon = MdTrendingFlat;
  if (deltaPct != null && deltaPct !== 0 && deltaPct !== Infinity) {
    const positive = deltaPct > 0;
    const good = higherIsBetter ? positive : !positive;
    deltaColor = good ? "#15803d" : "#c62828";
    deltaBg = good ? "rgba(21, 128, 61, 0.10)" : "rgba(198, 40, 40, 0.09)";
    deltaIcon = positive ? MdTrendingUp : MdTrendingDown;
  } else if (deltaPct === Infinity) {
    deltaColor = "#15803d";
    deltaBg = "rgba(21, 128, 61, 0.10)";
    deltaIcon = MdTrendingUp;
  }
  const DeltaIconComp = deltaIcon;

  return (
    <div
      className="dash-kpi-card"
      style={{
        "--acc": accent,
        position: "relative",
        background: "#ffffff",
        border: "1px solid #e6ecf4",
        borderRadius: 16,
        padding: "1rem 1.1rem 0.9rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.55rem",
        overflow: "hidden",
        minHeight: 136,
        boxShadow: "0 1px 2px rgba(12, 24, 48, 0.04), 0 10px 28px -18px rgba(12, 24, 48, 0.18)",
      }}
      title={title}
    >
      {/* Thin accent strip — keeps section identity readable at a glance,
          even when the card is collapsed under its peers on mobile. */}
      <div style={{
        position: "absolute", inset: "0 auto auto 0", width: "100%", height: 3,
        background: `linear-gradient(90deg, ${accent} 0%, ${accent}99 45%, transparent 100%)`,
      }} />

      <div className="dash-kpi-card__label" style={{
        display: "flex",
        alignItems: "center",
        gap: "0.55rem",
        color: "#69788f",
        fontSize: "0.7rem",
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      }}>
        {icon && (
          <span className="dash-kpi-card__icon" style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 26, height: 26, borderRadius: 8,
            background: `${accent}14`,
            border: `1px solid ${accent}2e`,
            color: accent,
            flexShrink: 0,
          }}>{icon}</span>
        )}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>

      <div className="dash-kpi-card__value" style={{
        fontSize: "clamp(1.3rem, 4.2vw, 1.8rem)",
        fontWeight: 600,
        color: "#0c1830",
        lineHeight: 1.1,
        letterSpacing: "-0.01em",
        fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        fontVariantNumeric: "tabular-nums",
      }}>
        {format(value)}
      </div>

      {(deltaPct != null) && (
        <div className="dash-kpi-card__delta" style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          alignSelf: "flex-start",
          color: deltaColor,
          backgroundColor: deltaBg,
          borderRadius: 999,
          padding: "0.14rem 0.55rem 0.14rem 0.4rem",
          fontSize: "0.74rem",
          fontWeight: 700,
        }}>
          <DeltaIconComp size={13} />
          {deltaPct === Infinity ? "new" : formatPct(deltaPct)}
          <span className="dash-kpi-card__delta-suffix" style={{ color: "#69788f", fontWeight: 500 }}>vs prev</span>
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
