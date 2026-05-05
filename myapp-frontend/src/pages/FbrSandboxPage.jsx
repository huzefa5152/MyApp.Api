import { useEffect, useState } from "react";
import { MdScience, MdAdd, MdRefresh, MdSend, MdDelete, MdInfo, MdCheckCircle, MdError } from "react-icons/md";
import {
  listSandbox, seedSandbox, validateAllSandbox, submitAllSandbox,
  deleteSandboxBill, deleteAllSandbox,
} from "../api/fbrSandboxApi";
import { getFbrApplicableScenarios } from "../api/fbrApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  success: "#2e7d32",
  successBg: "#e8f5e9",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  warn: "#f57c00",
  warnBg: "#fff8e1",
};

/**
 * FBR Sandbox tab — auto-seeds + runs FBR Digital Invoicing scenario
 * test bills against the chosen company without consuming its real
 * bill / challan numbering. Demo numbering uses the 900000+ range and
 * is filtered out of the regular Bills / Challans pages.
 *
 * RBAC: page hidden from sidebar unless `fbr.sandbox.view` is granted.
 * Each action button (Seed / Validate / Submit / Delete) gated by the
 * matching `fbr.sandbox.{seed|run|delete}` permission. Server enforces
 * the same gates regardless.
 */
export default function FbrSandboxPage() {
  // Pull the company list from the global context (already loaded for
  // every authenticated user), but DO NOT bind to the global "selected
  // company" — the sandbox tab keeps its own dropdown state. That way
  // running scenario tests for "Hakimi Test Clean" doesn't require the
  // operator to switch the global selection (which would impact every
  // other page they navigate to afterwards).
  const { companies, selectedCompany: globalCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();

  const canView   = has("fbr.sandbox.view");
  const canSeed   = has("fbr.sandbox.seed");
  const canRun    = has("fbr.sandbox.run");
  const canDelete = has("fbr.sandbox.delete");

  // Sandbox-local "which company are we testing" picker. Defaults to
  // whatever the global context has, but the user can override here
  // without side-effects elsewhere.
  const [companyId, setCompanyId] = useState(globalCompany?.id ?? "");
  useEffect(() => {
    if (!companyId && globalCompany?.id) setCompanyId(globalCompany.id);
    // If there's no global company but companies have loaded, default to first
    if (!companyId && (companies?.length ?? 0) > 0) setCompanyId(companies[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalCompany?.id, companies?.length]);

  const selectedCompany = (companies || []).find((c) => c.id === Number(companyId)) || null;

  const [bills, setBills] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const refresh = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        listSandbox(selectedCompany.id),
        getFbrApplicableScenarios(selectedCompany.id).catch(() => ({ data: { scenarios: [] } })),
      ]);
      setBills(a.data || []);
      setScenarios(b.data?.scenarios || []);
    } catch {
      notify("Failed to load sandbox data.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (canView) refresh(); /* eslint-disable-next-line */ }, [companyId]);

  const handleSeed = async () => {
    setRunning(true);
    try {
      const { data } = await seedSandbox(selectedCompany.id);
      notify(`Seeded ${data.created} demo bill(s); skipped ${data.skipped} (already present).`, "success");
      await refresh();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to seed scenarios.", "error");
    } finally {
      setRunning(false);
    }
  };

  const handleRun = async (mode) => {
    setRunning(true);
    try {
      const { data } = mode === "submit"
        ? await submitAllSandbox(selectedCompany.id)
        : await validateAllSandbox(selectedCompany.id);
      const verb = mode === "submit" ? "submitted" : "validated";
      notify(`${data.passed} ${verb} successfully · ${data.failed} failed.`, data.failed === 0 ? "success" : "warn");
      await refresh();
    } catch {
      notify(`Failed to ${mode === "submit" ? "submit" : "validate"} all.`, "error");
    } finally {
      setRunning(false);
    }
  };

  const handleDeleteBill = async (b) => {
    const ok = await confirm({
      title: "Delete demo bill?",
      message: `Drop demo bill #${b.invoiceNumber} (${b.scenarioCode})? This removes the bill and its demo challan. The IRN (if any) stays on PRAL's record.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteSandboxBill(selectedCompany.id, b.id);
      await refresh();
    } catch {
      notify("Failed to delete demo bill.", "error");
    }
  };

  const handleDeleteAll = async () => {
    const ok = await confirm({
      title: "Wipe ALL demo bills?",
      message: "Remove every demo bill + demo challan for this company. Submitted IRNs remain on PRAL's record.",
      variant: "danger",
      confirmText: "Delete all",
    });
    if (!ok) return;
    try {
      const { data } = await deleteAllSandbox(selectedCompany.id);
      notify(`Deleted ${data.deleted} demo bill(s).`, "success");
      await refresh();
    } catch {
      notify("Failed to wipe sandbox data.", "error");
    }
  };

  if (!canView) {
    return (
      <div style={styles.deniedBox}>
        <h3>Access denied</h3>
        <p>You don't have permission to view the FBR Sandbox tab. Ask an administrator to grant you the <code>fbr.sandbox.view</code> permission.</p>
      </div>
    );
  }

  const seededSns = new Set(bills.map((b) => b.scenarioCode));
  const unseededScenarios = scenarios.filter((s) => !seededSns.has(s.code));

  return (
    <div className="fbr-page" style={styles.page}>
      <header style={styles.header}>
        <div>
          <h2 style={styles.title}><MdScience size={22} style={{ verticalAlign: "middle", marginRight: "0.4rem" }} />FBR Sandbox</h2>
          <p style={styles.subtitle}>
            Validate FBR scenario test bills for the selected company without
            touching its real bill numbering. Demo bills live in the <code>900000+</code> range and are
            invisible to the regular Bills / Challans pages.
          </p>
        </div>
        <div style={styles.headerActions}>
          {/* Page-local company picker — independent of the global top-bar
              company switcher so testing scenarios for one company doesn't
              change which company the rest of the app is showing. */}
          <select
            style={styles.companySelect}
            value={companyId || ""}
            onChange={(e) => setCompanyId(Number(e.target.value) || "")}
            aria-label="Company"
          >
            <option value="">— Pick a company —</option>
            {(companies || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button onClick={refresh} style={styles.iconBtn} title="Reload" disabled={!selectedCompany}><MdRefresh /></button>
          {canSeed && (
            <button onClick={handleSeed} disabled={running || !selectedCompany} style={styles.primaryBtn}>
              <MdAdd /> Seed Applicable Scenarios
            </button>
          )}
        </div>
      </header>

      {!selectedCompany ? (
        <div style={styles.emptyState}>
          <h3>Pick a company</h3>
          <p>Select a company in the dropdown above to view or seed FBR sandbox scenarios for it.</p>
        </div>
      ) : (
      <>
      {/* Profile summary */}
      <div style={styles.profileCard}>
        <div><b>Company:</b> {selectedCompany.name}</div>
        <div><b>Activity:</b> {selectedCompany.fbrBusinessActivity || <em style={styles.muted}>not set</em>}</div>
        <div><b>Sector:</b> {selectedCompany.fbrSector || <em style={styles.muted}>not set</em>}</div>
        <div><b>Applicable scenarios:</b> {scenarios.length} ({scenarios.map((s) => s.code).join(", ") || "—"})</div>
      </div>

      {/* Unseeded scenarios warning */}
      {unseededScenarios.length > 0 && bills.length > 0 && (
        <div style={styles.infoBox}>
          <MdInfo /> {unseededScenarios.length} scenario(s) not yet seeded: {unseededScenarios.map((s) => s.code).join(", ")}.
          {canSeed && <> Click <b>Seed Applicable Scenarios</b> to generate them.</>}
        </div>
      )}

      {/* Bulk actions row */}
      <div style={styles.bulkBar}>
        {canRun && bills.length > 0 && (
          <>
            <button onClick={() => handleRun("validate")} disabled={running} style={styles.actionBtn}>
              <MdCheckCircle /> Validate All
            </button>
            <button onClick={() => handleRun("submit")} disabled={running} style={styles.submitBtn}>
              <MdSend /> Submit All
            </button>
          </>
        )}
        {canDelete && bills.length > 0 && (
          <button onClick={handleDeleteAll} disabled={running} style={styles.dangerBtn}>
            <MdDelete /> Wipe All
          </button>
        )}
        {running && <span style={styles.runningBadge}>Running…</span>}
      </div>

      {/* Bills table */}
      {loading ? (
        <div style={styles.muted}>Loading…</div>
      ) : bills.length === 0 ? (
        <div style={styles.emptyState}>
          <h3>No demo bills yet</h3>
          <p>{canSeed ? "Click \"Seed Applicable Scenarios\" to generate one demo bill per scenario." : "Ask an admin to grant you fbr.sandbox.seed."}</p>
        </div>
      ) : (
        <>
          {/* Desktop / tablet — table */}
          <div className="fbr-table" style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.thead}>
                  <th style={styles.th}>SN</th>
                  <th style={styles.th}>Bill #</th>
                  <th style={styles.th}>Description</th>
                  <th style={styles.th}>Client</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Total</th>
                  <th style={styles.th}>FBR Status</th>
                  <th style={styles.th}>IRN / Error</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id}>
                    <td style={{ ...styles.td, fontWeight: 700, color: colors.blue }}>{b.scenarioCode}</td>
                    <td style={styles.td}>{b.invoiceNumber}</td>
                    <td style={styles.td}>{b.description}</td>
                    <td style={styles.td}>{b.clientName}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>Rs. {Math.round(b.grandTotal).toLocaleString()}</td>
                    <td style={styles.td}>
                      {b.fbrStatus === "Submitted" ? (
                        <span style={styles.successBadge}>Submitted</span>
                      ) : b.fbrStatus === "Validated" ? (
                        <span style={styles.warnBadge}>Validated</span>
                      ) : b.fbrStatus === "Failed" ? (
                        <span style={styles.failBadge}>Failed</span>
                      ) : (
                        <span style={styles.muted}>—</span>
                      )}
                    </td>
                    <td style={{ ...styles.td, fontSize: "0.74rem", maxWidth: 300, wordBreak: "break-all" }}>
                      {b.fbrIRN ? (
                        <code style={styles.irn}>{b.fbrIRN}</code>
                      ) : b.fbrErrorMessage ? (
                        <span title={b.fbrErrorMessage} style={{ color: colors.danger }}>
                          <MdError size={12} /> {b.fbrErrorMessage.slice(0, 60)}…
                        </span>
                      ) : (
                        <span style={styles.muted}>—</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      {canDelete && (
                        <button onClick={() => handleDeleteBill(b)} style={styles.iconBtnSmall} title="Delete">
                          <MdDelete size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile — stacked cards. Scenario code top-left bold blue +
              FBR status badge top-right; total prominent on its own row;
              IRN/error wraps freely at the bottom. */}
          <div className="fbr-cards">
            {bills.map((b) => (
              <div key={b.id} className="fbr-card">
                <div className="fbr-card__top">
                  <div className="fbr-card__sn-wrap">
                    <span className="fbr-card__sn">{b.scenarioCode}</span>
                    <span className="fbr-card__bill">Bill #{b.invoiceNumber}</span>
                  </div>
                  {b.fbrStatus === "Submitted" ? (
                    <span className="fbr-card__status fbr-card__status--success">Submitted</span>
                  ) : b.fbrStatus === "Validated" ? (
                    <span className="fbr-card__status fbr-card__status--warn">Validated</span>
                  ) : b.fbrStatus === "Failed" ? (
                    <span className="fbr-card__status fbr-card__status--fail">Failed</span>
                  ) : (
                    <span className="fbr-card__status fbr-card__status--muted">Pending</span>
                  )}
                </div>

                <div className="fbr-card__desc">{b.description}</div>

                <div className="fbr-card__meta">
                  <div className="fbr-card__field">
                    <span className="fbr-card__field-label">Client</span>
                    <span className="fbr-card__field-value">{b.clientName}</span>
                  </div>
                  <div className="fbr-card__field">
                    <span className="fbr-card__field-label">Total</span>
                    <span className="fbr-card__field-value fbr-card__total">
                      Rs. {Math.round(b.grandTotal).toLocaleString()}
                    </span>
                  </div>
                </div>

                {b.fbrIRN ? (
                  <div className="fbr-card__irn">
                    <span className="fbr-card__field-label">IRN</span>
                    <code className="fbr-card__irn-value">{b.fbrIRN}</code>
                  </div>
                ) : b.fbrErrorMessage ? (
                  <div className="fbr-card__error" title={b.fbrErrorMessage}>
                    <MdError size={14} /> {b.fbrErrorMessage}
                  </div>
                ) : null}

                {canDelete && (
                  <button className="fbr-card__delete" onClick={() => handleDeleteBill(b)}>
                    <MdDelete size={14} /> Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}

const styles = {
  page: { padding: "1.25rem 1.5rem", maxWidth: 1400 },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" },
  title: { fontSize: "1.4rem", fontWeight: 800, color: colors.textPrimary, margin: 0 },
  subtitle: { fontSize: "0.86rem", color: colors.textSecondary, margin: "0.25rem 0 0", maxWidth: 720 },
  headerActions: { display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" },
  companySelect: { padding: "0.5rem 0.75rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 6, backgroundColor: "#fff", color: colors.textPrimary, fontSize: "0.85rem", fontWeight: 600, minWidth: 200, cursor: "pointer" },
  iconBtn: { padding: "0.5rem", border: `1px solid ${colors.cardBorder}`, borderRadius: 6, backgroundColor: "#fff", cursor: "pointer", color: colors.textPrimary, display: "flex", alignItems: "center" },
  primaryBtn: { padding: "0.5rem 1rem", border: "none", borderRadius: 6, backgroundColor: colors.blue, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: "0.84rem", display: "flex", alignItems: "center", gap: "0.35rem" },
  profileCard: { display: "flex", flexWrap: "wrap", gap: "1.5rem", padding: "0.75rem 1rem", backgroundColor: "#f5f7fa", borderRadius: 6, fontSize: "0.82rem", color: colors.textPrimary, marginBottom: "1rem" },
  infoBox: { display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 0.85rem", backgroundColor: "#e3f2fd", color: colors.textPrimary, borderRadius: 6, marginBottom: "1rem", fontSize: "0.82rem", border: "1px solid #90caf9" },
  bulkBar: { display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" },
  actionBtn: { padding: "0.45rem 0.85rem", border: "none", borderRadius: 6, backgroundColor: colors.teal, color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" },
  submitBtn: { padding: "0.45rem 0.85rem", border: "none", borderRadius: 6, backgroundColor: colors.blue, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" },
  dangerBtn: { padding: "0.45rem 0.85rem", border: "none", borderRadius: 6, backgroundColor: colors.danger, color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" },
  runningBadge: { padding: "0.25rem 0.6rem", backgroundColor: colors.warnBg, color: colors.warn, borderRadius: 4, fontSize: "0.75rem", fontWeight: 700 },
  emptyState: { textAlign: "center", padding: "2.5rem 1rem", color: colors.textSecondary, backgroundColor: "#f5f7fa", borderRadius: 8, border: `1px dashed ${colors.cardBorder}` },
  tableWrap: { width: "100%", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse" },
  thead: { backgroundColor: "#f5f7fa" },
  th: { padding: "0.6rem 0.75rem", textAlign: "left", fontSize: "0.74rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${colors.cardBorder}` },
  td: { padding: "0.55rem 0.75rem", fontSize: "0.84rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "middle" },
  successBadge: { padding: "0.15rem 0.5rem", backgroundColor: colors.successBg, color: colors.success, borderRadius: 4, fontSize: "0.72rem", fontWeight: 700 },
  warnBadge: { padding: "0.15rem 0.5rem", backgroundColor: colors.warnBg, color: colors.warn, borderRadius: 4, fontSize: "0.72rem", fontWeight: 700 },
  failBadge: { padding: "0.15rem 0.5rem", backgroundColor: colors.dangerLight, color: colors.danger, borderRadius: 4, fontSize: "0.72rem", fontWeight: 700 },
  irn: { fontFamily: "monospace", fontSize: "0.72rem", color: colors.success },
  muted: { color: colors.textSecondary, fontStyle: "italic", fontSize: "0.84rem" },
  iconBtnSmall: { padding: "0.25rem", border: "none", backgroundColor: "transparent", color: colors.danger, cursor: "pointer", display: "flex", alignItems: "center" },
  deniedBox: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
};
