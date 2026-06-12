// src/Components/BrandMark.jsx
// Hakimi Traders logomark — a machined hex nut with a center bore.
// Pure inline SVG so it scales crisply anywhere (navbar, footer, hero).
export default function BrandMark({ size = 32, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="bm-grad" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22e0ff" />
          <stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      {/* hex body */}
      <path
        d="M24 3.5 41.5 13.6v20.8L24 44.5 6.5 34.4V13.6L24 3.5Z"
        stroke="url(#bm-grad)"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      {/* bore */}
      <circle cx="24" cy="24" r="8.2" stroke="url(#bm-grad)" strokeWidth="2.6" />
      <circle cx="24" cy="24" r="2.6" fill="url(#bm-grad)" />
    </svg>
  );
}
