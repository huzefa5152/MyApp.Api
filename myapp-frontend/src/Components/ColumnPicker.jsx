import { useEffect, useRef, useState } from "react";
import { MdViewColumn } from "react-icons/md";
import { useUiPreference } from "../hooks/useUiPreference";

// Show / hide the columns of a hand-built table, remembered per screen and
// per viewer (localStorage). DataTable has the same menu built in; this is for
// the pages that render their own <table>.
//
//   const cols = [{ key: "gd", label: "GD No" }, { key: "onhand", label: "On-Hand", defaultHidden: true }];
//   const [isVisible, picker] = useColumnVisibility("stock:onhand", cols);
//   {isVisible("gd") && <th>GD No</th>}
//   ...{picker}
//
// Only the HIDDEN keys are stored, so a column added later shows up for
// everyone instead of staying hidden behind an old saved list.
export function useColumnVisibility(storageKey, columns) {
  const defaults = JSON.stringify(columns.filter((c) => c.defaultHidden).map((c) => c.key));
  const [raw, setRaw] = useUiPreference(`columns.hidden:${storageKey}`, defaults);

  let hidden;
  try { hidden = new Set(JSON.parse(raw || "[]")); } catch { hidden = new Set(); }

  const toggle = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setRaw(JSON.stringify([...next]));
  };
  const isVisible = (key) => !hidden.has(key);

  const picker = (
    <ColumnPicker
      columns={columns}
      isVisible={isVisible}
      onToggle={toggle}
      onReset={() => setRaw(defaults)}
    />
  );
  return [isVisible, picker];
}

export default function ColumnPicker({ columns, isVisible, onToggle, onReset }) {
  const [open, setOpen] = useState(false);
  // Open towards whichever side has room, so the menu never runs off a phone.
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const shown = columns.filter((c) => isVisible(c.key)).length;

  return (
    <div ref={ref} style={styles.wrap}>
      <button
        type="button"
        style={styles.button}
        onClick={() => {
          const box = ref.current?.getBoundingClientRect();
          setAlignRight(!!box && box.left + 280 > window.innerWidth);
          setOpen((v) => !v);
        }}
        aria-haspopup="true"
        aria-expanded={open}
        title="Show or hide columns"
      >
        <MdViewColumn size={18} /> Columns ({shown}/{columns.length})
      </button>
      {open && (
        <div style={{ ...styles.menu, ...(alignRight ? { right: 0 } : { left: 0 }) }} role="menu">
          {columns.map((c) => (
            <label key={c.key} style={styles.item}>
              <input
                type="checkbox"
                checked={isVisible(c.key)}
                onChange={() => onToggle(c.key)}
                style={{ width: 18, height: 18 }}
              />
              {c.label}
            </label>
          ))}
          <button type="button" style={styles.reset} onClick={onReset}>Reset to default</button>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { position: "relative", display: "inline-block" },
  button: {
    display: "inline-flex", alignItems: "center", gap: "0.35rem", minHeight: 44,
    padding: "0.45rem 0.85rem", borderRadius: 8, border: "1px solid #d0d7e2",
    backgroundColor: "#fff", color: "#0d47a1", fontSize: "0.85rem", fontWeight: 600,
    cursor: "pointer", boxShadow: "none",
  },
  menu: {
    position: "absolute", top: "calc(100% + 4px)", zIndex: 30,
    minWidth: 220, maxWidth: "min(280px, calc(100vw - 32px))", maxHeight: 360, overflowY: "auto",
    backgroundColor: "#fff", border: "1px solid #e8edf3", borderRadius: 10,
    boxShadow: "0 8px 24px rgba(15,23,42,0.14)", padding: "0.4rem",
  },
  item: {
    display: "flex", alignItems: "center", gap: "0.55rem", minHeight: 40,
    padding: "0.3rem 0.5rem", borderRadius: 6, fontSize: "0.85rem", color: "#1a2332",
    cursor: "pointer",
  },
  reset: {
    width: "100%", marginTop: "0.3rem", minHeight: 40, padding: "0.35rem 0.5rem",
    borderRadius: 6, border: "1px solid #d0d7e2", backgroundColor: "#f8f9fb",
    color: "#5f6d7e", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", boxShadow: "none",
  },
};
