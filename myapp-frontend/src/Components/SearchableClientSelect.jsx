import { useMemo, useState } from "react";
import ComboBox from "./ComboBox";

/**
 * Standard searchable client/party picker — the app-wide replacement for a
 * plain <select> of clients OR suppliers (any {id, name, ntn?, strn?, phone?, city?}).
 * Inline search (name / NTN / STRN / phone / city), alphabetical, each row shows
 * NTN · phone · city under the name. Built on ComboBox, so it matches every other picker.
 *
 * Props:
 *   clients      array of { id, name, ntn?, strn?, phone?, city?, registrationType? }
 *   value        selected id (string/number) or "" for none
 *   onChange     (newId, pickedClient|null) => void   (newId is "" when cleared)
 *   placeholder  trigger text when nothing is selected (e.g. "All clients")
 *   allowClear   show the × clear affordance and the "none" row (default true)
 *   disabled     dim + block interaction
 *   style        layout passthrough (width / flex / margin)
 *   noun         "clients" (default) / "suppliers" — used in the empty message
 */
export default function SearchableClientSelect({
  clients, value, onChange, placeholder = "Select client…", allowClear = true, disabled = false, style, noun = "clients", ariaLabel,
}) {
  const [query, setQuery] = useState("");
  const list = useMemo(() => clients || [], [clients]);
  const selected = useMemo(() => list.find((c) => String(c.id) === String(value)), [list, value]);

  const filtered = useMemo(() => {
    const sorted = [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const term = query.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter((c) =>
      ["name", "ntn", "strn", "phone", "city"].some((k) => String(c[k] || "").toLowerCase().includes(term)));
  }, [list, query]);

  const meta = (c) => [c.ntn, c.phone, c.city].filter(Boolean).join(" · ");
  const pick = (c) => onChange?.(c ? c.id : "", c || null);

  return (
    <ComboBox
      sections={[{ key: "all", options: filtered }]}
      query={query}
      onQuery={setQuery}
      getKey={(c) => c.id}
      isCurrent={(c) => Boolean(selected) && String(c.id) === String(selected.id)}
      renderOption={(c) => (
        <>
          <span style={{ fontWeight: 600 }}>{c.name}</span>
          {meta(c) && <span className="k-combo__opt-sub">{meta(c)}</span>}
        </>
      )}
      onPick={pick}
      noneLabel={allowClear ? placeholder : undefined}
      triggerContent={selected ? selected.name : <span className="k-combo__placeholder">{placeholder}</span>}
      triggerTitle={selected?.name}
      onClear={selected && allowClear && !disabled ? () => pick(null) : undefined}
      disabled={disabled}
      style={style}
      minPopWidth={260}
      searchPlaceholder="Search name, NTN, phone…"
      emptyText={list.length === 0 ? `No ${noun} yet.` : `No match for "${query}".`}
      ariaLabel={ariaLabel || placeholder}
    />
  );
}
