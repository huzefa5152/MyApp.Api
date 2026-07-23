import { forwardRef, useImperativeHandle, useState, useEffect, useCallback, useRef } from "react";
import {
  MdAttachFile, MdUploadFile, MdDownload, MdVisibility, MdDelete, MdCreateNewFolder,
} from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { useConfirm } from "./ConfirmDialog";
import { fileIconFor, humanSize } from "../utils/fileIcons";
import {
  getFolders, uploadAttachment, getAttachmentsByEntity, getAttachmentsByFolder,
  getUncategorizedAttachments, downloadAttachment, deleteAttachment,
  getFolderSourceSummary, getUncategorizedSourceSummary,
} from "../api/attachmentApi";
import AttachmentPreviewModal from "./AttachmentPreviewModal";
import FolderFormModal from "./FolderFormModal";

/**
 * The single reusable attachment component for the whole ERP.
 *
 * Three ways to use it:
 *   • Folder library  — pass `folderContext={folderId}`. Lists + uploads files
 *     into that folder. (Used by FolderDetailModal.)
 *   • Transaction (saved record) — pass `entityType` + `entityId`. Uploads
 *     attach to the record immediately; an optional folder can be chosen.
 *   • Transaction (new record) — pass `entityType` with `entityId=null`. Files
 *     are STAGED client-side; the parent form calls `ref.flush(savedId)` after
 *     it saves the record to upload them against the new id.
 *
 * `mode="view"` renders read-only (preview + download, no upload/remove) for
 * detail screens. All upload/remove UI is permission-gated, so the component
 * is safe to embed anywhere.
 */
