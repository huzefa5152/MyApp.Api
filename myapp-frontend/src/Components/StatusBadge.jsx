// Reusable status pill. Centralised palette so colours stay consistent
// across Challans, Bills, Invoices, Purchase Bills, Goods Receipts.
// Pass `tone` for one of the presets, or `bg`/`color`/`border` to override.

const tones = {
  pending:    { bg: "#fff3e0", color: "#e65100", border: "#e6510030" },
  imported:   { bg: "#f3e5f5", color: "#6a1b9a", border: "#6a1b9a30" },
  info:       { bg: "#e3f2fd", color: "#0d47a1", border: "#0d47a130" },
  success:    { bg: "#e8f5e9", color: "#2e7d32", border: "#2e7d3230" },
  danger:     { bg: "#ffebee", color: "#c62828", border: "#c6282830" },
  warning:    { bg: "#fff8e1", color: "#b26a00", border: "#b26a0030" },
  neutral:    { bg: "#eceff1", color: "#546e7a", border: "#b0bec530" },
  setup:      { bg: "#fce4ec", color: "#880e4f", border: "#880e4f30" },
  duplicate:  { bg: "#ede7f6", color: "#4527a0", border: "#4527a040" },
  submitted:  { bg: "#e8f5e9", color: "#1b5e20", border: "#1b5e2030" },
  ready:      { bg: "#e3f2fd", color: "#0d47a1", border: "#0d47a130" },
  excluded:   { bg: "#eceff1", color: "#455a64", border: "#45596430" },
};

// Status string → tone — covers every server status name in this app.
// Anything not matched falls back to "neutral".
const statusToTone = {
  Pending: "pending",
  Imported: "imported",
  "No PO": "info",
  Invoiced: "success",
  Billed: "success",
  Cancelled: "danger",
  "Setup Required": "setup",
  Submitted: "submitted",
  Validated: "ready",
  Failed: "danger",
  Open: "info",
  Closed: "neutral",
  Reconciled: "success",
  Partial: "warning",
};

export function toneForStatus(status) {
  if (!status) return "neutral";
  return statusToTone[status] || "neutral";
}

export default function StatusBadge({ tone, status, children, style, title }) {
  const resolvedTone = tone || toneForStatus(status);
  const palette = tones[resolvedTone] || tones.neutral;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: "0.72rem",
        fontWeight: 700,
        padding: "0.2rem 0.6rem",
        borderRadius: 20,
        whiteSpace: "nowrap",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        backgroundColor: palette.bg,
        color: palette.color,
        border: `1px solid ${palette.border}`,
        ...(style || {}),
      }}
    >
      {children ?? status}
    </span>
  );
}
