import { useState, useEffect, useRef } from "react";
import { MdUploadFile, MdCheckCircle, MdWarning, MdInfoOutline, MdBusiness } from "react-icons/md";
import { getClientsByCompany, getClientById } from "../api/clientApi";
import { useCompany } from "../contexts/CompanyContext";
import {
  fingerprintPdf,
  createPoFormatSimple,
  updatePoFormatSimple,
} from "../api/poFormatApi";
import { formStyles } from "../theme";

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
  primary: "#0d47a1",
  primaryLight: "#e3f2fd",
};

/**
 * Modal for adding/editing a client's PO format.
 *
 * Add flow:
 *   1. Pick the client.
 *   2. Upload a sample PDF — server returns the extracted raw text so the
 *      operator can see what PdfPig sees (single-space tokenisation, etc).
 *   3. Fill the 5 label/header strings that appear in that raw text.
 *   4. Save → /api/poformats/simple stores a simple-headers-v1 rule-set
 *      keyed on the PDF's fingerprint.
 *
 * Edit flow:
 *   - Same 5 fields, but sample upload is hidden (fingerprint is locked
 *     to whatever sample the format was created with).
 */
export default function POFormatForm({ companyId, format, onClose, onSaved }) {
  const isEdit = !!format;
  const { selectedCompany } = useCompany();

  const [clients, setClients] = useState([]);
  // Coerce to string — React's <select value> compares via string equality
  // with <option value>, and `e.target.value` is always a string. Keeping
  // the state in one type avoids subtle mismatches.
  const [clientId, setClientId] = useState(format?.clientId != null ? String(format.clientId) : "");
  const [name, setName] = useState(format?.name || "");
  const [isActive, setIsActive] = useState(format?.isActive ?? true);

  const [poNumberLabel, setPoNumberLabel] = useState("");
  const [poDateLabel, setPoDateLabel] = useState("");
  const [descriptionHeader, setDescriptionHeader] = useState("");
  const [quantityHeader, setQuantityHeader] = useState("");
  const [unitHeader, setUnitHeader] = useState("");

  const [rawText, setRawText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [existingMatchName, setExistingMatchName] = useState(null);
  const [notes, setNotes] = useState(format?.notes || "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  // Preload client list for the currently-selected company. If we're editing
  // a format whose saved clientId belongs to a DIFFERENT company (happens
  // with the seeded baseline formats whose CompanyId is null — they appear
  // in every company's list but their client sits under one specific
  // company), fetch that specific client and merge it into the options so
  // the select can actually render the persisted value.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getClientsByCompany(companyId);
        let list = data;
        const savedClientId = format?.clientId;
        if (savedClientId && !data.some((c) => c.id === savedClientId)) {
          try {
            const { data: own } = await getClientById(savedClientId);
            // Prepend so the persisted client shows at the top — makes it
            // obvious in the dropdown that this format is bound to a
            // different company's client.
            list = [own, ...data];
          } catch {
            /* client may have been deleted — leave list as-is, select will fall back to blank */
          }
        }
        if (!cancelled) setClients(list);
      } catch {
        if (!cancelled) setClients([]);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, format?.clientId]);

  // Preload the 5 fields when editing — parse them out of RuleSetJson
  useEffect(() => {
    if (!format) return;
    try {
      const rs = JSON.parse(format.ruleSetJson || "{}");
      if (rs.engine === "simple-headers-v1") {
        setPoNumberLabel(rs.poNumberLabel || "");
        setPoDateLabel(rs.poDateLabel || "");
        setDescriptionHeader(rs.descriptionHeader || "");
        setQuantityHeader(rs.quantityHeader || "");
        setUnitHeader(rs.unitHeader || "");
      }
    } catch {
      // ignore — legacy rule-sets can't be edited here
    }
  }, [format]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploaded(false);
    setExistingMatchName(null);
    setError("");
    try {
      const res = await fingerprintPdf(file, companyId);
      setRawText(res.data.rawText || "");
      if (res.data.matchedFormat && res.data.isExactMatch) {
        setExistingMatchName(res.data.matchedFormat.name);
      }
      setUploaded(true);
      // Auto-suggest name from selected client
      if (!name) {
        const client = clients.find((c) => c.id === parseInt(clientId));
        setName(client ? `${client.name} PO` : "New PO Format");
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to read PDF.");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setError("");

    if (!clientId) return setError("Select the client this format belongs to.");
    if (!name.trim()) return setError("Enter a name for this format.");
    if (!descriptionHeader.trim() || !quantityHeader.trim() || !unitHeader.trim()) {
      return setError("Fill the three column headers (Description, Quantity, Unit).");
    }
    if (!isEdit && !rawText) {
      return setError("Upload a sample PDF so we can lock in the layout fingerprint.");
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updatePoFormatSimple(format.id, {
          name: name.trim(),
          isActive,
          clientId: parseInt(clientId),
          poNumberLabel: poNumberLabel.trim(),
          poDateLabel: poDateLabel.trim(),
          descriptionHeader: descriptionHeader.trim(),
          quantityHeader: quantityHeader.trim(),
          unitHeader: unitHeader.trim(),
          notes: notes || null,
          // If the operator re-uploaded a sample PDF during edit, send the
          // fresh raw text so the server can recompute the fingerprint hash.
          rawText: uploaded && rawText ? rawText : null,
        });
      } else {
        await createPoFormatSimple({
          name: name.trim(),
          companyId,
          clientId: parseInt(clientId),
          rawText,
          poNumberLabel: poNumberLabel.trim(),
          poDateLabel: poDateLabel.trim(),
          descriptionHeader: descriptionHeader.trim(),
          quantityHeader: quantityHeader.trim(),
          unitHeader: unitHeader.trim(),
          notes: notes || null,
        });
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: 780, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? "Edit PO Format" : "Add PO Format"}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <div style={{ ...formStyles.body, maxHeight: "72vh", overflowY: "auto" }}>
          {selectedCompany && (
            <div style={styles.companyChip}>
              <MdBusiness size={14} />
              <span>Company: <strong>{selectedCompany.brandName || selectedCompany.name}</strong></span>
            </div>
          )}

          {error && (
            <div style={styles.errorAlert}>
              <MdWarning size={16} /> {error}
            </div>
          )}

          {!isEdit && existingMatchName && (
            <div style={styles.infoAlert}>
              <MdInfoOutline size={16} />
              <span>A format already exists for this layout: <strong>{existingMatchName}</strong>. Saving will be blocked — edit the existing one instead.</span>
            </div>
          )}

          {/* Client + name */}
          <div style={styles.row}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Client *</label>
              <select
                style={styles.input}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">— Select client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Format name *</label>
              <input
                style={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lotte Kolson PO"
              />
            </div>
          </div>

          {/* Sample PDF upload — required on create, optional on edit
              (upload replaces the stored sample and recomputes the
              fingerprint hash — useful if the client's template changed). */}
          <div style={{ marginBottom: "1rem" }}>
            <label style={styles.label}>
              Sample PDF {isEdit ? "(optional — upload to replace)" : "*"}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <div style={styles.dropZone} onClick={() => fileInputRef.current?.click()}>
              <MdUploadFile size={32} color={colors.textSecondary} />
              <p style={{ margin: "0.5rem 0 0.25rem", color: colors.textSecondary, fontSize: "0.9rem" }}>
                {uploading ? "Reading PDF…" : uploaded ? <><MdCheckCircle size={16} color={colors.success} style={{ verticalAlign: "middle" }} /> Sample loaded — fill the 5 fields below</> : isEdit ? "Click to upload a new sample PDF (optional)" : "Click to upload a sample PDF"}
              </p>
              <span style={{ fontSize: "0.78rem", color: colors.textSecondary }}>Max 10 MB</span>
            </div>
          </div>

          {/* Raw text preview — helps the operator see exactly what PdfPig
              extracted so they can pick the correct label strings */}
          {rawText && (
            <div style={{ marginBottom: "1rem" }}>
              <label style={styles.label}>Extracted text (for reference)</label>
              <textarea
                readOnly
                style={{ ...styles.input, ...styles.textarea, fontFamily: "monospace", fontSize: "0.78rem", backgroundColor: "#fafbfc" }}
                rows={8}
                value={rawText}
              />
              <div style={styles.hint}>
                Use the exact strings you see above for the 5 fields below — they must be whole-word matches.
              </div>
            </div>
          )}

          {/* The 5 fields */}
          <h6 style={styles.sectionTitle}>Label / header strings</h6>
          <p style={styles.sectionHint}>
            Enter the exact text that appears on the PDF. The system finds those strings, then extracts the value/column that follows.
          </p>

          <div style={styles.row}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>PO Number label</label>
              <input
                style={styles.input}
                value={poNumberLabel}
                onChange={(e) => setPoNumberLabel(e.target.value)}
                placeholder='e.g. "P.O. #"'
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>PO Date label</label>
              <input
                style={styles.input}
                value={poDateLabel}
                onChange={(e) => setPoDateLabel(e.target.value)}
                placeholder='e.g. "P.O. Date"'
              />
            </div>
          </div>

          <div style={styles.row}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Description column header *</label>
              <input
                style={styles.input}
                value={descriptionHeader}
                onChange={(e) => setDescriptionHeader(e.target.value)}
                placeholder='e.g. "Item Name"'
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Quantity column header *</label>
              <input
                style={styles.input}
                value={quantityHeader}
                onChange={(e) => setQuantityHeader(e.target.value)}
                placeholder='e.g. "Quantity" or "Qty"'
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Unit column header *</label>
              <input
                style={styles.input}
                value={unitHeader}
                onChange={(e) => setUnitHeader(e.target.value)}
                placeholder='e.g. "Unit" or "UOM"'
              />
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={styles.label}>Notes (optional)</label>
            <textarea
              style={{ ...styles.input, ...styles.textarea }}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any operator notes — which unit, branch, variant this format covers."
            />
          </div>

          {isEdit && (
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: colors.textPrimary, fontSize: "0.9rem", cursor: "pointer" }}>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                Active — incoming PDFs matching this layout will auto-parse
              </label>
            </div>
          )}
        </div>

        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }}
            disabled={saving || (!isEdit && (!rawText || existingMatchName !== null))}
            onClick={handleSave}
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Save PO Format"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  textarea: { fontFamily: "inherit", resize: "vertical" },
  dropZone: { border: `2px dashed ${colors.inputBorder}`, borderRadius: 10, padding: "1.5rem 1rem", textAlign: "center", cursor: "pointer", backgroundColor: colors.inputBg, transition: "border-color 0.2s, background-color 0.2s" },
  sectionTitle: { margin: "0.5rem 0 0.25rem", fontSize: "0.95rem", fontWeight: 600, color: colors.textPrimary },
  sectionHint: { margin: "0 0 0.75rem", fontSize: "0.82rem", color: colors.textSecondary },
  hint: { marginTop: "0.25rem", fontSize: "0.78rem", color: colors.textSecondary, fontStyle: "italic" },
  errorAlert: { display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.6rem 0.85rem", borderRadius: 8, backgroundColor: colors.dangerLight, color: colors.danger, marginBottom: "1rem", fontSize: "0.85rem", fontWeight: 500 },
  infoAlert: { display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.6rem 0.85rem", borderRadius: 8, backgroundColor: colors.warningLight, color: "#8a5a00", marginBottom: "1rem", fontSize: "0.85rem" },
  companyChip: { display: "inline-flex", alignItems: "center", gap: "0.35rem", marginBottom: "1rem", padding: "0.3rem 0.7rem", borderRadius: 6, backgroundColor: colors.primaryLight, color: colors.primary, fontSize: "0.82rem" },
};
