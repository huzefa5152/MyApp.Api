import { useRef, useState } from "react";
import { MdCheckCircle, MdClose, MdErrorOutline, MdUploadFile } from "react-icons/md";
import { previewTaxSheetImport, commitTaxSheetImport } from "../api/reportApi";
import { notify } from "../utils/notify";
// Same backdrop / gradient header / scrolling body / footer as every other popup.
import { formStyles, modalSizes } from "../theme";

const ink = "#1a2332";
const muted = "#5f6d7e";
const line = "#e8edf3";

/**
 * Bulk adjust from a filled-in Tax Sheet: pick the file, review what would
 * change, then apply. The server re-reads the file on apply.
 */
export default function TaxSheetImportDialog({ companyId, onClose, onApplied }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const close = () => { if (!busy) onClose(); };

  const pick = async (f) => {
    setFile(f); setResult(null);
    if (!f) return;
    setBusy(true);
    try { setResult((await previewTaxSheetImport(companyId, f)).data); }
    catch (e) { notify(e?.response?.data?.message || "Could not read the file.", "error"); setFile(null); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true);
    try {
      const { data } = await commitTaxSheetImport(companyId, file);
      setResult(data);
      const left = data.invoicesInFile - data.invoicesReady;
      notify(`${data.invoicesReady} of ${data.invoicesInFile} invoice(s) adjusted${left ? `, ${left} not adjusted` : ""}.`, left ? "warning" : "success");
      onApplied?.();
    } catch (e) { notify(e?.response?.data?.message || "Failed to apply the tax sheet.", "error"); }
    finally { setBusy(false); }
  };

  const done = !!result?.committed;
  const notAdjusted = result ? result.invoicesInFile - result.invoicesReady : 0;

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={close}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px` }} onClick={(e) => e.stopPropagation()}>
        <div data-admin-header="" style={formStyles.header}>
          <h3 style={formStyles.title}>Import adjusted tax sheet</h3>
          <button data-admin-close="" style={formStyles.closeButton} onClick={close} aria-label="Close">
            <MdClose size={20} />
          </button>
        </div>

        <div data-admin-body="" style={formStyles.body}>
          <p style={{ margin: "0 0 1rem", fontSize: "0.88rem", color: muted, lineHeight: 1.6 }}>
            Export the sheet from <strong>Reports, Tax Sheet, Excel</strong> and fill the yellow columns:
            <strong> Real Hscode</strong> on every line, <strong>FBR Unit</strong> only when the HS code has several units,
            and <strong>Filing Qty</strong> or <strong>Real Item Description</strong> only where the filing differs.
            Lines with the same HS code on one invoice are filed as one row. Nothing is saved until you press Apply.
          </p>

          <input ref={input} type="file" accept=".xlsx" hidden disabled={busy}
            onChange={(e) => { pick(e.target.files?.[0] || null); e.target.value = ""; }} />
          <button type="button" disabled={busy || done} onClick={() => input.current?.click()}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: "0.75rem", textAlign: "left",
              padding: "0.9rem 1rem", borderRadius: 12, cursor: busy || done ? "default" : "pointer",
              background: "#f7faff", border: "1.5px dashed #9db8e0", color: ink, boxShadow: "none",
            }}>
            <MdUploadFile size={28} color="#0d47a1" style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 700, fontSize: "0.92rem", overflowWrap: "anywhere" }}>
                {file ? file.name : "Choose the filled Excel file"}
              </span>
              <span style={{ display: "block", fontSize: "0.78rem", color: muted }}>
                {busy ? "Reading…" : file ? "Pick another file to start again" : ".xlsx, up to 10 MB"}
              </span>
            </span>
          </button>

          {result && (
            <div style={{ marginTop: "1rem" }}>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: "0.6rem",
              }}>
                <Stat label={done ? "Adjusted" : "Ready to adjust"} value={`${result.invoicesReady} of ${result.invoicesInFile}`} tone="ok" />
                <Stat label="Filing rows" value={result.filingRows} />
                <Stat label="Lines read" value={result.linesRead} />
                <Stat label={done ? "Not adjusted" : "Need attention"} value={notAdjusted} tone={notAdjusted ? "bad" : undefined} />
              </div>

              {done && (
                <div style={{
                  marginTop: "0.8rem", display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.7rem 0.9rem",
                  borderRadius: 10, background: "#e8f5e9", color: "#2e7d32", fontWeight: 600, fontSize: "0.88rem",
                }}>
                  <MdCheckCircle size={20} style={{ flexShrink: 0 }} />
                  {result.invoicesReady} invoice(s) adjusted, {result.filingRows} filing row(s) saved.
                </div>
              )}

              {result.issues.length > 0 && (
                <div style={{ marginTop: "0.8rem" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "#c62828", marginBottom: "0.4rem", display: "flex", gap: 6, alignItems: "center" }}>
                    <MdErrorOutline size={18} /> {result.issues.length} problem(s). Invoices with a problem are left unchanged.
                  </div>
                  <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${line}`, borderRadius: 10 }}>
                    {result.issues.map((i, n) => (
                      <div key={n} style={{
                        display: "flex", gap: "0.6rem", padding: "0.55rem 0.8rem", fontSize: "0.84rem", lineHeight: 1.45,
                        borderTop: n ? `1px solid ${line}` : "none", background: n % 2 ? "#fafbfd" : "#fff",
                      }}>
                        <span style={{ fontWeight: 700, color: "#0d47a1", minWidth: 34, flexShrink: 0 }}>{i.invoiceNumber || "·"}</span>
                        <span style={{ color: ink, overflowWrap: "anywhere" }}>{i.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div data-admin-footer="" style={formStyles.footer}>
          <button data-admin-close="" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={close} disabled={busy}>
            {done ? "Close" : "Cancel"}
          </button>
          {result && !done && (
            <button style={{ ...formStyles.button, ...formStyles.submit, opacity: busy || result.invoicesReady === 0 ? 0.6 : 1 }}
              onClick={apply} disabled={busy || result.invoicesReady === 0}>
              {busy ? "Applying…" : `Apply to ${result.invoicesReady} invoice(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const c = tone === "ok" ? "#2e7d32" : tone === "bad" ? "#c62828" : ink;
  return (
    <div style={{ background: "#f7faff", border: `1px solid ${line}`, borderRadius: 10, padding: "0.55rem 0.75rem" }}>
      <div style={{ fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: muted }}>{label}</div>
      <div style={{ fontSize: "1.15rem", fontWeight: 800, color: c }}>{value}</div>
    </div>
  );
}
