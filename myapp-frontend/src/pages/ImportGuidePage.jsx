import { MdMenuBook } from "react-icons/md";
import { colors } from "../theme";

/**
 * In-app guide for the GD import costing feature (Purchases → Import
 * Costing). Written for a non-technical accounts person: plain English,
 * real navigation paths spelled out, no jargon left unexplained.
 *
 * No permission gate, deliberately: this is help content with no data and
 * no API call, visible to every signed-in user — the same reasoning as the
 * Accounting Guide at /help/accounting.
 */

const WORKBOOK_COLUMNS = [
  "GD Num", "GD Date", "Description", "Qty", "Unit", "HS Code",
  "Assessed Value", "C.Duty", "ACD", "RD", "Sales tax rate", "AST rate",
  "Others", "Income tax rate", "Add On Profit", "Selling Value",
];

const GLOSSARY = [
  ["GD", "Goods Declaration — the customs paperwork for one shipment. Its number ties a consignment's rows together."],
  ["Assessed Value", "What customs says the goods are worth, in rupees, before any duty is added."],
  ["C.Duty / ACD / RD", "Customs Duty, Additional Customs Duty and Regulatory Duty — the duties charged on import."],
  ["Actual cost", "Assessed value plus the duties above. Sales tax, additional sales tax and income tax at import are NOT included — they are recoverable, so they are not part of what the stock cost."],
  ["Selling value", "The value the sheet works out this stock should be sold at, once its input tax has been absorbed. Shown next to Actual cost so margin can be compared."],
  ["Margin", "Selling value minus Actual cost. It can be negative — that is a real number, not an error."],
  ["“cost-only”", "This line matched existing stock and only its cost was written. The good, ordinary case."],
  ["“not matched”", "No stock is on the books yet for this line's GD and HS code. Nothing is written for it in this release."],
  ["“ambiguous”", "The line's HS code matches more than one item already on the books. The system will not guess — it is left for a person to resolve."],
];

