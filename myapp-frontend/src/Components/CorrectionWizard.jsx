import { useEffect, useMemo, useState } from "react";
import { MdClose, MdPostAdd, MdInfoOutline, MdArrowBack } from "react-icons/md";
import { getInvoiceById, supplementInvoice, createNote, markInvoiceFbrCancelled } from "../api/invoiceApi";
import { notify } from "../utils/notify";
import { formStyles } from "../theme";
import { Alert, Facts, Field, TableWrap } from "../ui/Kit";

// Unified post-FBR-submission correction wizard. A submitted invoice can't be
// edited at FBR, so every fix is a linked document. The operator picks what went
// wrong; the wizard issues the correct instrument via the existing endpoints:
//   • More goods delivered (under-billed qty) -> UNCLASSIFIED supplementary bill
//     (+ cloned challan/PO), handed to the tax consultant to classify & submit.
//   • Overcharged / goods returned          -> Credit Note (refund at orig rate).
//   • Undercharged rate (same qty)          -> Debit Note (per-unit delta).
const MODES = {
  supp:   { key: "supp",   label: "More goods were delivered", blurb: "The bill under-states the quantity (e.g. billed 1, delivered 6.5). Bill the balance.", doc: "Supplementary bill", tint: "#0e7c6b", soft: "#d6eee8" },
  credit: { key: "credit", label: "Overcharged / goods returned", blurb: "Billed too much, a discount applies, or the buyer returned some/all goods.", doc: "Credit Note", tint: "#9a6410", soft: "#f6e7c9" },
  debit:  { key: "debit",  label: "Undercharged rate (same quantity)", blurb: "Quantity is right; the unit price should have been higher.", doc: "Debit Note", tint: "#5e3f94", soft: "#e7def5" },
  // FBR lets a filed invoice be withdrawn on their portal within 72 hours of
  // submission. That is done THERE; this records it here and undoes what the
  // bill did: it stops counting as a sale, its challans go back into the
  // billable pool, and its stock comes back. The bill itself stays visible with
  // its number and IRN — it is not voided.
  cancel: { key: "cancel", label: "Cancelled on the FBR portal", blurb: "You withdrew this filing at FBR (allowed within 72 hours). Record it here so the bill stops counting as a sale and its challans can be billed again.", doc: "FBR cancellation", tint: "#b3261e", soft: "#f9dedc" },
};

const REASONS = {
  supp:   ["Balance quantity delivered", "Additional supply against same PO", "Other"],
  credit: ["Return of goods", "Cancellation of supply", "Change in value of supply", "Others"],
  debit:  ["Change in value of supply", "Change in amount of tax", "Others"],
  cancel: ["Cancelled at FBR within 72 hours", "Wrong buyer", "Wrong amount", "Duplicate filing", "Others"],
};

