import { useEffect, useMemo, useState } from "react";
import { MdClose, MdPostAdd, MdInfoOutline, MdArrowBack } from "react-icons/md";
import { getInvoiceById, supplementInvoice, createNote, markInvoiceFbrCancelled } from "../api/invoiceApi";
import { notify } from "../utils/notify";

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

  const M = mode ? MODES[mode] : null;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={s.head}>
          <div>
            <div style={s.eyebrow}>Correct a submitted bill · #{invoice?.invoiceNumber}</div>
            <h2 style={s.title}>{step === "diagnose" ? "What needs correcting?" : M?.label}</h2>
          </div>
          <button style={s.iconBtn} onClick={onClose} aria-label="Close"><MdClose size={20} /></button>
        </div>

        {loadErr && <div style={s.err}>{loadErr}</div>}

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
                <div style={s.cancelRow}>
                  <span style={s.cancelKey}>Bill</span>
                  <span style={s.cancelVal}>#{invoice?.invoiceNumber}</span>
                </div>
                {invoice?.fbrInvoiceNumber && (
                  <div style={s.cancelRow}>
                    <span style={s.cancelKey}>FBR IRN</span>
                    <span style={{ ...s.cancelVal, fontFamily: "monospace", fontSize: "0.82rem" }}>{invoice.fbrInvoiceNumber}</span>
                  </div>
                )}
                <div style={s.cancelRow}>
                  <span style={s.cancelKey}>Filed</span>
                  <span style={s.cancelVal}>
                    {invoice?.fbrSubmittedAt ? new Date(invoice.fbrSubmittedAt).toLocaleString() : "—"}
                    {hoursSinceFiling !== null && (
                      <span style={{
                        marginLeft: 8, fontSize: "0.76rem", fontWeight: 700,
                        color: hoursSinceFiling <= 72 ? "#0e7c6b" : "#b3261e",
                      }}>
                        {hoursSinceFiling <= 72
                          ? `${Math.max(0, Math.floor(72 - hoursSinceFiling))}h left of FBR's 72-hour window`
                          : `${Math.floor(hoursSinceFiling)}h ago — past FBR's 72-hour window`}
                      </span>
                    )}
                  </span>
                </div>
                <div style={s.cancelRow}>
                  <span style={s.cancelKey}>Value</span>
                  <span style={s.cancelVal}>{Number(invoice?.grandTotal || 0).toLocaleString()}</span>
                </div>
                {hoursSinceFiling !== null && hoursSinceFiling > 72 && (
                  <div style={s.cancelWarn}>
                    FBR's window has passed, so the filing may no longer be cancellable there.
                    Record this only if the portal actually accepted the cancellation — otherwise
                    raise a Credit Note instead.
                  </div>
                )}
              </div>
            ) : (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Item</th>
                    <th style={{ ...s.th, textAlign: "right" }}>Billed</th>
                    <th style={{ ...s.th, textAlign: "right" }}>Rate</th>
                    <th style={{ ...s.th, textAlign: "right" }}>{mode === "debit" ? "Corrected rate" : mode === "credit" ? "Qty kept" : "Corrected qty"}</th>
                    <th style={{ ...s.th, textAlign: "right" }}>{mode === "credit" ? "Refund" : mode === "debit" ? "Δ value" : "Δ to bill"}</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.rows.map((r, i) => (
                    <tr key={r.invoiceItemId}>
                      <td style={s.td}>{r.description}</td>
                      <td style={{ ...s.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.billedQty}</td>
                      <td style={{ ...s.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.unitPrice.toLocaleString()}</td>
                      <td style={{ ...s.td, textAlign: "right" }}>
                        {mode === "debit" ? (
                          <input style={s.qty} type="number" min={r.unitPrice} step="1" inputMode="decimal" value={r.rate} onChange={(e) => setField(i, "rate", e.target.value)} />
                        ) : (
                          <input style={s.qty} type="number" min={mode === "credit" ? 0 : r.billedQty} max={mode === "credit" ? r.billedQty : undefined} step="0.5" inputMode="decimal" value={r.qty} onChange={(e) => setField(i, "qty", e.target.value)} />
                        )}
                      </td>
                      <td style={{ ...s.td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: r.show ? M.tint : "#90a4ae" }}>
                        {r.show ? (mode === "credit" ? "-" : "+") + r.amount.toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              <div style={s.totals}>
                <span>Subtotal <b>{computed.subtotal.toLocaleString()}</b></span>
                <span>GST {gstRate}% <b>{gstAmount.toLocaleString()}</b></span>
                <span style={{ fontSize: 16 }}>{mode === "credit" ? "Refund" : "Total"} <b>Rs {grand.toLocaleString()}</b></span>
              </div>
            </div>

            <div style={s.grid2}>
              <div>
                <label style={s.lbl}>Reason</label>
                <select style={s.text} value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS[mode].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              {(reason === "Others" || reason === "Other") && (
                <div>
                  <label style={s.lbl}>Remarks</label>
                  <input style={s.text} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Required when reason is Others" />
                </div>
              )}
            </div>

            <div style={s.actions}>
              <button style={s.btnGhost} onClick={() => setStep("diagnose")} disabled={saving}><MdArrowBack size={16} /> Back</button>
              <button
                style={{ ...s.btnPrimary, background: M.tint, opacity: !computed.valid || saving ? 0.5 : 1, cursor: !computed.valid || saving ? "not-allowed" : "pointer" }}
                onClick={submit}
                disabled={!computed.valid || saving}
                title={!computed.valid ? "Adjust a line to create the correction." : `Create the ${M.doc}`}
              >
                <MdPostAdd size={18} />
                {saving ? "Creating…" : `Create ${M.doc}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const s = {
  // Whole-bill cancellation has no per-line figures, so it states the document
  // being withdrawn instead of a table.
  cancelPanel: { border: "1px solid #e8edf3", borderRadius: 10, padding: "0.8rem 1rem", background: "#fbfcfe", display: "flex", flexDirection: "column", gap: 8 },
  cancelRow: { display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" },
  cancelKey: { fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5f6d7e", minWidth: 62 },
  cancelVal: { fontWeight: 700, color: "#16202b", minWidth: 0, overflowWrap: "anywhere" },
  cancelWarn: { marginTop: 4, padding: "0.5rem 0.7rem", borderRadius: 8, background: "#fff4e5", color: "#8a4b00", fontSize: "0.82rem", lineHeight: 1.4 },
  // Overlay scrolls (overflowY) and the card uses margin:auto so it centres
  // when it fits and pins to the top (fully reachable, never clipped) when it's
  // taller than the viewport. zIndex 1100 sits above the fixed sidebar (1040).
  overlay: { position: "fixed", inset: 0, background: "rgba(15,22,32,.5)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "24px 16px", zIndex: 1100, overflowY: "auto" },
  card: { background: "#fff", borderRadius: 12, width: "min(720px,100%)", margin: "auto", boxShadow: "0 20px 60px -20px rgba(0,0,0,.4)", padding: 20 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  eyebrow: { fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "#0a5d50", fontWeight: 700 },
  title: { margin: "2px 0 0", fontSize: 20, color: "#16202b", lineHeight: 1.15 },
  // padding:0 + boxShadow:none override the global `button` rule (index.css
  // padding .8em 1.6em) that otherwise off-centres the icon and adds a shadow.
  iconBtn: { display: "grid", placeItems: "center", width: 34, height: 34, padding: 0, border: "1px solid #dce2e8", background: "#fff", borderRadius: 8, boxShadow: "none", cursor: "pointer", color: "#46586b", flexShrink: 0 },
  info: { display: "flex", gap: 10, background: "#eef1f4", color: "#46586b", borderRadius: 8, padding: "11px 13px", fontSize: 13, lineHeight: 1.45, marginBottom: 14 },
  err: { background: "#fdecea", color: "#a5384a", border: "1px solid #f5c6cb", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 12 },
  opts: { display: "grid", gap: 10 },
  opt: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, textAlign: "left", border: "1px solid #dce2e8", background: "#fff", borderRadius: 10, padding: "14px 16px", cursor: "pointer" },
  optTitle: { display: "block", fontWeight: 700, fontSize: 15, color: "#16202b" },
  optBlurb: { display: "block", fontSize: 13, color: "#607282", marginTop: 3 },
  chip: { flex: "0 0 auto", fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 99 },
  tableWrap: { overflowX: "auto", border: "1px solid #eceff1", borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13.5 },
  th: { textAlign: "left", fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "#7c8ca0", fontWeight: 700, padding: "10px 12px", borderBottom: "1px solid #eceff1", whiteSpace: "nowrap" },
  td: { padding: "10px 12px", borderBottom: "1px solid #f2f4f6", color: "#16202b" },
  qty: { width: 96, padding: "7px 9px", border: "1px solid #cfd8dc", borderRadius: 6, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13.5 },
  footRow: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, margin: "14px 2px 2px" },
  check: { display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#46586b", cursor: "pointer" },
  totals: { display: "flex", gap: 16, alignItems: "baseline", fontSize: 13, color: "#46586b", fontVariantNumeric: "tabular-nums", flexWrap: "wrap", marginLeft: "auto" },
  grid2: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px,100%), 1fr))", gap: 12, marginTop: 14 },
  lbl: { display: "block", fontSize: 12, fontWeight: 700, color: "#46586b", marginBottom: 5 },
  text: { width: "100%", padding: "9px 11px", border: "1px solid #cfd8dc", borderRadius: 6, fontSize: 14, boxSizing: "border-box", background: "#fff" },
  actions: { display: "flex", justifyContent: "space-between", gap: 10, marginTop: 18 },
  btnGhost: { display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 8, border: "1px solid #cfd8dc", background: "#fff", color: "#46586b", fontWeight: 600, fontSize: 14, cursor: "pointer" },
  btnPrimary: { display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 20px", borderRadius: 8, border: "none", color: "#fff", fontWeight: 700, fontSize: 14 },
};
