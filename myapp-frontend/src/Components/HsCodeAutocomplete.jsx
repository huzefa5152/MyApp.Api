import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { getFbrHSCodes } from "../api/fbrApi";

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

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%" }}>
      <input
        type="text"
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
          <ul style={styles.dropdown(triggerRect)}>
            {loading && <li style={styles.loading}>Searching FBR catalog…</li>}
            {!loading && suggestions.length === 0 && query && (
              <li style={styles.empty}>No HS codes match "{query}". Try a different keyword.</li>
            )}
            {suggestions.map((s, idx) => (
              <li
                key={s.hS_CODE + idx}
                style={{
                  ...styles.item,
                  backgroundColor: idx === highlightIndex ? "#e3f2fd" : "#fff",
                }}
                onMouseDown={() => handleSelect(s.hS_CODE)}
                onMouseEnter={() => setHighlightIndex(idx)}
              >
                <div style={styles.itemCode}>{s.hS_CODE}</div>
                <div style={styles.itemDesc}>{s.description}</div>
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
    // position:fixed + viewport coords. The triggerRect state is updated
    // on every scroll (capture phase) so the dropdown re-renders glued
    // to the input as it moves on screen. position:absolute with +scrollY
    // would drift on inner-container scroll because we never re-render.
    const r = rect ?? { bottom: 0, left: 0, width: 300 };
    return {
      position: "fixed",
      top: r.bottom,
      left: r.left,
      width: Math.max(r.width, 400),
      maxHeight: 340,
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
  item: {
    padding: "0.5rem 0.7rem",
    cursor: "pointer",
    borderBottom: "1px solid #f0f4f8",
  },
  itemCode: {
    fontWeight: 700,
    color: "#0d47a1",
    fontFamily: "monospace",
    fontSize: "0.82rem",
  },
  itemDesc: {
    fontSize: "0.75rem",
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
  empty: { padding: "0.6rem 0.75rem", color: "#5f6d7e", fontSize: "0.82rem" },
};
