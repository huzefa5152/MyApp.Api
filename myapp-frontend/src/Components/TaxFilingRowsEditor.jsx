import { useEffect, useRef, useState } from "react";
import { getTaxFiling, saveTaxFiling } from "../api/invoiceApi";
import { getItemTypes } from "../api/itemTypeApi";
import { usePermissions } from "../contexts/PermissionsContext";
import { formStyles, modalSizes } from "../theme";
import { useConfirm } from "./ConfirmDialog";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";
import { amount, money, mergeFilingRows, separateFilingRow, filingErrors } from "../utils/taxFilingRows";
import "./TaxFilingRowsEditor.css";

export default function TaxFilingRowsEditor({ invoiceId, onClose, onSaved, readOnly = false }) {
  const { has } = usePermissions();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [types, setTypes] = useState([]);
  const [selected, setSelected] = useState([]);
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
        const { data: catalog } = await getItemTypes(next.bill.companyId);
        if (active) { setData(next); setRows(next.rows); setTypes(catalog || []); }
      } catch (e) { if (active) setError(e.response?.data?.message || "Could not load filing rows. Close and try again."); }
    }
    load();
    closeRef.current?.focus();
    return () => { active = false; };
  }, [invoiceId]);
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
  return <div style={formStyles.backdrop}>
    <form id="tax-filing-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="filing-title" className="tax-filing" style={{ ...formStyles.modal, maxWidth: modalSizes.xxl }} onSubmit={save} onKeyDown={keyDown}>
      <header className="tf-header" style={formStyles.header}><div><h2 id="filing-title" style={formStyles.title}>Tax filing rows {data ? `· Invoice ${data.bill.invoiceNumber}` : ""}</h2><p>Combine selected groups or classify each separately. Original bill quantities, prices and amounts stay unchanged.</p></div><button ref={closeRef} type="button" aria-label="Close" style={formStyles.closeButton} onClick={close} disabled={saving}>&times;</button></header>
      <div className="tf-body" style={formStyles.body}>
        {error && <div ref={errorRef} tabIndex={-1} role="alert" className="tf-error">{error}</div>}
        {!data && !error && <p role="status">Loading the bill and filing rows…</p>}
        {data && <>
          <div className="tf-document-context"><span>Company</span><strong>{data.bill.companyName || "Selected company"}</strong><span>Invoice #{data.bill.invoiceNumber}</span></div>
          <div className="tf-summary" aria-live="polite"><div>Bill subtotal<strong>Rs. {money(data.bill.subtotal)}</strong></div><div>Filing total<strong>Rs. {money(total / 100)}</strong></div><div className={difference ? "tf-mismatch" : "tf-match"}>{difference === 0 ? "Matched" : difference > 0 ? "Amount remaining" : "Amount over bill"}<strong>Rs. {money(Math.abs(difference) / 100)}</strong></div></div>
          {data.requiresReview && <div className="tf-warning">The original bill changed after its last review. Check all current source lines and amounts before saving. Rebuild rows if lines were added or removed.</div>}
          {!editable && !readOnly && <p className="tf-warning">Editing requires invoice classification permission and an invoice that has not started submission.</p>}
          {editable && !canAdjustNumbers && <p>You can update HS classifications and combine rows with the same unit. Quantity and amount changes require consultant quantity permission.</p>}
          {editable && <div className="tf-toolbar"><button type="button" disabled={saving || selected.length < 2} onClick={combine}>Combine selected ({selected.length})</button>{canAdjustNumbers && <button type="button" disabled={saving} onClick={rebuild}>Rebuild from current bill</button>}<span>Select any groups to combine. Leave others separate.</span></div>}
          <div className="tf-rows">{rows.map((row, index) => {
            const sources = data.bill.items.filter(i => row.sourceLineIds.includes(i.id));
            const canSeparate = canAdjustNumbers || (Math.abs(Number(row.quantity) - sources.reduce((s, i) => s + Number(i.adjustment?.adjustedQuantity ?? i.quantity), 0)) < 1e-9
              && amount(row.valueExclTax) === sources.reduce((s, i) => s + amount(i.adjustment?.adjustedLineTotal ?? i.lineTotal), 0));
            return <section key={row.sourceLineIds.join("-")} className="tf-row" aria-label={`Filing row ${index + 1}`}>
              <div className="tf-row-head"><label className="tf-select">{editable && <input type="checkbox" checked={selected.includes(index)} disabled={saving} onChange={e => setSelected(e.target.checked ? [...selected, index] : selected.filter(i => i !== index))} />}<b>Filing row {index + 1}</b><span>{row.sourceLineIds.length} original {row.sourceLineIds.length === 1 ? "line" : "lines"}</span></label>{editable && canSeparate && row.sourceLineIds.length > 1 && <button type="button" disabled={saving} onClick={() => separate(index)}>Separate source lines</button>}</div>
              <div className="tf-fields"><div role="group" aria-label={`Row ${index + 1} HS classification`}><label>HS classification</label>{editable && !saving ? <SearchableItemTypeSelect items={types.filter(t => t.hsCode && t.saleType && !t.isHsCodePartial)} value={row.itemTypeId || ""} placeholder="Search item name or HS code" style={{ ...formStyles.input, width: "100%", minHeight: 44 }} onChange={(id, type) => changeRows(rows.map((r, i) => i === index ? { ...r, itemTypeId: Number(id) || null, hsCode: type?.hsCode, saleType: type?.saleType, uom: type?.uom || "", quantity: canAdjustNumbers && r.uom && type?.uom !== r.uom ? "" : r.quantity, fbrUOMId: type?.fbrUOMId, description: type?.name || "" } : r))} /> : <p>{row.description || "Unclassified"}</p>}<small className={!row.hsCode || !row.uom ? "tf-field-error" : ""}>{row.hsCode || "HS code required"} · {row.uom || "Unit required"}</small><small>{row.saleType || "Sale type required"}</small></div>
                <label>Filing quantity<input aria-label={`Row ${index + 1} filing quantity`} type="number" min="0.0001" step="0.0001" value={row.quantity} disabled={!editable || !canAdjustNumbers || saving} onChange={e => change(index, "quantity", e.target.value)} /><small>Quantity in the selected filing unit</small></label>
                <label>Amount excluding tax (Rs.)<input aria-label={`Row ${index + 1} amount excluding tax`} type="number" min="0.01" step="0.01" value={row.valueExclTax} disabled={!editable || !canAdjustNumbers || saving} onChange={e => change(index, "valueExclTax", e.target.value)} /><small>Derived rate: Rs. {money(Number(row.quantity) > 0 ? Number(row.valueExclTax) / Number(row.quantity) : 0)}</small></label>
              </div>
              <details><summary>View original bill lines</summary><ul>{sources.map(s => <li key={s.id}><span>{s.description || s.itemTypeName}</span><span>{s.quantity} {s.uom} · Rs. {money(s.lineTotal)}</span></li>)}</ul>{sources.length !== row.sourceLineIds.length && <p className="tf-warning">A source line was removed. Rebuild from the current bill.</p>}</details>
            </section>;
          })}</div>
          {!types.some(t => t.hsCode && t.saleType) && editable && <p className="tf-warning">This company has no complete filing classifications yet. Add an item with an HS code, unit and sale type in Item Catalog, then reopen this invoice.</p>}
        </>}
      </div>
      <footer className="tf-footer" style={formStyles.footer}><span aria-live="polite">{data && <b>{difference === 0 ? "Total matched" : `Rs. ${money(Math.abs(difference) / 100)} ${difference > 0 ? "remaining" : "over the bill"}`} · </b>}GST and further tax remain the bill's recorded taxes.</span><button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={close} disabled={saving}>{readOnly ? "Done" : "Cancel"}</button>{editable && <button type="submit" style={{ ...formStyles.button, ...formStyles.submit }} disabled={saving || difference !== 0}>{saving ? "Saving…" : "Save filing rows & complete review"}</button>}</footer>
    </form>
  </div>;
}
