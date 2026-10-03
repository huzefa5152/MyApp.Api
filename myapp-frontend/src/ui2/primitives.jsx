import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MdMoreHoriz } from "react-icons/md";
import { toneForStatus, statusTones } from "../Components/StatusBadge";
import "./ui2.css";

/** One button height, one radius. variant: primary | secondary | teal | ghost | danger. */
export function Btn({ variant = "secondary", icon: Icon, children, className = "", ...rest }) {
  return (
    <button type="button" className={`u2-btn u2-btn--${variant} ${className}`} {...rest}>
      {Icon && <Icon size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Icon-only button. `label` is mandatory: it is the accessible name and the tooltip. */
export function IconBtn({ label, icon: Icon, active, size = 16, large, className = "", children, ...rest }) {
  return (
    <button
      type="button"
      className={`u2-icon-btn${large ? " u2-icon-btn--lg" : ""}${active ? " u2-icon-btn--active" : ""} ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children || (Icon && <Icon size={size} aria-hidden="true" />)}
    </button>
  );
}

/** Breadcrumb + title + subtitle on the left, actions on the right. */
export function PageHeader({ crumbs = [], title, subtitle, actions }) {
  return (
    <header className="u2-page-header">
      <div>
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb">
            <ol className="u2-crumbs">
              {crumbs.map((c, i) => (
                <li key={c} aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c}</li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="u2-title">{title}</h1>
        {subtitle && <p className="u2-sub">{subtitle}</p>}
      </div>
      {actions && <div className="u2-actions">{actions}</div>}
    </header>
  );
}

/** Tinted pill with a dot. Reuses the app's existing status palette so meaning and colours are unchanged. */
export function StatusPill({ status, label, tone }) {
  const palette = statusTones[tone || toneForStatus(status)] || statusTones.neutral;
  return (
    <span className="u2-pill" style={{ background: palette.bg, color: palette.color }}>
      <span style={{ color: palette.color }}>{label ?? status}</span>
    </span>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="u2-state" role="status">
      {Icon && <Icon size={34} className="u2-state__icon" aria-hidden="true" />}
      <p className="u2-state__title">{title}</p>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Placeholder rows shaped like the real table, shown while a list loads. */
export function TableSkeleton({ columns = 7, rows = 6 }) {
  return (
    <div className="u2-grid u2-grid--standalone" role="status" aria-label="Loading">
      <table className="u2-table" aria-hidden="true">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }).map((__, c) => (
                <td key={c}><span className="u2-skel" style={{ width: `${55 + ((r * 7 + c * 13) % 40)}%` }} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Overflow menu for secondary row actions. Fixed-positioned from the trigger so it is never
 * clipped by the table's scroll area; closes on Escape, outside click, scroll or resize;
 * arrow keys move between items.
 *
 * items: [{ key, label, icon, onClick, disabled, danger, title, separatorBefore }]
 */
export function RowMenu({ items, label = "More actions" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const menuH = Math.min(items.length * 34 + 16, 360);
    const below = window.innerHeight - r.bottom;
    const top = below < menuH + 8 && r.top > menuH ? r.top - menuH - 4 : r.bottom + 4;
    setPos({ top, left: Math.max(8, Math.min(r.right - 220, window.innerWidth - 232)) });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (open && pos) menuRef.current?.querySelector("button:not(:disabled)")?.focus();
  }, [open, pos]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const btns = [...menuRef.current.querySelectorAll("button:not(:disabled)")];
    const i = btns.indexOf(document.activeElement);
    btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
  };

  if (!items.length) return null;
  return (
    <span className="u2-menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={`u2-icon-btn${open ? " u2-icon-btn--active" : ""}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MdMoreHoriz size={18} aria-hidden="true" />
      </button>
      {open && pos && (
        <ul ref={menuRef} className="u2-menu" role="menu" style={{ top: pos.top, left: pos.left }} onKeyDown={onKeyDown}>
          {items.map((it) => (
            <li key={it.key} role="none">
              {it.separatorBefore && <div className="u2-menu__sep" role="separator" />}
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                title={it.title}
                className={`u2-menu__item${it.danger ? " u2-menu__item--danger" : ""}`}
                onClick={() => { setOpen(false); it.onClick?.(); }}
              >
                {it.loading ? <span className="u2-spinner" aria-hidden="true" /> : it.icon && <it.icon size={15} aria-hidden="true" />}
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
