import { useState, useEffect, useRef } from "react";
import { MdUploadFile, MdTextSnippet, MdAdd, MdDelete, MdWarning, MdCheckCircle, MdArrowBack, MdArrowForward, MdBookmarkAdd, MdVerified } from "react-icons/md";
import { parsePdf, parseText, ensureLookups, addSample } from "../api/poImportApi";
import { getClientsByCompany } from "../api/clientApi";
import { getItemTypes } from "../api/itemTypeApi";
import { createDeliveryChallan } from "../api/challanApi";
import { formStyles } from "../theme";
import LookupAutocomplete from "./LookupAutocomplete";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  success: "#28a745",
  successLight: "#e8f5e9",
  warning: "#f57c00",
  warningLight: "#fff3e0",
};

export default function POImportForm({ companyId, onClose, onSaved }) {
  const [step, setStep] = useState(1); // 1=import, 2=preview
  const [importMode, setImportMode] = useState("pdf"); // "pdf" or "text"
  const [pastedText, setPastedText] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");

  // Parsed data (editable in step 2)
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [site, setSite] = useState("");
  const [items, setItems] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [rawText, setRawText] = useState("");

  // Format match metadata (populated when rule-based parser handled this PDF).
  // Enables the "save as verified sample" affordance for operator-in-the-loop.
  const [matchedFormatId, setMatchedFormatId] = useState(null);
  const [matchedFormatName, setMatchedFormatName] = useState("");
  const [matchedFormatVersion, setMatchedFormatVersion] = useState(null);
  const [sampleSaving, setSampleSaving] = useState(false);
  const [sampleSaveStatus, setSampleSaveStatus] = useState(null); // {type: 'success'|'error', message: '...'}
  const [sampleFileBase64, setSampleFileBase64] = useState(null);

  // Lookups
  const [clients, setClients] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [clientRes, typeRes] = await Promise.all([
          getClientsByCompany(companyId),
          getItemTypes(),
        ]);
        setClients(clientRes.data);
        setItemTypes(typeRes.data);
      } catch { /* ignore */ }
    };
    load();
  }, [companyId]);

  const handleParse = async () => {
    setError("");
    setParsing(true);

    try {
      let res;
      if (importMode === "pdf") {
        if (!selectedFile) { setError("Please select a PDF file."); setParsing(false); return; }
        res = await parsePdf(selectedFile);
      } else {
        if (!pastedText.trim()) { setError("Please paste some text."); setParsing(false); return; }
        res = await parseText(pastedText);
      }

      const data = res.data;
      setPoNumber(data.poNumber || "");
      setPoDate(data.poDate ? data.poDate.split("T")[0] : "");
      setItems(data.items?.map((item, idx) => ({
        id: idx,
        description: item.description || "",
        quantity: item.quantity || 1,
        unit: item.unit || "Pcs",
        itemTypeId: "",
      })) || []);
      setWarnings(data.warnings || []);
      setRawText(data.rawText || "");
      setMatchedFormatId(data.matchedFormatId ?? null);
      setMatchedFormatName(data.matchedFormatName || "");
      setMatchedFormatVersion(data.matchedFormatVersion ?? null);
      setSampleSaveStatus(null);
      setStep(2);

      // Stash the PDF as base64 so a "save as verified sample" action can
      // persist the original PDF alongside the extraction. Cheap + reliable
      // — operator can always upload the same PDF again if they skip this.
      if (importMode === "pdf" && selectedFile) {
        try {
          const buf = await selectedFile.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = "";
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          setSampleFileBase64(btoa(bin));
        } catch {
          setSampleFileBase64(null);
        }
      } else {
        setSampleFileBase64(null);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to parse. Please try again.");
    } finally {
      setParsing(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError("");
    }
  };

  const handleItemChange = (idx, field, value) => {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const addItem = () => {
    setItems((prev) => [...prev, { id: Date.now(), description: "", quantity: 1, unit: "Pcs", itemTypeId: "" }]);
  };

  const removeItem = (idx) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // Capture the currently-edited extraction as a verified golden sample for
  // the matched format. The server will replay it against every subsequent
  // rule-set change to prevent regressions on THIS exact PDF.
  const handleSaveAsSample = async () => {
    if (!matchedFormatId || !rawText || items.length === 0) return;
    setSampleSaveStatus(null);
    setSampleSaving(true);
    try {
      const defaultName = selectedFile?.name
        ? `${selectedFile.name.replace(/\.pdf$/i, "")} — PO ${poNumber || "?"}`
        : `PO ${poNumber || "(no number)"} — ${new Date().toISOString().slice(0, 10)}`;
      const payload = {
        name: defaultName.slice(0, 250),
        originalFileName: selectedFile?.name || null,
        rawText,
        expected: {
          poNumber: poNumber || null,
          poDate: poDate ? new Date(poDate).toISOString() : null,
          items: items.map((i) => ({
            description: (i.description || "").trim(),
            quantity: parseInt(i.quantity) || 0,
            unit: i.unit || "Pcs",
          })),
        },
        notes: "Captured from import screen after operator confirmation.",
        pdfBase64: sampleFileBase64 || null,
      };
      await addSample(matchedFormatId, payload);
      setSampleSaveStatus({
        type: "success",
        message: `Saved as verified sample. Future rule changes for '${matchedFormatName}' must keep this PDF parsing correctly.`,
      });
    } catch (err) {
      setSampleSaveStatus({
        type: "error",
        message: err.response?.data?.error || "Failed to save sample.",
      });
    } finally {
      setSampleSaving(false);
    }
  };

  const selectedClient = clients.find((c) => c.id === parseInt(selectedClientId));
  const clientSites = selectedClient?.site ? selectedClient.site.split(";").map((s) => s.trim()).filter(Boolean) : [];

  const canSubmit = selectedClientId && deliveryDate && items.length > 0 &&
    items.every((i) => i.description.trim() && i.quantity > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError("");
    setSaving(true);

    try {
      // Auto-create missing lookup entries
      const descriptions = items.map((i) => i.description.trim()).filter(Boolean);
      const units = items.map((i) => i.unit.trim()).filter(Boolean);
      await ensureLookups(descriptions, units);

      // Create the delivery challan
      const payload = {
        clientId: parseInt(selectedClientId),
        clientName: selectedClient?.name || "",
        site: site || null,
        poNumber: poNumber.trim(),
        poDate: poDate ? new Date(poDate).toISOString() : null,
        deliveryDate: new Date(deliveryDate).toISOString(),
        items: items.map((i) => ({
          description: i.description.trim(),
          quantity: parseInt(i.quantity),
          unit: i.unit.trim() || "Pcs",
          itemTypeId: i.itemTypeId ? parseInt(i.itemTypeId) : null,
        })),
      };

      await createDeliveryChallan(companyId, payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create challan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: 900, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            {step === 1 ? "Import Purchase Order" : "Review & Create Challan"}
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <div style={{ ...formStyles.body, maxHeight: "72vh", overflowY: "auto" }}>
          {error && <div style={styles.errorAlert}>{error}</div>}

          {step === 1 && (
            <>
              {/* Mode Tabs */}
              <div style={styles.modeTabs}>
                <button
                  type="button"
                  style={{ ...styles.modeTab, ...(importMode === "pdf" ? styles.modeTabActive : {}) }}
                  onClick={() => setImportMode("pdf")}
                >
                  <MdUploadFile size={18} /> Upload PDF
                </button>
                <button
                  type="button"
                  style={{ ...styles.modeTab, ...(importMode === "text" ? styles.modeTabActive : {}) }}
                  onClick={() => setImportMode("text")}
                >
                  <MdTextSnippet size={18} /> Paste Text
                </button>
              </div>

              {importMode === "pdf" ? (
                <div style={styles.uploadArea}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={handleFileChange}
                    style={{ display: "none" }}
                  />
                  <div
                    style={styles.dropZone}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <MdUploadFile size={48} color={colors.textSecondary} />
                    <p style={{ margin: "0.5rem 0 0", color: colors.textSecondary, fontSize: "0.9rem" }}>
                      {selectedFile ? selectedFile.name : "Click to select a PDF file"}
                    </p>
                    <span style={{ fontSize: "0.78rem", color: colors.textSecondary }}>Max 10 MB</span>
                  </div>
                </div>
              ) : (
                <div>
                  <label style={styles.label}>Paste PO content below</label>
                  <textarea
                    style={styles.textarea}
                    rows={12}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={"Paste your Purchase Order text here...\n\nExample:\nPO No: PO-2026-001\nDate: 13/04/2026\n\n1. Pneumatic Fitting 1/4\"  -  10 Pcs\n2. Air Cylinder 50mm      -   5 Nos\n3. FRL Unit 1/4\"           -   2 Set"}
                  />
                </div>
              )}

              <div style={{ marginTop: "0.75rem", padding: "0.75rem", backgroundColor: colors.warningLight, borderRadius: 8, fontSize: "0.82rem", color: "#5d4037" }}>
                <MdWarning size={16} style={{ verticalAlign: "middle", marginRight: 4 }} />
                The system will attempt to extract PO number, date, and items automatically.
                You can review and edit everything before creating the challan.
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {/* Format-match banner (only when the deterministic rule-based
                  parser handled the PDF — a saved format plus a "lock in as
                  verified sample" CTA that feeds the regression harness). */}
              {matchedFormatId && (
                <div style={styles.formatMatchBanner}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
                    <MdVerified size={20} color={colors.success} />
                    <div>
                      <div style={{ fontWeight: 600, color: colors.textPrimary, fontSize: "0.9rem" }}>
                        Matched format: {matchedFormatName}{matchedFormatVersion ? ` (v${matchedFormatVersion})` : ""}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: colors.textSecondary }}>
                        Parsed deterministically — no AI call. If the extraction below is correct, lock it in as a verified sample so future rule changes can't regress it.
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    style={{ ...styles.saveSampleBtn, opacity: sampleSaving ? 0.6 : 1 }}
                    disabled={sampleSaving || sampleSaveStatus?.type === "success"}
                    onClick={handleSaveAsSample}
                    title="Save this extraction as a verified regression sample"
                  >
                    <MdBookmarkAdd size={16} />
                    {sampleSaving ? "Saving…" : sampleSaveStatus?.type === "success" ? "Sample Saved" : "Save as Verified Sample"}
                  </button>
                </div>
              )}

              {/* Feedback from the save-as-sample action */}
              {sampleSaveStatus && (
                <div
                  style={{
                    ...(sampleSaveStatus.type === "success" ? styles.successAlert : styles.errorAlert),
                    marginBottom: "1rem",
                  }}
                >
                  {sampleSaveStatus.type === "success" ? <MdCheckCircle size={14} style={{ verticalAlign: "middle", marginRight: 6 }} /> : null}
                  {sampleSaveStatus.message}
                </div>
              )}

              {/* Warnings from parser */}
              {warnings.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  {warnings.map((w, i) => (
                    <div key={i} style={{ ...styles.warningAlert, marginBottom: "0.35rem" }}>
                      <MdWarning size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {w}
                    </div>
                  ))}
                </div>
              )}

              {/* PO Fields + Client + Delivery Date */}
              <div style={styles.row}>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>PO Number</label>
                  <input style={styles.input} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PO-2026-001" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>PO Date</label>
                  <input type="date" style={styles.input} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>Delivery Date *</label>
                  <input type="date" style={styles.input} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                </div>
              </div>

              <div style={styles.row}>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>Client *</label>
                  <select style={styles.select} value={selectedClientId} onChange={(e) => { setSelectedClientId(e.target.value); setSite(""); }}>
                    <option value="">— Select Client —</option>
                    {clients.map((cl) => (
                      <option key={cl.id} value={cl.id}>{cl.name}</option>
                    ))}
                  </select>
                </div>
                {clientSites.length > 0 && (
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>Site / Department</label>
                    <select style={styles.select} value={site} onChange={(e) => setSite(e.target.value)}>
                      <option value="">— Select Site —</option>
                      {clientSites.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Items Table */}
              <div style={{ marginTop: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <label style={{ ...styles.label, marginBottom: 0 }}>
                    Items ({items.length})
                    {items.length > 0 && items.every((i) => i.description.trim() && i.quantity > 0) && (
                      <MdCheckCircle size={14} color={colors.success} style={{ marginLeft: 6, verticalAlign: "middle" }} />
                    )}
                  </label>
                  <button type="button" style={styles.addItemBtn} onClick={addItem}>
                    <MdAdd size={16} /> Add Item
                  </button>
                </div>

                {items.length === 0 ? (
                  <div style={{ padding: "2rem", textAlign: "center", color: colors.textSecondary, fontSize: "0.85rem", border: `2px dashed ${colors.cardBorder}`, borderRadius: 8 }}>
                    No items detected. Click "Add Item" to add manually.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {/* Header */}
                    <div style={styles.itemsHeader}>
                      <span style={{ flex: 0.5 }}>#</span>
                      <span style={{ flex: 1.2 }}>Item Type (FBR)</span>
                      <span style={{ flex: 2.5 }}>Description *</span>
                      <span style={{ flex: 0.6, textAlign: "center" }}>Qty *</span>
                      <span style={{ flex: 1 }}>Unit</span>
                      <span style={{ flex: 0.3 }}></span>
                    </div>
                    {items.map((item, idx) => (
                      <div key={item.id} style={styles.itemRow}>
                        <span style={{ flex: 0.5, fontSize: "0.8rem", color: colors.textSecondary, paddingTop: 6 }}>{idx + 1}</span>
                        <div style={{ flex: 1.2 }}>
                          <SearchableItemTypeSelect
                            items={itemTypes}
                            value={item.itemTypeId || ""}
                            onChange={(newId, picked) => {
                              handleItemChange(idx, "itemTypeId", newId ? parseInt(newId) : "");
                              // Auto-fill UOM from the catalog (description stays user/PO-driven)
                              if (picked && picked.uom && !item.unit?.trim()) {
                                handleItemChange(idx, "unit", picked.uom);
                              }
                            }}
                            placeholder="Item (optional)"
                            style={{ padding: "0.35rem 0.4rem", fontSize: "0.82rem" }}
                          />
                        </div>
                        <div style={{ flex: 2.5 }}>
                          <LookupAutocomplete
                            label="Description"
                            endpoint="/lookup/items"
                            value={item.description}
                            onChange={(val) => handleItemChange(idx, "description", val)}
                            inputClassName=""
                            inputStyle={{ ...styles.input, padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                          />
                        </div>
                        <div style={{ flex: 0.6 }}>
                          <input
                            type="number"
                            min={1}
                            style={{ ...styles.input, padding: "0.35rem 0.4rem", fontSize: "0.85rem", textAlign: "center" }}
                            value={item.quantity}
                            onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <LookupAutocomplete
                            label="Unit"
                            endpoint="/lookup/units"
                            value={item.unit}
                            onChange={(val) => handleItemChange(idx, "unit", val)}
                            inputClassName=""
                            inputStyle={{ ...styles.input, padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                          />
                        </div>
                        <div style={{ flex: 0.3, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <button
                            type="button"
                            style={styles.deleteItemBtn}
                            onClick={() => removeItem(idx)}
                            title="Remove item"
                          >
                            <MdDelete size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Raw text toggle */}
              {rawText && (
                <details style={{ marginTop: "1rem" }}>
                  <summary style={{ cursor: "pointer", fontSize: "0.82rem", color: colors.textSecondary }}>
                    View extracted raw text
                  </summary>
                  <pre style={{ marginTop: "0.5rem", padding: "0.75rem", backgroundColor: "#f5f5f5", borderRadius: 6, fontSize: "0.75rem", maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {rawText}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>

        <div style={formStyles.footer}>
          {step === 2 && (
            <button
              type="button"
              style={{ ...formStyles.button, ...formStyles.cancel, marginRight: "auto" }}
              onClick={() => setStep(1)}
            >
              <MdArrowBack size={16} style={{ verticalAlign: "middle", marginRight: 4 }} />
              Back
            </button>
          )}

          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>

          {step === 1 && (
            <button
              type="button"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: parsing ? 0.6 : 1 }}
              disabled={parsing}
              onClick={handleParse}
            >
              {parsing ? "Parsing..." : <>Parse & Preview <MdArrowForward size={16} style={{ verticalAlign: "middle", marginLeft: 4 }} /></>}
            </button>
          )}

          {step === 2 && (
            <button
              type="button"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: !canSubmit || saving ? 0.6 : 1 }}
              disabled={!canSubmit || saving}
              onClick={handleSubmit}
            >
              {saving ? "Creating..." : "Create Challan"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  select: { width: "100%", padding: "0.6rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", cursor: "pointer" },
  textarea: { width: "100%", padding: "0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.85rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box", fontFamily: "monospace", resize: "vertical" },
  errorAlert: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, border: `1px solid ${colors.danger}30`, fontSize: "0.85rem" },
  warningAlert: { display: "flex", alignItems: "flex-start", gap: "0.4rem", backgroundColor: colors.warningLight, color: "#5d4037", padding: "0.5rem 0.75rem", borderRadius: 6, fontSize: "0.82rem" },
  modeTabs: { display: "flex", gap: "0.5rem", marginBottom: "1.25rem" },
  modeTab: { display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1.25rem", borderRadius: 8, border: `2px solid ${colors.cardBorder}`, backgroundColor: "#fff", fontSize: "0.88rem", fontWeight: 600, color: colors.textSecondary, cursor: "pointer", transition: "all 0.2s" },
  modeTabActive: { borderColor: colors.blue, color: colors.blue, backgroundColor: "#e3f2fd" },
  uploadArea: { marginBottom: "1rem" },
  dropZone: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2.5rem 1rem", border: `2px dashed ${colors.inputBorder}`, borderRadius: 12, cursor: "pointer", backgroundColor: colors.inputBg, transition: "border-color 0.2s" },
  itemsHeader: { display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.4rem 0.5rem", backgroundColor: "#f0f4f8", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase" },
  itemRow: { display: "flex", gap: "0.5rem", alignItems: "flex-start", padding: "0.5rem", borderRadius: 6, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fafbfc" },
  addItemBtn: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.35rem 0.75rem", borderRadius: 6, border: `1px solid ${colors.teal}`, backgroundColor: "#fff", color: colors.teal, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" },
  deleteItemBtn: { border: "none", background: "none", color: colors.danger, cursor: "pointer", padding: "0.25rem", borderRadius: 4 },
  formatMatchBanner: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    backgroundColor: colors.successLight,
    border: `1px solid ${colors.success}40`,
    borderRadius: 10,
    padding: "0.75rem 1rem",
    marginBottom: "1rem",
    flexWrap: "wrap",
  },
  saveSampleBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.45rem 0.9rem",
    borderRadius: 8,
    border: `1px solid ${colors.success}`,
    backgroundColor: "#fff",
    color: colors.success,
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  successAlert: {
    backgroundColor: colors.successLight,
    color: "#1b5e20",
    padding: "0.6rem 1rem",
    borderRadius: 8,
    border: `1px solid ${colors.success}30`,
    fontSize: "0.85rem",
    fontWeight: 500,
  },
};
