// Reusable status pill. Centralised palette so colours stay consistent
// across Challans, Bills, Invoices, Purchase Bills, Goods Receipts.
// Pass `tone` for one of the presets, or `bg`/`color`/`border` to override.
import "../ui/shared-components.css";

export const statusTones = {
  pending: { bg: "var(--k-warn-bg)", color: "var(--k-warn)", border: "#e6510030" },
  imported: { bg: "var(--k-purple-bg-2)", color: "var(--k-purple-3)", border: "#6a1b9a30" },
  info: { bg: "var(--k-info-bg)", color: "var(--k-blue)", border: "#0d47a130" },
  success: { bg: "var(--k-success-bg)", color: "var(--k-success)", border: "#2e7d3230" },
  danger: { bg: "var(--k-danger-bg-2)", color: "var(--k-danger-ink)", border: "#c6282830" },
  warning: { bg: "var(--k-warn-bg-2)", color: "var(--k-warn-ink-3)", border: "#b26a0030" },
  neutral: { bg: "var(--k-slate-bg)", color: "#546e7a", border: "#b0bec530" },
  setup: { bg: "#fce4ec", color: "#880e4f", border: "#880e4f30" },
  duplicate: { bg: "var(--k-purple-bg)", color: "var(--k-purple)", border: "#4527a040" },
  submitted: { bg: "var(--k-success-bg)", color: "var(--k-success-strong)", border: "#1b5e2030" },
  ready: { bg: "var(--k-info-bg)", color: "var(--k-blue)", border: "#0d47a130" },
  excluded: { bg: "var(--k-slate-bg)", color: "#455a64", border: "#45596430" },
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
  Submitting: "info",
  Uncertain: "warning",
  Validated: "ready",
  Failed: "danger",
  Open: "info",
  Closed: "neutral",
  Reconciled: "success",
  Partial: "warning",
  "Partially billed": "warning",
};

export function toneForStatus(status) {
  if (!status) return "neutral";
  return statusToTone[status] || "neutral";
}

export default function StatusBadge({ tone, status, children, style, title }) {
  const resolvedTone = tone || toneForStatus(status);
  const palette = statusTones[resolvedTone] || statusTones.neutral;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        // Size tokens: Classic falls back to the original values; Workspace sets them
        // in ui/shared-components.css.
        fontSize: "var(--sc-badge-font, 0.72rem)",
        fontWeight: 700,
        padding: "var(--sc-badge-pad, 0.2rem 0.6rem)",
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
