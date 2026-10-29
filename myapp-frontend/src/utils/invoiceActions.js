// The ONE list of actions an invoice offers, for the card AND the table
// (importer, 2026-10-28, plan D10). Both render this list, so they cannot
// drift: same actions, same order, same words, same tooltips.
//
// Pure and dependency-free (pinned by scripts/test_invoice_screen.mjs). It
// decides only what is OFFERED: an action the user's keys do not allow, or the
// row's state does not allow, is left out -- and statusReason() says why Edit
// is gone from a filed invoice. The server still decides what is allowed.

const isNote = (inv) => inv.documentType === 9 || inv.documentType === 10;
export const isFiled = (inv) => inv.fbrStatus === "Submitted";
export const isInFlight = (inv) => inv.fbrStatus === "Submitting" || inv.fbrStatus === "Uncertain";

/**
 * @param {object} inv  the invoice row (InvoiceDto)
 * @param {object} ctx  { perms: { canEdit, canPrint, canVoid, canDelete, canCopy, canCreateChallan,
 *                       canRecordReceipt, canReverse, canFbrPreview, canFbrValidate, canFbrSubmit,
 *                       canFbrExclude, canFbrReset }, fbrEnabled, hasFbrToken, validated, hasExcel,
 *                       noTemplate, noTemplateReason, futureDated, isNotesMode, noteLabel }
 * @returns {Array<{key, label, title, group, primary?, danger?, disabled?}>}
 */
