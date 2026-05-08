// Inline-SVG donut chart. No external deps — small bundle, full
// mobile control via 100% width + viewBox aspect lock.
//
// Top N items render as proportional segments; everything beyond N
// gets folded into a single "Others" segment so the chart stays
// readable for tenants with long-tail client lists.
//
// Mobile-first:
//   • SVG scales to its parent container's width (preserveAspectRatio)
//   • Center label uses clamp() font-sizing so big-screen / phone
//     both look right without media queries
//   • Hover/highlight state is a single index — works the same on
//     touch (tap to highlight) and pointer.

import { useMemo } from "react";

// Curated 8-color rotation — distinguishable, accessible, brand-tuned.
// Same palette is used across donut + list rows so the eye can
// track segment ↔ row easily.
const COLORS = [
  "#0d47a1", // deep blue
  "#00897b", // teal
  "#6a1b9a", // purple
  "#e65100", // amber
  "#2e7d32", // green
  "#c62828", // red
  "#0277bd", // light blue
  "#5d4037", // brown
];
const OTHERS_COLOR = "#9e9e9e";

export const DONUT_PALETTE = COLORS;
export const DONUT_OTHERS_COLOR = OTHERS_COLOR;

export default function DonutChart({
  // [{ id, name, value }] — already sorted desc by value.
  items,
  // Anything beyond this rank is folded into "Others".
  topN = 8,
  // Total to use for the percentages — defaults to sum of items.
  // Pass an explicit total when you want percentages relative to
  // an outer aggregate (e.g. period total) rather than the visible
  // slice.
  total: explicitTotal,
  // Index of the segment to emphasise (1.05× scale + thicker stroke).
  // null = no emphasis.
  highlightIndex = null,
  // Click handler with the *original* item index (or the synthetic
  // "others" sentinel `-1` when the Others wedge is clicked).
  onSegmentClick,
  // Diameter — the SVG fits this in CSS px on the smallest axis.
  size = 200,
  // Format function for the center value — money by default.
  centerLabel = "Total",
  formatValue = (v) => Number(v || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 }),
}) {
  const list = Array.isArray(items) ? items : [];

  // Group beyond topN into a synthetic "Others" entry. We keep the
  // original indices for the click handler so the parent can map
  // back to its data.
  const segments = useMemo(() => {
    if (list.length === 0) return [];
    const head = list.slice(0, topN).map((it, idx) => ({
      key: `seg-${idx}`,
      name: it.name || "(unknown)",
      value: Number(it.value) || 0,
      color: COLORS[idx % COLORS.length],
      originalIndex: idx,
    }));
    if (list.length > topN) {
      const tail = list.slice(topN);
      const tailValue = tail.reduce((acc, it) => acc + (Number(it.value) || 0), 0);
      if (tailValue > 0) {
        head.push({
          key: "seg-others",
          name: `+${tail.length} others`,
          value: tailValue,
          color: OTHERS_COLOR,
          originalIndex: -1,
        });
      }
    }
    return head;
  }, [list, topN]);

  const total = explicitTotal ?? segments.reduce((acc, s) => acc + s.value, 0);

  // Empty state — render a flat ring so card height stays consistent.
  if (segments.length === 0 || total <= 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem 0" }}>
        <svg width={size} height={size} viewBox="0 0 100 100" style={{ maxWidth: "100%" }}>
          <circle cx="50" cy="50" r="38" fill="none" stroke="#eef2f7" strokeWidth="14" />
          <text x="50" y="48" textAnchor="middle" fontSize="9" fill="#5f6d7e">No data</text>
          <text x="50" y="58" textAnchor="middle" fontSize="6" fill="#9aa3ad">in this period</text>
        </svg>
      </div>
    );
  }

  // Compute SVG arc paths. We use a viewBox of 100×100; outer radius
  // 38, inner radius 26 — a 12-unit donut ring. Each segment's arc
  // is `M outerStart A outerR L innerEnd A innerR Z`.
  const cx = 50, cy = 50, rOuter = 38, rInner = 26;
  let cumulative = 0;
  const paths = segments.map((s, i) => {
    const fraction = total > 0 ? s.value / total : 0;
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    cumulative += fraction;
    const endAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    const isHighlighted = highlightIndex === s.originalIndex;
    return arcPath({ startAngle, endAngle, cx, cy, rOuter, rInner, isHighlighted, color: s.color, key: s.key, fraction, segment: s });
  });

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={{ maxWidth: "100%", display: "block" }}
        role="img"
        aria-label="Donut chart"
      >
        <g>
          {paths.map(({ d, color, isHighlighted, segment }) => (
            <path
              key={segment.key}
              d={d}
              fill={color}
              fillOpacity={isHighlighted ? 1 : 0.92}
              stroke={isHighlighted ? "#1a2332" : "#fff"}
              strokeWidth={isHighlighted ? 0.6 : 0.4}
              style={{ cursor: onSegmentClick ? "pointer" : "default", transition: "fill-opacity 0.15s" }}
              onClick={() => onSegmentClick?.(segment.originalIndex)}
            >
              <title>{segment.name}: {formatValue(segment.value)} ({((segment.value / total) * 100).toFixed(1)}%)</title>
            </path>
          ))}
        </g>
        {/* Center label — total + caption */}
        <text x={cx} y={cy - 1} textAnchor="middle" fontSize="9" fontWeight="800" fill="#1a2332" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          {formatValue(total)}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize="4.5" fill="#5f6d7e" style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {centerLabel}
        </text>
      </svg>
    </div>
  );
}

