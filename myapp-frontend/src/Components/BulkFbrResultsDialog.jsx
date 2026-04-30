import { useMemo } from "react";
import { MdCheckCircle, MdError, MdInfo, MdBlock, MdClose } from "react-icons/md";
// Reuse the shared backdrop/modal so this dialog feels identical to every
// other popup (blurred backdrop, gradient header, non-movable, size tier).
import { formStyles, modalSizes } from "../theme";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  successBg: "#e8f5e9",
  successFg: "#2e7d32",
  failBg: "#ffebee",
  failFg: "#c62828",
  warnBg: "#fff8e1",
  warnFg: "#bf360c",
  skipBg: "#eceff1",
  skipFg: "#546e7a",
};

/**
 * Result of a bulk Validate All / Submit All run.
 *
 * Props:
 *   open    — boolean, controls visibility
 *   action  — "validate" | "submit"
 *   items   — Array<{ invoiceNumber, invoiceId, status, message, irn? }>
 *               status ∈ "passed" | "failed" | "already" | "skipped" | "submitted"
 *   onClose — () => void
 */
export default function BulkFbrResultsDialog({ open, action, items, onClose }) {
  // Hooks MUST run unconditionally on every render (Rules of Hooks) — keep
  // them above any early return so the hook count is stable when `open`
  // flips between true/false.
  const summary = useMemo(() => {
    const counts = { passed: 0, failed: 0, already: 0, skipped: 0, submitted: 0 };
    (items || []).forEach((it) => {
      if (counts[it.status] !== undefined) counts[it.status] += 1;
    });
    return counts;
  }, [items]);

  // Sort failed lines first so the operator can act on them straight away —
  // success rows are scanned visually but the failures are what matter.
  const sortedItems = useMemo(() => {
    const order = { failed: 0, skipped: 1, passed: 2, already: 3, submitted: 4 };
    return [...(items || [])].sort((a, b) => {
      const ai = order[a.status] ?? 99;
      const bi = order[b.status] ?? 99;
      if (ai !== bi) return ai - bi;
      return (b.invoiceNumber || 0) - (a.invoiceNumber || 0);
    });
  }, [items]);

  if (!open) return null;

  const title = action === "submit" ? "Submit to FBR — Results" : "Validate All — Results";
  const total = items?.length || 0;

  // Backdrop click is a no-op — operators may want to scroll the
  // results table; clicking outside accidentally shouldn't dismiss it.
  return (
    <div style={styles.backdrop}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>{title}</h3>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
            <MdClose size={20} />
          </button>
        </div>

        <div style={styles.summaryBar}>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Total</span>
            <span style={styles.summaryValue}>{total}</span>
          </div>
          {(summary.passed > 0 || action === "validate") && (
            <Pill color={colors.successFg} bg={colors.successBg} icon={<MdCheckCircle size={14} />}>
              {summary.passed} passed
            </Pill>
          )}
          {summary.submitted > 0 && (
            <Pill color={colors.successFg} bg={colors.successBg} icon={<MdCheckCircle size={14} />}>
              {summary.submitted} submitted
            </Pill>
          )}
          {summary.failed > 0 && (
            <Pill color={colors.failFg} bg={colors.failBg} icon={<MdError size={14} />}>
              {summary.failed} failed
            </Pill>
          )}
          {summary.already > 0 && (
            <Pill color={colors.skipFg} bg={colors.skipBg} icon={<MdInfo size={14} />}>
              {summary.already} already validated
            </Pill>
          )}
          {summary.skipped > 0 && (
            <Pill color={colors.warnFg} bg={colors.warnBg} icon={<MdBlock size={14} />}>
              {summary.skipped} not attempted
            </Pill>
          )}
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Bill #</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Details</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ ...styles.td, textAlign: "center", color: colors.textSecondary, padding: "1.5rem" }}>
                    No bills processed.
                  </td>
                </tr>
              )}
              {sortedItems.map((it, idx) => (
                <tr key={(it.invoiceId ?? idx) + "-" + idx}
                    style={{ backgroundColor: idx % 2 === 0 ? "#fff" : "#fafbfd" }}>
                  <td style={{ ...styles.td, fontWeight: 600, color: colors.blue, whiteSpace: "nowrap" }}>
                    #{it.invoiceNumber}
                  </td>
                  <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                    <StatusBadge status={it.status} />
                  </td>
                  <td style={styles.td}>
                    {it.status === "submitted" && it.irn ? (
                      <span style={{ fontFamily: "monospace", fontSize: "0.78rem", color: colors.textSecondary, wordBreak: "break-all" }}>
                        IRN: {it.irn}
                      </span>
                    ) : it.message ? (
                      <span style={{ fontSize: "0.82rem", color: it.status === "failed" ? colors.failFg : colors.textPrimary }}>
                        {it.message}
                      </span>
                    ) : (
                      <span style={{ color: colors.textSecondary, fontSize: "0.82rem" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={styles.footer}>
          <button style={styles.closeFooterBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Pill({ color, bg, icon, children }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.3rem",
      padding: "0.25rem 0.65rem", borderRadius: 999,
      backgroundColor: bg, color, fontSize: "0.78rem", fontWeight: 700,
    }}>
      {icon}
      {children}
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    passed:    { fg: colors.successFg, bg: colors.successBg, label: "Passed",          icon: <MdCheckCircle size={13} /> },
    submitted: { fg: colors.successFg, bg: colors.successBg, label: "Submitted",       icon: <MdCheckCircle size={13} /> },
    already:   { fg: colors.skipFg,    bg: colors.skipBg,    label: "Already valid",   icon: <MdInfo size={13} /> },
    failed:    { fg: colors.failFg,    bg: colors.failBg,    label: "Failed",          icon: <MdError size={13} /> },
    skipped:   { fg: colors.warnFg,    bg: colors.warnBg,    label: "Not attempted",   icon: <MdBlock size={13} /> },
  }[status] || { fg: colors.textSecondary, bg: "#f0f0f0", label: status || "—", icon: null };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.3rem",
      padding: "0.2rem 0.55rem", borderRadius: 6,
      backgroundColor: cfg.bg, color: cfg.fg,
      fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
    }}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

const styles = {
  // Backdrop + modal pulled from the shared formStyles baseline so this
  // dialog matches every other popup (same blur, same z-index, same
  // non-movable behaviour). Tier `lg` (820) is the right size for the
  // results table — a touch larger than a short form, smaller than the
  // full bill/invoice editor.
  backdrop: formStyles.backdrop,
  modal: { ...formStyles.modal, maxWidth: `${modalSizes.lg}px` },
  header: {
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    padding: "0.95rem 1.4rem",
    display: "flex", justifyContent: "space-between", alignItems: "center",
    flexShrink: 0,
  },
  title: { margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#fff" },
  closeBtn: {
    background: "rgba(255,255,255,0.2)", border: "none", color: "#fff",
    cursor: "pointer", width: 32, height: 32, minWidth: 32, padding: 0,
    borderRadius: 8, boxShadow: "none",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  },
  summaryBar: {
    display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap",
    padding: "0.75rem 1.25rem", borderBottom: `1px solid ${colors.cardBorder}`,
    backgroundColor: "#f8faff",
  },
  summaryItem: { display: "flex", alignItems: "center", gap: "0.4rem" },
  summaryLabel: { fontSize: "0.78rem", color: colors.textSecondary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" },
  summaryValue: { fontSize: "1rem", fontWeight: 800, color: colors.textPrimary },
  // overflowX:auto added so the 3-col results table can scroll
  // horizontally on phones (Bill # / Status / Details columns get
  // squashed at sub-360px viewports otherwise).
  tableWrap: { overflowX: "auto", overflowY: "auto", flex: "1 1 auto", minHeight: 0, maxHeight: "calc(92vh - 200px)", WebkitOverflowScrolling: "touch" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" },
  th: {
    textAlign: "left", padding: "0.6rem 0.95rem",
    backgroundColor: "#f5f8fc", borderBottom: `1px solid ${colors.cardBorder}`,
    fontSize: "0.76rem", fontWeight: 700, color: colors.textSecondary,
    textTransform: "uppercase", letterSpacing: "0.04em",
    position: "sticky", top: 0, zIndex: 1,
  },
  td: {
    padding: "0.6rem 0.95rem",
    borderBottom: `1px solid ${colors.cardBorder}`,
    color: colors.textPrimary, verticalAlign: "top",
  },
  footer: {
    padding: "0.75rem 1.25rem",
    borderTop: `1px solid ${colors.cardBorder}`,
    display: "flex", justifyContent: "flex-end",
    flexShrink: 0,
  },
  closeFooterBtn: {
    padding: "0.5rem 1.25rem", borderRadius: 8,
    border: "none", backgroundColor: colors.blue, color: "#fff",
    fontSize: "0.86rem", fontWeight: 600, cursor: "pointer",
    boxShadow: "none",
  },
};
