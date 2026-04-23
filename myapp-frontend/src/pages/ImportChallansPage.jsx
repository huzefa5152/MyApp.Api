import { useState, useEffect, useMemo } from "react";
import { MdFileUpload, MdCheckCircle, MdError, MdDelete, MdArrowBack, MdDownload } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { getClientsByCompany } from "../api/clientApi";
import { hasExcelTemplate } from "../api/printTemplateApi";
import { previewChallanImport, commitChallanImport } from "../api/challanImportApi";
import { notify } from "../utils/notify";

const colors = {
  blue: "#0d47a1",
  blueLight: "#1565c0",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  success: "#28a745",
  successLight: "#e8f5e9",
  warning: "#f59f00",
  warningLight: "#fff8e1",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

// A file is recognized as a Delivery Challan if its name starts with
// "DC #" (or "DC#") followed by a number. The rest of the filename is
// free-form — operators name them however they like. If the prefix +
// number is present we also extract the number for a later cross-check
// against the value parsed out of the file's cells.
const DC_FILENAME_REGEX = /^\s*DC\s*#?\s*(\d+)/i;

export function parseDcFilename(name) {
  const m = DC_FILENAME_REGEX.exec(name || "");
  if (!m) return null;
  return { challanNumber: parseInt(m[1], 10) };
}

/* ------------------------------------------------------------------ */
/*  Import Historical Challans — two-step wizard                       */
/*                                                                    */
/*   Step 1: pick target company + drop files → call /preview          */
/*   Step 2: edit rows in the grid + click "Confirm Import" → /commit  */
/*   Step 3: show per-file results                                     */
/*                                                                    */
/*  NOTE: the target company is chosen locally on this page — NOT      */
/*  from the global header context — because its Challan template is   */
/*  what the backend uses to know where each cell's data lives.        */
/*  Picking the wrong company = wrong cell map = garbage preview.      */
/* ------------------------------------------------------------------ */
export default function ImportChallansPage() {
  const { companies, selectedCompany } = useCompany();

  // Target company: defaults to the globally-selected one but user can
  // override without polluting the rest of the app.
  const [targetCompany, setTargetCompany] = useState(selectedCompany || null);

  const [step, setStep] = useState(1); // 1 = upload, 2 = review, 3 = results
  const [files, setFiles] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [results, setResults] = useState([]);
  const [clients, setClients] = useState([]);
  const [templateReady, setTemplateReady] = useState(null); // null = checking
  const [loading, setLoading] = useState(false);

  // Keep targetCompany in sync the first time companies load; after that
  // the user is in charge.
  useEffect(() => {
    if (!targetCompany && (selectedCompany || companies?.[0])) {
      setTargetCompany(selectedCompany || companies[0]);
    }
  }, [companies, selectedCompany, targetCompany]);

  useEffect(() => {
    if (!targetCompany) return;
    setTemplateReady(null);
    hasExcelTemplate(targetCompany.id, "Challan")
      .then(({ data }) => setTemplateReady(!!data.hasExcelTemplate))
      .catch(() => setTemplateReady(false));
    getClientsByCompany(targetCompany.id)
      .then(({ data }) => setClients(data || []))
      .catch(() => setClients([]));
  }, [targetCompany]);

  const reset = () => {
    setFiles([]);
    setPreviewRows([]);
    setResults([]);
    setStep(1);
  };

  // ── Step 1 → 2 ─────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!targetCompany) return;
    if (!files.length) {
      notify("Please select at least one file.", "warning");
      return;
    }
    setLoading(true);
    try {
      const { data } = await previewChallanImport(targetCompany.id, files);
      // Cross-check: does the parsed challan number from the cell match the
      // number in the filename? If the filename is DC-patterned and the
      // numbers diverge, surface it so the operator can investigate.
      const annotated = (data || []).map((r) => {
        const fromName = parseDcFilename(r.fileName);
        const warnings = [...(r.warnings || [])];
        if (!fromName) {
          warnings.push("Filename doesn't start with 'DC #' — not recognized as a Delivery Challan file.");
        } else if (fromName.challanNumber && r.challanNumber && fromName.challanNumber !== r.challanNumber) {
          warnings.push(
            `Filename says #${fromName.challanNumber} but the file's cell says #${r.challanNumber}. Please confirm.`
          );
        }
        return { ...r, warnings };
      });
      setPreviewRows(annotated);
      setStep(2);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to parse files.", "error");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2 → 3 ─────────────────────────────────────────────────────
  const handleCommit = async () => {
    if (!targetCompany) return;
    const wrongCo = previewRows.find((r) => r.wrongCompany);
    if (wrongCo) {
      notify(
        `"${wrongCo.fileName}" is for a different company. Remove it or switch the target company before importing.`,
        "error"
      );
      return;
    }
    const dupe = previewRows.find((r) => r.alreadyExists);
    if (dupe) {
      notify(
        `Challan #${dupe.challanNumber} (from "${dupe.fileName}") is already in the system. Change the number or remove this row before importing.`,
        "warning"
      );
      return;
    }
    const invalid = previewRows.find(
      (r) => !r.challanNumber || !r.clientId || !r.items?.length
    );
    if (invalid) {
      notify(
        `Row "${invalid.fileName}" is incomplete — fix challan number, client, and at least one item.`,
        "warning"
      );
      return;
    }
    setLoading(true);
    try {
      const { data } = await commitChallanImport(targetCompany.id, previewRows);
      setResults(data || []);
      setStep(3);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to import.", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!companies || companies.length === 0) {
    return (
      <div style={styles.empty}>
        <MdFileUpload size={48} color={colors.textSecondary} />
        <p>No companies available. Please create one first.</p>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Import Historical Challans</h2>
          <p style={styles.subtitle}>
            Upload old Excel challan files — we'll read them using this company's
            print template and let you review before importing.
          </p>
        </div>
        {step > 1 && (
          <button style={styles.secondaryBtn} onClick={reset}>
            <MdArrowBack /> Start over
          </button>
        )}
      </div>

      <Stepper step={step} />

      {templateReady === false && step === 1 && targetCompany && (
        <div style={styles.warnBanner}>
          <MdError /> No Challan Excel template is configured for{" "}
          <b>{targetCompany.name}</b>. Please upload one in{" "}
          <i>Configuration → Print Templates</i> before importing.
        </div>
      )}

      {step === 1 && (
        <UploadStep
          companies={companies}
          targetCompany={targetCompany}
          setTargetCompany={setTargetCompany}
          templateReady={templateReady}
          files={files}
          setFiles={setFiles}
          onNext={handleUpload}
          disabled={loading || templateReady !== true || !targetCompany}
          loading={loading}
        />
      )}

      {step === 2 && (
        <ReviewStep
          rows={previewRows}
          setRows={setPreviewRows}
          clients={clients}
          onBack={() => setStep(1)}
          onCommit={handleCommit}
          loading={loading}
        />
      )}

      {step === 3 && <ResultsStep results={results} onRestart={reset} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Stepper({ step }) {
  const items = [
    { n: 1, label: "Upload Files" },
    { n: 2, label: "Review & Edit" },
    { n: 3, label: "Results" },
  ];
  return (
    <div style={styles.stepper}>
      {items.map((it, idx) => (
        <div key={it.n} style={styles.stepWrap}>
          <div
            style={{
              ...styles.stepDot,
              ...(step >= it.n ? styles.stepDotActive : {}),
            }}
          >
            {step > it.n ? <MdCheckCircle size={20} /> : it.n}
          </div>
          <span
            style={{
              ...styles.stepLabel,
              fontWeight: step === it.n ? 700 : 500,
              color: step >= it.n ? colors.blue : colors.textSecondary,
            }}
          >
            {it.label}
          </span>
          {idx < items.length - 1 && (
            <div
              style={{
                ...styles.stepLine,
                background: step > it.n ? colors.blue : colors.inputBorder,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function UploadStep({
  companies,
  targetCompany,
  setTargetCompany,
  templateReady,
  files,
  setFiles,
  onNext,
  disabled,
  loading,
}) {
  const onDrop = (e) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    addFiles(dropped);
  };
  const addFiles = (picked) => {
    // Hard gate 1: extension must be a spreadsheet format.
    // Hard gate 2: filename must start with "DC #" — the import feature is
    // only for Delivery Challans, not Bills/Invoices. Accepting anything
    // else would lead to confusing parse failures and (worse) possibly
    // committing wrong data. Reject up-front with a clear notification.
    const extOk = picked.filter((f) => /\.(xls|xlsx|xlsm)$/i.test(f.name));
    const extRejected = picked.length - extOk.length;
    if (extRejected > 0) {
      notify(`${extRejected} file(s) skipped — only .xls, .xlsx, .xlsm allowed.`, "warning");
    }
    const dcOk = extOk.filter((f) => parseDcFilename(f.name));
    const dcRejected = extOk.length - dcOk.length;
    if (dcRejected > 0) {
      notify(
        `${dcRejected} file(s) skipped — filename must start with "DC #" (e.g. "DC # 1073 ClientName.xls"). Only Delivery Challan files are accepted.`,
        "error"
      );
    }
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...dcOk.filter((f) => !seen.has(f.name + f.size))];
    });
  };
  const removeFile = (idx) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const misnamedCount = files.filter((f) => !parseDcFilename(f.name)).length;

  return (
    <div style={styles.card}>
      {/* Company picker — each company has its OWN Challan template, and */}
      {/* the template dictates where fields live. Picking the wrong one   */}
      {/* means the parser reads garbage. Surfacing this explicitly        */}
      {/* prevents quiet mistakes.                                         */}
      <div style={styles.companyPickerWrap}>
        <label style={styles.fieldLabel}>Target Company</label>
        <select
          value={targetCompany?.id ?? ""}
          onChange={(e) => {
            const picked = companies.find((c) => c.id === parseInt(e.target.value));
            setTargetCompany(picked || null);
            setFiles([]);   // start over — old files may be wrong-template
          }}
          style={{ ...styles.input, maxWidth: "320px" }}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <small style={styles.companyPickerHint}>
          {templateReady === null && "Checking template..."}
          {templateReady === true && (
            <span style={{ color: colors.success }}>
              ✓ Challan template ready — files will be parsed using this company's layout.
            </span>
          )}
          {templateReady === false && (
            <span style={{ color: colors.danger }}>
              ✗ No Challan template uploaded for this company yet.
            </span>
          )}
        </small>
      </div>

      <div
        style={{
          ...styles.dropzone,
          opacity: templateReady === true ? 1 : 0.55,
          pointerEvents: templateReady === true ? "auto" : "none",
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <MdFileUpload size={40} color={colors.blue} />
        <p style={{ margin: "0.6rem 0 0.2rem", fontWeight: 600 }}>
          Drop Excel files here
        </p>
        <p style={{ margin: 0, fontSize: "0.85rem", color: colors.textSecondary }}>
          Filename should start with <code>DC #</code> • .xls, .xlsx, .xlsm
        </p>
        <label style={{ ...styles.primaryBtn, marginTop: "1rem" }}>
          Browse files
          <input
            type="file"
            multiple
            accept=".xls,.xlsx,.xlsm"
            style={{ display: "none" }}
            onChange={(e) => addFiles(Array.from(e.target.files))}
          />
        </label>
      </div>

      {files.length > 0 && (
        <div style={{ marginTop: "1.2rem" }}>
          <div style={styles.filesHeader}>
            <span>
              {files.length} file(s) selected
              {misnamedCount > 0 && (
                <span style={{ color: colors.warning, marginLeft: "0.6rem", fontSize: "0.85rem" }}>
                  ({misnamedCount} don't start with "DC #")
                </span>
              )}
            </span>
            <button style={styles.linkBtn} onClick={() => setFiles([])}>
              Clear all
            </button>
          </div>
          <ul style={styles.fileList}>
            {files.map((f, i) => {
              const parsed = parseDcFilename(f.name);
              return (
                <li key={i} style={styles.fileRow}>
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: "0.9rem", wordBreak: "break-all" }}>{f.name}</span>
                    {parsed ? (
                      <small style={{ color: colors.textSecondary }}>
                        Challan #{parsed.challanNumber}
                      </small>
                    ) : (
                      <small style={{ color: colors.warning }}>
                        ⚠ Doesn't start with "DC #" — this may not be a Delivery Challan file.
                      </small>
                    )}
                  </div>
                  <span style={{ color: colors.textSecondary, fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                    {(f.size / 1024).toFixed(1)} KB
                  </span>
                  <button style={styles.iconBtn} onClick={() => removeFile(i)}>
                    <MdDelete />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div style={styles.footerBtns}>
        <button
          style={{ ...styles.primaryBtn, opacity: disabled || !files.length ? 0.55 : 1 }}
          disabled={disabled || !files.length}
          onClick={onNext}
        >
          {loading ? "Parsing..." : `Preview ${files.length} file(s)`}
        </button>
      </div>
    </div>
  );
}

function ReviewStep({ rows, setRows, clients, onBack, onCommit, loading }) {
  const updateRow = (idx, patch) =>
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const merged = { ...r, ...patch };
        // If the user just edited the challan number on a row that was flagged
        // as a duplicate, optimistically clear the flag. They're signalling
        // they want a different number; commit-time validation will re-check.
        if ("challanNumber" in patch && r.alreadyExists && patch.challanNumber !== r.challanNumber) {
          merged.alreadyExists = false;
          merged.warnings = (r.warnings || []).filter(
            (w) => !/is already in the system/i.test(w)
          );
        }
        return merged;
      })
    );

  const updateItem = (rowIdx, itemIdx, patch) =>
    setRows((prev) =>
      prev.map((r, i) =>
        i === rowIdx
          ? {
              ...r,
              items: r.items.map((it, j) => (j === itemIdx ? { ...it, ...patch } : it)),
            }
          : r
      )
    );

  const removeItem = (rowIdx, itemIdx) =>
    setRows((prev) =>
      prev.map((r, i) =>
        i === rowIdx
          ? { ...r, items: r.items.filter((_, j) => j !== itemIdx) }
          : r
      )
    );

  const addItem = (rowIdx) =>
    setRows((prev) =>
      prev.map((r, i) =>
        i === rowIdx
          ? { ...r, items: [...(r.items || []), { description: "", quantity: 0, unit: "" }] }
          : r
      )
    );

  const removeRow = (idx) =>
    setRows((prev) => prev.filter((_, i) => i !== idx));

  const validCount = useMemo(
    () => rows.filter((r) => r.challanNumber && r.clientId && r.items?.length && !r.alreadyExists && !r.wrongCompany).length,
    [rows]
  );
  const duplicateCount = useMemo(() => rows.filter((r) => r.alreadyExists).length, [rows]);
  const wrongCompanyCount = useMemo(() => rows.filter((r) => r.wrongCompany).length, [rows]);

  return (
    <div style={styles.card}>
      <div style={styles.reviewHeader}>
        <span>
          <b>{rows.length}</b> file(s) parsed • <b style={{ color: validCount === rows.length ? colors.success : colors.warning }}>
            {validCount}</b> ready to import
          {duplicateCount > 0 && (
            <span style={{ color: colors.danger, marginLeft: "0.5rem" }}>
              • <b>{duplicateCount}</b> already in system
            </span>
          )}
          {wrongCompanyCount > 0 && (
            <span style={{ color: colors.danger, marginLeft: "0.5rem" }}>
              • <b>{wrongCompanyCount}</b> wrong company
            </span>
          )}
        </span>
      </div>

      {rows.map((row, rowIdx) => {
        const isWrongCo = !!row.wrongCompany;
        const isDup = !!row.alreadyExists;
        const isBlocked = isWrongCo || isDup;
        const isValid = !isBlocked && row.challanNumber && row.clientId && row.items?.length;
        const borderColor = isBlocked ? colors.danger : (isValid ? colors.cardBorder : colors.warning);
        return (
          <div
            key={rowIdx}
            style={{
              ...styles.rowCard,
              borderColor,
            }}
          >
            <div style={styles.rowHead}>
              <div>
                <span style={styles.fileLabel}>{row.fileName}</span>
                {isWrongCo ? (
                  <span style={{ ...styles.rowWarn, background: colors.dangerLight, color: colors.danger }}>
                    Wrong company
                  </span>
                ) : isDup ? (
                  <span style={{ ...styles.rowWarn, background: colors.dangerLight, color: colors.danger }}>
                    Already imported
                  </span>
                ) : !isValid ? (
                  <span style={styles.rowWarn}>Needs attention</span>
                ) : null}
              </div>
              <button style={styles.iconBtn} onClick={() => removeRow(rowIdx)}>
                <MdDelete />
              </button>
            </div>

            {isWrongCo && (
              <div style={{ ...styles.warnStrip, background: colors.dangerLight, color: colors.danger, fontWeight: 600 }}>
                ✗ This Excel file is for a different company. Remove this row, or switch the
                target company on the upload step, before importing.
              </div>
            )}

            {isDup && !isWrongCo && (
              <div style={{ ...styles.warnStrip, background: colors.dangerLight, color: colors.danger, fontWeight: 600 }}>
                ✗ Challan #{row.challanNumber} already exists in the system for this company.
                Change the number to a different value (or remove this row) to import.
              </div>
            )}

            {row.warnings?.length > 0 && !isDup && !isWrongCo && (
              <div style={styles.warnStrip}>
                {row.warnings.map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}

            <div style={styles.fieldsGrid}>
              <Field label="Challan #">
                <input
                  type="number"
                  value={row.challanNumber || ""}
                  onChange={(e) => updateRow(rowIdx, { challanNumber: parseInt(e.target.value) || 0 })}
                  style={styles.input}
                />
              </Field>
              <Field label="Client">
                <select
                  value={row.clientId || ""}
                  onChange={(e) => updateRow(rowIdx, { clientId: parseInt(e.target.value) || null })}
                  style={styles.input}
                >
                  <option value="">— pick client —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {row.clientNameRaw && !row.clientId && (
                  <small style={{ color: colors.warning }}>
                    File said: "{row.clientNameRaw}"
                  </small>
                )}
              </Field>
              <Field label="Delivery Date">
                <input
                  type="date"
                  value={toInputDate(row.deliveryDate)}
                  onChange={(e) => updateRow(rowIdx, { deliveryDate: e.target.value || null })}
                  style={styles.input}
                />
              </Field>
              <Field label="PO Number">
                <input
                  value={row.poNumber || ""}
                  onChange={(e) => updateRow(rowIdx, { poNumber: e.target.value })}
                  style={styles.input}
                />
              </Field>
              <Field label="PO Date">
                <input
                  type="date"
                  value={toInputDate(row.poDate)}
                  onChange={(e) => updateRow(rowIdx, { poDate: e.target.value || null })}
                  style={styles.input}
                />
              </Field>
              <Field label="Site">
                <input
                  value={row.site || ""}
                  onChange={(e) => updateRow(rowIdx, { site: e.target.value })}
                  style={styles.input}
                />
              </Field>
            </div>

            <div style={{ marginTop: "0.9rem" }}>
              <div style={styles.itemsHeader}>
                <span style={{ fontWeight: 600 }}>Items ({row.items?.length || 0})</span>
                <button style={styles.linkBtn} onClick={() => addItem(rowIdx)}>
                  + Add item
                </button>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={styles.itemTable}>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th style={{ width: "90px" }}>Qty</th>
                      <th style={{ width: "100px" }}>Unit</th>
                      <th style={{ width: "40px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(row.items || []).map((it, itemIdx) => (
                      <tr key={itemIdx}>
                        <td>
                          <input
                            value={it.description}
                            onChange={(e) => updateItem(rowIdx, itemIdx, { description: e.target.value })}
                            style={styles.cellInput}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={it.quantity}
                            onChange={(e) => updateItem(rowIdx, itemIdx, { quantity: parseInt(e.target.value) || 0 })}
                            style={styles.cellInput}
                          />
                        </td>
                        <td>
                          <input
                            value={it.unit}
                            onChange={(e) => updateItem(rowIdx, itemIdx, { unit: e.target.value })}
                            style={styles.cellInput}
                          />
                        </td>
                        <td>
                          <button style={styles.iconBtn} onClick={() => removeItem(rowIdx, itemIdx)}>
                            <MdDelete />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(!row.items || row.items.length === 0) && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: "center", color: colors.textSecondary, padding: "0.8rem" }}>
                          No items. Click "+ Add item" to create one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}

      <div style={styles.footerBtns}>
        <button style={styles.secondaryBtn} onClick={onBack}>Back</button>
        <button
          style={{ ...styles.primaryBtn, opacity: loading || validCount === 0 ? 0.6 : 1 }}
          disabled={loading || validCount === 0}
          onClick={onCommit}
        >
          {loading ? "Importing..." : `Confirm Import (${validCount})`}
        </button>
      </div>
    </div>
  );
}

function ResultsStep({ results, onRestart }) {
  const success = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  return (
    <div style={styles.card}>
      <div style={styles.resultSummary}>
        <div style={{ ...styles.summaryBox, background: colors.successLight, color: colors.success }}>
          <MdCheckCircle size={28} />
          <div>
            <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{success.length}</div>
            <div>Imported</div>
          </div>
        </div>
        <div style={{ ...styles.summaryBox, background: colors.dangerLight, color: colors.danger }}>
          <MdError size={28} />
          <div>
            <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{failed.length}</div>
            <div>Failed</div>
          </div>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={styles.itemTable}>
          <thead>
            <tr>
              <th>File</th>
              <th>Challan #</th>
              <th>Status</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r.fileName}</td>
                <td>{r.challanNumber}</td>
                <td>
                  {r.success ? (
                    <span style={{ color: colors.success, fontWeight: 600 }}>✓ Success</span>
                  ) : (
                    <span style={{ color: colors.danger, fontWeight: 600 }}>✗ Failed</span>
                  )}
                </td>
                <td style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>
                  {r.error || (r.insertedId ? `ID ${r.insertedId}` : "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={styles.footerBtns}>
        <button style={styles.primaryBtn} onClick={onRestart}>Import more</button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function toInputDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const styles = {
  wrap: { padding: "1rem", maxWidth: "1100px", margin: "0 auto" },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    marginBottom: "0.6rem",
    flexWrap: "wrap",
  },
  title: { margin: 0, fontSize: "1.6rem", fontWeight: 700, color: colors.blue },
  subtitle: { margin: "0.3rem 0 0", color: colors.textSecondary, fontSize: "0.9rem" },
  empty: {
    padding: "3rem", textAlign: "center", color: colors.textSecondary,
    display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem",
  },
  stepper: {
    display: "flex", alignItems: "center", gap: "0.4rem", margin: "1rem 0 1.2rem",
    padding: "0.7rem 1rem", background: "#fff", border: `1px solid ${colors.cardBorder}`,
    borderRadius: "10px", overflowX: "auto",
  },
  stepWrap: { display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 },
  stepDot: {
    width: "28px", height: "28px", borderRadius: "50%",
    background: colors.inputBg, color: colors.textSecondary,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 700, fontSize: "0.85rem",
    border: `2px solid ${colors.inputBorder}`,
  },
  stepDotActive: { background: colors.blue, color: "#fff", borderColor: colors.blue },
  stepLabel: { fontSize: "0.85rem" },
  stepLine: { height: "2px", width: "2rem" },
  card: {
    background: "#fff", border: `1px solid ${colors.cardBorder}`,
    borderRadius: "12px", padding: "1.3rem",
    boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
  },
  companyPickerWrap: {
    display: "flex", flexDirection: "column", gap: "0.3rem",
    padding: "0.9rem 1rem",
    background: colors.inputBg, borderRadius: "10px",
    marginBottom: "1rem",
    border: `1px solid ${colors.inputBorder}`,
  },
  companyPickerHint: {
    fontSize: "0.8rem", color: colors.textSecondary,
  },
  dropzone: {
    border: `2px dashed ${colors.inputBorder}`,
    borderRadius: "10px", padding: "2rem 1rem",
    textAlign: "center", background: colors.inputBg,
    display: "flex", flexDirection: "column", alignItems: "center",
  },
  filesHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "0.3rem 0", fontSize: "0.9rem", color: colors.textPrimary,
  },
  fileList: { listStyle: "none", padding: 0, margin: "0.4rem 0 0" },
  fileRow: {
    display: "flex", gap: "0.6rem", alignItems: "center", justifyContent: "space-between",
    padding: "0.55rem 0.75rem", borderRadius: "8px",
    background: colors.inputBg, marginBottom: "0.3rem", fontSize: "0.9rem",
  },
  warnBanner: {
    background: colors.warningLight, color: "#8a6d00",
    border: `1px solid ${colors.warning}`, borderRadius: "8px",
    padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.5rem",
    marginBottom: "1rem",
  },
  reviewHeader: {
    borderBottom: `1px solid ${colors.cardBorder}`,
    paddingBottom: "0.7rem", marginBottom: "1rem",
    fontSize: "0.95rem", color: colors.textPrimary,
  },
  rowCard: {
    border: `2px solid ${colors.cardBorder}`, borderRadius: "10px",
    padding: "1rem", marginBottom: "1rem", background: colors.inputBg,
  },
  rowHead: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: "0.6rem",
  },
  fileLabel: { fontWeight: 600, fontSize: "0.95rem", color: colors.blue, marginRight: "0.6rem" },
  rowWarn: {
    display: "inline-block", background: colors.warningLight, color: "#8a6d00",
    padding: "2px 8px", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 600,
  },
  warnStrip: {
    background: colors.warningLight, color: "#8a6d00",
    borderRadius: "6px", padding: "0.5rem 0.8rem", marginBottom: "0.7rem",
    fontSize: "0.85rem", lineHeight: 1.5,
  },
  fieldsGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "0.7rem",
  },
  field: { display: "flex", flexDirection: "column", gap: "0.25rem" },
  fieldLabel: { fontSize: "0.78rem", fontWeight: 600, color: colors.textSecondary },
  input: {
    padding: "0.45rem 0.6rem", borderRadius: "6px",
    border: `1px solid ${colors.inputBorder}`, background: "#fff",
    fontSize: "0.9rem", outline: "none",
  },
  itemsHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: "0.4rem", fontSize: "0.9rem",
  },
  itemTable: {
    width: "100%", borderCollapse: "collapse", fontSize: "0.87rem",
  },
  cellInput: {
    width: "100%", padding: "0.35rem 0.5rem", borderRadius: "4px",
    border: `1px solid ${colors.inputBorder}`, background: "#fff",
    fontSize: "0.85rem", outline: "none",
  },
  footerBtns: {
    display: "flex", gap: "0.6rem", justifyContent: "flex-end",
    marginTop: "1.2rem", paddingTop: "1rem",
    borderTop: `1px solid ${colors.cardBorder}`, flexWrap: "wrap",
  },
  primaryBtn: {
    padding: "0.55rem 1.1rem", border: "none", borderRadius: "8px",
    background: colors.blue, color: "#fff", fontWeight: 600,
    cursor: "pointer", fontSize: "0.88rem",
    display: "inline-flex", alignItems: "center", gap: "0.4rem",
  },
  secondaryBtn: {
    padding: "0.5rem 1rem", borderRadius: "8px",
    border: `1px solid ${colors.inputBorder}`, background: "#fff",
    color: colors.textPrimary, fontWeight: 600, cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.88rem",
  },
  linkBtn: {
    background: "transparent", border: "none", color: colors.blueLight,
    cursor: "pointer", fontWeight: 600, fontSize: "0.85rem", padding: "0.2rem 0.4rem",
  },
  iconBtn: {
    background: "transparent", border: "none", cursor: "pointer",
    color: colors.danger, padding: "0.25rem", display: "inline-flex",
  },
  resultSummary: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "0.7rem", marginBottom: "1rem",
  },
  summaryBox: {
    display: "flex", alignItems: "center", gap: "0.7rem",
    padding: "0.9rem 1rem", borderRadius: "10px",
    fontWeight: 600,
  },
};
