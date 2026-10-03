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
import SearchableSelect from "../Components/SearchableSelect";
import { PageHeader, Button, IconButton, Toolbar, Card, Facts, TableWrap, Loading, EmptyState, Alert } from "../ui/Kit";

const colors = {
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
  // running scenario tests for a sandbox company doesn't require the
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
      <EmptyState title="Access denied">
        You don't have permission to view the FBR Sandbox tab. Ask an administrator to grant you the <code>fbr.sandbox.view</code> permission.
      </EmptyState>
    );
  }

  const seededSns = new Set(bills.map((b) => b.scenarioCode));
  const unseededScenarios = scenarios.filter((s) => !seededSns.has(s.code));

  return (
    <div style={styles.page}>
      <PageHeader
        icon={MdScience}
        tone="brand"
        title="FBR Sandbox"
        subtitle={(
          <>
            Validate FBR scenario test bills for the selected company without
            touching its real bill numbering. Demo bills live in the <code>900000+</code> range and are
            invisible to the regular Bills / Challans pages.
          </>
        )}
        actions={(
          <>
            {/* Page-local company picker — independent of the global top-bar
                company switcher so testing scenarios for one company doesn't
                change which company the rest of the app is showing. */}
            <SearchableSelect
              items={companies || []}
              value={companyId || ""}
              onChange={(id) => setCompanyId(Number(id) || "")}
              placeholder="— Pick a company —"
              ariaLabel="Company"
              style={styles.companyPicker}
            />
            <IconButton label="Reload" icon={MdRefresh} onClick={refresh} disabled={!selectedCompany} />
            {canSeed && (
              <Button variant="primary" icon={MdAdd} onClick={handleSeed} disabled={running || !selectedCompany}>
                Seed Applicable Scenarios
              </Button>
            )}
          </>
        )}
      />

      {!selectedCompany ? (
        <EmptyState title="Pick a company">
          Select a company in the dropdown above to view or seed FBR sandbox scenarios for it.
        </EmptyState>
      ) : (
      <>
      {/* Profile summary */}
      <Card style={{ marginBottom: "var(--k-gap)" }}>
        <Facts facts={[
          ["Company", selectedCompany.name],
          ["Activity", selectedCompany.fbrBusinessActivity || <em style={styles.muted}>not set</em>],
          ["Sector", selectedCompany.fbrSector || <em style={styles.muted}>not set</em>],
          ["Applicable scenarios", `${scenarios.length} (${scenarios.map((s) => s.code).join(", ") || "—"})`],
        ]} />
      </Card>

      {/* Unseeded scenarios warning */}
      {unseededScenarios.length > 0 && bills.length > 0 && (
        <Alert tone="info" icon={MdInfo}>
          {unseededScenarios.length} scenario(s) not yet seeded: {unseededScenarios.map((s) => s.code).join(", ")}.
          {canSeed && <> Click <b>Seed Applicable Scenarios</b> to generate them.</>}
        </Alert>
      )}

      {/* Bulk actions row */}
      {(((canRun || canDelete) && bills.length > 0) || running) && (
        <Toolbar>
          {canRun && bills.length > 0 && (
            <>
              <Button variant="teal" icon={MdCheckCircle} onClick={() => handleRun("validate")} disabled={running}>
                Validate All
              </Button>
              <Button variant="primary" icon={MdSend} onClick={() => handleRun("submit")} disabled={running}>
                Submit All
              </Button>
            </>
          )}
          {canDelete && bills.length > 0 && (
            <Button variant="danger" icon={MdDelete} onClick={handleDeleteAll} disabled={running}>
              Wipe All
            </Button>
          )}
          {running && <span style={styles.runningBadge}>Running…</span>}
        </Toolbar>
      )}

      {/* Bills table */}
      {loading ? (
        <Loading>Loading…</Loading>
      ) : bills.length === 0 ? (
        <EmptyState title="No demo bills yet">
          {canSeed ? "Click \"Seed Applicable Scenarios\" to generate one demo bill per scenario." : "Ask an admin to grant you fbr.sandbox.seed."}
        </EmptyState>
      ) : (
        <>
          {/* Desktop / tablet — table */}
          <TableWrap className="fbr-table">
            <table className="k-table">
              <thead>
                <tr>
                  <th>SN</th>
                  <th>Bill #</th>
                  <th>Description</th>
                  <th>Client</th>
                  <th className="k-num">Total</th>
                  <th>FBR Status</th>
                  <th>IRN / Error</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 700, color: "var(--k-blue)" }}>{b.scenarioCode}</td>
                    <td>{b.invoiceNumber}</td>
                    <td>{b.description}</td>
                    <td>{b.clientName}</td>
                    <td className="k-num">Rs. {Math.round(b.grandTotal).toLocaleString()}</td>
                    <td>
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
                    <td style={{ fontSize: "0.74rem", maxWidth: 300, wordBreak: "break-all" }}>
                      {b.fbrIRN ? (
                        <code style={styles.irn}>{b.fbrIRN}</code>
                      ) : b.fbrErrorMessage ? (
                        <span title={b.fbrErrorMessage} style={{ color: "var(--k-danger)" }}>
                          <MdError size={12} /> {b.fbrErrorMessage.slice(0, 60)}…
                        </span>
                      ) : (
                        <span style={styles.muted}>—</span>
                      )}
                    </td>
                    <td className="k-actions">
                      {canDelete && (
                        <IconButton label="Delete" icon={MdDelete} size={14} danger onClick={() => handleDeleteBill(b)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>

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
  page: { maxWidth: 1400 },
  companyPicker: { width: 240, maxWidth: "100%" },
  runningBadge: { padding: "0.25rem 0.6rem", backgroundColor: colors.warnBg, color: colors.warn, borderRadius: 4, fontSize: "0.75rem", fontWeight: 700 },
  successBadge: { padding: "0.15rem 0.5rem", backgroundColor: colors.successBg, color: colors.success, borderRadius: 4, fontSize: "0.72rem", fontWeight: 700 },
  warnBadge: { padding: "0.15rem 0.5rem", backgroundColor: colors.warnBg, color: colors.warn, borderRadius: 4, fontSize: "0.72rem", fontWeight: 700 },
  failBadge: { padding: "0.15rem 0.5rem", backgroundColor: colors.dangerLight, color: colors.danger, borderRadius: 4, fontSize: "0.72rem", fontWeight: 700 },
  irn: { fontFamily: "monospace", fontSize: "0.72rem", color: colors.success },
  muted: { color: "var(--k-muted)", fontStyle: "italic", fontSize: "var(--k-td-font)" },
};
