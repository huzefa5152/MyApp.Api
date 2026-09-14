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

  h3: { margin: "1.1rem 0 0.6rem", fontSize: "0.95rem", fontWeight: 800, color: colors.textPrimary },
  p: { margin: "0 0 0.85rem", color: colors.textPrimary, fontSize: "0.92rem", lineHeight: 1.65 },
  ol: { margin: "0 0 0.9rem", paddingLeft: "1.3rem", color: colors.textPrimary, fontSize: "0.92rem", lineHeight: 1.75 },
  ul: { margin: "0 0 0.9rem", paddingLeft: "1.3rem", color: colors.textPrimary, fontSize: "0.92rem", lineHeight: 1.75 },
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

  modesGrid: {
    display: "grid", gap: "0.75rem", margin: "0.2rem 0 0.9rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
  },
  modeCard: {
    padding: "0.85rem 0.95rem", borderRadius: 10, background: colors.inputBg,
    border: `1px solid ${colors.inputBorder}`, display: "flex", flexDirection: "column", gap: "0.35rem",
  },
  modeBadge: {
    display: "inline-flex", alignSelf: "flex-start", padding: "0.2rem 0.6rem", borderRadius: 999,
    background: colors.blue, color: "#fff", fontSize: "0.66rem", fontWeight: 800,
    textTransform: "uppercase", letterSpacing: "0.05em",
  },
  modeTitle: { margin: 0, fontSize: "0.94rem", fontWeight: 800, color: colors.textPrimary },
  modeText: { margin: 0, fontSize: "0.87rem", lineHeight: 1.6, color: colors.textPrimary },
  modeUse: { margin: 0, fontSize: "0.8rem", lineHeight: 1.5, color: colors.textSecondary, fontStyle: "italic" },

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
  { id: "import-modes", short: "3. Choosing the mode" },
  { id: "step-by-step", short: "4. Step by step" },
  { id: "the-result", short: "5. The result" },
  { id: "warnings", short: "6. What the warnings mean" },
  { id: "fix-by-hand", short: "7. Fixing a figure" },
  { id: "the-books", short: "8. Where this hits the books" },
  { id: "paying-a-gd", short: "9. Paying a GD" },
  { id: "cost-history", short: "10. Cost history" },
  { id: "glossary", short: "11. What the words mean" },
  { id: "faq", short: "12. Common questions" },
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

      <section id="import-modes" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>3</span> Choosing the import mode</h2>
        <p style={st.p}>
          Next to the file picker is a choice of two modes, and it is the single most
          important setting on the screen — it decides what a matching line actually does.
        </p>

        <div style={st.modesGrid}>
          <div style={st.modeCard}>
            <span style={st.modeBadge}>Default</span>
            <p style={st.modeTitle}>"These goods are already on the books"</p>
            <p style={st.modeText}>
              A matched line <strong>sets</strong> the actual cost to the GD's unit cost
              multiplied by the quantity already on the books. Quantity is not changed.
            </p>
            <p style={st.modeUse}>Use for the one-off backfill of history.</p>
          </div>
          <div style={st.modeCard}>
            <p style={st.modeTitle}>"These are new arrivals"</p>
            <p style={st.modeText}>
              A matched line <strong>adds</strong> its quantity, actual cost and selling value
              to what is on the books, so the cost per unit becomes a weighted average across
              consignments.
            </p>
            <p style={st.modeUse}>Use for every monthly GD.</p>
          </div>
        </div>

        <div style={st.warn}>
          <strong>Why you have to choose — the failure is silent.</strong> Say an item was
          imported last month, so it already has a balance on the books, and this month's line
          matches it again. In backfill mode, that match <strong>overwrites</strong> the cost
          with this month's rate applied to last month's quantity — the units that actually
          arrived this month never appear on the books, and nothing on screen says so. Picking
          the mode that matches what the file really is — history being backfilled, or stock
          that just landed — is what stops that from happening.
        </div>

        <p style={st.p}>
          A line that matches nothing at all is a separate choice again: ticking{" "}
          <strong>"bring the unmatched lines in as new stock"</strong> creates an item type
          from the sheet's own name and HS code, then an opening balance for it. An item type
          already on the books is reused only when its <strong>HS code and its name both
          match</strong> — one HS code can genuinely cover several different products, so the
          name is what tells them apart.
        </p>
      </section>

      <section id="step-by-step" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>4</span> Step by step</h2>
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
        <h2 style={st.h2}><span style={st.sectionNum}>5</span> What the result looks like</h2>
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

      <section id="warnings" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>6</span> What the warnings mean</h2>

        <p style={st.p}>
          The preview can flag three things. <strong>None of them stops you importing</strong> —
          each one shows its figures so you can decide. Read them before pressing Commit.
        </p>

        <h3 style={st.h3}>"This balance already carries an actual cost"</h3>
        <p style={st.p}>
          An earlier GD already priced this item, and a backfill would <strong>replace</strong>{" "}
          that figure. If these are additional goods rather than a correction, switch to{" "}
          <strong>"These are new arrivals"</strong>.
        </p>

        <h3 style={st.h3}>"This would cost X more than its selling value implies"</h3>
        <p style={st.p}>
          The most important one. A backfill takes the GD's cost <em>per unit</em> and applies it
          to <em>everything</em> you hold of that item. That is right when the goods on the
          declaration are the same goods on the books — and wrong when they are not.
        </p>
        <p style={st.p}>
          It went wrong once, on a real import: one HS code held four different rechargeable
          lights, torch lights at 172 a unit next to vanity mirrors at 746. The declarations
          priced only two of them, so 2,080 torch lights were costed at three times their
          worth and the item showed a margin of −85%.
        </p>
        <p style={st.p}>
          The warning tells you <strong>how much of the item that GD actually covers</strong>{" "}
          and, if the stock sheet merged several products under one code,{" "}
          <strong>how many</strong>. That second number is the useful one: it means the real
          answer is to split the item into separate items, not to retype a cost.
        </p>
        <div style={st.warn}>
          It compares the cost against what your <strong>selling value</strong> says it should
          be. That works because on these books the selling value comes from the costing sheet
          itself. If you ever price at a genuine markup instead, expect this to fire and be
          wrong — which is exactly why it warns rather than blocks. It never appears on a{" "}
          <strong>new arrivals</strong> import, because that mode adds cost only for the
          quantity actually arriving, so there is nothing to stretch.
        </div>

        <h3 style={st.h3}>"Rate looks misread: income tax 100%"</h3>
        <p style={st.p}>
          A cell holding just <strong>1</strong> cannot be told apart from a fraction, so it
          reads as 100%. Two lines of a real sheet meant 1% and got 100%. Write 1% as{" "}
          <strong>0.01</strong>, or type it as the text <strong>1%</strong>.
        </p>
        <p style={st.p}>
          Cost and selling value are not affected by an income-tax rate, so nothing you sell
          changes. It matters if that GD is ever imported as new arrivals, because the same
          rate decides what gets posted to Advance Income Tax on Imports.
        </p>
      </section>

      <section id="fix-by-hand" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>7</span> Fixing a figure</h2>

        <h3 style={st.h3}>Type a cost straight onto an item</h3>
        <PathPill>Dashboards &#9656; Inventory &#9656; Opening Balances</PathPill>
        <p style={st.p}>
          Edit the row and type a new value into <strong>Actual cost</strong>.
        </p>
        <div style={st.warn}>
          <strong>Careful — </strong>leaving the box <strong>empty</strong> keeps whatever cost
          is already stored. Typing <strong>0</strong> clears it.
        </div>

        <h3 style={st.h3}>Enter a GD by hand, with all its lines</h3>
        <PathPill>Purchases &#9656; Import Costing &#9656; Enter a line by hand</PathPill>
        <p style={st.p}>
          For a declaration you have no workbook for. A real GD carries several HS codes, so
          this takes as many lines as you need:
        </p>
        <ol style={st.ol}>
          <li style={st.li}>Type the <strong>GD number and date once</strong> — they belong to the whole consignment.</li>
          <li style={st.li}>Fill in a line and press <strong>Add line</strong>. The GD header, the unit and the three rates carry over to the next one; the product fields clear.</li>
          <li style={st.li}>Repeat for each line. Edit or remove any of them before previewing.</li>
          <li style={st.li}>Press <strong>Preview</strong>. It checks them all together.</li>
        </ol>
        <p style={st.p}>
          Together is the point: two lines landing on the same item have to be combined into
          one cost per unit, and checking them one at a time would treat each as if it were
          the only one. For a single-line GD you can skip Add and just press Preview.
        </p>
        <div style={st.warn}>
          <strong>You cannot add a line to a GD you have already committed.</strong> A GD number
          can only be recorded once. Either correct an existing line (below), or delete the
          consignment from <strong>Purchases &#9656; Consignments</strong> and enter it again.
        </div>

        <h3 style={st.h3}>Correct one line of a GD you already imported</h3>
        <PathPill>Purchases &#9656; Consignments &#9656; expand the GD &#9656; the pencil on the line</PathPill>
        <p style={st.p}>
          Use this when one row of an otherwise-correct sheet had a duty or a rate typed
          wrong. You edit the <strong>costing figures</strong> — quantity, assessed value,
          the duties, the three rates, add-on profit — and the system does the rest: it
          recalculates the cost and selling value itself, moves the item's stored figures,
          and re-posts the GD's journal entry so the amount owed matches the correction.
        </p>
        <p style={st.p}>
          Say why in the <strong>Why</strong> box. It is kept in the cost history (section 10),
          which is what makes the change answerable in three months' time.
        </p>
        <div style={st.warn}>
          <strong>What it will not change: which item the line belongs to.</strong> Moving a
          line onto a different item means taking stock off one item and putting it on
          another, which is a bigger operation than a correction — delete the consignment and
          re-import the sheet for that. The dialog says so too.
          <p style={{ ...st.p, margin: "0.6rem 0 0" }}>
            Two corrections are refused outright, and nothing is changed when they are:
            one that would take an item's quantity, cost or value <strong>below zero</strong>
            (something else has already used up what this line brought in), and one that would
            drop the amount owed on the GD <strong>below what you have already paid</strong>
            against it. For the second, reduce or cancel the payment first.
          </p>
        </div>
      </section>

      <section id="the-books" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>8</span> Where this hits the books</h2>

        <div style={st.warn}>
          <strong>A New Arrivals import DOES post to the general ledger. A Backfill import
          does not.</strong> That difference is the whole of this section, and getting it
          backwards is how a liability gets recorded twice.
        </div>

        <h3 style={st.h3}>New Arrivals — one entry per GD</h3>
        <p style={st.p}>
          Committing a New Arrivals import writes <strong>one balanced journal entry per GD,
          dated the GD's own date</strong>. You do not have to do anything for this to
          happen, and you must <strong>not</strong> record the same liability again by hand.
        </p>
        <div style={st.tableScroll}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Account</th>
                <th style={st.th}>Debit</th>
                <th style={st.th}>Credit</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={st.td}>Inventory</td>
                <td style={st.td}>Total landed cost of every costed line</td>
                <td style={st.td}>&mdash;</td>
              </tr>
              <tr>
                <td style={st.td}>Input Tax</td>
                <td style={st.td}>Total sales tax + AST + other charges</td>
                <td style={st.td}>&mdash;</td>
              </tr>
              <tr>
                <td style={st.td}>Advance Income Tax on Imports</td>
                <td style={st.td}>Total income tax paid at the port</td>
                <td style={st.td}>&mdash;</td>
              </tr>
              <tr>
                <td style={{ ...st.td, fontWeight: 700 }}>Import Clearing</td>
                <td style={st.td}>&mdash;</td>
                <td style={{ ...st.td, fontWeight: 700 }}>The balancing total &mdash; what you owe</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 style={st.h3}>Import Clearing IS the accounts payable for an import</h3>
        <p style={st.p}>
          <strong>Import Clearing</strong> is a liability account. It holds what the
          consignment owes between clearing customs and being paid for — the supplier's
          invoice and the clearing agent's charges together, because a costing sheet names
          neither a supplier nor a payment reference, so there is nothing more specific to
          credit. It behaves like any other payable: it sits on the balance sheet until a
          payment clears it (section 9).
        </p>
        <p style={st.p}>
          The three accounts are created for you. A brand-new company gets them with the rest
          of its chart; a company that already had a chart is given the missing ones
          automatically. You can see them under{" "}
          <strong>Accounting &#9656; Chart of Accounts</strong>.
        </p>

        <h3 style={st.h3}>Backfill posts nothing, and that is deliberate</h3>
        <p style={st.p}>
          A Backfill import is <em>re-pricing stock already on your books</em> — goods that
          arrived and were accounted for at some earlier date. Posting its tax and its
          liability today would claim input tax in the wrong period and invent a payable that
          was settled long ago. So a Backfill commit changes the actual cost on the stock
          dashboard and writes no journal entry at all.
        </p>
        <p style={st.p}>
          A New Arrivals import also posts nothing if the general ledger is switched off for
          that company. Turn it on and rebuild (<strong>Accounting &#9656; rebuild the
          ledger</strong>) and the consignments will post then.
        </p>
        <p style={st.p}>
          You can always tell which happened: the <strong>Consignments</strong> screen shows a
          status of <strong>Not posted</strong> for a GD that owes nothing through this route,
          against <strong>Unpaid</strong>, <strong>Part paid</strong> or{" "}
          <strong>Settled</strong> for one that does.
        </p>
      </section>

      <section id="paying-a-gd" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>9</span> Paying a GD</h2>
        <PathPill>Purchases &#9656; Consignments &#9656; Settle</PathPill>

        <p style={st.p}>
          The Consignments screen lists every GD with what it{" "}
          <strong>credited</strong>, what has been <strong>settled</strong> and what is still{" "}
          <strong>outstanding</strong>. Unpaid GDs sort to the top, there is an
          only-outstanding filter, and the company-wide total is shown above the list — so
          "which GD is still unpaid" is one screen, not a reconciliation.
        </p>
        <p style={st.p}>
          <strong>Settle</strong> records an ordinary money-out payment against the GD. Choose
          the date, the amount, who it went to (a supplier, or just type the clearing agent's
          name) and which bank or cash account it left. It debits Import Clearing and credits
          the bank, exactly as paying a purchase bill does.
        </p>

        <h3 style={st.h3}>When the final bill comes in under the estimate</h3>
        <p style={st.p}>
          A GD's liability is an <strong>estimate</strong> until the clearing agent's final
          bill arrives. If you pay less than the outstanding figure, the dialog offers{" "}
          <strong>Discount received</strong>, <strong>Write back the rest</strong> or{" "}
          <strong>Other account</strong>. Pick one and the remainder clears the liability
          without pretending money moved:
        </p>
        <ul style={st.ul}>
          <li style={st.li}>Import Clearing is cleared by the <strong>full</strong> amount — cash plus the adjustment.</li>
          <li style={st.li}>The bank is credited with the <strong>cash only</strong>.</li>
          <li style={st.li}>The difference lands in the account you chose.</li>
          <li style={st.li}>The GD then reads <strong>Settled</strong>, not part paid — because it is.</li>
        </ul>
        <div style={st.warn}>
          <strong>Do not overstate the cash to close a GD.</strong> That is what this exists to
          replace: the bank balance would then disagree with the statement, and the gap would
          be invisible.
        </div>

        <h3 style={st.h3}>Changing a settlement afterwards</h3>
        <PathPill>Accounting &#9656; Payments &#9656; Edit</PathPill>
        <p style={st.p}>
          Editing a GD settlement opens this same dialog, already filled in. The amount you
          may enter is what the GD has room for <em>with this payment's own contribution added
          back</em>, so re-saving an unchanged settlement is never treated as paying twice.
        </p>
      </section>

      <section id="cost-history" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>10</span> Cost history &mdash; what changed a figure, and when</h2>
        <PathPill>Dashboards &#9656; Inventory &#9656; On-Hand &#9656; History (on a row)</PathPill>
        <PathPill>Dashboards &#9656; Inventory &#9656; Cost History (whole company)</PathPill>

        <p style={st.p}>
          An item's actual cost is <strong>replaced</strong>, not added up: a Backfill import
          overwrites it, a New Arrivals import adds to it, a hand edit replaces it, deleting a
          consignment reverses it. So when a margin looks wrong, the first question is always{" "}
          <em>what changed this, and when?</em> That is what this screen answers.
        </p>
        <p style={st.p}>
          Every entry shows the date and time, the person, what did it, and the quantity,
          actual cost and selling value <strong>before and after</strong> — with the figures
          that did not move shown quietly, so the one that did stands out.
        </p>
        <ul style={st.ul}>
          <li style={st.li}><strong>GD costing import</strong> — a sheet commit, naming the GD.</li>
          <li style={st.li}><strong>GD line corrected</strong> — a single-line fix, carrying the reason typed at the time.</li>
          <li style={st.li}><strong>Consignment deleted</strong> — the undo, including any item removed with it.</li>
          <li style={st.li}><strong>Opening balance</strong> / <strong>Opening balance removed</strong> — the Opening Balances tab.</li>
          <li style={st.li}><strong>Stock adjustment</strong> — the Adjust dialog, carrying your own note.</li>
        </ul>
        <p style={st.p}>
          Use the <strong>Cost History</strong> button in the page header when you know
          something went wrong but not yet which item — it lists the whole company, newest
          first, so a bad import shows up as a run of entries at one timestamp.
        </p>
        <div style={st.warn}>
          <strong>This starts on 13 September 2026.</strong> Changes made before then were not
          recorded and cannot be reconstructed, so an item with no entries has simply not been
          touched since the trail began. Entries are never edited or deleted.
          <p style={{ ...st.p, margin: "0.6rem 0 0" }}>
            Seeing cost and margin anywhere &mdash; including here &mdash; needs the{" "}
            <strong>Actual Cost</strong> permission. It is separate from seeing stock on
            purpose: somebody who prices and sells does not automatically see the margin.
          </p>
        </div>
      </section>

      <section id="glossary" style={st.section}>
        <h2 style={st.h2}><span style={st.sectionNum}>11</span> What the words mean</h2>
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
        <h2 style={st.h2}><span style={st.sectionNum}>12</span> Common questions</h2>

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

        <div style={st.qa}>
          <p style={st.q}>Do I still need to record what I owe for an import separately?</p>
          <p style={st.a}>No — not for a New Arrivals import. It credits Import Clearing for you, and that IS the payable (section 8). Recording it again by hand would double the liability. A Backfill import posts nothing, so anything you owe for that stock was recorded when it originally arrived.</p>
        </div>

        <div style={st.qa}>
          <p style={st.q}>One duty on one row was typed wrong. Do I have to delete the whole GD?</p>
          <p style={st.a}>No. Purchases ▸ Consignments ▸ expand the GD ▸ the pencil on the line (section 6). Deleting is only needed when a line matched the wrong item — and a GD you have already paid against cannot be deleted at all, which is why correcting one line exists.</p>
        </div>

        <div style={st.qa}>
          <p style={st.q}>The agent's final bill was 500 less than the GD. How do I close it?</p>
          <p style={st.a}>Settle it for what you actually paid and use "Write back the rest" for the difference (section 9). Do not type the higher figure as cash — the bank balance would then disagree with your statement.</p>
        </div>

        <div style={st.qa}>
          <p style={st.q}>An item's margin looks wrong. Where do I start?</p>
          <p style={st.a}>The cost history (section 9) — the History button on that item's row. It names every change to its cost, who made it and what the figure was before.</p>
        </div>
      </section>
    </div>
  );
}
