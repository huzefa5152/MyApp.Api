import { useState, useRef } from "react";
import {
  MdClose, MdCloudUpload, MdDownload, MdCheckCircle, MdWarning, MdErrorOutline,
} from "react-icons/md";
import {
  downloadClientImportTemplate,
  previewClientImport,
  commitClientImport,
} from "../api/clientImportApi";
import { notify } from "../utils/notify";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBorder: "#d0d7e2",
  ok: "#1b7f4f",
  okBg: "#eaf7f0",
  warn: "#8a6d3b",
  warnBg: "#fdf6e3",
  danger: "#c02b2b",
  dangerBg: "#fdeeee",
};

const STATUS = {
  New: { label: "Will be added", color: colors.ok, bg: colors.okBg, Icon: MdCheckCircle },
  Duplicate: { label: "Already exists", color: colors.warn, bg: colors.warnBg, Icon: MdWarning },
  Error: { label: "Cannot import", color: colors.danger, bg: colors.dangerBg, Icon: MdErrorOutline },
};

/**
 * Import many clients at once from a spreadsheet.
 *
 * Deliberately two steps. An onboarding sheet with 200 customers always has
 * something wrong in it — a blank name, the same shop typed twice, a customer
 * already in the system — so the operator reviews a per-row verdict before
 * anything is written. Duplicates are skipped rather than overwritten, which
 * is what makes re-uploading an updated sheet safe.
 */
