import { useMemo, useState } from "react";
import ComboBox from "./ComboBox";

/**
 * Generic single-select combobox with inline search — the common dropdown used
 * across the app for any id/name list. Rendering, keyboard and positioning live
 * in ComboBox so every picker in the app looks and behaves the same.
 *
 * Props:
 *   items        — array of option objects
 *   value        — selected option's id (string | number) or "" / null for none
 *   onChange(id, item) — id is "" when cleared; item is the picked option or null
 *   valueKey     — option id field (default "id")
 *   labelKey     — option label field (default "name")
 *   searchKeys   — option fields to match against the query (default [labelKey])
 *   subLabel(item) — optional muted second line in the list (e.g. NTN · city)
 *   placeholder, style (layout only), disabled, loading, allowClear (default true)
 *   renderExpand(item) — optional expandable body under a row (toggling does NOT select)
 */
export default function SearchableSelect({
  items,
  value,
  onChange,
  valueKey = "id",
  labelKey = "name",
  searchKeys,
  subLabel,
  placeholder = "Select…",
  style,
  disabled = false,
  loading = false,
  allowClear = true,
  renderExpand,
  ariaLabel,
}) {
  const [query, setQuery] = useState("");
  const keys = useMemo(() => (searchKeys && searchKeys.length ? searchKeys : [labelKey]), [searchKeys, labelKey]);
  const selected = useMemo(() => (items || []).find((it) => String(it[valueKey]) === String(value)), [items, value, valueKey]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const arr = items || [];
    return term ? arr.filter((it) => keys.some((k) => String(it[k] ?? "").toLowerCase().includes(term))) : arr;
  }, [items, query, keys]);

  return (
    <ComboBox
      sections={[{ key: "all", options: filtered }]}
      query={query}
      onQuery={setQuery}
      getKey={(it) => it[valueKey]}
      isCurrent={(it) => Boolean(selected) && String(it[valueKey]) === String(selected[valueKey])}
      renderOption={(it) => (
        <>
          {it[labelKey]}
          {subLabel && subLabel(it) ? <span className="k-combo__opt-sub">{subLabel(it)}</span> : null}
        </>
      )}
      renderExpand={renderExpand}
      onPick={(it) => onChange?.(it ? it[valueKey] : "", it || null)}
      triggerContent={selected ? selected[labelKey] : <span className="k-combo__placeholder">{placeholder}</span>}
      triggerTitle={selected ? String(selected[labelKey] ?? "") : undefined}
      onClear={allowClear && selected && !disabled ? () => onChange?.("", null) : undefined}
      disabled={disabled}
      loading={loading}
      style={style}
      emptyText={(items || []).length === 0 ? "No options." : `No match for "${query}".`}
      ariaLabel={ariaLabel || placeholder}
    />
  );
}
