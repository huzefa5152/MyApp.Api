// Stacked bars per category. Same props as BarLineChart; every series stacks.
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { chartPalette, formatMoneyShort } from "../chartTheme";

export default function StackedBarChart({ data, series, onBarClick, xKey = "label" }) {
  const p = chartPalette();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={p.grid} vertical={false} />
        <XAxis dataKey={xKey} tick={{ fill: p.text, fontSize: 11 }} />
        <YAxis tickFormatter={formatMoneyShort} tick={{ fill: p.text, fontSize: 11 }} width={64} />
        <Tooltip formatter={(v) => formatMoneyShort(v)} />
        <Legend />
        {series.map((s) => <Bar key={s.key} stackId="a" dataKey={s.key} name={s.label} fill={p[s.colorKey] || p.primary} cursor={onBarClick ? "pointer" : undefined} onClick={onBarClick ? (d) => onBarClick(d.payload ?? d) : undefined} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}
