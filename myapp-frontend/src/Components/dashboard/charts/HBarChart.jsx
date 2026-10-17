// Horizontal ranked bars. data: [{ label, value }]; click a bar -> onBarClick(datum).
// Long names wrap to two lines in the axis tick (never nowrap + ellipsis).
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { chartPalette, formatMoneyShort } from "../chartTheme";

function Tick({ x, y, payload, fill }) {
  return (
    <foreignObject x={x - 124} y={y - 16} width={120} height={32}>
      <div style={{ color: fill, fontSize: 11, lineHeight: 1.2, textAlign: "right", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{payload.value}</div>
    </foreignObject>
  );
}

export default function HBarChart({ data, onBarClick, ariaLabel, colorKey = "primary", valueLabel = "Amount" }) {
  const p = chartPalette();
  const tip = { contentStyle: { background: p.card, color: p.ink, border: `1px solid ${p.grid}` }, formatter: (v) => formatMoneyShort(v) };
  return (
    <div role="img" aria-label={ariaLabel} style={{ width: "100%", height: "100%" }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={p.grid} horizontal={false} />
        <XAxis type="number" tickFormatter={formatMoneyShort} tick={{ fill: p.text, fontSize: 11 }} />
        <YAxis type="category" dataKey="label" width={128} tick={<Tick fill={p.text} />} interval={0} />
        <Tooltip {...tip} />
        <Bar dataKey="value" name={valueLabel} fill={p[colorKey] || p.primary} radius={[0, 4, 4, 0]} cursor={onBarClick ? "pointer" : undefined} onClick={onBarClick ? (d) => onBarClick(d.payload ?? d) : undefined} />
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}
