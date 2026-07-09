import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  MdAdd, MdDelete, MdEdit, MdVisibility, MdClose, MdChevronLeft, MdChevronRight,
  MdSearch, MdBusiness, MdMenuBook, MdArrowDropDown,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, formStyles, modalSizes, dropdownStyles } from "../theme";
import StatusBadge from "../Components/StatusBadge";
import {
  getJournalEntriesPaged, getJournalEntry, createJournalEntry,
  updateJournalEntry, deleteJournalEntry,
} from "../api/accountingApi";
import { getAccountsFlat } from "../api/accountApi";

const fmtMoney = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
// dd/mm/yyyy per spec — en-GB gives exactly that.
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const todayIso = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// sourceDocType → badge label + tone. "Manual" is highlighted (blue/info);
// system-posted sources stay neutral so manual entries pop in the list.
const SOURCE_META = {
  ManualJournal: { label: "Manual", tone: "info" },
  Invoice: { label: "Invoice", tone: "neutral" },
  PurchaseBill: { label: "Purchase Bill", tone: "neutral" },
  Payment: { label: "Payment", tone: "neutral" },
  AccountTransfer: { label: "Transfer", tone: "neutral" },
};
const sourceMeta = (t) => SOURCE_META[t] || { label: t || "System", tone: "neutral" };

let nextLineKey = 1;
const blankLine = () => ({ key: nextLineKey++, accountId: "", debit: "", credit: "", description: "" });
const toFormLine = (l) => ({
  key: nextLineKey++,
  accountId: l.accountId ? String(l.accountId) : "",
  debit: l.debit ? String(l.debit) : "",
  credit: l.credit ? String(l.credit) : "",
  description: l.description || "",
});

/**
 * Accounting → Journal Entries. Lists manual + system-posted journals with
 * search/pagination; manual entries are editable/deletable, system entries
 * open read-only. Responsive: each row is a card whose cells sit inline on
 * desktop (table-like) and stack on phones. Gated by accounting.journal.*.
 */
