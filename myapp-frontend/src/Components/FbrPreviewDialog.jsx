import { useEffect, useState } from "react";
import { MdClose, MdInfo, MdWarning } from "react-icons/md";
import httpClient from "../api/httpClient";
import { formStyles, modalSizes } from "../theme";
import { Alert, Loading } from "../ui/Kit";
import FbrPayloadView from "./FbrPayloadView";

/**
 * Read-only preview of the JSON we would POST to FBR for a bill.
 *
 * Calls GET /api/fbr/{invoiceId}/preview-payload, which:
 *   - Builds the same payload PostInvoiceAsync would build
 *   - Skips the actual HTTP call (no network, no FBR audit)
 *   - Skips pre-validate so we can preview incomplete bills too
 *
 * The body is the shared FbrPayloadView: every header field, every field of
 * every item, each tax summed, and the JSON itself in an expandable block.
 * Grouping by item type happens server-side; this shows what came back.
 */
export default function FbrPreviewDialog({ invoiceId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [origLineCount, setOrigLineCount] = useState(0);
  const [itemCount, setItemCount] = useState(0);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await httpClient.get(`/fbr/${invoiceId}/preview-payload`);
        if (cancelled) return;
        if (!data?.success) {
          setError(data?.errorMessage || "Failed to build preview");
          return;
        }
        const json = data.preview?.json;
        const parsed = json ? JSON.parse(json) : null;
        setPayload(parsed);
        setReviewRequired(!!data.preview?.reviewRequired);
        setOrigLineCount(data.preview?.originalLineCount ?? 0);
        setItemCount(data.preview?.itemCount ?? 0);
        setUrl(data.preview?.url ?? "");
      } catch (e) {
        if (cancelled) return;
        setError(e.response?.data?.errorMessage || e.message || "Failed to load preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop}>
      <div
        data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>FBR Submission Preview</h5>
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

        <div data-admin-body="" style={formStyles.body}>
          {loading ? (
            <Loading>Loading FBR preview…</Loading>
          ) : error ? (
            <Alert tone="error" icon={MdWarning}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Could not build preview</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
            </Alert>
          ) : (
            <>
              {/* Summary banner: how the bill grouped, where it would go.
                  The Alert body column has minWidth:0, so the long
                  unbreakable FBR URL wraps instead of widening the modal. */}
              {reviewRequired && (
                <Alert tone="warn" icon={MdWarning}>
                  Draft preview · Complete the tax filing adjustment / review before validating or
                  submitting to FBR. Missing classification fields are shown as blank.
                </Alert>
              )}
              <Alert tone="info" icon={MdInfo}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {origLineCount} bill {origLineCount === 1 ? "line" : "lines"} → {itemCount} FBR{" "}
                  {itemCount === 1 ? "item" : "items"}
                  {origLineCount !== itemCount && (
                    <span style={{ color: "var(--k-success)", marginLeft: "0.4rem" }}>
                      (grouped by Item Type — same as Tax Invoice print)
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: "var(--k-font-sm)",
                    color: "var(--k-muted)",
                    wordBreak: "break-word",
                  }}
                >
                  Will POST to <code style={s.codeInline}>{url}</code>
                </div>
              </Alert>

              <FbrPayloadView payload={payload} itemCount={itemCount} />
            </>
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

const s = {
  codeInline: {
    background: "rgba(13,71,161,0.08)",
    padding: "0.05rem 0.35rem",
    borderRadius: "var(--k-r-xs)",
    fontSize: "var(--k-fs-xs)",
    fontFamily: "monospace",
    // FBR URL is a single unbreakable token — without `wordBreak`
    // it overflows the parent on phones and ends up clipped by the
    // modal edge. `break-all` is fine for URLs (operators copy via
    // the raw-JSON button anyway).
    wordBreak: "break-all",
    overflowWrap: "anywhere",
    // Keep it inline-block so the break-all actually applies to a
    // continuous URL the way users expect.
    display: "inline",
  },
};
