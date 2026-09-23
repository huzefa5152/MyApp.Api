import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  MdDescription, MdBusiness, MdSearch, MdAdd, MdAutoAwesome, MdGridOn,
  MdEdit, MdDelete, MdStar, MdStarBorder, MdVisibility, MdBrush, MdContentCopy,
  MdUploadFile, MdClose, MdLock, MdSwapHoriz, MdApproval, MdFilterAltOff,
} from "react-icons/md";
import {
  getTemplatesByCompany, createTemplate, setDefaultTemplate, deleteTemplate,
  uploadExcelTemplate, deleteExcelTemplate,
} from "../api/printTemplateApi";
import { setTemplateStamp } from "../api/printTemplateApi";
import { uploadStamp, updateStamp, deleteStamp, setDefaultStamp } from "../api/stampApi";
import StampPicker from "../Components/templateEditor/StampPicker";
import {
  STAMP_STATE, detectStampState, injectSignatureBlock, convertPinnedToSlot, pinnedSlugs,
  materializeStamp,
} from "../utils/stampSlot";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { dropdownStyles, formStyles, modalSizes } from "../theme";
import {
  TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL, buildTemplatePreviewHtml,
} from "../utils/templateSampleData";
import StarterGallery from "../Components/templateEditor/StarterGallery";
import ApplyStarterModal from "../Components/templateEditor/ApplyStarterModal";
import A4PreviewFrame from "../Components/templateEditor/A4PreviewFrame";
import NewTemplateDialog, { uniqueTemplateName } from "../Components/templateEditor/NewTemplateDialog";
import { setEditorEntry, peekRecentTemplate, clearRecentTemplate } from "../utils/templateEditorNav";

