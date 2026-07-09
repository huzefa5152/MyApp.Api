import { useState, useEffect, useCallback } from "react";
import {
  MdFolder, MdAdd, MdSearch, MdEdit, MdDelete, MdVisibility, MdBusiness,
  MdChevronLeft, MdChevronRight, MdInsertDriveFile, MdInbox,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { useConfirm } from "./ConfirmDialog";
import { getPagedFolders, deleteFolder, getUncategorizedAttachments } from "../api/attachmentApi";
import { dropdownStyles } from "../theme";
import FolderFormModal from "./FolderFormModal";
import FolderDetailModal from "./FolderDetailModal";

const colors = { blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBorder: "#d0d7e2" };

// Folder listing + CRUD for the Configuration → Folders document library.
// Folders are per-company, so a company selector scopes the view (mirrors
// SalesQuotePage). Opening a folder reuses <AttachmentManager> via the detail
// modal for upload / preview / download / delete.
export default function FoldersManager() {
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canCreate = has("folders.manage.create");
  const canUpdate = has("folders.manage.update");
  const canDelete = has("folders.manage.delete");

  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editFolder, setEditFolder] = useState(null);
  const [detailFolder, setDetailFolder] = useState(null);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);

  const fetchFolders = useCallback(async (companyId, pg) => {
    if (!companyId) return;
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (search) params.search = search;
      const { data } = await getPagedFolders(companyId, params);
      setFolders(data.items); setTotalCount(data.totalCount); setTotalPages(data.totalPages);
      // Count of attachments not filed in any folder — for the permanent
      // "Uncategorized" card (also reconciles against disk).
      getUncategorizedAttachments(companyId)
        .then(({ data: u }) => setUncategorizedCount((u || []).length))
        .catch(() => setUncategorizedCount(0));
    } catch { setFolders([]); setTotalCount(0); setTotalPages(0); }
    finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { setPage(1); setSearch(""); }, [selectedCompany]);
  useEffect(() => {
    if (selectedCompany) fetchFolders(selectedCompany.id, page);
    else setFolders([]);
  }, [selectedCompany, page, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = () => selectedCompany && fetchFolders(selectedCompany.id, page);

  const handleDelete = async (f) => {
    const ok = await confirm({
      title: "Delete folder?",
      message: `Delete "${f.name}"? Documents that belong only to this folder are permanently removed. Files also attached to a record (invoice, quote, …) are kept and simply un-categorized.`,
      variant: "danger", confirmText: "Delete",
    });
    if (!ok) return;
    try { await deleteFolder(f.id); reload(); notify("Folder deleted.", "success"); }
    catch (err) { notify(err.response?.data?.error || "Failed to delete the folder.", "error"); }
  };

  return (
    <div>
      <div style={st.bar}>
        {companies.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select style={dropdownStyles.base} value={selectedCompany?.id || ""}
              onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </div>
        )}
        {selectedCompany && canCreate && (
          <button style={st.addBtn} onClick={() => { setEditFolder(null); setShowForm(true); }}>
            <MdAdd size={18} /> New Folder
          </button>
        )}
      </div>

      {loadingCompanies ? <Spinner label="Loading companies..." />
        : companies.length === 0 ? <Empty label="No companies available. Add a company first." />
        : selectedCompany && (
          <div className="filters-row" style={{ marginBottom: "1rem" }}>
            <div className="filter-search-wrap">
              <MdSearch size={15} className="filter-search-icon" />
              <input type="text" placeholder="Search folders..." className="filter-search-input"
                value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
          </div>
        )}

      {loading ? <Spinner label="Loading folders..." />
        : !selectedCompany ? null
        : (
          <>
            <div style={st.grid}>
              {/* Permanent, non-deletable Uncategorized bucket — attachments can
                  be filed here without creating a folder. Hidden during search. */}
              {!search && (
                <div style={{ ...st.card, ...st.uncatCard }}>
                  <div style={st.cardTop}>
                    <div style={{ ...st.folderIcon, ...st.uncatIcon }}><MdInbox size={26} color="#fff" /></div>
                    <span style={st.countPill}><MdInsertDriveFile size={13} /> {uncategorizedCount}</span>
                  </div>
                  <div style={st.name}>Uncategorized</div>
                  <div style={st.desc}>Attachments not filed in any folder.</div>
                  <div style={st.meta}>{uncategorizedCount} attachment{uncategorizedCount !== 1 ? "s" : ""}</div>
                  <div style={st.actions}>
                    <button style={st.viewBtn} onClick={() => setDetailFolder({ id: null, name: "Uncategorized", uncategorized: true, description: "Attachments not filed in any folder." })}><MdVisibility size={15} /> Open</button>
                    <span style={st.systemTag}>System</span>
                  </div>
                </div>
              )}
              {folders.map((f) => (
                <div key={f.id} style={st.card}>
                  <div style={st.cardTop}>
                    <div style={st.folderIcon}><MdFolder size={26} color="#fff" /></div>
                    <span style={st.countPill}><MdInsertDriveFile size={13} /> {f.attachmentCount}</span>
                  </div>
                  <div style={st.name} title={f.name}>{f.name}</div>
                  {f.description && <div style={st.desc} title={f.description}>{f.description}</div>}
                  <div style={st.meta}>{f.attachmentCount} attachment{f.attachmentCount !== 1 ? "s" : ""}</div>
                  <div style={st.actions}>
                    <button style={st.viewBtn} onClick={() => setDetailFolder(f)}><MdVisibility size={15} /> Open</button>
                    {canUpdate && <button style={st.iconBtn} title="Rename" onClick={() => { setEditFolder(f); setShowForm(true); }}><MdEdit size={16} /></button>}
                    {canDelete && <button style={{ ...st.iconBtn, color: "#dc3545", borderColor: "#dc354533" }} title="Delete" onClick={() => handleDelete(f)}><MdDelete size={16} /></button>}
                  </div>
                </div>
              ))}
            </div>
            {search && folders.length === 0 && <Empty label="No folders match your search." />}
            {totalPages > 1 && (
              <div style={st.pagination}>
                <button style={{ ...st.pageBtn, opacity: page <= 1 ? 0.4 : 1 }} disabled={page <= 1} onClick={() => setPage(page - 1)}><MdChevronLeft size={20} /> Prev</button>
                <span style={st.pageInfo}>Page {page} of {totalPages} ({totalCount} total)</span>
                <button style={{ ...st.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next <MdChevronRight size={20} /></button>
              </div>
            )}
          </>
        )}

      {showForm && selectedCompany && (
        <FolderFormModal companyId={selectedCompany.id} folder={editFolder}
          onClose={() => { setShowForm(false); setEditFolder(null); }}
          onSaved={() => { reload(); notify(editFolder ? "Folder renamed." : "Folder created.", "success"); }} />
      )}
      {detailFolder && selectedCompany && (
        <FolderDetailModal companyId={selectedCompany.id} folder={detailFolder}
          onClose={() => { setDetailFolder(null); reload(); }} />
      )}
    </div>
  );
}

const Spinner = ({ label }) => <div style={st.loading}><div style={st.spin} /><span style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>{label}</span></div>;
const Empty = ({ label }) => <div style={st.empty}><MdFolder size={40} color={colors.cardBorder} /><p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>{label}</p></div>;

const st = {
  bar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: "1rem" },
  card: { border: `1px solid ${colors.cardBorder}`, borderRadius: 14, padding: "1rem", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  folderIcon: { width: 46, height: 46, borderRadius: 12, background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, display: "grid", placeItems: "center", flexShrink: 0 },
  countPill: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: colors.blue, background: "#e3f0ff", padding: "0.2rem 0.55rem", borderRadius: 20 },
  name: { marginTop: "0.7rem", fontWeight: 700, fontSize: "1rem", color: colors.textPrimary, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  desc: { marginTop: "0.25rem", fontSize: "0.8rem", color: colors.textSecondary, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  meta: { marginTop: "0.5rem", fontSize: "0.76rem", color: colors.textSecondary },
  actions: { display: "flex", gap: "0.4rem", marginTop: "0.9rem", paddingTop: "0.75rem", borderTop: `1px solid ${colors.cardBorder}`, alignItems: "center" },
  viewBtn: { flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "0.45rem 0.6rem", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${colors.blue}, #1565c0)`, color: "#fff", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  iconBtn: { display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, cursor: "pointer" },
  uncatCard: { background: "#fafcff", borderStyle: "dashed" },
  uncatIcon: { background: `linear-gradient(135deg, ${colors.teal}, #26a69a)` },
  systemTag: { fontSize: "0.66rem", fontWeight: 700, color: colors.textSecondary, background: "#eef1f5", padding: "0.15rem 0.5rem", borderRadius: 6, textTransform: "uppercase", letterSpacing: "0.03em" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "1rem 0", marginTop: "0.5rem" },
  pageBtn: { display: "inline-flex", alignItems: "center", gap: "0.2rem", padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "3rem 0" },
  spin: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", textAlign: "center" },
};
