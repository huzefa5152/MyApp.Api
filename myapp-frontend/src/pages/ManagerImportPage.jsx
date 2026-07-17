import { useState } from "react";
import { MdCloudUpload, MdPlayArrow, MdCheckCircle, MdWarning, MdBalance } from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import { useCompany } from "../contexts/CompanyContext";
import { notify } from "../utils/notify";
import { colors } from "../theme";
import { runManagerImport } from "../api/managerImportApi";

/**
 * Accounting → Manager.io Import. Upload a .zip of an exported Manager.io
 * business (the scripts/pull_details.py output — the folder containing the
 * `detail/` subfolder) and load it into a MyApp company. Runs through EF on the
 * server, so it works on the LIVE server as well as locally. Idempotent per
 * ExternalRef; defaults to a dry-run so you can review counts + the AR/AP
 * reconciliation before committing. Import into a DEDICATED company.
 */
const money = (n) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ManagerImportPage() {
  const { has } = usePermissions();
  const { companies } = useCompany();
  const canRun = has("accounting.import.manager");

  const [file, setFile] = useState(null);
  const [trialBalance, setTrialBalance] = useState(null);
  const [mode, setMode] = useState("new");            // "new" | "existing"
  const [companyName, setCompanyName] = useState("Al-Qahera Trading Co.");
  const [companyId, setCompanyId] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [fresh, setFresh] = useState(false);
  // Full General Ledger (perpetual): build a journal entry per document + true-up
  // so the CoA matches Manager with GL posting ENABLED (needs the trial balance +
  // a perpetual/ folder in the zip). Off = snapshot (opening balances, GL off).
  const [perpetual, setPerpetual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);

  const existing = mode === "existing";
  const targetOk = existing ? !!companyId : !!companyName.trim();

  const run = async () => {
    if (!file || !targetOk || busy) return;
    const label = existing
      ? ((companies || []).find((c) => String(c.id) === String(companyId))?.name || `company ${companyId}`)
      : companyName.trim();
    if (!dryRun && !window.confirm(`Commit the import into "${label}"? This writes to the database.`)) return;
    setBusy(true);
    setReport(null);
    try {
      const { data } = await runManagerImport({
        file, trialBalance,
        companyName: companyName.trim(),
        companyId: existing ? Number(companyId) : undefined,
        dryRun, fresh, perpetual,
      });
      setReport(data);
      notify(data.dryRun ? "Dry run complete — nothing persisted." : "Import committed.", "success");
    } catch (err) {
      notify(err.response?.data?.error || "Import failed. See server logs.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!canRun) {
    return <div style={{ padding: "2rem", color: colors.textSecondary }}>You don't have permission to run the Manager.io import.</div>;
  }

  const arMatch = report && Math.abs((report.arManager ?? 0) - (report.arMyApp ?? 0)) < 0.01;
  const apMatch = report && Math.abs((report.apManager ?? 0) - (report.apMyApp ?? 0)) < 0.01;

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)", maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <MdCloudUpload size={26} color={colors.blue} />
        <h2 style={{ margin: 0, fontSize: "1.4rem", color: colors.textPrimary }}>Manager.io Import</h2>
      </div>
      <p style={{ color: colors.textSecondary, marginTop: 0 }}>
        Upload a <strong>.zip</strong> of an exported Manager.io business (the folder containing the{" "}
        <code style={st.code}>detail/</code> subfolder) and, optionally, the Manager <strong>Trial Balance</strong> (.txt).
        Loads divisions, clients/suppliers, sales &amp; purchase documents, receipts/payments, credit notes,
        withholding-tax receipts, and — from the trial balance — the chart of accounts as opening balances so the
        balance sheet &amp; P&amp;L match Manager. Idempotent; works on the live server.
      </p>

      <div style={st.banner}>
        <MdWarning size={18} color="#b26a00" style={{ flexShrink: 0 }} />
        <span>Import into a <strong>dedicated company</strong> — not an existing live tenant. Leave <strong>Dry run</strong> on first to review the counts and the AR/AP reconciliation.</span>
      </div>

      <div style={{ ...st.card, marginTop: "1rem", flexDirection: "column", alignItems: "stretch", gap: "0.7rem" }}>
        <div style={st.field}>
          <span style={st.fieldLabel}>Import into</span>
          <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap" }}>
            <label style={st.check}><input type="radio" name="target" checked={!existing} onChange={() => setMode("new")} disabled={busy} /> New company</label>
            <label style={st.check}><input type="radio" name="target" checked={existing} onChange={() => setMode("existing")} disabled={busy} /> Existing company</label>
          </div>
        </div>

        {existing ? (
          <label style={st.field}>
            <span style={st.fieldLabel}>Existing company</span>
            <select style={st.input} value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={busy}>
              <option value="">Select a company…</option>
              {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name} (id {c.id})</option>)}
            </select>
            <span style={{ fontSize: "0.75rem", color: "#b26a00" }}>Importing into a company that already has data requires <strong>Fresh</strong> (it wipes that company first).</span>
          </label>
        ) : (
          <label style={st.field}>
            <span style={st.fieldLabel}>New company name</span>
            <input style={st.input} value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={busy}
              placeholder="e.g. Al-Qahera Trading Co." />
          </label>
        )}

        <label style={st.field}>
          <span style={st.fieldLabel}>Export archive (.zip) — documents</span>
          <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} />
        </label>

        <label style={st.field}>
          <span style={st.fieldLabel}>Trial Balance (.txt) — optional, for the chart of accounts / balance sheet</span>
          <input type="file" accept=".txt,.tsv,.csv" onChange={(e) => setTrialBalance(e.target.files?.[0] || null)} disabled={busy} />
        </label>

        <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap", alignItems: "center" }}>
          <label style={st.check}><input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} disabled={busy} /> Dry run (validate, roll back)</label>
          <label style={st.check}><input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} disabled={busy} /> Fresh (wipe existing data first)</label>
          <label style={st.check} title="Build the full General Ledger (a journal entry per document + true-up) so the Chart of Accounts matches Manager with GL posting ENABLED. Requires the Trial Balance + a perpetual/ folder in the zip. On an existing company, only the CoA + GL are rebuilt (documents untouched).">
            <input type="checkbox" checked={perpetual} onChange={(e) => setPerpetual(e.target.checked)} disabled={busy} /> Full General Ledger (match Manager with GL on)
          </label>
        </div>

        <button
          style={{ ...st.runBtn, opacity: !file || !targetOk || busy ? 0.55 : 1, cursor: !file || !targetOk || busy ? "not-allowed" : "pointer", background: dryRun ? colors.blue : colors.danger }}
          disabled={!file || !targetOk || busy}
          onClick={run}
        >
          <MdPlayArrow size={16} /> {busy ? "Running…" : dryRun ? "Run dry run" : "Commit import"}
        </button>
      </div>

      {report && (
        <div style={{ ...st.card, marginTop: "1rem", flexDirection: "column", alignItems: "stretch", gap: "0.7rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 800, color: colors.textPrimary }}>
            <MdCheckCircle size={18} color={report.dryRun ? "#b26a00" : "#2e7d32"} />
            {report.dryRun ? "Dry run" : "Imported"} — {report.companyName} (id {report.companyId})
          </div>

          <div style={st.summaryGrid}>
            {Object.entries(report.created || {}).map(([k, v]) => (
              <span key={k} style={st.stat}><strong>{v}</strong> {k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
            ))}
          </div>

          <div style={st.recon}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: colors.textPrimary }}>
              <MdBalance size={16} color={colors.blue} /> Reconciliation
            </div>
            <table style={st.table}>
              <thead><tr><th style={st.th}></th><th style={st.thNum}>Manager</th><th style={st.thNum}>MyApp</th><th style={st.th}></th></tr></thead>
              <tbody>
                <tr><td style={st.td}>Sales invoiced</td><td style={st.tdNum}>—</td><td style={st.tdNum}>{money(report.salesTotal)}</td><td style={st.td}></td></tr>
                <tr><td style={st.td}>AR outstanding</td><td style={st.tdNum}>{money(report.arManager)}</td><td style={st.tdNum}>{money(report.arMyApp)}</td><td style={st.td}>{arMatch ? <span style={st.ok}>✓ match</span> : <span style={st.warn}>≠</span>}</td></tr>
                <tr><td style={st.td}>AP outstanding</td><td style={st.tdNum}>{money(report.apManager)}</td><td style={st.tdNum}>{money(report.apMyApp)}</td><td style={st.td}>{apMatch ? <span style={st.ok}>✓ match</span> : <span style={st.warn}>≠</span>}</td></tr>
              </tbody>
            </table>
          </div>

          {report.notes?.length > 0 && <ul style={st.notes}>{report.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

const st = {
  banner: { display: "flex", gap: 8, alignItems: "center", background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: "0.82rem", color: "#7a5b00" },
  card: { display: "flex", gap: "1rem", alignItems: "flex-start", background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.9rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  fieldLabel: { fontSize: "0.8rem", fontWeight: 700, color: colors.textSecondary },
  input: { padding: "0.55rem 0.7rem", minHeight: 44, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: colors.inputBg, color: colors.textPrimary, fontSize: "0.9rem" },
  check: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: colors.textPrimary, fontWeight: 600 },
  runBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0.6rem 1rem", minHeight: 44, borderRadius: 8, border: "none", color: "#fff", fontWeight: 700, alignSelf: "flex-start" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px,100%),1fr))", gap: "0.5rem" },
  stat: { fontSize: "0.82rem", color: colors.textSecondary, background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 8, padding: "0.4rem 0.6rem" },
  recon: { display: "flex", flexDirection: "column", gap: 6, background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 8, padding: "0.7rem 0.85rem" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" },
  th: { textAlign: "left", color: colors.textSecondary, fontWeight: 700, padding: "2px 6px" },
  thNum: { textAlign: "right", color: colors.textSecondary, fontWeight: 700, padding: "2px 6px" },
  td: { textAlign: "left", color: colors.textPrimary, padding: "2px 6px" },
  tdNum: { textAlign: "right", color: colors.textPrimary, padding: "2px 6px", fontVariantNumeric: "tabular-nums" },
  ok: { color: "#2e7d32", fontWeight: 700 },
  warn: { color: "#b26a00", fontWeight: 700 },
  notes: { margin: "2px 0 0", paddingLeft: 18, fontSize: "0.78rem", color: colors.textSecondary },
  code: { fontFamily: "monospace", fontSize: "0.78rem", background: colors.inputBg, padding: "1px 5px", borderRadius: 4, border: `1px solid ${colors.cardBorder}` },
};
