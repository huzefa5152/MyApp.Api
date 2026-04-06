import { useState, useEffect, useRef, useCallback } from "react";
import {
  MdCode, MdBusiness, MdSave, MdRefresh, MdContentCopy,
  MdVisibility, MdEdit as MdEditIcon, MdBrush,
  MdUploadFile, MdDelete, MdGridOn,
} from "react-icons/md";
import {
  getTemplate, upsertTemplate, getMergeFields,
  uploadExcelTemplate, deleteExcelTemplate,
} from "../api/printTemplateApi";
import { useCompany } from "../contexts/CompanyContext";
import { mergeTemplate } from "../utils/templateEngine";
import {
  defaultChallanTemplate, defaultBillTemplate, defaultTaxInvoiceTemplate,
} from "../utils/defaultTemplates";
import { dropdownStyles } from "../theme";
import CodeEditor from "../Components/templateEditor/CodeEditor";
import MergeFieldSidebar from "../Components/templateEditor/MergeFieldSidebar";
import PreviewPane from "../Components/templateEditor/PreviewPane";
import SyncWarningModal from "../Components/templateEditor/SyncWarningModal";
import VisualEditor from "../Components/templateEditor/VisualEditor";
import StarterTemplatePicker from "../Components/templateEditor/StarterTemplatePicker";
import { useConfirm } from "../Components/ConfirmDialog";

const TEMPLATE_TYPES = [
  { value: "Challan", label: "Delivery Challan" },
  { value: "Bill", label: "Bill / Invoice" },
  { value: "TaxInvoice", label: "Sales Tax Invoice" },
];

const SAMPLE_DATA = {
  Challan: {
    companyBrandName: "SAMPLE COMPANY",
    companyLogoPath: "",
    companyAddress: "123 Business Street,\nCity, Country",
    companyPhone: "Contact Person\n0300-1234567",
    challanNumber: 1001,
    deliveryDate: new Date().toISOString(),
    clientName: "Sample Client Pvt Ltd",
    clientAddress: "Client Address",
    poNumber: "PO-2025-001",
    items: [
      { quantity: 10, description: "Sample Item One" },
      { quantity: 5, description: "Sample Item Two" },
      { quantity: 8, description: "Sample Item Three" },
    ],
  },
  Bill: {
    companyBrandName: "SAMPLE COMPANY",
    companyLogoPath: "",
    companyAddress: "123 Business Street, City",
    companyPhone: "0300-1234567",
    companyNTN: "1234567-8",
    companySTRN: "1234567890123",
    invoiceNumber: 501,
    date: new Date().toISOString(),
    challanNumbers: [1001, 1002],
    challanDates: [new Date().toISOString()],
    poNumber: "PO-2025-001",
    poDate: new Date().toISOString(),
    clientName: "Sample Client Pvt Ltd",
    clientNTN: "9876543-2",
    clientSTRN: "9876543210987",
    concernDepartment: "Main Office",
    subtotal: 150000,
    gstRate: 18,
    gstAmount: 27000,
    grandTotal: 177000,
    amountInWords: "One Hundred Seventy Seven Thousand Rupees Only",
    items: [
      { sNo: 1, quantity: 10, description: "Sample Item One", itemTypeName: "Pneumatic", unitPrice: 8000, lineTotal: 80000 },
      { sNo: 2, quantity: 5, description: "Sample Item Two", itemTypeName: "Pneumatic", unitPrice: 14000, lineTotal: 70000 },
    ],
  },
  TaxInvoice: {
    supplierName: "SAMPLE COMPANY",
    supplierAddress: "123 Business Street, City",
    supplierPhone: "0300-1234567",
    supplierNTN: "1234567-8",
    supplierSTRN: "1234567890123",
    buyerName: "Sample Client Pvt Ltd",
    buyerAddress: "Client Address, City",
    buyerNTN: "9876543-2",
    buyerSTRN: "9876543210987",
    invoiceNumber: 501,
    date: new Date().toISOString(),
    challanNumbers: [1001, 1002],
    poNumber: "PO-2025-001",
    subtotal: 150000,
    gstRate: 18,
    gstAmount: 27000,
    grandTotal: 177000,
    amountInWords: "One Hundred Seventy Seven Thousand Rupees Only",
    items: [
      { quantity: 10, uom: "Pcs", description: "Sample Item One", itemTypeName: "Pneumatic", valueExclTax: 80000, gstRate: 18, gstAmount: 14400, totalInclTax: 94400 },
      { quantity: 5, uom: "Pcs", description: "Sample Item Two", itemTypeName: "Hydraulic", valueExclTax: 70000, gstRate: 18, gstAmount: 12600, totalInclTax: 82600 },
    ],
  },
};

