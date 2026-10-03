import { useState, useEffect, useCallback } from "react";
import {
  MdFolder, MdAdd, MdEdit, MdDelete, MdVisibility,
  MdChevronLeft, MdChevronRight, MdInsertDriveFile, MdInbox,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { useConfirm } from "./ConfirmDialog";
import { getPagedFolders, deleteFolder, getUncategorizedAttachments } from "../api/attachmentApi";
import usePageSize, { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import PageSizeSelect from "./PageSizeSelect";
import FolderFormModal from "./FolderFormModal";
import FolderDetailModal from "./FolderDetailModal";
import { CompanyPicker, Button, IconButton, Toolbar, ToolbarSpacer, SearchBox, EmptyState, Loading } from "../ui/Kit";

const colors = { blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3" };

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
  const [pageSize, setPageSize] = usePageSize("folders");
  const [observedSize, setObservedSize] = useState(null);
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
      if (pageSize) params.pageSize = pageSize;
      if (search) params.search = search;
      const { data } = await getPagedFolders(companyId, params);
      setFolders(data.items); setTotalCount(data.totalCount); setTotalPages(data.totalPages); setObservedSize(data.pageSize ?? null);
      // Count of attachments not filed in any folder — for the permanent
      // "Uncategorized" card (also reconciles against disk).
      getUncategorizedAttachments(companyId)
        .then(({ data: u }) => setUncategorizedCount((u || []).length))
        .catch(() => setUncategorizedCount(0));
    } catch { setFolders([]); setTotalCount(0); setTotalPages(0); }
    finally { setLoading(false); }
  }, [page, pageSize, search]);

  useEffect(() => { setPage(1); setSearch(""); }, [selectedCompany]);
  useEffect(() => {
    if (selectedCompany) fetchFolders(selectedCompany.id, page);
    else setFolders([]);
  }, [selectedCompany, page, pageSize, search]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <CompanyPicker />

      {loadingCompanies ? <Loading>Loading companies...</Loading>
        : companies.length === 0 ? <EmptyState icon={MdFolder}>No companies available. Add a company first.</EmptyState>
        : selectedCompany && (
          <Toolbar>
            <SearchBox value={search} placeholder="Search folders..."
              onChange={(text) => { setSearch(text); setPage(1); }} />
            <ToolbarSpacer />
            {canCreate && (
              <Button variant="primary" icon={MdAdd} onClick={() => { setEditFolder(null); setShowForm(true); }}>
                New Folder
              </Button>
            )}
          </Toolbar>
        )}

      {loading ? <Loading>Loading folders...</Loading>
        : !selectedCompany ? null
        : (
          <>
            <div style={st.grid}>
              {/* Permanent, non-deletable Uncategorized bucket — attachments can
                  be filed here without creating a folder. Hidden during search. */}
              {!search && (
                <article className="k-card" style={{ ...st.card, ...st.uncatCard }}>
                  <div className="k-card__body" style={st.cardBody}>
                    <div style={st.cardTop}>
                      <div style={{ ...st.folderIcon, ...st.uncatIcon }}><MdInbox size={24} color="#fff" /></div>
                      <span style={st.countPill}><MdInsertDriveFile size={13} /> {uncategorizedCount}</span>
                    </div>
                    <h3 style={st.name}>Uncategorized</h3>
                    <div style={st.desc}>Attachments not filed in any folder.</div>
                    <div style={st.meta}>{uncategorizedCount} attachment{uncategorizedCount !== 1 ? "s" : ""}</div>
                    <div style={st.actions}>
                      <Button variant="primary" size="sm" icon={MdVisibility} style={{ flex: 1 }}
                        onClick={() => setDetailFolder({ id: null, name: "Uncategorized", uncategorized: true, description: "Attachments not filed in any folder." })}>
                        Open
                      </Button>
                      <span style={st.systemTag}>System</span>
                    </div>
                  </div>
                </article>
              )}
              {folders.map((f) => (
                <article key={f.id} className="k-card" style={st.card}>
                  <div className="k-card__body" style={st.cardBody}>
                    <div style={st.cardTop}>
                      <div style={st.folderIcon}><MdFolder size={24} color="#fff" /></div>
                      <span style={st.countPill}><MdInsertDriveFile size={13} /> {f.attachmentCount}</span>
                    </div>
                    <h3 style={st.name} title={f.name}>{f.name}</h3>
                    {f.description && <div style={st.desc} title={f.description}>{f.description}</div>}
                    <div style={st.meta}>{f.attachmentCount} attachment{f.attachmentCount !== 1 ? "s" : ""}</div>
                    <div style={st.actions}>
                      <Button variant="primary" size="sm" icon={MdVisibility} style={{ flex: 1 }} onClick={() => setDetailFolder(f)}>Open</Button>
                      {canUpdate && <IconButton label="Rename" icon={MdEdit} size={16} onClick={() => { setEditFolder(f); setShowForm(true); }} />}
                      {canDelete && <IconButton label="Delete" icon={MdDelete} size={16} danger onClick={() => handleDelete(f)} />}
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {search && folders.length === 0 && <EmptyState icon={MdFolder}>No folders match your search.</EmptyState>}
            {totalCount > PAGE_SIZE_OPTIONS[0] && (
              <div style={st.pagination}>
                <PageSizeSelect value={pageSize ?? observedSize} onChange={(n) => { setPageSize(n); setPage(1); }} />
                {totalPages > 1 && (<>
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><MdChevronLeft size={20} /> Prev</Button>
                  <span style={st.pageInfo}>Page {page} of {totalPages} ({totalCount} total)</span>
                  <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next <MdChevronRight size={20} /></Button>
                </>)}
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

const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" };

const st = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: "var(--k-gap)" },
  // Kit card (same shape as the client / company cards). marginTop: 0 cancels `.k-card + .k-card` in the grid.
  card: { display: "flex", flexDirection: "column", marginTop: 0 },
  cardBody: { flex: 1, display: "flex", flexDirection: "column" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  folderIcon: { width: "calc(var(--k-h) + 4px)", height: "calc(var(--k-h) + 4px)", borderRadius: "var(--k-radius)", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, display: "grid", placeItems: "center", flexShrink: 0 },
  countPill: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: colors.blue, background: "#e3f0ff", padding: "0.2rem 0.55rem", borderRadius: 20 },
  name: { ...clamp2, margin: "0.7rem 0 0", fontWeight: 700, fontSize: "calc(var(--k-font) + 0.1rem)", color: colors.textPrimary },
  desc: { ...clamp2, marginTop: "0.25rem", fontSize: "var(--k-font-sm)", color: colors.textSecondary },
  meta: { marginTop: "0.5rem", fontSize: "0.76rem", color: colors.textSecondary },
  actions: { display: "flex", gap: "0.4rem", marginTop: "auto", paddingTop: "0.75rem", borderTop: `1px solid ${colors.cardBorder}`, alignItems: "center" },
  uncatCard: { background: "#fafcff", borderStyle: "dashed" },
  uncatIcon: { background: `linear-gradient(135deg, ${colors.teal}, #26a69a)` },
  systemTag: { fontSize: "0.66rem", fontWeight: 700, color: colors.textSecondary, background: "#eef1f5", padding: "0.15rem 0.5rem", borderRadius: 6, textTransform: "uppercase", letterSpacing: "0.03em" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", flexWrap: "wrap", gap: "1rem", padding: "1rem 0", marginTop: "0.5rem" },
  pageInfo: { fontSize: "var(--k-font-sm)", color: colors.textSecondary, fontWeight: 500 },
};