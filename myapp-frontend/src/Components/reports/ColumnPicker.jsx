import { useEffect, useMemo, useRef, useState } from "react";
import { MdViewColumn, MdCheck } from "react-icons/md";
import { useUiPreference } from "../../hooks/useUiPreference";

/**
 * Which columns of a report this user wants to see, remembered per report.
 *
 * Stores the HIDDEN keys, not the shown ones, so a column a later release adds
 * appears by default instead of silently staying hidden. A report always keeps
 * at least one column.
 */
export function useHiddenColumns(storageKey) {
  const [raw, setRaw] = useUiPreference(`report-columns:${storageKey}`, "[]");
  const hidden = useMemo(() => {
    try {
      const list = JSON.parse(raw || "[]");
      return new Set(Array.isArray(list) ? list.map(String) : []);
    } catch { return new Set(); }
  }, [raw]);
  const setHidden = (next) => setRaw(next.size ? JSON.stringify([...next]) : null);
  return [hidden, setHidden];
}

/** columns: [{ key, label }]. onReset (optional) restores the screen's own default set. */
export default function ColumnPicker({ columns, hidden, onChange, onReset, note }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const shown = columns.filter((c) => !hidden.has(String(c.key))).length;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (columns.length < 2) return null;

  const toggle = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else if (shown > 1) next.add(key);
    onChange(next);
  };

  return (
    <div className="rw-colpick" ref={wrap}>
      <button
        type="button"
        className="rw-btn"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        title="Choose which columns to show"
      >
        <MdViewColumn size={17} />
        <span>Columns</span>
        {shown < columns.length && <span className="rw-colpick__count">{shown}/{columns.length}</span>}
      </button>
      {open && (
        <div className="rw-colpick__panel" role="group" aria-label="Columns to show">
          <div className="rw-colpick__head">
            <strong>Show columns</strong>
            <span style={{ display: "flex", gap: 12 }}>
              {onReset && <button type="button" className="rw-colpick__link" onClick={onReset}>Reset</button>}
              <button type="button" className="rw-colpick__link" onClick={() => onChange(new Set())} disabled={shown === columns.length}>
                Show all
              </button>
            </span>
          </div>
          <div className="rw-colpick__list">
            {columns.map((c) => {
              const key = String(c.key);
              const on = !hidden.has(key);
              const last = on && shown === 1;
              return (
                <label key={key} className={`rw-colpick__item${on ? " is-on" : ""}${last ? " is-locked" : ""}`} title={last ? "At least one column stays visible" : undefined}>
                  <input type="checkbox" checked={on} disabled={last} onChange={() => toggle(key)} />
                  <span className="rw-colpick__box" aria-hidden="true">{on && <MdCheck size={13} />}</span>
                  <span className="rw-colpick__label">{c.label || key}</span>
                </label>
              );
            })}
          </div>
          <p className="rw-colpick__note">{note || "Hidden columns are left out of Print, PDF and Excel too."}</p>
        </div>
      )}
    </div>
  );
}
