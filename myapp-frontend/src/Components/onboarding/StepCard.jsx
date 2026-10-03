import { MdCheck, MdExpandMore, MdExpandLess } from "react-icons/md";

// A numbered step of a guided screen. `status`:
//   "active"  — the step the operator is on (open, blue number)
//   "done"    — finished; folds to its title and `summary`, with a tick
//   "waiting" — not reachable yet (folded, greyed)
// A done step can be reopened with `onToggle`, so an earlier choice stays
// visible and changeable instead of disappearing.
// Built on the kit card surface (`k-card`) so it follows the Classic / Workspace tokens.
export default function StepCard({ number, title, help, status = "active", summary, open, onToggle, children, id }) {
  const isOpen = open ?? status === "active";
  const done = status === "done";
  const waiting = status === "waiting";
  const canToggle = !!onToggle && !waiting;

  return (
    <section id={id} className="k-card" style={{ ...st.card, ...(status === "active" ? st.cardActive : null), ...(waiting ? st.cardWaiting : null) }}
      aria-labelledby={id ? `${id}-title` : undefined}>
      <header
        style={{ ...st.head, cursor: canToggle ? "pointer" : "default" }}
        onClick={canToggle ? onToggle : undefined}
        role={canToggle ? "button" : undefined}
        tabIndex={canToggle ? 0 : undefined}
        aria-expanded={canToggle ? isOpen : undefined}
        onKeyDown={canToggle ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
      >
        <span style={{ ...st.badge, ...(done ? st.badgeDone : waiting ? st.badgeWaiting : null) }} aria-hidden="true">
          {done ? <MdCheck size={18} /> : number}
        </span>
        <span style={st.titles}>
          <span id={id ? `${id}-title` : undefined} style={st.title}>{title}</span>
          {!isOpen && done && summary && <span style={st.summary}>{summary}</span>}
          {isOpen && help && <span style={st.help}>{help}</span>}
        </span>
        {canToggle && (
          <span style={st.chevron} aria-hidden="true">
            {isOpen ? <MdExpandLess size={22} /> : <MdExpandMore size={22} />}
          </span>
        )}
      </header>
      {isOpen && !waiting && <div style={st.body}>{children}</div>}
    </section>
  );
}

const st = {
  // marginTop: 0 — the parent stacks steps with its own gap; cancel the kit's `.k-card + .k-card` margin.
  card: { overflow: "hidden", marginTop: 0 },
  cardActive: { borderColor: "#90caf9", boxShadow: "0 0 0 1px #90caf9, 0 6px 18px rgba(13,71,161,0.08)" },
  cardWaiting: { opacity: 0.6 },
  head: { display: "flex", alignItems: "center", gap: "0.8rem", padding: "calc(var(--k-gap) * 0.72) 1rem", minHeight: 44 },
  badge: { width: "calc(var(--k-h) - 8px)", height: "calc(var(--k-h) - 8px)", flexShrink: 0, display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--k-blue)", color: "#fff", fontWeight: 800, fontSize: "var(--k-font)" },
  badgeDone: { background: "var(--k-teal)" },
  badgeWaiting: { background: "#b0bec5" },
  titles: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 },
  title: { fontSize: "calc(var(--k-font) + 0.1rem)", fontWeight: 800, color: "var(--k-ink)" },
  summary: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  help: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  chevron: { width: 44, height: 44, display: "grid", placeItems: "center", color: "var(--k-muted)", flexShrink: 0 },
  body: { padding: "0 1rem 1rem" },
};
