import { useEffect, useRef, useState } from "react";
import { MdTune } from "react-icons/md";
import "./MoreFilters.css";

/**
 * The secondary filters of a list toolbar, behind one "Filters" button so the
 * toolbar stays on a single line. `active` is how many of them are set; the
 * button shows it. On a phone the filters render inline (the whole filter
 * panel already folds there), so nothing is ever hidden behind two taps.
 */
export default function MoreFilters({ active = 0, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (
        event.type === "keydown"
          ? event.key === "Escape"
          : !ref.current?.contains(event.target) && !event.target.closest?.("[data-floating]")
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="more-filters" ref={ref}>
      <button
        type="button"
        className={`more-filters-btn${active ? " is-active" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MdTune size={16} aria-hidden="true" />
        Filters
        {active > 0 && <span className="more-filters-count">{active}</span>}
      </button>
      <div className={`more-filters-panel${open ? " is-open" : ""}`}>{children}</div>
    </div>
  );
}
