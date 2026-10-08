import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  MdDescription, MdAdd, MdAutoAwesome, MdGridOn,
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
import { formStyles, modalSizes } from "../theme";
import {
  PageHeader, CompanyPicker, Button, IconButton, Toolbar, SearchBox, Tabs, Field,
  EmptyState, Loading, Alert,
} from "../ui/Kit";
import {
  TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL, buildTemplatePreviewHtml,
} from "../utils/templateSampleData";
import StarterGallery from "../Components/templateEditor/StarterGallery";
import ApplyStarterModal from "../Components/templateEditor/ApplyStarterModal";
import A4PreviewFrame from "../Components/templateEditor/A4PreviewFrame";
import NewTemplateDialog, { uniqueTemplateName } from "../Components/templateEditor/NewTemplateDialog";
import { setEditorEntry, peekRecentTemplate, clearRecentTemplate } from "../utils/templateEditorNav";

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
  const { companies, selectedCompany, loading: loadingCompanies, companyStamps, refreshStamps } = useCompany();
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
      <EmptyState icon={MdLock} title="Access denied">
        You don&apos;t have permission to manage print templates.
      </EmptyState>
    );
  }

  const filtersBar = (
    <Toolbar>
      <SearchBox value={search} onChange={setSearch} placeholder="Search by name or type…" label="Search templates" />
      <select className="k-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Document type">
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
        <Button variant="ghost" size="sm" icon={MdFilterAltOff} onClick={clearFilters}>Clear</Button>
      )}
    </Toolbar>
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
        <span style={{ color: "var(--k-muted)" }}>Updated {fmtDate(t.updatedAt)}</span>
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
        {busyId === t.id && <CardSpin />}
        <IconButton label="Edit" aria-label={`Edit ${t.name}`} icon={MdEdit} size={15} disabled={busy} onClick={() => openInEditor(t)} />
        <IconButton label="Preview" aria-label={`Preview ${t.name}`} icon={MdVisibility} size={15} disabled={busy} onClick={() => setPreviewTarget(t)} />
        {canApplyStarter && <IconButton label="Import starter design" aria-label={`Import a starter design into ${t.name}`} icon={MdBrush} size={15} disabled={busy} onClick={() => setApplyTarget(t)} />}
        {canManage && <IconButton label="Copy — duplicate (same type) or copy to another document type" aria-label={`Copy ${t.name}`} icon={MdContentCopy} size={15} disabled={busy} onClick={() => setCopyTarget(t)} />}
        {!t.isDefault && <IconButton label="Set as default" aria-label={`Set ${t.name} as default`} icon={MdStar} size={15} disabled={busy} onClick={() => handleSetDefault(t)} />}
        {canDelete && <IconButton danger label="Delete" aria-label={`Delete ${t.name}`} icon={MdDelete} size={15} disabled={busy} onClick={() => handleDelete(t)} style={st.dangerGlyph} />}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        icon={MdDescription}
        tone="brand"
        title="Print Templates"
        subtitle="Manage printable layouts and Excel import/export templates."
        actions={selectedCompany ? (
          <>
            <Button variant="primary" icon={MdAdd} onClick={() => openNewDialog()}>New Template</Button>
            <Button icon={MdAutoAwesome} onClick={() => setTab("starter")}>Starter Templates</Button>
          </>
        ) : null}
      />

      {loadingCompanies ? <Loading>Loading companies…</Loading> : companies.length === 0 ? (
        <EmptyState icon={MdDescription}>No companies available. Add a company first.</EmptyState>
      ) : (
        <>
          <CompanyPicker />

          {/* Tabs */}
          <Tabs
            label="Template sections"
            idPrefix="pt-tab"
            tabs={TABS.filter((t) => t.key !== "stamps" || canViewStamps)}
            value={tab}
            onChange={setTab}
          />

          {/* ── Tab: Print Templates ── */}
          {tab === "print" && (
            <>
              {filtersBar}
              {loading ? <Loading>Loading templates…</Loading> : templates.length === 0 ? (
                <EmptyState
                  icon={MdDescription}
                  action={(
                    <div style={st.emptyActions}>
                      <Button variant="primary" icon={MdAdd} onClick={() => openNewDialog()}>New Template</Button>
                      <Button icon={MdAutoAwesome} onClick={() => setTab("starter")}>Browse starter designs</Button>
                    </div>
                  )}
                >
                  {selectedCompany?.brandName || selectedCompany?.name} has no print templates yet. Documents print with the built-in layouts until you add one.
                </EmptyState>
              ) : printRows.length === 0 ? (
                <EmptyState
                  icon={MdDescription}
                  action={(
                    <div style={st.emptyActions}>
                      <Button icon={MdFilterAltOff} onClick={clearFilters}>Clear filters</Button>
                      {typeFilter && (
                        <Button variant="primary" icon={MdAdd} onClick={() => openNewDialog(typeFilter)}>
                          New {TEMPLATE_TYPE_LABEL[typeFilter]} template
                        </Button>
                      )}
                    </div>
                  )}
                >
                  No print templates match your filters.
                </EmptyState>
              ) : (
                printGroups.map(([type, rows]) => (
                  <section key={type} style={st.section} aria-label={TEMPLATE_TYPE_LABEL[type] || type}>
                    <div style={st.sectionHead}>
                      <span style={st.sectionTitle}>{TEMPLATE_TYPE_LABEL[type] || type}</span>
                      <span className="k-count">{rows.length}</span>
                      {!typeFilter && (
                        <Button variant="ghost" size="sm" onClick={() => setTypeFilter(type)} style={st.sectionLink}>Only this type</Button>
                      )}
                      <Button variant="ghost" size="sm" icon={MdAdd} onClick={() => openNewDialog(type)} style={{ ...st.sectionLink, ...(typeFilter ? { marginLeft: "auto" } : {}) }}>
                        New
                      </Button>
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
              <Alert tone="info">
                <strong>One Excel layout per document type.</strong> When set, that type&apos;s documents show an &ldquo;Export Excel&rdquo; button — all print formats of the type share the single Excel layout.
              </Alert>
              {loading ? <Loading>Loading…</Loading> : excelTypeRows.length === 0 ? (
                <EmptyState icon={MdDescription}>No document types match your filters.</EmptyState>
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
                            <Button
                              size="sm"
                              icon={busyId === `excel:${row.type}` ? undefined : MdUploadFile}
                              disabled={busy}
                              onClick={() => triggerExcelUpload(row.type)}
                              style={st.wideBtn}
                            >
                              {busyId === `excel:${row.type}` && <CardSpin />}
                              {busyId === `excel:${row.type}` ? "Working…" : row.hasExcel ? "Replace .xlsx" : "Upload .xlsx"}
                            </Button>
                            {row.hasExcel && canDelete && (
                              <IconButton danger label="Remove Excel layout" icon={MdDelete} size={15} disabled={busy} onClick={() => handleExcelDelete(row)} style={st.dangerGlyph} />
                            )}
                          </>
                        ) : (
                          <Button size="sm" icon={MdAdd} onClick={() => openNewDialog(row.type)} style={st.wideBtn}>
                            Create a print template first
                          </Button>
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
              <Alert tone="info">
                Upload stamps or signatures once, then insert them into any template as{" "}
                <code style={{ fontFamily: "monospace" }}>{"{{stamps.slug}}"}</code> — no more pasting images into the HTML.
                Each template can use a different stamp, and renaming a stamp never breaks templates that already use it.
              </Alert>
              {canManageStamps && (
                <Toolbar>
                  <Button variant="primary" icon={MdUploadFile} disabled={stampUploading} onClick={() => setStampModalOpen(true)}>
                    Upload Stamp
                  </Button>
                </Toolbar>
              )}
              {companyStamps.length === 0 ? (
                <EmptyState icon={MdDescription}>No stamps yet. Upload a stamp to use it in your print templates.</EmptyState>
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
                      <button type="button" style={st.stampToken} onClick={() => copyStampToken(s)} title="Copy merge field">
                        <code style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--k-blue)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`{{stamps.${s.slug}}}`}</code>
                        <MdContentCopy size={13} color="var(--k-muted)" />
                      </button>
                      <div style={st.actions}>
                        {stampBusyId === s.id && <CardSpin />}
                        <IconButton label="Copy merge field" icon={MdContentCopy} size={15} disabled={stampBusyId != null} onClick={() => copyStampToken(s)} />
                        {canManageStamps && !s.isDefault && <IconButton label="Set as default stamp" icon={MdStar} size={15} disabled={stampBusyId != null} onClick={() => handleStampSetDefault(s)} />}
                        {canManageStamps && <IconButton label="Rename" icon={MdEdit} size={15} disabled={stampBusyId != null} onClick={() => handleStampRename(s)} />}
                        {canManageStamps && <IconButton danger label="Delete" icon={MdDelete} size={15} disabled={stampBusyId != null} onClick={() => handleStampDelete(s)} style={st.dangerGlyph} />}
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
        <div data-admin-backdrop="" style={st.overlay} onClick={() => setCopyTarget(null)}>
          <div style={{ ...formStyles.modal, maxWidth: 520 }} role="dialog" aria-modal="true" aria-label={`Copy ${copyTarget.name}`} onClick={(e) => e.stopPropagation()}>
            <div style={formStyles.header}>
              <h3 style={{ ...formStyles.title, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                Copy “{copyTarget.name}” <span style={st.typeChip}>{TEMPLATE_TYPE_LABEL[copyTarget.templateType]}</span>
              </h3>
              <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={() => setCopyTarget(null)} aria-label="Close"><MdClose size={20} /></button>
            </div>
            <div style={formStyles.body}>
              <p style={st.copyHint}>
                Pick the document type for the new template. Choose the <strong>same type</strong> to duplicate it, or a <strong>different type</strong> to reuse this design there (open it afterward to adjust the merge fields — they differ per document type).
              </p>
              <div style={st.copyGrid}>
                {/* Same type first — behaves exactly like Duplicate */}
                <button
                  type="button"
                  key={copyTarget.templateType}
                  style={{ ...st.copyTypeBtn, ...st.copyTypeBtnSame }}
                  disabled={busy}
                  onClick={() => { const t = copyTarget; setCopyTarget(null); handleDuplicate(t); }}
                >
                  <MdContentCopy size={15} /> {TEMPLATE_TYPE_LABEL[copyTarget.templateType]} · duplicate (same type)
                </button>
                {TEMPLATE_TYPES.filter((tt) => tt.value !== copyTarget.templateType).map((tt) => (
                  <button
                    type="button"
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
        </div>
      )}

      {/* Full preview */}
      {previewTarget && (
        <div data-admin-backdrop="" style={st.overlay} onClick={() => setPreviewTarget(null)}>
          <div style={st.previewModal} role="dialog" aria-modal="true" aria-label={`Preview of ${previewTarget.name}`} onClick={(e) => e.stopPropagation()}>
            <div style={formStyles.header}>
              <h3 style={{ ...formStyles.title, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                {previewTarget.name} <span style={st.typeChip}>{TEMPLATE_TYPE_LABEL[previewTarget.templateType]}</span>
              </h3>
              <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={() => setPreviewTarget(null)} aria-label="Close"><MdClose size={20} /></button>
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
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={uploading ? undefined : onClose}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.sm}px` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="stamp-upload-title">
        <div style={formStyles.header}>
          <div>
            <h3 id="stamp-upload-title" style={formStyles.title}>Upload Stamp</h3>
            <p style={{ margin: "0.15rem 0 0", fontSize: "0.78rem", color: "var(--ui-modal-title-color, #ffffff)", opacity: 0.85 }}>PNG, JPG or WebP. A transparent PNG works best for signatures.</p>
          </div>
          <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={onClose} disabled={uploading} aria-label="Close"><MdClose size={20} /></button>
        </div>
        <div style={{ ...formStyles.body, display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={onPick} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            style={{ border: "2px dashed var(--k-line-strong)", borderRadius: "var(--k-radius)", padding: "1.2rem", textAlign: "center", cursor: "pointer", background: "var(--k-surface-2)", boxShadow: "none", minHeight: 120, width: "100%" }}
          >
            {preview ? (
              <img src={preview} alt="Stamp preview" style={{ maxWidth: "100%", maxHeight: 140, objectFit: "contain" }} />
            ) : (
              <span style={{ color: "var(--k-muted)", fontSize: "var(--k-font)", display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <MdUploadFile size={28} /> Click to choose an image
              </span>
            )}
          </button>
          <Field label="Name" htmlFor="stamp-upload-name">
            <input
              id="stamp-upload-name"
              type="text" className="k-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Director Signature" maxLength={80}
            />
          </Field>
        </div>
        <div style={formStyles.footer}>
          <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose} disabled={uploading}>Cancel</button>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.submit, display: "inline-flex", alignItems: "center", gap: "0.4rem", opacity: (!file || uploading) ? 0.6 : 1, cursor: (!file || uploading) ? "default" : "pointer" }}
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

// Small inline busy indicator on a card's action row (kit spinner, scaled down).
const CardSpin = () => <span className="k-spinner" style={{ width: 16, height: 16, borderWidth: 2, display: "inline-block", flexShrink: 0 }} aria-label="Working…" />;

// Page-specific layout and chips; surfaces, borders and text colours read the
// kit tokens (--k-*) so Classic and Workspace both apply.
const st = {
  checkLabel: { display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "var(--k-font-sm)", color: "var(--k-muted)", fontWeight: 600, cursor: "pointer", minHeight: "var(--k-h)" },
  section: { marginBottom: "var(--k-gap)" },
  sectionHead: { display: "flex", alignItems: "center", gap: "0.5rem", margin: "0 0 0.6rem", flexWrap: "wrap" },
  sectionTitle: { fontWeight: 800, color: "var(--k-ink)", fontSize: "calc(var(--k-font) + 0.05rem)" },
  sectionLink: { color: "var(--k-blue)" },
  emptyActions: { display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", marginTop: "0.5rem" },
  grid: { display: "grid", gap: "calc(var(--k-gap) * 0.7)", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))" },
  card: { border: "1px solid var(--k-line)", borderRadius: "var(--k-card-radius)", background: "var(--k-surface)", padding: "var(--k-stat-pad)", display: "flex", flexDirection: "column", gap: "0.5rem", boxShadow: "var(--k-card-shadow)", transition: "box-shadow .2s, border-color .2s", minWidth: 0 },
  cardRecent: { boxShadow: "0 0 0 3px #b7d4f0", borderColor: "var(--k-blue)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" },
  tName: { fontSize: "calc(var(--k-font) + 0.05rem)", fontWeight: 700, color: "var(--k-ink)", minWidth: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.3 },
  badgeDefault: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.64rem", fontWeight: 800, color: "#f57f17", background: "#fff8e1", padding: "2px 7px", borderRadius: 5, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0 },
  metaRow: { display: "flex", gap: "0.4rem", flexWrap: "wrap" },
  typeChip: { fontSize: "0.68rem", fontWeight: 700, color: "#3949ab", background: "#e8eaf6", padding: "2px 8px", borderRadius: 5 },
  excelChip: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.66rem", fontWeight: 700, color: "#1b5e20", background: "#e8f5e9", padding: "2px 7px", borderRadius: 5 },
  noExcelChip: { fontSize: "0.66rem", fontWeight: 700, color: "#90a4ae", background: "#eceff1", padding: "2px 7px", borderRadius: 5 },
  metaLine: { display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.72rem", flexWrap: "wrap" },
  actions: { display: "flex", gap: "0.3rem", flexWrap: "wrap", alignItems: "center", marginTop: "auto", paddingTop: "0.35rem", borderTop: "1px solid var(--k-line)" },
  // Delete glyphs stay red at rest (the kit's danger variant only tints on hover).
  dangerGlyph: { color: "var(--k-danger)" },
  wideBtn: { flex: 1 },
  stampRow: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", paddingTop: "0.35rem", borderTop: "1px dashed var(--k-line)" },
  stampLabel: { fontSize: "0.72rem", fontWeight: 600, color: "var(--k-muted)", textTransform: "uppercase", letterSpacing: "0.4px" },
  stampThumbWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: 96, border: "1px solid var(--k-line)", borderRadius: 8, background: "#fff", padding: "0.4rem" },
  stampThumbImg: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" },
  stampToken: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4rem", width: "100%", padding: "0.3rem 0.5rem", borderRadius: 7, border: "1px dashed var(--k-line-strong)", background: "var(--k-surface-2)", cursor: "pointer", overflow: "hidden", boxShadow: "none", minHeight: "calc(var(--k-h) - 4px)" },
  // Above the fixed sidebar and any page chrome — same backdrop as every dialog.
  overlay: { ...formStyles.backdrop, zIndex: 1300 },
  previewModal: { ...formStyles.modal, maxWidth: 860, height: "94vh", background: "#e8e8e8" },
  copyHint: { margin: "0 0 0.85rem", fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  copyGrid: { display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))" },
  copyTypeBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 0.75rem", borderRadius: "var(--k-radius)", border: "1px solid var(--k-line-strong)", background: "var(--k-surface)", color: "var(--k-blue)", fontSize: "var(--k-font)", fontWeight: 600, cursor: "pointer", textAlign: "left", minHeight: 44, boxShadow: "none" },
  copyTypeBtnSame: { gridColumn: "1 / -1", borderColor: "var(--k-teal)", color: "#00695c", background: "#e0f2f1" },
};