export default function JournalEntriesPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has("accounting.journal.view");
  const canCreate = has("accounting.journal.create");
  const canDelete = has("accounting.journal.delete");

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);   // manual entry being edited
  const [viewing, setViewing] = useState(null);   // entry opened read-only

  const companyId = selectedCompany?.id;

  const fetchRows = useCallback(async (pg) => {
    if (!companyId) { setRows([]); return; }
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (search.trim()) params.search = search.trim();
      const { data } = await getJournalEntriesPaged(companyId, params);
      setRows(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(data.totalPages ?? Math.ceil((data.totalCount || 0) / (data.pageSize || 1)));
    } catch {
      setRows([]); setTotalCount(0); setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [companyId, page, search]);

  // Reset to page 1 on company switch.
  useEffect(() => { setPage(1); setSearch(""); }, [companyId]);
  useEffect(() => { fetchRows(page); }, [fetchRows, page]);

  const handleDelete = async (e) => {
    const ok = await confirm({
      title: "Delete journal entry?",
      message: `Delete ${e.reference}? Its ledger postings will be removed. This cannot be undone.`,
      variant: "danger",
      confirmText: "Delete",
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
    return <div style={{ padding: "2rem", color: colors.textSecondary }}>You don't have permission to view journal entries.</div>;
  }

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={st.headerIcon}><MdMenuBook size={24} /></span>
          <div>
            <h2 style={st.h2}>Journal Entries</h2>
            <div style={st.subtitle}>Manual journals and system-posted ledger entries</div>
          </div>
        </div>
        {canCreate && companyId && (
          <button style={st.primaryBtn} onClick={() => setShowForm(true)}>
            <MdAdd size={18} /> New Journal Entry
          </button>
        )}
      </div>

      {companies.length > 0 && (
        <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <MdBusiness size={20} color={colors.blue} />
          <select
            style={dropdownStyles.base}
            value={selectedCompany?.id || ""}
            onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
          >
            {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
          </select>
        </div>
      )}

      {!companyId ? (
        <div style={st.empty}>Select a company to view journal entries.</div>
      ) : (
        <>
          <div style={st.toolbar}>
            <div style={{ position: "relative", flex: "1 1 240px", minWidth: 0, maxWidth: 360 }}>
              <MdSearch size={18} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.textSecondary }} />
              <input
                style={{ ...dropdownStyles.base, width: "100%", paddingLeft: 34 }}
                placeholder="Search journal entries…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); fetchRows(1); } }}
              />
            </div>
            {rows.length > 0 && (
              <div style={st.pageSummary}>
                <span style={st.pageSummaryCount}>{totalCount}</span> entr{totalCount === 1 ? "y" : "ies"}
              </div>
            )}
          </div>

          {loading ? (
            <div style={st.empty}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={st.empty}>No journal entries yet.</div>
          ) : (
            <div style={st.list}>
              {rows.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  canEdit={canCreate}
                  canDelete={canDelete}
                  onView={() => setViewing(e)}
                  onEdit={() => setEditing(e)}
                  onDelete={() => handleDelete(e)}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div style={st.pagination}>
              <button style={{ ...st.pageBtn, opacity: page <= 1 ? 0.4 : 1 }} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <MdChevronLeft size={20} /> Prev
              </button>
              <span style={st.pageInfo}>Page {page} of {totalPages} ({totalCount} total)</span>
              <button style={{ ...st.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next <MdChevronRight size={20} />
              </button>
            </div>
          )}
        </>
      )}

      {showForm && companyId && (
        <JournalEntryForm
          companyId={companyId}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setPage(1); fetchRows(1); notify("Journal entry saved.", "success"); }}
        />
      )}

      {editing && companyId && (
        <JournalEntryForm
          companyId={companyId}
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchRows(page); notify("Journal entry updated.", "success"); }}
        />
      )}

      {viewing && (
        <JournalViewDialog entry={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

/**
 * One journal entry. The data cells live in an auto-fit grid: side by side on
 * desktop (reads like a table row), stacked one-per-line at 375px — no media
 * queries. Edit/Delete only on manual rows; system rows are view-only.
 */
function EntryRow({ entry: e, canEdit, canDelete, onView, onEdit, onDelete }) {
  const src = sourceMeta(e.sourceDocType);
  const balanced = r2(e.totalDebit) === r2(e.totalCredit);

  return (
    <div style={st.rowCard}>
      <div style={{ ...st.accentStrip, background: e.isManual ? colors.blue : colors.cardBorder }} />
      <div style={st.rowBody}>
        <div style={st.rowGrid}>
          {/* Identity: reference + date + source */}
          <div style={{ minWidth: 0 }}>
            <div style={st.refLine}>
              <span style={st.ref}>{e.reference}</span>
              <StatusBadge tone={src.tone}>{src.label}</StatusBadge>
            </div>
            <div style={st.dateLine}>
              {fmtDate(e.date)}
              {e.divisionName && <span style={st.division}> · {e.divisionName}</span>}
            </div>
          </div>

          {/* Narration — line-clamp 2, never nowrap+ellipsis */}
          <div style={{ minWidth: 0 }}>
            <div style={st.miniLabel}>Narration</div>
            <div style={st.narration}>{e.narration || "—"}</div>
          </div>

          {/* Amounts + balance chip */}
          <div style={{ minWidth: 0 }}>
            <div style={st.amtRow}>
              <span style={st.amtLabel}>Debit</span>
              <span style={st.amtVal}>Rs {fmtMoney(e.totalDebit)}</span>
            </div>
            <div style={st.amtRow}>
              <span style={st.amtLabel}>Credit</span>
              <span style={st.amtVal}>Rs {fmtMoney(e.totalCredit)}</span>
            </div>
            <div style={{ marginTop: 4 }}>
              {balanced
                ? <StatusBadge tone="success">Balanced</StatusBadge>
                : <StatusBadge tone="danger">Unbalanced</StatusBadge>}
            </div>
          </div>

          {/* Actions */}
          <div style={st.rowActions}>
            <button style={st.viewBtn} onClick={onView} title="View lines">
              <MdVisibility size={16} /> View
            </button>
            {e.isManual && canEdit && (
              <button style={st.editBtn} onClick={onEdit} title="Edit">
                <MdEdit size={16} /> Edit
              </button>
            )}
            {e.isManual && canDelete && (
              <button style={st.delBtn} onClick={onDelete} title="Delete">
                <MdDelete size={16} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Read-only detail dialog — meta rows + full line table. */
function JournalViewDialog({ entry: e, onClose }) {
  const src = sourceMeta(e.sourceDocType);
  const lines = e.lines || [];
  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(ev) => ev.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{e.reference}</h5>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>
        <div style={formStyles.body}>
          <div style={st.viewMetaGrid}>
            <div><div style={st.miniLabel}>Date</div><div style={st.viewMetaVal}>{fmtDate(e.date)}</div></div>
            <div><div style={st.miniLabel}>Source</div><div><StatusBadge tone={src.tone}>{src.label}</StatusBadge></div></div>
            {e.divisionName && <div><div style={st.miniLabel}>Division</div><div style={st.viewMetaVal}>{e.divisionName}</div></div>}
            {e.createdAt && <div><div style={st.miniLabel}>Created</div><div style={st.viewMetaVal}>{new Date(e.createdAt).toLocaleString("en-GB")}</div></div>}
          </div>
          {e.narration && (
            <div style={{ marginBottom: "0.9rem" }}>
              <div style={st.miniLabel}>Narration</div>
              <div style={{ fontSize: "0.88rem", color: colors.textPrimary, lineHeight: 1.45 }}>{e.narration}</div>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={st.tbl}>
              <thead>
                <tr>
                  <th style={st.th}>Account</th>
                  <th style={st.th}>Description</th>
                  <th style={{ ...st.th, textAlign: "right" }}>Debit</th>
                  <th style={{ ...st.th, textAlign: "right" }}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td style={st.td}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {l.accountCode && <span style={st.codeChip}>{l.accountCode}</span>}
                        {l.accountName}
                      </span>
                    </td>
                    <td style={{ ...st.td, color: colors.textSecondary }}>{l.description || ""}</td>
                    <td style={{ ...st.td, ...st.tdNum }}>{l.debit ? fmtMoney(l.debit) : ""}</td>
                    <td style={{ ...st.td, ...st.tdNum }}>{l.credit ? fmtMoney(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...st.td, fontWeight: 800 }} colSpan={2}>Total</td>
                  <td style={{ ...st.td, ...st.tdNum, fontWeight: 800 }}>{fmtMoney(e.totalDebit)}</td>
                  <td style={{ ...st.td, ...st.tdNum, fontWeight: 800 }}>{fmtMoney(e.totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <div style={formStyles.footer}>
          <button style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Create / edit modal (manual entries only) ────────────────────────────────
function JournalEntryForm({ companyId, entry, onClose, onSaved }) {
  const isEdit = !!entry;
  const [date, setDate] = useState(entry?.date ? String(entry.date).slice(0, 10) : todayIso());
  const [narration, setNarration] = useState(entry?.narration || "");
  const [lines, setLines] = useState(() =>
    entry?.lines?.length ? entry.lines.map(toFormLine) : [blankLine(), blankLine()]);
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Postable accounts: active, and never bank/cash (those move only through
  // receipts / payments / transfers — server rejects them too).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getAccountsFlat(companyId);
        if (!cancelled) setAccounts((data || []).filter((a) => a.isActive && a.controlType !== "BankCash"));
      } catch {
        if (!cancelled) setAccounts([]);
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  // Editing: refresh from the server so we never save over newer line data.
  // The paged row already carries lines, so this is a best-effort top-up.
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getJournalEntry(entry.id);
        if (cancelled || !data) return;
        setDate(data.date ? String(data.date).slice(0, 10) : todayIso());
        setNarration(data.narration || "");
        if (data.lines?.length) setLines(data.lines.map(toFormLine));
      } catch { /* keep the prefill from the list row */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key) => setLines((ls) => ls.filter((l) => l.key !== key));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);

  const totalDebit = r2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const totalCredit = r2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  const balanced = totalDebit === totalCredit && totalDebit > 0;
  const linesComplete = lines.every(
    (l) => l.accountId && ((Number(l.debit) || 0) > 0) !== ((Number(l.credit) || 0) > 0));
  const canSave = !saving && !loadingAccounts && lines.length >= 2 && linesComplete && balanced;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true); setError("");
    try {
      const payload = {
        date,
        narration: narration.trim(),
        lines: lines.map((l) => ({
          accountId: Number(l.accountId),
          debit: r2(l.debit),
          credit: r2(l.credit),
          description: l.description.trim() || null,
        })),
      };
      if (isEdit) await updateJournalEntry(entry.id, payload);
      else await createJournalEntry(companyId, payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Could not save the journal entry.");
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? `Edit ${entry.reference}` : "New Journal Entry"}</h5>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>
        <form onSubmit={submit}>
          <div style={formStyles.body}>
            {error && <div style={formStyles.error}>{error}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Date</label>
                <input type="date" style={formStyles.input} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Narration</label>
                <input style={formStyles.input} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="What is this entry for?" />
              </div>
            </div>

            <label style={formStyles.label}>Lines</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {lines.map((l) => (
                <div key={l.key} style={st.lineCard}>
                  <div style={{ flex: "2 1 220px", minWidth: 0 }}>
                    <div style={st.miniLabel}>Account</div>
                    <AccountSelect
                      accounts={accounts}
                      loading={loadingAccounts}
                      value={l.accountId}
                      onChange={(id) => setLine(l.key, { accountId: id ? String(id) : "" })}
                    />
                  </div>
                  <div style={{ flex: "1 1 110px", minWidth: 0 }}>
                    <div style={st.miniLabel}>Debit</div>
                    <input
                      type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00"
                      style={st.lineInput}
                      value={l.debit}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLine(l.key, { debit: v, ...(v !== "" ? { credit: "" } : {}) });
                      }}
                    />
                  </div>
                  <div style={{ flex: "1 1 110px", minWidth: 0 }}>
                    <div style={st.miniLabel}>Credit</div>
                    <input
                      type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00"
                      style={st.lineInput}
                      value={l.credit}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLine(l.key, { credit: v, ...(v !== "" ? { debit: "" } : {}) });
                      }}
                    />
                  </div>
                  <div style={{ flex: "2 1 160px", minWidth: 0 }}>
                    <div style={st.miniLabel}>Description <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></div>
                    <input
                      style={st.lineInput}
                      value={l.description}
                      onChange={(e) => setLine(l.key, { description: e.target.value })}
                    />
                  </div>
                  {lines.length > 1 && (
                    <button type="button" style={st.lineRemoveBtn} title="Remove line" aria-label="Remove line" onClick={() => removeLine(l.key)}>
                      <MdDelete size={18} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button type="button" style={st.addLineBtn} onClick={addLine}>
              <MdAdd size={16} /> Add line
            </button>

            {/* Running totals + balance indicator */}
            <div style={st.totalsBar}>
              <span style={st.totalsCell}>Σ Debit <strong style={st.totalsVal}>Rs {fmtMoney(totalDebit)}</strong></span>
              <span style={st.totalsCell}>Σ Credit <strong style={st.totalsVal}>Rs {fmtMoney(totalCredit)}</strong></span>
              {(totalDebit > 0 || totalCredit > 0) && (
                balanced
                  ? <StatusBadge tone="success">Balanced</StatusBadge>
                  : <StatusBadge tone="warning">Out of balance by Rs {fmtMoney(Math.abs(totalDebit - totalCredit))}</StatusBadge>
              )}
            </div>
            {!canSave && !saving && (
              <div style={st.saveHint}>
                Needs at least two lines — each with an account and a single debit or credit — and matching totals above zero.
              </div>
            )}
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: canSave ? 1 : 0.55, cursor: canSave ? "pointer" : "not-allowed" }} disabled={!canSave}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Searchable account combobox with a code chip on every option. Local variant
 * of Components/SearchableSelect (that one renders plain-text labels only, and
 * this page must show name + code chip). Same portal + flip-above positioning
 * so the dropdown never clips inside the scrolling modal body.
 */
function AccountSelect({ accounts, value, onChange, loading, placeholder = "Select account…" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [triggerRect, setTriggerRect] = useState(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const wrapperRef = useRef(null);

  const selected = useMemo(
    () => (accounts || []).find((a) => String(a.id) === String(value)),
    [accounts, value]
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const arr = accounts || [];
    if (!term) return arr;
    return arr.filter((a) => `${a.name} ${a.code || ""}`.toLowerCase().includes(term));
  }, [accounts, query]);

  useEffect(() => {
    const onMouseDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target) &&
          triggerRef.current && !triggerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightIdx(-1);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const recompute = () => { if (triggerRef.current) setTriggerRect(triggerRef.current.getBoundingClientRect()); };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open]);

  const pick = (a) => { onChange?.(a ? a.id : ""); setOpen(false); };

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (highlightIdx >= 0 && highlightIdx < filtered.length) pick(filtered[highlightIdx]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        ref={triggerRef}
        disabled={loading}
        onClick={() => setOpen((v) => !v)}
        style={{ ...as.trigger, ...(loading ? { opacity: 0.6, cursor: "not-allowed" } : {}) }}
      >
        <span style={as.triggerLabel}>
          {loading ? <span style={as.placeholder}>Loading…</span>
            : selected ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={as.selectedName}>{selected.name}</span>
                {selected.code && <span style={st.codeChip}>{selected.code}</span>}
              </span>
            ) : <span style={as.placeholder}>{placeholder}</span>}
        </span>
        <MdArrowDropDown size={18} style={{ flexShrink: 0, color: colors.textSecondary }} />
      </button>

      {open && triggerRect && createPortal(
        <div ref={wrapperRef} style={as.dropdown(triggerRect)} onKeyDown={onKeyDown}>
          <div style={as.searchRow}>
            <MdSearch size={16} style={as.searchIcon} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search name or code…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0); }}
              onKeyDown={onKeyDown}
              style={as.searchInput}
            />
          </div>
          <div style={as.list}>
            {filtered.length === 0 && (
              <div style={as.empty}>{(accounts || []).length === 0 ? "No postable accounts." : `No match for "${query}".`}</div>
            )}
            {filtered.map((a, idx) => (
              <div
                key={a.id}
                onMouseDown={() => pick(a)}
                onMouseEnter={() => setHighlightIdx(idx)}
                style={{ ...as.row, backgroundColor: idx === highlightIdx ? "#e3f2fd" : "transparent" }}
              >
                <span style={as.rowName}>{a.name}</span>
                {a.code && <span style={st.codeChip}>{a.code}</span>}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const st = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  headerIcon: { display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: `${colors.blue}15`, color: colors.blue },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary, lineHeight: 1.1 },
  subtitle: { fontSize: "0.8rem", color: colors.textSecondary, marginTop: 2 },
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", minHeight: 44, borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer" },
  toolbar: { display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" },
  pageSummary: { fontSize: "0.8rem", color: colors.textSecondary },
  pageSummaryCount: { fontWeight: 700, color: colors.textPrimary },

  list: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  rowCard: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.04)", overflow: "hidden", display: "flex" },
  accentStrip: { width: 5, flexShrink: 0 },
  rowBody: { padding: "0.8rem 1rem", flex: 1, minWidth: 0 },
  // Cells sit inline on desktop (table-like row) and stack at 375px.
  rowGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.6rem 1rem", alignItems: "start" },

  refLine: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  ref: { fontWeight: 800, fontSize: "0.92rem", color: colors.blue, letterSpacing: "0.3px" },
  dateLine: { fontSize: "0.8rem", color: colors.textSecondary, marginTop: 4 },
  division: { fontStyle: "italic" },

  miniLabel: { fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary, marginBottom: 3 },
  // Line-clamp 2 — never nowrap+ellipsis on user-supplied text (CLAUDE.md).
  narration: { fontSize: "0.85rem", color: colors.textPrimary, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },

  amtRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, maxWidth: 240 },
  amtLabel: { fontSize: "0.74rem", color: colors.textSecondary, fontWeight: 600 },
  amtVal: { fontSize: "0.86rem", fontWeight: 700, color: colors.textPrimary, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },

  rowActions: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", alignSelf: "center" },
  viewBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, padding: "0.35rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  editBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, padding: "0.35rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: "#e65100", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  delBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, padding: "0.35rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.danger, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },

  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", marginTop: "1.25rem" },
  pageBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "0.45rem 0.8rem", minHeight: 44, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, fontWeight: 600, cursor: "pointer" },
  pageInfo: { fontSize: "0.85rem", color: colors.textSecondary },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },

  codeChip: { fontFamily: "monospace", fontSize: "0.7rem", fontWeight: 600, color: colors.textSecondary, background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, padding: "0 5px", borderRadius: 4, whiteSpace: "nowrap", flexShrink: 0 },

  // View dialog
  viewMetaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem", marginBottom: "0.9rem" },
  viewMetaVal: { fontSize: "0.88rem", fontWeight: 600, color: colors.textPrimary },
  tbl: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 520 },
  th: { textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: `2px solid ${colors.cardBorder}`, color: colors.textSecondary, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" },
  td: { padding: "0.5rem 0.6rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "top", color: colors.textPrimary },
  tdNum: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },

  // Form: line rows wrap (inline on desktop, stacked on phones)
  lineCard: { display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end", padding: "0.6rem 0.7rem", background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 10 },
  lineInput: { width: "100%", minHeight: 44, padding: "0.5rem 0.7rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: "#fff", color: colors.textPrimary, outline: "none" },
  lineRemoveBtn: { flex: "0 0 44px", display: "grid", placeItems: "center", width: 44, height: 44, minHeight: 44, padding: 0, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.danger, cursor: "pointer", boxShadow: "none" },
  addLineBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, marginTop: "0.6rem", padding: "0.45rem 0.9rem", borderRadius: 8, border: `1px dashed ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  totalsBar: { display: "flex", alignItems: "center", gap: "0.5rem 1.25rem", flexWrap: "wrap", marginTop: "0.9rem", padding: "0.6rem 0.8rem", background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 10 },
  totalsCell: { fontSize: "0.82rem", color: colors.textSecondary },
  totalsVal: { color: colors.textPrimary, fontVariantNumeric: "tabular-nums", marginLeft: 4 },
  saveHint: { marginTop: "0.5rem", fontSize: "0.76rem", color: colors.textSecondary, lineHeight: 1.4 },
};

// AccountSelect styles — mirrors Components/SearchableSelect, 44px trigger.
const as = {
  trigger: {
    display: "flex", alignItems: "center", gap: "0.25rem", width: "100%",
    padding: "0.5rem 0.7rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8,
    backgroundColor: "#fff", fontSize: "0.9rem", color: colors.textPrimary,
    cursor: "pointer", textAlign: "left", minHeight: 44, boxShadow: "none",
  },
  triggerLabel: { flex: 1, minWidth: 0, overflow: "hidden" },
  selectedName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  placeholder: { color: "#94a3b8", fontWeight: 400 },
  dropdown: (rect) => {
    const spaceBelow = window.innerHeight - rect.bottom;
    const listHeight = 320;
    const flipAbove = spaceBelow < 220 && rect.top > spaceBelow;
    return {
      position: "fixed",
      top: flipAbove ? undefined : rect.bottom + 2,
      bottom: flipAbove ? window.innerHeight - rect.top + 2 : undefined,
      left: rect.left,
      width: Math.max(rect.width, 260),
      maxHeight: flipAbove ? Math.min(listHeight, rect.top - 10) : Math.min(listHeight, spaceBelow - 10),
      backgroundColor: "#fff", border: `1px solid ${colors.inputBorder}`, borderRadius: 8,
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 9999,
      display: "flex", flexDirection: "column",
    };
  },
  searchRow: { display: "flex", alignItems: "center", padding: "0.45rem 0.65rem", borderBottom: `1px solid ${colors.cardBorder}`, position: "relative" },
  searchIcon: { position: "absolute", left: 12, color: "#94a3b8" },
  searchInput: { width: "100%", padding: "0.35rem 0.35rem 0.35rem 1.85rem", border: `1px solid ${colors.cardBorder}`, borderRadius: 6, fontSize: "0.85rem", outline: "none", backgroundColor: colors.inputBg },
  list: { overflowY: "auto", flex: 1 },
  // Wrap long account names — no nowrap+ellipsis on user-supplied strings.
  row: { display: "flex", alignItems: "center", gap: 8, padding: "0.55rem 0.7rem", cursor: "pointer", borderBottom: "1px solid #f0f4f8", fontSize: "0.88rem", color: colors.textPrimary, lineHeight: 1.35 },
  rowName: { flex: 1, minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" },
  empty: { padding: "0.8rem", color: colors.textSecondary, fontSize: "0.85rem" },
};
