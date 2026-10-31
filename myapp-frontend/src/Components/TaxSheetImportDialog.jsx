import { useState } from "react";
import { MdClose } from "react-icons/md";
import { previewTaxSheetImport, commitTaxSheetImport } from "../api/reportApi";
import { notify } from "../utils/notify";

const overlay = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16, overflowY: "auto",
};
const box = {
  background: "#fff", borderRadius: 12, padding: 20, width: "min(560px, 100%)",
  maxHeight: "94vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
};
const btn = (bg, color = "#fff") => ({
  display: "inline-flex", alignItems: "center", gap: 6, background: bg, color, border: "none",
  borderRadius: 8, padding: "9px 14px", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", minHeight: 40,
});

/**
 * Bulk adjust from a filled-in Tax Sheet: pick the file, review what would
 * change, then apply. The server re-reads the file on apply.
 */
export default function TaxSheetImportDialog({ companyId, onClose, onApplied }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
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
      notify(`${data.invoicesReady} of ${data.invoicesInFile} invoice(s) adjusted${data.issues.length ? `, ${data.issues.length} need attention` : ""}.`, data.issues.length ? "warning" : "success");
      onApplied?.();
    } catch (e) { notify(e?.response?.data?.message || "Failed to apply the tax sheet.", "error"); }
    finally { setBusy(false); }
  };

  return (
    <div data-admin-backdrop="" style={overlay} onClick={close}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#1a2332" }}>Import adjusted tax sheet</h3>
          <button onClick={close} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", color: "#5f6d7e", display: "flex" }}>
            <MdClose size={20} />
          </button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: "0.86rem", color: "#5f6d7e", lineHeight: 1.55 }}>
          Export the sheet from <strong>Reports, Tax Sheet, Excel</strong>, fill <strong>Real Hscode</strong> on every line (and <strong>Real Item Description</strong> or <strong>Filing Qty</strong> only where the filing differs), then upload it. Lines with the same HS code on one invoice are filed as one row. Nothing is saved until you press Apply.
        </p>
        <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => pick(e.target.files?.[0] || null)} />
        {busy && <div style={{ marginTop: 10, color: "#5f6d7e" }} role="status">Working…</div>}
        {result && (
          <div style={{ marginTop: 14, fontSize: "0.88rem", color: "#1a2332" }}>
            {result.committed ? (
              <div style={{ background: "#ecfdf3", border: "1px solid #abefc6", borderRadius: 8, padding: "10px 12px", lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700 }}>{result.invoicesReady} invoice(s) adjusted</div>
                <div>{result.filingRows} filing row(s) saved from {result.linesRead} line(s) read</div>
                <div>{result.invoicesInFile - result.invoicesReady} of {result.invoicesInFile} invoice(s) in the file were not adjusted{result.issues.length ? " (see below)" : ""}</div>
              </div>
            ) : (
              <div><strong>{result.invoicesReady}</strong> of {result.invoicesInFile} invoice(s) ready to adjust · {result.filingRows} filing row(s) · {result.linesRead} line(s) read</div>
            )}
            {result.issues.length > 0 && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, maxHeight: 220, overflowY: "auto", color: "#b42318" }}>
                {result.issues.map((i, n) => <li key={n}>{i.invoiceNumber && <strong>{i.invoiceNumber}: </strong>}{i.message}</li>)}
              </ul>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={close} disabled={busy} style={btn("#eef1f6", "#1a2332")}>{result?.committed ? "Close" : "Cancel"}</button>
          {result && !result.committed && (
            <button onClick={apply} disabled={busy || result.invoicesReady === 0} style={btn("#0d47a1")}>
              Apply to {result.invoicesReady} invoice(s)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
