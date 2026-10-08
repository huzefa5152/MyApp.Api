import useIsNarrow from "../hooks/useIsNarrow";
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  MdCode, MdBusiness, MdSave, MdRefresh, MdContentCopy,
  MdVisibility, MdEdit as MdEditIcon, MdBrush,
  MdUploadFile, MdArrowBack, MdLock, MdAutoAwesome, MdStar, MdViewList,
} from "react-icons/md";
import {
  getTemplateById, createTemplate, updateTemplateById, getMergeFields,
  getTemplatesByCompany, setDefaultTemplate, deleteTemplate,
} from "../api/printTemplateApi";
import { useCompany } from "../contexts/CompanyContext";
import { mergeTemplate, MERGE_FIELDS } from "../utils/templateEngine";
import {
  TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL, SAMPLE_DATA, DEFAULT_TEMPLATES,
} from "../utils/templateSampleData";
import { Button, EmptyState, Loading } from "../ui/Kit";
import CodeEditor from "../Components/templateEditor/CodeEditor";
import MergeFieldSidebar from "../Components/templateEditor/MergeFieldSidebar";
import StampPicker from "../Components/templateEditor/StampPicker";
import { signatureAreas, currentStampArea, positionStamp } from "../utils/stampPlacement";
import {
  STAMP_STATE, detectStampState, injectSignatureBlock, convertPinnedToSlot, pinnedSlugs,
  firstEmbeddedImage, replaceEmbeddedImageWithSlot, materializeStamp,
} from "../utils/stampSlot";
import { setTemplateStamp } from "../api/printTemplateApi";
import PreviewPane from "../Components/templateEditor/PreviewPane";
import SyncWarningModal from "../Components/templateEditor/SyncWarningModal";
import VisualEditor from "../Components/templateEditor/VisualEditor";
import StarterGallery from "../Components/templateEditor/StarterGallery";
import SavedTemplatesManager from "../Components/templateEditor/SavedTemplatesManager";
import NewTemplateDialog, { uniqueTemplateName } from "../Components/templateEditor/NewTemplateDialog";
import { markRecentTemplate } from "../utils/templateEditorNav";
import { useConfirm } from "../Components/ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";

// The type's default template, else its oldest, else nothing.
const pickForType = (list, type) => {
  const ofType = list.filter((t) => t.templateType === type).sort((a, b) => a.id - b.id);
  return ofType.find((t) => t.isDefault) || ofType[0] || null;
};

