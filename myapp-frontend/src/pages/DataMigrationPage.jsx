import { useState } from "react";
import { MdCloudUpload, MdPlayArrow, MdCheckCircle, MdWarning, MdDelete, MdStorage } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { colors } from "../theme";
import {
  uploadBackup, cleanupBackup, importMasters, importDocuments, importReceiptsPayments,
} from "../api/legacyImportApi";

/**
 * Accounting → Data Migration (admin/ops). Upload a legacy Data_2021 `.bak`;
 * the server restores it to a temp DB, then the ordered steps migrate it into
 * the selected company: divisions (from CompanyProfiles), chart of accounts +
 * parties, then documents (sales invoices + quotes division-tagged, purchase
 * bills company-level) and receipts/payments. Backend is triple-gated
 * (accounting.import.run + non-Production + a reachable SQL Server) — a no-op
 * in production. Import into a DEDICATED company, not a live tenant.
 */
const STEPS = [
  { key: "masters", label: "1. Divisions, Chart of Accounts & Parties", run: importMasters,
    desc: "Creates a division per CompanyProfile, the chart of accounts, and Client/Supplier parties. Run first." },
  { key: "documents", label: "2. Documents", run: importDocuments,
    desc: "Sales invoices, quotes, orders & delivery challans (division-tagged) and purchase bills (company-level). Seeds per-division next numbers. Needs masters." },
  { key: "receipts", label: "3. Receipts & Payments", run: importReceiptsPayments,
    desc: "Receipts/payments + allocations; reflows invoice/bill balances. Needs documents." },
];