const colors = { blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBorder: "#d0d7e2" };
const fmtDate = (d) => { if (!d) return ""; const dt = new Date(d); const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${String(dt.getDate()).padStart(2,"0")}-${m[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`; };

const TABS = [
  { key: "print", label: "Print Templates", icon: MdDescription },
  { key: "starter", label: "Starter Templates", icon: MdAutoAwesome },
  { key: "excel", label: "Excel Templates", icon: MdGridOn },
  { key: "stamps", label: "Stamps", icon: MdApproval },
];

export default function PrintTemplatesPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies, companyStamps, refreshStamps } = useCompany();
  const { has } = usePermissions();
  const canManage = has("printtemplates.manage.update");
  const canDelete = has("printtemplates.manage.delete");
  const canApplyStarter = has("printtemplates.starter.apply");
  const canViewStamps = has("printtemplates.stamps.view");
  const canManageStamps = has("printtemplates.stamps.manage");

  const [tab, setTab] = useState("print");
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  // The card (or Excel row) whose action is in flight. Only that card shows a
  // spinner; every action locks while one runs so nothing can race.
  const [busyId, setBusyId] = useState(null);
  const busy = busyId != null;

  // filters (shared by Print + Excel tabs; the type filter also drives Starter)
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [defaultOnly, setDefaultOnly] = useState(false);
  // Starter-tab filters live here rather than inside the gallery, which
  // unmounts on every tab switch — so what was typed is still there on return.
  const [starterSearch, setStarterSearch] = useState("");
  const [starterSort, setStarterSort] = useState("catalog");

  const [applyTarget, setApplyTarget] = useState(null); // template to apply a starter onto
  const [previewTarget, setPreviewTarget] = useState(null); // template to preview
  const [copyTarget, setCopyTarget] = useState(null); // template to copy into another type
  const [newDialog, setNewDialog] = useState(null); // { initialType, initialStarter } while open
  const [creatingStarterId, setCreatingStarterId] = useState(null);
  const excelUploadRef = useRef(null);
  const excelTargetTypeRef = useRef(null);

  // Stamps tab
  const [stampModalOpen, setStampModalOpen] = useState(false);
  const [stampUploading, setStampUploading] = useState(false);
  const [stampBusyId, setStampBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!selectedCompany) { setTemplates([]); return; }
    setLoading(true);
    try {
      const { data } = await getTemplatesByCompany(selectedCompany.id);
      setTemplates(data || []);
    } catch { setTemplates([]); }
    finally { setLoading(false); }
  }, [selectedCompany]);

  useEffect(() => { load(); }, [load]);

  // ── The tab and every filter survive leaving the page ──────────────────
  // Editing takes the operator to /templates/edit and back. Before, that round
  // trip reset everything to "all", so a Challan-only view had to be re-picked
  // after every single edit. They are kept per company in sessionStorage and
  // restored when the page — or the company — comes back. The document type
  // deliberately carries across companies when the new one has nothing stored
  // yet: an operator comparing the same document type across companies should
  // not have to re-pick it every switch.
  const filtersKey = (cid) => `pt.filters.${cid}`;
  const restoredFor = useRef(null);
  useEffect(() => {
    const cid = selectedCompany?.id;
    if (!cid || restoredFor.current === cid) return;
    restoredFor.current = cid;
    let stored = null;
    try { stored = JSON.parse(sessionStorage.getItem(filtersKey(cid)) || "null"); } catch { /* ignore */ }
    if (stored) {
      const storedTab = TABS.some((t) => t.key === stored.tab) ? stored.tab : "print";
      setTab(storedTab === "stamps" && !canViewStamps ? "print" : storedTab);
      setTypeFilter(TEMPLATE_TYPES.some((t) => t.value === stored.typeFilter) ? stored.typeFilter : "");
      setDefaultOnly(!!stored.defaultOnly);
      setSearch(stored.search || "");
      setStarterSearch(stored.starterSearch || "");
      setStarterSort(stored.starterSort === "name" ? "name" : "catalog");
    } else {
      setSearch(""); setDefaultOnly(false); setStarterSearch("");
    }
  }, [selectedCompany?.id, canViewStamps]);
  useEffect(() => {
    const cid = selectedCompany?.id;
    if (!cid || restoredFor.current !== cid) return;
    try {
      sessionStorage.setItem(filtersKey(cid), JSON.stringify({ tab, typeFilter, defaultOnly, search, starterSearch, starterSort }));
    } catch { /* private mode — non-fatal */ }
  }, [selectedCompany?.id, tab, typeFilter, defaultOnly, search, starterSearch, starterSort]);

  // The template the operator was just editing is marked when they return, so
  // the eye lands on it instead of on a wall of near-identical cards.
  const [recentId, setRecentId] = useState(() => peekRecentTemplate());
  useEffect(() => { clearRecentTemplate(); }, []);
  useEffect(() => {
    if (!recentId || loading) return;
    // The card only exists on the Print tab; if the page came back on another
    // tab, wait until the operator opens Print rather than burning the
    // highlight while it cannot be seen.
    const el = document.getElementById(`tpl-card-${recentId}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(() => setRecentId(null), 6000);
    return () => clearTimeout(t);
  }, [recentId, loading, tab, typeFilter, search, defaultOnly]);

  // Per-type counts for the type filter, so "Bill / Invoice (3)" says at a
  // glance what the company has before the operator narrows to it.
  const countsByType = useMemo(() => {
    const m = {};
    templates.forEach((t) => { m[t.templateType] = (m[t.templateType] || 0) + 1; });
    return m;
  }, [templates]);

  const applyFilters = (rows) => rows.filter((t) => {
    if (typeFilter && t.templateType !== typeFilter) return false;
    if (defaultOnly && !t.isDefault) return false;
    if (search) {
      const q = search.toLowerCase();
      return (t.name || "").toLowerCase().includes(q) ||
             (TEMPLATE_TYPE_LABEL[t.templateType] || t.templateType).toLowerCase().includes(q);
    }
    return true;
  });

  const printRows = useMemo(() => applyFilters(templates).sort((a, b) =>
    a.templateType.localeCompare(b.templateType) || (b.isDefault - a.isDefault) || a.id - b.id
  ), [templates, typeFilter, defaultOnly, search]);

  // Grouped by document type — in the catalogue's order, not alphabetically by
  // key — when no type is picked, so a company with a dozen kinds of document
  // reads as a dozen short shelves instead of one long wall of cards.
  const printGroups = useMemo(() => (
    typeFilter
      ? [[typeFilter, printRows]]
      : TEMPLATE_TYPES.map((tt) => [tt.value, printRows.filter((t) => t.templateType === tt.value)])
          .filter(([, rows]) => rows.length > 0)
  ), [printRows, typeFilter]);
  const filtersActive = !!(search || typeFilter || defaultOnly);
  const clearFilters = () => { setSearch(""); setTypeFilter(""); setDefaultOnly(false); };

  // Excel is ONE layout per document TYPE (not per print template). It attaches
  // to the type's default template — which is exactly what the document screens
  // (hasExcelTemplate) and the export resolver key off. So the Excel tab shows a
  // single row per type, reflecting that type's default template's Excel state.
  const excelTypeRows = useMemo(() =>
    TEMPLATE_TYPES.filter((tt) => {
      if (typeFilter && tt.value !== typeFilter) return false;
      if (search && !tt.label.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }).map((tt) => {
      const ofType = templates.filter((t) => t.templateType === tt.value);
      const def = ofType.find((t) => t.isDefault) || ofType[0] || null;
      return {
        type: tt.value,
        label: tt.label,
        templateCount: ofType.length,
        hasTemplate: ofType.length > 0,
        hasExcel: !!def?.hasExcelTemplate,
        sheet: def?.excelSheetName || null,
      };
    }),
    [templates, typeFilter, search]
  );

  // ── Navigation to the editor (localStorage restore contract) ──
  const openInEditor = (t) => {
    setEditorEntry({ type: t.templateType, companyId: selectedCompany.id, templateId: t.id });
    navigate("/templates/edit");
  };
  // Every "new" path goes through one dialog: type, name, and what to start
  // from. The row is created there and then, so the editor always opens on a
  // saved template — no more empty editor with Save greyed out until named.
  const openNewDialog = (initialType = typeFilter, initialStarter = null) =>
    setNewDialog({ initialType: initialType || "Challan", initialStarter });
  const onCreated = (dto) => {
    setNewDialog(null);
    notify(`Created "${dto.name}". Opening editor…`, "success");
    openInEditor(dto);
  };

  // ── Print-tab actions ──
  const handleSetDefault = async (t) => {
    setBusyId(t.id);
    try { await setDefaultTemplate(t.id); notify(`"${t.name}" is now the default for ${TEMPLATE_TYPE_LABEL[t.templateType]}.`, "success"); await load(); }
    catch { notify("Failed to set default.", "error"); } finally { setBusyId(null); }
  };
  const handleDelete = async (t) => {
    const ok = await confirm({ title: "Delete Template?", message: `Delete "${t.name}" (${TEMPLATE_TYPE_LABEL[t.templateType]})? This cannot be undone.`, variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    setBusyId(t.id);
    try { await deleteTemplate(t.id); notify("Template deleted.", "success"); await load(); }
    catch (err) { notify(err.response?.data?.error || "Failed to delete.", "error"); } finally { setBusyId(null); }
  };
  const handleDuplicate = async (t) => {
    setBusyId(t.id);
    try {
      await createTemplate(selectedCompany.id, {
        templateType: t.templateType,
        name: uniqueTemplateName(`${t.name} (copy)`, templates),
        htmlContent: t.htmlContent, templateJson: t.templateJson,
        editorMode: t.editorMode, isDefault: false,
        // Duplicate keeps the source's signature; the assignment lives on the
        // row, so the duplicate can then be changed independently.
        stampId: t.stampId ?? null,
      });
      notify(`Duplicated "${t.name}".`, "success"); await load();
    } catch { notify("Failed to duplicate.", "error"); } finally { setBusyId(null); }
  };
  // Copy this template's HTML into a NEW template of a DIFFERENT document type,
  // then open it so the operator can adapt the (type-specific) merge fields.
  const handleCopyToType = async (t, chosenType) => {
    setCopyTarget(null);
    setBusyId(t.id);
    try {
      const { data } = await createTemplate(selectedCompany.id, {
        templateType: chosenType,
        name: uniqueTemplateName(`${t.name} → ${TEMPLATE_TYPE_LABEL[chosenType]}`, templates),
        htmlContent: t.htmlContent, templateJson: t.templateJson,
        editorMode: t.editorMode, isDefault: false,
        // The copy starts life signed exactly like its source; because the
        // assignment lives on the row, the copy can then be changed
        // independently without touching either template's HTML.
        stampId: t.stampId ?? null,
      });
      notify(`Copied to ${TEMPLATE_TYPE_LABEL[chosenType]} — adjust the merge fields for the new document type.`, "success");
      openInEditor(data);
    } catch { notify("Failed to copy template.", "error"); setBusyId(null); }
  };

  // ── Starter-tab: create a NEW company-level template from a starter ──
  // One click, one template: the chosen card shows "Creating…", the name is
  // made unique if this starter was used before, and the editor opens on it.
  const createFromStarter = async (starter) => {
    if (creatingStarterId) return;
    setCreatingStarterId(starter.id);
    try {
      const { data } = await createTemplate(selectedCompany.id, {
        templateType: starter.type,
        name: uniqueTemplateName(starter.name, templates), htmlContent: starter.html, isDefault: false,
      });
      notify(`Created "${data.name}" from starter. Opening editor…`, "success");
      openInEditor(data);
    } catch { notify("Failed to create template from starter.", "error"); setCreatingStarterId(null); }
  };

  // ── Per-template stamp assignment ──

  // Assignment is a field write: the template's HTML is untouched, so swapping
  // a signature can never disturb the layout.
  const handleSetStamp = async (t, stampId) => {
    setStampBusyId(t.id);
    try {
      await setTemplateStamp(t.id, stampId);
      await load();
      notify(stampId ? "Signature updated." : "Signature removed.", "success");
    } catch (err) {
      notify(err.response?.data?.error || "Failed to update signature.", "error");
    } finally { setStampBusyId(null); }
  };

  // A template with no slot in its markup — inject one, then assign. Shows
  // where the block landed rather than silently rewriting the operator's HTML.
  const handleAddSignatureBlock = async (t) => {
    const { html, anchor, changed } = injectSignatureBlock(t.htmlContent || "");
    if (!changed) { notify("This template already has a signature block.", "info"); return; }
    const where = anchor === "signature-row" ? "inside the existing signature row"
      : anchor === "signature-text" ? "above the signature label"
      : "at the end of the document";
    const ok = await confirm({
      title: "Add signature block?",
      message: `A signature slot will be added ${where}. Nothing else in the template changes. `
        + `You can then pick which stamp it shows, and reposition it in the editor.`,
      confirmText: "Add block",
    });
    if (!ok) return;

    setStampBusyId(t.id);
    try {
      const firstStamp = companyStamps.find((s) => s.isDefault) || companyStamps[0] || null;
      await setTemplateStamp(t.id, firstStamp?.id ?? null, html);
      await load();
      notify(`Signature block added ${where}.`, "success");
    } catch (err) {
      notify(err.response?.data?.error || "Failed to add signature block.", "error");
    } finally { setStampBusyId(null); }
  };

  // A template that names its stamp inline ({{stamps.slug}}) — rewrite it to the
  // picker-driven {{stamp}} slot so the signature becomes changeable.
  const handleConvertToSlot = async (t) => {
    const slug = pinnedSlugs(t.htmlContent || "")[0];
    const match = companyStamps.find((s) => s.slug === slug) || null;
    const ok = await confirm({
      title: "Make the signature changeable?",
      message: `This template points straight at "${slug}". Converting keeps the same image but `
        + `lets you switch stamps from a dropdown instead of editing the HTML.`,
      confirmText: "Convert",
    });
    if (!ok) return;

    setStampBusyId(t.id);
    try {
      await setTemplateStamp(t.id, match?.id ?? null, convertPinnedToSlot(t.htmlContent || "", slug));
      await load();
      notify("Signature is now changeable.", "success");
    } catch (err) {
      notify(err.response?.data?.error || "Failed to convert.", "error");
    } finally { setStampBusyId(null); }
  };

  const handleStampSetDefault = async (s) => {
    setStampBusyId(s.id);
    try { await setDefaultStamp(selectedCompany.id, s.id); await refreshStamps(); notify(`"${s.name}" is now the default stamp.`, "success"); }
    catch { notify("Failed to set default stamp.", "error"); } finally { setStampBusyId(null); }
  };

  // ── Stamps-tab actions ──
  const handleStampUpload = async (file, name) => {
    if (!file || !selectedCompany) return;
    setStampUploading(true);
    try {
      await uploadStamp(selectedCompany.id, file, name || undefined);
      notify("Stamp uploaded.", "success");
      setStampModalOpen(false);
      await refreshStamps();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to upload stamp.", "error");
    } finally { setStampUploading(false); }
  };

  const handleStampRename = async (s) => {
    const name = window.prompt("Stamp name", s.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === s.name) return;
    setStampBusyId(s.id);
    try { await updateStamp(selectedCompany.id, s.id, { name: trimmed }); await refreshStamps(); notify("Stamp renamed.", "success"); }
    catch { notify("Failed to rename stamp.", "error"); } finally { setStampBusyId(null); }
  };

  const handleStampDelete = async (s) => {
    const ok = await confirm({
      title: "Delete stamp?",
      // Templates assigned this stamp lose the assignment (FK is SetNull) and
      // print unsigned — say so, and say how many, before deleting.
      message: s.usedByTemplates
        ? `Delete "${s.name}"? ${s.usedByTemplates} template${s.usedByTemplates === 1 ? "" : "s"} `
          + `use it and will print without a signature. Templates that name it directly as `
          + `{{stamps.${s.slug}}} will show a broken image.`
        : `Delete "${s.name}"? No template is using it.`,
      variant: "danger", confirmText: "Delete",
    });
    if (!ok) return;
    setStampBusyId(s.id);
    try { await deleteStamp(selectedCompany.id, s.id); notify("Stamp deleted.", "success"); await refreshStamps(); }
    catch { notify("Failed to delete stamp.", "error"); } finally { setStampBusyId(null); }
  };

  const copyStampToken = (s) => {
    const token = `{{stamps.${s.slug}}}`;
    try { navigator.clipboard.writeText(token); notify(`Copied ${token}`, "success"); }
    catch { notify(token, "info"); }
  };

  // ── Excel-tab actions (per document TYPE, company-level) ──
  const triggerExcelUpload = (type) => { excelTargetTypeRef.current = type; excelUploadRef.current?.click(); };
  const handleExcelFile = async (e) => {
    const file = e.target.files?.[0];
    const type = excelTargetTypeRef.current;
    if (excelUploadRef.current) excelUploadRef.current.value = "";
    if (!file || !type || !selectedCompany) return;
    setBusyId(`excel:${type}`);
    try { await uploadExcelTemplate(selectedCompany.id, type, file); notify("Excel layout uploaded.", "success"); await load(); }
    catch (err) { notify(err.response?.data?.error || "Failed to upload Excel.", "error"); } finally { setBusyId(null); }
  };
  const handleExcelDelete = async (row) => {
    const ok = await confirm({ title: "Remove Excel layout?", message: `Remove the Excel layout for ${row.label}? This cannot be undone.`, variant: "danger", confirmText: "Remove" });
    if (!ok) return;
    setBusyId(`excel:${row.type}`);
    try { await deleteExcelTemplate(selectedCompany.id, row.type); notify("Excel layout removed.", "success"); await load(); }
    catch { notify("Failed to remove Excel layout.", "error"); } finally { setBusyId(null); }
  };

  if (!canManage) {
    return (
      <div style={{ textAlign: "center", padding: "4rem 1.5rem", background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 14 }}>
        <MdLock style={{ fontSize: "2.5rem", color: colors.textSecondary }} />
        <h3 style={{ margin: "0.75rem 0 0.25rem" }}>Access denied</h3>
        <p style={{ margin: 0, color: colors.textSecondary, fontSize: "0.9rem" }}>You don&apos;t have permission to manage print templates.</p>
      </div>
    );
  }

  const filtersBar = (
    <div className="filters-row">
      <div className="filter-search-wrap">
        <MdSearch size={15} className="filter-search-icon" />
        <input type="text" placeholder="Search by name or type…" className="filter-search-input" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search templates" />
      </div>
      <select className="filter-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Document type">
        <option value="">All document types ({templates.length})</option>
        {TEMPLATE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}{countsByType[t.value] ? ` (${countsByType[t.value]})` : " (none yet)"}
          </option>
        ))}
      </select>
      {tab === "print" && (
        <label style={st.checkLabel}>
          <input type="checkbox" checked={defaultOnly} onChange={(e) => setDefaultOnly(e.target.checked)} /> Default only
        </label>
      )}
      {filtersActive && (
        <button type="button" className="filter-clear-btn" onClick={clearFilters} style={{ display: "inline-flex", alignItems: "center", gap: 4, minHeight: 32 }}>
          <MdFilterAltOff size={14} /> Clear
        </button>
      )}
    </div>
  );

  const renderTemplateCard = (t) => (
    <div key={t.id} id={`tpl-card-${t.id}`} style={{ ...st.card, ...(recentId === t.id ? st.cardRecent : null) }}>
      <div style={st.cardTop}>
        <span style={st.tName} title={t.name}>{t.name}</span>
        {t.isDefault
          ? <span style={st.badgeDefault}><MdStar size={12} /> Default</span>
          : <MdStarBorder size={16} color="#c2cad6" title="Not default" />}
      </div>
      <div style={st.metaRow}>
        <span style={st.typeChip}>{TEMPLATE_TYPE_LABEL[t.templateType] || t.templateType}</span>
      </div>
      <div style={st.metaLine}>
        {t.hasExcelTemplate && <span style={st.excelChip}><MdGridOn size={11} /> Excel</span>}
        <span style={{ color: colors.textSecondary }}>Updated {fmtDate(t.updatedAt)}</span>
      </div>
      {canViewStamps && (
        <div style={st.stampRow}>
          <span style={st.stampLabel}>Signature</span>
          <StampPicker
            stamps={companyStamps}
            value={t.stampId ?? null}
            state={t.stampState || detectStampState(t.htmlContent)}
            pinnedSlug={pinnedSlugs(t.htmlContent || "")[0]}
            busy={stampBusyId === t.id}
            disabled={!canManage}
            onChange={(id) => handleSetStamp(t, id)}
            onAddBlock={canManage ? () => handleAddSignatureBlock(t) : null}
            onConvert={canManage ? () => handleConvertToSlot(t) : null}
          />
        </div>
      )}
      <div style={st.actions}>
        {busyId === t.id && <span style={st.cardSpin} aria-label="Working…" />}
        <button style={st.actBtn} title="Edit" aria-label={`Edit ${t.name}`} disabled={busy} onClick={() => openInEditor(t)}><MdEdit size={15} /></button>
        <button style={st.actBtn} title="Preview" aria-label={`Preview ${t.name}`} disabled={busy} onClick={() => setPreviewTarget(t)}><MdVisibility size={15} /></button>
        {canApplyStarter && <button style={st.actBtn} title="Import starter design" aria-label={`Import a starter design into ${t.name}`} disabled={busy} onClick={() => setApplyTarget(t)}><MdBrush size={15} /></button>}
        {canManage && <button style={st.actBtn} title="Copy — duplicate (same type) or copy to another document type" aria-label={`Copy ${t.name}`} disabled={busy} onClick={() => setCopyTarget(t)}><MdContentCopy size={15} /></button>}
        {!t.isDefault && <button style={st.actBtn} title="Set as default" aria-label={`Set ${t.name} as default`} disabled={busy} onClick={() => handleSetDefault(t)}><MdStar size={15} /></button>}
        {canDelete && <button style={{ ...st.actBtn, color: "#dc3545" }} title="Delete" aria-label={`Delete ${t.name}`} disabled={busy} onClick={() => handleDelete(t)}><MdDelete size={15} /></button>}
      </div>
    </div>
  );

  return (
    <div>
      <div style={st.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={st.icon}><MdDescription size={26} color="#fff" /></div>
          <div>
            <h2 style={st.title}>Print Templates</h2>
            <p style={st.subtitle}>Manage printable layouts and Excel import/export templates.</p>
          </div>
        </div>
        {selectedCompany && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button style={{ ...st.btn, ...st.btnPrimary }} onClick={() => openNewDialog()}><MdAdd size={17} /> New Template</button>
            <button style={{ ...st.btn, ...st.btnOutline }} onClick={() => setTab("starter")}><MdAutoAwesome size={16} /> Starter Templates</button>
          </div>
        )}
      </div>

      {loadingCompanies ? <Spinner label="Loading companies…" /> : companies.length === 0 ? (
        <Empty label="No companies available. Add a company first." />
      ) : (
        <>
          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select style={dropdownStyles.base} value={selectedCompany?.id || ""} onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))} aria-label="Company">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </div>

          {/* Tabs */}
          <div style={st.tabs} role="tablist">
            {TABS.filter((t) => t.key !== "stamps" || canViewStamps).map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button key={t.key} role="tab" aria-selected={active}
                  style={{ ...st.tab, ...(active ? st.tabActive : {}) }}
                  onClick={() => setTab(t.key)}>
                  <Icon size={16} /> {t.label}
                </button>
              );
            })}
          </div>

          {/* ── Tab: Print Templates ── */}
          {tab === "print" && (
            <>
              {filtersBar}
              {loading ? <Spinner label="Loading templates…" /> : templates.length === 0 ? (
                <div style={st.empty}>
                  <MdDescription size={40} color={colors.cardBorder} />
                  <p style={{ color: colors.textSecondary, margin: "0.5rem 0 0.9rem" }}>
                    {selectedCompany?.brandName || selectedCompany?.name} has no print templates yet. Documents print with the built-in layouts until you add one.
                  </p>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
                    <button style={{ ...st.btn, ...st.btnPrimary }} onClick={() => openNewDialog()}><MdAdd size={17} /> New Template</button>
                    <button style={{ ...st.btn, ...st.btnOutline }} onClick={() => setTab("starter")}><MdAutoAwesome size={16} /> Browse starter designs</button>
                  </div>
                </div>
              ) : printRows.length === 0 ? (
                <div style={st.empty}>
                  <MdDescription size={40} color={colors.cardBorder} />
                  <p style={{ color: colors.textSecondary, margin: "0.5rem 0 0.9rem" }}>No print templates match your filters.</p>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
                    <button style={{ ...st.btn, ...st.btnOutline }} onClick={clearFilters}><MdFilterAltOff size={16} /> Clear filters</button>
                    {typeFilter && (
                      <button style={{ ...st.btn, ...st.btnPrimary }} onClick={() => openNewDialog(typeFilter)}>
                        <MdAdd size={17} /> New {TEMPLATE_TYPE_LABEL[typeFilter]} template
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                printGroups.map(([type, rows]) => (
                  <section key={type} style={st.section} aria-label={TEMPLATE_TYPE_LABEL[type] || type}>
                    <div style={st.sectionHead}>
                      <span style={st.sectionTitle}>{TEMPLATE_TYPE_LABEL[type] || type}</span>
                      <span style={st.sectionCount}>{rows.length}</span>
                      {!typeFilter && (
                        <button type="button" style={st.sectionLink} onClick={() => setTypeFilter(type)}>Only this type</button>
                      )}
                      <button type="button" style={{ ...st.sectionLink, ...(typeFilter ? { marginLeft: "auto" } : {}) }} onClick={() => openNewDialog(type)}>
                        <MdAdd size={15} /> New
                      </button>
                    </div>
                    <div style={st.grid}>{rows.map(renderTemplateCard)}</div>
                  </section>
                ))
              )}
            </>
          )}

          {/* ── Tab: Starter Templates ── */}
          {tab === "starter" && (
            <StarterGallery
              embedded
              selectLabel="Create template"
              onSelect={createFromStarter}
              busyStarterId={creatingStarterId}
              typeFilter={typeFilter}
              onTypeFilterChange={setTypeFilter}
              search={starterSearch}
              onSearchChange={setStarterSearch}
              sort={starterSort}
              onSortChange={setStarterSort}
            />
          )}

          {/* ── Tab: Excel Templates (one per document type) ── */}
          {tab === "excel" && (
            <>
              {filtersBar}
              <p style={st.hint}>
                <strong>One Excel layout per document type.</strong> When set, that type&apos;s documents show an &ldquo;Export Excel&rdquo; button — all print formats of the type share the single Excel layout.
              </p>
              {loading ? <Spinner label="Loading…" /> : excelTypeRows.length === 0 ? (
                <Empty label="No document types match your filters." />
              ) : (
                <div style={st.grid}>
                  {excelTypeRows.map((row) => (
                    <div key={row.type} style={st.card}>
                      <div style={st.cardTop}>
                        <span style={st.tName} title={row.label}>{row.label}</span>
                        {row.hasExcel
                          ? <span style={st.excelChip}><MdGridOn size={11} /> {row.sheet || "Attached"}</span>
                          : <span style={st.noExcelChip}>No layout</span>}
                      </div>
                      <div style={st.metaRow}>
                        <span style={st.typeChip}>{row.hasTemplate ? `${row.templateCount} print template${row.templateCount !== 1 ? "s" : ""}` : "No print template yet"}</span>
                      </div>
                      <div style={st.actions}>
                        {row.hasTemplate ? (
                          <>
                            <button style={{ ...st.actBtnWide }} disabled={busy} onClick={() => triggerExcelUpload(row.type)}>
                              {busyId === `excel:${row.type}` ? <span style={st.cardSpin} aria-label="Working…" /> : <MdUploadFile size={15} />}
                              {busyId === `excel:${row.type}` ? "Working…" : row.hasExcel ? "Replace .xlsx" : "Upload .xlsx"}
                            </button>
                            {row.hasExcel && canDelete && (
                              <button style={{ ...st.actBtn, color: "#dc3545" }} title="Remove Excel layout" disabled={busy} onClick={() => handleExcelDelete(row)}><MdDelete size={15} /></button>
                            )}
                          </>
                        ) : (
                          <button type="button" style={st.actBtnWide} onClick={() => openNewDialog(row.type)}>
                            <MdAdd size={15} /> Create a print template first
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <input ref={excelUploadRef} type="file" accept=".xlsx,.xlsm" style={{ display: "none" }} onChange={handleExcelFile} />
            </>
          )}

          {/* ── Tab: Stamps ── */}
          {tab === "stamps" && canViewStamps && (
            <>
              <p style={st.hint}>
                Upload stamps or signatures once, then insert them into any template as{" "}
                <code style={{ fontFamily: "monospace" }}>{"{{stamps.slug}}"}</code> — no more pasting images into the HTML.
                Each template can use a different stamp, and renaming a stamp never breaks templates that already use it.
              </p>
              {canManageStamps && (
                <div style={{ marginBottom: "0.85rem" }}>
                  <button style={{ ...st.btn, ...st.btnPrimary }} disabled={stampUploading} onClick={() => setStampModalOpen(true)}>
                    <MdUploadFile size={16} /> Upload Stamp
                  </button>
                </div>
              )}
              {companyStamps.length === 0 ? (
                <Empty label="No stamps yet. Upload a stamp to use it in your print templates." />
              ) : (
                <div style={st.grid}>
                  {companyStamps.map((s) => (
                    <div key={s.id} style={st.card}>
                      <div style={st.cardTop}>
                        <span style={st.tName} title={s.name}>{s.name}</span>
                        {s.isDefault && <span style={st.badgeDefault}><MdStar size={12} /> Default</span>}
                      </div>
                      <div style={st.stampThumbWrap}>
                        <img src={s.url} alt={s.name} style={st.stampThumbImg} />
                      </div>
                      <button style={st.stampToken} onClick={() => copyStampToken(s)} title="Copy merge field">
                        <code style={{ fontFamily: "monospace", fontSize: "0.72rem", color: colors.blue, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`{{stamps.${s.slug}}}`}</code>
                        <MdContentCopy size={13} color={colors.textSecondary} />
                      </button>
                      <div style={st.actions}>
                        {stampBusyId === s.id && <span style={st.cardSpin} aria-label="Working…" />}
                        <button style={st.actBtn} title="Copy merge field" disabled={stampBusyId != null} onClick={() => copyStampToken(s)}><MdContentCopy size={15} /></button>
                        {canManageStamps && !s.isDefault && <button style={st.actBtn} title="Set as default stamp" disabled={stampBusyId != null} onClick={() => handleStampSetDefault(s)}><MdStar size={15} /></button>}
                        {canManageStamps && <button style={st.actBtn} title="Rename" disabled={stampBusyId != null} onClick={() => handleStampRename(s)}><MdEdit size={15} /></button>}
                        {canManageStamps && <button style={{ ...st.actBtn, color: "#dc3545" }} title="Delete" disabled={stampBusyId != null} onClick={() => handleStampDelete(s)}><MdDelete size={15} /></button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* New template — type, name, and what it starts from */}
      {newDialog && selectedCompany && (
        <NewTemplateDialog
          companyId={selectedCompany.id}
          templates={templates}
          initialType={newDialog.initialType}
          initialStarter={newDialog.initialStarter}
          onCreated={onCreated}
          onClose={() => setNewDialog(null)}
        />
      )}

      {/* Apply-starter-to-existing */}
      {applyTarget && (
        <ApplyStarterModal
          template={applyTarget}
          onClose={() => setApplyTarget(null)}
          onApplied={async () => { setApplyTarget(null); await load(); }}
        />
      )}

      {/* Copy — same type (duplicate) or a different document type */}
      {copyTarget && (
        <div style={st.previewOverlay} onClick={() => setCopyTarget(null)}>
          <div style={st.copyModal} onClick={(e) => e.stopPropagation()}>
            <div style={st.previewHead}>
              <div><strong>Copy “{copyTarget.name}”</strong> <span style={st.typeChip}>{TEMPLATE_TYPE_LABEL[copyTarget.templateType]}</span></div>
              <button style={st.closeBtn} onClick={() => setCopyTarget(null)} aria-label="Close"><MdClose size={20} /></button>
            </div>
            <p style={st.copyHint}>
              Pick the document type for the new template. Choose the <strong>same type</strong> to duplicate it, or a <strong>different type</strong> to reuse this design there (open it afterward to adjust the merge fields — they differ per document type).
            </p>
            <div style={st.copyGrid}>
              {/* Same type first — behaves exactly like Duplicate */}
              <button
                key={copyTarget.templateType}
                style={{ ...st.copyTypeBtn, ...st.copyTypeBtnSame }}
                disabled={busy}
                onClick={() => { const t = copyTarget; setCopyTarget(null); handleDuplicate(t); }}
              >
                <MdContentCopy size={15} /> {TEMPLATE_TYPE_LABEL[copyTarget.templateType]} · duplicate (same type)
              </button>
              {TEMPLATE_TYPES.filter((tt) => tt.value !== copyTarget.templateType).map((tt) => (
                <button
                  key={tt.value}
                  style={st.copyTypeBtn}
                  disabled={busy}
                  onClick={() => handleCopyToType(copyTarget, tt.value)}
                >
                  <MdSwapHoriz size={15} /> {tt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Full preview */}
      {previewTarget && (
        <div style={st.previewOverlay} onClick={() => setPreviewTarget(null)}>
          <div style={st.previewModal} onClick={(e) => e.stopPropagation()}>
            <div style={st.previewHead}>
              <div><strong>{previewTarget.name}</strong> <span style={st.typeChip}>{TEMPLATE_TYPE_LABEL[previewTarget.templateType]}</span></div>
              <button style={st.closeBtn} onClick={() => setPreviewTarget(null)} aria-label="Close"><MdClose size={20} /></button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
              <A4PreviewFrame
                html={buildTemplatePreviewHtml(
                  previewTarget.templateType,
                  // Resolve {{stamp}} the same way printing does, so the preview
                  // shows the signature this template will actually carry. Without
                  // this the slot is stripped and the preview silently disagrees
                  // with the printed document.
                  materializeStamp(
                    previewTarget.htmlContent || "",
                    companyStamps.find((s) => s.id === previewTarget.stampId)?.url || null,
                  ),
                  { company: selectedCompany },
                )}
                title={`Preview of ${previewTarget.name}`}
              />
            </div>
          </div>
        </div>
      )}

      {/* Stamp upload */}
      {stampModalOpen && (
        <StampUploadModal
          uploading={stampUploading}
          onClose={() => setStampModalOpen(false)}
          onUpload={handleStampUpload}
        />
      )}
    </div>
  );
}

// Pick an image, see it, name it, upload. Replaces the bare window.prompt,
// which showed no preview and is blocked outright in some embedded browsers.
function StampUploadModal({ onClose, onUpload, uploading }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState("");
  const inputRef = useRef(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setName((prev) => prev || f.name.replace(/\.[^.]+$/, ""));
    setPreview(URL.createObjectURL(f));
  };

  return (
    <div style={formStyles.backdrop} onClick={uploading ? undefined : onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.sm}px` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="stamp-upload-title">
        <div style={formStyles.header}>
          <div>
            <h3 id="stamp-upload-title" style={formStyles.title}>Upload Stamp</h3>
            <p style={{ margin: "0.15rem 0 0", fontSize: "0.78rem", color: "rgba(255,255,255,0.85)" }}>PNG, JPG or WebP. A transparent PNG works best for signatures.</p>
          </div>
          <button type="button" style={formStyles.closeButton} onClick={onClose} disabled={uploading} aria-label="Close"><MdClose size={20} /></button>
        </div>
        <div style={{ ...formStyles.body, display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={onPick} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            style={{ border: `2px dashed ${colors.inputBorder}`, borderRadius: 10, padding: "1.2rem", textAlign: "center", cursor: "pointer", background: "#f7f9fc", boxShadow: "none", minHeight: 120, width: "100%" }}
          >
            {preview ? (
              <img src={preview} alt="Stamp preview" style={{ maxWidth: "100%", maxHeight: 140, objectFit: "contain" }} />
            ) : (
              <span style={{ color: colors.textSecondary, fontSize: "0.85rem", display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <MdUploadFile size={28} /> Click to choose an image
              </span>
            )}
          </button>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", color: colors.textSecondary, fontWeight: 600 }}>
            Name
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Director Signature" maxLength={80}
              style={{ padding: "0.55rem 0.7rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: "0.9rem", minHeight: 44, color: colors.textPrimary }}
            />
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", padding: "0.75rem clamp(1rem, 2vw, 1.5rem)", borderTop: `1px solid ${colors.cardBorder}`, flexShrink: 0 }}>
          <button style={{ ...st.btn, ...st.btnOutline, minHeight: 44 }} onClick={onClose} disabled={uploading}>Cancel</button>
          <button
            style={{ ...st.btn, ...st.btnPrimary, minHeight: 44, opacity: (!file || uploading) ? 0.6 : 1, cursor: (!file || uploading) ? "default" : "pointer" }}
            disabled={!file || uploading}
            onClick={() => onUpload(file, name.trim())}
          >
            <MdUploadFile size={16} /> {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

const Spinner = ({ label }) => <div style={st.loading}><div style={st.spin} /><span style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>{label}</span></div>;
const Empty = ({ label }) => <div style={st.empty}><MdDescription size={40} color={colors.cardBorder} /><p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>{label}</p></div>;

const st = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" },
  icon: { width: 46, height: 46, borderRadius: 13, background: "linear-gradient(135deg,#0d47a1,#00897b)", display: "flex", alignItems: "center", justifyContent: "center" },
  title: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  subtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  btn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1rem", borderRadius: 10, fontSize: "0.88rem", fontWeight: 600, cursor: "pointer", border: "none" },
  btnPrimary: { background: "linear-gradient(135deg,#0d47a1,#00897b)", color: "#fff", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  btnOutline: { background: "#fff", color: colors.blue, border: `1px solid ${colors.inputBorder}` },
  tabs: { display: "flex", gap: "0.25rem", borderBottom: `2px solid ${colors.cardBorder}`, marginBottom: "1rem", flexWrap: "wrap" },
  tab: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1rem", border: "none", background: "transparent", color: colors.textSecondary, fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", borderBottom: "2px solid transparent", marginBottom: -2, minHeight: 44 },
  tabActive: { color: colors.blue, borderBottom: `2px solid ${colors.blue}` },
  checkLabel: { display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 600, cursor: "pointer", minHeight: 32 },
  hint: { margin: "0 0 0.85rem", fontSize: "0.8rem", color: colors.textSecondary, background: "#f4f8ff", border: "1px solid #dbe8ff", borderRadius: 8, padding: "0.5rem 0.7rem" },
  section: { marginBottom: "1.25rem" },
  sectionHead: { display: "flex", alignItems: "center", gap: "0.5rem", margin: "0 0 0.6rem", flexWrap: "wrap" },
  sectionTitle: { fontWeight: 800, color: colors.textPrimary, fontSize: "0.95rem" },
  sectionCount: { fontSize: "0.72rem", fontWeight: 700, color: colors.blue, background: "#e8f0fe", borderRadius: 10, padding: "1px 8px" },
  sectionLink: { display: "inline-flex", alignItems: "center", gap: 2, background: "none", border: "none", boxShadow: "none", color: colors.blue, fontWeight: 600, fontSize: "0.78rem", cursor: "pointer", minHeight: 32, padding: "0 0.4rem", fontFamily: "inherit" },
  grid: { display: "grid", gap: "0.85rem", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))" },
  card: { border: `1px solid ${colors.cardBorder}`, borderRadius: 12, background: "#fff", padding: "0.85rem 0.9rem", display: "flex", flexDirection: "column", gap: "0.5rem", boxShadow: "0 1px 4px rgba(16,42,80,0.04)", transition: "box-shadow .2s, border-color .2s" },
  cardRecent: { boxShadow: "0 0 0 3px #b7d4f0, 0 1px 4px rgba(16,42,80,0.04)", borderColor: colors.blue },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" },
  tName: { fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary, minWidth: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.3 },
  badgeDefault: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.64rem", fontWeight: 800, color: "#f57f17", background: "#fff8e1", padding: "2px 7px", borderRadius: 5, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0 },
  metaRow: { display: "flex", gap: "0.4rem", flexWrap: "wrap" },
  typeChip: { fontSize: "0.68rem", fontWeight: 700, color: "#3949ab", background: "#e8eaf6", padding: "2px 8px", borderRadius: 5 },
  excelChip: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.66rem", fontWeight: 700, color: "#1b5e20", background: "#e8f5e9", padding: "2px 7px", borderRadius: 5 },
  noExcelChip: { fontSize: "0.66rem", fontWeight: 700, color: "#90a4ae", background: "#eceff1", padding: "2px 7px", borderRadius: 5 },
  metaLine: { display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.72rem", flexWrap: "wrap" },
  actions: { display: "flex", gap: "0.3rem", flexWrap: "wrap", alignItems: "center", marginTop: "auto", paddingTop: "0.35rem", borderTop: `1px solid ${colors.cardBorder}` },
  // 44 wide / 40 tall: a real thumb target (RESPONSIVE_UI_GUIDE §5) — six of
  // them still fit one row on a 343px phone card.
  actBtn: { display: "grid", placeItems: "center", width: 44, height: 40, padding: 0, boxShadow: "none", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textSecondary, cursor: "pointer" },
  cardSpin: { width: 16, height: 16, border: `2px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block", flexShrink: 0 },
  stampRow: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", paddingTop: "0.35rem", borderTop: `1px dashed ${colors.cardBorder}` },
  stampLabel: { fontSize: "0.72rem", fontWeight: 600, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.4px" },
  stampThumbWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: 96, border: `1px solid ${colors.cardBorder}`, borderRadius: 8, background: "#fff", padding: "0.4rem" },
  stampThumbImg: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" },
  stampToken: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4rem", width: "100%", padding: "0.3rem 0.5rem", borderRadius: 7, border: `1px dashed ${colors.inputBorder}`, background: "#f8fbff", cursor: "pointer", overflow: "hidden", boxShadow: "none", minHeight: 36 },
  actBtnWide: { display: "inline-flex", alignItems: "center", gap: "0.35rem", flex: 1, justifyContent: "center", minHeight: 36, padding: "0 0.5rem", borderRadius: 7, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", padding: "3rem 0" },
  spin: { width: 24, height: 24, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", textAlign: "center" },
  previewOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1300, padding: "1rem", overflowY: "auto" },
  previewModal: { background: "#e8e8e8", borderRadius: 14, width: "min(860px, 96vw)", height: "94vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  copyModal: { background: "#fff", borderRadius: 14, width: "min(520px, 96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", margin: "auto" },
  copyHint: { margin: 0, padding: "0.75rem 1rem 0", fontSize: "0.8rem", color: colors.textSecondary },
  copyGrid: { display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))", padding: "0.85rem 1rem 1.1rem", overflowY: "auto" },
  copyTypeBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 0.75rem", borderRadius: 9, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", textAlign: "left", minHeight: 44, boxShadow: "none" },
  copyTypeBtnSame: { gridColumn: "1 / -1", borderColor: colors.teal, color: "#00695c", background: "#e0f2f1" },
  previewHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", padding: "0.7rem 1rem", background: "#fff", borderBottom: `1px solid ${colors.cardBorder}` },
  closeBtn: { width: 44, height: 44, display: "grid", placeItems: "center", border: "none", background: "transparent", cursor: "pointer", color: "#8a94a6", padding: 4, display: "inline-flex", boxShadow: "none" },
};
