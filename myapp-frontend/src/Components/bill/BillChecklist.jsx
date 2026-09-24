import { MdCheckCircle } from "react-icons/md";
import { billColors } from "./billTheme";

// The box that scrolls this element vertically -- the modal body, on a bill.
function scrollerOf(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

// Jump to the step or line an item is about, and flash it so the eye lands
// there -- on a long bill the target is usually off screen. The modal body is
// scrolled directly: a smooth scrollIntoView inside it was ignored, so the
// link lit up a card nobody could see.
export function jumpToAnchor(target) {
  const el = document.getElementById(target);
  if (!el) return;
  const box = scrollerOf(el);
  if (box) {
    const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTop = Math.max(0, box.scrollTop + delta - Math.max(12, (box.clientHeight - el.offsetHeight) / 2));
  } else {
    el.scrollIntoView({ block: "center" });
  }
  const prev = el.style.boxShadow;
  el.style.boxShadow = `0 0 0 3px ${billColors.warn}66`;
  setTimeout(() => { el.style.boxShadow = prev; }, 1400);
}

/**
 * The footer's "what's left before you can save", beside the save button on
 * every editable bill screen. Items come from utils/billEntry.billChecklist:
 * each one is a link to the step or line it is about. Empty means ready.
 *
 * It replaces three separate one-line footer messages, of which only the first
 * that applied was ever shown -- an operator fixed one thing and met the next.
 */
export default function BillChecklist({ items = [], readyText = "Ready to save", max = 3 }) {
  if (items.length === 0) {
    return (
      <span
        role="status"
        style={{
          display: "inline-flex", alignItems: "center", gap: "0.35rem", marginRight: "auto",
          fontSize: "0.85rem", fontWeight: 600, color: billColors.success,
        }}
      >
        <MdCheckCircle size={18} /> {readyText}
      </span>
    );
  }
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  return (
    <div
      role="status"
      style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem 0.45rem",
        marginRight: "auto", minWidth: 0, flex: "1 1 320px",
      }}
    >
      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: billColors.danger }}>
        {items.length === 1 ? "1 thing to finish:" : `${items.length} things to finish:`}
      </span>
      {shown.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => jumpToAnchor(it.target)}
          title="Show me"
          style={{
            minHeight: 36, padding: "0.3rem 0.65rem", borderRadius: 999,
            border: `1px solid ${billColors.danger}40`, backgroundColor: billColors.dangerLight,
            color: billColors.danger, fontSize: "0.78rem", fontWeight: 600, lineHeight: 1.3,
            textAlign: "left", cursor: "pointer", boxShadow: "none",
          }}
        >
          {it.label}
        </button>
      ))}
      {more > 0 && (
        <span style={{ fontSize: "0.78rem", color: billColors.textSecondary }}>+{more} more</span>
      )}
    </div>
  );
}
