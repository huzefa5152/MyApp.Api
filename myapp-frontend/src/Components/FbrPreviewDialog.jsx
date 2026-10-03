import { useEffect, useState, useMemo } from "react";
import { MdClose, MdInfo, MdCheckCircle, MdContentCopy, MdWarning } from "react-icons/md";
import httpClient from "../api/httpClient";
import { formStyles, modalSizes } from "../theme";
import { Alert, Button, Loading, TableWrap } from "../ui/Kit";

/**
 * Read-only preview of the JSON we would POST to FBR for a bill.
 *
 * Calls GET /api/fbr/{invoiceId}/preview-payload, which:
 *   - Builds the same payload PostInvoiceAsync would build
 *   - Skips the actual HTTP call (no network, no FBR audit)
 *   - Skips pre-validate so we can preview incomplete bills too
 *
 * Renders the items as a grouped table:
 *   ItemType (description) | HS Code | UOM | Qty | Value | Sales Tax | Total
 *   ────────────────────── ─────── ───── ─── ───── ────────── ──────────
 *   Sum row at the bottom (qty, value, tax, grand total).
 *
 * The grouping is performed server-side (mirrors the Tax Invoice print —
 * one FBR row per ItemType, summed quantity + value). If any line lacks an
 * ItemType the server falls back to per-line emission and the table just
 * renders each line as-is — so the totals remain correct either way.
 */
