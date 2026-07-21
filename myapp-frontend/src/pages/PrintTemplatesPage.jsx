import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  MdDescription, MdBusiness, MdSearch, MdAdd, MdAutoAwesome, MdGridOn,
  MdEdit, MdDelete, MdStar, MdStarBorder, MdVisibility, MdBrush, MdContentCopy,
  MdUploadFile, MdClose, MdLock, MdSwapHoriz,
} from "react-icons/md";
import {
  getTemplatesByCompany, createTemplate, setDefaultTemplate, deleteTemplate,
  uploadExcelTemplate, deleteExcelTemplate,
} from "../api/printTemplateApi";
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
];

export default function PrintTemplatesPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const canManage = has("printtemplates.manage.update");
  const canDelete = has("printtemplates.manage.delete");
  const canApplyStarter = has("printtemplates.starter.apply");

  const [tab, setTab] = useState("print");
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // filters (shared by Print + Excel tabs)
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [defaultOnly, setDefaultOnly] = useState(false);

  const [applyTarget, setApplyTarget] = useState(null); // template to apply a starter onto
  const [previewTarget, setPreviewTarget] = useState(null); // template to preview
  const [copyTarget, setCopyTarget] = useState(null); // template to copy into another type
  const excelUploadRef = useRef(null);
  const excelTargetTypeRef = useRef(null);

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
  useEffect(() => { setSearch(""); setTypeFilter(""); setDefaultOnly(false); }, [selectedCompany?.id]);

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
    localStorage.setItem("te.type", t.templateType);
    localStorage.setItem("te.companyId", String(selectedCompany.id));
    localStorage.setItem("te.templateId", String(t.id));
    navigate("/templates/edit");
  };
  const newBlank = () => {
    localStorage.setItem("te.type", typeFilter || "Challan");
    localStorage.setItem("te.companyId", String(selectedCompany.id));
    localStorage.removeItem("te.templateId");
    navigate("/templates/edit");
  };

  // ── Print-tab actions ──
  const handleSetDefault = async (t) => {
    setBusy(true);
    try { await setDefaultTemplate(t.id); notify(`"${t.name}" is now the default for ${TEMPLATE_TYPE_LABEL[t.templateType]}.`, "success"); await load(); }
    catch { notify("Failed to set default.", "error"); } finally { setBusy(false); }
  };
  const handleDelete = async (t) => {
    const ok = await confirm({ title: "Delete Template?", message: `Delete "${t.name}" (${TEMPLATE_TYPE_LABEL[t.templateType]})? This cannot be undone.`, variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    setBusy(true);
    try { await deleteTemplate(t.id); notify("Template deleted.", "success"); await load(); }
    catch (err) { notify(err.response?.data?.error || "Failed to delete.", "error"); } finally { setBusy(false); }
  };
  const handleDuplicate = async (t) => {
    setBusy(true);
    try {
      await createTemplate(selectedCompany.id, {
        templateType: t.templateType,
        name: `${t.name} (copy)`, htmlContent: t.htmlContent, templateJson: t.templateJson,
        editorMode: t.editorMode, isDefault: false,
      });
      notify(`Duplicated "${t.name}".`, "success"); await load();
    } catch { notify("Failed to duplicate.", "error"); } finally { setBusy(false); }
  };
  // Copy this template's HTML into a NEW template of a DIFFERENT document type,
  // then open it so the operator can adapt the (type-specific) merge fields.
  const handleCopyToType = async (t, chosenType) => {
    setCopyTarget(null);
    setBusy(true);
    try {
      const { data } = await createTemplate(selectedCompany.id, {
        templateType: chosenType,
        name: `${t.name} → ${TEMPLATE_TYPE_LABEL[chosenType]}`,
        htmlContent: t.htmlContent, templateJson: t.templateJson,
        editorMode: t.editorMode, isDefault: false,
      });
      notify(`Copied to ${TEMPLATE_TYPE_LABEL[chosenType]} — adjust the merge fields for the new document type.`, "success");
      openInEditor(data);
    } catch { notify("Failed to copy template.", "error"); setBusy(false); }
  };

  // ── Starter-tab: create a NEW company-level template from a starter ──
  const createFromStarter = async (starter) => {
    setBusy(true);
    try {
      const { data } = await createTemplate(selectedCompany.id, {
        templateType: starter.type,
        name: starter.name, htmlContent: starter.html, isDefault: false,
      });
      notify(`Created "${data.name}" from starter. Opening editor…`, "success");
      openInEditor(data);
    } catch { notify("Failed to create template from starter.", "error"); setBusy(false); }
  };

  // ── Excel-tab actions (per document TYPE, company-level) ──
  const triggerExcelUpload = (type) => { excelTargetTypeRef.current = type; excelUploadRef.current?.click(); };
  const handleExcelFile = async (e) => {
    const file = e.target.files?.[0];
    const type = excelTargetTypeRef.current;
    if (excelUploadRef.current) excelUploadRef.current.value = "";
    if (!file || !type || !selectedCompany) return;
    setBusy(true);
    try { await uploadExcelTemplate(selectedCompany.id, type, file); notify("Excel layout uploaded.", "success"); await load(); }
    catch (err) { notify(err.response?.data?.error || "Failed to upload Excel.", "error"); } finally { setBusy(false); }
  };
  const handleExcelDelete = async (row) => {
    const ok = await confirm({ title: "Remove Excel layout?", message: `Remove the Excel layout for ${row.label}? This cannot be undone.`, variant: "danger", confirmText: "Remove" });
    if (!ok) return;
    setBusy(true);
    try { await deleteExcelTemplate(selectedCompany.id, row.type); notify("Excel layout removed.", "success"); await load(); }
    catch { notify("Failed to remove Excel layout.", "error"); } finally { setBusy(false); }
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
      {tab === "print" && (
        <label style={st.checkLabel}>
          <input type="checkbox" checked={defaultOnly} onChange={(e) => setDefaultOnly(e.target.checked)} /> Default only
        </label>
      )}
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
            {TABS.map((t) => {
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
                      </div>
                      <div style={st.metaLine}>
                        {t.hasExcelTemplate && <span style={st.excelChip}><MdGridOn size={11} /> Excel</span>}
                        <span style={{ color: colors.textSecondary }}>Updated {fmtDate(t.updatedAt)}</span>
                      </div>
                      <div style={st.actions}>
                        <button style={st.actBtn} title="Edit" onClick={() => openInEditor(t)}><MdEdit size={15} /></button>
                        <button style={st.actBtn} title="Preview" onClick={() => setPreviewTarget(t)}><MdVisibility size={15} /></button>
                        {canApplyStarter && <button style={st.actBtn} title="Import starter design" onClick={() => setApplyTarget(t)}><MdBrush size={15} /></button>}
                        {canManage && <button style={st.actBtn} title="Copy — duplicate (same type) or copy to another document type" disabled={busy} onClick={() => setCopyTarget(t)}><MdContentCopy size={15} /></button>}
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
            <StarterGallery embedded selectLabel="Create template" onSelect={createFromStarter} />
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
                              <MdUploadFile size={15} /> {row.hasExcel ? "Replace .xlsx" : "Upload .xlsx"}
                            </button>
                            {row.hasExcel && canDelete && (
                              <button style={{ ...st.actBtn, color: "#dc3545" }} title="Remove Excel layout" disabled={busy} onClick={() => handleExcelDelete(row)}><MdDelete size={15} /></button>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: "0.78rem", color: colors.textSecondary }}>Create a print template for this type first.</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <input ref={excelUploadRef} type="file" accept=".xlsx,.xlsm" style={{ display: "none" }} onChange={handleExcelFile} />
            </>
          )}
        </>
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
                html={buildTemplatePreviewHtml(previewTarget.templateType, previewTarget.htmlContent || "", {
                  company: selectedCompany,
                })}
                title={`Preview of ${previewTarget.name}`}
              />
            </div>
          </div>
        </div>
      )}
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
  excelChip: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.66rem", fontWeight: 700, color: "#1b5e20", background: "#e8f5e9", padding: "2px 7px", borderRadius: 5 },
  noExcelChip: { fontSize: "0.66rem", fontWeight: 700, color: "#90a4ae", background: "#eceff1", padding: "2px 7px", borderRadius: 5 },
  metaLine: { display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.72rem" },
  actions: { display: "flex", gap: "0.3rem", flexWrap: "wrap", marginTop: "auto", paddingTop: "0.35rem", borderTop: `1px solid ${colors.cardBorder}` },
  actBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 30, padding: 0, borderRadius: 7, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textSecondary, cursor: "pointer" },
  actBtnWide: { display: "inline-flex", alignItems: "center", gap: "0.35rem", flex: 1, justifyContent: "center", height: 32, padding: "0 0.5rem", borderRadius: 7, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", padding: "3rem 0" },
  spin: { width: 24, height: 24, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", textAlign: "center" },
  previewOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1300, padding: "1rem" },
  previewModal: { background: "#e8e8e8", borderRadius: 14, width: "min(860px, 96vw)", height: "94vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  copyModal: { background: "#fff", borderRadius: 14, width: "min(520px, 96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  copyHint: { margin: 0, padding: "0.75rem 1rem 0", fontSize: "0.8rem", color: colors.textSecondary },
  copyGrid: { display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))", padding: "0.85rem 1rem 1.1rem", overflowY: "auto" },
  copyTypeBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 0.75rem", borderRadius: 9, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", textAlign: "left", minHeight: 44 },
  copyTypeBtnSame: { gridColumn: "1 / -1", borderColor: colors.teal, color: "#00695c", background: "#e0f2f1" },
  previewHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", padding: "0.7rem 1rem", background: "#fff", borderBottom: `1px solid ${colors.cardBorder}` },
  closeBtn: { border: "none", background: "transparent", cursor: "pointer", color: "#8a94a6", padding: 4, display: "inline-flex" },
};
