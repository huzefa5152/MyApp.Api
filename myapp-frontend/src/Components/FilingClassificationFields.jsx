import { useEffect, useRef, useState } from "react";
import { getItemTypeFbrHints } from "../api/itemTypeApi";
import HsCodeAutocomplete from "./HsCodeAutocomplete";

export default function FilingClassificationFields({ row, index, companyId, types, onChange, canAdjustNumbers, label, onBusyChange }) {
  const [hints, setHints] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const latest = useRef({ row, onChange });
  latest.current = { row, onChange, onBusyChange };
  // Lets the editor hold its Save button while FBR's unit for this code is still being fetched.
  useEffect(() => { latest.current.onBusyChange?.(loading); }, [loading]);
  useEffect(() => () => latest.current.onBusyChange?.(false), []);
  useEffect(() => {
    let active = true;
    setHints(null); setError(""); setLoading(false);
    if (!/^\d{4}\.\d{4}(\.\d{2})?$/.test(row.hsCode || "")) return;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await getItemTypeFbrHints(companyId, row.hsCode);
        if (!active) return;
        setHints(data);
        const current = latest.current.row;
        const units = data.uoms || [];
        const unit = units.find(u => u.uoM_ID === current.fbrUOMId)
          || units.find(u => u.description?.toLowerCase() === current.uom?.toLowerCase())
          || (units.length === 1 ? units[0] : null);
        const next = { ...current,
          ...(unit ? { uom: unit.description, fbrUOMId: unit.uoM_ID, selectedFbrUOMId: unit.uoM_ID } : {}),
          saleType: current.saleType || data.defaultSaleType || "",
          selectedSaleType: current.selectedSaleType || (!current.saleType ? data.defaultSaleType : null) };
        if (next.uom !== current.uom || next.fbrUOMId !== current.fbrUOMId || next.saleType !== current.saleType)
          latest.current.onChange(next);
      } catch (e) {
        if (active) setError(e.response?.data?.message || "Could not load FBR units. Retry the lookup before saving.");
      } finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [companyId, row.hsCode, row.itemTypeId, retry]);
  const pickType = (type) => onChange({ ...row, itemTypeId: type?.id || null,
    hsCode: type?.hsCode || "", saleType: type?.saleType || "", uom: type?.uom || "",
    quantity: canAdjustNumbers && row.uom && type?.uom !== row.uom ? "" : row.quantity,
    fbrUOMId: type?.fbrUOMId || null, selectedFbrUOMId: null, selectedSaleType: null, description: type?.name || "" });
  const changeCode = (code, description = "") => {
    const existing = types.find(t => t.hsCode?.trim() === code.trim() && !t.isHsCodePartial && t.saleType && t.uom);
    if (existing) return pickType(existing);
    onChange({ ...row, itemTypeId: null, hsCode: code, description, uom: "", fbrUOMId: null,
      selectedFbrUOMId: null, saleType: "", selectedSaleType: null });
  };
  const saleTypes = [...(hints?.saleTypes || []), hints?.defaultSaleType, row.saleType].filter(Boolean)
    .filter((s, i, all) => all.findIndex(value => value.toLowerCase() === s.toLowerCase()) === i);
  const prefix = label || `Row ${index + 1}`;
  const completeCode = /^\d{4}\.\d{4}(\.\d{2})?$/.test(row.hsCode || "");
  return <div>
    <label>HS code or company item</label>
    <HsCodeAutocomplete companyId={companyId} value={row.hsCode || ""} onChange={changeCode}
      onSelect={option => option.companyItem ? pickType(option.companyItem) : changeCode(option.hS_CODE, option.description || "")}
      companyItems={types} showCompanyStatus placeholder="Search all FBR codes or company item names"
      ariaLabel={`${prefix} FBR HS code`} />
    {row.itemTypeId && <small>Using company item: {types.find(t => t.id === row.itemTypeId)?.name || row.description}. Unit and sale type below apply to this filing.</small>}
    {!row.itemTypeId && completeCode && <>
      <label style={{ marginTop: 12 }}>New item name
        <input aria-label={`${prefix} new item name`} maxLength={500} value={row.description || ""}
          onChange={e => onChange({ ...row, description: e.target.value })} />
      </label>
      <small>Saving adds this classification to this company. You can edit the suggested item name.</small>
    </>}
    {completeCode && <>
      {loading && <small role="status">Loading FBR units and sale types…</small>}
      {error && <small role="alert" className="tf-field-error">{error}</small>}
      {hints && !hints.uoms?.length && <small className="tf-field-error">FBR units are unavailable. Check this company's FBR connection and retry.</small>}
      {(error || (hints && !hints.uoms?.length)) && <button type="button" onClick={() => setRetry(n => n + 1)}>Retry FBR units</button>}
      {!!hints?.uoms?.length && <label style={{ marginTop: 12 }}>Filing unit
        <select aria-label={`${prefix} filing unit`} value={row.fbrUOMId || ""} onChange={e => {
          const unit = hints.uoms.find(u => String(u.uoM_ID) === e.target.value);
          onChange({ ...row, uom: unit?.description || "", fbrUOMId: unit?.uoM_ID || null,
            selectedFbrUOMId: unit?.uoM_ID || null,
            quantity: canAdjustNumbers && row.uom && unit?.description !== row.uom ? "" : row.quantity });
        }}><option value="">Choose the unit to file with FBR</option>{hints.uoms.map(u => <option key={u.uoM_ID} value={u.uoM_ID}>{u.description}</option>)}</select>
        <small>{hints.uoms.length === 1 ? "FBR's only unit is selected automatically." : "Choose the FBR unit for this supply and enter its filing quantity."}</small>
      </label>}
      {!!saleTypes.length && <label style={{ marginTop: 12 }}>Sale type
        <select aria-label={`${prefix} sale type`} value={saleTypes.find(s => s.toLowerCase() === row.saleType?.toLowerCase()) || ""} onChange={e => onChange({ ...row, saleType: e.target.value, selectedSaleType: e.target.value })}>
          <option value="">Choose FBR sale type</option>{saleTypes.map(s => <option key={s} value={s}>{s}</option>)}
        </select><small>FBR's suggestion is preselected. Choose the treatment that applies; the bill's recorded taxes must still match.</small>
      </label>}
    </>}
    <small className={!row.hsCode || !row.uom ? "tf-field-error" : ""}>{row.hsCode || "HS code required"} · {row.uom || "Unit required"}</small>
  </div>;
}
