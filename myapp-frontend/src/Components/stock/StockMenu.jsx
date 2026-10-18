import { useEffect, useRef, useState } from "react";

// A header dropdown on the Stock page (Export / Tools). Keyboard-accessible:
// the button says it opens a menu and whether it is open, Escape closes and
// hands focus back to the button, a click outside closes, and choosing an
// item closes. Clicks on a non-item (the month box) keep it open.
export default function StockMenu({ label, icon, busy, children }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const btn = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="stk-menuwrap" ref={wrap}>
      <button ref={btn} type="button" className="stk-btn" aria-expanded={open}
        onClick={() => setOpen((v) => !v)} disabled={busy}>
        {icon}{label} <span className="stk-caret" aria-hidden="true">▼</span>
      </button>
      {open && (
        <div className="stk-menu" aria-label={label}
          onClick={(e) => { if (e.target.closest("[role=menuitem]")) setOpen(false); }}>
          {children}
        </div>
      )}
    </div>
  );
}

// One menu entry: a bold title and a one-line explanation.
export function StockMenuItem({ as: Tag = "button", title, hint, ...rest }) {
  return (
    <Tag className="stk-mi" {...(Tag === "button" ? { type: "button" } : {})} {...rest}>
      <b>{title}</b>
      {hint && <span>{hint}</span>}
    </Tag>
  );
}
