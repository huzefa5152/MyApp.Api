import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { getFbrHSCodes } from "../api/fbrApi";
import "../ui/kit.css";
import "../ui/shared-components.css";

// PCT/HS format: NNNN.NNNN with an optional .NN tail. Used to tell a
// complete, already-valid code (e.g. an item's SAVED code on edit) apart
// from a partial product keyword the operator is typing.
const HS_FORMAT = /^\d{4}\.\d{4}(\.\d{2})?$/;

/**
 * Autocomplete that searches FBR's official HS Code catalog (V1.12 §5.3).
 * Calls GET /api/fbr/hscodes/{companyId}?search=query which proxies to
 * https://gw.fbr.gov.pk/pdi/v1/itemdesccode.
 *
 * Users type a product keyword (e.g. "valve", "steel pipe") and pick from
 * FBR-matched results — no need to know HS codes by heart.
 *
 * The displayed selection is just the code (e.g. "8481.8090"); the dropdown
 * shows "code — description" so the user can verify which one fits.
 *
 * Props:
 *   excludeHsCodes — optional array of HS codes to hide from results.
 *     Used by Item Catalog so the user can't pick a code already saved.
 *   saleType — optional sale-type filter. When set, the FBR catalog is
 *     narrowed server-side to HS codes whose HS-prefix heuristic maps to
 *     that sale type. Used by the inline New-Item-Type popups when the
 *     parent bill has a scenario-locked sale type.
 */
