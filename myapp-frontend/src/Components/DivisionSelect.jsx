import { useState, useEffect } from "react";
import { getDivisionsByCompany } from "../api/divisionApi";

/**
 * Generic, reusable Division dropdown — shared by every screen that filters or
 * tags documents by division (Sales Quotes today; Orders, Challans, Invoices
 * next). Loads the company's divisions and, by default, renders nothing when
 * the company has none — so single-division tenants never see clutter.
 *
 * Props:
 *  - companyId       which company's divisions to load (refetches on change)
 *  - value           selected division id (number | string | "") — "" = All / none
 *  - onChange(value) called with the raw string value ("" when All / none picked)
 *  - mode            "filter" (default; first option = allLabel) | "select" (first = noneLabel)
 *  - label           optional label rendered above the <select> (form use)
 *  - className/style  applied to the <select>
 *  - wrapStyle/labelStyle  applied to the wrapper div / label when `label` is set
 *  - allLabel/noneLabel    first-option text per mode
 *  - hideWhenEmpty   default true — render nothing when the company has 0 divisions
 *  - onLoaded(list)  optional callback with the loaded divisions
 */
export default function DivisionSelect({
  companyId, value, onChange, mode = "filter", label,
  className, style, wrapStyle, labelStyle,
  allLabel = "All Divisions", noneLabel = "— No division —",
  hideWhenEmpty = true, onLoaded,
}) {
  const [divisions, setDivisions] = useState([]);

  useEffect(() => {
    if (!companyId) { setDivisions([]); return; }
    let cancelled = false;
    getDivisionsByCompany(companyId)
      .then(({ data }) => { if (!cancelled) { setDivisions(data || []); onLoaded?.(data || []); } })
      .catch(() => { if (!cancelled) setDivisions([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  if (hideWhenEmpty && divisions.length === 0) return null;

  const select = (
    <select className={className} style={style} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{mode === "filter" ? allLabel : noneLabel}</option>
      {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  );

  if (!label) return select;
  return (
    <div style={wrapStyle}>
      <label style={labelStyle}>{label}</label>
      {select}
    </div>
  );
}
