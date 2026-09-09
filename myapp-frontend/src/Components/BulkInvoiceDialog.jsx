import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdClose, MdDownload, MdFilterAlt, MdPictureAsPdf, MdWarningAmber } from "react-icons/md";
import { downloadInvoiceZip, downloadConsolidatedPdf } from "../utils/bulkInvoiceDocuments";

/**
 * Bulk invoice download / consolidated print — the dialog BOTH surfaces mount.
 *
 * The internal Invoices screen and the public Customer Portal pass a different
 * `resolve` function and nothing else. Everything a person sees and every
 * failure they are told about is defined once here, so the two cannot drift
 * into behaving differently — which is the whole point of the shared service
 * underneath it.
 *
 * The portal deliberately gets no template control: `templates` is only passed
 * by the internal caller. See IInvoiceBulkService for why a customer choosing
 * a template has no value and some risk.
 *
 * Rendering is sequential and cancellable, because it happens in THIS tab: each
 * page is rasterised at scale 2 and held as a JPEG until the file is written.
 * A progress line and a working Cancel are not polish here — they are what
 * stops a 200-invoice run looking like a hung browser.
 */
const PRESETS = [
  { value: "thisMonth", label: "This month" },
  { value: "allPeriods", label: "All dates" },
  { value: "lastMonth", label: "Last month" },
  { value: "thisQuarter", label: "This quarter" },
  { value: "thisYear", label: "This year" },
  { value: "custom", label: "Custom range" },
];

