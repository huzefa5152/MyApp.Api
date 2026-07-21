import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  MdCode, MdBusiness, MdSave, MdRefresh, MdContentCopy,
  MdVisibility, MdEdit as MdEditIcon, MdBrush,
  MdUploadFile, MdArrowBack, MdLock, MdAutoAwesome, MdStar,
} from "react-icons/md";
import {
  getTemplateById, createTemplate, updateTemplateById, getMergeFields,
  getTemplatesByCompany, setDefaultTemplate,
} from "../api/printTemplateApi";
import { useCompany } from "../contexts/CompanyContext";
import { mergeTemplate } from "../utils/templateEngine";
import {
  TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL, SAMPLE_DATA, DEFAULT_TEMPLATES,
} from "../utils/templateSampleData";
import { dropdownStyles } from "../theme";
import CodeEditor from "../Components/templateEditor/CodeEditor";
import MergeFieldSidebar from "../Components/templateEditor/MergeFieldSidebar";
import PreviewPane from "../Components/templateEditor/PreviewPane";
import SyncWarningModal from "../Components/templateEditor/SyncWarningModal";
import VisualEditor from "../Components/templateEditor/VisualEditor";
import StarterGallery from "../Components/templateEditor/StarterGallery";
import { useConfirm } from "../Components/ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBorder: "#d0d7e2",
};

