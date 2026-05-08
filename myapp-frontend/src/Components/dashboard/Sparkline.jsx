// Inline-SVG sparkline. No external deps; renders fine on mobile
// because we control the viewBox. Accepts an array of numbers and
// auto-scales to the container width via 100%.
//
// Mobile-first: width is 100%, intrinsic aspect via viewBox keeps
// the line proportions correct at every breakpoint without media
// queries.

export default function Sparkline({
  data,
  color = "#0d47a1",
  height = 36,
  showFill = true,
}) {
  const points = Array.isArray(data) && data.length > 0 ? data : [];
  if (points.length < 2) {
    // One or zero data points — render an empty baseline so the card
    // height stays consistent with sibling cards.
    return (
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
        <line x1="0" y1={height / 2} x2="100" y2={height / 2} stroke="#e0e0e0" strokeWidth="1" />
      </svg>
    );
  }

  const max = Math.max(...points, 1);  // avoid div-by-zero on all-zero input
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const stepX = 100 / (points.length - 1);
  const padTop = 2;
  const drawHeight = height - padTop * 2;

  // Map raw values to viewBox y coords. Higher value = lower y (SVG
  // origin is top-left).
  const coords = points.map((v, i) => {
    const x = i * stepX;
    const y = padTop + drawHeight - ((v - min) / range) * drawHeight;
    return [x, y];
  });

  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L 100 ${height - padTop} L 0 ${height - padTop} Z`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      {showFill && <path d={areaPath} fill={color} fillOpacity="0.12" />}
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
