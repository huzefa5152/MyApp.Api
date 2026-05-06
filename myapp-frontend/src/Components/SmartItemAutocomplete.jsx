import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { searchItemDescriptions } from "../api/lookupApi";
import { getFbrHSCodes, getFbrHsUom } from "../api/fbrApi";

/**
 * Unified item description picker:
 *  1. Searches saved local item descriptions first (with remembered HS/UOM/SaleType)
 *  2. Then searches FBR's official HS code catalog
 *
 * On pick, fires `onPick({ name, hsCode, uom, fbrUOMId, saleType, source })`:
 *  - For LOCAL picks: full metadata comes from our saved row
 *  - For FBR picks: the FBR description + HS code + we auto-fetch the default UOM
 *    from the HS_UOM reference API and include it
 *
 * This is the single source for item entry — no more manual item types.
 */
export default function SmartItemAutocomplete({
  companyId,
  value,
  onChange,
  onPick,
  style,
  placeholder,
}) {
  const [query, setQuery] = useState(value || "");
  const [localResults, setLocalResults] = useState([]);
  const [fbrResults, setFbrResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  // Bumped on every scroll/resize while the dropdown is open so the portal
  // re-renders with fresh getBoundingClientRect coords. Combined with
  // position:fixed in viewport coords below, this keeps the dropdown glued
  // to the input even when an ancestor (modal body, page root) scrolls.
  const [, setReflow] = useState(0);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  // Sync with external changes
  useEffect(() => { setQuery(value || ""); }, [value]);

  // Close on outside click
  useEffect(() => {
    const onMouseDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      clearTimeout(debounceRef.current);
    };
  }, []);

  // Follow scroll/resize while open. Capture-phase scroll listener catches
  // scrolls inside any ancestor (modal body, table viewport), not just the
  // window — bubbling doesn't propagate scroll events.
  useEffect(() => {
    if (!showDropdown) return;
    const reflow = () => setReflow((n) => n + 1);
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    return () => {
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
    };
  }, [showDropdown]);

  const fetchBoth = useCallback((q) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const term = (q || "").trim();
      if (!term) {
        setLocalResults([]);
        setFbrResults([]);
        return;
      }
      setLoading(true);
      try {
        const [localRes, fbrRes] = await Promise.allSettled([
          searchItemDescriptions(term),
          companyId ? getFbrHSCodes(companyId, term) : Promise.resolve({ data: [] }),
        ]);
        setLocalResults(localRes.status === "fulfilled" ? localRes.value.data : []);
        setFbrResults(fbrRes.status === "fulfilled" ? fbrRes.value.data : []);
      } catch {
        setLocalResults([]);
        setFbrResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, [companyId]);

  const handleInputChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    onChange?.(v);
    fetchBoth(v);
    setShowDropdown(true);
  };

  // Local pick → use saved metadata directly
  const pickLocal = (item) => {
    setQuery(item.name);
    onChange?.(item.name);
    onPick?.({
      name: item.name,
      hsCode: item.hsCode || "",
      uom: item.uom || "",
      fbrUOMId: item.fbrUOMId || null,
      saleType: item.saleType || "",
      source: "local",
    });
    setShowDropdown(false);
  };

  // FBR pick → use FBR description/code and auto-fetch UOM
  const pickFbr = async (fbrItem) => {
    setQuery(fbrItem.description);
    onChange?.(fbrItem.description);
    setShowDropdown(false);

    // Best-effort: fetch the allowed UOM for this HS code
    let uom = "";
    let fbrUOMId = null;
    if (companyId) {
      try {
        const { data } = await getFbrHsUom(companyId, fbrItem.hS_CODE, 3);
        if (Array.isArray(data) && data.length > 0) {
          uom = data[0].description || "";
          fbrUOMId = data[0].uoM_ID ?? null;
        }
      } catch { /* ignore, user can set UOM manually */ }
    }

    onPick?.({
      name: fbrItem.description,
      hsCode: fbrItem.hS_CODE,
      uom,
      fbrUOMId,
      saleType: "Goods at standard rate (default)", // sensible default
      source: "fbr",
    });
  };

  const handleKeyDown = (e) => {
    const all = [...localResults, ...fbrResults];
    if (!showDropdown || all.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % all.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? all.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex < 0) return;
      if (highlightIndex < localResults.length) {
        pickLocal(localResults[highlightIndex]);
      } else {
        pickFbr(fbrResults[highlightIndex - localResults.length]);
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  const hasAnyResults = localResults.length > 0 || fbrResults.length > 0;

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%" }}>
      <input
        type="text"
        style={style}
        value={query}
        placeholder={placeholder || "Search items or FBR catalog…"}
        onChange={handleInputChange}
        onFocus={() => { if (query) { setShowDropdown(true); fetchBoth(query); } }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {showDropdown && (
        createPortal(
          <ul style={styles.dropdown(wrapperRef.current)}>
            {loading && <li style={styles.loading}>Searching…</li>}

            {!loading && localResults.length > 0 && (
              <>
                <li style={styles.sectionHeader}>SAVED ITEMS</li>
                {localResults.map((item, idx) => (
                  <li
                    key={`local-${item.id}`}
                    style={{
                      ...styles.item,
                      backgroundColor: idx === highlightIndex ? "#e3f2fd" : "#fff",
                    }}
                    onMouseDown={() => pickLocal(item)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                  >
                    <div style={styles.itemName}>
                      {item.name}
                      <span style={styles.localBadge}>SAVED</span>
                    </div>
                    {(item.hsCode || item.uom) && (
                      <div style={styles.itemMeta}>
                        {item.hsCode && <span><b>HS:</b> {item.hsCode}</span>}
                        {item.uom && <span> · <b>UOM:</b> {item.uom}</span>}
                        {item.saleType && <span> · <b>Sale:</b> {item.saleType.substring(0, 30)}{item.saleType.length > 30 ? "…" : ""}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </>
            )}

            {!loading && fbrResults.length > 0 && (
              <>
                <li style={styles.sectionHeader}>FBR CATALOG (HS Code)</li>
                {fbrResults.map((f, idx) => {
                  const realIdx = localResults.length + idx;
                  return (
                    <li
                      key={`fbr-${f.hS_CODE}-${idx}`}
                      style={{
                        ...styles.item,
                        backgroundColor: realIdx === highlightIndex ? "#e3f2fd" : "#fff",
                      }}
                      onMouseDown={() => pickFbr(f)}
                      onMouseEnter={() => setHighlightIndex(realIdx)}
                    >
                      <div style={styles.itemCodeRow}>
                        <span style={styles.hsCode}>{f.hS_CODE}</span>
                        <span style={styles.fbrBadge}>FBR</span>
                      </div>
                      <div style={styles.itemDesc}>{f.description}</div>
                    </li>
                  );
                })}
              </>
            )}

            {!loading && !hasAnyResults && query && (
              <li style={styles.empty}>
                No matches. Keep typing or just use your own description — we'll save it for next time.
              </li>
            )}
          </ul>,
          document.body
        )
      )}
    </div>
  );
}

const styles = {
  // position:fixed uses viewport coords (no scrollY math). The component's
  // scroll/resize listener forces a re-render so this reads fresh
  // getBoundingClientRect() coords each time — dropdown stays glued to the
  // input as ancestors scroll. Same pattern as LookupAutocomplete and
  // SearchableItemTypeSelect.
  dropdown: (el) => {
    const rect = el?.getBoundingClientRect() ?? { bottom: 0, left: 0, width: 300 };
    return {
      position: "fixed",
      top: rect.bottom,
      left: rect.left,
      width: Math.max(rect.width, 420),
      maxHeight: 380,
      overflowY: "auto",
      backgroundColor: "#fff",
      border: "1px solid #d0d7e2",
      borderRadius: 6,
      boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
      zIndex: 9999,
      margin: 0,
      padding: 0,
      listStyle: "none",
      fontSize: "0.82rem",
    };
  },
  sectionHeader: {
    padding: "0.4rem 0.7rem",
    fontSize: "0.7rem",
    fontWeight: 800,
    color: "#0d47a1",
    backgroundColor: "#eff6ff",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    borderBottom: "1px solid #d0d7e2",
  },
  item: {
    padding: "0.45rem 0.7rem",
    cursor: "pointer",
    borderBottom: "1px solid #f0f4f8",
  },
  itemName: {
    fontWeight: 600,
    color: "#1a2332",
    fontSize: "0.82rem",
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  localBadge: {
    padding: "0.05rem 0.35rem",
    backgroundColor: "#e8f5e9",
    color: "#2e7d32",
    fontSize: "0.62rem",
    fontWeight: 800,
    borderRadius: 3,
    letterSpacing: "0.04em",
  },
  fbrBadge: {
    padding: "0.05rem 0.35rem",
    backgroundColor: "#fff3e0",
    color: "#e65100",
    fontSize: "0.62rem",
    fontWeight: 800,
    borderRadius: 3,
    letterSpacing: "0.04em",
  },
  itemMeta: {
    fontSize: "0.72rem",
    color: "#5f6d7e",
    marginTop: 2,
  },
  itemCodeRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  hsCode: {
    fontWeight: 700,
    color: "#0d47a1",
    fontFamily: "monospace",
    fontSize: "0.82rem",
  },
  itemDesc: {
    fontSize: "0.72rem",
    color: "#5f6d7e",
    marginTop: 2,
    lineHeight: 1.3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },
  loading: { padding: "0.6rem 0.75rem", color: "#5f6d7e", fontSize: "0.82rem", fontStyle: "italic" },
  empty: { padding: "0.6rem 0.75rem", color: "#5f6d7e", fontSize: "0.8rem", lineHeight: 1.4 },
};
