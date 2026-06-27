import { useState } from "react";
import { MdCloudDownload, MdPlayArrow, MdCheckCircle, MdWarning } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { colors } from "../theme";
import { importMasters, importDocuments, importReceiptsPayments } from "../api/legacyImportApi";

/**
 * Accounting → Data Migration (admin/ops). Runs the legacy Data_2021 ETL into
 * the selected company. The steps are ordered (each depends on the previous);
 * the backend is triple-gated (accounting.import.run + non-Production +
 * LegacyDb configured), so this is a no-op / 404 in production.
 */
const STEPS = [
  { key: "masters", label: "1. Masters", run: importMasters,
    desc: "Chart of accounts + parties (Client/Supplier). Run this first." },
  { key: "documents", label: "2. Documents", run: importDocuments,
    desc: "Sales invoices + purchase bills (GL-anchored totals). Needs masters." },
  { key: "receipts", label: "3. Receipts & Payments", run: importReceiptsPayments,
    desc: "Receipts/payments + allocations; reflows invoice/bill balances. Needs documents." },
];

export default function DataMigrationPage() {
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canRun = has("accounting.import.run");
  const companyId = selectedCompany?.id;

  const [busy, setBusy] = useState(null);      // step key currently running
  const [results, setResults] = useState({});  // key -> result | {error}

  const runStep = async (step) => {
    if (!companyId || busy) return;
    setBusy(step.key);
    try {
      const { data } = await step.run(companyId);
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

  if (!canRun) {
    return <div style={{ padding: "2rem", color: colors.textSecondary }}>You don't have permission to run data migration.</div>;
  }

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)", maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <MdCloudDownload size={26} color={colors.blue} />
        <h2 style={{ margin: 0, fontSize: "1.4rem", color: colors.textPrimary }}>Data Migration</h2>
      </div>
      <p style={{ color: colors.textSecondary, marginTop: 0 }}>
        Import legacy <strong>Data_2021</strong> into the selected company. Run the steps in order.
        Each step is idempotent — re-running skips already-imported rows. Disabled in production.
      </p>

      <div style={st.banner}>
        <MdWarning size={18} color="#b26a00" style={{ flexShrink: 0 }} />
        <span>Import into a <strong>dedicated migration company</strong> — not a live tenant. Create the target company first, then select it above.</span>
      </div>

      {!companyId ? (
        <div style={st.empty}>Select a company (top bar) to import into.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", marginTop: "1rem" }}>
          <div style={{ fontSize: "0.85rem", color: colors.textSecondary }}>
            Target: <strong style={{ color: colors.textPrimary }}>{selectedCompany.name}</strong> (id {companyId})
          </div>
          {STEPS.map((step) => {
            const res = results[step.key];
            const running = busy === step.key;
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
                  style={{ ...st.runBtn, opacity: running || busy ? 0.6 : 1 }}
                  disabled={!!busy}
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
};
