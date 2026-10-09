import { Children, Fragment, cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MdMoreHoriz } from "react-icons/md";
import { colors } from "../theme";

/**
 * The action row at the foot of a document card or table row.
 *
 * A bill card can carry eight or more actions, each behind its own permission
 * and status test; rendered as one wrapping row they took three lines and most
 * of the card. This keeps the everyday ones in view and folds the rest into a
 * "more" menu.
 *
 * It only RE-HOMES buttons and decides nothing: every child keeps its own
 * render condition, onClick, disabled state and title. A child marked
 * `data-primary` stays in view; the others go into the menu, in the order
 * written. Fragments are flattened. An icon-only button (a table row) names
 * itself with `data-label`, shown beside its icon once it is in the menu.
 *
 * The menu is portalled and fixed-positioned: cards clip their overflow, which
 * would cut an in-card dropdown off.
 */
function flatten(children) {
  const out = [];
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    if (c.type === Fragment) out.push(...flatten(c.props.children));
    else out.push(c);
  });
  return out;
}

const MENU_WIDTH = 232;

export default function CardActions({ children, style, label = "More actions", nowrap = false }) {
  const items = flatten(children);
  const primary = items.filter((c) => c.props["data-primary"]);
  let rest = items.filter((c) => !c.props["data-primary"]);
  // A menu holding one action is a click for nothing: show it inline.
  if (rest.length === 1) { primary.push(rest[0]); rest = []; }

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const menuH = menuRef.current?.offsetHeight || 0;
    const below = window.innerHeight - b.bottom;
    const up = menuH && below < menuH + 12 && b.top > below;
    const left = Math.max(8, Math.min(b.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPos({ left, top: up ? Math.max(8, b.top - menuH - 6) : b.bottom + 6, up });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); } };
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    menuRef.current?.querySelector("button:not([disabled])")?.focus();
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  const onMenuKey = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const btns = [...menuRef.current.querySelectorAll("button:not([disabled])")];
    const i = btns.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
    btns[next]?.focus();
  };

  return (
    <div style={{ display: "flex", flexWrap: nowrap ? "nowrap" : "wrap", gap: nowrap ? 4 : "0.4rem", alignItems: "center", ...style }}>
      {primary}
      {rest.length > 0 && (
        <button
          ref={btnRef}
          type="button"
          className="card-actions-more"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          title={label}
          style={{
            display: "grid", placeItems: "center", width: 32, height: 30, padding: 0,
            flexShrink: 0, marginLeft: nowrap ? 0 : "auto",
            borderRadius: 8, border: `1px solid ${colors.inputBorder}`,
            background: open ? colors.inputBg : "#fff", color: colors.textSecondary,
            cursor: "pointer", boxShadow: "none",
          }}
        >
          <MdMoreHoriz size={18} aria-hidden="true" />
        </button>
      )}
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={pos?.up ? "card-actions-menu card-actions-menu--up" : "card-actions-menu"}
          style={{
            position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 1200,
            width: MENU_WIDTH, maxHeight: "60vh", overflowY: "auto",
            background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10,
            boxShadow: "0 12px 32px rgba(10,22,40,0.18)", padding: 4,
          }}
        >
          {rest.map((c, i) => cloneElement(c, {
            key: c.key ?? i,
            role: "menuitem",
            children: c.props["data-label"]
              ? <>{c.props.children}<span>{c.props["data-label"]}</span></>
              : c.props.children,
            // Close first, then act: an action that opens a dialog must not
            // leave the menu floating over it.
            onClick: (e) => { setOpen(false); c.props.onClick?.(e); },
            style: {
              ...c.props.style,
              display: "flex", alignItems: "center", gap: 8, width: "100%", height: "auto",
              minHeight: 38, padding: "0.4rem 0.65rem", margin: 0,
              background: "transparent", backgroundColor: "transparent",
              border: "none", borderRadius: 7, boxShadow: "none",
              justifyContent: "flex-start", textAlign: "left", fontSize: "0.82rem",
            },
            onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = colors.inputBg; },
            onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = "transparent"; },
            onFocus: (e) => { e.currentTarget.style.backgroundColor = colors.inputBg; },
            onBlur: (e) => { e.currentTarget.style.backgroundColor = "transparent"; },
          }))}
        </div>,
        document.body,
      )}
    </div>
  );
}