export default function CorrectionWizard({ invoice, onClose, onCreated }) {
  const [step, setStep] = useState("diagnose"); // diagnose | figures
  const [mode, setMode] = useState(null);
  const [lines, setLines] = useState(null);
  const [carryChallan, setCarryChallan] = useState(true);
  // A withdrawal inside the 72-hour window usually needs NO credit note: the
  // filing is gone and the customer never receives one. Ticking this raises a
  // full credit note as well, for the case where the customer has already been
  // given the invoice and expects a document against it.
  const [alsoCreditNote, setAlsoCreditNote] = useState(false);
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const gstRate = Number(invoice?.gstRate ?? 0);
  // How long ago this was filed, so the dialog can say what is left of FBR's
  // 72-hour cancellation window. Null when the bill was never filed.
  const hoursSinceFiling = useMemo(() => {
    if (!invoice?.fbrSubmittedAt) return null;
    const t = new Date(invoice.fbrSubmittedAt).getTime();
    return Number.isFinite(t) ? (Date.now() - t) / 36e5 : null;
  }, [invoice?.fbrSubmittedAt]);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const full = invoice?.items?.length ? invoice : (await getInvoiceById(invoice.id)).data;
        if (off) return;
        setLines((full.items || []).map((it) => ({
          invoiceItemId: it.id,
          description: it.description,
          billedQty: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          // supp/credit edit the QTY; debit edits the RATE. Seed both to billed.
          qty: String(Number(it.quantity) || 0),
          rate: String(Number(it.unitPrice) || 0),
        })));
      } catch { if (!off) setLoadErr("Could not load the bill's line items."); }
    })();
    return () => { off = true; };
  }, [invoice]);

  function pick(m) {
    setMode(m);
    setReason(REASONS[m][0]);
    setStep("figures");
  }

  // Per-line contribution for the chosen mode.
  const computed = useMemo(() => {
    if (!lines || !mode) return { rows: [], subtotal: 0, valid: false };
    const rows = lines.map((l) => {
      if (mode === "supp") {
        const c = parseFloat(l.qty);
        const delta = Number.isFinite(c) ? +(c - l.billedQty).toFixed(4) : 0;
        const q = delta > 0 ? delta : 0;
        return { ...l, use: q, unit: l.unitPrice, amount: +(q * l.unitPrice).toFixed(2), show: q > 0 };
      }
      if (mode === "credit") {
        const c = parseFloat(l.qty);
        const ret = Number.isFinite(c) ? Math.min(Math.max(l.billedQty - c, 0), l.billedQty) : 0; // reduction
        return { ...l, use: +ret.toFixed(4), unit: l.unitPrice, amount: +(ret * l.unitPrice).toFixed(2), show: ret > 0 };
      }
      // debit — per-unit rate delta on the full billed qty
      const r = parseFloat(l.rate);
      const d = Number.isFinite(r) ? +(r - l.unitPrice).toFixed(2) : 0;
      const perUnit = d > 0 ? d : 0;
      return { ...l, use: l.billedQty, unit: perUnit, amount: +(l.billedQty * perUnit).toFixed(2), show: perUnit > 0 };
    });
    const subtotal = +rows.reduce((s, r) => s + r.amount, 0).toFixed(2);
    return { rows, subtotal, valid: rows.some((r) => r.show) };
  }, [lines, mode]);

  const gstAmount = +(computed.subtotal * gstRate / 100).toFixed(2);
  const grand = +(computed.subtotal + gstAmount).toFixed(2);
  const setField = (idx, field, val) => setLines((p) => p.map((l, i) => (i === idx ? { ...l, [field]: val } : l)));

  async function submit() {
    // Cancelling at FBR is about the WHOLE bill, so it has no per-line figures
    // to validate — the other three modes do.
    if (mode === "cancel") {
      setSaving(true);
      try {
        // The credit note first, while the bill is still linked to its challans:
        // creating it afterwards would find nothing to reverse.
        if (alsoCreditNote) {
          await createNote({
            originalInvoiceId: invoice.id,
            documentType: 10,
            reason: reason?.trim() || "Cancellation of supply",
            remarks: remarks?.trim() || null,
          });
        }
        const res = await markInvoiceFbrCancelled(invoice.id, reason?.trim() || null);
        onCreated?.(res.data, "cancel");
      } catch (e) {
        notify(e?.response?.data?.error || "Could not record the FBR cancellation.", "error");
      } finally { setSaving(false); }
      return;
    }

    const rows = computed.rows.filter((r) => r.show);
    if (rows.length === 0) return;
    setSaving(true);
    try {
      let res;
      if (mode === "supp") {
        res = await supplementInvoice(invoice.id, {
          lines: rows.map((r) => ({ invoiceItemId: r.invoiceItemId, quantity: r.use })),
          carryChallan, reason: reason?.trim() || null,
        });
      } else {
        res = await createNote({
          originalInvoiceId: invoice.id,
          documentType: mode === "credit" ? 10 : 9,
          reason: reason?.trim() || null,
          remarks: remarks?.trim() || null,
          lines: rows.map((r) => (mode === "debit"
            ? { invoiceItemId: r.invoiceItemId, quantity: r.use, unitPrice: r.unit } // per-unit delta
            : { invoiceItemId: r.invoiceItemId, quantity: r.use })),
        });
      }
      onCreated?.(res.data, mode);
    } catch (e) {
      notify(e?.response?.data?.error || "Could not create the correction.", "error");
    } finally { setSaving(false); }
  }

  // Cancelling at FBR is about the WHOLE bill: there is nothing per-line to
  // adjust, so `computed.valid` (which asks "has any line a figure?") is always
  // false for it and would leave the button permanently dead.
  const canSubmit = mode === "cancel" ? true : computed.valid;

  const M = mode ? MODES[mode] : null;

  return (
    // Never-clip pattern: formStyles.backdrop scrolls (overflowY:auto) and the
    // modal caps at 96vh with its own scrolling body, so a tall wizard is always
    // reachable top to bottom. zIndex 1100 sits above the fixed sidebar (1040).
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: 720 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={formStyles.header}>
          <div style={{ minWidth: 0 }}>
            <div style={s.eyebrow}>Correct a submitted bill · #{invoice?.invoiceNumber}</div>
            <h2 style={formStyles.title}>{step === "diagnose" ? "What needs correcting?" : M?.label}</h2>
          </div>
          <button data-admin-close="" style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={20} /></button>
        </div>

        <div style={formStyles.body}>
        {loadErr && <Alert tone="error">{loadErr}</Alert>}

        {step === "diagnose" && (
          <div style={s.opts}>
            <div style={s.info}>
              <MdInfoOutline size={18} style={{ flex: "0 0 auto", marginTop: 1 }} />
              <span>This bill is filed at FBR and can't be edited. Pick what happened — the wizard issues the correct linked document.</span>
            </div>
            {Object.values(MODES).map((m) => (
              <button key={m.key} style={s.opt} onClick={() => pick(m.key)}>
                <span>
                  <span style={s.optTitle}>{m.label}</span>
                  <span style={s.optBlurb}>{m.blurb}</span>
                </span>
                <span style={{ ...s.chip, color: m.tint, background: m.soft }}>{m.doc}</span>
              </button>
            ))}
          </div>
        )}

        {step === "figures" && lines && (
          <>
            <div style={{ ...s.info, background: M.soft, color: "#16202b", border: "1px solid rgba(0,0,0,.06)" }}>
              <MdInfoOutline size={18} style={{ flex: "0 0 auto", marginTop: 1 }} />
              <span>
                {mode === "supp" && <>Enter the <b>true</b> quantity per line. A new <b>unclassified</b> bill is created for the difference, carrying the same challan/PO — the tax consultant then classifies (HS) and submits to FBR.</>}
                {mode === "credit" && <>Enter the quantity that <b>stays</b> (reduce it for the returned/over-billed amount). A <b>Credit Note</b> refunds the difference at the original rate, then Validates &amp; Submits to FBR.</>}
                {mode === "debit" && <>Enter the <b>corrected higher rate</b> per line. A <b>Debit Note</b> reports the per-unit difference (capped at the original rate), then Validates &amp; Submits to FBR.</>}
                {mode === "cancel" && <>This records a cancellation you have <b>already made on the FBR portal</b> — it does not cancel anything at FBR. The bill keeps its number and IRN and stays visible, marked <b>Cancelled at FBR</b>; it stops counting as a sale, its delivery challans return to the billable list, and its stock comes back.</>}
              </span>
            </div>

            {mode === "cancel" ? (
              <div style={s.cancelPanel}>
                <Facts facts={[
                  ["Bill", `#${invoice?.invoiceNumber}`],
                  invoice?.fbrInvoiceNumber && ["FBR IRN", <span style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{invoice.fbrInvoiceNumber}</span>],
                  ["Filed", (
                    <>
                      {invoice?.fbrSubmittedAt ? new Date(invoice.fbrSubmittedAt).toLocaleString() : "—"}
                      {hoursSinceFiling !== null && (
                        <span style={{
                          display: "block", fontSize: "0.76rem", fontWeight: 700,
                          color: hoursSinceFiling <= 72 ? "#0e7c6b" : "#b3261e",
                        }}>
                          {hoursSinceFiling <= 72
                            ? `${Math.max(0, Math.floor(72 - hoursSinceFiling))}h left of FBR's 72-hour window`
                            : `${Math.floor(hoursSinceFiling)}h ago — past FBR's 72-hour window`}
                        </span>
                      )}
                    </>
                  )],
                  ["Value", Number(invoice?.grandTotal || 0).toLocaleString()],
                ]} />
                {hoursSinceFiling !== null && hoursSinceFiling > 72 && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <Alert tone="warn">
                      FBR's window has passed, so the filing may no longer be cancellable there.
                      Record this only if the portal actually accepted the cancellation — otherwise
                      raise a Credit Note instead.
                    </Alert>
                  </div>
                )}
              </div>
            ) : (
            <TableWrap data-admin-table-region="">
              <table className="k-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="k-num">Billed</th>
                    <th className="k-num">Rate</th>
                    <th className="k-num">{mode === "debit" ? "Corrected rate" : mode === "credit" ? "Qty kept" : "Corrected qty"}</th>
                    <th className="k-num">{mode === "credit" ? "Refund" : mode === "debit" ? "Δ value" : "Δ to bill"}</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.rows.map((r, i) => (
                    <tr key={r.invoiceItemId}>
                      <td>{r.description}</td>
                      <td className="k-num">{r.billedQty}</td>
                      <td className="k-num">{r.unitPrice.toLocaleString()}</td>
                      <td className="k-num">
                        {mode === "debit" ? (
                          <input className="k-input" style={s.qty} type="number" min={r.unitPrice} step="1" inputMode="decimal" value={r.rate} onChange={(e) => setField(i, "rate", e.target.value)} />
                        ) : (
                          <input className="k-input" style={s.qty} type="number" min={mode === "credit" ? 0 : r.billedQty} max={mode === "credit" ? r.billedQty : undefined} step="0.5" inputMode="decimal" value={r.qty} onChange={(e) => setField(i, "qty", e.target.value)} />
                        )}
                      </td>
                      <td className="k-num" style={{ fontWeight: 700, color: r.show ? M.tint : "#90a4ae" }}>
                        {r.show ? (mode === "credit" ? "-" : "+") + r.amount.toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            )}

            <div style={s.footRow}>
              {mode === "supp" && (
                <label style={s.check}>
                  <input type="checkbox" checked={carryChallan} onChange={(e) => setCarryChallan(e.target.checked)} />
                  <span>Carry the delivery challan &amp; PO onto the new bill</span>
                </label>
              )}
              {mode === "cancel" && (
                <label style={s.check}>
                  <input type="checkbox" checked={alsoCreditNote} onChange={(e) => setAlsoCreditNote(e.target.checked)} />
                  <span>
                    Also raise a full Credit Note
                    <span style={{ color: "#5f6d7e", fontWeight: 400 }}>
                      {" "}— only if the customer already has the invoice and needs a document against it.
                      A withdrawn filing normally needs none.
                    </span>
                  </span>
                </label>
              )}
              {mode === "cancel" ? (
                // A whole-bill withdrawal has no per-line figures, so Subtotal /
                // GST / Total of zero said nothing. State what stops being a sale.
                <div style={s.totals}>
                  <span style={{ fontSize: 16 }}>
                    No longer a sale <b>Rs {Number(invoice?.grandTotal || 0).toLocaleString()}</b>
                  </span>
                </div>
              ) : (
                <div style={s.totals}>
                  <span>Subtotal <b>{computed.subtotal.toLocaleString()}</b></span>
                  <span>GST {gstRate}% <b>{gstAmount.toLocaleString()}</b></span>
                  <span style={{ fontSize: 16 }}>{mode === "credit" ? "Refund" : "Total"} <b>Rs {grand.toLocaleString()}</b></span>
                </div>
              )}
            </div>

            <div className="k-form-grid" style={{ marginTop: 14 }}>
              <Field label="Reason" htmlFor="cw-reason">
                <select id="cw-reason" className="k-select" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS[mode].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              {(reason === "Others" || reason === "Other") && (
                <Field label="Remarks" htmlFor="cw-remarks">
                  <input id="cw-remarks" className="k-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Required when reason is Others" />
                </Field>
              )}
            </div>
          </>
        )}
        </div>

        {step === "figures" && lines && (
          <div style={{ ...formStyles.footer, justifyContent: "space-between" }}>
            <button
              style={{ ...formStyles.button, ...formStyles.cancel, ...s.btnInline }}
              onClick={() => setStep("diagnose")}
              disabled={saving}
            >
              <MdArrowBack size={16} /> Back
            </button>
            <button
              style={{ ...formStyles.button, ...s.btnInline, background: M.tint, color: "#fff", opacity: !canSubmit || saving ? 0.5 : 1, cursor: !canSubmit || saving ? "not-allowed" : "pointer" }}
              onClick={submit}
              disabled={!canSubmit || saving}
              title={!canSubmit ? "Adjust a line to create the correction." : `Create the ${M.doc}`}
            >
              <MdPostAdd size={18} />
              {saving ? "Creating…" : `Create ${M.doc}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  // Whole-bill cancellation has no per-line figures, so it states the document
  // being withdrawn instead of a table.
  cancelPanel: { border: "1px solid var(--k-line)", borderRadius: "var(--k-radius)", padding: "var(--k-card-pad)", background: "var(--k-surface-2)" },
  // Sits on the themed modal header (gradient in Classic, light in Workspace),
  // so it follows the header's title colour at reduced emphasis.
  eyebrow: { fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ui-modal-title-color, #ffffff)", opacity: 0.85, fontWeight: 700, marginBottom: 2 },
  info: { display: "flex", gap: 10, background: "#eef1f4", color: "#46586b", borderRadius: "var(--k-radius)", padding: "0.6rem 0.8rem", fontSize: "var(--k-font)", lineHeight: 1.45, marginBottom: 14 },
  opts: { display: "grid", gap: 10 },
  // padding/margin/boxShadow/fontWeight override the global `button` rule (index.css).
  opt: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, textAlign: "left", border: "1px solid var(--k-line-strong)", background: "var(--k-surface)", borderRadius: "var(--k-radius)", padding: "var(--k-card-pad)", margin: 0, boxShadow: "none", fontFamily: "inherit", fontWeight: 400, cursor: "pointer", color: "var(--k-ink)" },
  optTitle: { display: "block", fontWeight: 700, fontSize: "calc(var(--k-font) + 0.05rem)", color: "var(--k-ink)" },
  optBlurb: { display: "block", fontSize: "var(--k-font-sm)", color: "var(--k-muted)", marginTop: 3 },
  chip: { flex: "0 0 auto", fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 99 },
  qty: { width: 96, textAlign: "right", fontVariantNumeric: "tabular-nums" },
  footRow: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, margin: "14px 2px 2px" },
  check: { display: "flex", gap: 8, alignItems: "center", fontSize: "var(--k-font)", color: "var(--k-muted)", cursor: "pointer" },
  totals: { display: "flex", gap: 16, alignItems: "baseline", fontSize: "var(--k-font)", color: "var(--k-muted)", fontVariantNumeric: "tabular-nums", flexWrap: "wrap", marginLeft: "auto" },
  btnInline: { display: "inline-flex", alignItems: "center", gap: 6 },
};
