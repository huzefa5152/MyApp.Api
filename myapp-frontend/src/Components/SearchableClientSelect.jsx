import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { MdArrowDropDown, MdSearch } from "react-icons/md";

/**
 * Standard searchable client/party picker — the app-wide replacement for a
 * plain <select> of clients. Inline search (name / NTN / phone / city),
 * keyboard nav, and a portaled dropdown so it escapes overflow:auto / modal
 * containers. Works for suppliers too (any {id, name, ntn?, phone?, city?}).
 *
 * Props:
 *   clients      array of { id, name, ntn?, strn?, phone?, city?, registrationType? }
 *   value        selected id (string/number) or "" for none
 *   onChange     (newId, pickedClient|null) => void   (newId is "" when cleared)
 *   placeholder  trigger text when nothing is selected (e.g. "All clients")
 *   allowClear   show the × clear affordance (default true)
 *   disabled     dim + block interaction
 *   style        passthrough for the trigger button
 */
export default function SearchableClientSelect({
  clients, value, onChange, placeholder = "Select client…", allowClear = true, disabled = false, style,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [triggerRect, setTriggerRect] = useState(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const wrapperRef = useRef(null);

  const list = clients || [];
  const selected = useMemo(
    () => list.find((c) => String(c.id) === String(value)),
    [list, value]
  );

  const filtered = useMemo(() => {
    const sorted = [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const term = query.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter((c) =>
      (c.name || "").toLowerCase().includes(term) ||
      (c.ntn || "").toLowerCase().includes(term) ||
      (c.strn || "").toLowerCase().includes(term) ||
      (c.phone || "").toLowerCase().includes(term) ||
      (c.city || "").toLowerCase().includes(term)
    );
  }, [list, query]);

  useEffect(() => {
    const onMouseDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target) &&
          triggerRef.current && !triggerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightIdx(-1);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const recompute = () => { if (triggerRef.current) setTriggerRect(triggerRef.current.getBoundingClientRect()); };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open]);

  const handlePick = (c) => { onChange?.(c ? c.id : "", c || null); setOpen(false); };
  const handleClear = (e) => { e.stopPropagation(); onChange?.("", null); };

  const handleKeyDown = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (highlightIdx >= 0 && highlightIdx < filtered.length) handlePick(filtered[highlightIdx]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  const meta = (c) => [c.ntn, c.phone, c.city].filter(Boolean).join(" · ");

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{ ...styles.trigger, ...(disabled ? styles.disabled : null), ...style }}
      >
        <span style={styles.triggerLabel}>
          {selected ? selected.name : <span style={styles.placeholder}>{placeholder}</span>}
        </span>
        {selected && allowClear && !disabled && (
          <span onClick={handleClear} style={styles.clearBtn} title="Clear selection">×</span>
        )}
        <MdArrowDropDown size={18} style={{ flexShrink: 0 }} />
      </button>

      {open && triggerRect && createPortal(
        <div ref={wrapperRef} style={styles.dropdown(triggerRect)} onKeyDown={handleKeyDown}>
          <div style={styles.searchRow}>
            <MdSearch size={16} style={styles.searchIcon} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search name, NTN, phone…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0); }}
              onKeyDown={handleKeyDown}
              style={styles.searchInput}
            />
          </div>
          <div style={styles.listBox}>
            {allowClear && (
              <div
                onMouseDown={() => handlePick(null)}
                onMouseEnter={() => setHighlightIdx(-1)}
                style={{ ...styles.row, color: "#5f6d7e", fontStyle: "italic" }}
              >
                {placeholder}
              </div>
            )}
            {filtered.length === 0 && (
              <div style={styles.empty}>
                {list.length === 0 ? "No clients yet." : `No match for "${query}".`}
              </div>
            )}
            {filtered.map((c, idx) => (
              <div
                key={c.id}
                onMouseDown={() => handlePick(c)}
                onMouseEnter={() => setHighlightIdx(idx)}
                style={{ ...styles.row, backgroundColor: idx === highlightIdx ? "#e3f2fd" : "transparent" }}
              >
                <div style={styles.rowName}>{c.name}</div>
                {meta(c) && <div style={styles.rowMeta}>{meta(c)}</div>}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const styles = {
  trigger: {
    display: "flex", alignItems: "center", gap: "0.25rem", width: "100%",
    padding: "0.55rem 0.7rem", border: "1px solid #d0d7e2", borderRadius: 8,
    backgroundColor: "#f8f9fb", fontSize: "0.9rem", color: "#1a2332",
    cursor: "pointer", textAlign: "left", minHeight: 44, boxShadow: "none",
  },
  disabled: { opacity: 0.6, cursor: "not-allowed" },
  triggerLabel: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" },
  placeholder: { color: "#94a3b8" },
  clearBtn: { fontSize: "1.1rem", color: "#94a3b8", padding: "0 0.3rem", cursor: "pointer", lineHeight: 1 },
  dropdown: (rect) => {
    const spaceBelow = window.innerHeight - rect.bottom;
    const listHeight = 360;
    const flipAbove = spaceBelow < 220 && rect.top > spaceBelow;
    return {
      position: "fixed",
      top: flipAbove ? undefined : rect.bottom + 2,
      bottom: flipAbove ? window.innerHeight - rect.top + 2 : undefined,
      left: rect.left,
      width: Math.max(rect.width, 260),
      maxHeight: flipAbove ? Math.min(listHeight, rect.top - 10) : Math.min(listHeight, spaceBelow - 10),
      backgroundColor: "#fff", border: "1px solid #d0d7e2", borderRadius: 8,
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 9999,
      display: "flex", flexDirection: "column",
    };
  },
  searchRow: { display: "flex", alignItems: "center", padding: "0.45rem 0.65rem", borderBottom: "1px solid #e8edf3", position: "relative" },
  searchIcon: { position: "absolute", left: 12, color: "#94a3b8" },
  searchInput: {
    width: "100%", padding: "0.4rem 0.4rem 0.4rem 1.85rem", border: "1px solid #e8edf3",
    borderRadius: 6, fontSize: "0.85rem", outline: "none", backgroundColor: "#f8f9fb", boxSizing: "border-box",
  },
  listBox: { overflowY: "auto", flex: 1 },
  row: { padding: "0.5rem 0.7rem", cursor: "pointer", borderBottom: "1px solid #f0f4f8" },
  rowName: { fontWeight: 600, fontSize: "0.85rem", color: "#1a2332", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rowMeta: { marginTop: 2, fontSize: "0.72rem", color: "#5f6d7e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  empty: { padding: "0.8rem", color: "#5f6d7e", fontSize: "0.85rem" },
};
