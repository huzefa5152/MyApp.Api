import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { searchItemDescriptions } from "../api/lookupApi";
import { getFbrHSCodes, getFbrHsUom } from "../api/fbrApi";
import "../ui/kit.css";
import "../ui/shared-components.css";

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
          searchItemDescriptions(term, companyId),
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

  // Free-text input (own descriptions are allowed). Input = kit input (k-input;
  // `style` is still applied on top), dropdown = the ComboBox popover look
  // (.sc-suggest + k-combo__* in ui/kit.css / ui/shared-components.css).
  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%" }}>
      <input
        type="text"
        className="k-input"
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
          <ul className="sc-suggest" role="listbox" style={styles.dropdown(wrapperRef.current)}>
            {loading && <li className="sc-suggest__note sc-suggest__note--loading">Searching…</li>}

            {!loading && localResults.length > 0 && (
              <>
                <li className="k-combo__group" style={styles.sectionHeader}>SAVED ITEMS</li>
                {localResults.map((item, idx) => (
                  <li
                    key={`local-${item.id}`}
                    role="option"
                    aria-selected={idx === highlightIndex}
                    className="k-combo__opt"
                    onMouseDown={() => pickLocal(item)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                  >
                    <div style={styles.itemName}>
                      {item.name}
                      <span className="sc-chip sc-chip--saved">SAVED</span>
                    </div>
                    {(item.hsCode || item.uom) && (
                      <div className="sc-opt-meta" style={{ display: "block" }}>
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
                <li className="k-combo__group" style={styles.sectionHeader}>FBR CATALOG (HS Code)</li>
                {fbrResults.map((f, idx) => {
                  const realIdx = localResults.length + idx;
                  return (
                    <li
                      key={`fbr-${f.hS_CODE}-${idx}`}
                      role="option"
                      aria-selected={realIdx === highlightIndex}
                      className="k-combo__opt"
                      onMouseDown={() => pickFbr(f)}
                      onMouseEnter={() => setHighlightIndex(realIdx)}
                    >
                      <div style={styles.itemCodeRow}>
                        <span className="sc-opt-code">{f.hS_CODE}</span>
                        <span className="sc-chip sc-chip--fbr">FBR</span>
                      </div>
                      <div className="sc-opt-desc">{f.description}</div>
                    </li>
                  );
                })}
              </>
            )}

            {!loading && !hasAnyResults && query && (
              <li className="sc-suggest__note">
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
  // position:fixed (from .sc-suggest) uses viewport coords (no scrollY math). The
  // component's scroll/resize listener forces a re-render so this reads fresh
  // getBoundingClientRect() coords each time — dropdown stays glued to the
  // input as ancestors scroll. Same pattern as LookupAutocomplete and
  // SearchableItemTypeSelect. Kept inside the viewport horizontally (phones).
  dropdown: (el) => {
    const rect = el?.getBoundingClientRect() ?? { bottom: 0, left: 0, width: 300 };
    const width = Math.min(Math.max(rect.width, 420), window.innerWidth - 16);
    return {
      top: rect.bottom + 2,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
      maxHeight: 380,
    };
  },
  // Section header keeps its blue tint (same as the ComboBox's toned group rows).
  sectionHeader: { color: "var(--k-blue, #0d47a1)", backgroundColor: "#eff6ff", borderRadius: 4 },
  itemName: { fontWeight: 600, color: "var(--k-ink, #1a2332)", display: "flex", alignItems: "center", gap: "0.4rem" },
  itemCodeRow: { display: "flex", alignItems: "center", gap: "0.4rem" },
};