export default function DataMigrationPage() {
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canRun = has("accounting.import.run");
  const companyId = selectedCompany?.id;

  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [restore, setRestore] = useState(null);   // { sourceDb, costCentreName, divisions, salesInvoices, ... }
  const [busy, setBusy] = useState(null);          // step key currently running
  const [results, setResults] = useState({});      // key -> result | {error}

  const sourceDb = restore?.sourceDb;

  const doUpload = async () => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const { data } = await uploadBackup(file);
      setRestore(data);
      setResults({});
      notify(`Backup restored (${data.sourceDb}).`, "success");
    } catch (err) {
      const msg = err.response?.data?.error || (err.response?.status === 404
        ? "Import is disabled in this environment." : "Restore failed.");
      notify(msg, "error");
    } finally {
      setUploading(false);
    }
  };

  const runStep = async (step) => {
    if (!companyId || !sourceDb || busy) return;
    setBusy(step.key);
    try {
      const { data } = await step.run(companyId, sourceDb);
      setResults((r) => ({ ...r, [step.key]: data }));
      notify(`${step.label} import done.`, "success");
    } catch (err) {
      const msg = err.response?.data?.error || (err.response?.status === 404
        ? "Import is disabled in this environment." : "Import failed.");
      setResults((r) => ({ ...r, [step.key]: { error: msg } }));
      notify(msg, "error");
    } finally {
      setBusy(null);
    }
  };

  const doCleanup = async () => {
    if (!sourceDb || busy) return;
    try {
      await cleanupBackup(sourceDb);
      notify("Temporary restore database dropped.", "success");
      setRestore(null);
      setResults({});
      setFile(null);
    } catch (err) {
      notify(err.response?.data?.error || "Cleanup failed.", "error");
    }
  };

  if (!canRun) {
    return <div style={{ padding: "2rem", color: colors.textSecondary }}>You don't have permission to run data migration.</div>;
  }

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)", maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <MdCloudUpload size={26} color={colors.blue} />
        <h2 style={{ margin: 0, fontSize: "1.4rem", color: colors.textPrimary }}>Data Migration</h2>
      </div>
      <p style={{ color: colors.textSecondary, marginTop: 0 }}>
        Upload a legacy <strong>.bak</strong> backup; the server restores it and the steps import it into the
        selected company. Each step is idempotent — re-running skips already-imported rows. Disabled in production.
      </p>

      <div style={st.banner}>
        <MdWarning size={18} color="#b26a00" style={{ flexShrink: 0 }} />
        <span>Import into a <strong>dedicated migration company</strong> — not a live tenant. Create the target company first, then select it in the top bar.</span>
      </div>

      {/* Step 0 — Upload backup */}
      <div style={{ ...st.card, marginTop: "1rem", flexDirection: "column", alignItems: "stretch", gap: "0.6rem" }}>
        <div style={st.stepLabel}>0. Upload backup (.bak)</div>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <input type="file" accept=".bak" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={uploading || !!sourceDb} />
          <button
            style={{ ...st.runBtn, opacity: !file || uploading || sourceDb ? 0.6 : 1 }}
            disabled={!file || uploading || !!sourceDb}
            onClick={doUpload}
          >
            <MdCloudUpload size={16} /> {uploading ? "Restoring…" : "Upload & restore"}
          </button>
        </div>

        {restore && (
          <div style={st.summary}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: colors.textPrimary }}>
              <MdStorage size={16} color={colors.blue} /> Restored: <code style={st.code}>{restore.sourceDb}</code>
            </div>
            <div style={st.summaryGrid}>
              <span>Cost centre: <strong>{restore.costCentreName || "—"}</strong></span>
              <span>Sales invoices: <strong>{restore.salesInvoices}</strong></span>
              <span>Sales quotes: <strong>{restore.salesQuotes}</strong></span>
              <span>Purchase bills: <strong>{restore.purchaseBills}</strong></span>
            </div>
            <div style={{ fontSize: "0.8rem", color: colors.textSecondary }}>
              Divisions to create: {restore.divisions?.length
                ? restore.divisions.map((d) => <span key={d} style={st.chip}>{d}</span>)
                : "—"}
            </div>
            <button style={st.dangerBtn} onClick={doCleanup} disabled={!!busy}>
              <MdDelete size={15} /> Finish &amp; clean up (drop temp DB)
            </button>
          </div>
        )}
      </div>

      {!companyId ? (
        <div style={st.empty}>Select a company (top bar) to import into.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", marginTop: "1rem" }}>
          <div style={{ fontSize: "0.85rem", color: colors.textSecondary }}>
            Target: <strong style={{ color: colors.textPrimary }}>{selectedCompany.name}</strong> (id {companyId})
            {!sourceDb && <span style={{ color: "#b26a00" }}> — upload a backup above to enable the steps.</span>}
          </div>
          {STEPS.map((step) => {
            const res = results[step.key];
            const running = busy === step.key;
            const disabled = !!busy || !sourceDb;
            return (
              <div key={step.key} style={st.card}>
                <div style={{ flex: 1 }}>
                  <div style={st.stepLabel}>{step.label}</div>
                  <div style={st.stepDesc}>{step.desc}</div>
                  {res && !res.error && (
                    <div style={st.result}>
                      <MdCheckCircle size={14} color="#2e7d32" />
                      <span>{Object.entries(res.created || {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "Done"}</span>
                    </div>
                  )}
                  {res?.notes?.length > 0 && (
                    <ul style={st.notes}>{res.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  )}
                  {res?.error && <div style={st.err}>{res.error}</div>}
                </div>
                <button
                  style={{ ...st.runBtn, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
                  disabled={disabled}
                  onClick={() => runStep(step)}
                >
                  <MdPlayArrow size={16} /> {running ? "Running…" : "Run"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const st = {
  banner: { display: "flex", gap: 8, alignItems: "center", background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: "0.82rem", color: "#7a5b00" },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
  card: { display: "flex", gap: "1rem", alignItems: "flex-start", background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.9rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" },
  stepLabel: { fontWeight: 800, color: colors.textPrimary, fontSize: "0.95rem" },
  stepDesc: { fontSize: "0.82rem", color: colors.textSecondary, marginTop: 2 },
  result: { display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: "0.82rem", color: colors.textPrimary, fontWeight: 600 },
  notes: { margin: "6px 0 0", paddingLeft: 18, fontSize: "0.76rem", color: colors.textSecondary },
  err: { marginTop: 8, fontSize: "0.82rem", color: colors.danger, fontWeight: 600 },
  runBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", minHeight: 44, borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer", flexShrink: 0 },
  summary: { display: "flex", flexDirection: "column", gap: 8, background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 8, padding: "0.7rem 0.85rem", marginTop: 4 },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px,100%),1fr))", gap: "0.4rem", fontSize: "0.82rem", color: colors.textSecondary },
  code: { fontFamily: "monospace", fontSize: "0.78rem", background: "#fff", padding: "1px 6px", borderRadius: 4, border: `1px solid ${colors.cardBorder}` },
  chip: { display: "inline-block", margin: "0 4px 4px 0", padding: "1px 8px", borderRadius: 12, background: "#e3f2fd", color: "#0d47a1", fontSize: "0.72rem", fontWeight: 700 },
  dangerBtn: { display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start", padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.danger}`, background: "#fff", color: colors.danger, fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" },
};
