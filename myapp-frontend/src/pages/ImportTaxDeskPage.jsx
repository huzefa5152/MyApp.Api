import { useCallback, useEffect, useMemo, useState } from "react";
import { MdFileDownload, MdCheckCircle, MdWarningAmber, MdSearch, MdInfoOutline } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { notify } from "../utils/notify";
import { colors, dropdownStyles } from "../theme";
import Pagination from "../Components/Pagination";
import { saveBlob } from "../api/accountingReportApi";
import {
  getInputTaxWorksheet, exportInputTaxWorksheet, getGdRegister, exportGdRegister, getStockTieOut,
} from "../api/importTaxApi";

/**
 * Purchases -> Import Tax Desk (2026-10-05). Three read-only views an
 * importer's consultant works through every month, for the company chosen in
 * the page's own picker:
 *   - Input tax: the sales-tax worksheet by CLAIM month (s.8B cap, carry
 *     forward, the six-period claim window);
 *   - GD register: every GD line with its duties and import taxes;
 *   - Month-end tie-out: stock screen = ledger = Annex-H1, and GD dues =
 *     Import Clearing.
 * Every figure is the server's; this page only lays them out. Long lists are
 * paged and scroll inside their own box with a sticky header, so the page
 * itself stays short.
 */
const money = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const monthLabel = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—");
const dayLabel = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthsBack = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 7); };
const STATUS = {
  claimed: ["Claimed", "#1b5e20", "#e8f5e9"],
  open: ["Not claimed yet", "#8a4b00", "#fff3d6"],
  lapsed: ["Lapsed", "#b71c1c", "#fdecea"],
  "claimed-late": ["Claimed late", "#8a4b00", "#fff3d6"],
  "n/a": ["—", "#5f6d7e", "transparent"],
};
const TABS = [["input", "Input tax"], ["register", "GD register"], ["tieout", "Month-end tie-out"]];

export default function ImportTaxDeskPage() {
  const { companies, selectedCompany } = useCompany();
  const [companyId, setCompanyId] = useState(selectedCompany?.id ? String(selectedCompany.id) : "");
  const [tab, setTab] = useState("input");
  useEffect(() => {
    if (!companyId && selectedCompany?.id) setCompanyId(String(selectedCompany.id));
  }, [selectedCompany, companyId]);

  return (
    <div style={st.page}>
      <header style={st.header}>
        <div style={{ minWidth: 0 }}>
          <h1 style={st.h1}>Import Tax Desk</h1>
          <p style={st.muted}>Sales-tax worksheet, GD register and month-end tie-out. Read-only.</p>
        </div>
        <label style={st.companyField}>
          <span style={st.label}>Company</span>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}
            style={{ ...dropdownStyles.base, minHeight: 44, width: "100%" }}>
            <option value="">Choose a company…</option>
            {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </header>

      <div role="tablist" style={st.tabs}>
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
            style={{ ...st.tab, ...(tab === k ? st.tabOn : null) }}>{label}</button>
        ))}
      </div>

      {!companyId ? <p style={st.muted}>Choose a company to see its figures.</p>
        : tab === "input" ? <InputTaxTab key={companyId} companyId={companyId} />
          : tab === "register" ? <RegisterTab key={companyId} companyId={companyId} />
            : <TieOutTab key={companyId} companyId={companyId} />}
    </div>
  );
}

function useLoad(fn, deps) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { const { data: d } = await fn(); setData(d); }
    catch (e) { setData(null); notify(e?.response?.data?.message || "Could not load the figures.", "error"); }
    finally { setBusy(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return [data, busy];
}

function usePaged(rows, initialSize = 20) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initialSize);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safe = Math.min(page, totalPages);
  const shown = rows.slice((safe - 1) * size, safe * size);
  const pager = (
    <Pagination page={safe} totalPages={totalPages} total={total} unit="rows" onPage={setPage}
      pageSize={size} onPageSize={(n) => { setSize(n); setPage(1); }} />
  );
  return { shown, pager, reset: () => setPage(1) };
}

async function download(request, name) {
  try { saveBlob(await request(), name); }
  catch { notify("Could not build the Excel file.", "error"); }
}

// ── Input tax ───────────────────────────────────────────────────────────