export default function HsCodeAutocomplete({ companyId, value, onChange, onSelect, companyItems = [], showCompanyStatus = false, style, placeholder, excludeHsCodes, saleType, ariaLabel }) {
  const [query, setQuery] = useState(value || "");
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const requestRef = useRef(0);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  // triggerRect drives the portaled dropdown's viewport position. Stored
  // in state so changes (scroll, resize, layout shift) trigger a
  // re-render with the new coordinates — without this the dropdown would
  // float in place while the input scrolls away under it.
  const [triggerRect, setTriggerRect] = useState(null);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);
  const term = query.trim().toLowerCase();
  const localMatches = companyItems.filter(t => t.hsCode && !t.isHsCodePartial
    && (!term || [t.hsCode, t.name, t.uom].some(s => s?.toLowerCase().includes(term))));
  const localCodes = new Set(localMatches.map(t => t.hsCode.trim()));
  const options = [...localMatches.map(t => ({ hS_CODE: t.hsCode, description: t.name, companyItem: t })),
    ...suggestions.filter(s => !localCodes.has(s.hS_CODE?.trim())).flatMap(s => {
      const matches = companyItems.filter(t => !t.isHsCodePartial && t.hsCode?.trim() === s.hS_CODE?.trim());
      return matches.length ? matches.map(t => ({ ...s, description: t.name, companyItem: t })) : [s];
    })];

  // Sync with external value changes (e.g. when auto-filled from item description)
  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  useEffect(() => {
    requestRef.current += 1;
    clearTimeout(debounceRef.current);
    setSuggestions([]); setLookupError(""); setLoading(false); setShowDropdown(false);
    return () => { requestRef.current += 1; clearTimeout(debounceRef.current); };
  }, [companyId]);

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

  // Keep triggerRect in sync with the input's actual position on screen.
  // We listen on the capture phase so any ancestor's scroll fires the
  // handler — the dashboard's content area is scrollable independently
  // of <body>, and a popup modal has its own scrollable body too. resize
  // covers viewport changes (mobile rotation, devtools open).
  useEffect(() => {
    if (!showDropdown) return;
    const update = () => {
      const el = wrapperRef.current;
      if (el) setTriggerRect(el.getBoundingClientRect());
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [showDropdown]);

  // Fetches HS codes. Empty query → backend returns the first 100 (browse mode)
  // so the user can scroll the catalog without knowing keywords up front.
  // With a query, backend filters server-side.
  const fetchResults = useCallback((q) => {
    clearTimeout(debounceRef.current);
    const request = ++requestRef.current;
    setSuggestions([]); setHighlightIndex(-1); setLookupError(""); setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const term = (q || "").trim();
      setLoading(true);
      try {
        const { data } = await getFbrHSCodes(companyId, term, saleType || null,
          excludeHsCodes ? { excludeSaved: true, includeHsCode: value || undefined } : {});
        if (request !== requestRef.current) return;
        // Hide HS codes already used elsewhere in the user's catalog
        const exclude = new Set((excludeHsCodes || []).map((c) => (c || "").trim()));
        const filtered = (data || []).filter((h) => !exclude.has((h.hS_CODE || "").trim()));
        setSuggestions(filtered);
      } catch (err) {
        if (request !== requestRef.current) return;
        setLookupError(err.response?.data?.message || "Could not load the FBR catalog. Check this company's FBR connection and focus this field to retry.");
        setSuggestions([]);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    }, 200);
  }, [companyId, excludeHsCodes, saleType, value]);

  const handleSelect = (option) => {
    const code = option.hS_CODE;
    requestRef.current += 1;
    clearTimeout(debounceRef.current);
    setLoading(false);
    setQuery(code);
    if (onSelect) onSelect(option);
    else onChange?.(code);
    setShowDropdown(false);
    setHighlightIndex(-1);
  };

  const handleChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    onChange?.(v);
    fetchResults(v);
    setShowDropdown(true);
  };

  const handleKeyDown = (e) => {
    if (!showDropdown || options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex >= 0 && options[highlightIndex]) handleSelect(options[highlightIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  // Free-text input (the operator may type a code directly). Input = kit input
  // (k-input; `style` is still applied on top), dropdown = the ComboBox popover look
  // (.sc-suggest + k-combo__* in ui/kit.css / ui/shared-components.css).
  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%" }}>
      <input
        type="text"
        className="k-input"
        aria-label={ariaLabel}
        style={style}
        value={query}
        placeholder={placeholder || "Click to browse FBR catalog, or type e.g. valve, pipe, steel…"}
        onChange={handleChange}
        onFocus={() => {
          // Always open the dropdown on focus and fetch — empty query returns
          // the first 100 catalog rows so the operator can browse without
          // having to know keywords up front.
          setShowDropdown(true);
          fetchResults(query);
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {showDropdown && (
        createPortal(
          <ul className="sc-suggest" role="listbox" data-admin-popup="" style={styles.dropdown(triggerRect)}>
            {loading && <li className="sc-suggest__note sc-suggest__note--loading">Searching FBR catalog…</li>}
            {lookupError && <li role="alert" className="sc-suggest__note">{lookupError}</li>}
            {!loading && !lookupError && options.length === 0 && (
              (excludeHsCodes || []).some(code => code?.trim() === query.trim()) ? <li className="sc-suggest__note">This HS code is already saved in this company. Choose its existing item from Item Catalog.</li> : HS_FORMAT.test(query.trim()) ? (
                <li className="sc-suggest__note">
                  <span><b>{query.trim()}</b> — no FBR result returned. Check this company's FBR connection or search by product keyword.</span>
                </li>
              ) : (
                <li className="sc-suggest__note">{query ? `No HS codes match “${query}”. Try a product keyword like “valve” or “steel pipe”.` : "No FBR HS codes are available. Check this company's FBR connection and retry."}</li>
              )
            )}
            {options.map((s, idx) => (
              <li
                key={s.hS_CODE + idx}
                role="option"
                aria-selected={idx === highlightIndex}
                className="k-combo__opt"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
                onMouseEnter={() => setHighlightIndex(idx)}
              >
                <div className="sc-opt-code">{s.hS_CODE}</div>
                {!s.companyItem && s.shortName && s.shortName.toLowerCase() !== String(s.description).trim().toLowerCase() && <div className="sc-opt-desc" style={{ fontWeight: 600, color: "var(--k-ink)" }}>{s.shortName}</div>}
                <div className="sc-opt-desc">{s.description}</div>
                {showCompanyStatus && <div className="sc-opt-desc" style={s.companyItem ? { color: "#17603e" } : undefined}>{s.companyItem
                  ? `Company item · ${Number(s.companyItem.availableQty || 0).toLocaleString("en-PK")} in stock · ${s.companyItem.uom || "Unit not set"}`
                  : "FBR catalog · Add to this company on save"}</div>}
              </li>
            ))}
          </ul>,
          document.body
        )
      )}
    </div>
  );
}

const styles = {
  dropdown: (rect) => {
    // position:fixed (from .sc-suggest) + viewport coords. The triggerRect state
    // is updated on every scroll (capture phase) so the dropdown re-renders glued
    // to the input as it moves on screen. Kept inside the viewport horizontally.
    const r = rect ?? { top: 0, bottom: 0, left: 0, width: 300 };
    const width = Math.min(Math.max(r.width, 400), window.innerWidth - 16);
    // Open upward when the input sits near the bottom of the screen (e.g. a pinned action bar)
    // and there is more room above; otherwise the list runs off-screen.
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
    const up = below < 200 && above > below;
    return {
      ...(up ? { bottom: window.innerHeight - r.top + 2 } : { top: r.bottom + 2 }),
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      width,
      maxHeight: Math.max(120, Math.min(340, up ? above : below)),
    };
  },
};
