import { useCallback, useEffect, useState } from "react";
import { MdFileDownload, MdCheckCircle, MdWarningAmber } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { notify } from "../utils/notify";
import { colors } from "../theme";
import { saveBlob } from "../api/accountingReportApi";
import {
  getInputTaxWorksheet, exportInputTaxWorksheet, getGdRegister, exportGdRegister, getStockTieOut,
} from "../api/importTaxApi";

/**
 * Purchases -> Import Tax Desk (2026-10-05). Three read-only views an
 * importer's consultant works through every month:
 *   - Input tax: the sales-tax worksheet by CLAIM month (s.8B cap, carry
 *     forward, the six-period claim window);
 *   - GD register: every GD line with its duties and import taxes;
 *   - Month-end tie-out: stock screen = ledger = Annex-H1, and GD dues =
 *     Import Clearing.
 * Every figure is the server's; this page only lays them out.
 */
const money = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const ym = (d) => (d ? String(d).slice(0, 7) : "");
const monthLabel = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—");
const dayLabel = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthsBack = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 7); };
const STATUS = {
  claimed: ["Claimed", "#1b5e20", "#e8f5e9"],
  open: ["Not claimed yet", "#8a4b00", "#fff8e6"],
  lapsed: ["Lapsed", "#b71c1c", "#fdecea"],
  "claimed-late": ["Claimed late", "#8a4b00", "#fff8e6"],
  "n/a": ["—", "#5f6d7e", "transparent"],
};

export default function ImportTaxDeskPage() {
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;
  const [tab, setTab] = useState("input");

  return (
    <div style={st.page}>
      <h1 style={st.h1}>Import Tax Desk</h1>
      <p style={st.muted}>
        The month's sales-tax worksheet, the GD register and the month-end tie-out for {selectedCompany?.name || "the company"}.
        Read-only: nothing here changes the books.
      </p>
      <div role="tablist" style={st.tabs}>
        {[["input", "Input tax"], ["register", "GD register"], ["tieout", "Month-end tie-out"]].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
            style={{ ...st.tab, ...(tab === k ? st.tabOn : null) }}>{label}</button>
        ))}
      </div>
      {!companyId ? <p style={st.muted}>Choose a company first.</p>
        : tab === "input" ? <InputTaxTab companyId={companyId} />
          : tab === "register" ? <RegisterTab companyId={companyId} />
            : <TieOutTab companyId={companyId} />}
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

async function download(request, name) {
  try { saveBlob(await request(), name); }
  catch { notify("Could not build the Excel file.", "error"); }
}