export default function BulkInvoiceDialog({
  open,
  onClose,
  /** (request) => Promise<batch>. The ONLY thing that differs between callers. */
  resolve,
  /** Internal caller only: [{ id, name }] for the template picker. */
  templates = null,
  /** Seeded from the screen's own filters so the dialog opens on what is on screen. */
  initialFrom = "",
  initialTo = "",
  title = "Download invoices",
  /** Internal caller only — extra filters to carry through (client, division, search). */
  extraFilters = null,
  /**
   * Human-readable list of the SCREEN filters this batch inherits, e.g.
   * ["Client: Marketing Vision"].
   *
   * Not decoration. The batch operates on the filtered set, which is what was
   * asked for — but over a wide date range "2 invoices ready" then looks
   * identical to a broken query, and an operator who has forgotten a client
   * filter is on would either think bulk download is faulty or ship an
   * incomplete pack believing it complete. Saying what is applied is the
   * difference between a correct number and a trustworthy one.
   */
  inheritedFilters = null,
  documentType = "TaxInvoice",
  theme = null,
}) {
  const [preset, setPreset] = useState(initialFrom || initialTo ? "custom" : "thisMonth");
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [templateId, setTemplateId] = useState("");
  const [batch, setBatch] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const cancelRef = useRef(false);

  const t = theme || {};
  const running = !!progress;

  useEffect(() => {
    if (!open) return;
    setBatch(null); setResult(null); setError(""); setProgress(null);
    cancelRef.current = false;
    setPreset(initialFrom || initialTo ? "custom" : "thisMonth");
    setFrom(initialFrom); setTo(initialTo);
  }, [open, initialFrom, initialTo]);

  // The one validation the browser can do on its own. The server enforces it
  // too — this only saves a round trip and puts the message next to the field.
  const rangeError = useMemo(() => {
    if (preset !== "custom" || !from || !to) return "";
    return from > to ? "Start date must be on or before the end date." : "";
  }, [preset, from, to]);

  const request = useCallback(() => ({
    preset,
    dateFrom: preset === "custom" && from ? from : null,
    dateTo: preset === "custom" && to ? to : null,
    documentType,
    templateId: templateId ? Number(templateId) : null,
    ...(extraFilters || {}),
  }), [preset, from, to, documentType, templateId, extraFilters]);

  const doResolve = async () => {
    if (rangeError) return;
    setResolving(true); setError(""); setBatch(null); setResult(null);
    try {
      setBatch(await resolve(request()));
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "Could not list the invoices.");
    } finally {
      setResolving(false);
    }
  };

  const run = async (kind) => {
    if (!batch || !batch.invoices.length) return;
    cancelRef.current = false;
    setResult(null);
    setProgress({ done: 0, total: batch.invoices.length, current: null });
    try {
      const opts = {
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      };
      const out = kind === "zip"
        ? await downloadInvoiceZip(batch, opts)
        : await downloadConsolidatedPdf(batch, opts);
      setResult(out);
    } catch (err) {
      setError(err?.message || "The documents could not be produced.");
    } finally {
      setProgress(null);
    }
  };

  if (!open) return null;

  const count = batch?.invoices?.length || 0;
  const skipped = batch?.skipped || [];

  return (
    <div style={s.backdrop} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...s.panel, ...(t.panel || {}) }}>
        <div style={s.head}>
          <h5 style={s.title}>{title}</h5>
          <button type="button" style={s.close} onClick={onClose} disabled={running} aria-label="Close">
            <MdClose size={18} />
          </button>
        </div>

        <div style={s.row}>
          <label style={s.lbl}>
            Period
            <select style={s.input} value={preset} disabled={running}
                    onChange={(e) => setPreset(e.target.value)}>
              {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          {preset === "custom" && (
            <>
              <label style={s.lbl}>
                From
                <input type="date" style={s.input} value={from} disabled={running}
                       onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label style={s.lbl}>
                To
                <input type="date" style={s.input} value={to} disabled={running}
                       onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
        </div>

        {/* Template choice is INTERNAL only, and only meaningful within one
            company — a template row carries its company's letterhead. The
            server refuses one that is not this company's. */}
        {templates && templates.length > 0 && (
          <div style={s.row}>
            <label style={{ ...s.lbl, flex: "1 1 100%" }}>
              Template
              <select style={s.input} value={templateId} disabled={running}
                      onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Use the company default</option>
                {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
              </select>
            </label>
          </div>
        )}

        {inheritedFilters && inheritedFilters.length > 0 && (
          <p style={s.inherited}>
            <MdFilterAlt size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Also applying the filters on screen: <strong>{inheritedFilters.join(" · ")}</strong>.
              Clear them on the list to include everything.
            </span>
          </p>
        )}

        {rangeError && <p style={s.err}><MdWarningAmber size={15} /> {rangeError}</p>}

        <div style={s.actions}>
          <button type="button" style={s.secondary} onClick={doResolve}
                  disabled={resolving || running || !!rangeError}>
            {resolving ? "Listing…" : "List invoices"}
          </button>
        </div>

        {error && <p style={s.err}><MdWarningAmber size={15} /> {error}</p>}

        {batch && (
          <div style={s.summary}>
            <p style={s.summaryLine}>
              <strong>{count}</strong> invoice{count === 1 ? "" : "s"} ready
              {batch.windowLabel ? ` — ${batch.windowLabel}` : ""}
            </p>

            {/* A truncated run must never read as a complete one. */}
            {batch.truncated && (
              <p style={s.warn}>
                <MdWarningAmber size={15} /> {batch.matchedCount} invoices match. Only the
                first {batch.limit} are included — narrow the date range to get the rest.
              </p>
            )}

            {skipped.length > 0 && (
              <details style={s.details}>
                <summary style={s.summaryToggle}>
                  {skipped.length} invoice{skipped.length === 1 ? "" : "s"} cannot be printed
                </summary>
                <ul style={s.list}>
                  {skipped.map((k) => (
                    <li key={k.invoiceNumber}>
                      <strong>{k.reference || k.invoiceNumber}</strong> — {k.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {count === 0 ? (
              <p style={s.muted}>Nothing to download for this period.</p>
            ) : (
              <div style={s.actions}>
                <button type="button" style={s.primary} onClick={() => run("zip")} disabled={running}>
                  <MdDownload size={16} /> {count === 1 ? "Download PDF" : "Download all PDFs"}
                </button>
                <button type="button" style={s.primary} onClick={() => run("pdf")} disabled={running}>
                  <MdPictureAsPdf size={16} /> Consolidated PDF
                </button>
              </div>
            )}
          </div>
        )}

        {progress && (
          <div style={s.summary}>
            <p style={s.summaryLine}>
              Rendering {progress.done} of {progress.total}
              {progress.current ? ` — ${progress.current}` : ""}
            </p>
            <div style={s.barOuter}>
              <div style={{ ...s.barInner, width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }} />
            </div>
            <div style={s.actions}>
              <button type="button" style={s.secondary} onClick={() => { cancelRef.current = true; }}>
                Cancel
              </button>
            </div>
            <p style={s.muted}>
              Each invoice is drawn exactly as it prints on its own, so this takes a
              moment per document. Leave this tab open.
            </p>
          </div>
        )}

        {result && (
          <div style={s.summary}>
            <p style={s.summaryLine}>
              {result.cancelled
                ? `Stopped after ${result.written} of ${batch.invoices.length}. Nothing was saved.`
                : result.saved
                  ? `Saved ${result.written} invoice${result.written === 1 ? "" : "s"}.`
                  : "Nothing could be produced."}
            </p>
            {result.failures?.length > 0 && (
              <details style={s.details} open>
                <summary style={s.summaryToggle}>
                  {result.failures.length} failed to render
                </summary>
                <ul style={s.list}>
                  {result.failures.map((f) => (
                    <li key={f.invoiceNumber}>
                      <strong>{f.reference || f.invoiceNumber}</strong> — {f.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  backdrop: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1400,
    display: "grid", placeItems: "center", padding: "1rem" },
  panel: { background: "#fff", borderRadius: 12, padding: "1.1rem 1.25rem", width: "min(560px, 100%)",
    maxHeight: "90vh", overflowY: "auto", boxShadow: "0 18px 50px rgba(0,0,0,0.25)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" },
  title: { margin: 0, fontSize: "1.02rem", fontWeight: 700, color: "#1a2332" },
  close: { border: "none", background: "transparent", cursor: "pointer", color: "#5f6d7e",
    display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 6 },
  row: { display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.6rem" },
  lbl: { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px",
    fontSize: "0.74rem", fontWeight: 700, color: "#5f6d7e", textTransform: "uppercase",
    letterSpacing: "0.04em" },
  input: { padding: "0.45rem 0.55rem", borderRadius: 7, border: "1px solid #d0d7e2",
    background: "#f8f9fb", fontSize: "0.86rem", fontWeight: 500, color: "#1a2332", minHeight: 38 },
  actions: { display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.6rem" },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.5rem 0.85rem",
    borderRadius: 8, border: "none", background: "#0d47a1", color: "#fff",
    fontSize: "0.84rem", fontWeight: 600, cursor: "pointer", minHeight: 40 },
  secondary: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.5rem 0.85rem",
    borderRadius: 8, border: "1px solid #d0d7e2", background: "#fff", color: "#1a2332",
    fontSize: "0.84rem", fontWeight: 600, cursor: "pointer", minHeight: 40 },
  summary: { marginTop: "0.8rem", paddingTop: "0.7rem", borderTop: "1px solid #e8edf3" },
  summaryLine: { margin: "0 0 0.4rem", fontSize: "0.88rem", color: "#1a2332" },
  muted: { margin: "0.4rem 0 0", fontSize: "0.78rem", color: "#5f6d7e" },
  warn: { display: "flex", alignItems: "flex-start", gap: 6, margin: "0.35rem 0",
    fontSize: "0.8rem", color: "#8a5300", background: "#fff8e1", border: "1px solid #ffe0a3",
    borderRadius: 7, padding: "0.45rem 0.6rem" },
  inherited: { display: "flex", alignItems: "flex-start", gap: 6, margin: "0.35rem 0",
    fontSize: "0.78rem", color: "#0d3c61", background: "#e8f2fb", border: "1px solid #bcdcf5",
    borderRadius: 7, padding: "0.45rem 0.6rem" },
  err: { display: "flex", alignItems: "flex-start", gap: 6, margin: "0.35rem 0",
    fontSize: "0.8rem", color: "#8c1d18", background: "#fdecea", border: "1px solid #f5c6c2",
    borderRadius: 7, padding: "0.45rem 0.6rem" },
  details: { margin: "0.4rem 0" },
  summaryToggle: { cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "#0d47a1" },
  list: { margin: "0.4rem 0 0", paddingLeft: "1.1rem", fontSize: "0.79rem", color: "#5f6d7e" },
  barOuter: { height: 6, borderRadius: 999, background: "#e8edf3", overflow: "hidden" },
  barInner: { height: "100%", background: "#0d47a1", transition: "width 120ms linear" },
};
