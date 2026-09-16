import { useState, useEffect, useCallback, useMemo } from "react";
import {
  MdMenuBook, MdAdd, MdEdit, MdDelete, MdSearch, MdBusiness, MdLock,
  MdChevronLeft, MdChevronRight, MdClose,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, formStyles, modalSizes, dropdownStyles } from "../theme";
import useIsNarrow from "../hooks/useIsNarrow";
import useScrollToError from "../hooks/useScrollToError";
import usePageSize from "../hooks/usePageSize";
import AccountSelect from "../Components/AccountSelect";
import { getAccountsFlat } from "../api/accountApi";
import { getGlStatus } from "../api/accountingApi";
import {
  getPagedJournalEntries, createJournalEntry, updateJournalEntry, deleteJournalEntry,
} from "../api/journalEntryApi";

const money = (n) => {
  const raw = Number(n) || 0;
  const v = raw === 0 ? 0 : raw;
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Accounting → Journal Entries. The listing is the whole general ledger: every
 * entry, system-posted and manual alike, so an operator can see what a document
 * actually did to the books.
 *
 * Only MANUAL entries offer edit and delete. A system-posted entry belongs to
 * the posting engine and is replaced whenever its source document is saved, so
 * an edit here would quietly disappear — the row says where to go instead of
 * offering a button that undoes itself.
 */
export default function JournalEntriesPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const isNarrow = useIsNarrow(860);

  const canView = has("accounting.journal.view");
  const canCreate = has("accounting.journal.create");
  const canUpdate = has("accounting.journal.update");
  const canDelete = has("accounting.journal.delete");

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize] = usePageSize("journal-entries");
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [manualOnly, setManualOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(null);      // entry being created/edited
  const [accounts, setAccounts] = useState([]);
  const [glStatus, setGlStatus] = useState(null);

  const companyId = selectedCompany?.id;

  const fetchRows = useCallback(async (pg) => {
    if (!companyId) { setRows([]); setTotalCount(0); setTotalPages(0); return; }
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (pageSize) params.pageSize = pageSize;
      if (search.trim()) params.search = search.trim();
      if (manualOnly) params.manualOnly = true;
      const { data } = await getPagedJournalEntries(companyId, params);
      setRows(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(data.totalPages || 0);
    } catch {
      setRows([]); setTotalCount(0); setTotalPages(0);
    } finally { setLoading(false); }
  }, [companyId, page, pageSize, search, manualOnly]);

  useEffect(() => { setPage(1); }, [companyId, manualOnly]);
  useEffect(() => { fetchRows(page); }, [fetchRows, page]);

  // The account list and the ledger status are company-level and change far
  // less often than the listing, so they load once per company rather than on
  // every page turn.
  useEffect(() => {
    if (!companyId) { setAccounts([]); setGlStatus(null); return; }
    let cancelled = false;
    getAccountsFlat(companyId)
      .then(({ data }) => { if (!cancelled) setAccounts((data || []).filter((a) => a.isActive)); })
      .catch(() => { if (!cancelled) setAccounts([]); });
    getGlStatus(companyId)
      .then(({ data }) => { if (!cancelled) setGlStatus(data); })
      .catch(() => { if (!cancelled) setGlStatus(null); });
    return () => { cancelled = true; };
  }, [companyId]);

  const handleDelete = async (e) => {
    const ok = await confirm({
      title: "Delete journal entry?",
      message: `Delete ${e.reference}? Its ${e.lines.length} line${e.lines.length === 1 ? "" : "s"} go with it. This cannot be undone.`,
      variant: "danger", confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteJournalEntry(e.id);
      notify(`${e.reference} deleted.`, "success");
      fetchRows(page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete.", "error");
    }
  };

  if (!canView) {
    return (
      <div style={{ padding: "2rem", color: colors.textSecondary }}>
        You don't have permission to view journal entries.
      </div>
    );
  }

  const EntryCard = ({ e }) => (
    <div style={st.card}>
      <div style={st.cardHead}>
        <span style={st.ref}>{e.reference}</span>
        <span style={st.date}>{fmtDate(e.date)}</span>
        {e.isManual
          ? <span style={st.manualChip}>manual</span>
          : <span style={st.systemChip} title={`Posted from ${e.sourceDocType}`}>{e.sourceDocType}</span>}
        {e.isLocked && (
          <span style={st.lockedChip} title="This period is closed">
            <MdLock size={11} style={{ verticalAlign: "-1px" }} /> locked
          </span>
        )}
      </div>

      {e.narration && <div style={st.narration}>{e.narration}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={st.lineTable}>
          <tbody>
            {e.lines.map((l) => (
              <tr key={l.id}>
                <td style={st.lineAcct}>
                  {l.accountCode && <span style={st.codeChip}>{l.accountCode}</span>}
                  {l.accountName}
                  {l.description && <div style={st.lineDesc}>{l.description}</div>}
                </td>
                <td style={st.lineAmt}>{l.debit ? money(l.debit) : ""}</td>
                <td style={st.lineAmt}>{l.credit ? money(l.credit) : ""}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...st.lineAcct, fontWeight: 800, borderTop: `1px solid ${colors.cardBorder}` }}>Total</td>
              <td style={{ ...st.lineAmt, fontWeight: 800, borderTop: `1px solid ${colors.cardBorder}` }}>{money(e.totalDebit)}</td>
              <td style={{ ...st.lineAmt, fontWeight: 800, borderTop: `1px solid ${colors.cardBorder}` }}>{money(e.totalCredit)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={st.cardActions}>
        {e.isManual ? (
          <>
            {canUpdate && (
              <button
                style={{ ...st.rowBtn, opacity: e.isLocked ? 0.45 : 1 }}
                disabled={e.isLocked}
                title={e.isLocked ? "This period is closed" : "Edit"}
                onClick={() => setForm(e)}
              >
                <MdEdit size={15} /> Edit
              </button>
            )}
            {canDelete && (
              <button
                style={{ ...st.rowBtn, ...st.rowBtnDanger, opacity: e.isLocked ? 0.45 : 1 }}
                disabled={e.isLocked}
                title={e.isLocked ? "This period is closed" : "Delete"}
                onClick={() => handleDelete(e)}
              >
                <MdDelete size={15} /> Delete
              </button>
            )}
          </>
        ) : (
          <span style={st.systemNote}>
            Posted automatically — change the {e.sourceDocType.toLowerCase()} it came from.
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <MdMenuBook size={26} color={colors.blue} />
          <h2 style={st.h2}>Journal Entries</h2>
          {glStatus && (
            <>
              <span style={st.countChip}>{(glStatus.entryCount ?? 0).toLocaleString()} entries</span>
              {/* Every entry is refused unless it balances, so this can only go
                  false if something wrote around the service — worth saying out
                  loud rather than leaving to a report to discover. */}
              {glStatus.isBalanced === false && <span style={st.warnChip}>ledger unbalanced</span>}
              {glStatus.lockDate && (
                <span style={st.lockedChip}>
                  <MdLock size={11} style={{ verticalAlign: "-1px" }} /> closed to {fmtDate(glStatus.lockDate)}
                </span>
              )}
            </>
          )}
        </div>
        {canCreate && companyId && (
          <button
            style={{ ...st.primaryBtn, opacity: accounts.length === 0 ? 0.5 : 1 }}
            disabled={accounts.length === 0}
            title={accounts.length === 0 ? "Build the chart of accounts first" : undefined}
            onClick={() => setForm({ lines: [] })}
          >
            <MdAdd size={16} /> New Entry
          </button>
        )}
      </div>

      {companies.length > 0 && (
        <div style={st.filters}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select
              style={dropdownStyles.base}
              aria-label="Company"
              value={selectedCompany?.id || ""}
              onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
            >
              {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </span>

          <form
            onSubmit={(e) => { e.preventDefault(); setPage(1); fetchRows(1); }}
            style={{ display: "flex", gap: "0.4rem", flex: "1 1 220px", minWidth: 0 }}
          >
            <span style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <MdSearch size={18} style={st.searchIcon} />
              <input
                style={{ ...formStyles.input, paddingLeft: "2.1rem" }}
                placeholder="Search narration or JE-0012…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </span>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, minHeight: 44 }}>Search</button>
          </form>

          <label style={st.checkLabel}>
            <input
              type="checkbox"
              checked={manualOnly}
              onChange={(e) => setManualOnly(e.target.checked)}
              style={{ width: 18, height: 18, margin: 0 }}
            />
            Manual only
          </label>
        </div>
      )}

      {!companyId ? (
        <div style={st.empty}>Select a company to view its journal entries.</div>
      ) : loading ? (
        <div style={st.empty}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={st.empty}>
          {search || manualOnly ? "No entries match this filter." : "Nothing has been posted to the ledger yet."}
        </div>
      ) : (
        <div style={st.list}>
          {rows.map((e) => <EntryCard key={e.id} e={e} />)}
        </div>
      )}

      {totalPages > 1 && (
        <div style={st.pager}>
          <button style={st.pageBtn} disabled={page <= 1} aria-label="Previous page"
            onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <MdChevronLeft size={18} />
          </button>
          <span style={{ fontSize: "0.82rem", color: colors.textSecondary }}>
            Page {page} of {totalPages} · {totalCount.toLocaleString()} entries
          </span>
          <button style={st.pageBtn} disabled={page >= totalPages} aria-label="Next page"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            <MdChevronRight size={18} />
          </button>
        </div>
      )}

      {form && (
        <JournalForm
          entry={form.id ? form : null}
          companyId={companyId}
          accounts={accounts}
          isNarrow={isNarrow}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); fetchRows(page); }}
        />
      )}
    </div>
  );
}

// ── Create / edit a manual journal ──
function JournalForm({ entry, companyId, accounts, isNarrow, onClose, onSaved }) {
  const isEdit = !!entry;
  const [date, setDate] = useState(entry ? String(entry.date).slice(0, 10) : todayIso());
  const [narration, setNarration] = useState(entry?.narration || "");
  const [lines, setLines] = useState(() =>
    entry
      ? entry.lines.map((l) => ({
          accountId: l.accountId, debit: l.debit || "", credit: l.credit || "", description: l.description || "",
        }))
      : [
          { accountId: null, debit: "", credit: "", description: "" },
          { accountId: null, debit: "", credit: "", description: "" },
        ]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const errRef = useScrollToError(error);

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const totals = useMemo(() => {
    const dr = lines.reduce((s, l) => s + num(l.debit), 0);
    const cr = lines.reduce((s, l) => s + num(l.credit), 0);
    // Money is 2dp, so compare rounded paisa rather than raw floats — 0.1 + 0.2
    // is not 0.3 and the operator should not be told their balanced entry isn't.
    const drP = Math.round(dr * 100);
    const crP = Math.round(cr * 100);
    return { dr, cr, diff: (drP - crP) / 100, balanced: drP === crP && drP > 0 };
  }, [lines]);

  const setLine = (i, patch) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  // A line carries an amount on exactly one side, so typing in one clears the
  // other rather than leaving a value the server would refuse.
  const setDebit = (i, v) => setLine(i, { debit: v, credit: v === "" ? lines[i].credit : "" });
  const setCredit = (i, v) => setLine(i, { credit: v, debit: v === "" ? lines[i].debit : "" });

  const addLine = () => setLines((ls) => [...ls, { accountId: null, debit: "", credit: "", description: "" }]);
  const removeLine = (i) => setLines((ls) => (ls.length <= 2 ? ls : ls.filter((_, k) => k !== i)));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const filled = lines.filter((l) => l.accountId && (num(l.debit) > 0 || num(l.credit) > 0));
    if (filled.length < 2) { setError("A journal entry needs at least two lines with an account and an amount."); return; }
    if (!totals.balanced) {
      setError(`The entry doesn't balance — debits ${money(totals.dr)} against credits ${money(totals.cr)}.`);
      return;
    }
    setSaving(true); setError("");
    const payload = {
      date,
      narration: narration.trim() || null,
      lines: filled.map((l) => ({
        accountId: Number(l.accountId),
        debit: num(l.debit),
        credit: num(l.credit),
        description: l.description.trim() || null,
      })),
    };
    try {
      if (isEdit) await updateJournalEntry(entry.id, payload);
      else await createJournalEntry(companyId, payload);
      notify(isEdit ? "Journal entry updated." : "Journal entry saved.", "success");
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Could not save.");
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? `Edit ${entry.reference}` : "New Journal Entry"}</h5>
          <button type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <div style={formStyles.body}>
            {error && <div ref={errRef} style={formStyles.error}>{error}</div>}

            <div style={st.formGrid}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Date</label>
                <input type="date" style={formStyles.input} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div style={{ ...formStyles.formGroup, gridColumn: isNarrow ? "auto" : "span 2" }}>
                <label style={formStyles.label}>Narration</label>
                <input
                  style={formStyles.input}
                  value={narration}
                  onChange={(e) => setNarration(e.target.value)}
                  placeholder="What this entry records"
                />
              </div>
            </div>

            <label style={{ ...formStyles.label, marginTop: "0.4rem" }}>Lines</label>
            {lines.map((l, i) => (
              <div key={i} style={st.lineRow}>
                <div style={{ flex: "2 1 220px", minWidth: 0 }}>
                  <AccountSelect
                    accounts={accounts}
                    value={l.accountId}
                    onChange={(id) => setLine(i, { accountId: id })}
                    placeholder="Pick an account"
                  />
                  <input
                    style={{ ...formStyles.input, marginTop: 6, fontSize: "0.8rem" }}
                    value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                    placeholder="Line note (optional)"
                  />
                </div>
                <input
                  type="number" step="0.01" min="0" inputMode="decimal"
                  style={{ ...formStyles.input, flex: "1 1 110px", minWidth: 0, textAlign: "right" }}
                  value={l.debit} onChange={(e) => setDebit(i, e.target.value)}
                  placeholder="Debit" aria-label={`Line ${i + 1} debit`}
                />
                <input
                  type="number" step="0.01" min="0" inputMode="decimal"
                  style={{ ...formStyles.input, flex: "1 1 110px", minWidth: 0, textAlign: "right" }}
                  value={l.credit} onChange={(e) => setCredit(i, e.target.value)}
                  placeholder="Credit" aria-label={`Line ${i + 1} credit`}
                />
                <button
                  type="button" style={st.lineDelBtn} aria-label={`Remove line ${i + 1}`}
                  title={lines.length <= 2 ? "An entry needs at least two lines" : "Remove line"}
                  disabled={lines.length <= 2} onClick={() => removeLine(i)}
                >
                  <MdClose size={16} />
                </button>
              </div>
            ))}

            <button type="button" style={st.addLineBtn} onClick={addLine}>
              <MdAdd size={16} /> Add line
            </button>

            {/* Icon AND words, never colour alone — the difference has to read
                for someone who can't tell the green from the red. */}
            <div style={{ ...st.totalsBox, borderColor: totals.balanced ? colors.success : colors.danger }}>
              <div><span style={st.totalsLabel}>Debits</span><span style={st.totalsValue}>{money(totals.dr)}</span></div>
              <div><span style={st.totalsLabel}>Credits</span><span style={st.totalsValue}>{money(totals.cr)}</span></div>
              <div>
                <span style={st.totalsLabel}>Difference</span>
                <span style={{ ...st.totalsValue, color: totals.balanced ? colors.success : colors.danger }}>
                  {totals.balanced ? "✓ Balanced" : `✗ ${money(totals.diff)} out`}
                </span>
              </div>
            </div>
          </div>

          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button
              type="submit"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: saving || !totals.balanced ? 0.6 : 1 }}
              disabled={saving || !totals.balanced}
            >
              {saving ? "Saving…" : "Save Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const st = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary },
  countChip: { fontSize: "0.72rem", fontWeight: 700, color: colors.blue, background: "#eef2ff", border: `1px solid ${colors.cardBorder}`, padding: "3px 10px", borderRadius: 12, whiteSpace: "nowrap" },
  warnChip: { fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "#b71c1c", background: "#ffebee", border: "1px solid #ffcdd2", padding: "3px 10px", borderRadius: 12 },
  lockedChip: { fontSize: "0.7rem", fontWeight: 700, color: "#8a5a00", background: "#fff3cd", border: "1px solid #ffe69c", padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" },
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", minHeight: 44, borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  filters: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" },
  searchIcon: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.textSecondary },
  checkLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", fontWeight: 600, color: colors.textSecondary, cursor: "pointer", minHeight: 44 },
  list: { display: "grid", gap: "0.85rem" },
  card: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.85rem 1rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" },
  cardHead: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.4rem" },
  ref: { fontFamily: "monospace", fontWeight: 800, fontSize: "0.82rem", color: colors.blue },
  date: { fontSize: "0.82rem", color: colors.textSecondary },
  manualChip: { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", background: "#e8f5e9", color: "#1b5e20", padding: "1px 6px", borderRadius: 10 },
  systemChip: { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", background: "#e3f2fd", color: "#0d47a1", padding: "1px 6px", borderRadius: 10 },
  narration: { fontSize: "0.88rem", color: colors.textPrimary, marginBottom: "0.5rem", overflowWrap: "anywhere" },
  lineTable: { width: "100%", borderCollapse: "collapse", minWidth: 320 },
  lineAcct: { padding: "0.3rem 0.4rem 0.3rem 0", fontSize: "0.82rem", color: colors.textPrimary, overflowWrap: "anywhere" },
  lineDesc: { fontSize: "0.74rem", color: colors.textSecondary, marginTop: 2, overflowWrap: "anywhere" },
  lineAmt: { padding: "0.3rem 0 0.3rem 0.6rem", fontSize: "0.82rem", textAlign: "right", whiteSpace: "nowrap", width: 110 },
  codeChip: { fontFamily: "monospace", fontSize: "0.7rem", color: colors.textSecondary, background: colors.inputBg, padding: "0 4px", borderRadius: 4, marginRight: 5 },
  cardActions: { display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.6rem", paddingTop: "0.55rem", borderTop: `1px solid ${colors.cardBorder}` },
  rowBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "0.35rem 0.9rem", minHeight: 44, minWidth: 44, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  rowBtnDanger: { color: colors.danger, borderColor: `${colors.danger}40` },
  systemNote: { fontSize: "0.76rem", color: colors.textSecondary, fontStyle: "italic" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "0.75rem" },
  lineRow: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "0.5rem", padding: "0.5rem 0", borderBottom: `1px solid ${colors.cardBorder}` },
  lineDelBtn: { display: "grid", placeItems: "center", width: 44, height: 44, padding: 0, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textSecondary, cursor: "pointer", boxShadow: "none", flexShrink: 0 },
  addLineBtn: { display: "inline-flex", alignItems: "center", gap: 6, marginTop: "0.6rem", padding: "0.45rem 0.9rem", minHeight: 44, borderRadius: 8, border: `1px dashed ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", boxShadow: "none" },
  totalsBox: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(130px, 100%), 1fr))", gap: "0.6rem", marginTop: "1rem", padding: "0.7rem 0.9rem", background: colors.inputBg, border: "2px solid", borderRadius: 10 },
  totalsLabel: { display: "block", fontSize: "0.64rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary },
  totalsValue: { fontSize: "1rem", fontWeight: 800, color: colors.textPrimary },
  pager: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", marginTop: "1rem" },
  pageBtn: { display: "grid", placeItems: "center", width: 44, height: 44, padding: 0, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, cursor: "pointer", boxShadow: "none" },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
};