export function buildInvoiceActions(inv, ctx) {
  const p = ctx.perms || {};
  const filed = isFiled(inv);
  const live = !inv.isCancelled;
  const doc = ctx.isNotesMode ? (ctx.noteLabel || "note") : "invoice";
  const a = [];
  const add = (x) => a.push(x);

  // ── primary: what an operator does most ──────────────────────────────
  // Inline on the card (primary): Edit, Print, PDF and the next FBR step;
  // View joins them when there is no Edit (filed, voided, imported). The
  // rest sit under "More".
  // A bill filed BY HAND on FBR's portal stays editable (the server allows it,
  // so its date or lines can be corrected); nothing here is sent to FBR.
  const editable = p.canEdit && (!filed || !!inv.fbrFiledManually) && live && !inv.isMigrated;
  if (editable)
    add({ key: "edit", label: "Edit", group: "primary", primary: true,
      title: inv.fbrFiledManually
        ? "Correct this invoice here. It was filed by hand on FBR's portal; changes are not sent to FBR."
        : "Change the lines, prices and dates. Allowed until the invoice is filed with FBR." });
  if (p.canPrint)
    add({ key: "print", label: "Print", group: "primary", primary: true, disabled: !!ctx.noTemplate,
      title: ctx.noTemplate ? ctx.noTemplateReason : `Print this ${doc} with your Invoice template.` });
  add({ key: "view", label: "View", group: "primary", primary: !editable,
    title: `Open this ${doc} read-only, with every line and total.` });
  if (p.canPrint)
    add({ key: "pdf", label: "PDF", group: "primary", primary: true, disabled: !!ctx.noTemplate,
      title: ctx.noTemplate ? ctx.noTemplateReason : `Download this ${doc} as a PDF.` });
  if (p.canPrint && ctx.hasExcel)
    add({ key: "excel", label: "Excel", group: "primary", title: `Download this ${doc} as an Excel sheet.` });

  // ── FBR: only the steps that apply to the row's state ─────────────────
  // An SRB / no-tax bill is a sale outside FBR: no FBR step applies to it.
  const outsideFbr = inv.taxTreatment === "SRB" || inv.taxTreatment === "NoTax";
  const fbrFlow = ctx.fbrEnabled && !outsideFbr;
  const fbrOpen = fbrFlow && ctx.hasFbrToken && !filed && !isInFlight(inv) && live && !ctx.futureDated;
  if (fbrOpen && p.canFbrValidate)
    add({ key: "validate", label: ctx.validated ? "Validated" : "Validate", group: "fbr",
      primary: !ctx.validated, disabled: !inv.fbrReady,
      title: !inv.fbrReady
        ? `Complete the FBR details first: ${(inv.fbrMissing || []).join(", ") || "missing FBR fields"}.`
        : "Check this invoice with FBR without filing it. Must pass before you can submit." });
  if (fbrOpen && p.canFbrSubmit)
    add({ key: "submit", label: "Submit to FBR", group: "fbr",
      primary: !!ctx.validated, disabled: !ctx.validated || !inv.fbrReady,
      title: !ctx.validated
        ? "Validate first, then submit."
        : "Send this invoice to FBR. You get an IRN; after this the invoice is locked." });
  if (p.canFbrPreview && fbrFlow)
    add({ key: "preview", label: "FBR preview", group: "fbr",
      title: "See exactly what is (or was) sent to FBR. Nothing is sent." });
  if (p.canFbrExclude && fbrFlow && !filed && live)
    add({ key: "exclude", label: inv.isFbrExcluded ? "Include in FBR" : "Keep out of FBR", group: "fbr",
      title: inv.isFbrExcluded
        ? "Put this invoice back into Validate all / Submit all."
        : "Leave this invoice out of Validate all / Submit all. Its own Validate / Submit still work." });
  if (p.canFbrReset && fbrFlow && !filed && !isInFlight(inv) && live)
    add({ key: "recordManual", label: "Filed on FBR portal", group: "fbr",
      title: "Record that this invoice was already filed by hand on FBR's portal. It is never sent from here." });
  if (p.canFbrReset && isInFlight(inv))
    add({ key: "reset", label: "Reset FBR", group: "fbr",
      title: "Clear a stuck submission. Check on FBR's portal first whether it was filed." });

  // ── money and follow-up documents ─────────────────────────────────────
  if (p.canRecordReceipt && live)
    add({ key: "receipt", label: "Receipt", group: "money",
      title: "Record money received from this customer against this invoice." });
  if (p.canCopy && live && !inv.isMigrated)
    add({ key: "copy", label: "Copy", group: "money", title: "Start a new invoice with the same lines." });
  if (p.canCreateChallan && live && Number(inv.challanRemainingQuantity || 0) > 0)
    add({ key: "challan", label: "Challan", group: "money",
      title: `Make a delivery challan for what is still to deliver (${Number(inv.challanRemainingQuantity).toLocaleString()}).` });
  // Not on a bill filed by hand: a note is filed against the original's IRN,
  // and that bill has none here (it is corrected with Edit instead).
  if (p.canReverse && filed && live && !inv.fbrFiledManually && !inv.fbrCancelledAt && !isNote(inv))
    add({ key: "creditNote", label: "Credit note", group: "money",
      title: "Reverse all or part of this filed invoice with a credit note, then file the note with FBR." });
  if (p.canReverse && filed && live && !inv.fbrFiledManually && ctx.fbrEnabled && !inv.hasSupplement && !inv.isMigrated && !isNote(inv))
    add({ key: "correct", label: "Correct", group: "money",
      title: "Bill quantity that was under-reported on this filed invoice, as a new invoice." });

  // ── danger, last ──────────────────────────────────────────────────────
  if (p.canVoid && !filed && live)
    add({ key: "void", label: "Void", group: "danger", danger: true,
      title: `Cancel this unfiled ${doc}. Its number is kept; stock returns and its challans can be billed again.` });
  if (p.canDelete && !filed && live)
    add({ key: "delete", label: "Delete", group: "danger", danger: true,
      title: `Remove this unfiled ${doc} for good. Stock and the ledger are reversed; its number leaves a gap.` });
  return a;
}