function InputTaxTab({ companyId }) {
  const [from, setFrom] = useState(monthsBack(5));
  const [to, setTo] = useState(thisMonth());
  const [data, busy] = useLoad(() => getInputTaxWorksheet(companyId, from, to), [companyId, from, to]);
  return (
    <section>
      <div style={st.bar}>
        <Month label="From" value={from} onChange={setFrom} />
        <Month label="To" value={to} onChange={setTo} />
        <button type="button" style={st.ghost} disabled={!data}
          onClick={() => download(() => exportInputTaxWorksheet(companyId, from, to), `input-tax-${from}-to-${to}.xlsx`)}>
          <MdFileDownload size={18} style={{ flexShrink: 0 }} /> Excel
        </button>
      </div>
      {busy && <p style={st.muted}>Working…</p>}
      {data && (
        <>
          <div style={st.tiles}>
            <Tile label={`Carried forward at ${monthLabel(data.to)}`} value={money(data.months.at(-1)?.carriedForward)} strong />
            <Tile label="Payable for the last month" value={money(data.months.at(-1)?.payable)} />
            <Tile label="Input tax still open to claim" value={money(data.openInputTax)} />
            <Tile label="Input tax lapsed" value={money(data.lapsedInputTax)} warn={data.lapsedInputTax > 0} />
          </div>
          <p style={st.note}>
            By claim month, from the bills and GDs. Input tax adjusted in a month is capped at {data.capPercent}% of its output
            tax (s.8B); the rest carries forward and is adjusted against later output tax, not refunded. A GD's input tax must be
            claimed within {data.claimPeriods} tax periods after its month. Your consultant files the return.
          </p>
          <div style={st.scroll}>
            <table style={st.table}>
              <thead><tr>{["Month", "Output tax", "Import sales tax", "Import VAT (3%)", "GST/FED", "Purchases", "Brought fwd",
                "Available", `Cap ${data.capPercent}%`, "Admissible", "Carried fwd", "Payable"].map((h) => <th key={h} style={st.th}>{h}</th>)}</tr></thead>
              <tbody>
                {data.months.map((m) => (
                  <tr key={m.month}>
                    <td style={st.td}>{monthLabel(m.month)}</td>
                    {[m.outputTax, m.importSalesTax, m.importValueAddedTax, m.importOtherTax, m.purchaseInputTax, m.broughtForward,
                      m.available, m.capLimit, m.admissible, m.carriedForward, m.payable].map((v, i) => (
                      <td key={i} style={{ ...st.num, ...(i === 7 && m.capApplied ? { color: "#8a4b00", fontWeight: 700 } : null) }}>{money(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 style={st.h2}>Claim time limit ({data.timeLimit.length})</h2>
          {data.timeLimit.length === 0 ? <p style={st.muted}>Every GD with input tax has been claimed in time.</p> : (
            <div style={st.scroll}>
              <table style={st.table}>
                <thead><tr>{["Status", "GD", "GD date", "Claim by", "Claimed", "Description", "HS code", "Input tax"].map((h) => <th key={h} style={st.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.timeLimit.map((r, i) => (
                    <tr key={i}>
                      <td style={st.td}><Pill status={r.status} /></td>
                      <td style={st.td}>{r.gdNumber}</td>
                      <td style={st.td}>{dayLabel(r.gdDate)}</td>
                      <td style={st.td}>{monthLabel(r.claimBy)}</td>
                      <td style={st.td}>{monthLabel(r.claimMonth)}</td>
                      <td style={{ ...st.td, ...st.wrap }}>{r.description}</td>
                      <td style={st.td}>{r.hsCode}</td>
                      <td style={st.num}>{money(r.inputTax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RegisterTab({ companyId }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unclaimedOnly, setUnclaimedOnly] = useState(false);
  const filters = { from, to, unclaimedOnly };
  const [data, busy] = useLoad(() => getGdRegister(companyId, filters), [companyId, from, to, unclaimedOnly]);
  return (
    <section>
      <div style={st.bar}>
        <Month label="GD date from" value={from} onChange={setFrom} />
        <Month label="to" value={to} onChange={setTo} />
        <label style={st.check}>
          <input type="checkbox" checked={unclaimedOnly} onChange={(e) => setUnclaimedOnly(e.target.checked)}
            style={{ width: 20, height: 20, flexShrink: 0 }} /> Not claimed yet only
        </label>
        <button type="button" style={st.ghost} disabled={!data}
          onClick={() => download(() => exportGdRegister(companyId, filters), "gd-register.xlsx")}>
          <MdFileDownload size={18} style={{ flexShrink: 0 }} /> Excel
        </button>
      </div>
      {busy && <p style={st.muted}>Working…</p>}
      {data && (
        <>
          <div style={st.tiles}>
            <Tile label="GDs" value={data.gdCount} />
            <Tile label="Assessed value" value={money(data.totalAssessedValue)} />
            <Tile label="Duties (CD + ACD + RD)" value={money(data.totalDuties)} />
            <Tile label="Input tax (ST + VAT + GST/FED)" value={money(data.totalInputTax)} strong />
            <Tile label="Income tax at import" value={money(data.totalIncomeTax)} />
            <Tile label="Input tax not yet claimed" value={money(data.unclaimedInputTax)} warn={data.unclaimedInputTax > 0} />
          </div>
          <p style={st.note}>
            Collectorate and GD type are read from the GD number (e.g. KAPE-HC = Karachi Appraisement East, home consumption).
            GDs known only from the stock sheet the company was loaded from show no duties or taxes: import their GD costing sheet
            to fill them.
          </p>
          <div style={st.scroll}>
            <table style={st.table}>
              <thead><tr>{["GD", "Collectorate", "GD date", "Claim", "Description", "HS code", "Qty", "Assessed", "Duties",
                "Sales tax", "VAT", "Income tax", "Landed cost", "Input tax"].map((h) => <th key={h} style={st.th}>{h}</th>)}</tr></thead>
              <tbody>
                {data.lines.map((l, i) => (
                  <tr key={i}>
                    <td style={st.td}>{l.gdNumber}{l.source === "stock-sheet" && <div style={st.small}>stock sheet</div>}</td>
                    <td style={{ ...st.td, ...st.wrap }}>{l.collectorateName || l.collectorate || "—"}{l.gdTypeName && <div style={st.small}>{l.gdTypeName}</div>}</td>
                    <td style={st.td}>{dayLabel(l.gdDate)}</td>
                    <td style={st.td}>{l.claimMonth ? monthLabel(l.claimMonth) : <Pill status={l.claimStatus} />}</td>
                    <td style={{ ...st.td, ...st.wrap }}>{l.description}</td>
                    <td style={st.td}>{l.hsCode}</td>
                    <td style={st.num}>{qty(l.quantity)} {l.unit}</td>
                    {l.source === "stock-sheet"
                      ? <td style={st.num} colSpan={7}>{money(l.sellingValue)} <span style={st.small}>stock value</span></td>
                      : [l.assessedValue, l.customsDuty + l.acd + l.regulatoryDuty, l.salesTax, l.valueAddedTax, l.incomeTax,
                        l.landedCost, l.inputTax].map((v, j) => <td key={j} style={st.num}>{money(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function TieOutTab({ companyId }) {
  const [month, setMonth] = useState(monthsBack(1));
  const [data, busy] = useLoad(() => getStockTieOut(companyId, month), [companyId, month]);
  const row = (label, value, note) => (
    <tr><td style={st.td}>{label}</td><td style={st.num}>{value == null ? "—" : money(value)}</td><td style={{ ...st.td, ...st.wrap, color: "#5f6d7e" }}>{note}</td></tr>
  );
  return (
    <section>
      <div style={st.bar}><Month label="Month" value={month} onChange={setMonth} /></div>
      {busy && <p style={st.muted}>Working… (walks every GD line to the month's end)</p>}
      {data && (
        <>
          <div style={{ ...st.verdict, ...(data.agrees ? st.ok : data.agreesOnceExplained ? st.warnBox : st.bad) }}>
            {data.agrees ? <MdCheckCircle size={22} style={{ flexShrink: 0 }} /> : <MdWarningAmber size={22} style={{ flexShrink: 0 }} />}
            <span>{data.agrees ? `${monthLabel(data.month)} ties out: the stock screen, the ledger and Annex-H1 agree, and the GD dues match Import Clearing.`
              : data.agreesOnceExplained ? "Agrees once the new-arrival GDs' declared-vs-landed difference is taken out (see below)."
                : "Does not tie out. The notes below say where to look."}</span>
          </div>
          <div style={st.scroll}>
            <table style={st.table}>
              <thead><tr><th style={st.th}>Figure</th><th style={st.th}>Amount</th><th style={st.th}>Where it comes from</th></tr></thead>
              <tbody>
                {row("Stock (stock screen)", data.stockValue, "Every item walked to the month's end, at declared value excluding tax.")}
                {row("Annex-H1 closing", data.annexH1Closing, "The month's GD sheet rolled up per HS code.")}
                {row("Stock − Annex-H1", data.stockVsAnnexH1, "")}
                {row("Inventory account", data.ledgerInventory, data.ledgerOn ? "The ledger's balance on the month's last day." : "The ledger is off.")}
                {row("Stock − Inventory account", data.stockVsLedger, "")}
                {data.ledgerOn && row("of which new-arrival GDs", data.arrivalsBasisGap, "Booked at landed cost in the ledger, at declared value in stock.")}
                {row("GD dues outstanding", data.consignmentsOutstanding, "What the GDs credited, less what was settled by the month's end.")}
                {row("Import Clearing account", data.ledgerImportClearing, "")}
                {row("Difference", data.clearingDifference, "")}
              </tbody>
            </table>
          </div>
          {data.notes.length > 0 && <ul style={st.notes}>{data.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </>
      )}
    </section>
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

const st = {
  page: { padding: "1rem", maxWidth: 1280, margin: "0 auto" },
  h1: { margin: "0.25rem 0 0.4rem", fontSize: "1.35rem", color: colors.textPrimary },
  h2: { margin: "1.2rem 0 0.5rem", fontSize: "1rem" },
  muted: { color: "#5f6d7e", fontSize: 13, margin: "0.2rem 0" },
  note: { color: "#5f6d7e", fontSize: 12.5, margin: "0.5rem 0 0.75rem", maxWidth: 900 },
  small: { fontSize: 11, color: "#5f6d7e" },
  tabs: { display: "flex", flexWrap: "wrap", gap: 6, margin: "0.75rem 0", borderBottom: `1px solid ${colors.cardBorder}` },
  tab: { minHeight: 44, padding: "0.4rem 0.9rem", border: "none", borderBottom: "3px solid transparent", background: "none",
    cursor: "pointer", fontWeight: 600, color: "#5f6d7e", fontSize: 14 },
  tabOn: { color: colors.blue, borderBottomColor: colors.blue },
  bar: { display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end", margin: "0.5rem 0" },
  field: { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px", maxWidth: 220 },
  label: { fontSize: 12, fontWeight: 700, color: "#5f6d7e" },
  input: { minHeight: 44, padding: "0.35rem 0.6rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: 14 },
  check: { display: "flex", alignItems: "center", gap: 8, minHeight: 44, fontSize: 14, cursor: "pointer" },
  ghost: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0.4rem 0.9rem", borderRadius: 8,
    border: `1px solid ${colors.blue}`, color: colors.blue, background: "#fff", fontWeight: 700, cursor: "pointer" },
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "0.6rem", margin: "0.75rem 0" },
  tile: { background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.7rem 0.85rem" },
  tileLabel: { fontSize: 12, color: "#5f6d7e", fontWeight: 600 },
  tileValue: { fontSize: 18, fontWeight: 700, marginTop: 2, overflowWrap: "anywhere" },
  scroll: { overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, background: "#fff" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "0.5rem 0.6rem", background: "#f3f6fa", borderBottom: `1px solid ${colors.cardBorder}`,
    whiteSpace: "nowrap", fontSize: 12 },
  td: { padding: "0.45rem 0.6rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "top", whiteSpace: "nowrap" },
  num: { padding: "0.45rem 0.6rem", borderBottom: `1px solid ${colors.cardBorder}`, textAlign: "right", whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums", verticalAlign: "top" },
  wrap: { whiteSpace: "normal", minWidth: 180, overflowWrap: "anywhere" },
  pill: { display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 700 },
  verdict: { display: "flex", alignItems: "flex-start", gap: 8, padding: "0.7rem 0.85rem", borderRadius: 10, margin: "0.75rem 0", fontWeight: 600 },
  ok: { background: "#e8f5e9", color: "#1b5e20" },
  warnBox: { background: "#fff8e6", color: "#8a4b00" },
  bad: { background: "#fdecea", color: "#b71c1c" },
  notes: { margin: "0.75rem 0", paddingLeft: "1.2rem", color: "#5f6d7e", fontSize: 13, display: "grid", gap: 4 },
};
