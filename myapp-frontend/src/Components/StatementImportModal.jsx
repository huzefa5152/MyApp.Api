import "./AccountingModalTables.css";
import { useState, useEffect, useCallback } from "react";
import { MdClose, MdUploadFile, MdCheck, MdBlock } from "react-icons/md";
import { formStyles, modalSizes, dropdownStyles } from "../theme";
import { notify } from "../utils/notify";
import {
  importBankStatement,
  getStatementLines,
  categorizeStatementLine,
  ignoreStatementLine,
} from "../api/accountingApi";
import { getAccountsFlat } from "../api/accountApi";

// "PKR 1,234.00" — negatives keep their sign (styled red at the call site).
const pkr = (x) =>
  "PKR " +
  Number(x || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

/**
 * Bank statement import + categorization (Phase 2). Two steps in one modal:
 *   (A) Import — pick/paste a CSV, POST it; the server auto-matches lines it can
 *       tie to an existing receipt/payment and stages the rest as Uncategorized.
 *   (B) Review — for every uncategorized line, pick a contra account and either
 *       Categorize (posts a receipt/payment against it) or Ignore.
 * Both steps stay available so the page's "N to review" link can jump straight
 * to the review table. Gated upstream by accounting.reconciliation.manage on the page.
 */
export default function StatementImportModal({ companyId, account, onClose, onDone }) {
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);

  const [lines, setLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(true);
  const [selections, setSelections] = useState({}); // { [lineId]: contraAccountId }
  const [busyId, setBusyId] = useState(null); // line currently posting

  const [contraAccounts, setContraAccounts] = useState([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  // Contra-account picker: every account except the bank/cash ones (a statement
  // line categorizes into the *other* side of the entry).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getAccountsFlat(companyId);
        if (!alive) return;
        setContraAccounts((res.data || []).filter((a) => a.controlType !== "BankCash"));
      } catch {
        if (alive) setContraAccounts([]);
      } finally {
        if (alive) setAccountsLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [companyId]);

  const loadLines = useCallback(async () => {
    if (!account?.id) return;
    setLoadingLines(true);
    try {
      const res = await getStatementLines(account.id, "Uncategorized");
      setLines(res.data || []);
    } catch {
      setLines([]);
    } finally {
      setLoadingLines(false);
    }
  }, [account?.id]);

  useEffect(() => {
    loadLines();
  }, [loadLines]);

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setCsvText(text);
      setFileName(file.name);
    } catch {
      notify("Couldn't read that file.", "error");
    }
  };

  const doImport = async () => {
    if (!csvText.trim() || importing) return;
    setImporting(true);
    try {
      const res = await importBankStatement(companyId, {
        bankAccountId: account.id,
        fileName: fileName || "pasted.csv",
        csvText,
      });
      const { total = 0, autoMatched = 0, uncategorized = 0 } = res.data || {};
      notify(
        `Imported ${total} lines — ${autoMatched} auto-matched, ${uncategorized} to review.`,
        "success",
      );
      setCsvText("");
      setFileName("");
      await loadLines();
    } catch (e) {
      notify(e?.response?.data?.error || "Import failed — check the format.", "error");
    } finally {
      setImporting(false);
    }
  };

  const categorize = async (line) => {
    const selected = selections[line.id];
    if (!selected) {
      notify("Pick a category account first.", "warning");
      return;
    }
    if (busyId) return;
    setBusyId(line.id);
    try {
      await categorizeStatementLine(line.id, {
        accountId: Number(selected),
        contactType: "Other",
        description: line.description,
      });
      setLines((prev) => prev.filter((l) => l.id !== line.id));
      notify("Categorized.", "success");
    } catch (e) {
      notify(e?.response?.data?.error || "Could not categorize.", "warning");
    } finally {
      setBusyId(null);
    }
  };

  const ignore = async (line) => {
    if (busyId) return;
    setBusyId(line.id);
    try {
      await ignoreStatementLine(line.id);
      setLines((prev) => prev.filter((l) => l.id !== line.id));
    } catch (e) {
      notify(e?.response?.data?.error || "Could not ignore.", "warning");
    } finally {
      setBusyId(null);
    }
  };

  const done = () => {
    onClose?.();
    onDone?.();
  };

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div
        data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: modalSizes.lg }}
        onClick={(e) => e.stopPropagation()}
      >
        <div data-admin-header="" style={formStyles.header}>
          <h3 style={{ ...formStyles.title, display: "flex", alignItems: "center", gap: 8 }}>
            <MdUploadFile size={20} /> Import Statement — {account.name}
          </h3>
          <button
            data-admin-close=""
            style={formStyles.closeButton}
            onClick={onClose}
            title="Close"
          >
            <MdClose size={18} />
          </button>
        </div>

        <div data-admin-body="" style={formStyles.body}>
          {/* (A) Import step */}
          <div style={st.section}>
            <div style={st.sectionHeading}>1 · Import a CSV</div>
            <p style={st.help}>
              CSV with a header row and columns: Date, Description, and either a signed Amount (+
              deposit / − withdrawal) or Debit/Credit columns.
            </p>

            <div style={st.uploadRow}>
              <label style={st.fileBtn}>
                <MdUploadFile size={16} /> Choose CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: "none" }}
                  onChange={onPickFile}
                />
              </label>
              {fileName && <span style={st.fileName}>{fileName}</span>}
            </div>

            <textarea
              style={st.textarea}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                if (fileName) setFileName("");
              }}
              placeholder="…or paste CSV rows here"
              rows={5}
            />

            <div style={st.importBtnRow}>
              <button
                type="button"
                style={{
                  ...formStyles.button,
                  ...formStyles.submit,
                  ...st.importBtn,
                  opacity: csvText.trim() && !importing ? 1 : 0.55,
                  cursor: csvText.trim() && !importing ? "pointer" : "not-allowed",
                }}
                disabled={!csvText.trim() || importing}
                onClick={doImport}
              >
                <MdUploadFile size={16} /> {importing ? "Importing…" : "Import"}
              </button>
            </div>
          </div>

          {/* (B) Review step */}
          <div style={{ ...st.section, marginBottom: 0 }}>
            <div style={st.sectionHeading}>2 · Review uncategorized lines</div>
            {loadingLines ? (
              <div style={st.empty}>Loading…</div>
            ) : lines.length === 0 ? (
              <div style={st.empty}>Nothing to categorize — all lines matched.</div>
            ) : (
              <div
                className="accounting-modal-cards"
                data-admin-table-region=""
                style={st.tableWrap}
              >
                <table style={st.table}>
                  <thead>
                    <tr>
                      <th style={{ ...st.th, width: 110 }}>Date</th>
                      <th style={st.th}>Description</th>
                      <th style={{ ...st.th, textAlign: "right", width: 150 }}>Amount</th>
                      <th style={{ ...st.th, minWidth: 320 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => {
                      const neg = Number(line.amount) < 0;
                      const busy = busyId === line.id;
                      return (
                        <tr key={line.id} style={st.tr}>
                          <td data-label="Date" style={{ ...st.td, whiteSpace: "nowrap" }}>
                            {fmtDate(line.date)}
                          </td>
                          <td data-label="Description" style={st.td}>
                            {line.description || "—"}
                          </td>
                          <td
                            data-label="Amount"
                            style={{
                              ...st.td,
                              textAlign: "right",
                              whiteSpace: "nowrap",
                              color: neg ? "var(--k-danger)" : "var(--k-ink)",
                            }}
                          >
                            {pkr(line.amount)}
                          </td>
                          <td data-label="Actions" style={st.td}>
                            <div style={st.actionCell}>
                              <select
                                style={{ ...dropdownStyles.base, flex: 1, minWidth: 160 }}
                                value={selections[line.id] || ""}
                                disabled={busy || !accountsLoaded}
                                onChange={(e) =>
                                  setSelections((prev) => ({ ...prev, [line.id]: e.target.value }))
                                }
                              >
                                <option value="">
                                  {accountsLoaded ? "Category account…" : "Loading accounts…"}
                                </option>
                                {contraAccounts.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                    {a.code ? ` (${a.code})` : ""}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                style={{ ...st.rowBtn, ...st.catBtn, opacity: busy ? 0.6 : 1 }}
                                disabled={busy}
                                title="Categorize this line"
                                onClick={() => categorize(line)}
                              >
                                <MdCheck size={15} /> Categorize
                              </button>
                              <button
                                type="button"
                                style={{ ...st.rowBtn, ...st.ignoreBtn, opacity: busy ? 0.6 : 1 }}
                                disabled={busy}
                                title="Ignore this line"
                                onClick={() => ignore(line)}
                              >
                                <MdBlock size={15} /> Ignore
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div data-admin-footer="" style={formStyles.footer}>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.submit }}
            onClick={done}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const st = {
  section: { marginBottom: "1.25rem" },
  sectionHeading: {
    fontSize: "var(--k-fs-2xs)",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--k-muted)",
    marginBottom: 8,
  },
  help: { fontSize: "var(--k-fs-sm)", color: "var(--k-muted)", margin: "0 0 0.75rem" },

  uploadRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flexWrap: "wrap",
    marginBottom: "0.75rem",
  },
  fileBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0.5rem 0.9rem",
    minHeight: "var(--k-btn-h)",
    borderRadius: "var(--k-radius)",
    border: `1px solid var(--k-line-strong)`,
    background: "var(--k-surface)",
    color: "var(--k-blue)",
    fontWeight: 700,
    cursor: "pointer",
  },
  fileName: { fontSize: "var(--k-fs-sm)", color: "var(--k-ink)", wordBreak: "break-all" },

  textarea: {
    width: "100%",
    boxSizing: "border-box",
    border: `1px solid var(--k-line-strong)`,
    borderRadius: "var(--k-radius)",
    padding: "10px 12px",
    fontSize: "var(--k-fs-sm)",
    fontFamily: "monospace",
    background: "var(--k-input-bg)",
    color: "var(--k-ink)",
    resize: "vertical",
    minHeight: 96,
  },

  importBtnRow: { display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" },
  importBtn: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: "var(--k-h)" },

  tableWrap: {
    overflowX: "auto",
    border: `1px solid var(--k-line)`,
    borderRadius: "var(--k-card-radius)",
  },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 640 },
  th: {
    textAlign: "left",
    fontSize: "var(--k-fs-2xs)",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--k-muted)",
    padding: "10px 12px",
    borderBottom: `2px solid var(--k-line)`,
    whiteSpace: "nowrap",
    background: "var(--k-input-bg)",
  },
  tr: { borderBottom: `1px solid var(--k-line)` },
  td: {
    padding: "10px 12px",
    fontSize: "var(--k-fs-base)",
    color: "var(--k-ink)",
    verticalAlign: "middle",
  },

  actionCell: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "0.4rem 0.7rem",
    minHeight: "var(--k-h)",
    borderRadius: "var(--k-radius)",
    border: "none",
    fontSize: "var(--k-fs-sm)",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  catBtn: { background: "var(--k-accent-solid, var(--k-blue))", color: "#fff" },
  ignoreBtn: {
    background: "transparent",
    color: "var(--k-muted)",
    border: `1px solid var(--k-line-strong)`,
  },

  empty: {
    padding: "2rem 1rem",
    textAlign: "center",
    color: "var(--k-muted)",
    background: "var(--k-input-bg)",
    border: `1px dashed var(--k-line-strong)`,
    borderRadius: "var(--k-card-radius)",
  },
};