/** Why an expected action is missing, in the operator's words (or null). */
export function statusReason(inv) {
  if (inv.isCancelled) return `Voided${inv.cancelReason ? ` — ${inv.cancelReason}` : ""}. Kept for its number.`;
  if (inv.fbrCancelledAt) return "Withdrawn on FBR's portal — no longer counts as a sale.";
  if (isFiled(inv) && inv.fbrFiledManually) {
    const kept = [...new Set((inv.items || []).filter((i) => i.keepInStock && i.hsCode).map((i) => i.hsCode))];
    return `Filed by hand on FBR's portal${inv.fbrInvoiceNumber ? ` as ${inv.fbrInvoiceNumber}` : ""} — edits here are not sent to FBR.`
      + (kept.length ? ` HS ${kept.join(", ")} kept in stock.` : "");
  }
  if (isFiled(inv)) return "Filed with FBR — correct it with a credit or debit note.";
  if (inv.fbrStatus === "Submitting") return "Being sent to FBR — wait and refresh; do not submit again.";
  if (inv.fbrStatus === "Uncertain") return "FBR's answer was lost — check FBR's portal before anything else.";
  if (inv.isMigrated) return "Brought in from your old books: a total without lines, so it cannot be edited.";
  return null;
}

/**
 * The one FBR status chip. tone: success | info | warn | caution | danger | neutral.
 * Returns null when there is nothing to say (FBR off and never filed).
 */
export function fbrChip(inv, { fbrEnabled = true, validated = false, futureDated = false } = {}) {
  if (inv.isCancelled) return { label: "Voided", tone: "danger", title: "This invoice was voided." };
  if (inv.fbrCancelledAt) return { label: "Withdrawn", tone: "danger",
    title: `Withdrawn on FBR's portal on ${new Date(inv.fbrCancelledAt).toLocaleDateString()}.` };
  if (isFiled(inv)) return inv.fbrFiledManually
    ? { label: "Filed manually", tone: "success", title: `Filed by hand on FBR's portal as ${inv.fbrInvoiceNumber || "—"}.` }
    : { label: "Filed", tone: "success", irn: inv.fbrIRN || null, title: inv.fbrIRN ? `IRN ${inv.fbrIRN}` : "Filed with FBR." };
  if (inv.fbrStatus === "Submitting") return { label: "Sending to FBR…", tone: "info", title: "Wait and refresh. Do not submit again." };
  if (inv.fbrStatus === "Uncertain") return { label: "Outcome unknown", tone: "caution",
    title: "The submission timed out. An administrator must check FBR and reset it." };
  if (inv.taxTreatment === "SRB" || inv.taxTreatment === "NoTax")
    return { label: `${inv.taxTreatment === "NoTax" ? "No tax" : "SRB"} · Outside FBR`, tone: "info", title: "A sale outside FBR. It is never sent to FBR." };
  if (!fbrEnabled) return null;
  if (inv.isFbrExcluded) return { label: "Kept out of FBR", tone: "neutral", title: "Skipped by Validate all / Submit all." };
  if (inv.fbrStatus === "Failed") return { label: "FBR rejected", tone: "danger", title: inv.fbrErrorMessage || "FBR rejected this invoice." };
  if (futureDated) return { label: "Future-dated", tone: "caution", title: "FBR accepts it from its own date." };
  if (!inv.fbrReady) return { label: "FBR details missing", tone: "caution",
    title: (inv.fbrMissing || []).length ? `Missing: ${inv.fbrMissing.join(", ")}` : "Some FBR details are missing." };
  if (validated) return { label: "Checked", tone: "info", title: "Passed FBR validation. Ready to submit." };
  return { label: "Not filed", tone: "warn", title: "Not sent to FBR yet." };
}

/** One row per HS code on the invoice's item lines, with what it covers. */
export function stockGroups(items = []) {
  const byCode = new Map();
  for (const it of items) {
    const code = (it.hsCode || "").trim();
    if (!it.itemTypeId || !code) continue;
    const g = byCode.get(code) || { code, names: new Set(), qty: 0, uoms: new Set(), keep: false };
    g.names.add(it.itemTypeName || it.description || "Item");
    g.qty += Number(it.quantity) || 0;
    if (it.uom) g.uoms.add(it.uom);
    g.keep = g.keep || !!it.keepInStock;
    byCode.set(code, g);
  }
  return [...byCode.values()].map((g) => ({
    code: g.code, names: [...g.names], keep: g.keep,
    qtyLabel: `${+g.qty.toFixed(4)}${g.uoms.size === 1 ? ` ${[...g.uoms][0]}` : ""}`,
  }));
}
