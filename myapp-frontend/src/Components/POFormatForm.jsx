import { useState, useEffect, useRef } from "react";
import { MdUploadFile, MdCheckCircle, MdWarning, MdInfoOutline } from "react-icons/md";

import {
  fingerprintPdf,
  updatePoFormatMetadata,
  getPoFormatClients,
  createPoFormatSimple,
  updatePoFormatSimple,
} from "../api/poFormatApi";
import { formStyles, modalSizes } from "../theme";
import useScrollToError from "../hooks/useScrollToError";
import { Field, Alert } from "../ui/Kit";

const colors = {
  success: "#28a745",
};

// Each form is mounted for one company; changing company closes the form.
export default function POFormatForm({ format, companyId, companyName, onClose, onSaved, initialRawText = "", initialClientId = null }) {
  const isEdit = !!format;
  let metadataOnly = false;
  try { metadataOnly = isEdit && JSON.parse(format.ruleSetJson || "{}").engine !== "simple-headers-v1"; } catch { metadataOnly = isEdit; }
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState(format?.clientId ?? initialClientId);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [name, setName] = useState(format?.name || "");
  const [isActive, setIsActive] = useState(format?.isActive ?? true);

  const [poNumberLabel, setPoNumberLabel] = useState("");
  const [poDateLabel, setPoDateLabel] = useState("");
  const [descriptionHeader, setDescriptionHeader] = useState("");
  const [quantityHeader, setQuantityHeader] = useState("");
  const [unitHeader, setUnitHeader] = useState("");

  const [rawText, setRawText] = useState(initialRawText);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(!!initialRawText);
  const [existingMatchName, setExistingMatchName] = useState(null);
  const [notes, setNotes] = useState(format?.notes || "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setClientsLoading(true);
    getPoFormatClients(companyId).then(({ data }) => { if (!cancelled) setClients(data); })
      .catch(() => { if (!cancelled) setError("Unable to load this company's clients. Close the form and try again."); })
      .finally(() => { if (!cancelled) setClientsLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);
  const availableClients = clients;
  const selectedClient = availableClients.find(c => c.id === selectedClientId);

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
      // Auto-suggest a name from the selected company client.
      if (!name && selectedClient) {
        setName(`${selectedClient.name} PO`);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Failed to read PDF.");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setError("");

    if (clientsLoading || !companyId || !selectedClientId) return setError("Pick the client this format applies to.");
    if (!selectedClient?.id) {
      return setError("This client has no per-company records yet — create one first via Clients.");
    }
    if (!name.trim()) return setError("Enter a name for this format.");
    if (!metadataOnly && (!descriptionHeader.trim() || !quantityHeader.trim())) {
      return setError("Fill the Description and Quantity column headers.");
    }
    if (!isEdit && !rawText) {
      return setError("Upload a sample PDF so we can lock in the layout fingerprint.");
    }

    const representativeClientId = selectedClient.id;

    setSaving(true);
    try {
      if (metadataOnly) {
        await updatePoFormatMetadata(format.id, { name: name.trim(), isActive, notes: notes.trim() || null });
      } else if (isEdit) {
        await updatePoFormatSimple(format.id, {
          name: name.trim(),
          isActive,
          clientId: representativeClientId,
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
          clientId: representativeClientId,
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
      setError(err.response?.data?.error || err.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  // Backdrop click is a no-op so a stray click can't drop the format
  // wizard mid-fingerprint. Dismiss via the X or the Cancel button.
  return (
    <div data-admin-backdrop="" style={formStyles.backdrop}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? "Edit PO Format" : "Add PO Format"}</h5>
          <button data-admin-close="" style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <div style={{ ...formStyles.body, maxHeight: "72vh", overflowY: "auto" }}>
          {error && (
            <div ref={errRef}>
              <Alert tone="error" icon={MdWarning}>{error}</Alert>
            </div>
          )}

          {!isEdit && existingMatchName && (
            <Alert tone="warn" icon={MdInfoOutline}>
              A format already exists for this layout: <strong>{existingMatchName}</strong>. Check whether this is the format you need before adding another.
            </Alert>
          )}

          <p style={styles.hint}>Company: <strong>{companyName}</strong>. This format is private to this company.</p>
          <div className="k-form-grid" style={styles.grid}>
            <Field label="Client *" htmlFor="po-format-client">
              <select id="po-format-client" className="k-select" disabled={clientsLoading || metadataOnly}
                value={selectedClientId ?? ""}
                onChange={e => setSelectedClientId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{clientsLoading ? "Loading clients..." : "Select client"}</option>
                {availableClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {!clientsLoading && availableClients.length === 0 && <p style={styles.hint}>No available clients. Each client can have one format in this company.</p>}
            </Field>
            <Field label="Format name *" htmlFor="po-format-name">
              <input
                id="po-format-name"
                className="k-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Standard PO layout"
              />
            </Field>
          </div>

          {metadataOnly ? <p>This saved layout keeps its existing extraction rules. You can rename or deactivate it here. Import a sample with a new layout to save different Excel columns.</p> : <>
          {/* Sample PDF upload — required on create, optional on edit
              (upload replaces the stored sample and recomputes the
              fingerprint hash — useful if the client's template changed). */}
          <div style={{ marginBottom: "1rem" }}>
            <Field label={`Sample PDF ${isEdit ? "(optional — upload to replace)" : "*"}`}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
              <div style={styles.dropZone} onClick={() => fileInputRef.current?.click()}>
                <MdUploadFile size={32} color="var(--k-muted)" />
                <p style={{ margin: "0.5rem 0 0.25rem", color: "var(--k-muted)", fontSize: "var(--k-font)" }}>
                  {uploading ? "Reading PDF…" : uploaded ? <><MdCheckCircle size={16} color={colors.success} style={{ verticalAlign: "middle" }} /> Sample loaded — fill the 5 fields below</> : isEdit ? "Click to upload a new sample PDF (optional)" : "Click to upload a sample PDF"}
                </p>
                <span style={{ fontSize: "0.78rem", color: "var(--k-muted)" }}>Max 10 MB</span>
              </div>
            </Field>
          </div>

          {/* Raw text preview — helps the operator see exactly what PdfPig
              extracted so they can pick the correct label strings */}
          {rawText && (
            <div style={{ marginBottom: "1rem" }}>
              <Field label="Extracted text (for reference)">
                <textarea
                  readOnly
                  className="k-textarea"
                  style={{ fontFamily: "monospace", fontSize: "0.78rem", backgroundColor: "var(--k-surface-2)" }}
                  rows={8}
                  value={rawText}
                />
              </Field>
              <div style={styles.hint}>
                Use the exact strings you see above for the 5 fields below — they must be whole-word matches.
              </div>
            </div>
          )}

          {/* The 5 fields */}
          <h6 style={styles.sectionTitle}>Label / header strings</h6>
          <p style={styles.sectionHint}>
            Enter the exact text that appears on the PDF. Only the Description and Quantity column headers are required — the parser reads each item's description and quantity by column, so Unit and the PO labels are optional.
          </p>

          <div className="k-form-grid" style={styles.grid}>
            <Field label="PO Number label">
              <input
                className="k-input"
                value={poNumberLabel}
                onChange={(e) => setPoNumberLabel(e.target.value)}
                placeholder='e.g. "P.O. #"'
              />
            </Field>
            <Field label="PO Date label">
              <input
                className="k-input"
                value={poDateLabel}
                onChange={(e) => setPoDateLabel(e.target.value)}
                placeholder='e.g. "P.O. Date"'
              />
            </Field>
          </div>

          <div className="k-form-grid" style={styles.grid}>
            <Field label="Description column header *">
              <input
                className="k-input"
                value={descriptionHeader}
                onChange={(e) => setDescriptionHeader(e.target.value)}
                placeholder='e.g. "Item Name"'
              />
            </Field>
            <Field label="Quantity column header *">
              <input
                className="k-input"
                value={quantityHeader}
                onChange={(e) => setQuantityHeader(e.target.value)}
                placeholder='e.g. "Quantity" or "Qty"'
              />
            </Field>
            <Field label="Unit column header (optional)">
              <input
                className="k-input"
                value={unitHeader}
                onChange={(e) => setUnitHeader(e.target.value)}
                placeholder='e.g. "Unit" or "UOM" — leave blank if none'
              />
            </Field>
          </div>

          </>}
          <div style={{ marginBottom: "1rem" }}>
            <Field label="Notes (optional)">
              <textarea
                className="k-textarea"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any operator notes — which unit, branch, variant this format covers."
              />
            </Field>
          </div>

          {isEdit && (
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--k-ink)", fontSize: "var(--k-font)", cursor: "pointer" }}>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                Active — incoming PDFs matching this layout will auto-parse
              </label>
            </div>
          )}
        </div>

        <div style={formStyles.footer}>
          <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }}
            disabled={saving || uploading || clientsLoading || !selectedClient || (!isEdit && !rawText)}
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
  grid: { gap: "var(--k-gap)", marginBottom: "1rem" },
  dropZone: { border: "2px dashed var(--k-line-strong)", borderRadius: "var(--k-radius)", padding: "1.5rem 1rem", textAlign: "center", cursor: "pointer", backgroundColor: "var(--k-surface-2)", transition: "border-color 0.2s, background-color 0.2s" },
  sectionTitle: { margin: "0.5rem 0 0.25rem", fontSize: "calc(var(--k-font) + 0.05rem)", fontWeight: 600, color: "var(--k-ink)" },
  sectionHint: { margin: "0 0 0.75rem", fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  hint: { marginTop: "0.25rem", fontSize: "0.78rem", color: "var(--k-muted)", fontStyle: "italic" },
};
