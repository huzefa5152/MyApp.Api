import { useMemo, useState } from "react";
import { MdSearch, MdMenuBook, MdClose } from "react-icons/md";
import { colors, formStyles } from "../theme";
import { GUIDE_SECTIONS, GUIDE_GROUPS } from "../content/accountingGuide";
import useIsNarrow from "../hooks/useIsNarrow";

/**
 * In-app accounting guide. Content lives in content/accountingGuide.js; this
 * file only renders it, so the guide can be corrected without touching layout.
 *
 * No permission gate: it explains the product and reveals nothing about the
 * company's data. Search matches section titles and body text so an operator
 * can type "electricity" or "advance" and land on the right procedure.
 */
export default function UserGuidePage() {
  const [active, setActive] = useState(GUIDE_SECTIONS[0].id);
  const [query, setQuery] = useState("");
  const isNarrow = useIsNarrow();
  const [navOpen, setNavOpen] = useState(false);

  // Flatten each section's blocks to plain text once, so searching is a
  // substring test rather than a walk of the block tree on every keystroke.
  const haystack = useMemo(() => {
    const out = {};
    for (const s of GUIDE_SECTIONS) out[s.id] = textOf(s).toLowerCase();
    return out;
  }, []);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (!q ? null : GUIDE_SECTIONS.filter((s) => haystack[s.id].includes(q))),
    [q, haystack]
  );

  const section = GUIDE_SECTIONS.find((s) => s.id === active) || GUIDE_SECTIONS[0];
  const shown = matches || GUIDE_SECTIONS;

  const pick = (id) => { setActive(id); setNavOpen(false); };

  const nav = (
    <nav style={{ ...st.nav, ...(isNarrow ? st.navNarrow : null) }}>
      <div style={st.searchWrap}>
        <MdSearch size={17} style={st.searchIcon} />
        <input
          style={st.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the guide…"
        />
        {query && (
          <button style={st.searchClear} onClick={() => setQuery("")} aria-label="Clear search">
            <MdClose size={15} />
          </button>
        )}
      </div>

      {matches && (
        <div style={st.matchCount}>
          {matches.length === 0 ? "Nothing found" : `${matches.length} section${matches.length === 1 ? "" : "s"}`}
        </div>
      )}

      {GUIDE_GROUPS.map((group) => {
        const items = shown.filter((s) => s.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} style={st.navGroup}>
            <div style={st.navGroupTitle}>{group}</div>
            {items.map((s) => (
              <button
                key={s.id}
                onClick={() => pick(s.id)}
                style={{ ...st.navItem, ...(s.id === active ? st.navItemActive : null) }}
              >
                {s.title}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div style={st.page}>
      <div style={st.header}>
        <div>
          <h2 style={st.h2}><MdMenuBook size={22} style={{ verticalAlign: "-4px", marginRight: 8 }} />Accounting Guide</h2>
          <div style={st.subtitle}>
            How to record what happens in your business — written for business owners, not accountants.
          </div>
        </div>
        {isNarrow && (
          <button style={st.navToggle} onClick={() => setNavOpen((v) => !v)}>
            {navOpen ? "Hide contents" : "Contents"}
          </button>
        )}
      </div>

      <div style={{ ...st.layout, ...(isNarrow ? st.layoutNarrow : null) }}>
        {(!isNarrow || navOpen) && nav}
        <article style={st.article}>
          <div style={st.articleGroup}>{section.group}</div>
          <h3 style={st.articleTitle}>{section.title}</h3>
          {section.blocks.map((b, i) => <Block key={i} block={b} />)}

          <div style={st.pager}>
            {prevOf(section) && (
              <button style={st.pagerBtn} onClick={() => pick(prevOf(section).id)}>
                ← {prevOf(section).title}
              </button>
            )}
            {nextOf(section) && (
              <button style={{ ...st.pagerBtn, marginLeft: "auto" }} onClick={() => pick(nextOf(section).id)}>
                {nextOf(section).title} →
              </button>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}

/** One content block. Keep this in step with the block types documented in
 *  content/accountingGuide.js. */
function Block({ block: b }) {
  if (b.p) return <p style={st.p}>{bold(b.p)}</p>;

  if (b.path) {
    return (
      <div style={st.path}>
        <span style={st.pathLabel}>Go to</span>
        <code style={st.pathCode}>{b.path}</code>
      </div>
    );
  }

  if (b.steps) {
    return (
      <ol style={st.ol}>
        {b.steps.map((s, i) => <li key={i} style={st.li}>{bold(s)}</li>)}
      </ol>
    );
  }

  if (b.bullets) {
    return (
      <ul style={st.ul}>
        {b.bullets.map((s, i) => <li key={i} style={st.li}>{bold(s)}</li>)}
      </ul>
    );
  }

  if (b.note) return <div style={st.note}><strong>Note </strong>{bold(b.note)}</div>;
  if (b.warn) return <div style={st.warn}><strong>Careful </strong>{bold(b.warn)}</div>;

  if (b.table) {
    return (
      <div style={st.tableScroll}>
        <table style={st.table}>
          <thead>
            <tr>{b.table.head.map((h, i) => <th key={i} style={st.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {b.table.rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j} style={st.td}>{bold(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (b.entry) {
    return (
      <div style={st.entry}>
        <div style={st.entryTitle}>{b.entry.title}</div>
        <div style={st.tableScroll}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Account</th>
                <th style={{ ...st.th, textAlign: "right" }}>Debit</th>
                <th style={{ ...st.th, textAlign: "right" }}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {b.entry.lines.map((l, i) => (
                <tr key={i}>
                  <td style={st.td}>{l.account}</td>
                  <td style={{ ...st.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.debit}</td>
                  <td style={{ ...st.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.credit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {b.entry.foot && <div style={st.entryFoot}>{b.entry.foot}</div>}
      </div>
    );
  }

  if (b.flow) {
    return (
      <div style={st.flow}>
        {b.flow.map((s, i) => (
          <div key={i}>
            <div style={i === 0 ? st.flowStart : st.flowStep}>{s}</div>
            {i < b.flow.length - 1 && <div style={st.flowArrow}>↓</div>}
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** **bold** → <strong>. Deliberately minimal: the guide is prose, not markdown. */
function bold(text) {
  if (typeof text !== "string" || !text.includes("**")) return text;
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

/** Every word in a section, for search. */
function textOf(section) {
  const parts = [section.title, section.group];
  for (const b of section.blocks) {
    if (b.p) parts.push(b.p);
    if (b.path) parts.push(b.path);
    if (b.note) parts.push(b.note);
    if (b.warn) parts.push(b.warn);
    if (b.steps) parts.push(...b.steps);
    if (b.bullets) parts.push(...b.bullets);
    if (b.flow) parts.push(...b.flow);
    if (b.table) { parts.push(...b.table.head); b.table.rows.forEach((r) => parts.push(...r)); }
    if (b.entry) {
      parts.push(b.entry.title, b.entry.foot || "");
      b.entry.lines.forEach((l) => parts.push(l.account));
    }
  }
  return parts.join(" ");
}

const idx = (s) => GUIDE_SECTIONS.findIndex((x) => x.id === s.id);
const prevOf = (s) => GUIDE_SECTIONS[idx(s) - 1];
const nextOf = (s) => GUIDE_SECTIONS[idx(s) + 1];

// ── styles ──────────────────────────────────────────────────────────────────

const st = {
  page: { padding: "1.25rem" },
  header: { display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1rem" },
  h2: { margin: 0, fontSize: "1.35rem", fontWeight: 800, color: colors.textPrimary },
  subtitle: { marginTop: "0.25rem", color: colors.textSecondary, fontSize: "0.88rem", maxWidth: 620 },
  navToggle: { minHeight: 44, padding: "0.5rem 0.9rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, background: colors.cardBg, color: colors.textPrimary, fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" },

  layout: { display: "grid", gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)", gap: "1.25rem", alignItems: "start" },
  layoutNarrow: { gridTemplateColumns: "minmax(0, 1fr)" },

  nav: { position: "sticky", top: "1rem", maxHeight: "calc(100vh - 3rem)", overflowY: "auto", background: colors.cardBg, border: `1px solid ${colors.inputBorder}`, borderRadius: 12, padding: "0.75rem" },
  navNarrow: { position: "static", maxHeight: "none" },
  searchWrap: { position: "relative", marginBottom: "0.6rem" },
  searchIcon: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.textSecondary, pointerEvents: "none" },
  search: { width: "100%", minHeight: 40, padding: "0.45rem 2rem 0.45rem 2rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, background: colors.inputBg, color: colors.textPrimary, fontSize: "0.85rem" },
  searchClear: { position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", display: "grid", placeItems: "center", width: 26, height: 26, border: "none", borderRadius: 6, background: "transparent", color: colors.textSecondary, cursor: "pointer" },
  matchCount: { padding: "0 0.35rem 0.5rem", color: colors.textSecondary, fontSize: "0.75rem" },

  navGroup: { marginBottom: "0.6rem" },
  navGroupTitle: { padding: "0.35rem", color: colors.textSecondary, fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" },
  navItem: { display: "block", width: "100%", minHeight: 36, padding: "0.4rem 0.5rem", border: "none", borderRadius: 7, background: "transparent", color: colors.textPrimary, fontSize: "0.84rem", textAlign: "left", cursor: "pointer", lineHeight: 1.35 },
  navItemActive: { background: colors.blue, color: "#fff", fontWeight: 700 },

  article: { minWidth: 0, background: colors.cardBg, border: `1px solid ${colors.inputBorder}`, borderRadius: 12, padding: "1.25rem" },
  articleGroup: { color: colors.textSecondary, fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" },
  articleTitle: { margin: "0.3rem 0 1rem", fontSize: "1.2rem", fontWeight: 800, color: colors.textPrimary },

  p: { margin: "0 0 0.85rem", color: colors.textPrimary, fontSize: "0.92rem", lineHeight: 1.65 },
  ol: { margin: "0 0 0.95rem", paddingLeft: "1.35rem", color: colors.textPrimary, fontSize: "0.92rem", lineHeight: 1.7 },
  ul: { margin: "0 0 0.95rem", paddingLeft: "1.2rem", color: colors.textPrimary, fontSize: "0.92rem", lineHeight: 1.7 },
  li: { marginBottom: "0.3rem" },

  path: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", margin: "0 0 0.95rem", padding: "0.6rem 0.75rem", background: colors.inputBg, borderLeft: `3px solid ${colors.blue}`, borderRadius: 8 },
  pathLabel: { color: colors.textSecondary, fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" },
  pathCode: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.86rem", fontWeight: 700, color: colors.textPrimary },

  note: { margin: "0 0 0.95rem", padding: "0.7rem 0.85rem", background: colors.inputBg, border: `1px solid ${colors.inputBorder}`, borderRadius: 8, color: colors.textPrimary, fontSize: "0.87rem", lineHeight: 1.6 },
  warn: { margin: "0 0 0.95rem", padding: "0.7rem 0.85rem", background: "rgba(217,119,6,0.09)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 8, color: colors.textPrimary, fontSize: "0.87rem", lineHeight: 1.6 },

  tableScroll: { overflowX: "auto", marginBottom: "0.95rem" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.86rem", minWidth: 420 },
  th: { padding: "0.5rem 0.6rem", borderBottom: `2px solid ${colors.inputBorder}`, color: colors.textSecondary, fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", whiteSpace: "nowrap" },
  td: { padding: "0.5rem 0.6rem", borderBottom: `1px solid ${colors.inputBorder}`, color: colors.textPrimary, lineHeight: 1.5, verticalAlign: "top" },

  entry: { margin: "0 0 1rem", padding: "0.85rem", background: colors.inputBg, border: `1px solid ${colors.inputBorder}`, borderRadius: 10 },
  entryTitle: { marginBottom: "0.5rem", fontSize: "0.8rem", fontWeight: 800, color: colors.blue, textTransform: "uppercase", letterSpacing: "0.04em" },
  entryFoot: { color: colors.textSecondary, fontSize: "0.83rem", lineHeight: 1.6 },

  flow: { margin: "0 0 1rem" },
  flowStart: { display: "inline-block", padding: "0.45rem 0.85rem", background: colors.blue, color: "#fff", borderRadius: 8, fontSize: "0.86rem", fontWeight: 700 },
  flowStep: { display: "inline-block", padding: "0.45rem 0.85rem", background: colors.cardBg, border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: "0.86rem", color: colors.textPrimary },
  flowArrow: { padding: "0.15rem 0 0.15rem 1rem", color: colors.textSecondary, fontSize: "1rem", lineHeight: 1 },

  pager: { display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1.5rem", paddingTop: "1rem", borderTop: `1px solid ${colors.inputBorder}` },
  pagerBtn: { minHeight: 44, padding: "0.5rem 0.85rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, background: "transparent", color: colors.blue, fontSize: "0.83rem", fontWeight: 600, cursor: "pointer", textAlign: "left" },
};