const st = {
  page: { padding: "1.25rem", maxWidth: 880, margin: "0 auto" },
  header: { marginBottom: "0.75rem" },
  h1: { margin: 0, fontSize: "1.4rem", fontWeight: 800, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 10 },
  subtitle: { marginTop: "0.45rem", color: colors.textSecondary, fontSize: "0.92rem", lineHeight: 1.65, maxWidth: "64ch" },

  toc: { display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "1rem 0 1.5rem" },
  tocLink: {
    display: "inline-flex", alignItems: "center", minHeight: 36, padding: "0.4rem 0.85rem",
    borderRadius: 999, border: `1px solid ${colors.inputBorder}`, background: colors.cardBg,
    color: colors.textPrimary, fontSize: "0.8rem", fontWeight: 600, textDecoration: "none",
  },

  section: {
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12,
    padding: "1.15rem 1.3rem", marginBottom: "1.1rem", scrollMarginTop: "1rem",
  },
  h2: { margin: "0 0 0.8rem", fontSize: "1.08rem", fontWeight: 800, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 10 },
  sectionNum: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26,
    borderRadius: "50%", background: colors.blue, color: "#fff", fontSize: "0.78rem", fontWeight: 800, flexShrink: 0,
  },

  p: { margin: "0 0 0.85rem", color: colors.textPrimary, fontSize: "0.92rem", lineHeight: 1.65 },
  ol: { margin: "0 0 0.9rem", paddingLeft: "1.3rem", color: colors.textPrimary, fontSize: "0.92rem", lineHeight: 1.75 },
  li: { marginBottom: "0.4rem" },

  path: {
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", margin: "0 0 0.9rem",
    padding: "0.6rem 0.75rem", background: colors.inputBg, borderLeft: `3px solid ${colors.blue}`, borderRadius: 8,
  },
  pathLabel: { color: colors.textSecondary, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" },
  pathCode: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.88rem", fontWeight: 700, color: colors.textPrimary },

  columnsGrid: {
    display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
    margin: "0 0 0.9rem",
  },
  columnChip: {
    padding: "0.55rem 0.7rem", borderRadius: 8, background: colors.inputBg,
    border: `1px solid ${colors.inputBorder}`, fontSize: "0.82rem", color: colors.textPrimary,
    fontWeight: 600, minHeight: 44, display: "flex", alignItems: "center",
  },

  note: {
    margin: "0 0 0.9rem", padding: "0.7rem 0.85rem", background: colors.inputBg,
    border: `1px solid ${colors.inputBorder}`, borderRadius: 8, color: colors.textPrimary,
    fontSize: "0.87rem", lineHeight: 1.6,
  },
  warn: {
    margin: "0 0 0.9rem", padding: "0.7rem 0.85rem", background: "rgba(217,119,6,0.09)",
    border: "1px solid rgba(217,119,6,0.35)", borderRadius: 8, color: colors.textPrimary,
    fontSize: "0.87rem", lineHeight: 1.6,
  },

  tableScroll: { overflowX: "auto", marginBottom: "0.4rem" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.86rem", minWidth: 480 },
  th: {
    padding: "0.5rem 0.6rem", borderBottom: `2px solid ${colors.inputBorder}`, color: colors.textSecondary,
    fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em",
    textAlign: "left", whiteSpace: "nowrap",
  },
  td: { padding: "0.55rem 0.6rem", borderBottom: `1px solid ${colors.inputBorder}`, color: colors.textPrimary, lineHeight: 1.55, verticalAlign: "top" },

  qa: { margin: "0 0 1.1rem" },
  q: { fontWeight: 700, color: colors.textPrimary, fontSize: "0.92rem", marginBottom: "0.3rem" },
  a: { color: colors.textSecondary, fontSize: "0.9rem", lineHeight: 1.6, margin: 0 },
};

function PathPill({ children }) {
  return (
    <div style={st.path}>
      <span style={st.pathLabel}>Go to</span>
      <code style={st.pathCode}>{children}</code>
    </div>
  );
}

const SECTIONS = [
  { id: "what-it-does", short: "1. What this does" },
  { id: "before-you-start", short: "2. Before you start" },
  { id: "step-by-step", short: "3. Step by step" },
  { id: "the-result", short: "4. The result" },
  { id: "fix-by-hand", short: "5. Fixing by hand" },
  { id: "glossary", short: "6. What the words mean" },
  { id: "faq", short: "7. Common questions" },
];

export default function ImportGuidePage() {
  return (
    <div style={st.page}>
      <header style={st.header}>
        <h1 style={st.h1}><MdMenuBook size={24} aria-hidden="true" /> Import Costing Guide</h1>
        <p style={st.subtitle}>
          How to load the actual cost of your stock from a customs GD costing workbook, and
          where to see what it changed. Written for anyone in accounts — no technical
          background needed.
        </p>
      </header>

      <nav style={st.toc} aria-label="On this page">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} style={st.tocLink}>{s.short}</a>
        ))}
      </nav>

      <section id="what-it-does" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>1</span> What this does</h2>
        <p style={st.p}>
          Your stock already carries a <strong>selling value</strong> — what it is worth if
          sold. The costing sheet tells the system what that same stock actually{" "}
          <strong>cost</strong> to bring in, so you can finally see the <strong>margin</strong>{" "}
          on it, not just the sales price.
        </p>
      </section>

      <section id="before-you-start" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>2</span> Before you start: the workbook</h2>
        <p style={st.p}>
          One row per consignment line. Your file needs these columns somewhere on the sheet:
        </p>
        <div style={st.columnsGrid}>
          {WORKBOOK_COLUMNS.map((c) => <div key={c} style={st.columnChip}>{c}</div>)}
        </div>
        <p style={st.p}>
          The system reads the sheet's own heading row, so these columns do <strong>not</strong>{" "}
          need to be in any fixed order — three different real workbook layouts already import
          with no setup at all.
        </p>
        <p style={st.p}>
          A rate can be written as <strong>0.18</strong>, <strong>18%</strong> or plain{" "}
          <strong>18</strong> — all three are understood the same way.
        </p>
        <p style={st.p}>
          A <strong>"Total"</strong> row at the end of a GD's rows is recognised for what it is
          and skipped, rather than imported as a product.
        </p>
      </section>

      <section id="step-by-step" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>3</span> Step by step</h2>
        <PathPill>Purchases &#9656; Import Costing</PathPill>
        <ol style={st.ol}>
          <li style={st.li}>Pick the company at the top of the page.</li>
          <li style={st.li}>Choose the workbook and press <strong>Preview</strong>.</li>
          <li style={st.li}>Read the summary bar and any warnings underneath it.</li>
          <li style={st.li}>
            Check the table, especially any line marked <em>not matched</em> or <em>ambiguous</em>.
          </li>
          <li style={st.li}>Press <strong>Commit</strong>.</li>
        </ol>
        <div style={st.note}>
          <strong>Nothing is written until you press Commit.</strong> Preview never changes
          anything — read it, check it, and only then commit.
        </div>
      </section>

      <section id="the-result" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>4</span> What the result looks like</h2>
        <PathPill>Dashboards &#9656; Inventory &#9656; Opening Balances</PathPill>
        <p style={st.p}>
          The <strong>Actual cost</strong> and <strong>Margin</strong> columns are now filled in
          for every item the sheet matched.
        </p>
        <p style={st.p}>
          Margin can show as a negative number — that is real, not a mistake, when an item is
          priced below what it cost. Margin % shows a dash (—) for an item that has no selling
          value yet.
        </p>
      </section>

      <section id="fix-by-hand" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>5</span> Fixing a figure by hand</h2>
        <PathPill>Dashboards &#9656; Inventory &#9656; Opening Balances</PathPill>
        <p style={st.p}>
          On the same screen, edit the row and type a new value into <strong>Actual cost</strong>.
        </p>
        <div style={st.warn}>
          <strong>Careful — </strong>leaving the box <strong>empty</strong> keeps whatever cost
          is already stored. Typing <strong>0</strong> clears it.
        </div>
      </section>

      <section id="glossary" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>6</span> What the words mean</h2>
        <div style={st.tableScroll}>
          <table style={st.table}>
            <thead>
              <tr><th style={st.th}>Term</th><th style={st.th}>Meaning</th></tr>
            </thead>
            <tbody>
              {GLOSSARY.map(([term, meaning]) => (
                <tr key={term}>
                  <td style={{ ...st.td, fontWeight: 700, whiteSpace: "nowrap" }}>{term}</td>
                  <td style={st.td}>{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="faq" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>7</span> Common questions</h2>

        <div style={st.qa}>
          <p style={st.q}>Why is a line "not matched"?</p>
          <p style={st.a}>There is no stock on the books yet for that line's GD number and HS code.</p>
        </div>

        <div style={st.qa}>
          <p style={st.q}>Why is a line "ambiguous"?</p>
          <p style={st.a}>Its HS code matches more than one item already on the books, and the system will not guess which one — it is left for a person to sort out.</p>
        </div>

        <div style={st.qa}>
          <p style={st.q}>Can I run the same file twice?</p>
          <p style={st.a}>Yes — it sets the same figures again, it does not add them up. An identical file that has already been imported is refused as a duplicate, so nothing doubles by accident.</p>
        </div>

        <div style={st.qa}>
          <p style={st.q}>Does this change my selling prices, or anything I file with FBR?</p>
          <p style={st.a}>No. Actual cost is internal only — it does not touch selling prices, invoices, or anything submitted to FBR.</p>
        </div>
      </section>
    </div>
  );
}
