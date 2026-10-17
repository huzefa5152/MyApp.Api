// Bars (series) + optional line over a category axis. data: [{ label, ...series keys }].
// series: [{ key, label, colorKey, type?: "bar"|"line" }]; click a bar -> onBarClick(datum).
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { chartPalette, formatMoneyShort } from "../chartTheme";

export default function BarLineChart({ data, series, onBarClick, xKey = "label" }) {
  const p = chartPalette();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={p.grid} vertical={false} />
        <XAxis dataKey={xKey} tick={{ fill: p.text, fontSize: 11 }} />
        <YAxis tickFormatter={formatMoneyShort} tick={{ fill: p.text, fontSize: 11 }} width={64} />
        <Tooltip formatter={(v) => formatMoneyShort(v)} />
        <Legend />
        {series.map((s) => s.type === "line"
          ? <Line key={s.key} dataKey={s.key} name={s.label} stroke={p[s.colorKey] || p.primary} strokeWidth={2} dot={false} />
          : <Bar key={s.key} dataKey={s.key} name={s.label} fill={p[s.colorKey] || p.primary} radius={[4, 4, 0, 0]} cursor={onBarClick ? "pointer" : undefined} onClick={onBarClick ? (d) => onBarClick(d.payload ?? d) : undefined} />)}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
