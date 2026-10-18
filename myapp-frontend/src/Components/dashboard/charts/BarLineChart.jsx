// Bars (series) + optional line over a category axis. data: [{ label, ...series keys }].
// series: [{ key, label, colorKey, type?: "bar"|"line", axis?: "left"|"right", format? }];
// a series on the right axis (e.g. a margin %) gets its own scale. Click a bar -> onBarClick(datum).
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { chartPalette, formatMoneyShort } from "../chartTheme";

export default function BarLineChart({ data, series, onBarClick, ariaLabel, xKey = "label" }) {
  const p = chartPalette();
  const right = series.find((s) => s.axis === "right");
  const fmtFor = (key) => series.find((s) => s.key === key)?.format || formatMoneyShort;
  const tip = { contentStyle: { background: p.card, color: p.ink, border: `1px solid ${p.grid}` }, formatter: (v, n, item) => fmtFor(item?.dataKey)(v) };
  const axisOf = (s) => (s.axis === "right" ? "right" : "left");
  return (
    <div role="img" aria-label={ariaLabel} style={{ width: "100%", height: "100%" }}>
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={p.grid} vertical={false} yAxisId="left" />
        <XAxis dataKey={xKey} tick={{ fill: p.text, fontSize: 11 }} />
        <YAxis yAxisId="left" tickFormatter={formatMoneyShort} tick={{ fill: p.text, fontSize: 11 }} width={64} />
        {right && <YAxis yAxisId="right" orientation="right" tickFormatter={right.format || formatMoneyShort} tick={{ fill: p.text, fontSize: 11 }} width={44} />}
        <Tooltip {...tip} />
        <Legend />
        {series.map((s) => s.type === "line"
          ? <Line key={s.key} yAxisId={axisOf(s)} dataKey={s.key} name={s.label} stroke={p[s.colorKey] || p.primary} strokeWidth={2} dot={false} connectNulls />
          : <Bar key={s.key} yAxisId={axisOf(s)} dataKey={s.key} name={s.label} fill={p[s.colorKey] || p.primary} radius={[4, 4, 0, 0]} cursor={onBarClick ? "pointer" : undefined} onClick={onBarClick ? (d) => onBarClick(d.payload ?? d) : undefined} />)}
      </ComposedChart>
    </ResponsiveContainer>
    </div>
  );
}
