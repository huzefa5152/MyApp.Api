import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { MdArrowDropDown, MdSearch, MdStar } from "react-icons/md";
import "../ui/kit.css";
import "../ui/shared-components.css";

/**
 * Dropdown for picking an Item Type (FBR-mapped catalog entry). Designed to
 * replace the plain <select> — gives users inline search and puts favorites
 * at the top of the list.
 *
 * Props:
 *   items      — array of ItemTypeDto { id, name, hsCode, uom, saleType, isFavorite, usageCount }
 *   value      — currently selected item type id (or empty string for none)
 *   onChange   — (newId, pickedItemType) ⇒ void
 *   placeholder, style — passthroughs
 */
export default function SearchableItemTypeSelect({ items, value, onChange, placeholder, style }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  // triggerRect drives the portaled dropdown's position. We recompute it on
  // every ancestor scroll + viewport resize so the list stays glued to the
  // trigger even when the dashboard layout (and not <body>) is the scroller.
  const [triggerRect, setTriggerRect] = useState(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const wrapperRef = useRef(null);

  const selected = useMemo(
    () => (items || []).find((it) => String(it.id) === String(value)),
    [items, value]
  );

  // Sort:
  //   0. (2026-05-12) Items the operator can actually sell — availableQty
  //      > 0 — bubble to the top so the dropdown leads with what's in
  //      stock. Only present when the parent passed a companyId to
  //      getItemTypes; admin pages that fetch the global catalog see
  //      this layer collapse and the legacy ordering takes over.
  //   1. Quick-entry items (no HS code) — for draft/non-FBR lines.
  //   2. Favorites next.
  //   3. Then by usage desc.
  //   4. Alphabetical tiebreaker.
  const sortedItems = useMemo(() => {
    const arr = [...(items || [])];
    const hasHs = (it) => !!(it.hsCode && it.hsCode.trim());
    const inStock = (it) => (it.availableQty || 0) > 0;
    arr.sort((a, b) => {
      if (inStock(a) !== inStock(b)) return inStock(a) ? -1 : 1;
      if (inStock(a) && inStock(b)) {
        const av = a.availableQty || 0;
        const bv = b.availableQty || 0;
        if (av !== bv) return bv - av;
      }
      if (hasHs(a) !== hasHs(b)) return hasHs(a) ? 1 : -1;
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      if ((b.usageCount || 0) !== (a.usageCount || 0)) return (b.usageCount || 0) - (a.usageCount || 0);
      return (a.name || "").localeCompare(b.name || "");
    });
    return arr;
  }, [items]);

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return sortedItems;
    return sortedItems.filter((it) =>
      (it.name || "").toLowerCase().includes(term) ||
      (it.hsCode || "").toLowerCase().includes(term) ||
      (it.uom || "").toLowerCase().includes(term) ||
      (it.fbrDescription || "").toLowerCase().includes(term)
    );
  }, [sortedItems, query]);

  // Close on outside click
  useEffect(() => {
    const onMouseDown = (e) => {
      if (
        wrapperRef.current && !wrapperRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
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
      // Focus search after the dropdown is rendered
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  // Keep the portaled dropdown anchored to the trigger through ANY scroll —
  // not just window scroll, because in the dashboard layout the scroll
  // container is an inner <div>, not <body>. `capture: true` catches scroll
  // events as they bubble up from every nested scroller.
  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      if (triggerRef.current) setTriggerRect(triggerRef.current.getBoundingClientRect());
    };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open]);

  const handlePick = (it) => {
    onChange?.(it?.id || "", it || null);
    setOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange?.("", null);
  };

  const handleKeyDown = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min((filteredItems.length - 1), i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < filteredItems.length) {
        handlePick(filteredItems[highlightIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Split into groups so the dropdown reads (top→bottom):
  //   0. (2026-05-12) IN STOCK — items with availableQty > 0, sorted
  //      by qty desc. Only populated when the parent supplied a
  //      companyId; otherwise empty and the legacy three-group layout
  //      stands.
  //   1. QUICK (no HS) — drafts/non-FBR.
  //   2. FAVORITES.
  //   3. OTHER.
  const hasHs = (it) => !!(it.hsCode && it.hsCode.trim());
  const inStock = (it) => (it.availableQty || 0) > 0;
  const stocked = filteredItems.filter((it) => inStock(it));
  const rest = filteredItems.filter((it) => !inStock(it));
  const quick = rest.filter((it) => !hasHs(it));
  const favorites = rest.filter((it) => hasHs(it) && it.isFavorite);
  const others = rest.filter((it) => hasHs(it) && !it.isFavorite);

  // Same look as the ComboBox engine (k-combo__* classes in ui/kit.css, themed by the
  // --k-* tokens). `style` is still merged onto the trigger, exactly as before.
  return (
    <div className="k-combo">
      <button
        type="button"
        ref={triggerRef}
        className="k-combo__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={style}
      >
        <span className="k-combo__label">
          {selected ? (
            <>
              {selected.isFavorite && <MdStar size={12} color="#f59f00" style={{ verticalAlign: "middle", marginRight: 3 }} />}
              {selected.name}
              {selected.hsCode && <span style={styles.hsInline}> · {selected.hsCode}</span>}
            </>
          ) : (
            <span className="k-combo__placeholder">{placeholder || "Select item…"}</span>
          )}
        </span>
        {selected && (
          <span onClick={handleClear} className="k-combo__clear" title="Clear selection">×</span>
        )}
        <MdArrowDropDown size={18} className="k-combo__caret" />
      </button>

      {open && triggerRect && createPortal(
        <div
          ref={wrapperRef}
          className="k-combo__pop"
          style={styles.dropdown(triggerRect)}
          onKeyDown={handleKeyDown}
        >
          <div className="k-combo__search">
            <MdSearch size={16} aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search by name, HS code…"
              aria-label="Search by name, HS code…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0); }}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="k-combo__list" role="listbox">
            {filteredItems.length === 0 && (
              <div className="k-combo__empty">
                {items?.length === 0
                  ? "No items in catalog yet. Add one on the Item Types page."
                  : `No items match "${query}".`}
              </div>
            )}

            {stocked.length > 0 && (
              <>
                <div className="k-combo__group sc-combo-sticky">📦 IN STOCK</div>
                {stocked.map((it, i) => renderItem(it, i, highlightIdx, setHighlightIdx, handlePick, value))}
              </>
            )}
            {quick.length > 0 && (
              <>
                <div className="k-combo__group sc-combo-sticky">⚡ QUICK (no HS code)</div>
                {quick.map((it, i) => {
                  const realIdx = stocked.length + i;
                  return renderItem(it, realIdx, highlightIdx, setHighlightIdx, handlePick, value);
                })}
              </>
            )}
            {favorites.length > 0 && (
              <>
                <div className="k-combo__group sc-combo-sticky">★ FAVORITES</div>
                {favorites.map((it, i) => {
                  const realIdx = stocked.length + quick.length + i;
                  return renderItem(it, realIdx, highlightIdx, setHighlightIdx, handlePick, value);
                })}
              </>
            )}
            {others.length > 0 && (
              <>
                {(stocked.length > 0 || quick.length > 0 || favorites.length > 0) && <div className="k-combo__group sc-combo-sticky">OTHER</div>}
                {others.map((it, i) => {
                  const realIdx = stocked.length + quick.length + favorites.length + i;
                  return renderItem(it, realIdx, highlightIdx, setHighlightIdx, handlePick, value);
                })}
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function renderItem(it, idx, highlightIdx, setHighlightIdx, handlePick, currentValue) {
  const highlighted = idx === highlightIdx;
  const current = currentValue !== "" && currentValue != null && String(it.id) === String(currentValue);
  return (
    <div
      key={it.id}
      role="option"
      aria-selected={highlighted}
      className={`k-combo__opt${current ? " k-combo__opt--current" : ""}`}
      onMouseDown={() => handlePick(it)}
      onMouseEnter={() => setHighlightIdx(idx)}
    >
      <div className="k-combo__opt-main">
        <div className="sc-opt-name">
          {it.isFavorite && <MdStar size={12} color="#f59f00" style={{ verticalAlign: "middle", marginRight: 3 }} />}
          {it.name}
        </div>
        <div className="sc-opt-meta">
          {it.hsCode && <span className="sc-chip sc-chip--hs">{it.hsCode}</span>}
          {it.uom && <span> {it.uom}</span>}
          {typeof it.availableQty === "number" && (
            <span className={`sc-chip ${(it.availableQty || 0) > 0 ? "sc-chip--ok" : "sc-chip--empty"}`} style={{ marginLeft: 4 }}>
              {(it.availableQty || 0) > 0 ? `${Number(it.availableQty).toLocaleString("en-PK")} in stock` : "out of stock"}
            </span>
          )}
          {it.usageCount > 0 && <span style={{ marginLeft: 4 }}>· used {it.usageCount}×</span>}
        </div>
      </div>
    </div>
  );
}

const styles = {
  hsInline: { color: "var(--k-muted, #5f6d7e)", fontFamily: "monospace", fontSize: "0.75rem", marginLeft: 4 },
  // position: fixed (from .k-combo__pop) uses viewport coords (no scrollY math).
  // Anchored directly to the trigger's getBoundingClientRect(), and the component
  // re-measures on every ancestor scroll/resize so the list tracks the trigger
  // exactly. If the dropdown would run off the bottom of the viewport we flip it
  // above; it is also kept inside the viewport horizontally (phones).
  dropdown: (rect) => {
    const spaceBelow = window.innerHeight - rect.bottom;
    const listHeight = 420;
    const flipAbove = spaceBelow < 240 && rect.top > spaceBelow;
    const width = Math.min(Math.max(rect.width, 360), window.innerWidth - 16);
    return {
      top: flipAbove ? undefined : rect.bottom + 2,
      bottom: flipAbove ? window.innerHeight - rect.top + 2 : undefined,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
      maxHeight: flipAbove ? Math.min(listHeight, rect.top - 10) : Math.min(listHeight, spaceBelow - 10),
    };
  },
};