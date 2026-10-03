import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MdBusiness, MdSearch } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import "./ui2.css";

/**
 * The company switcher, hoisted into the topbar so every company-scoped screen shares one control
 * (each screen used to carry its own dropdown above its filters). It drives the same
 * CompanyContext those dropdowns did, so behaviour is unchanged.
 */
export function CompanySwitcher() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  if (!companies || companies.length === 0) return null;
  return (
    <label className="u2-company" title="Company">
      <MdBusiness size={16} aria-hidden="true" />
      <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Company</span>
      <select
        aria-label="Company"
        value={selectedCompany?.id || ""}
        onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
      >
        {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
      </select>
    </label>
  );
}

// NavLink hrefs include the router basename (e.g. /admin); navigate() wants the path without it.
function toRoute(href) {
  const url = new URL(href, window.location.origin);
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const path = base && url.pathname.startsWith(base) ? url.pathname.slice(base.length) || "/" : url.pathname;
  return path + url.search;
}

/**
 * "Search or go to…": jump to any screen in the sidebar from the keyboard (Ctrl/Cmd+K, or "/").
 * It is navigation only. It lists the links the sidebar has ACTUALLY rendered for this user, so it
 * can never offer a screen the user's permissions hide, and it needs no second copy of the menu.
 */
export function QuickJump() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [items, setItems] = useState([]);
  const inputRef = useRef(null);
  const returnFocus = useRef(null);

  const openJump = useCallback(() => {
    const seen = new Set();
    const found = [...document.querySelectorAll(".dl-nav a[href], .dl-sidebar-bottom a[href]")].map((a) => ({
      label: a.textContent.trim(),
      route: toRoute(a.getAttribute("href")),
      group: a.closest(".dl-group")?.querySelector(".dl-group__title")?.textContent?.trim() || "",
    })).filter((it) => it.label && !seen.has(it.route) && seen.add(it.route));
    returnFocus.current = document.activeElement;
    setItems(found);
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); open ? close() : openJump(); }
      else if (e.key === "/" && !typing && !open) { e.preventDefault(); openJump(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, openJump, close]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((it) => `${it.label} ${it.group}`.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const go = (it) => { setOpen(false); navigate(it.route); };
  const onInputKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active]); }
  };

  return (
    <>
      <button type="button" className="u2-jump-trigger" onClick={openJump} aria-haspopup="dialog" aria-label="Search or go to a screen">
        <MdSearch size={16} aria-hidden="true" />
        <span>Search or go to…</span>
        <kbd>Ctrl K</kbd>
      </button>
      {open && (
        <div className="u2-jump-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="u2-jump" role="dialog" aria-modal="true" aria-label="Go to a screen">
            <input
              ref={inputRef}
              className="u2-jump__input"
              placeholder="Go to a screen…"
              role="combobox"
              aria-expanded="true"
              aria-controls="u2-jump-list"
              aria-activedescendant={results[active] ? `u2-jump-${active}` : undefined}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onInputKey}
            />
            {results.length === 0 ? (
              <div className="u2-jump__empty">No screen matches “{query}”.</div>
            ) : (
              <ul id="u2-jump-list" className="u2-jump__list" role="listbox">
                {results.map((it, i) => (
                  <li key={it.route} id={`u2-jump-${i}`} role="option" aria-selected={i === active} className="u2-jump__item"
                    onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); go(it); }}>
                    <span>{it.label}</span>
                    <small>{it.group}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