export default function FbrPreviewDialog({ invoiceId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [origLineCount, setOrigLineCount] = useState(0);
  const [itemCount, setItemCount] = useState(0);
  const [url, setUrl] = useState("");
  const [showRawJson, setShowRawJson] = useState(false);
  const [copied, setCopied] = useState(false);

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
    return () => { cancelled = true; };
  }, [invoiceId]);

  // Sum values across the FBR items array. Keep the math consistent with
  // what FBR computes: salesTaxApplicable + furtherTax + extraTax → total tax.
  const totals = useMemo(() => {
    if (!payload?.items?.length) {
      return { qty: 0, value: 0, tax: 0, further: 0, total: 0 };
    }
    return payload.items.reduce(
      (acc, it) => {
        const value = Number(it.valueSalesExcludingST || 0);
        const tax = Number(it.salesTaxApplicable || 0);
        const further = Number(it.furtherTax || 0);
        const extra = typeof it.extraTax === "number" ? it.extraTax : 0;
        return {
          qty: acc.qty + Number(it.quantity || 0),
          value: acc.value + value,
          tax: acc.tax + tax,
          further: acc.further + further,
          total: acc.total + value + tax + further + extra,
        };
      },
      { qty: 0, value: 0, tax: 0, further: 0, total: 0 }
    );
  }, [payload]);

  const fmtNum = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtQty = (n) => {
    // Strip trailing zeros, cap at 4 places — same rule as the rest of the app.
    return parseFloat(Number(n || 0).toFixed(4)).toString();
  };

  const copyJson = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

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
              <Alert tone="info" icon={MdInfo}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {origLineCount} bill {origLineCount === 1 ? "line" : "lines"} → {itemCount} FBR{" "}
                  {itemCount === 1 ? "item" : "items"}
                  {origLineCount !== itemCount && (
                    <span style={{ color: "#2e7d32", marginLeft: "0.4rem" }}>
                      (grouped by Item Type — same as Tax Invoice print)
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)", wordBreak: "break-word" }}>
                  Will POST to <code style={s.codeInline}>{url}</code>
                </div>
              </Alert>

              {/* Header / parties block — `responsive-grid-3col`
                  collapses 3 → 2 → 1 columns on narrow viewports
                  (defined in index.css). */}
              <div className="responsive-grid-3col">
                <div>
                  <div style={s.partyLabel}>Seller</div>
                  <div style={s.partyName}>{payload?.sellerBusinessName}</div>
                  <div style={s.partyMeta}>NTN/CNIC: {payload?.sellerNTNCNIC}</div>
                  <div style={s.partyMeta}>{payload?.sellerProvince}</div>
                </div>
                <div>
                  <div style={s.partyLabel}>Buyer ({payload?.buyerRegistrationType})</div>
                  <div style={s.partyName}>{payload?.buyerBusinessName}</div>
                  <div style={s.partyMeta}>NTN/CNIC: {payload?.buyerNTNCNIC || <em>(unregistered)</em>}</div>
                  <div style={s.partyMeta}>{payload?.buyerProvince}</div>
                </div>
                <div>
                  <div style={s.partyLabel}>Document</div>
                  <div style={s.partyName}>{payload?.invoiceType}</div>
                  <div style={s.partyMeta}>Date: {payload?.invoiceDate}</div>
                  {payload?.scenarioId && <div style={s.partyMeta}>Scenario: {payload.scenarioId}</div>}
                  {/* Debit/Credit note specifics — the reference invoice IRN and
                      the reason/remarks FBR requires (0026/0027/0028). */}
                  {payload?.invoiceRefNo && (
                    <div style={{ ...s.partyMeta, wordBreak: "break-all" }}>
                      Ref Invoice: <code style={s.codeInline}>{payload.invoiceRefNo}</code>
                    </div>
                  )}
                  {payload?.reason && <div style={s.partyMeta}>Reason: <strong>{payload.reason}</strong></div>}
                  {payload?.reasonRemarks && <div style={s.partyMeta}>Remarks: {payload.reasonRemarks}</div>}
                </div>
              </div>

              {/* Items table — `responsive-table-wrap` enables
                  horizontal scroll on phones (9 columns is too wide
                  to ever fit a 360px viewport). */}
              <div style={{ marginTop: "0.75rem" }}>
                <div style={s.itemsHeader}>
                  Items in FBR payload ({itemCount})
                </div>
                <TableWrap>
                  <table className="k-table" style={s.table}>
                    <thead>
                      <tr>
                        <th className="is-center" style={s.idxCol}>#</th>
                        <th>Item Type / Description</th>
                        <th>HS Code</th>
                        <th>UOM</th>
                        <th className="k-num">Qty</th>
                        <th className="k-num">Value (excl. tax)</th>
                        <th className="k-num">Sales Tax</th>
                        <th className="k-num">Further Tax</th>
                        <th className="k-num">Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload?.items?.map((it, idx) => {
                        const value = Number(it.valueSalesExcludingST || 0);
                        const tax = Number(it.salesTaxApplicable || 0);
                        const further = Number(it.furtherTax || 0);
                        const extra = typeof it.extraTax === "number" ? it.extraTax : 0;
                        const lineTotal = value + tax + further + extra;
                        return (
                          <tr key={idx}>
                            <td className="is-center k-muted">{idx + 1}</td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{it.productDescription}</div>
                              <div style={s.metaSub}>
                                {it.saleType}
                                {it.rate && ` · ${it.rate}`}
                                {it.sroScheduleNo && ` · ${it.sroScheduleNo}`}
                                {it.sroItemSerialNo && ` #${it.sroItemSerialNo}`}
                              </div>
                            </td>
                            <td>{it.hsCode || <span style={s.muted}>—</span>}</td>
                            <td>{it.uoM || <span style={s.muted}>—</span>}</td>
                            <td className="k-num">{fmtQty(it.quantity)}</td>
                            <td className="k-num">{fmtNum(value)}</td>
                            <td className="k-num">{fmtNum(tax)}</td>
                            <td className="k-num">
                              {further > 0 ? fmtNum(further) : <span style={s.muted}>0.00</span>}
                            </td>
                            <td className="k-num" style={{ fontWeight: 700 }}>
                              {fmtNum(lineTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} className="k-num">
                          Total ({itemCount} {itemCount === 1 ? "item" : "items"})
                        </td>
                        <td className="k-num">{fmtQty(totals.qty)}</td>
                        <td className="k-num">{fmtNum(totals.value)}</td>
                        <td className="k-num">{fmtNum(totals.tax)}</td>
                        <td className="k-num">
                          {totals.further > 0 ? fmtNum(totals.further) : <span style={s.muted}>0.00</span>}
                        </td>
                        <td className="k-num" style={{ color: "var(--k-blue)" }}>
                          {fmtNum(totals.total)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </TableWrap>
              </div>

              {/* Toggleable raw JSON for the curious / for support tickets. */}
              <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="secondary" size="sm" onClick={() => setShowRawJson((v) => !v)}>
                  {showRawJson ? "Hide" : "Show"} raw JSON
                </Button>
                {showRawJson && (
                  <Button variant="secondary" size="sm" icon={copied ? MdCheckCircle : MdContentCopy} onClick={copyJson}>
                    {copied ? "Copied" : "Copy"}
                  </Button>
                )}
              </div>
              {showRawJson && (
                <pre style={s.rawJson}>{JSON.stringify(payload, null, 2)}</pre>
              )}
            </>
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
  partyLabel: {
    fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em",
    color: "var(--k-muted)", fontWeight: 700, marginBottom: 4,
  },
  partyName: { fontSize: "calc(var(--k-font) + 0.05rem)", fontWeight: 700, color: "var(--k-ink)", overflowWrap: "anywhere" },
  partyMeta: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)", marginTop: 2 },
  itemsHeader: {
    fontSize: "var(--k-font)", fontWeight: 700, color: "var(--k-ink)",
    marginBottom: "0.4rem", display: "flex", alignItems: "center",
    justifyContent: "space-between",
  },
  // minWidth ensures columns don't collapse to unreadable widths on
  // mobile — instead the TableWrap scrolls horizontally, which is the
  // standard wide-table-on-mobile pattern.
  table: { minWidth: "720px" },
  idxCol: { width: 36 },
  metaSub: { fontSize: "0.75rem", color: "var(--k-muted)", marginTop: 2 },
  muted: { color: "var(--k-faint)" },
  rawJson: {
    margin: "0.5rem 0 0", padding: "0.75rem 1rem",
    background: "#0a1628", color: "#e8f5e9", border: "1px solid #1a2332",
    borderRadius: 8, fontSize: "0.78rem", lineHeight: 1.45,
    maxHeight: 360, overflow: "auto", whiteSpace: "pre",
  },
  codeInline: {
    background: "rgba(13,71,161,0.08)", padding: "0.05rem 0.35rem",
    borderRadius: 4, fontSize: "0.78rem", fontFamily: "monospace",
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
