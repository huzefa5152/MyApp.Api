import { useEffect, useState } from "react";
import { MdClose, MdWarning } from "react-icons/md";
import httpClient from "../api/httpClient";
import { formStyles, modalSizes } from "../theme";
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
    <div style={formStyles.backdrop}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>FBR Submission Preview</h5>
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

        <div style={formStyles.body}>
          {loading ? (
            <div style={s.notice}>Loading FBR preview…</div>
          ) : error ? (
            <div style={s.errorBox}>
              <MdWarning size={18} color="#dc3545" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Could not build preview</div>
                <div style={{ fontSize: "0.88rem", whiteSpace: "pre-wrap" }}>{error}</div>
              </div>
            </div>
          ) : (
            <FbrPayloadView
              payload={payload}
              itemCount={itemCount}
              originalLineCount={origLineCount}
              url={url}
            />
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

const s = {
  notice: { padding: "2rem", textAlign: "center", color: "#5f6d7e" },
  errorBox: {
    display: "flex",
    gap: "0.6rem",
    background: "#fff0f1",
    border: "1px solid #f5c6cb",
    color: "#842029",
    padding: "0.85rem 1rem",
    borderRadius: 8,
  },
};
