import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MdArrowDropDown, MdSearch } from "react-icons/md";
import "../ui/kit.css";

const LAYOUT_KEYS = new Set(["width", "minWidth", "maxWidth", "flex", "flexBasis", "flexGrow", "flexShrink", "margin", "marginTop", "marginBottom", "marginLeft", "marginRight", "alignSelf", "gridColumn"]);

/**
 * The one searchable dropdown engine behind every picker in the app (SearchableSelect,
 * SearchableClientSelect for clients AND suppliers, AccountSelect for GL accounts). One look,
 * one keyboard model, one popover that never clips:
 *   - portaled to <body>, re-anchored on scroll/resize, flips above when there's no room below
 *   - type to filter, ↑/↓ to move, Enter to pick, Esc to close; ↓/Enter/Space on the trigger opens it
 *
 * The wrappers keep their public props unchanged; they only describe how to filter, group and
 * render their options here.
 *
 * Props:
 *   sections      [{ key, label?, tone?: {fg,bg}, options: [] }] — already filtered & ordered
 *   query/onQuery controlled search text (the wrapper filters with it)
 *   getKey(o)     stable key; isCurrent(o) marks the selected option
 *   renderOption(o) option content; renderExpand(o) optional expandable body
 *   onPick(o|null) — null when the "none" row is chosen
 *   noneLabel     when set, a first row that picks null (e.g. "All clients")
 *   triggerContent  what the closed control shows (selected label or placeholder node)
 *   triggerTitle, onClear (shows ×), disabled, loading, style, minPopWidth,
 *   searchPlaceholder, emptyText
 */
export default function ComboBox({
  sections,
  query,
  onQuery,
  getKey,
  isCurrent = () => false,
  renderOption,
  renderExpand,
  onPick,
  noneLabel,
  triggerContent,
  triggerTitle,
  onClear,
  disabled = false,
  loading = false,
  style,
  minPopWidth = 240,
  searchPlaceholder = "Search…",
  emptyText = "No options.",
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [rect, setRect] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const flat = useMemo(() => sections.flatMap((s) => s.options), [sections]);

  useEffect(() => {
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    onQuery("");
    setHi(-1);
    requestAnimationFrame(() => searchRef.current?.focus());
    const recompute = () => { if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect()); };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
    // onQuery is a state setter from the wrapper
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (hi < 0) return;
    listRef.current?.querySelector(`[data-idx="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const close = (refocus) => { setOpen(false); if (refocus) triggerRef.current?.focus(); };
  const pick = (o) => { onPick(o); close(true); };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (hi >= 0 && hi < flat.length) pick(flat[hi]); }
    else if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "Tab") { close(false); }
  };

  const onTriggerKey = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen(true); }
  };

  const popStyle = (() => {
    if (!rect) return {};
    const below = window.innerHeight - rect.bottom;
    const cap = 360;
    const flip = below < 220 && rect.top > below;
    const width = Math.max(rect.width, minPopWidth);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    return {
      top: flip ? undefined : rect.bottom + 2,
      bottom: flip ? window.innerHeight - rect.top + 2 : undefined,
      left,
      width: Math.min(width, window.innerWidth - 16),
      maxHeight: flip ? Math.min(cap, rect.top - 10) : Math.min(cap, below - 10),
    };
  })();

  let idx = -1;
  const busy = disabled || loading;
  // Callers may size the control (width / flex / margin) but not restyle it: every picker looks the same.
  const layoutStyle = style ? Object.fromEntries(Object.entries(style).filter(([k]) => LAYOUT_KEYS.has(k))) : undefined;
  return (
    <div className="k-combo" style={layoutStyle}>
      <button
        type="button"
        ref={triggerRef}
        className="k-combo__trigger"
        disabled={busy}
        title={triggerTitle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => !busy && setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
      >
        <span className="k-combo__label">{loading ? <span className="k-combo__placeholder">Loading…</span> : triggerContent}</span>
        {onClear && !busy && (
          <span className="k-combo__clear" role="button" aria-label="Clear selection" title="Clear"
            onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClear(); }}>×</span>
        )}
        <MdArrowDropDown size={18} className="k-combo__caret" aria-hidden="true" />
      </button>

      {open && rect && createPortal(
        <div ref={popRef} className="k-combo__pop" style={popStyle} onKeyDown={onKeyDown}>
          <div className="k-combo__search">
            <MdSearch size={16} aria-hidden="true" />
            <input ref={searchRef} type="text" placeholder={searchPlaceholder} aria-label={searchPlaceholder} value={query}
              onChange={(e) => { onQuery(e.target.value); setHi(0); }} />
          </div>
          <div className="k-combo__list" role="listbox" ref={listRef}>
            {noneLabel != null && (
              <div role="option" aria-selected={false} className="k-combo__opt" style={{ color: "var(--k-muted)", fontStyle: "italic" }}
                onMouseDown={(e) => { e.preventDefault(); pick(null); }} onMouseEnter={() => setHi(-1)}>
                {noneLabel}
              </div>
            )}
            {flat.length === 0 && <div className="k-combo__empty">{emptyText}</div>}
            {sections.map((s) => (
              <div key={s.key ?? "all"} role="group" aria-label={s.label}>
                {s.label && s.options.length > 0 && (
                  <div className="k-combo__group" style={s.tone ? { color: s.tone.fg, background: s.tone.bg, borderRadius: 4 } : undefined}>{s.label}</div>
                )}
                {s.options.map((o) => {
                  idx += 1;
                  const i = idx;
                  const k = getKey(o);
                  const cur = isCurrent(o);
                  const isExp = renderExpand && expanded === k;
                  return (
                    <div key={k}>
                      <div
                        role="option"
                        data-idx={i}
                        aria-selected={i === hi}
                        className={`k-combo__opt${cur ? " k-combo__opt--current" : ""}`}
                        onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                        onMouseEnter={() => setHi(i)}
                      >
                        {renderExpand && (
                          <button type="button" className="k-combo__expand" title={isExp ? "Hide items" : "Show items"}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(isExp ? null : k); }}>
                            {isExp ? "▾" : "▸"}
                          </button>
                        )}
                        <span className="k-combo__opt-main">{renderOption(o)}</span>
                      </div>
                      {isExp && <div className="k-combo__expand-body" onMouseDown={(e) => e.stopPropagation()}>{renderExpand(o)}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
