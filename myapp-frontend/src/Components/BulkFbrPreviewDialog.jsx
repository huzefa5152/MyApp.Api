import { useState, useMemo, useCallback } from "react";
import {
  MdClose,
  MdExpandMore,
  MdExpandLess,
  MdInfo,
  MdWarning,
  MdCheckCircle,
  MdHourglassEmpty,
  MdUnfoldMore,
  MdUnfoldLess,
} from "react-icons/md";
import httpClient from "../api/httpClient";
import SearchableClientSelect from "./SearchableClientSelect";
import { formStyles, modalSizes } from "../theme";
import { Alert, Button, EmptyState, Loading } from "../ui/Kit";
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
export default function BulkFbrPreviewDialog({ invoices: allInvoices, onClose }) {
  // Narrow the preview to one customer. The picker lists only the customers
  // that have a bill here, so every choice shows something.
  const [clientId, setClientId] = useState("");
  const clients = useMemo(() => {
    const byId = new Map();
    allInvoices.forEach((i) => byId.set(i.clientId, { id: i.clientId, name: i.clientName }));
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allInvoices]);
  const invoices = useMemo(
    () =>
      clientId ? allInvoices.filter((i) => String(i.clientId) === String(clientId)) : allInvoices,
    [allInvoices, clientId],
  );

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
              url: data.preview?.url ?? "",
              originalLineCount: data.preview?.originalLineCount ?? 0,
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
    <div data-admin-backdrop="" style={formStyles.backdrop}>
      <div
        data-admin-dialog=""
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
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>
            FBR Submission Preview · {stats.total} bill{stats.total === 1 ? "" : "s"}
          </h5>
          <button
            data-admin-close=""
            type="button"
            style={formStyles.closeButton}
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <MdClose size={20} color="#fff" />
          </button>
        </div>

        <div data-admin-body="" style={{ ...formStyles.body, overflow: "auto", flex: 1 }}>
          {clients.length > 1 && (
            <div style={s.clientFilter}>
              <SearchableClientSelect
                clients={clients}
                value={clientId}
                onChange={(id) => setClientId(id)}
                placeholder={`All clients (${clients.length})`}
              />
            </div>
          )}
          {/* Summary strip — what's about to go to FBR. Wraps on narrow viewports. */}
          <div style={s.summaryStrip}>
            <div style={s.summaryItem}>
              <MdInfo size={16} color="var(--k-blue)" />
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
              <Button variant="secondary" size="sm" icon={MdUnfoldMore} onClick={expandAll}>
                Expand all
              </Button>
              <Button variant="secondary" size="sm" icon={MdUnfoldLess} onClick={collapseAll}>
                Collapse all
              </Button>
            </div>
          </div>

          {invoices.length === 0 ? (
            <EmptyState icon={MdInfo}>
              No bills ready to validate. Set the FBR fields (HS Code, Sale Type, UOM, Unit Price)
              on each bill first.
            </EmptyState>
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

        <div data-admin-footer="" style={formStyles.footer}>
          <button
            data-admin-close=""
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
    <div data-admin-form-row="" style={s.row}>
      <button type="button" style={s.rowHeader} onClick={onToggle} aria-expanded={expanded}>
        <div style={s.rowHeaderLeft}>
          {expanded ? (
            <MdExpandLess size={20} color="var(--k-blue)" />
          ) : (
            <MdExpandMore size={20} color="var(--k-blue)" />
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
            <Loading>Loading FBR preview…</Loading>
          ) : payload.error ? (
            <Alert tone="error" icon={MdWarning}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Could not build preview</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{payload.error}</div>
            </Alert>
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
  // Full width on a phone, capped on a wider screen.
  clientFilter: { maxWidth: 360, marginBottom: "0.65rem" },
  summaryStrip: {
    display: "flex",
    alignItems: "center",
    gap: "0.85rem",
    flexWrap: "wrap",
    padding: "0.5rem 0.85rem",
    background: "#e8f0fb",
    border: "1px solid #c9daf3",
    borderRadius: "var(--k-radius)",
    marginBottom: "0.85rem",
    fontSize: "var(--k-font)",
    color: "var(--k-blue)",
  },
  summaryItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
  },
  summaryMeta: { color: "var(--k-muted)", fontWeight: 500, fontSize: "var(--k-font-sm)" },
  rowsList: { display: "flex", flexDirection: "column", gap: "0.45rem" },
  row: {
    border: "1px solid var(--k-line)",
    borderRadius: "var(--k-radius)",
    background: "var(--k-surface)",
    overflow: "hidden",
  },
  rowHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.65rem",
    width: "100%",
    minHeight: "var(--k-h)",
    padding: "0.5rem 0.85rem",
    margin: 0,
    background: "transparent",
    border: "none",
    borderRadius: 0,
    boxShadow: "none", // override the global `button` shadow (index.css)
    fontFamily: "inherit",
    fontWeight: 400,
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
    fontSize: "var(--k-font)",
    color: "var(--k-ink)",
    overflowWrap: "anywhere",
  },
  rowSubtitle: { color: "var(--k-muted)", fontWeight: 500, fontSize: "var(--k-font-sm)" },
  // Client name: 2-line clamp, never a single-line ellipsis (similar-prefix names).
  rowMeta: {
    fontSize: "var(--k-font-sm)",
    color: "var(--k-muted)",
    marginTop: 2,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  rowGrandTotal: {
    fontWeight: 700,
    color: "var(--k-blue)",
    fontSize: "var(--k-font)",
    fontVariantNumeric: "tabular-nums",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.15rem 0.5rem",
    borderRadius: "var(--k-r-pill)",
    fontSize: "var(--k-fs-2xs)",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  badgeReady: {
    background: "var(--k-info-bg)",
    color: "var(--k-blue)",
    border: "1px solid #90caf9",
  },
  badgeValidated: {
    background: "var(--k-success-bg)",
    color: "var(--k-success-strong)",
    border: "1px solid #a5d6a7",
  },
  badgeSubmitted: {
    background: "var(--k-teal-bg)",
    color: "var(--k-teal-ink)",
    border: "1px solid #80cbc4",
  },
  badgeFailed: {
    background: "var(--k-danger-bg)",
    color: "var(--k-danger)",
    border: "1px solid #ef9a9a",
  },
  rowBody: {
    padding: "0.65rem 0.85rem 0.85rem",
    borderTop: "1px solid var(--k-line)",
    background: "var(--k-surface-2)",
  },
};