// SVG arc-segment path. Handles full-circle case (single 100% segment)
// with two half-arcs because a single arc with start === end is a
// no-op.
function arcPath({ startAngle, endAngle, cx, cy, rOuter, rInner, isHighlighted, color, key, fraction, segment }) {
  const largeArc = fraction > 0.5 ? 1 : 0;

  // Apply a tiny radial offset for the highlighted segment — gives a
  // gentle "pulled-out" feel without breaking the layout.
  const r = isHighlighted ? rOuter + 0.7 : rOuter;
  const ri = isHighlighted ? rInner - 0.5 : rInner;

  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const xi1 = cx + ri * Math.cos(endAngle);
  const yi1 = cy + ri * Math.sin(endAngle);
  const xi2 = cx + ri * Math.cos(startAngle);
  const yi2 = cy + ri * Math.sin(startAngle);

  // Full-circle (single segment owns 100%) — split into two half-arcs
  // so the path renders.
  if (fraction >= 0.999) {
    const xMid = cx + r * Math.cos(startAngle + Math.PI);
    const yMid = cy + r * Math.sin(startAngle + Math.PI);
    const xiMid = cx + ri * Math.cos(startAngle + Math.PI);
    const yiMid = cy + ri * Math.sin(startAngle + Math.PI);
    const d =
      `M ${x1.toFixed(3)} ${y1.toFixed(3)} ` +
      `A ${r} ${r} 0 0 1 ${xMid.toFixed(3)} ${yMid.toFixed(3)} ` +
      `A ${r} ${r} 0 0 1 ${x2.toFixed(3)} ${y2.toFixed(3)} ` +
      `L ${xi1.toFixed(3)} ${yi1.toFixed(3)} ` +
      `A ${ri} ${ri} 0 0 0 ${xiMid.toFixed(3)} ${yiMid.toFixed(3)} ` +
      `A ${ri} ${ri} 0 0 0 ${xi2.toFixed(3)} ${yi2.toFixed(3)} Z`;
    return { d, color, isHighlighted, segment };
  }

  const d =
    `M ${x1.toFixed(3)} ${y1.toFixed(3)} ` +
    `A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} ` +
    `L ${xi1.toFixed(3)} ${yi1.toFixed(3)} ` +
    `A ${ri} ${ri} 0 ${largeArc} 0 ${xi2.toFixed(3)} ${yi2.toFixed(3)} Z`;

  return { d, color, isHighlighted, segment };
}
