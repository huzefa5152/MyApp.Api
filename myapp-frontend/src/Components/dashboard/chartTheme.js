// Dependency-free (no React) so node tests can import it.
export const PALETTE_FALLBACK = {
  primary: "#0d47a1", secondary: "#00897b", positive: "#15803d",
  negative: "#c62828", warn: "#b45309", grid: "#e6ecf4", text: "#5f6d7e",
  card: "#ffffff", ink: "#0c1830",
};

// Reads --dash-<key> from :root; a blank/missing variable (or no DOM) falls back.
export function chartPalette() {
  if (typeof document === "undefined") return { ...PALETTE_FALLBACK };
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const k of Object.keys(PALETTE_FALLBACK)) {
    out[k] = cs.getPropertyValue(`--dash-${k}`).trim() || PALETTE_FALLBACK[k];
  }
  return out;
}

// PK short form: >= 1 crore -> "12.3 crore", >= 1 lakh -> "12.3 lakh", else full grouping.
export function formatMoneyShort(n) {
  if (n == null || isNaN(n)) return "—";
  const v = Number(n), a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(1)} crore`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(1)} lakh`;
  return v.toLocaleString("en-PK", { maximumFractionDigits: 0 });
}
