import { useState, useEffect, useRef, useCallback } from "react";
import { MdCode, MdBusiness, MdSave, MdRefresh, MdContentCopy, MdVisibility, MdEdit as MdEditIcon } from "react-icons/md";
import { getCompanies } from "../api/companyApi";
import { getTemplate, upsertTemplate } from "../api/printTemplateApi";
import { mergeTemplate, MERGE_FIELDS } from "../utils/templateEngine";
import { defaultChallanTemplate, defaultBillTemplate, defaultTaxInvoiceTemplate } from "../utils/defaultTemplates";
import { dropdownStyles } from "../theme";

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
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

export default function TemplateEditorPage() {
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [templateType, setTemplateType] = useState("Challan");
  const [htmlContent, setHtmlContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("editor"); // editor | preview
  const [toast, setToast] = useState(null);
  const editorRef = useRef(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Fetch companies
  useEffect(() => {
    (async () => {
      try {
        const { data } = await getCompanies();
        setCompanies(data);
        if (data.length > 0) setSelectedCompany(data[0]);
      } catch {
        showToast("Failed to load companies", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Fetch template when company/type changes
  useEffect(() => {
    if (!selectedCompany) return;
    (async () => {
      try {
        const { data } = await getTemplate(selectedCompany.id, templateType);
        setHtmlContent(data.htmlContent);
        setOriginalContent(data.htmlContent);
      } catch {
        // No saved template — use default
        const def = DEFAULT_TEMPLATES[templateType] || "";
        setHtmlContent(def);
        setOriginalContent("");
      }
    })();
  }, [selectedCompany, templateType]);

  const handleSave = async () => {
    if (!selectedCompany) return;
    setSaving(true);
    try {
      await upsertTemplate(selectedCompany.id, templateType, htmlContent);
      setOriginalContent(htmlContent);
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
  };

  const insertField = useCallback((field) => {
    const el = editorRef.current;
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
  }, [htmlContent]);

  const previewHtml = (() => {
    try {
      return mergeTemplate(htmlContent, SAMPLE_DATA[templateType]);
    } catch (e) {
      return `<div style="color:red;padding:20px;font-family:sans-serif"><h3>Template Error</h3><pre>${e.message}</pre></div>`;
    }
  })();

  const hasChanges = htmlContent !== originalContent;
  const fields = MERGE_FIELDS[templateType] || [];

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
          animation: "fadeIn 0.3s ease",
        }}>
          {toast.msg}
        </div>
      )}

      {/* Top Bar */}
      <div style={styles.topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}>
            <MdCode size={24} color="#fff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: colors.textPrimary }}>
              Template Editor
            </h2>
            <p style={{ margin: 0, fontSize: "0.82rem", color: colors.textSecondary }}>
              Customize print templates for each company
            </p>
          </div>
        </div>

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
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", gap: "0", overflow: "hidden", borderTop: `1px solid ${colors.cardBorder}` }}>
        {/* Merge Fields Sidebar */}
        <div style={styles.sidebar}>
          <div style={styles.sidebarHeader}>Merge Fields</div>
          <div style={styles.sidebarScroll}>
            {fields.map((f, i) => (
              <button
                key={i}
                style={styles.fieldBtn}
                onClick={() => insertField(f.field)}
                title={`Insert ${f.field}`}
                onMouseEnter={e => e.currentTarget.style.background = "#e3f2fd"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontSize: "0.7rem", color: colors.blue, fontFamily: "monospace", fontWeight: 600 }}>
                  {f.field.length > 30 ? f.field.substring(0, 30) + "..." : f.field}
                </span>
                <span style={{ fontSize: "0.72rem", color: colors.textSecondary }}>{f.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Editor / Preview Area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Tabs */}
          <div style={styles.tabs}>
            <button
              style={{ ...styles.tab, ...(activeTab === "editor" ? styles.tabActive : {}) }}
              onClick={() => setActiveTab("editor")}
            >
              <MdEditIcon size={15} /> Editor
            </button>
            <button
              style={{ ...styles.tab, ...(activeTab === "preview" ? styles.tabActive : {}) }}
              onClick={() => setActiveTab("preview")}
            >
              <MdVisibility size={15} /> Preview
            </button>
            <button
              style={{ ...styles.tab, ...styles.tabCopy }}
              onClick={() => { navigator.clipboard.writeText(htmlContent); showToast("Copied to clipboard!"); }}
              title="Copy HTML"
            >
              <MdContentCopy size={14} /> Copy
            </button>
          </div>

          {/* Editor Tab */}
          {activeTab === "editor" && (
            <textarea
              ref={editorRef}
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              style={styles.editor}
              spellCheck={false}
              placeholder="Paste or edit your HTML template here..."
            />
          )}

          {/* Preview Tab */}
          {activeTab === "preview" && (
            <div style={styles.previewContainer}>
              <iframe
                srcDoc={previewHtml}
                style={styles.previewFrame}
                title="Template Preview"
                sandbox="allow-same-origin"
              />
            </div>
          )}
        </div>
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
  sidebar: {
    width: 240,
    borderRight: `1px solid ${colors.cardBorder}`,
    display: "flex",
    flexDirection: "column",
    background: "#fafbfc",
    flexShrink: 0,
  },
  sidebarHeader: {
    padding: "0.65rem 0.85rem",
    fontWeight: 700,
    fontSize: "0.82rem",
    color: colors.textPrimary,
    borderBottom: `1px solid ${colors.cardBorder}`,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    background: "#f0f2f5",
  },
  sidebarScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "0.25rem",
  },
  fieldBtn: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    width: "100%",
    padding: "0.4rem 0.6rem",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    borderRadius: 6,
    transition: "background 0.15s",
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
  editor: {
    flex: 1,
    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
    fontSize: "13px",
    lineHeight: "1.5",
    padding: "1rem",
    border: "none",
    outline: "none",
    resize: "none",
    background: "#1e1e2e",
    color: "#cdd6f4",
    tabSize: 2,
  },
  previewContainer: {
    flex: 1,
    overflow: "auto",
    background: "#e8e8e8",
    display: "flex",
    justifyContent: "center",
    padding: "1rem",
  },
  previewFrame: {
    width: "210mm",
    minHeight: "297mm",
    border: "none",
    background: "#fff",
    boxShadow: "0 2px 20px rgba(0,0,0,0.15)",
  },
};
