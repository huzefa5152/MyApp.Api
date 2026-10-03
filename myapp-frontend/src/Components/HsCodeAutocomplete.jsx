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
export default function HsCodeAutocomplete({ companyId, value, onChange, style, placeholder, excludeHsCodes, saleType }) {
  const [query, setQuery] = useState(value || "");
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  // triggerRect drives the portaled dropdown's viewport position. Stored
  // in state so changes (scroll, resize, layout shift) trigger a
  // re-render with the new coordinates — without this the dropdown would
  // float in place while the input scrolls away under it.
  const [triggerRect, setTriggerRect] = useState(null);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  // Sync with external value changes (e.g. when auto-filled from item description)
  useEffect(() => {
    setQuery(value || "");
  }, [value]);

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
    debounceRef.current = setTimeout(async () => {
      const term = (q || "").trim();
      setLoading(true);
      try {
        const { data } = await getFbrHSCodes(companyId, term, saleType || null);
        // Hide HS codes already used elsewhere in the user's catalog
        const exclude = new Set((excludeHsCodes || []).map((c) => (c || "").trim()));
        const filtered = (data || []).filter((h) => !exclude.has((h.hS_CODE || "").trim()));
        setSuggestions(filtered);
      } catch (err) {
        console.error("HS code lookup error:", err);
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 200);
  }, [companyId, excludeHsCodes, saleType]);

  const handleSelect = (code) => {
    setQuery(code);
    onChange?.(code);
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
    if (!showDropdown || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex >= 0) handleSelect(suggestions[highlightIndex].hS_CODE);
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
          <ul className="sc-suggest" role="listbox" style={styles.dropdown(triggerRect)}>
            {loading && <li className="sc-suggest__note sc-suggest__note--loading">Searching FBR catalog…</li>}
            {!loading && suggestions.length === 0 && query && (
              HS_FORMAT.test(query.trim()) ? (
                // The field already holds a complete, valid HS code — almost
                // always the item's SAVED code on edit. Don't alarm the
                // operator with "no match" (the live catalog may also be
                // unavailable if this company has no FBR token yet); confirm
                // the code and invite a keyword search only if they want to
                // change it.
                <li style={styles.confirm}>
                  <span style={styles.confirmTick}>✓</span>
                  <span><b>{query.trim()}</b> — current HS code. Type a product keyword (e.g. “valve”, “pipe”) to pick a different one.</span>
                </li>
              ) : (
                <li className="sc-suggest__note">No HS codes match “{query}”. Try a product keyword like “valve” or “steel pipe”.</li>
              )
            )}
            {suggestions.map((s, idx) => (
              <li
                key={s.hS_CODE + idx}
                role="option"
                aria-selected={idx === highlightIndex}
                className="k-combo__opt"
                onMouseDown={() => handleSelect(s.hS_CODE)}
                onMouseEnter={() => setHighlightIndex(idx)}
              >
                <div className="sc-opt-code">{s.hS_CODE}</div>
                <div className="sc-opt-desc">{s.description}</div>
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
    const r = rect ?? { bottom: 0, left: 0, width: 300 };
    const width = Math.min(Math.max(r.width, 400), window.innerWidth - 16);
    return {
      top: r.bottom + 2,
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      width,
      maxHeight: 340,
    };
  },
  confirm: { display: "flex", gap: "0.5rem", alignItems: "flex-start", padding: "0.6rem 0.75rem", color: "#1b5e20", backgroundColor: "#f1f8f2", borderRadius: 6 },
  confirmTick: { flex: "none", color: "#2e7d32", fontWeight: 700 },
};