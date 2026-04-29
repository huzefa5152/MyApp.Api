import { useEffect, useState, useMemo } from "react";
import { MdClose, MdInfo, MdCheckCircle, MdContentCopy, MdWarning } from "react-icons/md";
import httpClient from "../api/httpClient";
import { formStyles, modalSizes } from "../theme";

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
            <>
              {/* Summary banner: how the bill grouped, where it would go */}
              <div style={s.summaryBanner}>
                <MdInfo size={18} color="#0d47a1" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    {origLineCount} bill {origLineCount === 1 ? "line" : "lines"} → {itemCount} FBR{" "}
                    {itemCount === 1 ? "item" : "items"}
                    {origLineCount !== itemCount && (
                      <span style={{ color: "#2e7d32", marginLeft: "0.4rem" }}>
                        (grouped by Item Type — same as Tax Invoice print)
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#5f6d7e" }}>
                    Will POST to <code style={s.codeInline}>{url}</code>
                  </div>
                </div>
              </div>

              {/* Header / parties block */}
              <div style={s.partiesGrid}>
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
                </div>
              </div>

              {/* Items table */}
              <div style={{ marginTop: "0.75rem" }}>
                <div style={s.itemsHeader}>
                  Items in FBR payload ({itemCount})
                </div>
                <div style={s.tableWrap}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.thIdx}>#</th>
                        <th style={s.th}>Item Type / Description</th>
                        <th style={s.th}>HS Code</th>
                        <th style={s.th}>UOM</th>
                        <th style={{ ...s.th, textAlign: "right" }}>Qty</th>
                        <th style={{ ...s.th, textAlign: "right" }}>Value (excl. tax)</th>
                        <th style={{ ...s.th, textAlign: "right" }}>Sales Tax</th>
                        <th style={{ ...s.th, textAlign: "right" }}>Further Tax</th>
                        <th style={{ ...s.th, textAlign: "right" }}>Line Total</th>
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
                            <td style={s.tdIdx}>{idx + 1}</td>
                            <td style={s.td}>
                              <div style={{ fontWeight: 600 }}>{it.productDescription}</div>
                              <div style={s.metaSub}>
                                {it.saleType}
                                {it.rate && ` · ${it.rate}`}
                                {it.sroScheduleNo && ` · ${it.sroScheduleNo}`}
                                {it.sroItemSerialNo && ` #${it.sroItemSerialNo}`}
                              </div>
                            </td>
                            <td style={s.td}>{it.hsCode || <span style={s.muted}>—</span>}</td>
                            <td style={s.td}>{it.uoM || <span style={s.muted}>—</span>}</td>
                            <td style={{ ...s.td, textAlign: "right" }}>{fmtQty(it.quantity)}</td>
                            <td style={{ ...s.td, textAlign: "right" }}>{fmtNum(value)}</td>
                            <td style={{ ...s.td, textAlign: "right" }}>{fmtNum(tax)}</td>
                            <td style={{ ...s.td, textAlign: "right" }}>
                              {further > 0 ? fmtNum(further) : <span style={s.muted}>0.00</span>}
                            </td>
                            <td style={{ ...s.td, textAlign: "right", fontWeight: 700 }}>
                              {fmtNum(lineTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={s.totalsRow}>
                        <td colSpan={4} style={{ ...s.tdTotals, textAlign: "right" }}>
                          Total ({itemCount} {itemCount === 1 ? "item" : "items"})
                        </td>
                        <td style={{ ...s.tdTotals, textAlign: "right" }}>{fmtQty(totals.qty)}</td>
                        <td style={{ ...s.tdTotals, textAlign: "right" }}>{fmtNum(totals.value)}</td>
                        <td style={{ ...s.tdTotals, textAlign: "right" }}>{fmtNum(totals.tax)}</td>
                        <td style={{ ...s.tdTotals, textAlign: "right" }}>
                          {totals.further > 0 ? fmtNum(totals.further) : <span style={s.muted}>0.00</span>}
                        </td>
                        <td style={{ ...s.tdTotals, textAlign: "right", color: "#0d47a1" }}>
                          {fmtNum(totals.total)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Toggleable raw JSON for the curious / for support tickets. */}
              <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={s.linkBtn}
                  onClick={() => setShowRawJson((v) => !v)}
                >
                  {showRawJson ? "Hide" : "Show"} raw JSON
                </button>
                {showRawJson && (
                  <button type="button" style={s.linkBtn} onClick={copyJson}>
                    {copied ? <><MdCheckCircle size={14} /> Copied</> : <><MdContentCopy size={14} /> Copy</>}
                  </button>
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
  notice: { padding: "2rem", textAlign: "center", color: "#5f6d7e" },
  errorBox: {
    display: "flex", gap: "0.6rem",
    background: "#fff0f1", border: "1px solid #f5c6cb",
    color: "#842029", padding: "0.85rem 1rem", borderRadius: 8,
  },
  summaryBanner: {
    display: "flex", gap: "0.6rem",
    background: "#eef4fb", border: "1px solid #b7d4f0",
    color: "#0d47a1", padding: "0.75rem 1rem", borderRadius: 8,
  },
  partiesGrid: {
    display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
    gap: "0.75rem", marginTop: "0.75rem",
  },
  partyLabel: {
    fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em",
    color: "#5f6d7e", fontWeight: 700, marginBottom: 4,
  },
  partyName: { fontSize: "0.95rem", fontWeight: 700, color: "#1a2332" },
  partyMeta: { fontSize: "0.82rem", color: "#5f6d7e", marginTop: 2 },
  itemsHeader: {
    fontSize: "0.85rem", fontWeight: 700, color: "#1a2332",
    marginBottom: "0.4rem", display: "flex", alignItems: "center",
    justifyContent: "space-between",
  },
  tableWrap: { border: "1px solid #e8edf3", borderRadius: 10, overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" },
  th: {
    padding: "0.5rem 0.6rem", background: "#f8fafc", borderBottom: "1px solid #e8edf3",
    fontSize: "0.75rem", fontWeight: 700, color: "#5f6d7e",
    textTransform: "uppercase", letterSpacing: "0.03em", textAlign: "left",
  },
  thIdx: {
    padding: "0.5rem 0.4rem", background: "#f8fafc", borderBottom: "1px solid #e8edf3",
    fontSize: "0.75rem", fontWeight: 700, color: "#5f6d7e",
    textTransform: "uppercase", letterSpacing: "0.03em", textAlign: "center",
    width: 36,
  },
  td: { padding: "0.55rem 0.6rem", borderBottom: "1px solid #f0f3f7", color: "#1a2332" },
  tdIdx: {
    padding: "0.55rem 0.4rem", borderBottom: "1px solid #f0f3f7",
    color: "#5f6d7e", fontSize: "0.78rem", textAlign: "center",
  },
  metaSub: { fontSize: "0.75rem", color: "#5f6d7e", marginTop: 2 },
  muted: { color: "#aab3bf" },
  totalsRow: { background: "#f5f7fa" },
  tdTotals: {
    padding: "0.65rem 0.6rem", fontSize: "0.88rem", fontWeight: 700,
    color: "#1a2332", borderTop: "2px solid #d0d7e2",
  },
  linkBtn: {
    background: "transparent", backgroundColor: "transparent",
    border: "none", color: "#0d47a1", fontSize: "0.82rem", fontWeight: 600,
    padding: "0.25rem 0.45rem", margin: 0, cursor: "pointer",
    boxShadow: "none", textDecoration: "underline", textUnderlineOffset: 2,
    display: "inline-flex", alignItems: "center", gap: "0.3rem",
    borderRadius: 4,
  },
  rawJson: {
    margin: "0.5rem 0 0", padding: "0.75rem 1rem",
    background: "#0a1628", color: "#e8f5e9", border: "1px solid #1a2332",
    borderRadius: 8, fontSize: "0.78rem", lineHeight: 1.45,
    maxHeight: 360, overflow: "auto", whiteSpace: "pre",
  },
  codeInline: {
    background: "rgba(13,71,161,0.08)", padding: "0.05rem 0.35rem",
    borderRadius: 4, fontSize: "0.78rem", fontFamily: "monospace",
  },
};
