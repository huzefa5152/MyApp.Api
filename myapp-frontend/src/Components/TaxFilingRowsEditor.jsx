import { useEffect, useRef, useState } from "react";
import { getTaxFiling, saveTaxFiling } from "../api/invoiceApi";
import { getItemTypes } from "../api/itemTypeApi";
import { usePermissions } from "../contexts/PermissionsContext";
import { formStyles, modalSizes } from "../theme";
import { useConfirm } from "./ConfirmDialog";
import FilingClassificationFields from "./FilingClassificationFields";
import { amount, money, mergeFilingRows, separateFilingRow, filingErrors } from "../utils/taxFilingRows";
import "./TaxFilingRowsEditor.css";
import InvoiceDocumentView from "./InvoiceDocumentView";

export default function TaxFilingRowsEditor({ invoiceId, onClose, onSaved, readOnly = false }) {
  const { has } = usePermissions();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [types, setTypes] = useState([]);
  const [selected, setSelected] = useState([]);
  const [busyRows, setBusyRows] = useState(() => new Set());
  // One classification chosen once and applied to every ticked line (lines stay separate rows).
  const [bulk, setBulk] = useState({ sourceLineIds: [], hsCode: "", itemTypeId: null, description: "", uom: "", fbrUOMId: null, saleType: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const errorRef = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const canAdjustNumbers = has("invoices.manage.update.itemtype.qty");
  const editable = !readOnly && (canAdjustNumbers || has("invoices.manage.update.itemtype")) && data?.bill.isEditable && !data?.bill.noteKind;
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data: next } = await getTaxFiling(invoiceId);
        const { data: catalog } = readOnly ? { data: [] } : await getItemTypes(next.bill.companyId);
        if (active) { setData(next); setRows(next.rows); setTypes(catalog || []); }
      } catch (e) { if (active) setError(e.response?.data?.message || "Could not load filing rows. Close and try again."); }
    }
    load();
    closeRef.current?.focus();
    return () => { active = false; };
  }, [invoiceId, readOnly]);
  const changeRows = (next) => { setRows(next); setDirty(true); setError(""); };
  const change = (index, key, value) => changeRows(rows.map((r, i) => i === index ? { ...r, [key]: value } : r));
  const close = async () => {
    if (!saving && (!dirty || await confirm({ title: "Discard filing changes?", message: "Your unsaved filing changes will be discarded. The saved bill stays unchanged.", confirmText: "Discard changes" }))) onClose();
  };
  const keyDown = (event) => {
    if (event.target.closest?.("[data-admin-popup]")) return;
    if (event.key === "Escape") { event.stopPropagation(); close(); }
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const showError = (message) => { setError(message); setTimeout(() => errorRef.current?.focus(), 0); };
  const combine = () => {
    const picked = rows.filter((_, i) => selected.includes(i));
    if (!canAdjustNumbers && new Set(picked.map(r => r.uom)).size > 1)
      return showError("Combining different units requires consultant quantity permission.");
    const treatments = new Set(picked.map(r => JSON.stringify([r.rateId, r.sroScheduleNo, r.sroItemSerialNo, Number(r.retailPrice || 0) > 0])));
    const saleTypes = new Set(picked.map(r => r.saleType?.trim().toLowerCase()).filter(Boolean));
    if (treatments.size > 1 || saleTypes.size > 1) return showError("Selected rows have different tax treatments. Keep them separate and adjust each HS classification.");
    changeRows(mergeFilingRows(rows, selected)); setSelected([]);
  };
  const bulkReady = /^\d{4}\.\d{4}(\.\d{2})?$/.test(bulk.hsCode || "") && !!bulk.uom && !!bulk.saleType && (!!bulk.itemTypeId || !!bulk.description?.trim());
  const applyBulk = () => {
    if (!selected.length || !bulkReady) return;
    changeRows(rows.map((r, i) => !selected.includes(i) ? r : { ...r, itemTypeId: bulk.itemTypeId, hsCode: bulk.hsCode, saleType: bulk.saleType,
      selectedSaleType: bulk.selectedSaleType ?? null, uom: bulk.uom, fbrUOMId: bulk.fbrUOMId, selectedFbrUOMId: bulk.selectedFbrUOMId ?? null,
      description: bulk.description || r.description }));
    setSelected([]);
  };
  const separate = (index) => {
    try { changeRows(rows.flatMap((r, i) => i === index ? separateFilingRow(r, data.bill.items) : [r])); setSelected([]); }
    catch (e) { showError(e.message); }
  };
  const rebuild = async () => {
    if (!await confirm({ title: "Rebuild filing rows?", message: "This replaces the draft with the current bill groups. Review their HS classifications and amounts before saving.", confirmText: "Rebuild rows" })) return;
    changeRows(data.initialRows); setSelected([]);
  };
  const save = async (event) => {
    event.preventDefault();
    if (!editable || saving) return;
    const issues = filingErrors(rows, data.bill);
    if (issues.length) return showError(issues.join("\n"));
    setSaving(true); setError("");
    try {
      const { data: result } = await saveTaxFiling(invoiceId, { version: data.version, rows: rows.map(r => ({ ...r, quantity: Number(r.quantity), valueExclTax: Number(r.valueExclTax) })) });
      setDirty(false); onSaved?.({ ...result.bill, reviewCompleted: true });
    } catch (e) { showError(e.response?.data?.message || "Could not save the filing rows. Your draft is still here. Retry after checking the error."); }
    finally { setSaving(false); }
  };
  const total = rows.reduce((n, r) => n + amount(r.valueExclTax), 0);
  const difference = data ? amount(data.bill.subtotal) - total : 0;
  // A company that prints its original bill lines files every line as its own row: it never combines, it only
  // ticks several lines to give them one HS code. A row merged before that rule keeps "Separate source lines".
  // Every other company keeps the grouped editor exactly as it was, selection controls included.
  const perLine = !!data?.bill?.taxInvoiceUseOriginalBillLines;
  const canCombine = !perLine;
  const canSelect = !perLine || rows.length > 1;
  // For an original-lines company the FBR unit is filled in from FBR, not typed: hold Save until it has arrived for every coded row.
  const unitPending = perLine && (busyRows.size > 0 || rows.some(r => /^\d{4}\.\d{4}(\.\d{2})?$/.test(r.hsCode || "") && !r.uom));
  const reportBusy = (key) => (busy) => setBusyRows(prev => prev.has(key) === busy ? prev : (() => { const next = new Set(prev); busy ? next.add(key) : next.delete(key); return next; })());
  return <div style={formStyles.backdrop}>
    <form id="tax-filing-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="filing-title" className="tax-filing" style={{ ...formStyles.modal, maxWidth: modalSizes.xxl }} onSubmit={save} onKeyDown={keyDown}>
      <header className="tf-header" style={formStyles.header}><div><h2 id="filing-title" style={formStyles.title}>{readOnly ? "View Invoice" : "Tax filing rows"} {data ? `· Invoice ${data.bill.invoiceNumber}` : ""}</h2>{!readOnly && <p>{perLine ? "Classify each original bill line." : "Combine selected groups or classify each separately."} Original bill quantities, prices and amounts stay unchanged.</p>}</div><button ref={closeRef} type="button" aria-label="Close" style={formStyles.closeButton} onClick={close} disabled={saving}>&times;</button></header>
      <div className="tf-body" style={formStyles.body}>
        {error && <div ref={errorRef} tabIndex={-1} role="alert" className="tf-error">{error}</div>}
        {!data && !error && <p role="status">Loading the bill and filing rows…</p>}
        {data && readOnly && <InvoiceDocumentView bill={data.bill} rows={rows} requiresReview={data.requiresReview} />}
        {data && !readOnly && <>
          <div className="tf-document-context"><span>Company</span><strong>{data.bill.companyName || "Selected company"}</strong><span>Invoice #{data.bill.invoiceNumber}</span></div>
          {perLine && !canSelect ? <p className="tf-grouping-help">This is your original bill line. Add its HS code, and the quantity if FBR needs a different one. The bill and invoice print the line as billed.</p> : perLine ? <p className="tf-grouping-help">Each row is one of your original bill lines. Add its HS code and, when FBR needs different figures, its filing quantity and unit. Every line is filed and printed as its own row.</p> : <p className="tf-grouping-help">1. Select the rows to group. 2. Combine selected. 3. Choose an HS classification and filing unit for each group.</p>}
          <p role="status">{data.bill.items.length} bill {perLine && data.bill.items.length === 1 ? "line" : "lines"} → <strong>{rows.length} FBR filing {rows.length === 1 ? "row" : "rows"}</strong>.{!perLine && " Bill item types suggest the starting groups; unclassified lines remain separate."}</p>
          <div className="tf-summary" aria-live="polite"><div>Bill subtotal<strong>Rs. {money(data.bill.subtotal)}</strong></div><div>Filing total<strong>Rs. {money(total / 100)}</strong></div><div className={difference ? "tf-mismatch" : "tf-match"}>{difference === 0 ? "Matched" : difference > 0 ? "Amount remaining" : "Amount over bill"}<strong>Rs. {money(Math.abs(difference) / 100)}</strong></div></div>
          {data.requiresReview && <div className="tf-warning">The original bill changed after its last review. Check all current source lines and amounts before saving. Rebuild rows if lines were added or removed.</div>}
          {!editable && !readOnly && <p className="tf-warning">Editing requires invoice classification permission and an invoice that has not started submission.</p>}
          {editable && !canAdjustNumbers && <p>You can update HS classifications{canCombine && " and combine rows with the same unit"}. Quantity and amount changes require consultant quantity permission.</p>}
          {editable && (canSelect || canAdjustNumbers) && <div className="tf-toolbar">{canSelect && <button type="button" disabled={saving || selected.length === rows.length} onClick={() => setSelected(rows.map((_, i) => i))}>Select all {perLine ? "lines" : "rows"}</button>}{canAdjustNumbers && <button type="button" disabled={saving} onClick={rebuild}>Rebuild from current bill</button>}{canSelect && <span>Tick {perLine ? "lines" : "rows"} to give them one HS code{canCombine && " or combine them"}. The actions stay pinned at the bottom while you scroll.</span>}</div>}
          <div className="tf-rows">{rows.map((row, index) => {
            const sources = data.bill.items.filter(i => row.sourceLineIds.includes(i.id));
            const canSeparate = canAdjustNumbers || (Math.abs(Number(row.quantity) - sources.reduce((s, i) => s + Number(i.adjustment?.adjustedQuantity ?? i.quantity), 0)) < 1e-9
              && amount(row.valueExclTax) === sources.reduce((s, i) => s + amount(i.adjustment?.adjustedLineTotal ?? i.lineTotal), 0));
            return <section key={row.sourceLineIds.join("-")} className="tf-row" aria-label={`Filing row ${index + 1}`}>
              <div className="tf-row-head"><label className="tf-select">{editable && canSelect && <input type="checkbox" aria-label={`Select filing row ${index + 1}`} checked={selected.includes(index)} disabled={saving} onChange={e => setSelected(e.target.checked ? [...selected, index] : selected.filter(i => i !== index))} />}<b>{perLine && row.sourceLineIds.length === 1 ? `Bill line ${index + 1}` : `Filing row ${index + 1}`}</b><span>{row.sourceLineIds.length} original {row.sourceLineIds.length === 1 ? "line" : "lines"}</span></label>{editable && canSeparate && row.sourceLineIds.length > 1 && <button type="button" disabled={saving} onClick={() => separate(index)}>Separate source lines</button>}</div>
              {perLine && sources.length === 1 ? <p className="tf-bill-line"><strong>{sources[0].description || sources[0].itemTypeName}</strong><span>Original bill line: {sources[0].quantity} {sources[0].uom}{sources[0].unitPrice != null ? ` × Rs. ${money(sources[0].unitPrice)}` : ""} = Rs. {money(sources[0].lineTotal)}</span></p> : <p className="tf-source-preview"><strong>{row.description || "Unclassified supply"}</strong>{sources.length > 1 && <span>{sources.slice(0, 3).map(s => s.description || s.itemTypeName).join(" · ")}{sources.length > 3 ? ` · +${sources.length - 3} more` : ""}</span>}</p>}
              <div className="tf-fields"><div role="group" aria-label={`Row ${index + 1} HS classification`}>{editable && !saving ? <FilingClassificationFields row={row} index={index} companyId={data.bill.companyId} types={types} canAdjustNumbers={canAdjustNumbers} onBusyChange={reportBusy(row.sourceLineIds.join("-"))} onChange={next => changeRows(rows.map((r, i) => i === index ? next : r))} /> : <><p>{row.description || "Unclassified"}</p><small>{row.hsCode || "HS code required"} · {row.uom || "Unit required"}</small></>}</div>
                <label>Filing quantity<input aria-label={`Row ${index + 1} filing quantity`} type="number" min="0.0001" step="0.0001" value={row.quantity} disabled={!editable || !canAdjustNumbers || saving} onChange={e => change(index, "quantity", e.target.value)} /><small>{perLine && sources.length === 1 ? `Bill quantity: ${sources[0].quantity} ${sources[0].uom}. Change it only if FBR needs another figure.` : "Quantity in the selected filing unit"}</small></label>
                {perLine && sources.length === 1 ? <div><small>Amount excluding tax</small><strong>Rs. {money(row.valueExclTax)}</strong><small>Stays as billed</small></div> : <label>Amount excluding tax (Rs.)<input aria-label={`Row ${index + 1} amount excluding tax`} type="number" min="0.01" step="0.01" value={row.valueExclTax} disabled={!editable || !canAdjustNumbers || saving} onChange={e => change(index, "valueExclTax", e.target.value)} /><small>Derived rate: Rs. {money(Number(row.quantity) > 0 ? Number(row.valueExclTax) / Number(row.quantity) : 0)}</small></label>}
              </div>
              <details><summary>View original bill lines</summary><ul>{sources.map(s => <li key={s.id}><span>{s.description || s.itemTypeName}</span><span>{s.quantity} {s.uom} · Rs. {money(s.lineTotal)}</span></li>)}</ul>{sources.length !== row.sourceLineIds.length && <p className="tf-warning">A source line was removed. Rebuild from the current bill.</p>}</details>
            </section>;
          })}</div>
          {/* Pinned to the bottom of the scrolling body: tick rows anywhere in a long bill, then classify them without scrolling back up. */}
          {editable && canSelect && selected.length > 0 && <section className="tf-bulk tf-selection-bar" aria-label="Same HS code for several lines">
            <h3>{selected.length} {perLine ? "line" : "row"}{selected.length === 1 ? "" : "s"} selected</h3>
            <FilingClassificationFields row={bulk} label="Selected lines" companyId={data.bill.companyId} types={types} canAdjustNumbers={canAdjustNumbers} onChange={setBulk} />
            <div className="tf-selection-actions">
              <button type="button" className="tf-apply" disabled={saving || !bulkReady} onClick={applyBulk}>Apply to ticked {perLine ? "lines" : "rows"} ({selected.length})</button>
              {canCombine && <button type="button" disabled={saving || selected.length < 2} onClick={combine}>Combine selected ({selected.length})</button>}
              <button type="button" disabled={saving} onClick={() => setSelected([])}>Clear selection</button>
            </div>
          </section>}
          {!types.some(t => t.hsCode && t.saleType) && editable && <p className="tf-warning">This company has no saved filing classifications yet. Search FBR HS codes above and enter an item name to save a new company classification with this review.</p>}
        </>}
      </div>
      <footer className="tf-footer" style={formStyles.footer}><span aria-live="polite">{!readOnly && <>{data && <b>{difference === 0 ? "Total matched" : `Rs. ${money(Math.abs(difference) / 100)} ${difference > 0 ? "remaining" : "over the bill"}`} · </b>}GST and further tax remain the bill's recorded taxes.</>}</span><button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={close} disabled={saving}>{readOnly ? "Close" : "Cancel"}</button>{editable && <button type="submit" style={{ ...formStyles.button, ...formStyles.submit }} disabled={saving || difference !== 0 || unitPending}>{saving ? "Saving…" : unitPending ? "Loading FBR unit…" : "Save filing rows & complete review"}</button>}</footer>
    </form>
  </div>;
}