const AttachmentManager = forwardRef(function AttachmentManager(
  { companyId, entityType = null, entityId = null, folderContext = null, uncategorized = false, mode = "edit", title = "Attachments" },
  ref
) {
  const { has } = usePermissions();
  const confirm = useConfirm();

  const isView = mode === "view";
  const canUpload = !isView && has("attachments.manage.upload");
  const canDelete = !isView && has("attachments.manage.delete");
  const canCreateFolder = has("folders.manage.create");

  const inUncategorized = uncategorized === true;       // the always-present "Uncategorized" bucket (FolderId == null)
  const inFolderMode = folderContext != null || inUncategorized; // folder-library use (named folder OR uncategorized)
  const hasEntity = !!entityType;                       // transaction use
  const savedEntity = hasEntity && entityId != null;    // record exists → upload now

  const [existing, setExisting] = useState([]);         // server-side attachments
  const [staged, setStaged] = useState([]);             // [{file, localUrl}] pre-save
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(folderContext != null ? String(folderContext) : "");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [sourceSummary, setSourceSummary] = useState({});   // { key: count } — folder mode filter chips
  const [sourceFilter, setSourceFilter] = useState("All");  // "All" | "Direct" | entity type
  const fileInputRef = useRef(null);

  const loadExisting = useCallback(async () => {
    if (!companyId) return;
    if (inFolderMode) {
      setLoading(true);
      try {
        const src = sourceFilter !== "All" ? sourceFilter : undefined;
        const listP = inUncategorized
          ? getUncategorizedAttachments(companyId, src)
          : getAttachmentsByFolder(companyId, folderContext, src);
        const sumP = inUncategorized
          ? getUncategorizedSourceSummary(companyId)
          : getFolderSourceSummary(companyId, folderContext);
        const [{ data }, { data: sum }] = await Promise.all([listP, sumP]);
        setExisting(Array.isArray(data) ? data : []);
        // Guard against the SPA-fallback-404 gotcha: an old/absent backend serves
        // index.html (200 text/html) for the source-summary route, so `sum` can be
        // an HTML string. Only accept a plain object → otherwise the chips hide.
        setSourceSummary(sum && typeof sum === "object" && !Array.isArray(sum) ? sum : {});
      }
      catch { setExisting([]); setSourceSummary({}); }
      finally { setLoading(false); }
    } else if (savedEntity) {
      setLoading(true);
      try { const { data } = await getAttachmentsByEntity(companyId, entityType, entityId); setExisting(data || []); }
      catch { setExisting([]); }
      finally { setLoading(false); }
    } else {
      setExisting([]); // new unsaved record — nothing server-side yet
    }
  }, [companyId, inFolderMode, inUncategorized, folderContext, savedEntity, entityType, entityId, sourceFilter]);

  useEffect(() => { loadExisting(); }, [loadExisting]);

  // Folder dropdown — only in entity mode (folder mode is pinned to its folder).
  useEffect(() => {
    if (inFolderMode || !hasEntity || isView) return;
    getFolders(companyId).then(({ data }) => setFolders(data || [])).catch(() => setFolders([]));
  }, [companyId, inFolderMode, hasEntity, isView]);

  // Imperative API for the parent form's create flow: flush staged uploads
  // once the record has been saved and has a real id.
  useImperativeHandle(ref, () => ({
    hasPending: () => staged.length > 0,
    flush: async (savedEntityId) => {
      const id = savedEntityId ?? entityId;
      if (!hasEntity || id == null || staged.length === 0) return;
      for (const s of staged) {
        try {
          await uploadAttachment(companyId, {
            file: s.file, entityType, entityId: id, folderId: selectedFolderId || undefined,
          });
        } catch {
          notify(`Could not attach "${s.file.name}".`, "error");
        }
      }
      staged.forEach((s) => s.localUrl && URL.revokeObjectURL(s.localUrl));
      setStaged([]);
    },
  }), [staged, hasEntity, entityId, companyId, entityType, selectedFolderId]);

  // Revoke staged object URLs on unmount.
  useEffect(() => () => { staged.forEach((s) => s.localUrl && URL.revokeObjectURL(s.localUrl)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPickFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || !canUpload) return;

    if (savedEntity || inFolderMode) {
      setBusy(true);
      let ok = 0;
      for (const file of files) {
        try {
          await uploadAttachment(companyId, {
            file,
            folderId: inUncategorized ? undefined : (folderContext != null ? folderContext : (selectedFolderId || undefined)),
            entityType: hasEntity ? entityType : undefined,
            entityId: hasEntity ? entityId : undefined,
          });
          ok++;
        } catch (err) {
          notify(err.response?.data?.error || err.response?.data?.message || `Could not upload "${file.name}".`, "error");
        }
      }
      setBusy(false);
      if (ok) { notify(`${ok} file${ok !== 1 ? "s" : ""} uploaded.`, "success"); await loadExisting(); }
    } else {
      // New unsaved entity — stage until flush(savedId).
      setStaged((prev) => [...prev, ...files.map((file) => ({ file, localUrl: URL.createObjectURL(file) }))]);
    }
  };

  const handleInputChange = (e) => {
    // Materialize into a real array BEFORE clearing the input. Reading
    // e.target.files AFTER value="" yields an EMPTY live FileList — that's why
    // nothing uploaded. (Same lesson as ProfilePage's avatar picker, which
    // grabs the File first.)
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    onPickFiles(files);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (canUpload) onPickFiles(e.dataTransfer.files);
  };

  const removeExisting = async (att) => {
    const ok = await confirm({ title: "Remove attachment?", message: `Delete "${att.fileName}"? This cannot be undone.`, variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    try { await deleteAttachment(att.id); await loadExisting(); }
    catch (err) { notify(err.response?.data?.error || "Could not delete the file.", "error"); }
  };

  const removeStaged = (idx) => setStaged((prev) => {
    const s = prev[idx];
    if (s?.localUrl) URL.revokeObjectURL(s.localUrl);
    return prev.filter((_, i) => i !== idx);
  });

  const downloadExisting = async (att) => {
    try { const res = await downloadAttachment(att.id); triggerBrowserDownload(res.data, att.fileName); }
    catch { notify("Could not download the file.", "error"); }
  };

  const previewExisting = (att) => setPreview({
    title: att.fileName, ext: att.fileExtension,
    loadBlob: () => downloadAttachment(att.id).then((r) => r.data),
    onDownload: () => downloadExisting(att),
  });

  const previewStaged = (s) => setPreview({
    title: s.file.name, ext: extFromName(s.file.name),
    loadBlob: () => Promise.resolve(s.file),
    onDownload: () => triggerBrowserDownload(s.file, s.file.name),
  });

  const totalCount = existing.length + staged.length;

  return (
    <div
      style={{ ...st.wrap, ...(dragOver ? st.wrapDrag : null) }}
      onDragOver={canUpload ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={canUpload ? () => setDragOver(false) : undefined}
      onDrop={canUpload ? handleDrop : undefined}
    >
      <div style={st.head}>
        <span style={st.headTitle}>
          <MdAttachFile size={16} /> {title} <span style={st.count}>({totalCount} added)</span>
        </span>
        {canUpload && (
          <button type="button" style={{ ...st.uploadBtn, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={() => fileInputRef.current?.click()}>
            <MdUploadFile size={16} /> {busy ? "Uploading…" : "Upload"}
          </button>
        )}
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleInputChange} />
      </div>

      {/* Folder selector + inline create — entity mode, edit only */}
      {canUpload && hasEntity && !inFolderMode && (
        <div style={st.folderRow}>
          <label style={st.folderLabel}>Folder <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <select style={st.folderSelect} value={selectedFolderId} onChange={(e) => setSelectedFolderId(e.target.value)}>
            <option value="">Uncategorized</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {canCreateFolder && (
            <button type="button" style={st.newFolderBtn} onClick={() => setShowCreateFolder(true)}>
              <MdCreateNewFolder size={15} /> New
            </button>
          )}
        </div>
      )}

      {/* Source filter chips — folder / uncategorized mode only, shown once a
          folder mixes more than one origin (e.g. direct uploads + files carried
          in from documents). */}
      {inFolderMode && Object.keys(sourceSummary).length >= 2 && (
        <div style={st.chipRow}>
          {buildSourceChips(sourceSummary).map((c) => {
            const active = sourceFilter === c.key;
            return (
              <button key={c.key} type="button"
                style={{ ...st.chip, ...(active ? st.chipActive : null) }}
                onClick={() => setSourceFilter(c.key)}>
                {c.label} <span style={st.chipCount}>{c.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {busy && (
        <div style={st.uploading}><span style={st.spin} /> Uploading…</div>
      )}

      {loading ? (
        <div style={st.empty}>Loading…</div>
      ) : totalCount === 0 ? (
        <div style={st.empty}>{canUpload ? "No attachments yet — click Upload or drop files here." : "No attachments."}</div>
      ) : (
        <div style={st.list}>
          {existing.map((att) => (
            <Row key={`e-${att.id}`} name={att.fileName} ext={att.fileExtension} size={att.fileSizeBytes}
              folderName={!inFolderMode ? att.folderName : null} when={att.createdAt}
              sourceLabel={inFolderMode ? att.sourceLabel : null} entityNumber={att.entityNumber}
              onPreview={() => previewExisting(att)} onDownload={() => downloadExisting(att)}
              onRemove={canDelete ? () => removeExisting(att) : null} />
          ))}
          {staged.map((s, i) => (
            <Row key={`s-${i}`} name={s.file.name} ext={extFromName(s.file.name)} size={s.file.size} pending
              onPreview={() => previewStaged(s)} onRemove={() => removeStaged(i)} />
          ))}
        </div>
      )}

      {preview && <AttachmentPreviewModal {...preview} onClose={() => setPreview(null)} />}
      {showCreateFolder && (
        <FolderFormModal companyId={companyId}
          onClose={() => setShowCreateFolder(false)}
          onSaved={(folder) => {
            setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
            setSelectedFolderId(String(folder.id));
            notify(`Folder "${folder.name}" created and selected.`, "success");
          }} />
      )}
    </div>
  );
});

export default AttachmentManager;

// ── helpers ──────────────────────────────────────────────────────────
function triggerBrowserDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const extFromName = (n = "") => { const i = String(n).lastIndexOf("."); return i >= 0 ? n.slice(i) : ""; };

const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(dt.getDate()).padStart(2, "0")}-${m[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`;
};

// Fixed display order + labels for the source filter chips. Invoice / Payment
// stay generic here (grouped by EntityType); a row's own chip shows the precise
// sub-kind (Credit Note / Receipt) via its server-resolved sourceLabel.
const SOURCE_ORDER = ["Direct", "SalesQuote", "SalesOrder", "DeliveryChallan", "Invoice", "PurchaseBill", "GoodsReceipt", "Payment"];
const SOURCE_LABELS = {
  Direct: "Direct", SalesQuote: "Sales Quote", SalesOrder: "Sales Order",
  DeliveryChallan: "Delivery Challan", Invoice: "Invoice", PurchaseBill: "Purchase Bill",
  GoodsReceipt: "Goods Receipt", Payment: "Payment",
};

// Builds the chip list from a { key: count } summary: an "All" chip (total),
// then only the sources actually present, in a stable order.
function buildSourceChips(summary) {
  const total = Object.values(summary).reduce((a, b) => a + (b || 0), 0);
  const chips = [{ key: "All", label: "All", count: total }];
  for (const key of SOURCE_ORDER) {
    if (summary[key] > 0) chips.push({ key, label: SOURCE_LABELS[key] || key, count: summary[key] });
  }
  return chips;
}

function Row({ name, ext, size, folderName, when, sourceLabel, entityNumber, pending, onPreview, onDownload, onRemove }) {
  const { Icon, color } = fileIconFor(ext || name);
  const isDirect = sourceLabel === "Direct upload";
  return (
    <div style={st.row}>
      <div style={{ ...st.icoBox, color }}><Icon size={22} /></div>
      <div style={st.rowMain}>
        <div style={st.rowName} title={name}>{name}{pending && <span style={st.pendBadge}>pending</span>}</div>
        <div style={st.rowMeta}>
          {humanSize(size)}{folderName ? ` · 📁 ${folderName}` : ""}{when ? ` · ${fmtDate(when)}` : ""}
        </div>
        {sourceLabel && (
          <span style={{ ...st.srcChip, ...(isDirect ? st.srcChipDirect : null) }} title={`Source: ${sourceLabel}${entityNumber ? ` #${entityNumber}` : ""}`}>
            {isDirect ? "📁" : "📄"} {sourceLabel}{entityNumber ? ` #${entityNumber}` : ""}
          </span>
        )}
      </div>
      <div style={st.rowActions}>
        <button type="button" style={st.iconBtn} title="Preview" onClick={onPreview}><MdVisibility size={17} /></button>
        {onDownload && <button type="button" style={st.iconBtn} title="Download" onClick={onDownload}><MdDownload size={17} /></button>}
        {onRemove && <button type="button" style={{ ...st.iconBtn, color: "#dc3545", borderColor: "#dc354533" }} title="Remove" onClick={onRemove}><MdDelete size={17} /></button>}
      </div>
    </div>
  );
}

const colors = { blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBorder: "#d0d7e2", inputBg: "#f8f9fb" };

const st = {
  wrap: { marginTop: "1rem", border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.85rem 1rem", background: "#fff", transition: "border-color 0.15s, background 0.15s" },
  wrapDrag: { borderColor: colors.teal, background: `${colors.teal}08` },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
  headTitle: { display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: "0.9rem", color: colors.textPrimary },
  count: { color: colors.teal, fontWeight: 700 },
  uploadBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.4rem 0.9rem", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  folderRow: { display: "flex", alignItems: "center", gap: 8, marginTop: "0.7rem", flexWrap: "wrap" },
  folderLabel: { fontSize: "0.8rem", fontWeight: 600, color: colors.textSecondary },
  folderSelect: { flex: 1, minWidth: 160, maxWidth: 280, padding: "0.45rem 0.6rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, fontSize: "0.85rem", color: colors.textPrimary, cursor: "pointer" },
  newFolderBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "0.4rem 0.7rem", borderRadius: 8, border: `1px solid ${colors.teal}40`, background: `${colors.teal}12`, color: colors.teal, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" },
  chipRow: { marginTop: "0.7rem", display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { display: "inline-flex", alignItems: "center", gap: 5, padding: "0.3rem 0.7rem", minHeight: 30, borderRadius: 20, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.textSecondary, fontSize: "0.76rem", fontWeight: 600, cursor: "pointer" },
  chipActive: { border: `1px solid ${colors.blue}`, background: "#e3f0ff", color: colors.blue },
  chipCount: { fontSize: "0.7rem", fontWeight: 700, opacity: 0.85 },
  srcChip: { display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, padding: "0.1rem 0.5rem", borderRadius: 6, background: "#eef4ff", color: colors.blue, fontSize: "0.7rem", fontWeight: 600, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  srcChipDirect: { background: `${colors.teal}14`, color: colors.teal },
  list: { marginTop: "0.7rem", display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "0.5rem 0.6rem", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, background: colors.inputBg },
  icoBox: { display: "grid", placeItems: "center", width: 34, height: 34, flexShrink: 0 },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontSize: "0.85rem", fontWeight: 600, color: colors.textPrimary, display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-all" },
  pendBadge: { marginLeft: 8, fontSize: "0.66rem", fontWeight: 700, color: "#fd7e14", background: "#fff3cd", padding: "0.05rem 0.4rem", borderRadius: 6 },
  rowMeta: { fontSize: "0.74rem", color: colors.textSecondary, marginTop: 2 },
  rowActions: { display: "flex", gap: 4, flexShrink: 0 },
  iconBtn: { display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, cursor: "pointer" },
  empty: { marginTop: "0.7rem", padding: "0.9rem", textAlign: "center", color: colors.textSecondary, fontSize: "0.83rem", border: `1px dashed ${colors.cardBorder}`, borderRadius: 10 },
  uploading: { marginTop: "0.7rem", display: "flex", alignItems: "center", gap: 8, padding: "0.5rem 0.7rem", borderRadius: 8, background: `${colors.teal}10`, color: colors.teal, fontSize: "0.82rem", fontWeight: 600 },
  spin: { width: 14, height: 14, border: `2px solid ${colors.teal}40`, borderTopColor: colors.teal, borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" },
};
