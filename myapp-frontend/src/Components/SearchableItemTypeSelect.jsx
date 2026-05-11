import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { MdArrowDropDown, MdSearch, MdStar } from "react-icons/md";

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

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        style={{ ...styles.trigger, ...style }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
          {selected ? (
            <>
              {selected.isFavorite && <MdStar size={12} color="#f59f00" style={{ verticalAlign: "middle", marginRight: 3 }} />}
              {selected.name}
              {selected.hsCode && <span style={styles.hsInline}> · {selected.hsCode}</span>}
            </>
          ) : (
            <span style={styles.placeholder}>{placeholder || "Select item…"}</span>
          )}
        </span>
        {selected && (
          <span onClick={handleClear} style={styles.clearBtn} title="Clear selection">×</span>
        )}
        <MdArrowDropDown size={18} style={{ flexShrink: 0 }} />
      </button>

      {open && triggerRect && createPortal(
        <div
          ref={wrapperRef}
          style={styles.dropdown(triggerRect)}
          onKeyDown={handleKeyDown}
        >
          <div style={styles.searchRow}>
            <MdSearch size={16} style={styles.searchIcon} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search by name, HS code…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0); }}
              onKeyDown={handleKeyDown}
              style={styles.searchInput}
            />
          </div>

          <div style={styles.list}>
            {filteredItems.length === 0 && (
              <div style={styles.empty}>
                {items?.length === 0
                  ? "No items in catalog yet. Add one on the Item Types page."
                  : `No items match "${query}".`}
              </div>
            )}

            {stocked.length > 0 && (
              <>
                <div style={styles.sectionHeader}>📦 IN STOCK</div>
                {stocked.map((it, i) => renderItem(it, i, highlightIdx, setHighlightIdx, handlePick))}
              </>
            )}
            {quick.length > 0 && (
              <>
                <div style={styles.sectionHeader}>⚡ QUICK (no HS code)</div>
                {quick.map((it, i) => {
                  const realIdx = stocked.length + i;
                  return renderItem(it, realIdx, highlightIdx, setHighlightIdx, handlePick);
                })}
              </>
            )}
            {favorites.length > 0 && (
              <>
                <div style={styles.sectionHeader}>★ FAVORITES</div>
                {favorites.map((it, i) => {
                  const realIdx = stocked.length + quick.length + i;
                  return renderItem(it, realIdx, highlightIdx, setHighlightIdx, handlePick);
                })}
              </>
            )}
            {others.length > 0 && (
              <>
                {(stocked.length > 0 || quick.length > 0 || favorites.length > 0) && <div style={styles.sectionHeader}>OTHER</div>}
                {others.map((it, i) => {
                  const realIdx = stocked.length + quick.length + favorites.length + i;
                  return renderItem(it, realIdx, highlightIdx, setHighlightIdx, handlePick);
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

function renderItem(it, idx, highlightIdx, setHighlightIdx, handlePick) {
  const highlighted = idx === highlightIdx;
  return (
    <div
      key={it.id}
      onMouseDown={() => handlePick(it)}
      onMouseEnter={() => setHighlightIdx(idx)}
      style={{
        ...styles.row,
        backgroundColor: highlighted ? "#e3f2fd" : "transparent",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.rowName}>
          {it.isFavorite && <MdStar size={12} color="#f59f00" style={{ verticalAlign: "middle", marginRight: 3 }} />}
          {it.name}
        </div>
        <div style={styles.rowMeta}>
          {it.hsCode && <span style={styles.hsChip}>{it.hsCode}</span>}
          {it.uom && <span style={{ color: "#5f6d7e" }}> {it.uom}</span>}
          {typeof it.availableQty === "number" && (
            <span style={(it.availableQty || 0) > 0 ? styles.stockChipOk : styles.stockChipEmpty}>
              {(it.availableQty || 0) > 0 ? `${Number(it.availableQty).toLocaleString("en-PK")} in stock` : "out of stock"}
            </span>
          )}
          {it.usageCount > 0 && <span style={{ color: "#5f6d7e", marginLeft: 4 }}>· used {it.usageCount}×</span>}
        </div>
      </div>
    </div>
  );
}

const styles = {
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    width: "100%",
    padding: "0.45rem 0.55rem",
    border: "1px solid #d0d7e2",
    borderRadius: 6,
    backgroundColor: "#fff",
    fontSize: "0.82rem",
    color: "#1a2332",
    cursor: "pointer",
    textAlign: "left",
  },
  placeholder: { color: "#94a3b8" },
  clearBtn: {
    fontSize: "1rem",
    color: "#94a3b8",
    padding: "0 0.3rem",
    cursor: "pointer",
    lineHeight: 1,
  },
  hsInline: { color: "#5f6d7e", fontFamily: "monospace", fontSize: "0.75rem", marginLeft: 4 },
  // position: fixed uses viewport coords (no scrollY math). Anchored directly
  // to the trigger's getBoundingClientRect(), and the component re-measures
  // on every ancestor scroll/resize so the list tracks the trigger exactly.
  // If the dropdown would run off the bottom of the viewport we flip it above.
  dropdown: (rect) => {
    const spaceBelow = window.innerHeight - rect.bottom;
    const listHeight = 420;
    const flipAbove = spaceBelow < 240 && rect.top > spaceBelow;
    return {
      position: "fixed",
      top: flipAbove ? undefined : rect.bottom + 2,
      bottom: flipAbove ? window.innerHeight - rect.top + 2 : undefined,
      left: rect.left,
      width: Math.max(rect.width, 360),
      maxHeight: flipAbove ? Math.min(listHeight, rect.top - 10) : Math.min(listHeight, spaceBelow - 10),
      backgroundColor: "#fff",
      border: "1px solid #d0d7e2",
      borderRadius: 8,
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
    };
  },
  searchRow: {
    display: "flex",
    alignItems: "center",
    padding: "0.45rem 0.65rem",
    borderBottom: "1px solid #e8edf3",
    position: "relative",
  },
  searchIcon: { position: "absolute", left: 12, color: "#94a3b8" },
  searchInput: {
    width: "100%",
    padding: "0.35rem 0.35rem 0.35rem 1.85rem",
    border: "1px solid #e8edf3",
    borderRadius: 6,
    fontSize: "0.82rem",
    outline: "none",
    backgroundColor: "#f8f9fb",
  },
  list: { overflowY: "auto", flex: 1 },
  sectionHeader: {
    padding: "0.45rem 0.7rem 0.25rem",
    fontSize: "0.65rem",
    fontWeight: 800,
    color: "#5f6d7e",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    backgroundColor: "#f8f9fb",
    position: "sticky",
    top: 0,
  },
  row: {
    padding: "0.45rem 0.7rem",
    cursor: "pointer",
    borderBottom: "1px solid #f0f4f8",
  },
  rowName: {
    fontWeight: 600,
    fontSize: "0.82rem",
    color: "#1a2332",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowMeta: {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
    marginTop: 2,
    fontSize: "0.72rem",
  },
  hsChip: {
    padding: "0.05rem 0.35rem",
    backgroundColor: "#e3f2fd",
    color: "#0d47a1",
    fontFamily: "monospace",
    fontWeight: 700,
    fontSize: "0.7rem",
    borderRadius: 3,
  },
  // 2026-05-12: stock chips shown next to HS / UOM when the parent
  // passed companyId to getItemTypes. Green = sellable now, muted =
  // nothing left to ship under this Item Type.
  stockChipOk: {
    padding: "0.05rem 0.35rem",
    backgroundColor: "#e8f5e9",
    color: "#1b5e20",
    fontWeight: 700,
    fontSize: "0.7rem",
    borderRadius: 3,
    marginLeft: 4,
  },
  stockChipEmpty: {
    padding: "0.05rem 0.35rem",
    backgroundColor: "#f0f4f8",
    color: "#5f6d7e",
    fontWeight: 600,
    fontSize: "0.7rem",
    borderRadius: 3,
    marginLeft: 4,
  },
  empty: { padding: "0.8rem 0.8rem", color: "#5f6d7e", fontSize: "0.82rem" },
};