export default function TemplateEditorPage() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { has } = usePermissions();
  const canManage = has("printtemplates.manage.update");
  const { companies, selectedCompany, setSelectedCompany, loading } = useCompany();

  // ── Entry contract (set by PrintTemplatesPage before navigating here) ──
  //   te.type       — the document type to edit/create (e.g. "Challan").
  //   te.companyId  — the owning company id (string).
  //   te.templateId — the template id to EDIT; ABSENT means CREATE a new one.
  // Captured ONCE at mount so later state changes can't disturb the resolution.
  const entryRef = useRef({
    type: localStorage.getItem("te.type") || "Challan",
    companyId: Number(localStorage.getItem("te.companyId")) || null,
    templateId: (() => {
      const t = localStorage.getItem("te.templateId");
      return t ? Number(t) : null;
    })(),
  });
  const entry = entryRef.current;

  const [templateType, setTemplateType] = useState(entry.type);
  // Current saved template id (null while creating and not yet saved).
  const [currentTemplateId, setCurrentTemplateId] = useState(null);
  const [templateName, setTemplateName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [templateJson, setTemplateJson] = useState(null);
  const [originalJson, setOriginalJson] = useState(null);
  const [editorMode, setEditorMode] = useState("code"); // "code" | "visual"
  const [activeTab, setActiveTab] = useState("editor"); // editor | preview
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [showSyncWarning, setShowSyncWarning] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  // All saved templates of the current type (drives the Saved Templates switch dropdown).
  const [allTemplates, setAllTemplates] = useState([]);
  const [managerBusy, setManagerBusy] = useState(false);
  const [fields, setFields] = useState([]);
  const htmlImportRef = useRef(null);
  const codeEditorRef = useRef(null);
  const visualEditorRef = useRef(null);
  // Guards the one-shot mount load so StrictMode's double-invoke can't re-run it.
  const initedRef = useRef(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Resolve the owning company from te.companyId and reflect it in the header.
  useEffect(() => {
    if (!companies.length) return;
    const target = companies.find((c) => String(c.id) === String(entry.companyId));
    if (target && selectedCompany?.id !== target.id) setSelectedCompany(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies]);

  // Fetch merge fields from API when template type changes.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await getMergeFields(templateType);
        setFields(data.map(f => ({
          field: f.fieldExpression,
          label: f.label,
          category: f.category,
        })));
      } catch {
        setFields([]);
      }
    })();
  }, [templateType]);

  // One-shot mount: EDIT an existing template (by id) or SEED a new one.
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    const { type, templateId } = entry;

    if (templateId) {
      // Editing — load the template by id and populate from its DTO.
      (async () => {
        try {
          const { data } = await getTemplateById(templateId);
          setTemplateType(data.templateType || type);
          setCurrentTemplateId(data.id);
          setTemplateName(data.name || "");
          setOriginalName(data.name || "");
          setHtmlContent(data.htmlContent || "");
          setOriginalContent(data.htmlContent || "");
          setTemplateJson(data.templateJson || null);
          setOriginalJson(data.templateJson || null);
          setEditorMode(data.editorMode || "code");
          setActiveTab("editor");
        } catch {
          showToast("Failed to load template", "error");
        }
      })();
    } else {
      // Creating — start from the type's built-in default; first Save persists it.
      const def = DEFAULT_TEMPLATES[type] || "";
      setTemplateType(type);
      setCurrentTemplateId(null);
      setTemplateName("");           // blank — operator names it (required before Save)
      setOriginalName("");
      setHtmlContent(def);
      setOriginalContent("");
      setTemplateJson(null);
      setOriginalJson(null);
      setEditorMode("code");
      setActiveTab("editor");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the Saved-Templates list in sync with the current type + company.
  useEffect(() => {
    if (!selectedCompany) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getTemplatesByCompany(selectedCompany.id);
        if (!cancelled) setAllTemplates((data || []).filter((t) => t.templateType === templateType));
      } catch {
        if (!cancelled) setAllTemplates([]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateType, selectedCompany]);

  // Load a template DTO into the editor as a clean (not-dirty) baseline.
  const loadIntoEditor = (dto) => {
    setTemplateType(dto.templateType || templateType);
    setCurrentTemplateId(dto.id);
    setTemplateName(dto.name || "");
    setOriginalName(dto.name || "");
    setHtmlContent(dto.htmlContent || "");
    setOriginalContent(dto.htmlContent || "");
    setTemplateJson(dto.templateJson || null);
    setOriginalJson(dto.templateJson || null);
    setEditorMode(dto.editorMode || "code");
    localStorage.setItem("te.templateId", String(dto.id));
    setActiveTab("editor");
  };

  // Start a brand-new (unsaved) template of the current type.
  const startNewTemplate = () => {
    setCurrentTemplateId(null);
    setTemplateName("");
    setOriginalName("");
    const def = DEFAULT_TEMPLATES[templateType] || "";
    setHtmlContent(def);
    setOriginalContent("");
    setTemplateJson(null);
    setOriginalJson(null);
    setEditorMode("code");
    try { localStorage.removeItem("te.templateId"); } catch { /* ignore */ }
    setActiveTab("editor");
  };

  // Quick-switch dropdown (toolbar): pick a saved template id, or "__new__".
  const handleSwitchTemplate = async (v) => {
    const current = currentTemplateId ? String(currentTemplateId) : "__new__";
    if (v === current) return;
    if (hasChanges) {
      const ok = await confirm({ title: "Discard changes?", message: "You have unsaved changes. Switch templates and discard them?", variant: "danger", confirmText: "Discard" });
      if (!ok) return;
    }
    if (v === "__new__") { startNewTemplate(); return; }
    await handleSelectFromManager(Number(v));
  };

  // Reload the saved-template list for the current type; optionally re-load one.
  const refreshTemplates = async (preferId) => {
    if (!selectedCompany) return;
    const { data } = await getTemplatesByCompany(selectedCompany.id);
    const ofType = (data || []).filter((t) => t.templateType === templateType);
    setAllTemplates(ofType);
    if (preferId != null) {
      const found = (data || []).find((t) => t.id === preferId);
      if (found) loadIntoEditor(found);
    }
  };

  // Load a saved template into the editor (used by the Saved Templates dropdown).
  const handleSelectFromManager = async (id) => {
    try {
      const { data } = await getTemplateById(id);
      loadIntoEditor(data);
    } catch {
      showToast("Failed to load template", "error");
    }
  };

  // Make the currently-open saved template the default for its document type.
  // (Rename / duplicate / copy-to-type / delete all live on the Print Templates
  // list page — the editor stays focused on authoring one template.)
  const handleSetCurrentDefault = async () => {
    if (!currentTemplateId) return;
    setManagerBusy(true);
    try {
      await setDefaultTemplate(currentTemplateId);
      await refreshTemplates(currentTemplateId);
      showToast("Set as default for this document type");
    } catch {
      showToast("Failed to set default", "error");
    } finally {
      setManagerBusy(false);
    }
  };

  const handleSave = async () => {
    const name = templateName.trim();
    if (!name) {
      showToast("Template name is required", "error");
      return;
    }
    setSaving(true);
    try {
      let saveHtml = htmlContent;
      let saveJson = templateJson;

      // If in visual mode, extract current state from GrapesJS
      if (editorMode === "visual" && visualEditorRef.current) {
        saveHtml = visualEditorRef.current.getHtml();
        saveJson = JSON.stringify(visualEditorRef.current.getProjectData());
      }

      if (currentTemplateId) {
        await updateTemplateById(currentTemplateId, {
          name, htmlContent: saveHtml, templateJson: saveJson, editorMode,
        });
      } else {
        const companyId = selectedCompany?.id ?? entry.companyId;
        if (!companyId) {
          showToast("No company selected", "error");
          setSaving(false);
          return;
        }
        const { data } = await createTemplate(companyId, {
          templateType, name, htmlContent: saveHtml, templateJson: saveJson,
          editorMode, isDefault: false,
        });
        // Switch into "editing that id" mode so subsequent saves update it.
        setCurrentTemplateId(data.id);
        localStorage.setItem("te.templateId", String(data.id));
      }

      setTemplateName(name);
      setOriginalName(name);
      setHtmlContent(saveHtml);
      setTemplateJson(saveJson);
      setOriginalContent(saveHtml);
      setOriginalJson(saveJson);
      await refreshTemplates();   // keep the switch dropdown + manager in sync
      showToast("Template saved successfully!");
    } catch {
      showToast("Failed to save template", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const def = DEFAULT_TEMPLATES[templateType] || "";
    setHtmlContent(def);
    setTemplateJson(null);
    if (editorMode === "visual") {
      setEditorMode("code");
    }
  };

  const handleModeSwitch = (newMode) => {
    if (newMode === editorMode) return;

    if (newMode === "visual") {
      // Switching to visual: if no templateJson exists, warn about lossy conversion
      if (!templateJson) {
        setShowSyncWarning(true);
        return;
      }
      // If templateJson exists, switch directly (lossless)
      setEditorMode("visual");
      setActiveTab("editor");
    } else {
      // Switching to code: don't extract HTML from GrapesJS here
      // (GrapesJS reformats HTML, causing false "unsaved changes").
      // HTML is extracted only at save time.
      setEditorMode("code");
      setActiveTab("editor");
    }
  };

  const confirmSyncWarning = () => {
    setShowSyncWarning(false);
    setEditorMode("visual");
    setActiveTab("editor");
  };

  const handleSelectStarter = async (template) => {
    if (htmlContent && htmlContent !== DEFAULT_TEMPLATES[templateType]) {
      const ok = await confirm({ title: "Replace Template?", message: "This will replace your current template. Any unsaved changes will be lost.", variant: "warning", confirmText: "Replace" });
      if (!ok) return;
    }
    setHtmlContent(template.html);
    setTemplateJson(null);
    setEditorMode("code");
    setActiveTab("editor");
    setShowTemplatePicker(false);
    showToast(`Loaded "${template.name}" template`);
  };

  const handleImportHtml = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const content = ev.target.result;
      if (htmlContent && htmlContent !== DEFAULT_TEMPLATES[templateType]) {
        const ok = await confirm({ title: "Replace Template?", message: "This will replace your current template. Any unsaved changes will be lost.", variant: "warning", confirmText: "Replace" });
        if (!ok) return;
      }
      setHtmlContent(content);
      setTemplateJson(null);
      setEditorMode("code");
      setActiveTab("editor");
      showToast("HTML template imported!");
    };
    reader.readAsText(file);
    if (htmlImportRef.current) htmlImportRef.current.value = "";
  };

  const insertField = useCallback(
    (field) => {
      if (editorMode === "visual") {
        visualEditorRef.current?.insertMergeField(field);
        return;
      }
      const el = codeEditorRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const before = htmlContent.substring(0, start);
      const after = htmlContent.substring(end);
      const newContent = before + field + after;
      setHtmlContent(newContent);
      setTimeout(() => {
        el.focus();
        el.selectionStart = el.selectionEnd = start + field.length;
      }, 0);
    },
    [htmlContent, editorMode]
  );

  const previewHtml = (() => {
    try {
      const src = editorMode === "visual" && visualEditorRef.current
        ? visualEditorRef.current.getHtml()
        : htmlContent;
      return mergeTemplate(src, SAMPLE_DATA[templateType]);
    } catch (e) {
      return `<div style="color:red;padding:20px;font-family:sans-serif"><h3>Template Error</h3><pre>${e.message}</pre></div>`;
    }
  })();

  const hasChanges =
    htmlContent !== originalContent ||
    templateJson !== originalJson ||
    templateName.trim() !== originalName;
  const typeLabel = TEMPLATE_TYPE_LABEL[templateType] || templateType;
  // Is the template currently open already the default for its type?
  const currentIsDefault = !!allTemplates.find((t) => t.id === currentTemplateId)?.isDefault;

  if (!canManage) {
    return (
      <div style={{ textAlign: "center", padding: "4rem 1.5rem", background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 14 }}>
        <MdLock style={{ fontSize: "2.5rem", color: colors.textSecondary }} />
        <h3 style={{ margin: "0.75rem 0 0.25rem" }}>Access denied</h3>
        <p style={{ margin: 0, color: colors.textSecondary, fontSize: "0.9rem" }}>You don&apos;t have permission to edit print templates.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>
        <span style={{ color: colors.textSecondary }}>Loading...</span>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "3rem", flexDirection: "column" }}>
        <MdBusiness size={48} color={colors.inputBorder} />
        <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>No companies available. Add a company first.</p>
      </div>
    );
  }

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div style={{ height: "calc(100vh - 80px)", display: "flex", flexDirection: "column", gap: "0" }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          padding: "0.75rem 1.25rem", borderRadius: 10,
          background: toast.type === "error" ? "#dc3545" : "#28a745",
          color: "#fff", fontWeight: 600, fontSize: "0.9rem",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}>
          {toast.msg}
        </div>
      )}

      {/* Sync Warning Modal */}
      {showSyncWarning && (
        <SyncWarningModal
          onConfirm={confirmSyncWarning}
          onCancel={() => setShowSyncWarning(false)}
        />
      )}

      {/* Design gallery — pick a starter design (with live A4 previews) to apply. */}
      {showTemplatePicker && (
        <StarterGallery
          lockType={templateType}
          selectLabel="Use this design"
          onSelect={handleSelectStarter}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}

      {/* Top Bar */}
      <div style={styles.topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            onClick={() => navigate("/templates")}
            title="Back to Print Templates"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, borderRadius: 8, padding: isMobile ? "0.3rem 0.5rem" : "0.4rem 0.7rem", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
          >
            <MdArrowBack size={16} /> {isMobile ? "" : "Print Templates"}
          </button>
          <div style={{ ...styles.headerIcon, ...(isMobile ? { width: 34, height: 34, borderRadius: 8 } : {}) }}>
            <MdCode size={isMobile ? 18 : 24} color="#fff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: isMobile ? "1rem" : "1.3rem", fontWeight: 700, color: colors.textPrimary }}>
              {currentTemplateId ? "Edit Template" : "New Template"}
            </h2>
            {!isMobile && (
              <p style={{ margin: 0, fontSize: "0.82rem", color: colors.textSecondary }}>
                Customize print templates for each company
              </p>
            )}
          </div>
        </div>

        {isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", width: "100%" }}>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Company</label>
              <div style={styles.readonlyValue}>
                <MdBusiness size={16} color={colors.blue} style={{ flexShrink: 0 }} />
                <span>{selectedCompany?.brandName || selectedCompany?.name || "—"}</span>
              </div>
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Document Type</label>
              <select
                style={{ ...dropdownStyles.base, minWidth: 0, width: "100%", fontSize: "0.82rem" }}
                value={templateType}
                disabled
                title="Document type is fixed for this template"
              >
                {TEMPLATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Saved Templates</label>
              <select
                style={{ ...dropdownStyles.base, minWidth: 0, width: "100%", fontSize: "0.82rem" }}
                value={currentTemplateId ? String(currentTemplateId) : "__new__"}
                onChange={(e) => handleSwitchTemplate(e.target.value)}
                title="Switch between saved templates for this document type, or start a new one"
              >
                {allTemplates.map((t) => (
                  <option key={t.id} value={String(t.id)}>{t.name}{t.isDefault ? " ★" : ""}</option>
                ))}
                <option value="__new__">➕ New template…</option>
              </select>
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Template Name</label>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Name this template…"
                style={{ ...styles.nameInput, width: "100%", fontSize: "0.82rem" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <button style={{ ...styles.btn, ...styles.btnOutline, padding: "0.4rem 0.6rem", fontSize: "0.78rem", flex: 1, justifyContent: "center" }} onClick={() => setShowTemplatePicker(true)} title="Browse designed layouts and apply one">
                <MdAutoAwesome size={14} /> Design Gallery
              </button>
              {currentTemplateId && !currentIsDefault && (
                <button style={{ ...styles.btn, ...styles.btnOutline, padding: "0.4rem 0.6rem", fontSize: "0.78rem", flexShrink: 0 }} onClick={handleSetCurrentDefault} disabled={managerBusy} title="Make this the default template used for printing this document type">
                  <MdStar size={14} /> Set default
                </button>
              )}
              <button style={{ ...styles.btn, ...styles.btnOutline, padding: "0.4rem 0.6rem", fontSize: "0.78rem", flexShrink: 0 }} onClick={handleReset} title="Reset to default">
                <MdRefresh size={14} /> Reset
              </button>
              <button
                style={{ ...styles.btn, ...styles.btnPrimary, opacity: (saving || !templateName.trim()) ? 0.7 : 1, padding: "0.4rem 0.6rem", fontSize: "0.78rem", flexShrink: 0 }}
                onClick={handleSave}
                disabled={saving || !templateName.trim()}
              >
                <MdSave size={14} /> {saving ? "..." : "Save"}
              </button>
            </div>
            {hasChanges && <span style={{ fontSize: "0.75rem", color: "#e65100", fontWeight: 600 }}>Unsaved changes</span>}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Company</label>
              <div style={styles.readonlyValue}>
                <MdBusiness size={18} color={colors.blue} style={{ flexShrink: 0 }} />
                <span>{selectedCompany?.brandName || selectedCompany?.name || "—"}</span>
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Document Type</label>
              <select
                style={{ ...dropdownStyles.base, minWidth: "180px" }}
                value={templateType}
                disabled
                title="Document type is fixed for this template"
              >
                {TEMPLATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Saved Templates</label>
              <select
                style={{ ...dropdownStyles.base, minWidth: "180px" }}
                value={currentTemplateId ? String(currentTemplateId) : "__new__"}
                onChange={(e) => handleSwitchTemplate(e.target.value)}
                title="Switch between saved templates for this document type, or start a new one"
              >
                {allTemplates.map((t) => (
                  <option key={t.id} value={String(t.id)}>{t.name}{t.isDefault ? " ★" : ""}</option>
                ))}
                <option value="__new__">➕ New template…</option>
              </select>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Template Name</label>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Name this template…"
                style={{ ...styles.nameInput, minWidth: "200px" }}
              />
            </div>

            {/* Mode Toggle */}
            <div style={styles.modeToggle}>
              <button
                style={{ ...styles.modeBtn, ...(editorMode === "code" ? styles.modeBtnActive : {}) }}
                onClick={() => handleModeSwitch("code")}
                title="Code Editor"
              >
                <MdCode size={16} /> Code
              </button>
              <button
                style={{ ...styles.modeBtn, ...(editorMode === "visual" ? styles.modeBtnActive : {}) }}
                onClick={() => handleModeSwitch("visual")}
                title="Visual Builder"
              >
                <MdBrush size={16} /> Visual
              </button>
            </div>

            <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={() => setShowTemplatePicker(true)} title="Browse designed layouts and apply one">
              <MdAutoAwesome size={16} /> Design Gallery
            </button>
            {currentTemplateId && !currentIsDefault && (
              <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={handleSetCurrentDefault} disabled={managerBusy} title="Make this the default template used for printing this document type">
                <MdStar size={16} /> Set as default
              </button>
            )}
            <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={() => htmlImportRef.current?.click()} title="Import HTML file">
              <MdUploadFile size={16} /> Import HTML
            </button>
            <input
              ref={htmlImportRef}
              type="file"
              accept=".html,.htm"
              style={{ display: "none" }}
              onChange={handleImportHtml}
            />
            <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={handleReset} title="Reset to default">
              <MdRefresh size={16} /> Reset
            </button>
            <button
              style={{ ...styles.btn, ...styles.btnPrimary, opacity: (saving || !templateName.trim()) ? 0.7 : 1 }}
              onClick={handleSave}
              disabled={saving || !templateName.trim()}
            >
              <MdSave size={16} /> {saving ? "Saving..." : "Save"}
            </button>
            {hasChanges && <span style={{ fontSize: "0.78rem", color: "#e65100", fontWeight: 600 }}>Unsaved changes</span>}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", gap: "0", overflow: "hidden", borderTop: `1px solid ${colors.cardBorder}` }}>

        {/* Visual Editor Mode */}
        {editorMode === "visual" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Tabs for visual mode */}
            <div style={styles.tabs}>
              <button
                style={{ ...styles.tab, ...(activeTab === "editor" ? styles.tabActive : {}) }}
                onClick={() => setActiveTab("editor")}
              >
                <MdBrush size={15} /> Visual Builder
              </button>
              <button
                style={{ ...styles.tab, ...(activeTab === "preview" ? styles.tabActive : {}) }}
                onClick={() => setActiveTab("preview")}
              >
                <MdVisibility size={15} /> Preview
              </button>
            </div>

            {/* Keep VisualEditor mounted (hidden during preview) to preserve GrapesJS state */}
            <div style={{ flex: 1, display: activeTab === "editor" ? "flex" : "none", overflow: "hidden" }}>
              <VisualEditor
                ref={visualEditorRef}
                htmlContent={htmlContent}
                templateJson={templateJson}
                fields={fields}
              />
            </div>
            {activeTab === "preview" && (
              <PreviewPane html={previewHtml} isMobile={isMobile} />
            )}
          </div>
        ) : (
          <>
            {/* Merge Fields Sidebar - hidden on mobile */}
            {!isMobile && (
              <MergeFieldSidebar fields={fields} onInsert={insertField} />
            )}

            {/* Code Editor / Preview Area */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Tabs */}
              <div style={styles.tabs}>
                <button
                  style={{ ...styles.tab, ...(activeTab === "editor" ? styles.tabActive : {}), padding: isMobile ? "0.5rem 0.75rem" : undefined }}
                  onClick={() => setActiveTab("editor")}
                >
                  <MdEditIcon size={15} /> Editor
                </button>
                <button
                  style={{ ...styles.tab, ...(activeTab === "preview" ? styles.tabActive : {}), padding: isMobile ? "0.5rem 0.75rem" : undefined }}
                  onClick={() => setActiveTab("preview")}
                >
                  <MdVisibility size={15} /> Preview
                </button>
                <button
                  style={{ ...styles.tab, ...styles.tabCopy, padding: isMobile ? "0.5rem 0.6rem" : undefined }}
                  onClick={() => { navigator.clipboard.writeText(htmlContent); showToast("Copied to clipboard!"); }}
                  title="Copy HTML"
                >
                  <MdContentCopy size={14} /> Copy
                </button>
              </div>

              {activeTab === "editor" && (
                <CodeEditor
                  ref={codeEditorRef}
                  value={htmlContent}
                  onChange={setHtmlContent}
                  isMobile={isMobile}
                />
              )}

              {activeTab === "preview" && (
                <PreviewPane html={previewHtml} isMobile={isMobile} />
              )}
            </div>
          </>
        )}
      </div>

    </div>
  );
}

const styles = {
  // Labeled control groups in the toolbar — a small caption above each
  // control so it's obvious what each one selects.
  fieldGroup: { display: "flex", flexDirection: "column", gap: "0.18rem" },
  fieldLabel: {
    fontSize: "0.64rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.05em", color: "#7a8696", paddingLeft: "0.15rem",
  },
  readonlyValue: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.45rem 0.7rem",
    borderRadius: 8,
    border: `1px solid ${colors.cardBorder}`,
    background: "#f5f7fa",
    fontSize: "0.85rem",
    fontWeight: 600,
    color: colors.textPrimary,
  },
  nameInput: {
    padding: "0.45rem 0.7rem",
    borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`,
    fontSize: "0.85rem",
    color: colors.textPrimary,
    background: "#fff",
    outline: "none",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.75rem 1.25rem",
    flexWrap: "wrap",
    gap: "0.75rem",
    background: "#fff",
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.45rem 1rem",
    borderRadius: 8,
    border: "none",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  btnPrimary: {
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    color: "#fff",
    boxShadow: "0 2px 8px rgba(13,71,161,0.2)",
  },
  btnOutline: {
    background: "#fff",
    color: colors.textSecondary,
    border: `1px solid ${colors.inputBorder}`,
  },
  modeToggle: {
    display: "inline-flex",
    borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`,
    overflow: "hidden",
  },
  modeBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.4rem 0.75rem",
    border: "none",
    background: "#fff",
    color: colors.textSecondary,
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  modeBtnActive: {
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    color: "#fff",
  },
  tabs: {
    display: "flex",
    gap: 0,
    borderBottom: `1px solid ${colors.cardBorder}`,
    background: "#f5f7fa",
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.6rem 1.25rem",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "0.85rem",
    color: colors.textSecondary,
    borderBottom: "2px solid transparent",
    transition: "all 0.2s",
  },
  tabActive: {
    color: colors.blue,
    borderBottomColor: colors.blue,
    background: "#fff",
  },
  tabCopy: {
    marginLeft: "auto",
    fontSize: "0.8rem",
    color: colors.textSecondary,
  },
  btnDanger: {
    background: "#fff",
    color: "#c62828",
    border: "1px solid #c6282830",
  },
};