const DEFAULT_TEMPLATES = {
  Challan: defaultChallanTemplate,
  Bill: defaultBillTemplate,
  TaxInvoice: defaultTaxInvoiceTemplate,
};

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
  const { companies, selectedCompany, setSelectedCompany, loading } = useCompany();
  const [templateType, setTemplateType] = useState("Challan");
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
  const [fields, setFields] = useState([]);
  const [hasExcel, setHasExcel] = useState(false);
  const [excelUploading, setExcelUploading] = useState(false);
  const excelInputRef = useRef(null);
  const htmlImportRef = useRef(null);
  const codeEditorRef = useRef(null);
  const visualEditorRef = useRef(null);

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

  // Fetch template when company/type changes
  useEffect(() => {
    if (!selectedCompany) return;
    (async () => {
      try {
        const { data } = await getTemplate(selectedCompany.id, templateType);
        setHtmlContent(data.htmlContent);
        setOriginalContent(data.htmlContent);
        setTemplateJson(data.templateJson || null);
        setOriginalJson(data.templateJson || null);
        setEditorMode(data.editorMode || "code");
        setHasExcel(data.hasExcelTemplate || false);
        setActiveTab("editor");
      } catch {
        const def = DEFAULT_TEMPLATES[templateType] || "";
        setHtmlContent(def);
        setOriginalContent("");
        setTemplateJson(null);
        setOriginalJson(null);
        setEditorMode("code");
        setHasExcel(false);
        setActiveTab("editor");
      }
    })();
  }, [selectedCompany, templateType]);

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

      await upsertTemplate(selectedCompany.id, templateType, saveHtml, saveJson, editorMode);
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

  const handleExcelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCompany) return;
    setExcelUploading(true);
    try {
      await uploadExcelTemplate(selectedCompany.id, templateType, file);
      setHasExcel(true);
      showToast("Excel template uploaded!");
    } catch {
      showToast("Failed to upload Excel template", "error");
    } finally {
      setExcelUploading(false);
      if (excelInputRef.current) excelInputRef.current.value = "";
    }
  };

  const handleExcelDelete = async () => {
    if (!selectedCompany) return;
    const ok = await confirm({ title: "Remove Excel Template?", message: "Remove the Excel template for this type? This cannot be undone.", variant: "danger", confirmText: "Remove" });
    if (!ok) return;
    try {
      await deleteExcelTemplate(selectedCompany.id, templateType);
      setHasExcel(false);
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

  const hasChanges = htmlContent !== originalContent || templateJson !== originalJson;
  // fields is now fetched from API via useEffect above

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

      {/* Starter Template Picker */}
      {showTemplatePicker && (
        <StarterTemplatePicker
          templateType={templateType}
          onSelect={handleSelectStarter}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}

      {/* Top Bar */}
      <div style={styles.topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
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
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
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
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <select
                style={{ ...dropdownStyles.base, minWidth: 0, flex: 1, fontSize: "0.82rem" }}
                value={templateType}
                onChange={(e) => setTemplateType(e.target.value)}
              >
                {TEMPLATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <MdBusiness size={18} color={colors.blue} />
              <select
                style={{ ...dropdownStyles.base, minWidth: "180px" }}
                value={selectedCompany?.id || ""}
                onChange={(e) => setSelectedCompany(companies.find(c => c.id === parseInt(e.target.value)))}
              >
                {companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
              </select>
            </div>
            <select
              style={{ ...dropdownStyles.base, minWidth: "180px" }}
              value={templateType}
              onChange={(e) => setTemplateType(e.target.value)}
            >
              {TEMPLATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>

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

            <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={() => setShowTemplatePicker(true)} title="Start from a template">
              <MdContentCopy size={16} /> Templates
            </button>
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
                No Excel template — Excel export button hidden on challan/invoice pages
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
