import { MdCheck, MdExpandLess, MdExpandMore, MdInfoOutline } from "react-icons/md";
import { billColors, stepTone } from "./billTheme";

/**
 * One numbered step of a bill screen, the same card on New Bill, New Bill (No
 * Challan), Edit and View, so an operator who has learnt one screen has learnt
 * them all.
 *
 *   status  "done"     -- complete: the number becomes a tick
 *           "todo"     -- still to do
 *           "warn"     -- something here stops the save
 *           "optional" -- nothing required
 *           "view"     -- read-only screen
 *   help    one plain-words line saying what to do here, shown when open
 *   onToggle given  -> the header collapses the card, showing `summary`
 *            absent -> always open
 *   notice  shown under the header whether open or not -- for what the
 *           operator must see even with the card folded ("set to SN024
 *           because these goods came in at 25%")
 *
 * `id` is the anchor the footer checklist scrolls to (utils/billEntry
 * BILL_ANCHORS). Overflow stays visible: item and buyer pickers open
 * dropdowns inside these cards.
 */
export default function BillStep({
  id, n, title, summary = null, status = "todo", help = null,
  open = true, onToggle = null, toggleLabel = null, notice = null, children,
}) {
  const tone = stepTone[status] || stepTone.todo;
  const Header = onToggle ? "button" : "div";
  return (
    <section
      id={id}
      style={{
        marginBottom: "0.85rem",
        border: `1px solid ${billColors.cardBorder}`,
        borderLeft: `4px solid ${tone.accent}`,
        borderRadius: 12,
        backgroundColor: "#fff",
        scrollMarginTop: 12,
      }}
    >
      <Header
        {...(onToggle ? { type: "button", onClick: onToggle, "aria-expanded": open } : {})}
        style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.35rem 0.65rem",
          width: "100%", minHeight: 48, padding: "0.6rem 0.9rem", margin: 0,
          border: "none", borderRadius: (open && children) || notice ? "11px 11px 0 0" : 11,
          backgroundColor: tone.tint, boxShadow: "none", textAlign: "left",
          fontFamily: "inherit", cursor: onToggle ? "pointer" : "default",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "grid", placeItems: "center", width: 26, height: 26, flexShrink: 0,
            borderRadius: "50%", backgroundColor: tone.badge, color: "#fff",
            fontSize: "0.8rem", fontWeight: 800,
          }}
        >
          {status === "done" ? <MdCheck size={16} /> : status === "warn" ? "!" : n}
        </span>
        <span style={{ fontSize: "0.95rem", fontWeight: 700, color: billColors.textPrimary, flexShrink: 0 }}>
          {title}
        </span>
        {summary != null && (
          <span
            style={{
              display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.35rem",
              flex: "1 1 220px", minWidth: 0, fontSize: "0.82rem", color: billColors.textPrimary,
            }}
          >
            {summary}
          </span>
        )}
        {summary == null && <span style={{ flex: 1 }} />}
        {tone.pill && (
          <span
            style={{
              padding: "0.1rem 0.5rem", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700,
              color: tone.badge, border: `1px solid ${tone.badge}55`, backgroundColor: "#fff", flexShrink: 0,
            }}
          >
            {tone.pill}
          </span>
        )}
        {onToggle && (
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.2rem", flexShrink: 0,
              color: billColors.blue, fontWeight: 600, fontSize: "0.78rem",
            }}
          >
            {open ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
            {toggleLabel || (open ? "Hide" : "Change")}
          </span>
        )}
      </Header>
      {notice && <div style={{ padding: "0.55rem 0.9rem 0.6rem", borderTop: `1px solid ${billColors.cardBorder}` }}>{notice}</div>}
      {open && children && (
        <div style={{ padding: "0.8rem 0.9rem 0.9rem", borderTop: `1px solid ${billColors.cardBorder}` }}>
          {help && (
            <p
              style={{
                display: "flex", gap: "0.4rem", alignItems: "flex-start", margin: "0 0 0.7rem",
                fontSize: "0.8rem", lineHeight: 1.45, color: billColors.textSecondary,
              }}
            >
              <MdInfoOutline size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{help}</span>
            </p>
          )}
          {children}
        </div>
      )}
    </section>
  );
}