export default function TemplateEditorPage() {
  const isMobile = useIsNarrow(768);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { has } = usePermissions();
  const canManage = has("printtemplates.manage.update");
  const canDelete = has("printtemplates.manage.delete");
  const { companies, selectedCompany, setSelectedCompany, loading, companyStamps } = useCompany();

  // ── Entry contract (set by PrintTemplatesPage before navigating here) ──
  //   te.type       — the document type to open (e.g. "Challan").
  //   te.companyId  — the owning company id (string).
  //   te.templateId — the template to EDIT; absent (or gone) means open the
  //                   type's default, or a built-in draft if the type has none.
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
  // Current saved template id (null while a draft — a type with no saved
  // template yet — is open and not yet saved).
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
  // Stamp assignment lives on the template row, not in the HTML — so it is
  // tracked separately from the editor buffer and saved on its own.
  const [stampId, setStampId] = useState(null);
  const [stampSaving, setStampSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [showSyncWarning, setShowSyncWarning] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showManager, setShowManager] = useState(false);
  const [newDialog, setNewDialog] = useState(false);
  // EVERY template of the company, all types — so switching document type in
  // the toolbar is a filter, not a refetch. The list carries each body, which
  // is what makes switching templates instant.
  const [allTemplates, setAllTemplates] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerBusyId, setManagerBusyId] = useState(null);
  const [fields, setFields] = useState([]);
  const htmlImportRef = useRef(null);
  const codeEditorRef = useRef(null);
  const visualEditorRef = useRef(null);
  // Guards the one-shot entry resolution so StrictMode's double-invoke and a
  // later list refresh can't re-run it.
  const initedRef = useRef(false);
  // Mirrors currentTemplateId for async callbacks that must not go stale.
  const currentIdRef = useRef(null);

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
        const catalog = data.map(f => ({
          field: f.fieldExpression,
          label: f.label,
          category: f.category,
        }));
        // These additive print fields ship with the print DTO; expose them even
        // when the production merge-field catalog predates this release.
        if (templateType === "Bill" || templateType === "TaxInvoice") {
          for (const field of MERGE_FIELDS[templateType]) {
            if (!catalog.some(f => f.field === field.field)) catalog.push({ ...field, category: /fbr/i.test(field.field) ? "FBR" : templateType });
          }
        }
        setFields(catalog);
      } catch {
        setFields(MERGE_FIELDS[templateType] || []);
      }
    })();
  }, [templateType]);

  // Load a template DTO into the editor as a clean (not-dirty) baseline.
  const loadIntoEditor = (dto, { keepTab = false } = {}) => {
    currentIdRef.current = dto.id;
    setTemplateType(dto.templateType || templateType);
    setCurrentTemplateId(dto.id);
    setStampId(dto.stampId ?? null);
    setTemplateName(dto.name || "");
    setOriginalName(dto.name || "");
    setHtmlContent(dto.htmlContent || "");
    setOriginalContent(dto.htmlContent || "");
    setTemplateJson(dto.templateJson || null);
    setOriginalJson(dto.templateJson || null);
    setEditorMode(dto.editorMode || "code");
    setStampId(dto.stampId ?? null);
    try {
      localStorage.setItem("te.type", dto.templateType || templateType);
      localStorage.setItem("te.templateId", String(dto.id));
    } catch { /* ignore */ }
    // The list page lands on this card when the operator goes back.
    markRecentTemplate(dto.id);
    if (!keepTab) setActiveTab("editor");
  };

  // A type with no saved template: show its built-in default as an unsaved
  // draft, already named, so the first Save creates it (the server makes the
  // first template of a type the default).
  const seedDraft = (type) => {
    currentIdRef.current = null;
    setTemplateType(type);
    setCurrentTemplateId(null);
    setTemplateName(TEMPLATE_TYPE_LABEL[type] || type);
    setOriginalName("");
    setHtmlContent(DEFAULT_TEMPLATES[type] || "");
    setOriginalContent("");
    setTemplateJson(null);
    setOriginalJson(null);
    setEditorMode("code");
    setStampId(null);
    try { localStorage.setItem("te.type", type); localStorage.removeItem("te.templateId"); } catch { /* ignore */ }
    setActiveTab("editor");
  };

  // Open whatever a type should show: a specific template if asked, else its
  // default, else a draft.
  const openType = (list, type, preferId = null) => {
    const wanted = preferId != null ? list.find((t) => t.id === preferId && t.templateType === type) : null;
    const pick = wanted || pickForType(list, type);
    if (pick) loadIntoEditor(pick); else seedDraft(type);
  };

  // The company's templates, loaded once per company. The first load also
  // resolves the entry contract — but only once the company the list page
  // pointed at is the selected one, otherwise the wrong company's templates
  // would decide what opens.
  useEffect(() => {
    if (!selectedCompany || !companies.length) return;
    const targetExists = !entry.companyId || companies.some((c) => c.id === entry.companyId);
    if (targetExists && entry.companyId && selectedCompany.id !== entry.companyId) return; // still switching
    let cancelled = false;
    setListLoading(true);
    (async () => {
      try {
        const { data } = await getTemplatesByCompany(selectedCompany.id);
        if (cancelled) return;
        const list = data || [];
        setAllTemplates(list);
        if (!initedRef.current) {
          initedRef.current = true;
          openType(list, entry.type, entry.templateId);
        }
      } catch {
        if (cancelled) return;
        setAllTemplates([]);
        if (!initedRef.current) { initedRef.current = true; seedDraft(entry.type); }
        showToast("Failed to load templates", "error");
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany?.id, companies.length]);

  // Reload the list; optionally re-load one template as the clean baseline.
  const refreshTemplates = async (preferId) => {
    if (!selectedCompany) return [];
    const { data } = await getTemplatesByCompany(selectedCompany.id);
    const list = data || [];
    setAllTemplates(list);
    if (preferId != null) {
      const found = list.find((t) => t.id === preferId);
      if (found) loadIntoEditor(found, { keepTab: true });
    }
    return list;
  };

  const hasChanges =
    htmlContent !== originalContent ||
    templateJson !== originalJson ||
    templateName.trim() !== originalName;

  // Every path that replaces the buffer asks first when it holds unsaved work.
  const confirmDiscard = async () => {
    if (!hasChanges) return true;
    return confirm({ title: "Discard changes?", message: "You have unsaved changes. Leave this template and discard them?", variant: "danger", confirmText: "Discard" });
  };

  // Switch document type. The dropdown is a navigator: it opens that type's
  // default template (or a built-in draft when the type has none), so every
  // document type is one pick away instead of a round trip through the list.
  // A saved template's own type never changes — merge fields differ per type,
  // and "Copy to…" is how a design is reused for another document.
  const handleTypeChange = async (newType) => {
    if (!newType || newType === templateType) return;
    if (!(await confirmDiscard())) return;
    openType(allTemplates, newType);
  };

  // Quick-switch dropdown (toolbar): pick a saved template id, or "__new__".
  const handleSwitchTemplate = async (v) => {
    const current = currentTemplateId ? String(currentTemplateId) : "__draft__";
    if (v === current) return;
    if (v === "__new__") { openNew(); return; }
    if (!(await confirmDiscard())) return;
    const t = allTemplates.find((x) => String(x.id) === v);
    if (t) loadIntoEditor(t, { keepTab: true });
  };

  const openNew = async () => {
    if (!(await confirmDiscard())) return;
    setShowManager(false);
    setNewDialog(true);
  };
  const onCreated = async (dto) => {
    setNewDialog(false);
    await refreshTemplates();
    loadIntoEditor(dto);
    showToast(`Created "${dto.name}"`);
  };

  // ── Manager actions ──
  const handleManagerSelect = async (id) => {
    if (id === currentTemplateId) { setShowManager(false); return; }
    if (!(await confirmDiscard())) return;
    const t = allTemplates.find((x) => x.id === id);
    if (t) { loadIntoEditor(t, { keepTab: true }); setShowManager(false); }
  };

  const runManager = async (id, work, okMsg, failMsg) => {
    setManagerBusyId(id);
    setManagerBusy(true);
    try { await work(); if (okMsg) showToast(okMsg); }
    catch (err) { showToast(err?.response?.data?.error || failMsg, "error"); }
    finally { setManagerBusy(false); setManagerBusyId(null); }
  };

  const handleSetDefault = (id) => runManager(id, async () => {
    await setDefaultTemplate(id);
    await refreshTemplates();
  }, "Default template updated", "Failed to set default");

  const handleDuplicate = (t) => runManager(t.id, async () => {
    if (!(await confirmDiscard())) return;
    const { data } = await createTemplate(selectedCompany.id, {
      templateType: t.templateType, name: uniqueTemplateName(`${t.name} (copy)`, allTemplates),
      htmlContent: t.htmlContent, templateJson: t.templateJson, editorMode: t.editorMode,
      isDefault: false, stampId: t.stampId ?? null,
    });
    await refreshTemplates();
    loadIntoEditor(data);
    setShowManager(false);
    showToast(`Duplicated as "${data.name}"`);
  }, null, "Failed to duplicate template");

  // Rename writes name + the SAVED body back together (the update endpoint
  // takes both), read fresh by id so a rename can never blank the HTML or
  // save the editor's half-finished edits by accident.
  const handleRename = (id, name) => runManager(id, async () => {
    const { data: full } = await getTemplateById(id);
    await updateTemplateById(id, { name, htmlContent: full.htmlContent, templateJson: full.templateJson, editorMode: full.editorMode });
    setAllTemplates((list) => list.map((t) => (t.id === id ? { ...t, name } : t)));
    if (id === currentIdRef.current) { setTemplateName(name); setOriginalName(name); }
  }, "Template renamed", "Failed to rename template");

  const handleCopyToType = (t, targetType) => runManager(t.id, async () => {
    if (!(await confirmDiscard())) return;
    const { data } = await createTemplate(selectedCompany.id, {
      templateType: targetType,
      name: uniqueTemplateName(`${t.name} → ${TEMPLATE_TYPE_LABEL[targetType]}`, allTemplates),
      htmlContent: t.htmlContent, templateJson: t.templateJson, editorMode: t.editorMode,
      isDefault: false, stampId: t.stampId ?? null,
    });
    await refreshTemplates();
    loadIntoEditor(data);
    setShowManager(false);
    showToast(`Copied to ${TEMPLATE_TYPE_LABEL[targetType]} — adjust the merge fields for the new document type`);
  }, null, "Failed to copy template");

  const handleManagerDelete = async (t) => {
    const ok = await confirm({
      title: "Delete Template?",
      message: `Delete "${t.name}" (${TEMPLATE_TYPE_LABEL[t.templateType]})? This cannot be undone.`,
      variant: "danger", confirmText: "Delete",
    });
    if (!ok) return;
    await runManager(t.id, async () => {
      await deleteTemplate(t.id);
      const list = await refreshTemplates();
      // Deleted the open one: fall to the type's default, or a draft.
      if (t.id === currentIdRef.current) openType(list, templateType);
    }, "Template deleted", "Failed to delete template");
  };

  const handleSave = async () => {
    const name = templateName.trim() || (TEMPLATE_TYPE_LABEL[templateType] || templateType);
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
        // The content update deliberately leaves the assignment alone; push it
        // here so an "Add signature block" / "Make changeable" edit that was
        // only staged in the buffer lands together with the HTML that needs it.
        await setTemplateStamp(currentTemplateId, stampId);
      } else {
        const companyId = selectedCompany?.id ?? entry.companyId;
        if (!companyId) {
          showToast("No company selected", "error");
          setSaving(false);
          return;
        }
        const { data } = await createTemplate(companyId, {
          templateType, name, htmlContent: saveHtml, templateJson: saveJson,
          editorMode, isDefault: false, stampId,
        });
        // Switch into "editing that id" mode so subsequent saves update it.
        currentIdRef.current = data.id;
        setCurrentTemplateId(data.id);
        try { localStorage.setItem("te.templateId", String(data.id)); } catch { /* ignore */ }
        markRecentTemplate(data.id);
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

  // Which stamp mechanism the buffer currently uses. Derived from the live
  // editor text, so adding or removing a slot by hand updates the control.
  const stampState = detectStampState(htmlContent);
  const stampAreas = signatureAreas(htmlContent);

  const handleStampPosition = (areaId) => {
    const source = editorMode === "visual" && visualEditorRef.current
      ? visualEditorRef.current.getHtml() : htmlContent;
    const result = positionStamp(source, areaId);
    if (!result.changed) { showToast("Choose a signature label in this template", "error"); return; }
    setHtmlContent(result.html);
    if (editorMode === "visual" && visualEditorRef.current) {
      visualEditorRef.current.replaceHtml(result.html);
      setTemplateJson(JSON.stringify(visualEditorRef.current.getProjectData()));
    } else setTemplateJson(null);
    showToast("Stamp position updated — save the template to keep it");
  };

  // Assignment persists immediately when the template already exists; on an
  // unsaved draft it is held locally and written by handleSave.
  const handleEditorStampChange = async (id) => {
    const previousId = stampId;
    setStampId(id);
    if (!currentTemplateId) return;
    setStampSaving(true);
    try { await setTemplateStamp(currentTemplateId, id); }
    catch { setStampId(previousId); showToast("Failed to update signature", "error"); }
    finally { setStampSaving(false); }
  };

  const handleEditorAddBlock = () => {
    const { html, anchor, changed } = injectSignatureBlock(htmlContent);
    if (!changed) { showToast("Template already has a signature block"); return; }
    setHtmlContent(html);
    setEditorMode("code");
    setActiveTab("editor");
    showToast(anchor === "appended"
      ? "No signature row found — block added at the end"
      : "Signature block added");
  };

  const handleEditorConvert = () => {
    const slug = pinnedSlugs(htmlContent)[0];
    if (!slug) return;
    setHtmlContent(convertPinnedToSlot(htmlContent, slug));
    setTemplateJson(null);
    setEditorMode("code");
    const match = companyStamps.find((s) => s.slug === slug);
    if (match) setStampId(match.id);
    showToast("Signature is now changeable — remember to save");
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
      let imported = content;

      // Imported markup usually predates stamps: it either embeds the
      // signature as base64 (the very bloat stamps exist to remove) or has no
      // signature slot at all. Offer to fix it now, while the operator is
      // looking at the result — otherwise every import walks the problem back in.
      const embedded = firstEmbeddedImage(imported);
      if (embedded && companyStamps.length > 0) {
        const useStamp = await confirm({
          title: "Replace embedded image with a stamp?",
          message: "This file embeds an image directly in its HTML, which makes the template "
            + "very large and impossible to reuse. Swap it for one of your uploaded stamps?",
          confirmText: "Use a stamp",
        });
        if (useStamp) imported = replaceEmbeddedImageWithSlot(imported);
      }
      if (detectStampState(imported) === STAMP_STATE.NONE) {
        const addBlock = await confirm({
          title: "Add a signature block?",
          message: "This template has no signature slot. Add one so you can pick which stamp it shows?",
          confirmText: "Add block",
        });
        if (addBlock) {
          const res = injectSignatureBlock(imported);
          if (res.changed) imported = res.html;
        }
      }

      setHtmlContent(imported);
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
      // Resolve {{stamp}} exactly the way printing does, so the preview shows
      // the signature the document will actually carry — a preview that
      // renders through a different path is a preview you cannot trust.
      const stamped = materializeStamp(
        src,
        companyStamps.find((s) => s.id === stampId)?.url || null
      );
      return mergeTemplate(stamped, SAMPLE_DATA[templateType]);
    } catch (e) {
      return `<div style="color:red;padding:20px;font-family:sans-serif"><h3>Template Error</h3><pre>${e.message}</pre></div>`;
    }
  })();

  const typeLabel = TEMPLATE_TYPE_LABEL[templateType] || templateType;
  const ofType = allTemplates.filter((t) => t.templateType === templateType).sort((a, b) => (b.isDefault - a.isDefault) || a.id - b.id);
  // Is the template currently open already the default for its type?
  const currentIsDefault = !!ofType.find((t) => t.id === currentTemplateId)?.isDefault;
  const isDraft = !currentTemplateId;

  if (!canManage) {
    return (
      <EmptyState icon={MdLock} title="Access denied">
        You don&apos;t have permission to edit print templates.
      </EmptyState>
    );
  }

  if (loading) {
    return <Loading>Loading...</Loading>;
  }

  if (companies.length === 0) {
    return <EmptyState icon={MdBusiness} boxed={false}>No companies available. Add a company first.</EmptyState>;
  }



  // Toolbar pieces shared by the phone and desktop layouts.
  const typeSelect = (style) => (
    <select
      className="k-select"
      style={style}
      value={templateType}
      onChange={(e) => handleTypeChange(e.target.value)}
      disabled={listLoading || managerBusy}
      title="Open another document type's template"
      aria-label="Document type"
    >
      {TEMPLATE_TYPES.map((t) => {
        const n = allTemplates.filter((x) => x.templateType === t.value).length;
        return <option key={t.value} value={t.value}>{t.label}{n ? ` (${n})` : ""}</option>;
      })}
    </select>
  );
  const templateSelect = (style) => (
    <select
      className="k-select"
      style={style}
      value={currentTemplateId ? String(currentTemplateId) : "__draft__"}
      onChange={(e) => handleSwitchTemplate(e.target.value)}
      disabled={listLoading || managerBusy}
      title="Switch between this document type's saved templates, or start a new one"
      aria-label="Saved template"
    >
      {isDraft && <option value="__draft__">Built-in default (unsaved)</option>}
      {ofType.map((t) => (
        <option key={t.id} value={String(t.id)}>{t.isDefault ? `★ ${t.name}` : t.name}</option>
      ))}
      <option value="__new__">➕ New template…</option>
    </select>
  );

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
        }} role="status">
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

      {/* Everything about this type's templates, without leaving the editor. */}
      {showManager && (
        <SavedTemplatesManager
          templateType={templateType}
          templates={ofType}
          currentTemplateId={currentTemplateId}
          canDelete={canDelete}
          busy={managerBusy}
          busyId={managerBusyId}
          onSelect={handleManagerSelect}
          onSetDefault={handleSetDefault}
          onDuplicate={handleDuplicate}
          onRename={handleRename}
          onCopyToType={handleCopyToType}
          onDelete={handleManagerDelete}
          onNew={openNew}
          onClose={() => setShowManager(false)}
        />
      )}

      {newDialog && selectedCompany && (
        <NewTemplateDialog
          companyId={selectedCompany.id}
          templates={allTemplates}
          initialType={templateType}
          onCreated={onCreated}
          onClose={() => setNewDialog(false)}
        />
      )}

      {/* Top Bar */}
      <div style={styles.topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
          <Button
            size="sm"
            icon={MdArrowBack}
            onClick={() => navigate("/templates")}
            title="Back to Print Templates"
            aria-label="Back to Print Templates"
            style={{ flexShrink: 0 }}
          >
            {isMobile ? "" : "Print Templates"}
          </Button>
          <span className="k-header__icon k-tone-brand" aria-hidden="true"><MdCode /></span>
          <div style={{ minWidth: 0 }}>
            <h2 className="k-header__title" style={{ fontSize: isMobile ? "1rem" : "calc(var(--k-title) * 0.87)" }}>
              {isDraft ? `New ${typeLabel}` : "Edit Template"}
            </h2>
            {!isMobile && (
              <p className="k-header__sub" style={{ margin: 0 }}>
                {isDraft
                  ? `${typeLabel} has no saved template yet — this is the built-in default. Save to keep it.`
                  : "Customize print templates for each company"}
              </p>
            )}
          </div>
        </div>

        {isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", width: "100%" }}>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Company</label>
              <div style={styles.readonlyValue}>
                <MdBusiness size={16} color="var(--k-blue)" style={{ flexShrink: 0 }} />
                <span>{selectedCompany?.brandName || selectedCompany?.name || "—"}</span>
              </div>
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Document Type</label>
              {typeSelect({ width: "100%" })}
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Saved Templates</label>
              {templateSelect({ width: "100%" })}
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Template Name</label>
              <input
                type="text"
                className="k-input"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Name this template…"
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <Button size="sm" icon={MdViewList} style={{ flex: 1 }} onClick={() => setShowManager(true)} title="Manage this document type's templates">
                Templates
              </Button>
              <Button size="sm" icon={MdAutoAwesome} style={{ flex: 1 }} onClick={() => setShowTemplatePicker(true)} title="Browse designed layouts and apply one">
                Designs
              </Button>
              {currentTemplateId && !currentIsDefault && (
                <Button size="sm" icon={MdStar} onClick={() => handleSetDefault(currentTemplateId)} disabled={managerBusy} title="Make this the default template used for printing this document type">
                  Set default
                </Button>
              )}
              <Button size="sm" icon={MdRefresh} onClick={handleReset} title="Reset to default">
                Reset
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={MdSave}
                onClick={handleSave}
                disabled={saving || !templateName.trim()}
              >
                {saving ? "..." : "Save"}
              </Button>
            </div>
            {hasChanges && <span style={styles.unsaved}>Unsaved changes</span>}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Company</label>
              <div style={styles.readonlyValue}>
                <MdBusiness size={18} color="var(--k-blue)" style={{ flexShrink: 0 }} />
                <span>{selectedCompany?.brandName || selectedCompany?.name || "—"}</span>
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Document Type</label>
              {typeSelect({ width: "auto", minWidth: "180px" })}
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Saved Templates</label>
              {templateSelect({ width: "auto", minWidth: "200px" })}
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Template Name</label>
              <input
                type="text"
                className="k-input"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Name this template…"
                style={{ width: "auto", minWidth: "200px" }}
              />
            </div>

            {/* Mode Toggle */}
            <div style={styles.modeToggle} role="group" aria-label="Editor mode">
              <button
                type="button"
                style={{ ...styles.modeBtn, ...(editorMode === "code" ? styles.modeBtnActive : {}) }}
                onClick={() => handleModeSwitch("code")}
                title="Code Editor"
                aria-pressed={editorMode === "code"}
              >
                <MdCode size={16} /> Code
              </button>
              <button
                type="button"
                style={{ ...styles.modeBtn, ...(editorMode === "visual" ? styles.modeBtnActive : {}) }}
                onClick={() => handleModeSwitch("visual")}
                title="Visual Builder"
                aria-pressed={editorMode === "visual"}
              >
                <MdBrush size={16} /> Visual
              </button>
            </div>

            <Button icon={MdViewList} onClick={() => setShowManager(true)} title="Open, rename, duplicate, copy, delete or create this document type's templates">
              Templates{ofType.length ? ` (${ofType.length})` : ""}
            </Button>
            <Button icon={MdAutoAwesome} onClick={() => setShowTemplatePicker(true)} title="Browse designed layouts and apply one">
              Design Gallery
            </Button>
            {currentTemplateId && !currentIsDefault && (
              <Button icon={MdStar} onClick={() => handleSetDefault(currentTemplateId)} disabled={managerBusy} title="Make this the default template used for printing this document type">
                Set as default
              </Button>
            )}
            <Button icon={MdUploadFile} onClick={() => htmlImportRef.current?.click()} title="Import HTML file">
              Import HTML
            </Button>
            <input
              ref={htmlImportRef}
              type="file"
              accept=".html,.htm"
              style={{ display: "none" }}
              onChange={handleImportHtml}
            />
            <Button icon={MdRefresh} onClick={handleReset} title="Reset to default">
              Reset
            </Button>
            <Button
              variant="primary"
              icon={MdSave}
              onClick={handleSave}
              disabled={saving || !templateName.trim()}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            {hasChanges && <span style={styles.unsaved}>Unsaved changes</span>}
          </div>
        )}
      </div>

      <div style={styles.stampBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", minWidth: 0 }}>
          <span style={{ fontSize: "var(--k-font-sm)", fontWeight: 600, color: "var(--k-ink)" }}>Signature stamp</span>
          <StampPicker stamps={companyStamps} value={stampId} state={stampState}
            pinnedSlug={pinnedSlugs(htmlContent)[0]} busy={stampSaving || saving}
            onChange={handleEditorStampChange} onAddBlock={handleEditorAddBlock} onConvert={handleEditorConvert} />
        </div>
        {stampAreas.length > 0 && stampState !== STAMP_STATE.PINNED && (
          <label style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", fontSize: "var(--k-font-sm)", color: "var(--k-ink)" }}>
            Stamp position
            <select className="k-select" aria-label="Stamp position" value={currentStampArea(htmlContent)}
              disabled={saving || stampSaving} onChange={e => handleStampPosition(e.target.value)}
              style={{ flex: 1, width: "auto", maxWidth: 260 }}>
              <option value="" disabled>Choose signature area…</option>
              {stampAreas.map(area => <option key={area.id} value={area.id}>Above {area.label}</option>)}
            </select>
          </label>
        )}
        <span style={{ fontSize: "0.75rem", color: "var(--k-muted)" }}>Duplicate a template to keep signed and unsigned versions. “No signature” leaves the stamp blank.</span>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", gap: "0", overflow: "hidden", borderTop: "1px solid var(--k-line)" }}>

        {listLoading ? (
          // Never paint an empty code box before the template has arrived —
          // an operator who starts typing into it would be editing nothing.
          <div style={styles.editorLoading}>
            <Loading>Loading template…</Loading>
          </div>
        ) : editorMode === "visual" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Tabs for visual mode */}
            <div style={styles.tabs} role="tablist" aria-label="Visual editor view">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "editor"}
                style={{ ...styles.tab, ...(activeTab === "editor" ? styles.tabActive : {}) }}
                onClick={() => setActiveTab("editor")}
              >
                <MdBrush size={15} /> Visual Builder
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "preview"}
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
              <MergeFieldSidebar fields={fields} onInsert={insertField} stamps={companyStamps} />
            )}

            {/* Code Editor / Preview Area */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Tabs */}
              <div style={styles.tabs} role="tablist" aria-label="Code editor view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "editor"}
                  style={{ ...styles.tab, ...(activeTab === "editor" ? styles.tabActive : {}), padding: isMobile ? "0 0.75rem" : undefined }}
                  onClick={() => setActiveTab("editor")}
                >
                  <MdEditIcon size={15} /> Editor
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "preview"}
                  style={{ ...styles.tab, ...(activeTab === "preview" ? styles.tabActive : {}), padding: isMobile ? "0 0.75rem" : undefined }}
                  onClick={() => setActiveTab("preview")}
                >
                  <MdVisibility size={15} /> Preview
                </button>
                <button
                  type="button"
                  style={{ ...styles.tab, ...styles.tabCopy, padding: isMobile ? "0 0.6rem" : undefined }}
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
    letterSpacing: "0.05em", color: "var(--k-faint)", paddingLeft: "0.15rem",
  },
  readonlyValue: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    minHeight: "var(--k-h)",
    padding: "0 var(--k-input-pad-x)",
    boxSizing: "border-box",
    borderRadius: "var(--k-radius)",
    border: "1px solid var(--k-line)",
    background: "var(--k-surface-3)",
    fontSize: "var(--k-font)",
    fontWeight: 600,
    color: "var(--k-ink)",
  },
  unsaved: { fontSize: "var(--k-font-sm)", color: "#e65100", fontWeight: 600 },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "var(--k-card-pad)",
    flexWrap: "wrap",
    gap: "0.75rem",
    background: "var(--k-surface)",
  },
  stampBar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.5rem 1rem",
    background: "var(--k-surface-2)",
    borderTop: "1px solid var(--k-line)",
  },
  // Code / Visual segmented toggle — the kit has no segmented control, so it
  // is built locally from the --k-* tokens.
  modeToggle: {
    display: "inline-flex",
    borderRadius: "var(--k-radius)",
    border: "1px solid var(--k-line-strong)",
    overflow: "hidden",
  },
  modeBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    minHeight: "var(--k-btn-h)",
    padding: "0 0.75rem",
    border: "none",
    borderRadius: 0,
    background: "var(--k-surface)",
    color: "var(--k-muted)",
    fontSize: "var(--k-btn-font)",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
    boxShadow: "none",
    transform: "none",
  },
  modeBtnActive: {
    background: "var(--k-primary-bg)",
    color: "#fff",
  },
  tabs: {
    display: "flex",
    gap: 0,
    borderBottom: "1px solid var(--k-line)",
    background: "var(--k-surface-2)",
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    minHeight: "var(--k-tab-h)",
    padding: "0 1.25rem",
    border: "none",
    borderRadius: 0,
    background: "transparent",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "var(--k-font)",
    color: "var(--k-muted)",
    borderBottom: "2px solid transparent",
    transition: "all 0.2s",
    boxShadow: "none",
    transform: "none",
  },
  tabActive: {
    color: "var(--k-blue)",
    borderBottomColor: "var(--k-blue)",
    background: "var(--k-surface)",
  },
  tabCopy: {
    marginLeft: "auto",
    fontSize: "var(--k-font-sm)",
    color: "var(--k-muted)",
  },
  editorLoading: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--k-surface)",
  },
};
