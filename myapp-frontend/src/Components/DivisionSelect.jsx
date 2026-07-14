import { useState, useEffect } from "react";
import { getDivisionsByCompany } from "../api/divisionApi";
import { usePermissions } from "../contexts/PermissionsContext";

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
  const { isDivisionRestricted } = usePermissions();

  // Division-restricted users can't save company-level (null) documents —
  // policy D2 — so form mode drops the none option. Filter mode keeps "All"
  // (it means "all I can see"; the backend scopes the query).
  const restricted = mode === "select" && isDivisionRestricted(companyId);
  const isEmpty = value === "" || value == null;

  useEffect(() => {
    if (!companyId) { setDivisions([]); return; }
    let cancelled = false;
    getDivisionsByCompany(companyId)
      .then(({ data }) => {
        if (cancelled) return;
        const list = data || [];
        setDivisions(list);
        onLoaded?.(list);
        // Prune a stale selection that belongs to a DIFFERENT company (e.g. the
        // operator switched companies while a division was picked). Left as-is,
        // the id would scope list filters / print templates to a division that
        // doesn't exist here — silently blanking the list or blocking printing.
        // Reset to "" (All / none) so the parent falls back to the safe default.
        if (value && !list.some((d) => String(d.id) === String(value))) onChange("");
      })
      .catch(() => { if (!cancelled) setDivisions([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // Restricted + exactly one allowed division: pick it for the user.
  useEffect(() => {
    if (restricted && isEmpty && divisions.length === 1) onChange(String(divisions[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restricted, isEmpty, divisions]);

  if (hideWhenEmpty && divisions.length === 0) return null;

  const select = (
    <select className={className} style={style} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {restricted
        ? isEmpty && <option value="" disabled>Select division…</option>
        : <option value="">{mode === "filter" ? allLabel : noneLabel}</option>}
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
