import { useState } from "react";
import { MdClose, MdWarningAmber } from "react-icons/md";
import { formStyles, modalSizes } from "../theme";
import { Alert, Field } from "../ui/Kit";
import { resetFbrSubmission } from "../api/fbrApi";

/**
 * Admin recovery for a bill locked in a non-resubmittable FBR state — "Uncertain"
 * (a submit timed out and its FBR outcome is unconfirmed) or "Submitting" (a
 * submit crashed mid-flight). This is the deliberate valve for the double-submit
 * guard: it never contacts FBR, it only fixes our local record.
 *
 *   • retry          — clear the FBR fields so the bill can be submitted again.
 *                      SAFE ONLY after verifying at FBR that no invoice exists.
 *   • recordExisting  — record an IRN found at FBR, marking the bill Submitted.
 *
 * Gated by invoices.fbr.reset (the caller only renders this for holders of it).
 */
export default function FbrResetModal({ invoice, onClose, onDone }) {
  const [mode, setMode] = useState("retry");
  const [irn, setIrn] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!reason.trim()) {
      setError("A reason is required — it is written to the audit log.");
      return;
    }
    if (mode === "recordExisting" && !irn.trim()) {
      setError("Enter the IRN you confirmed at FBR.");
      return;
    }
    setBusy(true);
    try {
      await resetFbrSubmission(invoice.id, {
        mode,
        irn: mode === "recordExisting" ? irn.trim() : null,
        reason: reason.trim(),
      });
      onDone?.();
    } catch (e) {
      setError(e?.response?.data?.message || e?.response?.data?.Message ||
        "Reset failed. Check your permissions and try again.");
      setBusy(false);
    }
  };

  const radioRow = (value, title, desc) => (
    <label
      style={{
        display: "flex", gap: 10, alignItems: "flex-start", padding: "0.6rem 0.8rem",
        border: `1px solid ${mode === value ? "var(--k-blue)" : "var(--k-line)"}`,
        borderRadius: "var(--k-radius)", cursor: "pointer", marginBottom: "0.6rem",
        background: mode === value ? "#eef4ff" : "transparent",
      }}
    >
      <input type="radio" name="reset-mode" value={value} checked={mode === value}
        onChange={() => setMode(value)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontWeight: 700, fontSize: "var(--k-font)", color: "var(--k-ink)" }}>{title}</span>
        <span style={{ display: "block", fontSize: "var(--k-font-sm)", color: "var(--k-muted)", marginTop: 2 }}>{desc}</span>
      </span>
    </label>
  );

  return (
    <div style={formStyles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={{ ...formStyles.modal, maxWidth: modalSizes.md }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>Reset FBR state · Bill #{invoice.invoiceNumber}</h3>
          <button style={formStyles.closeButton} onClick={onClose} disabled={busy} aria-label="Close">
            <MdClose size={18} />
          </button>
        </div>

        <div style={formStyles.body}>
          <Alert tone="warn" icon={MdWarningAmber}>
            This bill is <b>{invoice.fbrStatus}</b>. A submission may already have reached FBR.
            <b> Verify on the FBR / IRIS portal first.</b> Only choose “clear for resubmission” once
            you have confirmed FBR has <b>no</b> invoice for this bill — otherwise you will create a duplicate.
          </Alert>

          {radioRow("retry", "Clear for resubmission",
            "FBR has no record — wipe the local FBR fields so the bill can be submitted again.")}
          {radioRow("recordExisting", "Record the IRN from FBR",
            "FBR does have it — enter the IRN so our books match, without submitting again.")}

          {mode === "recordExisting" && (
            <div style={formStyles.formGroup}>
              <Field label="IRN (from the FBR portal)" htmlFor="fbr-reset-irn">
                <input id="fbr-reset-irn" className="k-input" value={irn} onChange={(e) => setIrn(e.target.value)}
                  placeholder="e.g. 1234567890123DI000001" disabled={busy} />
              </Field>
            </div>
          )}

          <div style={formStyles.formGroup}>
            <Field label="Reason (audited) *" htmlFor="fbr-reset-reason">
              <textarea
                id="fbr-reset-reason"
                className="k-textarea"
                value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}
                placeholder="e.g. Confirmed on IRIS that no invoice exists for bill #… — clearing to resubmit." />
            </Field>
          </div>

          {error && <Alert tone="error">{error}</Alert>}
        </div>

        <div style={formStyles.footer}>
          <button style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button style={{ ...formStyles.button, ...formStyles.submit, opacity: busy ? 0.6 : 1 }}
            onClick={submit} disabled={busy}>
            {busy ? "Applying…" : mode === "retry" ? "Clear & allow resubmit" : "Record IRN"}
          </button>
        </div>
      </div>
    </div>
  );
}
