// Donut + sortable list combo. Used for both "Sales by Client" and
// "Purchases by Supplier" — symmetric layout, just different titles
// and accent colors.
//
// Mobile-first layout:
//   • Phone: donut on top, list below (single column)
//   • Tablet+: donut on left (auto-width), list on right (flex: 1)
//
// Hover/tap on a list row → highlights the matching donut segment.
// Hover/tap on a donut segment → emphasises that row in the list.
// Both directions share a single `highlightIndex` state.

import { useState, useMemo } from "react";
import DonutChart, { DONUT_PALETTE, DONUT_OTHERS_COLOR } from "./DonutChart";

function formatPkr(v) {
  if (v == null || isNaN(v)) return "—";
  return `Rs. ${Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

export default function ByCounterpartyCard({
  // [{ id, name, value, count }] — sorted desc by value.
  items,
  // Color used for accents not coming from the palette (the title
  // strip, the "showing N of M" caption, etc).
  accent,
  // Title shown to the user. Subtitle below.
  title = "Sales by Client",
  subtitle = "",
  // Up to N segments shown individually; the rest fold into "Others".
  topN = 8,
  // Force a particular total for percentages — falls back to sum of
  // visible items.
  totalOverride,
  emptyText = "No activity in this period.",
}) {
  const list = Array.isArray(items) ? items : [];
  const [highlight, setHighlight] = useState(null);

  const total = totalOverride ?? list.reduce((acc, it) => acc + (Number(it.value) || 0), 0);

  // Map row index to the colour the donut will use for the
  // matching segment. Rows beyond topN share the "Others" colour.
  const rowColors = useMemo(() => {
    return list.map((_, i) => i < topN ? DONUT_PALETTE[i % DONUT_PALETTE.length] : DONUT_OTHERS_COLOR);
  }, [list, topN]);

  if (list.length === 0) {
    return (
      <section style={{
        background: "#fff",
        border: "1px solid #e8edf3",
        borderRadius: 14,
        padding: "0.85rem 1rem",
        boxShadow: "0 1px 2px rgba(13, 71, 161, 0.04)",
      }}>
        <Header title={title} subtitle={subtitle} accent={accent} />
        <div style={{ fontSize: "0.85rem", color: "#5f6d7e", fontStyle: "italic", padding: "1rem 0", textAlign: "center" }}>
          {emptyText}
        </div>
      </section>
    );
  }

  return (
    <section style={{
      background: "#fff",
      border: "1px solid #e8edf3",
      borderRadius: 14,
      padding: 0,
      boxShadow: "0 1px 2px rgba(13, 71, 161, 0.04)",
      overflow: "hidden",
    }}>
      <Header title={title} subtitle={subtitle} accent={accent} />

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
        gap: "1rem",
        padding: "0.85rem 1rem 1rem",
        alignItems: "center",
      }}>
        {/* Donut */}
        <div style={{ minWidth: 0 }}>
          <DonutChart
            items={list}
            topN={topN}
            total={total}
            highlightIndex={highlight}
            onSegmentClick={(idx) => setHighlight((cur) => (cur === idx ? null : idx))}
            size={220}
            centerLabel="Total"
            formatValue={(v) => `Rs. ${Number(v || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`}
          />
        </div>

        {/* List */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.4rem",
          maxHeight: 330,
          overflowY: "auto",
          // Custom thin scrollbar to match the rest of the app
          scrollbarWidth: "thin",
          scrollbarColor: `${accent}aa #f1f1f1`,
          paddingRight: "0.25rem",
        }}>
          {list.map((it, idx) => {
            // Rows beyond topN map to the synthetic Others bucket
            // (originalIndex = -1 in the donut). We highlight every
            // such row when the Others segment is hovered.
            const isOthers = idx >= topN;
            const isHi = highlight === idx || (isOthers && highlight === -1);
            const pct = total > 0 ? (Number(it.value) / total) * 100 : 0;
            return (
              <button
                type="button"
                key={`${it.id}-${idx}`}
                onMouseEnter={() => setHighlight(isOthers ? -1 : idx)}
                onMouseLeave={() => setHighlight(null)}
                onClick={() => setHighlight((cur) => {
                  const target = isOthers ? -1 : idx;
                  return cur === target ? null : target;
                })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.45rem 0.55rem",
                  background: isHi ? `${accent}10` : "transparent",
                  border: isHi ? `1px solid ${accent}55` : "1px solid transparent",
                  borderRadius: 8,
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  width: "100%",
                  transition: "background 0.12s, border-color 0.12s",
                }}
                title={`${it.name}: Rs. ${Number(it.value).toLocaleString("en-PK", { maximumFractionDigits: 0 })} (${pct.toFixed(1)}%)`}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: 2,
                  backgroundColor: rowColors[idx],
                  flexShrink: 0,
                }} aria-hidden="true" />
                <span style={{
                  flex: 1, minWidth: 0,
                  fontSize: "0.83rem",
                  fontWeight: 600,
                  color: "#1a2332",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  <span style={{ color: "#5f6d7e", fontSize: "0.75rem", marginRight: "0.4rem" }}>#{idx + 1}</span>
                  {it.name || "(unknown)"}
                </span>
                <span style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: "0.78rem",
                  color: "#5f6d7e",
                  flexShrink: 0,
                  width: 48,
                  textAlign: "right",
                }}>
                  {pct.toFixed(1)}%
                </span>
                <span style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "#1a2332",
                  flexShrink: 0,
                }}>
                  {formatPkr(it.value)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Header({ title, subtitle, accent }) {
  return (
    <header style={{
      padding: "0.7rem 1rem",
      borderBottom: "1px solid #eef2f7",
      background: `linear-gradient(90deg, ${accent}14 0%, transparent 100%)`,
    }}>
      <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "#1a2332" }}>
        <span style={{
          display: "inline-block", width: 4, height: 14, borderRadius: 2,
          backgroundColor: accent, marginRight: "0.5rem", verticalAlign: "middle",
        }} />
        {title}
      </h2>
      {subtitle && (
        <div style={{ fontSize: "0.75rem", color: "#5f6d7e", marginTop: "0.15rem", marginLeft: "0.65rem" }}>
          {subtitle}
        </div>
      )}
    </header>
  );
}