export default function ClientImportModal({ companyId, companyName, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const getTemplate = async () => {
    try {
      const { data } = await downloadClientImportTemplate();
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "client-import-template.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      notify("Could not download the sample file.", "error");
    }
  };

  const choose = async (f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setPreview(null);
    setParsing(true);
    try {
      const { data } = await previewClientImport(companyId, f);
      setPreview(data);
      if (data?.fileMessages?.length && data.totalRows === 0) {
        notify(data.fileMessages[0], "error");
      }
    } catch (err) {
      notify(err?.response?.data?.message || "That file could not be read.", "error");
      setFile(null);
    } finally {
      setParsing(false);
    }
  };

  const runImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const { data } = await commitClientImport(companyId, preview.rows, false);
      setResult(data);
      notify(
        `Imported ${data.created} client${data.created === 1 ? "" : "s"}` +
          (data.skippedDuplicates ? `, skipped ${data.skippedDuplicates} already on file` : ""),
        data.created > 0 ? "success" : "info",
      );
      onImported?.(data);
    } catch (err) {
      notify(err?.response?.data?.message || "The import could not be completed.", "error");
    } finally {
      setImporting(false);
    }
  };

  const busy = parsing || importing;
  const canImport = !!preview && preview.newCount > 0 && !result;

  return (
    <div style={styles.backdrop} onClick={busy ? undefined : onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.head}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <MdCloudUpload size={22} color={colors.blue} />
            <div>
              <h3 style={styles.title}>Import clients</h3>
              {companyName && <div style={styles.subtitle}>into {companyName}</div>}
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} style={styles.iconBtn} aria-label="Close">
            <MdClose size={20} />
          </button>
        </div>

        <div style={styles.body}>
          <div style={styles.stepRow}>
            <div style={styles.stepText}>
              <strong>1. Start from the sample file.</strong> It has the column headings this
              screen expects and two filled-in examples. Keep the heading row, replace the
              examples with your customers, and save it as CSV or Excel.
            </div>
            <button type="button" style={styles.secondaryBtn} onClick={getTemplate}>
              <MdDownload size={16} /> Sample CSV
            </button>
          </div>

          <div
            style={{ ...styles.drop, ...(dragOver ? styles.dropOver : null) }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); choose(e.dataTransfer.files?.[0]); }}
            onClick={() => !busy && inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xlsm"
              style={{ display: "none" }}
              onChange={(e) => choose(e.target.files?.[0])}
            />
            <MdCloudUpload size={26} color={colors.textSecondary} />
            <div>
              <strong>2. {file ? file.name : "Choose your file"}</strong>
              <div style={styles.hint}>
                {parsing ? "Reading…" : "CSV or Excel, up to 5 MB. Drop it here or click to browse."}
              </div>
            </div>
          </div>

          {preview?.fileMessages?.length > 0 && (
            <ul style={styles.fileMessages}>
              {preview.fileMessages.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}

          {preview && preview.totalRows > 0 && !result && (
            <>
              <div style={styles.tallies}>
                <Tally label="Rows read" value={preview.totalRows} />
                <Tally label="Will be added" value={preview.newCount} tone={colors.ok} />
                <Tally label="Already exist" value={preview.duplicateCount} tone={colors.warn} />
                <Tally label="Cannot import" value={preview.errorCount} tone={colors.danger} />
              </div>
              <p style={styles.reviewNote}>
                <strong>3. Review.</strong> Customers already on file are skipped, so importing
                an updated sheet only adds what is new.
              </p>
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>#</th>
                      <th style={styles.th}>Name</th>
                      <th style={styles.th}>NTN / CNIC</th>
                      <th style={styles.th}>Phone</th>
                      <th style={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => {
                      const s = STATUS[r.status] || STATUS.New;
                      return (
                        <tr key={r.rowNumber}>
                          <td style={styles.td}>{r.rowNumber}</td>
                          <td style={styles.tdName} title={r.name || ""}>{r.name || "—"}</td>
                          <td style={styles.td}>{r.ntn || r.cnic || "—"}</td>
                          <td style={styles.td}>{r.phone || "—"}</td>
                          <td style={styles.td}>
                            <span style={{ ...styles.badge, color: s.color, background: s.bg }}>
                              <s.Icon size={13} /> {s.label}
                            </span>
                            {r.messages?.length > 0 && (
                              <div style={styles.rowMsg}>{r.messages.join(" ")}</div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result && (
            <div style={styles.result}>
              <div style={styles.resultTitle}>
                <MdCheckCircle size={18} color={colors.ok} /> Import completed
              </div>
              <div style={styles.tallies}>
                <Tally label="Clients created" value={result.created} tone={colors.ok} />
                <Tally label="Skipped (already on file)" value={result.skippedDuplicates} tone={colors.warn} />
                <Tally label="Failed" value={result.failed} tone={colors.danger} />
              </div>
              {result.errors?.length > 0 && (
                <ul style={styles.fileMessages}>
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <div style={styles.foot}>
          <button type="button" onClick={onClose} disabled={busy} style={styles.secondaryBtn}>
            {result ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={runImport}
            disabled={!canImport || busy}
            style={{ ...styles.primaryBtn, opacity: !canImport || busy ? 0.6 : 1 }}
          >
            {importing
              ? "Importing…"
              : preview
                ? `Import ${preview.newCount} client${preview.newCount === 1 ? "" : "s"}`
                : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tally({ label, value, tone }) {
  return (
    <div style={styles.tally}>
      <div style={{ ...styles.tallyValue, color: tone || colors.textPrimary }}>
        {Number(value ?? 0).toLocaleString()}
      </div>
      <div style={styles.tallyLabel}>{label}</div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(16,24,40,0.5)", display: "flex",
    alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 1200,
  },
  modal: {
    background: "#fff", borderRadius: 14, width: "100%", maxWidth: 720,
    maxHeight: "92vh", display: "flex", flexDirection: "column",
    boxShadow: "0 18px 48px rgba(16,24,40,0.24)",
  },
  head: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "1rem 1.1rem", borderBottom: `1px solid ${colors.cardBorder}`,
  },
  title: { margin: 0, fontSize: "1.05rem", color: colors.textPrimary },
  subtitle: { fontSize: "0.8rem", color: colors.textSecondary },
  iconBtn: {
    display: "grid", placeItems: "center", width: 36, height: 36, border: "none",
    background: "transparent", borderRadius: 8, cursor: "pointer", color: colors.textSecondary,
  },
  body: { padding: "1.1rem", overflowY: "auto", display: "grid", gap: "0.9rem" },
  stepRow: {
    display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap",
    justifyContent: "space-between", fontSize: "0.85rem", lineHeight: 1.5,
    color: colors.textPrimary,
  },
  stepText: { flex: "1 1 320px", minWidth: 0 },
  drop: {
    display: "flex", gap: "0.8rem", alignItems: "center", padding: "1rem",
    border: `2px dashed ${colors.inputBorder}`, borderRadius: 12, cursor: "pointer",
    fontSize: "0.88rem", color: colors.textPrimary, background: "#fbfcfe",
  },
  dropOver: { borderColor: colors.blue, background: "#f2f7ff" },
  hint: { fontSize: "0.78rem", color: colors.textSecondary, marginTop: "0.15rem", lineHeight: 1.4 },
  fileMessages: {
    margin: 0, paddingLeft: "1.1rem", fontSize: "0.8rem", color: colors.warn, lineHeight: 1.45,
  },
  tallies: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))",
    gap: "0.5rem",
  },
  tally: {
    border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.55rem 0.7rem",
  },
  tallyValue: { fontSize: "1.15rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  tallyLabel: { fontSize: "0.75rem", color: colors.textSecondary, marginTop: "0.1rem" },
  reviewNote: { margin: 0, fontSize: "0.83rem", color: colors.textPrimary, lineHeight: 1.5 },
  tableWrap: {
    border: `1px solid ${colors.cardBorder}`, borderRadius: 10,
    maxHeight: 300, overflowY: "auto", overflowX: "auto",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 520 },
  th: {
    position: "sticky", top: 0, background: "#f6f8fb", textAlign: "left",
    padding: "0.5rem 0.6rem", fontSize: "0.72rem", textTransform: "uppercase",
    letterSpacing: "0.03em", color: colors.textSecondary, borderBottom: `1px solid ${colors.cardBorder}`,
  },
  td: { padding: "0.45rem 0.6rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "top" },
  tdName: {
    padding: "0.45rem 0.6rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "top",
    maxWidth: 200,
    // Never nowrap+ellipsis on customer names — "MEKO FABRICS" and
    // "MEKO DENIM" must stay distinguishable (see the dashboard incident).
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  badge: {
    display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.15rem 0.45rem",
    borderRadius: 999, fontSize: "0.73rem", fontWeight: 600, whiteSpace: "nowrap",
  },
  rowMsg: { fontSize: "0.72rem", color: colors.textSecondary, marginTop: "0.2rem", lineHeight: 1.35 },
  result: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.85rem", display: "grid", gap: "0.6rem" },
  resultTitle: {
    display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700,
    fontSize: "0.92rem", color: colors.textPrimary,
  },
  foot: {
    display: "flex", justifyContent: "flex-end", gap: "0.6rem",
    padding: "0.85rem 1.1rem", borderTop: `1px solid ${colors.cardBorder}`,
  },
  secondaryBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.35rem",
    padding: "0.55rem 1rem", borderRadius: 10, border: `1px solid ${colors.inputBorder}`,
    background: "#fff", color: colors.textPrimary, fontSize: "0.86rem", fontWeight: 600, cursor: "pointer",
  },
  primaryBtn: {
    padding: "0.55rem 1.2rem", borderRadius: 10, border: "none",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff",
    fontSize: "0.86rem", fontWeight: 600, cursor: "pointer",
  },
};
