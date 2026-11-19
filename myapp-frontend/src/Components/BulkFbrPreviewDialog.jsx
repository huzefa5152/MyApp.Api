import { useState, useMemo, useCallback } from "react";
import {
  MdClose,
  MdExpandMore,
  MdExpandLess,
  MdInfo,
  MdWarning,
  MdCheckCircle,
  MdHourglassEmpty,
} from "react-icons/md";
import httpClient from "../api/httpClient";
import { formStyles, modalSizes } from "../theme";
import FbrPayloadView from "./FbrPayloadView";

/**
 * Bulk FBR submission preview (2026-05-13).
 *
 * Operator-facing companion to `Validate All` / `Submit All` on the
 * Invoices tab. Renders every bill that's currently ready to be sent
 * to FBR as a collapsible row — clicking a row lazy-loads the same
 * payload `FbrPreviewDialog` shows for a single bill, so the operator
 * can scan the whole queue without bouncing between bill cards.
 *
 * Why lazy-load: hammering /api/fbr/{id}/preview-payload N times up
 * front would block the dialog from opening and pile cost on the FBR
 * service. On expand → fetch → cache in component state, so collapsing
 * and re-expanding doesn't re-fetch.
 *
 * Responsiveness:
 *   • Header strip wraps on narrow viewports (flex-wrap).
 *   • Row chip + summary cluster collapse vertically below 600px via
 *     the standard responsive-grid classes (index.css).
 *   • Items table inside each expanded row uses `responsive-table-wrap`
 *     so it scrolls horizontally on phones.
 */
