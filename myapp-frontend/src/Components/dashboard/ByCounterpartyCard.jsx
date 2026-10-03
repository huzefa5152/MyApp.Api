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
import { Card } from "../../ui/Kit";

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

  // Kit Card — surface, head and padding follow the theme tokens. The
  // marginTop reset keeps grid siblings aligned (kit adds a gap between
  // stacked cards).
  const cardTitle = <TitleWithSwatch title={title} accent={accent} />;

  if (list.length === 0) {
    return (
      <Card className="dash-card" title={cardTitle} style={{ "--acc": accent, marginTop: 0, overflow: "hidden" }}>
        <Subtitle text={subtitle} />
        <div style={{ fontSize: "var(--k-font)", color: "var(--k-muted)", fontStyle: "italic", padding: "1.25rem 0", textAlign: "center" }}>
          {emptyText}
        </div>
      </Card>
    );
  }

  return (
    <Card className="dash-card" title={cardTitle} style={{ "--acc": accent, marginTop: 0, overflow: "hidden" }}>
      <Subtitle text={subtitle} />

      {/* auto-fit collapses to one column on phones; padding comes from the Card body. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
        gap: "var(--k-gap)",
        alignItems: "center",
      }}>
        {/* Donut */}
        <div className="dash-cp-donut-wrap" style={{ minWidth: 0 }}>
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
        <div className="dash-cp-list" style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.4rem",
          maxHeight: 330,
          overflowY: "auto",
          // Custom thin scrollbar to match the rest of the app
          scrollbarWidth: "thin",
          scrollbarColor: `${accent}aa var(--k-surface-3)`,
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
                className="dash-cp-row"
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
                  borderRadius: "calc(var(--k-radius) - 2px)",
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  width: "100%",
                  // Override the global button rule (shadow / lift).
                  boxShadow: "none",
                  transform: "none",
                  transition: "background 0.12s, border-color 0.12s",
                }}
                title={`${it.name}: Rs. ${Number(it.value).toLocaleString("en-PK", { maximumFractionDigits: 0 })} (${pct.toFixed(1)}%)`}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: 2,
                  backgroundColor: rowColors[idx],
                  flexShrink: 0,
                }} aria-hidden="true" />
                <span className="dash-cp-row__name" style={{
                  flex: 1, minWidth: 0,
                  fontSize: "var(--k-td-font)",
                  fontWeight: 600,
                  color: "var(--k-ink)",
                  // Bug 2026-05-13: nowrap + ellipsis collapsed names
                  // like "NORTHSIDE FABRICS (Pvt) Ltd." and "NORTHSIDE DENIM
                  // MILLS (Pvt) Ltd." to identical-looking "NORTHSIDE ..." on the
                  // narrow list column, making distinct clients look
                  // like duplicates. Allow up to 2 lines so the
                  // disambiguating word stays visible without forcing
                  // a wider layout.
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  lineHeight: 1.25,
                  wordBreak: "break-word",
                }}>
                  <span style={{ color: "var(--k-muted)", fontSize: "0.75rem", marginRight: "0.4rem" }}>#{idx + 1}</span>
                  {it.name || "(unknown)"}
                </span>
                <span className="dash-cp-row__pct" style={{
                  fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontVariantNumeric: "tabular-nums",
                  fontSize: "0.76rem",
                  color: "var(--k-muted)",
                  flexShrink: 0,
                  width: 48,
                  textAlign: "right",
                }}>
                  {pct.toFixed(1)}%
                </span>
                <span className="dash-cp-row__value" style={{
                  fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontVariantNumeric: "tabular-nums",
                  fontSize: "var(--k-td-font)",
                  fontWeight: 600,
                  color: "var(--k-ink)",
                  flexShrink: 0,
                }}>
                  {formatPkr(it.value)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function TitleWithSwatch({ title, accent }) {
  return (
    <>
      <span style={{
        display: "inline-flex", width: 10, height: 10, borderRadius: 3,
        background: accent, boxShadow: `0 0 0 4px ${accent}1a`,
        flexShrink: 0, marginRight: "0.1rem",
      }} aria-hidden="true" />
      {title}
    </>
  );
}

function Subtitle({ text }) {
  if (!text) return null;
  return (
    <div style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)", margin: "0 0 calc(var(--k-gap) * 0.6)" }}>
      {text}
    </div>
  );
}