function InputTaxTab({ companyId }) {
  const [from, setFrom] = useState(monthsBack(5));
  const [to, setTo] = useState(thisMonth());
  const [limitFilter, setLimitFilter] = useState("all");
  const [data, busy] = useLoad(() => getInputTaxWorksheet(companyId, from, to), [companyId, from, to]);
  const limitRows = useMemo(() => (data?.timeLimit || []).filter((r) => limitFilter === "all" || r.status === limitFilter),
    [data, limitFilter]);
  const limits = usePaged(limitRows, 10);
  useEffect(() => { limits.reset(); }, [limitFilter, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = data?.months?.at(-1);

  return (
    <section>
      <div style={st.bar}>
        <Month label="From" value={from} onChange={setFrom} />
        <Month label="To" value={to} onChange={setTo} />
        <span style={{ flex: 1 }} />
        <button type="button" style={st.ghost} disabled={!data}
          onClick={() => download(() => exportInputTaxWorksheet(companyId, from, to), `input-tax-${from}-to-${to}.xlsx`)}>
          <MdFileDownload size={18} style={{ flexShrink: 0 }} /> Excel
        </button>
      </div>
      {busy && <p style={st.muted}>Working…</p>}
      {data && (
        <>
          <div style={st.tiles}>
            <Tile label={`Carried forward (${monthLabel(data.to)})`} value={money(last?.carriedForward)} strong />
            <Tile label={`Payable (${monthLabel(data.to)})`} value={money(last?.payable)} />
            <Tile label="Open to claim" value={money(data.openInputTax)} />
            <Tile label="Lapsed" value={money(data.lapsedInputTax)} warn={data.lapsedInputTax > 0} />
          </div>
          <Note>
            By claim month, from the bills and GDs. Input tax adjusted in a month is capped at {data.capPercent}% of its output
            tax (s.8B); the rest carries forward against later output tax and is not refunded. A GD's input tax must be claimed
            within {data.claimPeriods} tax periods after its month.
          </Note>
          <Grid maxHeight={420}
            head={["Month", "Output tax", "Import ST", "Import VAT 3%", "GST/FED", "Purchases", "Brought fwd", "Available",
              `Cap ${data.capPercent}%`, "Admissible", "Carried fwd", "Payable"]}
            rows={data.months.map((m) => [
              monthLabel(m.month), ...[m.outputTax, m.importSalesTax, m.importValueAddedTax, m.importOtherTax, m.purchaseInputTax,
                m.broughtForward, m.available, m.capLimit, m.admissible, m.carriedForward, m.payable].map((v, i) => (
                <span key={i} style={i === 7 && m.capApplied ? { color: "#8a4b00", fontWeight: 700 } : null}>{money(v)}</span>
              )),
            ])}
            numericFrom={1} />

          <div style={st.sectionHead}>
            <h2 style={st.h2}>Claim time limit</h2>
            <Chips value={limitFilter} onChange={setLimitFilter} options={[
              ["all", `All (${data.timeLimit.length})`],
              ["lapsed", `Lapsed (${data.timeLimit.filter((r) => r.status === "lapsed").length})`],
              ["open", `Not claimed (${data.timeLimit.filter((r) => r.status === "open").length})`],
              ["claimed-late", `Claimed late (${data.timeLimit.filter((r) => r.status === "claimed-late").length})`],
            ]} />
          </div>
          {limitRows.length === 0 ? <p style={st.muted}>Nothing here: every GD with input tax was claimed in time.</p> : (
            <>
              <Grid maxHeight={420}
                head={["Status", "GD", "GD date", "Claim by", "Description", "HS code", "Input tax"]}
                rows={limits.shown.map((r) => [
                  <Pill key="p" status={r.status} />, r.gdNumber, dayLabel(r.gdDate), monthLabel(r.claimBy),
                  <Wrap key="d">{r.description}</Wrap>, r.hsCode, money(r.inputTax),
                ])}
                numericFrom={6} />
              {limits.pager}
            </>
          )}
        </>
      )}
    </section>
  );
}

// ── GD register ─────────────────────────────────────────────────────────

function RegisterTab({ companyId }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("all");
  const [term, setTerm] = useState("");
  const [data, busy] = useLoad(() => getGdRegister(companyId, { from, to }), [companyId, from, to]);
  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (data?.lines || []).filter((l) =>
      (status === "all" || (status === "unclaimed" ? !l.claimMonth : status === "stock-sheet" ? l.source === "stock-sheet" : l.claimStatus === status))
      && (!t || [l.gdNumber, l.description, l.itemName, l.hsCode].some((x) => (x || "").toLowerCase().includes(t))));
  }, [data, status, term]);
  const paged = usePaged(rows, 20);
  useEffect(() => { paged.reset(); }, [status, term, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (pred) => (data?.lines || []).filter(pred).length;

  return (
    <section>
      <div style={st.bar}>
        <Month label="GD date from" value={from} onChange={setFrom} />
        <Month label="to" value={to} onChange={setTo} />
        <label style={{ ...st.field, flex: "2 1 220px", maxWidth: 360 }}>
          <span style={st.label}>Search</span>
          <span style={st.searchBox}>
            <MdSearch size={18} style={{ flexShrink: 0, color: "#5f6d7e" }} />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="GD, item or HS code"
              style={st.searchInput} />
          </span>
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" style={st.ghost} disabled={!data}
          onClick={() => download(() => exportGdRegister(companyId, { from, to, unclaimedOnly: status === "unclaimed" }), "gd-register.xlsx")}>
          <MdFileDownload size={18} style={{ flexShrink: 0 }} /> Excel
        </button>
      </div>
      {busy && <p style={st.muted}>Working…</p>}
      {data && (
        <>
          <div style={st.tiles}>
            <Tile label="GDs" value={data.gdCount} />
            <Tile label="Assessed value" value={money(data.totalAssessedValue)} />
            <Tile label="Input tax (ST + VAT + GST/FED)" value={money(data.totalInputTax)} strong />
            <Tile label="Not yet claimed" value={money(data.unclaimedInputTax)} warn={data.unclaimedInputTax > 0} />
          </div>
          <div style={st.sectionHead}>
            <Chips value={status} onChange={setStatus} options={[
              ["all", `All lines (${data.lines.length})`],
              ["unclaimed", `Not claimed (${count((l) => !l.claimMonth)})`],
              ["lapsed", `Lapsed (${count((l) => l.claimStatus === "lapsed")})`],
              ["claimed", `Claimed (${count((l) => l.claimStatus === "claimed")})`],
              ["stock-sheet", `From stock sheet (${count((l) => l.source === "stock-sheet")})`],
            ]} />
          </div>
          {rows.length === 0 ? <p style={st.muted}>No GD lines match.</p> : (
            <>
              <Grid maxHeight={520}
                head={["GD", "GD date", "Claim", "Description", "HS code", "Qty", "Assessed", "Duties", "Sales tax", "VAT",
                  "Income tax", "Landed cost", "Input tax"]}
                rows={paged.shown.map((l) => [
                  <span key="g">{l.gdNumber}<Sub>{[l.collectorate, l.gdType].filter(Boolean).join(" · ") || (l.source === "stock-sheet" ? "stock sheet" : "")}</Sub></span>,
                  dayLabel(l.gdDate),
                  l.claimMonth ? monthLabel(l.claimMonth) : <Pill key="p" status={l.claimStatus} />,
                  <Wrap key="d">{l.description}{l.itemName && l.itemName !== l.description && <Sub>{l.itemName}</Sub>}</Wrap>,
                  l.hsCode, `${qty(l.quantity)} ${l.unit || ""}`,
                  ...(l.source === "stock-sheet"
                    ? ["—", "—", "—", "—", "—", "—", "—"]
                    : [l.assessedValue, l.customsDuty + l.acd + l.regulatoryDuty, l.salesTax, l.valueAddedTax, l.incomeTax,
                      l.landedCost, l.inputTax].map(money)),
                ])}
                numericFrom={5} />
              {paged.pager}
            </>
          )}
          <Note>
            Collectorate and GD type are read from the GD number (KAPE-HC = Karachi Appraisement East, home consumption). GDs known
            only from the stock sheet the company was loaded from carry no duty or tax figures.
          </Note>
        </>
      )}
    </section>
  );
}

// ── Tie-out ─────────────────────────────────────────────────────────────

function TieOutTab({ companyId }) {
  const [month, setMonth] = useState(monthsBack(1));
  const [data, busy] = useLoad(() => getStockTieOut(companyId, month), [companyId, month]);
  const ok = (d) => d != null && Math.abs(d) <= 1;
  return (
    <section>
      <div style={st.bar}><Month label="Month" value={month} onChange={setMonth} /></div>
      {busy && <p style={st.muted}>Working… (walks every GD line to the month's end)</p>}
      {data && (
        <>
          <div style={{ ...st.verdict, ...(data.agrees ? st.ok : st.bad) }}>
            {data.agrees ? <MdCheckCircle size={22} style={{ flexShrink: 0 }} /> : <MdWarningAmber size={22} style={{ flexShrink: 0 }} />}
            <span>{data.agrees ? `${monthLabel(data.month)} ties out.` : `${monthLabel(data.month)} does not tie out — see below.`}</span>
          </div>
          <div style={st.checks}>
            <Check title="Stock screen = Annex-H1" good={ok(data.stockVsAnnexH1)}
              a={["Stock", data.stockValue]} b={["Annex-H1 closing", data.annexH1Closing]} diff={data.stockVsAnnexH1} />
            <Check title="Stock screen = Inventory account" good={!data.ledgerOn || ok(data.stockVsLedger)}
              a={["Stock", data.stockValue]} b={["Inventory account", data.ledgerInventory]} diff={data.stockVsLedger}
              extra={data.ledgerOn && Math.abs(data.arrivalsBasisGap || 0) > 0.005 ? `of which GDs still at landed cost: ${money(data.arrivalsBasisGap)}` : null}
              off={!data.ledgerOn} />
            <Check title="GD dues = Import Clearing" good={!data.ledgerOn || ok(data.clearingDifference)}
              a={["GD dues outstanding", data.consignmentsOutstanding]} b={["Import Clearing", data.ledgerImportClearing]}
              diff={data.clearingDifference} off={!data.ledgerOn} />
          </div>
          {data.notes.length > 0 && <Note list={data.notes} />}
        </>
      )}
    </section>
  );
}

function Check({ title, good, a, b, diff, extra, off }) {
  return (
    <div style={{ ...st.check, borderColor: off ? colors.cardBorder : good ? "#a5d6a7" : "#f5b7b1" }}>
      <div style={st.checkHead}>
        {off ? <MdInfoOutline size={20} style={{ flexShrink: 0, color: "#5f6d7e" }} />
          : good ? <MdCheckCircle size={20} style={{ flexShrink: 0, color: "#1b5e20" }} />
            : <MdWarningAmber size={20} style={{ flexShrink: 0, color: "#b71c1c" }} />}
        <strong>{title}</strong>
      </div>
      <div style={st.checkRow}><span>{a[0]}</span><span style={st.num}>{money(a[1])}</span></div>
      <div style={st.checkRow}><span>{b[0]}</span><span style={st.num}>{off ? "ledger off" : money(b[1])}</span></div>
      {!off && <div style={{ ...st.checkRow, fontWeight: 700 }}><span>Difference</span><span style={st.num}>{money(diff)}</span></div>}
      {extra && <div style={st.small}>{extra}</div>}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────

// The first column is frozen so a wide worksheet keeps each row's label in
// view while it scrolls sideways; figure headings may wrap onto two lines so
// a column is only as wide as its numbers.
function Grid({ head, rows, numericFrom, maxHeight }) {
  const frozen = { position: "sticky", left: 0, zIndex: 1, boxShadow: `1px 0 0 ${colors.cardBorder}` };
  return (
    <div style={{ ...st.gridBox, maxHeight: `min(${maxHeight}px, 65vh)` }}>
      <table style={st.table}>
        <thead>
          <tr>{head.map((h, i) => (
            <th key={h} style={{
              ...st.th,
              ...(i >= numericFrom ? { textAlign: "right", whiteSpace: "normal", verticalAlign: "bottom", minWidth: 72 } : null),
              ...(i === 0 ? { ...frozen, zIndex: 2 } : null),
            }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => {
            const bg = r % 2 ? "#fafbfd" : "#fff";
            return (
              <tr key={r} style={{ background: bg }}>
                {cells.map((c, i) => (
                  <td key={i} style={{ ...(i >= numericFrom ? st.num : st.td), ...(i === 0 ? { ...frozen, background: bg } : null) }}>{c}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Chips({ value, onChange, options }) {
  return (
    <div style={st.chips}>
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
          style={{ ...st.chip, ...(value === k ? st.chipOn : null) }}>{label}</button>
      ))}
    </div>
  );
}

function Month({ label, value, onChange }) {
  return (
    <label style={st.field}>
      <span style={st.label}>{label}</span>
      <input type="month" value={value} onChange={(e) => onChange(e.target.value)} style={st.input} />
    </label>
  );
}

function Tile({ label, value, strong, warn }) {
  return (
    <div style={{ ...st.tile, ...(warn ? { borderColor: "#f0c36d" } : null) }}>
      <div style={st.tileLabel}>{label}</div>
      <div style={{ ...st.tileValue, ...(strong ? { color: colors.blue } : null), ...(warn ? { color: "#8a4b00" } : null) }}>{value}</div>
    </div>
  );
}

function Pill({ status }) {
  const [text, fg, bg] = STATUS[status] || STATUS["n/a"];
  return <span style={{ ...st.pill, color: fg, background: bg }}>{text}</span>;
}

const Sub = ({ children }) => (children ? <div style={st.small}>{children}</div> : null);
const Wrap = ({ children }) => <div style={st.wrap}>{children}</div>;
const Note = ({ children, list }) => (
  <div style={st.note}>
    <MdInfoOutline size={16} style={{ flexShrink: 0, marginTop: 2 }} />
    {list ? <ul style={{ margin: 0, paddingLeft: "1rem", display: "grid", gap: 4 }}>{list.map((n, i) => <li key={i}>{n}</li>)}</ul>
      : <span>{children}</span>}
  </div>
);

const st = {
  page: { padding: "1rem", maxWidth: 1280, margin: "0 auto" },
  header: { display: "flex", flexWrap: "wrap", gap: "0.75rem 1.5rem", alignItems: "flex-end", justifyContent: "space-between",
    background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.85rem 1rem" },
  h1: { margin: 0, fontSize: "1.3rem", color: colors.textPrimary },
  h2: { margin: 0, fontSize: "1rem" },
  muted: { color: "#5f6d7e", fontSize: 13, margin: "0.25rem 0" },
  small: { fontSize: 11.5, color: "#5f6d7e", marginTop: 2 },
  companyField: { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 240px", maxWidth: 360 },
  tabs: { display: "flex", gap: 4, margin: "0.85rem 0 0.5rem", padding: 4, background: "#eef2f7", borderRadius: 10,
    width: "fit-content", maxWidth: "100%", flexWrap: "wrap" },
  tab: { minHeight: 40, padding: "0.35rem 1rem", border: "none", borderRadius: 8, background: "transparent",
    cursor: "pointer", fontWeight: 600, color: "#5f6d7e", fontSize: 14 },
  tabOn: { background: "#fff", color: colors.blue, boxShadow: "0 1px 3px rgba(0,0,0,0.12)" },
  bar: { display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end", margin: "0.5rem 0",
    background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.6rem 0.8rem" },
  field: { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px", maxWidth: 200 },
  label: { fontSize: 12, fontWeight: 700, color: "#5f6d7e" },
  input: { minHeight: 44, padding: "0.35rem 0.6rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: 14,
    boxSizing: "border-box", width: "100%" },
  searchBox: { display: "flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0 0.6rem",
    border: `1px solid ${colors.inputBorder}`, borderRadius: 8, background: "#fff" },
  searchInput: { border: "none", outline: "none", flex: 1, minWidth: 0, fontSize: 14, background: "transparent" },
  ghost: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0.4rem 0.9rem", borderRadius: 8,
    border: `1px solid ${colors.blue}`, color: colors.blue, background: "#fff", fontWeight: 700, cursor: "pointer" },
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))", gap: "0.5rem", margin: "0.5rem 0" },
  tile: { background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.55rem 0.75rem" },
  tileLabel: { fontSize: 11.5, color: "#5f6d7e", fontWeight: 600 },
  tileValue: { fontSize: 17, fontWeight: 700, marginTop: 2, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" },
  sectionHead: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem 1rem", margin: "1rem 0 0.5rem" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { minHeight: 36, padding: "0.25rem 0.75rem", borderRadius: 999, border: `1px solid ${colors.cardBorder}`,
    background: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#3d4b5c" },
  chipOn: { background: colors.blue, borderColor: colors.blue, color: "#fff" },
  gridBox: { overflow: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, background: "#fff" },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 },
  th: { position: "sticky", top: 0, zIndex: 1, textAlign: "left", padding: "0.5rem 0.5rem", background: "#f3f6fa",
    borderBottom: `1px solid ${colors.cardBorder}`, whiteSpace: "nowrap", fontSize: 12 },
  td: { padding: "0.4rem 0.5rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "top", whiteSpace: "nowrap" },
  num: { padding: "0.4rem 0.5rem", borderBottom: `1px solid ${colors.cardBorder}`, textAlign: "right", whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums", verticalAlign: "top" },
  wrap: { whiteSpace: "normal", minWidth: 200, maxWidth: 320, overflowWrap: "anywhere" },
  pill: { display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 700 },
  note: { display: "flex", gap: 6, alignItems: "flex-start", color: "#5f6d7e", fontSize: 12.5, margin: "0.6rem 0",
    background: "#f7f9fc", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.5rem 0.7rem" },
  verdict: { display: "flex", alignItems: "flex-start", gap: 8, padding: "0.65rem 0.85rem", borderRadius: 10, margin: "0.5rem 0", fontWeight: 600 },
  ok: { background: "#e8f5e9", color: "#1b5e20" },
  bad: { background: "#fdecea", color: "#b71c1c" },
  checks: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: "0.6rem" },
  check: { background: "#fff", border: "1px solid", borderRadius: 12, padding: "0.7rem 0.85rem", display: "grid", gap: 6 },
  checkHead: { display: "flex", alignItems: "center", gap: 6, marginBottom: 2 },
  checkRow: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5 },
};