export default function BulkFbrPreviewDialog({ invoices, onClose }) {
  // Per-row UI state: which rows are expanded + their cached payloads.
  const [expandedById, setExpandedById] = useState({}); // { id: boolean }
  const [payloadById, setPayloadById] = useState({}); // { id: { loading, error, data, itemCount, originalLineCount } }

  const toggleRow = useCallback((id) => {
    setExpandedById((prev) => ({ ...prev, [id]: !prev[id] }));
    // Lazy-fetch on first expand only.
    setPayloadById((prev) => {
      if (prev[id]) return prev; // already in-flight or loaded
      const next = {
        ...prev,
        [id]: { loading: true, error: "", data: null, itemCount: 0, originalLineCount: 0 },
      };
      // Fire the fetch — we don't await; React updates state when it lands.
      httpClient
        .get(`/fbr/${id}/preview-payload`)
        .then(({ data }) => {
          if (!data?.success) {
            setPayloadById((p) => ({
              ...p,
              [id]: {
                ...p[id],
                loading: false,
                error: data?.errorMessage || "Failed to build preview",
              },
            }));
            return;
          }
          const json = data.preview?.json;
          const parsed = json ? JSON.parse(json) : null;
          setPayloadById((p) => ({
            ...p,
            [id]: {
              loading: false,
              error: "",
              data: parsed,
              itemCount: data.preview?.itemCount ?? 0,
              originalLineCount: data.preview?.originalLineCount ?? 0,
              url: data.preview?.url ?? "",
            },
          }));
        })
        .catch((e) => {
          setPayloadById((p) => ({
            ...p,
            [id]: {
              ...p[id],
              loading: false,
              error: e.response?.data?.errorMessage || e.message || "Failed to load preview",
            },
          }));
        });
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    // Expand triggers lazy-fetch via toggleRow; map over the list and
    // pretend each row was just clicked. Doesn't blast N requests at
    // once — React batches state updates, but fetches still go out in
    // parallel via the browser's fetch queue.
    invoices.forEach((inv) => {
      // Only fire if not already expanded
      setExpandedById((prev) => {
        if (prev[inv.id]) return prev;
        toggleRow(inv.id);
        return prev; // toggleRow already updated; this guards re-entry
      });
    });
  }, [invoices, toggleRow]);

  const collapseAll = useCallback(() => {
    setExpandedById({});
  }, []);

  // Aggregate stats for the header strip.
  const stats = useMemo(() => {
    const total = invoices.length;
    const grandTotalSum = invoices.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0);
    return { total, grandTotalSum };
  }, [invoices]);

  const fmtMoney = (n) =>
    `Rs. ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

  return (
    <div style={formStyles.backdrop}>
      <div
        style={{
          ...formStyles.modal,
          maxWidth: `${modalSizes.xl}px`,
          width: "min(96vw, 1100px)",
          cursor: "default",
          display: "flex",
          flexDirection: "column",
          maxHeight: "92vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            FBR Submission Preview · {stats.total} bill{stats.total === 1 ? "" : "s"}
          </h5>
          <button
            type="button"
            style={formStyles.closeButton}
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <MdClose size={20} color="#fff" />
          </button>
        </div>

        <div style={{ ...formStyles.body, overflow: "auto", flex: 1 }}>
          {/* Summary strip — what's about to go to FBR. Wraps on narrow viewports. */}
          <div style={s.summaryStrip}>
            <div style={s.summaryItem}>
              <MdInfo size={16} color="#0d47a1" />
              <span>
                <strong>{stats.total}</strong> ready
              </span>
            </div>
            <div style={s.summaryItem}>
              <strong>{fmtMoney(stats.grandTotalSum)}</strong>
              <span style={s.summaryMeta}>total grand total</span>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              <button type="button" style={s.linkBtn} onClick={expandAll}>
                Expand all
              </button>
              <button type="button" style={s.linkBtn} onClick={collapseAll}>
                Collapse all
              </button>
            </div>
          </div>

          {invoices.length === 0 ? (
            <div style={s.emptyState}>
              <MdInfo size={20} color="#5f6d7e" />
              <span>
                No bills ready to validate. Set the FBR fields (HS Code, Sale Type, UOM, Unit Price)
                on each bill first.
              </span>
            </div>
          ) : (
            <div style={s.rowsList}>
              {invoices.map((inv) => (
                <BillRow
                  key={inv.id}
                  invoice={inv}
                  expanded={!!expandedById[inv.id]}
                  payload={payloadById[inv.id]}
                  onToggle={() => toggleRow(inv.id)}
                  fmtMoney={fmtMoney}
                />
              ))}
            </div>
          )}
        </div>

        <div style={formStyles.footer}>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.cancel }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// One collapsible row. The header is the always-visible summary; the
// detail panel only renders when the row is expanded.
function BillRow({ invoice, expanded, payload, onToggle, fmtMoney }) {
  const statusBadge = useMemo(() => {
    const fs = invoice.fbrStatus;
    if (fs === "Submitted")
      return { text: "Submitted", style: s.badgeSubmitted, icon: MdCheckCircle };
    if (fs === "Validated")
      return { text: "Validated", style: s.badgeValidated, icon: MdCheckCircle };
    if (fs === "Failed") return { text: "Failed", style: s.badgeFailed, icon: MdWarning };
    return { text: "Ready", style: s.badgeReady, icon: MdHourglassEmpty };
  }, [invoice.fbrStatus]);
  const BadgeIcon = statusBadge.icon;

  return (
    <div style={s.row}>
      <button type="button" style={s.rowHeader} onClick={onToggle} aria-expanded={expanded}>
        <div style={s.rowHeaderLeft}>
          {expanded ? (
            <MdExpandLess size={20} color="#0d47a1" />
          ) : (
            <MdExpandMore size={20} color="#0d47a1" />
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              minWidth: 0,
            }}
          >
            <div style={s.rowTitle}>
              Bill #{invoice.invoiceNumber}
              {invoice.fbrInvoiceNumber && (
                <span style={s.rowSubtitle}> · {invoice.fbrInvoiceNumber}</span>
              )}
            </div>
            <div style={s.rowMeta}>
              {invoice.clientName} · {new Date(invoice.date).toLocaleDateString("en-GB")}
            </div>
          </div>
        </div>
        <div style={s.rowHeaderRight}>
          <span style={s.rowGrandTotal}>{fmtMoney(invoice.grandTotal)}</span>
          <span style={{ ...s.badge, ...statusBadge.style }}>
            <BadgeIcon size={12} /> {statusBadge.text}
          </span>
        </div>
      </button>

      {expanded && (
        <div style={s.rowBody}>
          {!payload || payload.loading ? (
            <div style={s.notice}>Loading FBR preview…</div>
          ) : payload.error ? (
            <div style={s.errorBox}>
              <MdWarning size={16} color="#dc3545" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Could not build preview</div>
                <div style={{ fontSize: "0.84rem", whiteSpace: "pre-wrap" }}>{payload.error}</div>
              </div>
            </div>
          ) : (
            <FbrPayloadView
              payload={payload.data}
              itemCount={payload.itemCount}
              originalLineCount={payload.originalLineCount}
              url={payload.url}
            />
          )}
        </div>
      )}
    </div>
  );
}

const s = {
  summaryStrip: {
    display: "flex",
    alignItems: "center",
    gap: "0.85rem",
    flexWrap: "wrap",
    padding: "0.65rem 0.85rem",
    background: "#eef4fb",
    border: "1px solid #b7d4f0",
    borderRadius: 8,
    marginBottom: "0.85rem",
    fontSize: "0.85rem",
    color: "#0d47a1",
  },
  summaryItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
  },
  summaryMeta: { color: "#5f6d7e", fontWeight: 500, fontSize: "0.78rem" },
  emptyState: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "1.2rem",
    color: "#5f6d7e",
    background: "#f8fafc",
    border: "1px dashed #d0d7e2",
    borderRadius: 8,
    fontSize: "0.85rem",
  },
  rowsList: { display: "flex", flexDirection: "column", gap: "0.45rem" },
  row: {
    border: "1px solid #e8edf3",
    borderRadius: 8,
    background: "#fff",
    overflow: "hidden",
  },
  rowHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.65rem",
    width: "100%",
    padding: "0.6rem 0.85rem",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    flexWrap: "wrap", // mobile fallback — chip/totals drop below the title
  },
  rowHeaderLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
    minWidth: 0,
    flex: 1,
  },
  rowHeaderRight: {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
    flexWrap: "wrap",
  },
  rowTitle: {
    fontWeight: 700,
    fontSize: "0.92rem",
    color: "#1a2332",
    overflowWrap: "anywhere",
  },
  rowSubtitle: { color: "#5f6d7e", fontWeight: 500, fontSize: "0.82rem" },
  rowMeta: { fontSize: "0.78rem", color: "#5f6d7e", marginTop: 2 },
  rowGrandTotal: { fontWeight: 700, color: "#0d47a1", fontSize: "0.92rem" },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.15rem 0.5rem",
    borderRadius: 999,
    fontSize: "0.72rem",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  badgeReady: { background: "#e3f2fd", color: "#0d47a1", border: "1px solid #90caf9" },
  badgeValidated: { background: "#e8f5e9", color: "#1b5e20", border: "1px solid #a5d6a7" },
  badgeSubmitted: { background: "#e0f2f1", color: "#00695c", border: "1px solid #80cbc4" },
  badgeFailed: { background: "#ffebee", color: "#b71c1c", border: "1px solid #ef9a9a" },
  rowBody: {
    padding: "0.65rem 0.85rem 0.85rem",
    borderTop: "1px solid #e8edf3",
    background: "#fafbfd",
  },
  notice: { padding: "0.75rem", textAlign: "center", color: "#5f6d7e", fontSize: "0.85rem" },
  errorBox: {
    display: "flex",
    gap: "0.5rem",
    background: "#fff0f1",
    border: "1px solid #f5c6cb",
    color: "#842029",
    padding: "0.65rem 0.85rem",
    borderRadius: 6,
  },
  linkBtn: {
    background: "transparent",
    border: "none",
    color: "#0d47a1",
    fontSize: "0.82rem",
    fontWeight: 600,
    padding: "0.25rem 0.5rem",
    margin: 0,
    cursor: "pointer",
    boxShadow: "none",
    textDecoration: "underline",
    textUnderlineOffset: 2,
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    borderRadius: 4,
  },
};
