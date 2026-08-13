import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  MdDescription, MdBusiness, MdSearch, MdAdd, MdAutoAwesome, MdGridOn,
  MdEdit, MdDelete, MdStar, MdStarBorder, MdVisibility, MdBrush, MdContentCopy,
  MdUploadFile, MdClose, MdLock, MdCheckCircle, MdApproval,
} from "react-icons/md";
import {
  getTemplatesByCompany, getTemplateById, createTemplate, setDefaultTemplate, deleteTemplate,
  uploadExcelTemplateById, deleteExcelTemplateById,
} from "../api/printTemplateApi";
import { uploadStamp, deleteStamp, updateStamp, setDefaultStamp } from "../api/stampApi";
import { setTemplateStamp } from "../api/printTemplateApi";
import StampPicker from "../Components/templateEditor/StampPicker";
import { injectSignatureBlock, convertPinnedToSlot, pinnedSlugs, materializeStamp } from "../utils/stampSlot";
import { getDivisionsByCompany } from "../api/divisionApi";
import { invalidatePrintTemplateCache } from "../hooks/usePrintTemplates";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { dropdownStyles } from "../theme";
import {
  TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL, buildTemplatePreviewHtml,
} from "../utils/templateSampleData";
import StarterGallery from "../Components/templateEditor/StarterGallery";
import ApplyStarterModal from "../Components/templateEditor/ApplyStarterModal";
import A4PreviewFrame from "../Components/templateEditor/A4PreviewFrame";

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
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(false);
  // Id of the card whose action (set-default / delete / duplicate / Excel) is in
  // flight — drives that card's spinner and locks actions so nothing races.
  const [busyId, setBusyId] = useState(null);
  const busy = busyId != null;
  // Shown as a full-panel overlay while a starter is being turned into a new
  // template (that flow navigates to the editor, so the operator gets clear
  // "working…" feedback before the page changes under them).
  const [creating, setCreating] = useState(false);

  // filters (shared by Print + Excel tabs)
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [divFilter, setDivFilter] = useState(""); // "" all | "company" | "<id>"
  const [defaultOnly, setDefaultOnly] = useState(false);

  const [applyTarget, setApplyTarget] = useState(null); // template to apply a starter onto
  const [previewTarget, setPreviewTarget] = useState(null); // template to preview
  const [previewLoading, setPreviewLoading] = useState(false); // body fetch for preview in flight
  // Stamps tab
  const [stampModalOpen, setStampModalOpen] = useState(false);
  const [stampUploading, setStampUploading] = useState(false);
  const [stampBusyId, setStampBusyId] = useState(null);
  const [starterToCreate, setStarterToCreate] = useState(null); // starter awaiting a scope choice
  const excelUploadRef = useRef(null);
  const excelTargetIdRef = useRef(null);

  const load = useCallback(async () => {
    if (!selectedCompany) { setTemplates([]); setDivisions([]); return; }
    setLoading(true);
    try {
      // Metadata only — the cards show name/type/scope/default/excel/date, never
      // the body. Fetching megabytes of template HTML here was the slow load; the
      // body is now pulled by id only when a template is previewed or duplicated.
      const [tpls, divs] = await Promise.all([
        getTemplatesByCompany(selectedCompany.id, { meta: true }),
        getDivisionsByCompany(selectedCompany.id).catch(() => ({ data: [] })),
      ]);
      setTemplates(tpls.data || []);
      setDivisions(divs.data || []);
    } catch { setTemplates([]); }
    finally { setLoading(false); }
  }, [selectedCompany]);

  useEffect(() => { load(); }, [load]);
  // Switching company clears the text search, the division scope and the
  // default-only toggle, but deliberately KEEPS the document-type filter: an
  // operator comparing the same document type across companies should not have
  // to re-pick it every switch.
  useEffect(() => { setSearch(""); setDivFilter(""); setDefaultOnly(false); }, [selectedCompany?.id]);

  const divisionById = useMemo(() => Object.fromEntries(divisions.map((d) => [d.id, d])), [divisions]);

  const applyFilters = (rows) => rows.filter((t) => {
    if (typeFilter && t.templateType !== typeFilter) return false;
    if (divFilter === "company" && t.divisionId != null) return false;
    if (divFilter && divFilter !== "company" && String(t.divisionId) !== divFilter) return false;
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
  ), [templates, typeFilter, divFilter, defaultOnly, search]);

  const excelRows = useMemo(() => applyFilters(templates).sort((a, b) =>
    (Number(b.hasExcelTemplate) - Number(a.hasExcelTemplate)) || a.templateType.localeCompare(b.templateType) || a.id - b.id
  ), [templates, typeFilter, divFilter, defaultOnly, search]);

  const scopeLabel = (t) => (t.divisionId != null ? (t.divisionName || divisionById[t.divisionId]?.name || "Division") : "Company-wide");

  // ── Navigation to the editor (localStorage restore contract) ──
  const openInEditor = (t) => {
    localStorage.setItem("te.type", t.templateType);
    localStorage.setItem("te.companyId", String(selectedCompany.id));
    localStorage.setItem("te.scopeDivisionId", t.divisionId == null ? "" : String(t.divisionId));
    localStorage.setItem("te.templateId", String(t.id));
    navigate("/templates/edit");
  };
  const newBlank = () => {
    localStorage.setItem("te.type", typeFilter || "Challan");
    localStorage.setItem("te.companyId", String(selectedCompany.id));
    localStorage.setItem("te.scopeDivisionId", (divFilter && divFilter !== "company") ? divFilter : "");
    localStorage.removeItem("te.templateId");
    navigate("/templates/edit");
  };

  // ── Print-tab actions ──
  const handleSetDefault = async (t) => {
    setBusyId(t.id);
    try { await setDefaultTemplate(t.id); notify(`"${t.name}" is now the default for ${TEMPLATE_TYPE_LABEL[t.templateType]} · ${scopeLabel(t)}.`, "success"); invalidatePrintTemplateCache(selectedCompany?.id); await load(); }
    catch { notify("Failed to set default.", "error"); } finally { setBusyId(null); }
  };
  const handleDelete = async (t) => {
    const ok = await confirm({ title: "Delete Template?", message: `Delete "${t.name}" (${TEMPLATE_TYPE_LABEL[t.templateType]} · ${scopeLabel(t)})? This cannot be undone.`, variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    setBusyId(t.id);
    try { await deleteTemplate(t.id); notify("Template deleted.", "success"); invalidatePrintTemplateCache(selectedCompany?.id); await load(); }
    catch (err) { notify(err.response?.data?.error || "Failed to delete.", "error"); } finally { setBusyId(null); }
  };
  const handleDuplicate = async (t) => {
    setBusyId(t.id);
    try {
      // The list is metadata-only now, so pull the source body by id before copying.
      const { data: full } = await getTemplateById(t.id);
      await createTemplate(selectedCompany.id, {
        templateType: t.templateType, divisionId: t.divisionId ?? null,
        name: `${t.name} (copy)`, htmlContent: full.htmlContent, templateJson: full.templateJson,
        editorMode: full.editorMode, isDefault: false,
        // The copy starts life signed exactly like its source; because the
        // assignment lives on the row, the copy can then be changed
        // independently without touching either template's HTML.
        stampId: t.stampId ?? null,
      });
      notify(`Duplicated "${t.name}".`, "success"); invalidatePrintTemplateCache(selectedCompany?.id); await load();
    } catch { notify("Failed to duplicate.", "error"); } finally { setBusyId(null); }
  };

  // Open the full-preview modal. The list is metadata-only, so fetch the body by
  // id; the modal shows a spinner until it lands (no blank-then-fill flash).
  const openPreview = async (t) => {
    setPreviewTarget(t);
    setPreviewLoading(true);
    try {
      const { data: full } = await getTemplateById(t.id);
      setPreviewTarget((cur) => (cur && cur.id === t.id ? { ...cur, htmlContent: full.htmlContent } : cur));
    } catch {
      notify("Failed to load template preview.", "error");
    } finally {
      setPreviewLoading(false);
    }
  };

  // ── Starter-tab: create a NEW template from a starter ──
  // If the company has divisions, ask whether the new template is company-wide
  // or scoped to a division before creating; otherwise create company-wide.
  const onStarterChosen = (starter) => {
    if (divisions.length > 0) setStarterToCreate(starter);
    else createFromStarter(starter, null);
  };
  const createFromStarter = async (starter, divisionId) => {
    setStarterToCreate(null);
    setCreating(true);
    try {
      const { data } = await createTemplate(selectedCompany.id, {
        templateType: starter.type, divisionId: divisionId ?? null,
        name: starter.name, htmlContent: starter.html, isDefault: false,
      });
      invalidatePrintTemplateCache(selectedCompany?.id);
      notify(`Created "${data.name}" from starter. Opening editor…`, "success");
      openInEditor(data);
    } catch { notify("Failed to create template from starter.", "error"); setCreating(false); }
  };

  // ── Excel-tab actions ──
  const triggerExcelUpload = (t) => { excelTargetIdRef.current = t.id; excelUploadRef.current?.click(); };
  const handleExcelFile = async (e) => {
    const file = e.target.files?.[0];
    const id = excelTargetIdRef.current;
    if (excelUploadRef.current) excelUploadRef.current.value = "";
    if (!file || !id) return;
    setBusyId(id);
    try { await uploadExcelTemplateById(id, file); notify("Excel layout uploaded.", "success"); invalidatePrintTemplateCache(selectedCompany?.id); await load(); }
    catch (err) { notify(err.response?.data?.error || "Failed to upload Excel.", "error"); } finally { setBusyId(null); }
  };
  const handleExcelDelete = async (t) => {
    const ok = await confirm({ title: "Remove Excel layout?", message: `Remove the Excel layout from "${t.name}"? This cannot be undone.`, variant: "danger", confirmText: "Remove" });
    if (!ok) return;
    setBusyId(t.id);
    try { await deleteExcelTemplateById(t.id); notify("Excel layout removed.", "success"); invalidatePrintTemplateCache(selectedCompany?.id); await load(); }
    catch { notify("Failed to remove Excel layout.", "error"); } finally { setBusyId(null); }
  };

  // ── Stamps-tab actions ──
  const handleStampUpload = async (file, name) => {
    if (!selectedCompany || !file) return;
    setStampUploading(true);
    try {
      await uploadStamp(selectedCompany.id, file, name);
      notify("Stamp uploaded.", "success");
      setStampModalOpen(false);
      await refreshStamps();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to upload stamp.", "error");
    } finally { setStampUploading(false); }
  };
  // ── Per-template stamp assignment ──

  // Assignment is a field write: the template's HTML is untouched, so swapping
  // a signature can never disturb the layout.
  const handleSetStamp = async (t, stampId) => {
    setStampBusyId(t.id);
    try {
      await setTemplateStamp(t.id, stampId);
      invalidatePrintTemplateCache(selectedCompany?.id);
      await load();
      notify(stampId ? "Signature updated." : "Signature removed.", "success");
    } catch (err) {
      notify(err.response?.data?.error || "Failed to update signature.", "error");
    } finally { setStampBusyId(null); }
  };

  // The list is metadata-only on this branch, so the body has to be fetched
  // before it can be rewritten.
  const handleAddSignatureBlock = async (t) => {
    setStampBusyId(t.id);
    try {
      const { data: full } = await getTemplateById(t.id);
      const { html, anchor, changed } = injectSignatureBlock(full.htmlContent || "");
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
      const firstStamp = companyStamps.find((x) => x.isDefault) || companyStamps[0] || null;
      await setTemplateStamp(t.id, firstStamp?.id ?? null, html);
      invalidatePrintTemplateCache(selectedCompany?.id);
      await load();
      notify(`Signature block added ${where}.`, "success");
    } catch (err) {
      notify(err.response?.data?.error || "Failed to add signature block.", "error");
    } finally { setStampBusyId(null); }
  };

  const handleConvertToSlot = async (t) => {
    setStampBusyId(t.id);
    try {
      const { data: full } = await getTemplateById(t.id);
      const slug = pinnedSlugs(full.htmlContent || "")[0];
      if (!slug) { notify("No fixed stamp reference found.", "info"); return; }
      const match = companyStamps.find((x) => x.slug === slug) || null;
      const ok = await confirm({
        title: "Make the signature changeable?",
        message: `This template points straight at "${slug}". Converting keeps the same image but `
          + `lets you switch stamps from a dropdown instead of editing the HTML.`,
        confirmText: "Convert",
      });
      if (!ok) return;
      await setTemplateStamp(t.id, match?.id ?? null, convertPinnedToSlot(full.htmlContent || "", slug));
      invalidatePrintTemplateCache(selectedCompany?.id);
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

  const handleStampRename = async (s) => {
    const name = window.prompt("Stamp name", s.name);
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === s.name) return;
    setStampBusyId(s.id);
    try { await updateStamp(selectedCompany.id, s.id, { name: trimmed }); await refreshStamps(); notify("Stamp renamed.", "success"); }
    catch { notify("Failed to rename stamp.", "error"); } finally { setStampBusyId(null); }
  };
  const handleStampDelete = async (s) => {
    const ok = await confirm({
      title: "Delete stamp?",
      // Templates assigned this stamp lose the assignment and print unsigned —
      // say so, and say how many, before deleting.
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
        <input type="text" placeholder="Search by name or type…" className="filter-search-input" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <select className="filter-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
        <option value="">All document types</option>
        {TEMPLATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      {divisions.length > 0 && (
        <select className="filter-select" value={divFilter} onChange={(e) => setDivFilter(e.target.value)}>
          <option value="">All scopes</option>
          <option value="company">Company-wide</option>
          {divisions.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
        </select>
      )}
      {tab === "print" && (
        <label style={st.checkLabel}>
          <input type="checkbox" checked={defaultOnly} onChange={(e) => setDefaultOnly(e.target.checked)} /> Default only
        </label>
      )}
    </div>
  );

  return (
    <div>
      {creating && (
        <div style={st.createOverlay}>
          <div style={st.createCard}>
            <div style={st.spin} />
            <span style={{ fontWeight: 600, color: colors.textPrimary }}>Creating template…</span>
          </div>
        </div>
      )}
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
            <button style={{ ...st.btn, ...st.btnPrimary }} onClick={newBlank}><MdAdd size={17} /> New Template</button>
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
            <select style={dropdownStyles.base} value={selectedCompany?.id || ""} onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}>
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
              {loading ? <Spinner label="Loading templates…" /> : printRows.length === 0 ? (
                <Empty label="No print templates match your filters. Create one, or start from a starter." />
              ) : (
                <div style={st.grid}>
                  {printRows.map((t) => (
                    <div key={t.id} style={st.card}>
                      <div style={st.cardTop}>
                        <span style={st.tName} title={t.name}>{t.name}</span>
                        {t.isDefault
                          ? <span style={st.badgeDefault}><MdStar size={12} /> Default</span>
                          : <MdStarBorder size={16} color="#c2cad6" title="Not default" />}
                      </div>
                      <div style={st.metaRow}>
                        <span style={st.typeChip}>{TEMPLATE_TYPE_LABEL[t.templateType] || t.templateType}</span>
                        <span style={st.scopeChip}>{scopeLabel(t)}</span>
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
                            state={t.stampState || "none"}
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
                        <button style={st.actBtn} title="Edit" disabled={busy} onClick={() => openInEditor(t)}><MdEdit size={15} /></button>
                        <button style={st.actBtn} title="Preview" disabled={busy} onClick={() => openPreview(t)}><MdVisibility size={15} /></button>
                        {canApplyStarter && <button style={st.actBtn} title="Import starter design" disabled={busy} onClick={() => setApplyTarget(t)}><MdBrush size={15} /></button>}
                        <button style={st.actBtn} title="Duplicate" disabled={busy} onClick={() => handleDuplicate(t)}><MdContentCopy size={15} /></button>
                        {!t.isDefault && <button style={st.actBtn} title="Set as default" disabled={busy} onClick={() => handleSetDefault(t)}><MdStar size={15} /></button>}
                        {canDelete && <button style={{ ...st.actBtn, color: "#dc3545" }} title="Delete" disabled={busy} onClick={() => handleDelete(t)}><MdDelete size={15} /></button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Tab: Starter Templates ── */}
          {tab === "starter" && (
            <StarterGallery
              embedded
              selectLabel="Create template"
              onSelect={onStarterChosen}
              typeFilter={typeFilter}
              onTypeFilterChange={setTypeFilter}
            />
          )}

          {/* ── Tab: Excel Templates ── */}
          {tab === "excel" && (
            <>
              {filtersBar}
              <p style={st.hint}>
                Excel layouts attach to a print template. A document prints/exports with its division&apos;s Excel layout when set, otherwise the company-wide one.
              </p>
              {loading ? <Spinner label="Loading templates…" /> : excelRows.length === 0 ? (
                <Empty label="No templates match your filters." />
              ) : (
                <div style={st.grid}>
                  {excelRows.map((t) => (
                    <div key={t.id} style={st.card}>
                      <div style={st.cardTop}>
                        <span style={st.tName} title={t.name}>{t.name}</span>
                        {t.hasExcelTemplate
                          ? <span style={st.excelChip}><MdGridOn size={11} /> {t.excelSheetName || "Attached"}</span>
                          : <span style={st.noExcelChip}>No layout</span>}
                      </div>
                      <div style={st.metaRow}>
                        <span style={st.typeChip}>{TEMPLATE_TYPE_LABEL[t.templateType] || t.templateType}</span>
                        <span style={st.scopeChip}>{scopeLabel(t)}</span>
                      </div>
                      <div style={st.actions}>
                        {busyId === t.id && <span style={st.cardSpin} aria-label="Working…" />}
                        <button style={{ ...st.actBtnWide }} disabled={busy} onClick={() => triggerExcelUpload(t)}>
                          <MdUploadFile size={15} /> {busyId === t.id ? "Working…" : t.hasExcelTemplate ? "Replace .xlsx" : "Upload .xlsx"}
                        </button>
                        {t.hasExcelTemplate && canDelete && (
                          <button style={{ ...st.actBtn, color: "#dc3545" }} title="Remove Excel layout" disabled={busy} onClick={() => handleExcelDelete(t)}><MdDelete size={15} /></button>
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
                <code style={{ fontFamily: "monospace" }}>{"{{stamps.slug}}"}</code> — no more pasting images into HTML.
                Each template can use different stamps.
              </p>
              {canManageStamps && (
                <div style={{ marginBottom: "1rem" }}>
                  <button style={{ ...st.btn, ...st.btnPrimary }} onClick={() => setStampModalOpen(true)}>
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
                      <div style={st.stampThumbWrap}>
                        <img src={s.url} alt={s.name} style={st.stampThumbImg} />
                      </div>
                      <div style={st.cardTop}>
                        <span style={st.tName} title={s.name}>{s.name}</span>
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

      {/* Apply-starter-to-existing */}
      {applyTarget && (
        <ApplyStarterModal
          template={applyTarget}
          division={applyTarget.divisionId != null ? divisionById[applyTarget.divisionId] : null}
          onClose={() => setApplyTarget(null)}
          onApplied={async () => { setApplyTarget(null); await load(); }}
        />
      )}

      {/* Scope chooser for a new template created from a starter */}
      {starterToCreate && (
        <div style={st.scopeOverlay} onClick={() => setStarterToCreate(null)}>
          <div style={st.scopeModal} onClick={(e) => e.stopPropagation()}>
            <div style={st.scopeHead}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: colors.textPrimary }}>Create “{starterToCreate.name}”</h3>
                <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", color: colors.textSecondary }}>
                  Where should this {TEMPLATE_TYPE_LABEL[starterToCreate.type] || starterToCreate.type} template live?
                </p>
              </div>
              <button style={st.closeBtn} onClick={() => setStarterToCreate(null)} aria-label="Close"><MdClose size={20} /></button>
            </div>
            <div style={st.scopeList}>
              <button style={st.scopeBtn} disabled={busy} onClick={() => createFromStarter(starterToCreate, null)}>
                <MdBusiness size={18} color={colors.blue} />
                <span><strong>Company-wide</strong><br /><span style={st.scopeHintTxt}>Used across {selectedCompany?.brandName || selectedCompany?.name} unless a division overrides it</span></span>
              </button>
              {divisions.map((d) => (
                <button key={d.id} style={st.scopeBtn} disabled={busy} onClick={() => createFromStarter(starterToCreate, d.id)}>
                  <MdDescription size={18} color={colors.teal} />
                  <span><strong>{d.name}</strong><br /><span style={st.scopeHintTxt}>Only for the {d.name} division</span></span>
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
              <div><strong>{previewTarget.name}</strong> <span style={st.typeChip}>{TEMPLATE_TYPE_LABEL[previewTarget.templateType]}</span> <span style={st.scopeChip}>{scopeLabel(previewTarget)}</span></div>
              <button style={st.closeBtn} onClick={() => setPreviewTarget(null)} aria-label="Close"><MdClose size={20} /></button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
              {previewLoading && previewTarget.htmlContent == null ? (
                <Spinner label="Loading preview…" />
              ) : (
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
                    {
                      company: selectedCompany,
                      division: previewTarget.divisionId != null ? divisionById[previewTarget.divisionId] : null,
                    },
                  )}
                  title={`Preview of ${previewTarget.name}`}
                />
              )}
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

// Self-contained upload modal: pick an image, name it, upload. Local state only.
function StampUploadModal({ onClose, onUpload, uploading }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState("");
  const inputRef = useRef(null);

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setName((prev) => prev || f.name.replace(/\.[^.]+$/, ""));
    setPreview(URL.createObjectURL(f));
  };

  return (
    <div style={st.scopeOverlay} onClick={onClose}>
      <div style={st.scopeModal} onClick={(e) => e.stopPropagation()}>
        <div style={st.scopeHead}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: colors.textPrimary }}>Upload Stamp</h3>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", color: colors.textSecondary }}>PNG, JPG or WebP. A transparent PNG works best for signatures.</p>
          </div>
          <button style={st.closeBtn} onClick={onClose} aria-label="Close"><MdClose size={20} /></button>
        </div>
        <div style={{ padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <input ref={inputRef} type="file" accept=".png,.jpg,.jpeg,.webp,.gif" style={{ display: "none" }} onChange={onPick} />
          <div
            onClick={() => inputRef.current?.click()}
            style={{ border: `2px dashed ${colors.inputBorder}`, borderRadius: 10, padding: "1.2rem", textAlign: "center", cursor: "pointer", background: "#f7f9fc" }}
          >
            {preview ? (
              <img src={preview} alt="preview" style={{ maxWidth: "100%", maxHeight: 140, objectFit: "contain" }} />
            ) : (
              <div style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>
                <MdUploadFile size={28} /><div style={{ marginTop: 6 }}>Click to choose an image</div>
              </div>
            )}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", color: colors.textSecondary, fontWeight: 600 }}>
            Name
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Director Signature"
              style={{ padding: "0.5rem 0.6rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: "0.9rem" }}
            />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.2rem" }}>
            <button style={{ ...st.btn, ...st.btnOutline }} onClick={onClose} disabled={uploading}>Cancel</button>
            <button
              style={{ ...st.btn, ...st.btnPrimary, opacity: (!file || uploading) ? 0.6 : 1, cursor: (!file || uploading) ? "default" : "pointer" }}
              disabled={!file || uploading}
              onClick={() => onUpload(file, name.trim())}
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
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
  tab: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1rem", border: "none", background: "transparent", color: colors.textSecondary, fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", borderBottom: "2px solid transparent", marginBottom: -2 },
  tabActive: { color: colors.blue, borderBottom: `2px solid ${colors.blue}` },
  checkLabel: { display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 600, cursor: "pointer" },
  hint: { margin: "0 0 0.85rem", fontSize: "0.8rem", color: colors.textSecondary, background: "#f4f8ff", border: "1px solid #dbe8ff", borderRadius: 8, padding: "0.5rem 0.7rem" },
  grid: { display: "grid", gap: "0.85rem", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))" },
  card: { border: `1px solid ${colors.cardBorder}`, borderRadius: 12, background: "#fff", padding: "0.85rem 0.9rem", display: "flex", flexDirection: "column", gap: "0.5rem", boxShadow: "0 1px 4px rgba(16,42,80,0.04)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" },
  tName: { fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
  badgeDefault: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.64rem", fontWeight: 800, color: "#f57f17", background: "#fff8e1", padding: "2px 7px", borderRadius: 5, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0 },
  metaRow: { display: "flex", gap: "0.4rem", flexWrap: "wrap" },
  typeChip: { fontSize: "0.68rem", fontWeight: 700, color: "#3949ab", background: "#e8eaf6", padding: "2px 8px", borderRadius: 5 },
  scopeChip: { fontSize: "0.68rem", fontWeight: 700, color: "#00695c", background: "#e0f2f1", padding: "2px 8px", borderRadius: 5 },
  excelChip: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.66rem", fontWeight: 700, color: "#1b5e20", background: "#e8f5e9", padding: "2px 7px", borderRadius: 5 },
  noExcelChip: { fontSize: "0.66rem", fontWeight: 700, color: "#90a4ae", background: "#eceff1", padding: "2px 7px", borderRadius: 5 },
  metaLine: { display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.72rem" },
  actions: { display: "flex", gap: "0.3rem", flexWrap: "wrap", marginTop: "auto", paddingTop: "0.35rem", borderTop: `1px solid ${colors.cardBorder}` },
  actBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 30, padding: 0, borderRadius: 7, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textSecondary, cursor: "pointer" },
  actBtnWide: { display: "inline-flex", alignItems: "center", gap: "0.35rem", flex: 1, justifyContent: "center", height: 32, padding: "0 0.5rem", borderRadius: 7, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", padding: "3rem 0" },
  spin: { width: 24, height: 24, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  cardSpin: { width: 16, height: 16, border: `2px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.7s linear infinite", alignSelf: "center" },
  createOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1400, padding: "1rem" },
  createCard: { background: "#fff", borderRadius: 14, padding: "1.4rem 1.8rem", display: "flex", alignItems: "center", gap: "0.9rem", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", textAlign: "center" },
  previewOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1300, padding: "1rem" },
  previewModal: { background: "#e8e8e8", borderRadius: 14, width: "min(860px, 96vw)", height: "94vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  previewHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", padding: "0.7rem 1rem", background: "#fff", borderBottom: `1px solid ${colors.cardBorder}` },
  closeBtn: { border: "none", background: "transparent", cursor: "pointer", color: "#8a94a6", padding: 4, display: "inline-flex" },
  scopeOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1320, padding: "1rem" },
  scopeModal: { background: "#fff", borderRadius: 14, width: "min(460px, 96vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" },
  scopeHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.1rem 0.75rem", borderBottom: `1px solid ${colors.cardBorder}` },
  scopeList: { display: "flex", flexDirection: "column", gap: "0.5rem", padding: "0.9rem 1.1rem", overflow: "auto" },
  scopeBtn: { display: "flex", alignItems: "center", gap: "0.6rem", textAlign: "left", border: `1px solid ${colors.inputBorder}`, background: "#fff", borderRadius: 10, padding: "0.7rem 0.85rem", cursor: "pointer", fontSize: "0.88rem", color: colors.textPrimary },
  scopeHintTxt: { fontSize: "0.74rem", color: colors.textSecondary, fontWeight: 400 },
  stampRow: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", paddingTop: "0.35rem", borderTop: `1px dashed ${colors.cardBorder}` },
  stampLabel: { fontSize: "0.72rem", fontWeight: 600, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.4px" },
  stampThumbWrap: { height: 110, display: "flex", alignItems: "center", justifyContent: "center", background: "#f7f9fc", border: `1px solid ${colors.cardBorder}`, borderRadius: 8, padding: 6 },
  stampThumbImg: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" },
  stampToken: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4rem", width: "100%", padding: "0.3rem 0.5rem", border: `1px solid ${colors.cardBorder}`, borderRadius: 7, background: "#f8fafd", cursor: "pointer" },
};
