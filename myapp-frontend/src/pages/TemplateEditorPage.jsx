import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  MdCode, MdBusiness, MdSave, MdRefresh, MdContentCopy,
  MdVisibility, MdEdit as MdEditIcon, MdBrush,
  MdUploadFile, MdDelete, MdGridOn, MdDescription, MdArrowBack,
} from "react-icons/md";
import {
  getMergeFields, getTemplatesByCompany,
  createTemplate, updateTemplateById, setDefaultTemplate, deleteTemplate,
  uploadExcelTemplateById, setExcelSheetNameById, deleteExcelTemplateById,
} from "../api/printTemplateApi";
import { getDivisionsByCompany } from "../api/divisionApi";
import { useCompany } from "../contexts/CompanyContext";
import {
  TEMPLATE_TYPES, DEFAULT_TEMPLATES, buildTemplatePreviewHtml,
} from "../utils/templateSampleData";
import { dropdownStyles } from "../theme";
import CodeEditor from "../Components/templateEditor/CodeEditor";
import MergeFieldSidebar from "../Components/templateEditor/MergeFieldSidebar";
import PreviewPane from "../Components/templateEditor/PreviewPane";
import SyncWarningModal from "../Components/templateEditor/SyncWarningModal";
import VisualEditor from "../Components/templateEditor/VisualEditor";
import StarterGallery from "../Components/templateEditor/StarterGallery";
import ApplyStarterModal from "../Components/templateEditor/ApplyStarterModal";
import SavedTemplatesManager from "../Components/templateEditor/SavedTemplatesManager";
import { useConfirm } from "../Components/ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { MdLock } from "react-icons/md";


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
  const canSheetPin = has("printtemplates.manage.sheetpin");
  const canDelete = has("printtemplates.manage.delete");
  const canApplyStarter = has("printtemplates.starter.apply");
  const [showApplyStarter, setShowApplyStarter] = useState(false);
  const { companies, selectedCompany, setSelectedCompany, loading } = useCompany();
  const [templateType, setTemplateType] = useState(() => localStorage.getItem("te.type") || "Challan");
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
  const [showManager, setShowManager] = useState(false);
  const [managerBusy, setManagerBusy] = useState(false);
  // Scope = company-wide (scopeDivisionId === null) or a specific division.
  const [divisions, setDivisions] = useState([]);
  const [scopeDivisionId, setScopeDivisionId] = useState(null);
  // Full template list for the company (each item carries its html/json/excel info,
  // so the editor populates straight from here â€” no per-id fetch).
  const [allTemplates, setAllTemplates] = useState([]);
  const [currentTemplateId, setCurrentTemplateId] = useState(null);
  const [currentTemplateName, setCurrentTemplateName] = useState("Default");
  const [fields, setFields] = useState([]);
  const [hasExcel, setHasExcel] = useState(false);
  const [excelUploading, setExcelUploading] = useState(false);
  // Sheet pinned by operator on the uploaded Excel template (null = auto-detect).
  // Drives the dropdown next to the Excel template badge.
  const [excelSheetName, setExcelSheetName] = useState(null);
  // All sheets present in the uploaded workbook (for the picker dropdown).
  const [excelSheetNames, setExcelSheetNames] = useState([]);
  // Set while a POST to save the sheet pin is in flight â€” disables the
  // dropdown to prevent double-submits.
  const [sheetSaving, setSheetSaving] = useState(false);
  const excelInputRef = useRef(null);
  const htmlImportRef = useRef(null);
  const codeEditorRef = useRef(null);
  const visualEditorRef = useRef(null);
  // Mirrors currentTemplateId for use inside async refresh callbacks without
  // adding it as an effect dependency (avoids re-populate loops).
  const currentTemplateIdRef = useRef(null);

  // Captured ONCE at mount (before the persist effects below can overwrite
  // localStorage) so a page reload restores the last scope + template. Restore
  // is gated on the saved company matching the restored company, and is
  // consumed after the first company-load â€” so a deliberate company switch
  // resets to company-wide rather than restoring a stale division/template.
  const initialRestoreRef = useRef({
    companyId: Number(localStorage.getItem("te.companyId")) || null,
    scope: (() => { const s = localStorage.getItem("te.scopeDivisionId"); return (s == null || s === "") ? null : Number(s); })(),
    templateId: Number(localStorage.getItem("te.templateId")) || null,
    consumed: false,
  });

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Fetch merge fields from API when template type changes
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

  // Persist the editor's selections so a page reload restores them (the company
  // is already restored globally by CompanyContext; these add type + scope +
  // template on top). The restore reads via initialRestoreRef (captured at
  // mount), so these writes can't clobber it.
  useEffect(() => { localStorage.setItem("te.type", templateType); }, [templateType]);
  useEffect(() => {
    if (!selectedCompany) return;
    localStorage.setItem("te.companyId", String(selectedCompany.id));
    localStorage.setItem("te.scopeDivisionId", scopeDivisionId == null ? "" : String(scopeDivisionId));
    if (currentTemplateId != null) localStorage.setItem("te.templateId", String(currentTemplateId));
    else localStorage.removeItem("te.templateId");
  }, [selectedCompany?.id, scopeDivisionId, currentTemplateId]);

  // â”€â”€ Scope + multi-template helpers â”€â”€

  // Populate the editor from a template DTO (or seed a blank default for an empty scope).
  // keepTab leaves the Editor/Preview tab as-is (so switching templates while previewing
  // keeps you in preview to compare); callers that change type/scope reset to the editor.
  const populateEditor = (tpl, type, keepTab = false) => {
    if (tpl) {
      currentTemplateIdRef.current = tpl.id;
      setCurrentTemplateId(tpl.id);
      setCurrentTemplateName(tpl.name || "Default");
      setHtmlContent(tpl.htmlContent || "");
      setOriginalContent(tpl.htmlContent || "");
      setTemplateJson(tpl.templateJson || null);
      setOriginalJson(tpl.templateJson || null);
      setEditorMode(tpl.editorMode || "code");
      setHasExcel(tpl.hasExcelTemplate || false);
      setExcelSheetName(tpl.excelSheetName || null);
      setExcelSheetNames(tpl.excelSheetNames || []);
    } else {
      const def = DEFAULT_TEMPLATES[type] || "";
      currentTemplateIdRef.current = null;
      setCurrentTemplateId(null);
      setCurrentTemplateName("Default");
      setHtmlContent(def);
      setOriginalContent("");   // empty scope â†’ show as unsaved so Save creates the first template
      setTemplateJson(null);
      setOriginalJson(null);
      setEditorMode("code");
      setHasExcel(false);
      setExcelSheetName(null);
      setExcelSheetNames([]);
    }
    if (!keepTab) setActiveTab("editor");
  };

  // Pick + load the right template for (type, scope): prefer a specific id, else the
  // scope default, else the first, else seed a blank.
  const loadScope = (list, type, divId, preferId = null) => {
    const inScope = list.filter(
      (t) => t.templateType === type && (t.divisionId ?? null) === (divId ?? null)
    );
    const pick =
      (preferId != null && inScope.find((t) => t.id === preferId)) ||
      inScope.find((t) => t.isDefault) ||
      inScope[0] ||
      null;
    populateEditor(pick, type);
  };

  // Refetch the company's templates and re-load the current scope (used after
  // create/duplicate/rename/delete/set-default so default badges stay accurate).
  const refreshTemplates = async (preferId) => {
    if (!selectedCompany) return [];
    const { data } = await getTemplatesByCompany(selectedCompany.id);
    const list = data || [];
    setAllTemplates(list);
    loadScope(list, templateType, scopeDivisionId,
      preferId !== undefined ? preferId : currentTemplateIdRef.current);
    return list;
  };

  // Load divisions + all templates when the company changes; reset to company-wide scope.
  useEffect(() => {
    if (!selectedCompany) return;
    let cancelled = false;
    (async () => {
      try {
        const [tplRes, divRes] = await Promise.all([
          getTemplatesByCompany(selectedCompany.id),
          getDivisionsByCompany(selectedCompany.id).catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const list = tplRes.data || [];
        const divs = divRes.data || [];
        setDivisions(divs);
        setAllTemplates(list);
        // Restore the last scope + template on a same-company reload; reset to
        // company-wide on a deliberate company switch (ref consumed after the
        // first company-load, and only honoured when the saved company matches).
        let scope = null, preferId = null;
        const r = initialRestoreRef.current;
        if (!r.consumed && r.companyId === selectedCompany.id) {
          if (r.scope != null && divs.some((d) => d.id === r.scope)) scope = r.scope;
          if (r.templateId) preferId = r.templateId;
        }
        r.consumed = true;
        setScopeDivisionId(scope);
        loadScope(list, templateType, scope, preferId);
      } catch {
        if (cancelled) return;
        initialRestoreRef.current.consumed = true;
        setDivisions([]);
        setAllTemplates([]);
        setScopeDivisionId(null);
        populateEditor(null, templateType);
      }
    })();
    return () => { cancelled = true; };
    // templateType intentionally omitted â€” type changes are handled by handleTypeChange
    // (no company refetch needed); only a company switch reloads the list here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany?.id]);

  // Switch template type without refetching the company list.
  const handleTypeChange = (newType) => {
    setTemplateType(newType);
    loadScope(allTemplates, newType, scopeDivisionId);
  };

  // Switch scope (company-wide / division) within the current type.
  const handleScopeChange = (rawValue) => {
    const divId = rawValue === "" || rawValue == null ? null : Number(rawValue);
    setScopeDivisionId(divId);
    loadScope(allTemplates, templateType, divId);
  };

  const handleSave = async () => {
    if (!selectedCompany) return;
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
          name: currentTemplateName, htmlContent: saveHtml, templateJson: saveJson, editorMode,
        });
        // Keep the cached copy fresh so re-opening it from the manager shows latest content.
        setAllTemplates((prev) => prev.map((t) =>
          t.id === currentTemplateId ? { ...t, htmlContent: saveHtml, templateJson: saveJson, editorMode } : t));
      } else {
        // Empty scope â†’ create the first template (server forces it default).
        const { data } = await createTemplate(selectedCompany.id, {
          templateType, divisionId: scopeDivisionId, name: currentTemplateName || "Default",
          htmlContent: saveHtml, templateJson: saveJson, editorMode, isDefault: true,
        });
        currentTemplateIdRef.current = data.id;
        setCurrentTemplateId(data.id);
        setCurrentTemplateName(data.name);
        setAllTemplates((prev) => [...prev.filter((t) => t.id !== data.id), data]);
      }

      setHtmlContent(saveHtml);
      setTemplateJson(saveJson);
      setOriginalContent(saveHtml);
      setOriginalJson(saveJson);
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

  // Starter pick â†’ create a NEW template in the current scope from the starter
  // design (server forces default only when it's the first in the scope).
  const handleSelectStarter = async (starter) => {
    if (!selectedCompany) return;
    setShowTemplatePicker(false);
    setManagerBusy(true);
    try {
      const { data } = await createTemplate(selectedCompany.id, {
        templateType, divisionId: scopeDivisionId, name: starter.name,
        htmlContent: starter.html, isDefault: false,
      });
      await refreshTemplates(data.id);
      showToast(`Created "${data.name}" from starter`);
    } catch {
      showToast("Failed to create template from starter", "error");
    } finally {
      setManagerBusy(false);
    }
  };

  // â”€â”€ Saved-templates manager actions â”€â”€

  // Switch the active template (from the header dropdown or the manager). Guards
  // unsaved edits, preserves the current Editor/Preview tab. Returns true if switched.
  const handleTemplateSelect = async (id) => {
    if (id === currentTemplateId) return true;
    const tpl = allTemplates.find((t) => t.id === id);
    if (!tpl) return false;
    const dirty = htmlContent !== originalContent || templateJson !== originalJson;
    if (dirty) {
      const ok = await confirm({
        title: "Switch template?",
        message: "You have unsaved changes that will be discarded if you switch.",
        variant: "warning",
        confirmText: "Discard & switch",
      });
      if (!ok) return false;
    }
    populateEditor(tpl, templateType, true);
    return true;
  };

  const handleManagerSelect = async (id) => {
    const switched = await handleTemplateSelect(id);
    if (switched) setShowManager(false);
  };

  const handleSetDefault = async (id) => {
    setManagerBusy(true);
    try {
      await setDefaultTemplate(id);
      await refreshTemplates(currentTemplateIdRef.current);
      showToast("Default template updated");
    } catch {
      showToast("Failed to set default", "error");
    } finally {
      setManagerBusy(false);
    }
  };

  const handleDuplicate = async (tpl) => {
    setManagerBusy(true);
    try {
      const { data } = await createTemplate(selectedCompany.id, {
        templateType, divisionId: scopeDivisionId, name: `${tpl.name} (copy)`,
        htmlContent: tpl.htmlContent, templateJson: tpl.templateJson, editorMode: tpl.editorMode,
        isDefault: false,
      });
      await refreshTemplates(data.id);
      showToast("Template duplicated");
    } catch {
      showToast("Failed to duplicate template", "error");
    } finally {
      setManagerBusy(false);
    }
  };

  const handleRename = async (id, name) => {
    setManagerBusy(true);
    try {
      const tpl = allTemplates.find((t) => t.id === id);
      await updateTemplateById(id, {
        name, htmlContent: tpl?.htmlContent ?? "", templateJson: tpl?.templateJson, editorMode: tpl?.editorMode,
      });
      if (id === currentTemplateIdRef.current) setCurrentTemplateName(name);
      await refreshTemplates(currentTemplateIdRef.current);
      showToast("Template renamed");
    } catch {
      showToast("Failed to rename template", "error");
    } finally {
      setManagerBusy(false);
    }
  };

  const handleManagerDelete = async (id) => {
    const ok = await confirm({ title: "Delete Template?", message: "Delete this saved template? This cannot be undone.", variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    setManagerBusy(true);
    try {
      await deleteTemplate(id);
      // If we deleted the open one, let the scope re-pick its default/first.
      const prefer = id === currentTemplateIdRef.current ? null : currentTemplateIdRef.current;
      await refreshTemplates(prefer);
      showToast("Template deleted");
    } catch {
      showToast("Failed to delete template", "error");
    } finally {
      setManagerBusy(false);
    }
  };

  const handleNewBlank = async (name) => {
    if (!selectedCompany) return;
    setManagerBusy(true);
    try {
      const { data } = await createTemplate(selectedCompany.id, {
        templateType, divisionId: scopeDivisionId, name,
        htmlContent: DEFAULT_TEMPLATES[templateType] || "", isDefault: false,
      });
      await refreshTemplates(data.id);
      setShowManager(false);
      showToast(`Created "${data.name}"`);
    } catch {
      showToast("Failed to create template", "error");
    } finally {
      setManagerBusy(false);
    }
  };

  const handleNewFromStarter = () => {
    setShowManager(false);
    setShowTemplatePicker(true);
  };

  // Upload the file as-is, no sheet pin. The vast majority of historical
  // challan exports are single-sheet, so forcing the operator to pick at
  // upload time would be friction for zero benefit. If the workbook has
  // multiple sheets, the post-upload dropdown on the Excel Template Bar
  // lets the operator pin a specific sheet â€” the importer's smart
  // resolver (sheet-name match â†’ score-based â†’ sheet 0) already handles
  // the common multi-sheet case automatically.
  const handleExcelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (excelInputRef.current) excelInputRef.current.value = "";
    if (!file || !selectedCompany) return;
    if (!currentTemplateId) {
      showToast("Save this template first, then upload an Excel template.", "error");
      return;
    }
    setExcelUploading(true);
    try {
      const { data } = await uploadExcelTemplateById(currentTemplateId, file, null);
      setHasExcel(true);
      setExcelSheetName(data.excelSheetName || null);
      setExcelSheetNames(data.excelSheetNames || []);
      setAllTemplates((prev) => prev.map((t) => t.id === currentTemplateId
        ? { ...t, hasExcelTemplate: true, excelSheetName: data.excelSheetName || null, excelSheetNames: data.excelSheetNames || [] }
        : t));
      const sheetCount = (data.excelSheetNames || []).length;
      if (sheetCount > 1) {
        showToast(`Excel template uploaded â€” ${sheetCount} sheets detected, pin one in the Data sheet dropdown if needed.`);
      } else {
        showToast("Excel template uploaded!");
      }
    } catch {
      showToast("Failed to upload Excel template", "error");
    } finally {
      setExcelUploading(false);
    }
  };

  // Save a new sheet pin against an already-uploaded template.
  const handleSheetChange = async (next) => {
    if (!currentTemplateId) return;
    const value = next || null;
    setSheetSaving(true);
    try {
      await setExcelSheetNameById(currentTemplateId, value);
      setExcelSheetName(value);
      showToast(value ? `Pinned sheet "${value}".` : "Sheet pin cleared â€” auto-detect on.");
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to update sheet name.", "error");
    } finally {
      setSheetSaving(false);
    }
  };

  const handleExcelDelete = async () => {
    if (!currentTemplateId) return;
    const ok = await confirm({ title: "Remove Excel Template?", message: "Remove the Excel template for this template? This cannot be undone.", variant: "danger", confirmText: "Remove" });
    if (!ok) return;
    try {
      await deleteExcelTemplateById(currentTemplateId);
      setHasExcel(false);
      setAllTemplates((prev) => prev.map((t) => t.id === currentTemplateId ? { ...t, hasExcelTemplate: false } : t));
      showToast("Excel template removed");
    } catch {
      showToast("Failed to remove Excel template", "error");
    }
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

  // Branding-enriched live preview via the shared builder (same merge the
  // gallery + apply-starter comparison use, so previews match everywhere).
  const previewHtml = (() => {
    const src = editorMode === "visual" && visualEditorRef.current
      ? visualEditorRef.current.getHtml()
      : htmlContent;
    const scopeDiv = scopeDivisionId != null
      ? divisions.find((d) => d.id === scopeDivisionId)
      : null;
    return buildTemplatePreviewHtml(templateType, src, { company: selectedCompany, division: scopeDiv });
  })();

  const hasChanges = htmlContent !== originalContent || templateJson !== originalJson;
  // fields is now fetched from API via useEffect above

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

  // Templates in the current (type, scope) â€” drives the Saved-Templates manager.
  const scopeTemplates = allTemplates.filter(
    (t) => t.templateType === templateType && (t.divisionId ?? null) === (scopeDivisionId ?? null)
  );
  const scopeLabel = scopeDivisionId == null
    ? "Company-wide"
    : (divisions.find((d) => d.id === scopeDivisionId)?.name || "Division");
  const templateTypeLabel = TEMPLATE_TYPES.find((t) => t.value === templateType)?.label || templateType;

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

      {/* Starter gallery — create a NEW template from a starter (manager's "From starter"). */}
      {showTemplatePicker && (
        <StarterGallery
          lockType={templateType}
          selectLabel="Create from this"
          onSelect={(starter) => { setShowTemplatePicker(false); handleSelectStarter(starter); }}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}

      {/* Apply a starter onto the CURRENTLY-OPEN template (replace HTML / everything). */}
      {showApplyStarter && currentTemplateId && (
        <ApplyStarterModal
          template={{
            id: currentTemplateId,
            name: currentTemplateName,
            templateType,
            htmlContent,
            divisionName: scopeDivisionId != null ? (divisions.find((d) => d.id === scopeDivisionId)?.name) : null,
          }}
          division={scopeDivisionId != null ? divisions.find((d) => d.id === scopeDivisionId) : null}
          onClose={() => setShowApplyStarter(false)}
          onApplied={async (updated) => {
            setShowApplyStarter(false);
            await refreshTemplates(updated.id);
            populateEditor(updated, updated.templateType, false);
          }}
        />
      )}

      {/* Saved Templates Manager */}
      {showManager && (
        <SavedTemplatesManager
          templateTypeLabel={templateTypeLabel}
          scopeLabel={scopeLabel}
          templates={scopeTemplates}
          currentTemplateId={currentTemplateId}
          canDelete={canDelete}
          busy={managerBusy}
          onSelect={handleManagerSelect}
          onSetDefault={handleSetDefault}
          onDuplicate={handleDuplicate}
          onRename={handleRename}
          onDelete={handleManagerDelete}
          onNewBlank={handleNewBlank}
          onNewFromStarter={handleNewFromStarter}
          onClose={() => setShowManager(false)}
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
            <MdArrowBack size={16} /> {isMobile ? "" : "Templates"}
          </button>
          <div style={{ ...styles.headerIcon, ...(isMobile ? { width: 34, height: 34, borderRadius: 8 } : {}) }}>
            <MdCode size={isMobile ? 18 : 24} color="#fff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: isMobile ? "1rem" : "1.3rem", fontWeight: 700, color: colors.textPrimary }}>
              Template Editor
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
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <MdBusiness size={16} color={colors.blue} style={{ flexShrink: 0 }} />
                <select
                  style={{ ...dropdownStyles.base, minWidth: 0, flex: 1, fontSize: "0.82rem" }}
                  value={selectedCompany?.id || ""}
                  onChange={(e) => setSelectedCompany(companies.find(c => c.id === parseInt(e.target.value)))}
                >
                  {companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
              <div style={{ ...styles.fieldGroup, flex: 1, minWidth: 0 }}>
                <label style={styles.fieldLabel}>Document Type</label>
                <select
                  style={{ ...dropdownStyles.base, minWidth: 0, width: "100%", fontSize: "0.82rem" }}
                  value={templateType}
                  onChange={(e) => handleTypeChange(e.target.value)}
                >
                  {TEMPLATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              {divisions.length > 0 && (
                <div style={{ ...styles.fieldGroup, flex: 1, minWidth: 0 }}>
                  <label style={styles.fieldLabel}>Scope</label>
                  <select
                    style={{ ...dropdownStyles.base, minWidth: 0, width: "100%", fontSize: "0.82rem" }}
                    value={scopeDivisionId ?? ""}
                    onChange={(e) => handleScopeChange(e.target.value)}
                    title="Template scope"
                  >
                    <option value="">Company-wide</option>
                    {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Template</label>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <MdDescription size={15} color={colors.blue} style={{ flexShrink: 0 }} />
                <select
                  style={{ ...dropdownStyles.base, minWidth: 0, flex: 1, fontSize: "0.82rem" }}
                  value={currentTemplateId ?? ""}
                  onChange={(e) => { if (e.target.value) handleTemplateSelect(Number(e.target.value)); }}
                  disabled={scopeTemplates.length === 0}
                  title="Saved template"
                >
                  {scopeTemplates.length === 0 && <option value="">New template (unsaved)</option>}
                  {scopeTemplates.map((t) => <option key={t.id} value={t.id}>{t.isDefault ? `â˜… ${t.name}` : t.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button style={{ ...styles.btn, ...styles.btnOutline, padding: "0.4rem 0.6rem", fontSize: "0.78rem", flex: 1, justifyContent: "center" }} onClick={() => setShowManager(true)} title="Saved templates">
                <MdContentCopy size={14} /> Templates
              </button>
              {canApplyStarter && currentTemplateId && (
                <button style={{ ...styles.btn, ...styles.btnOutline, padding: "0.4rem 0.6rem", fontSize: "0.78rem", flexShrink: 0 }} onClick={() => setShowApplyStarter(true)} title="Apply a starter design onto this template">
                  <MdBrush size={14} /> Starter
                </button>
              )}
              <button style={{ ...styles.btn, ...styles.btnOutline, padding: "0.4rem 0.6rem", fontSize: "0.78rem", flexShrink: 0 }} onClick={handleReset} title="Reset to default">
                <MdRefresh size={14} /> Reset
              </button>
              <button
                style={{ ...styles.btn, ...styles.btnPrimary, opacity: saving ? 0.7 : 1, padding: "0.4rem 0.6rem", fontSize: "0.78rem", flexShrink: 0 }}
                onClick={handleSave}
                disabled={saving}
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
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <MdBusiness size={18} color={colors.blue} style={{ flexShrink: 0 }} />
                <select
                  style={{ ...dropdownStyles.base, minWidth: "180px" }}
                  value={selectedCompany?.id || ""}
                  onChange={(e) => setSelectedCompany(companies.find(c => c.id === parseInt(e.target.value)))}
                >
                  {companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
                </select>
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Document Type</label>
              <select
                style={{ ...dropdownStyles.base, minWidth: "180px" }}
                value={templateType}
                onChange={(e) => handleTypeChange(e.target.value)}
              >
                {TEMPLATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {divisions.length > 0 && (
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>Scope</label>
                <select
                  style={{ ...dropdownStyles.base, minWidth: "170px" }}
                  value={scopeDivisionId ?? ""}
                  onChange={(e) => handleScopeChange(e.target.value)}
                  title="Template scope â€” Company-wide or a specific division"
                >
                  <option value="">Company-wide</option>
                  {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Template</label>
              {/* Saved-template selector â€” switch which template is loaded for preview/edit */}
              <select
                style={{ ...dropdownStyles.base, minWidth: "190px" }}
                value={currentTemplateId ?? ""}
                onChange={(e) => { if (e.target.value) handleTemplateSelect(Number(e.target.value)); }}
                disabled={scopeTemplates.length === 0}
                title="Saved template â€” switch to preview / edit another"
              >
                {scopeTemplates.length === 0 && <option value="">New template (unsaved)</option>}
                {scopeTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.isDefault ? `â˜… ${t.name}` : t.name}</option>
                ))}
              </select>
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

            <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={() => setShowManager(true)} title="Saved templates for this type & scope">
              <MdContentCopy size={16} /> Templates
            </button>
            {canApplyStarter && currentTemplateId && (
              <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={() => setShowApplyStarter(true)} title="Apply a starter design onto this template">
                <MdBrush size={16} /> Import Starter
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
              style={{ ...styles.btn, ...styles.btnPrimary, opacity: saving ? 0.7 : 1 }}
              onClick={handleSave}
              disabled={saving}
            >
              <MdSave size={16} /> {saving ? "Saving..." : "Save"}
            </button>
            {hasChanges && <span style={{ fontSize: "0.78rem", color: "#e65100", fontWeight: 600 }}>Unsaved changes</span>}
          </div>
        )}
      </div>

      {/* Excel Template Bar */}
      {selectedCompany && (
        <div style={styles.excelBar}>
          <MdGridOn size={16} color={colors.teal} />
          <span style={{ fontSize: "0.82rem", fontWeight: 600, color: colors.textPrimary }}>
            Excel Template:
          </span>
          {hasExcel ? (
            <>
              <span style={styles.excelBadge}>Uploaded</span>
              {canSheetPin && excelSheetNames && excelSheetNames.length > 0 && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.78rem", color: "#5f6d7e" }}>
                  Data sheet:
                  <select
                    style={{ ...dropdownStyles.base, padding: "0.3rem 0.55rem", fontSize: "0.78rem", minWidth: 160 }}
                    value={excelSheetName || ""}
                    disabled={sheetSaving}
                    onChange={(e) => handleSheetChange(e.target.value)}
                    title={excelSheetNames.length === 1
                      ? "Single-sheet template â€” Auto-detect handles this case. You can still pin the sheet name if your import files use a different layout."
                      : "Pin the sheet that holds the data on every uploaded file. Leave 'Auto-detect' to let the importer choose."}
                  >
                    <option value="">
                      Auto-detect{excelSheetNames.length === 1 ? ` (${excelSheetNames[0]})` : ""}
                    </option>
                    {excelSheetNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
              )}
              <button style={{ ...styles.btn, ...styles.btnDanger, padding: "0.3rem 0.6rem", fontSize: "0.78rem" }} onClick={handleExcelDelete}>
                <MdDelete size={14} /> Remove
              </button>
              <button
                style={{ ...styles.btn, ...styles.btnOutline, padding: "0.3rem 0.6rem", fontSize: "0.78rem" }}
                onClick={() => excelInputRef.current?.click()}
                disabled={excelUploading}
              >
                <MdUploadFile size={14} /> Replace
              </button>
            </>
          ) : (
            <>
              <span style={{ fontSize: "0.8rem", color: colors.textSecondary }}>
                No Excel template â€” Excel export button hidden on challan/invoice pages
              </span>
              <button
                style={{ ...styles.btn, ...styles.btnOutline, padding: "0.3rem 0.6rem", fontSize: "0.78rem" }}
                onClick={() => excelInputRef.current?.click()}
                disabled={excelUploading}
              >
                <MdUploadFile size={14} /> {excelUploading ? "Uploading..." : "Upload .xlsx"}
              </button>
            </>
          )}
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xlsm"
            style={{ display: "none" }}
            onChange={handleExcelUpload}
          />
        </div>
      )}

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
  // Labeled dropdown groups in the toolbar â€” a small caption above each
  // <select> so it's obvious what each control selects.
  fieldGroup: { display: "flex", flexDirection: "column", gap: "0.18rem" },
  fieldLabel: {
    fontSize: "0.64rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.05em", color: "#7a8696", paddingLeft: "0.15rem",
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
    borderBottom: `2px solid ${colors.blue}`,
    background: "#fff",
  },
  tabCopy: {
    marginLeft: "auto",
    fontSize: "0.8rem",
    color: colors.textSecondary,
  },
  excelBar: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.45rem 1.25rem",
    background: "#f0f7f4",
    borderBottom: `1px solid ${colors.cardBorder}`,
    flexWrap: "wrap",
  },
  excelBadge: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "0.72rem",
    fontWeight: 700,
    padding: "0.15rem 0.55rem",
    borderRadius: 12,
    background: "#e8f5e9",
    color: "#2e7d32",
    border: "1px solid #2e7d3230",
    textTransform: "uppercase",
  },
  btnDanger: {
    background: "#fff",
    color: "#c62828",
    border: "1px solid #c6282830",
  },
};
