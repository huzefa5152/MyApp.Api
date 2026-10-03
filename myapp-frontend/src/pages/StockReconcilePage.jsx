import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MdArrowBack, MdCloudUpload, MdDoneAll, MdErrorOutline, MdExpandMore, MdChevronRight, MdWarningAmber } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors } from "../theme";
import { getImportProfiles, previewOpeningStock } from "../api/spreadsheetImportApi";
import { planStockReconcile, applyStockReconcile } from "../api/stockApi";

/**
 * Reconcile to my stock sheet (2026-10-03). The client's monthly sheet is read
 * with the same layout reader as the opening-stock import; the SERVER plans
 * what would make the books hold it (per item: a quantity correction where the
 * counted quantity differs, and the GD lines it will hold) and Apply does it in
 * one transaction. This screen only collects decisions and shows the plan --
 * no figure is computed here.
 */
const money = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const monthEnd = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const lastMonth = () => {
  const d = new Date();
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function StockReconcilePage() {
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const [month, setMonth] = useState(lastMonth);
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [readerNotes, setReaderNotes] = useState([]);
  const [plan, setPlan] = useState(null);
  const [choices, setChoices] = useState({});       // sourceRow -> itemTypeId | -1
  const [useSheet, setUseSheet] = useState(null);    // Set of itemTypeIds, null = proposals
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({});

  const companyId = selectedCompany?.id;
  const canRun = has("stock.policy.manage") && has("spreadsheetimport.stock.run");

  useEffect(() => { setRows(null); setPlan(null); setChoices({}); setUseSheet(null); }, [companyId]);

  const request = (overrides = {}) => ({
    asOf: monthEnd(month),
    sourceFile: file?.name,
    rows: (rows || []).map((r) => ({ ...r, chosenItemTypeId: choices[r.sourceRow] ?? null })),
    ...overrides,
  });

  // The plan is always built with the operator's quantity decisions (null on
  // the first pass = the server's proposals), so an item whose lines only fit
  // at the sheet's quantity clears its error the moment that box is ticked.
  const replan = async (nextChoices = choices, nextUse = useSheet) => {
    setBusy(true);
    try {
      const { data } = await planStockReconcile(companyId, {
        asOf: monthEnd(month), sourceFile: file?.name,
        rows: (rows || []).map((r) => ({ ...r, chosenItemTypeId: nextChoices[r.sourceRow] ?? null })),
        useSheetQuantityItemTypeIds: nextUse ? [...nextUse] : null,
      });
      setPlan(data);
      setUseSheet(nextUse ?? new Set(data.items.filter((i) => i.useSheetQuantity).map((i) => i.itemTypeId)));
    } catch (e) {
      notify(e?.response?.data?.message || "Could not plan the reconciliation.", "error");
    } finally {
      setBusy(false);
    }
  };

  // Rows arrive -> plan them.
  useEffect(() => { if (rows) replan(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rows]);

  const onUpload = async (f) => {
    if (!f || !companyId) return;
    setFile(f); setBusy(true); setPlan(null); setChoices({}); setUseSheet(null);
    try {
      const { data: profiles } = await getImportProfiles({ kind: "OpeningStock", companyId });
      const profile = (profiles || []).find((p) => p.isDefault) || (profiles || [])[0];
      if (!profile) { notify("No stock sheet layout is set up yet.", "error"); return; }
      const { data } = await previewOpeningStock({ file: f, companyId, profileId: profile.id });
      if ((data.blockingErrors || []).length > 0) {
        setReaderNotes(data.blockingErrors);
        setRows(null);
        return;
      }
      setReaderNotes(data.warnings || []);
      setRows((data.rows || []).flatMap((row) => (row.lots || []).map((l) => ({
        sourceRow: l.sourceRow, itemNameOnSheet: l.itemNameOnSheet, hsCode: l.hsCode,
        lotRef: l.lotRef, lotDate: l.lotDate, claimMonth: l.claimMonth, unit: l.unit,
        balanceQuantity: l.balanceQuantity, balanceValueExcludingTax: l.balanceValueExcludingTax,
        balanceSalesTaxRate: l.balanceSalesTaxRate,
      }))));
    } catch (e) {
      notify(e?.response?.data?.message || "The sheet could not be read.", "error");
    } finally {
      setBusy(false);
    }
  };

  const choose = (sourceRow, value) => {
    const next = { ...choices };
    if (value === "") delete next[sourceRow]; else next[sourceRow] = Number(value);
    setChoices(next);
    replan(next, useSheet);
  };

  const toggleUse = (id) => {
    const next = new Set(useSheet || []);
    if (next.has(id)) next.delete(id); else next.add(id);
    setUseSheet(next);
    replan(choices, next);
  };

  const corrections = useMemo(() => (plan?.items || [])
    .filter((i) => useSheet?.has(i.itemTypeId) && Math.abs(i.sheetQuantity - i.onHand) > 0.00005), [plan, useSheet]);

  const apply = async () => {
    const ok = await confirm({
      title: "Reconcile the books to this sheet?",
      message: `${plan.items.filter((i) => !i.error).length} item(s) will hold the sheet's GD lines`
        + (corrections.length ? `, and ${corrections.length} quantity correction(s) will be dated ${monthEnd(month)}` : "")
        + `. Stock value goes from ${money(plan.currentValueExcludingTax)} to ${money(plan.plannedValueExcludingTax)}. All or nothing.`,
      confirmText: "Reconcile",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await applyStockReconcile(companyId, request({ useSheetQuantityItemTypeIds: [...(useSheet || [])] }));
      notify((data.messages || []).join(" ") || "Reconciled.", "success");
      setUseSheet(new Set());
      await replan(choices, new Set());
    } catch (e) {
      notify(e?.response?.data?.message || "The reconciliation was not applied.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!canRun)
    return <div style={st.page}><p style={st.muted}>You need stock policy and spreadsheet import permissions to reconcile stock.</p></div>;

  const changed = (plan?.items || []).filter((i) => i.error || Math.abs(i.targetValueExcludingTax - i.currentValueExcludingTax) > 0.005
    || Math.abs(i.targetQuantity - i.onHand) > 0.00005 || (useSheet?.has(i.itemTypeId) && Math.abs(i.sheetQuantity - i.onHand) > 0.00005));
  const same = (plan?.items || []).length - changed.length;

  return (
    <div style={st.page}>
      <Link to="/stock" style={st.back}><MdArrowBack size={16} /> Stock Dashboard</Link>
      <h1 style={st.h1}>Reconcile to my stock sheet</h1>
      <p style={st.muted}>
        Upload the month's stock sheet. Each row is matched to an item and its GD; the plan shows what would make the books
        hold the sheet. Nothing changes until you press Reconcile.
      </p>

      <div style={st.bar}>
        <label style={st.field}>
          <span style={st.label}>The sheet describes</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={st.input} disabled={busy} />
        </label>
        <label style={{ ...st.field, ...st.upload }}>
          <MdCloudUpload size={18} /> {file ? file.name : "Choose the stock sheet (.xlsx)"}
          <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} disabled={busy || !companyId}
            onChange={(e) => onUpload(e.target.files?.[0])} />
        </label>
      </div>

      {readerNotes.length > 0 && (
        <ul style={st.notes}>{readerNotes.map((n, i) => <li key={i}><MdWarningAmber size={14} /> {n}</li>)}</ul>
      )}
      {busy && <p style={st.muted}>Working…</p>}

      {plan && (
        <>
          <div style={st.tiles}>
            <Tile label="Books now" value={money(plan.currentValueExcludingTax)} />
            <Tile label="After reconcile" value={money(plan.plannedValueExcludingTax)} strong />
            <Tile label="Sheet total" value={money(plan.sheetValueExcludingTax)} />
            <Tile label="Items to change" value={`${changed.length} (${same} already match)`} />
          </div>

          {plan.unmatched.length > 0 && (
            <section style={st.card}>
              <h2 style={st.h2}><MdErrorOutline color="#b71c1c" /> Rows to decide ({plan.unmatched.length})</h2>
              {plan.unmatched.map((u) => (
                <div key={u.sourceRow} style={st.issue}>
                  <div style={st.issueText}>
                    <strong>Row {u.sourceRow}: {u.itemNameOnSheet}</strong> · {u.hsCode || "no HS"} · {u.gdNumber || "no GD"} ·{" "}
                    {qty(u.balanceQuantity)} / {money(u.balanceValueExcludingTax)}
                    <div style={st.muted}>{u.reason}</div>
                  </div>
                  <select value={choices[u.sourceRow] ?? ""} onChange={(e) => choose(u.sourceRow, e.target.value)}
                    disabled={busy} style={st.select}>
                    <option value="">Choose…</option>
                    {u.candidates.map((c) => <option key={c.itemTypeId} value={c.itemTypeId}>{c.itemTypeName} ({qty(c.onHand)} held)</option>)}
                    <option value="-1">Leave this row out</option>
                  </select>
                </div>
              ))}
            </section>
          )}

          <section style={st.card}>
            <h2 style={st.h2}>Items ({plan.items.length})</h2>
            {changed.length === 0 && <p style={st.muted}>Every item on the sheet already matches the books.</p>}
            {changed.map((i) => (
              <div key={i.itemTypeId} style={{ ...st.item, ...(i.error ? st.itemErr : null) }}>
                <button type="button" onClick={() => setOpen({ ...open, [i.itemTypeId]: !open[i.itemTypeId] })} style={st.itemHead}>
                  {open[i.itemTypeId] ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}
                  <span style={st.itemName}>{i.itemTypeName}</span>
                  <span style={st.itemFig}>{money(i.currentValueExcludingTax)} → <strong>{money(i.targetValueExcludingTax)}</strong></span>
                </button>
                <div style={st.itemMeta}>
                  {i.hsCode} · books hold {qty(i.onHand)}{i.unit ? ` ${i.unit}` : ""}, sheet {qty(i.sheetQuantity)}
                  {Math.abs(i.sheetQuantity - i.onHand) > 0.00005 && (
                    <label style={st.check}>
                      <input type="checkbox" checked={!!useSheet?.has(i.itemTypeId)} onChange={() => toggleUse(i.itemTypeId)} disabled={busy} />
                      Correct the quantity to the sheet's {qty(i.sheetQuantity)}
                      {i.proposeSheetQuantity ? " (suggested: a counted figure)" : " (not suggested: looks derived from value ÷ price)"}
                    </label>
                  )}
                </div>
                {i.error && <div style={st.err}>{i.error}</div>}
                {i.notes.map((n, k) => <div key={k} style={st.muted}>{n}</div>)}
                {open[i.itemTypeId] && (
                  <div style={{ overflowX: "auto" }}>
                    <table style={st.table}>
                      <thead><tr><th>GD</th><th>Row</th><th>Product</th><th>HS</th><th style={st.num}>Qty</th><th style={st.num}>Value</th><th style={st.num}>Now</th></tr></thead>
                      <tbody>
                        {i.lines.map((l) => (
                          <tr key={l.sourceRow}>
                            <td>{l.gdNumber}</td><td>{l.sourceRow}</td><td>{l.description}</td><td>{l.hsCode}</td>
                            <td style={st.num}>{qty(l.quantity)}</td><td style={st.num}>{money(l.valueExcludingTax)}</td>
                            <td style={st.num}>{l.currentValueExcludingTax == null ? "—" : money(l.currentValueExcludingTax)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </section>

          {(plan.notApplied.length > 0 || plan.notInSheet.length > 0) && (
            <section style={st.card}>
              <h2 style={st.h2}>Left as they are</h2>
              {plan.notApplied.map((u) => (
                <div key={`na${u.sourceRow}`} style={st.muted}>Row {u.sourceRow} · {u.itemNameOnSheet} · {money(u.balanceValueExcludingTax)} — {u.reason}</div>
              ))}
              {plan.notInSheet.map((n) => (
                <div key={`nis${n.itemTypeId}`} style={st.muted}>{n.itemTypeName} — holds {qty(n.onHand)} but is not on the sheet; not touched.</div>
              ))}
            </section>
          )}

          <div style={st.footer}>
            <span style={st.muted}>
              {plan.canApply ? `${corrections.length} quantity correction(s) · ${plan.items.filter((i) => !i.error).length} item(s) restated`
                : "Decide every highlighted row and item to continue."}
            </span>
            <button type="button" onClick={apply} disabled={busy || !plan.canApply || changed.length === 0} style={st.primary}>
              <MdDoneAll size={18} /> Reconcile
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, strong }) {
  return (
    <div style={st.tile}>
      <div style={st.tileLabel}>{label}</div>
      <div style={{ ...st.tileValue, ...(strong ? { color: colors.blue } : null) }}>{value}</div>
    </div>
  );
}

const st = {
  page: { padding: "1rem", maxWidth: 1100, margin: "0 auto" },
  back: { display: "inline-flex", alignItems: "center", gap: 4, color: colors.blue, fontSize: 13, textDecoration: "none", minHeight: 44 },
  h1: { margin: "0.25rem 0 0.4rem", fontSize: "1.35rem", color: colors.textPrimary },
  h2: { margin: "0 0 0.6rem", fontSize: "1rem", display: "flex", alignItems: "center", gap: 6 },
  muted: { color: "#5f6d7e", fontSize: 13, margin: "0.2rem 0" },
  bar: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem", margin: "0.75rem 0" },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 12, fontWeight: 700, color: "#5f6d7e" },
  input: { minHeight: 44, padding: "0.4rem 0.6rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: 14 },
  upload: { flexDirection: "row", alignItems: "center", justifyContent: "center", minHeight: 44, border: `1px dashed ${colors.blue}`,
    borderRadius: 8, color: colors.blue, cursor: "pointer", padding: "0.4rem 0.75rem", fontWeight: 600, overflowWrap: "anywhere" },
  notes: { listStyle: "none", padding: 0, margin: "0.5rem 0", color: "#8a4b00", fontSize: 13 },
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "0.6rem", margin: "0.75rem 0" },
  tile: { background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.7rem 0.85rem" },
  tileLabel: { fontSize: 12, color: "#5f6d7e", fontWeight: 600 },
  tileValue: { fontSize: "1.1rem", fontWeight: 700, color: colors.textPrimary, overflowWrap: "anywhere" },
  card: { background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.85rem", margin: "0.75rem 0" },
  issue: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: "0.5rem",
    padding: "0.55rem 0", borderTop: `1px solid ${colors.cardBorder}`, alignItems: "center" },
  issueText: { fontSize: 13.5, overflowWrap: "anywhere" },
  select: { width: "100%", minHeight: 44, padding: "0.4rem 0.6rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: 13.5 },
  item: { borderTop: `1px solid ${colors.cardBorder}`, padding: "0.55rem 0" },
  itemErr: { background: "#fff5f5" },
  itemHead: { display: "flex", alignItems: "center", gap: 6, width: "100%", minHeight: 44, background: "none", border: "none",
    padding: 0, cursor: "pointer", textAlign: "left", flexWrap: "wrap" },
  itemName: { flex: "1 1 220px", fontWeight: 700, fontSize: 14, color: colors.textPrimary, display: "-webkit-box",
    WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  itemFig: { fontSize: 13.5, color: colors.textPrimary },
  itemMeta: { fontSize: 12.5, color: "#5f6d7e", paddingLeft: 24, display: "flex", flexDirection: "column", gap: 4 },
  check: { display: "flex", alignItems: "center", gap: 6, minHeight: 44, color: colors.textPrimary, cursor: "pointer" },
  err: { color: "#b71c1c", fontSize: 13, paddingLeft: 24 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 6 },
  num: { textAlign: "right", whiteSpace: "nowrap" },
  footer: { background: "#fff", borderTop: `1px solid ${colors.cardBorder}`, padding: "0.75rem 0",
    display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", justifyContent: "space-between" },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0.5rem 1.1rem", borderRadius: 8,
    border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer" },
};
