// Configuration → Import Data. One workbook brings a new company's customers,
// items, suppliers and opening stock in: choose → download the sample →
// upload → review → import. Every rule lives on the server; the screen's own
// decisions are in utils/onboardingImport.js.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  MdFileDownload, MdCloudUpload, MdCheckCircle, MdWarning, MdError, MdInfo,
  MdRefresh, MdPlaylistAddCheck, MdInsertDriveFile, MdArrowForward,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import StepCard from "../Components/onboarding/StepCard";
import { colors } from "../theme";
import {
  SHEETS, allowedSheets, sheetsFromQuery, sheetsParam, summarise, rowsFor, issueLine,
  missingSheets, checklist, canImport, sampleFileName, fileProblem, sheetByKey, STATUS,
} from "../utils/onboardingImport";
import {
  downloadOnboardingSample, previewOnboardingImport, commitOnboardingImport, downloadOnboardingFixList,
} from "../api/onboardingImportApi";

const STAGES = ["choose", "sample", "upload", "review", "done"];
const ROW_PAGE = 100;

const errorText = (err, fallback) => err?.response?.data?.message || fallback;

// The server answers in its import order (items before opening stock); the
// screen shows sheets in the order step 1 lists them.
const inDisplayOrder = (sheets) =>
  SHEETS.map((meta) => (sheets || []).find((s) => s.key === meta.key)).filter(Boolean);

export default function OnboardingImportPage() {
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const location = useLocation();
  const fileInput = useRef(null);

  const allowed = useMemo(() => allowedSheets(has), [has]);
  const allowedKeys = useMemo(() => allowed.map((s) => s.key), [allowed]);

  const [selected, setSelected] = useState(() => sheetsFromQuery(location.search, allowedKeys));
  const [stage, setStage] = useState("choose");
  const [openOverride, setOpenOverride] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState("");          // "", "sample", "preview", "commit", "fix"
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [tab, setTab] = useState(null);
  const [filter, setFilter] = useState("all");
  const [shown, setShown] = useState(ROW_PAGE);

  const companyId = selectedCompany?.id || null;
  const companyName = selectedCompany?.brandName || selectedCompany?.name || "";

  // Permissions arrive after the first render; re-seed the selection once.
  useEffect(() => { setSelected(sheetsFromQuery(location.search, allowedKeys)); }, [location.search, allowedKeys]);

  // A different company is a different import.
  const reset = useCallback(() => {
    setStage("choose"); setOpenOverride(null); setFile(null); setPreview(null);
    setResult(null); setError(""); setTab(null); setFilter("all"); setShown(ROW_PAGE); setDownloaded(false);
    if (fileInput.current) fileInput.current.value = "";
  }, []);
  useEffect(() => { reset(); }, [companyId, reset]);

  // Bring the step the operator has just reached into view. Not smooth:
  // inside this layout's scroll container a smooth scroll can be ignored.
  const firstStage = useRef(true);
  useEffect(() => {
    if (firstStage.current) { firstStage.current = false; return; }
    document.getElementById(`step-${stage}`)?.scrollIntoView({ block: "start" });
  }, [stage]);

  const stageIndex = STAGES.indexOf(stage);
  const statusOf = (s) => {
    const i = STAGES.indexOf(s);
    if (i < stageIndex) return "done";
    if (i === stageIndex) return "active";
    return "waiting";
  };
  const isOpen = (s) => (openOverride === s ? true : stage === s);
  const toggle = (s) => () => setOpenOverride((cur) => (cur === s ? null : s));
  const goTo = (s) => { setOpenOverride(null); setStage(s); setError(""); };

  const sheetsCsv = sheetsParam(selected);

  const runPreview = useCallback(async (f, keys) => {
    const problem = fileProblem(f);
    if (problem) { setError(problem); return; }
    setBusy("preview"); setError(""); setPreview(null); setResult(null);
    try {
      const data = await previewOnboardingImport(companyId, f, sheetsParam(keys));
      setPreview(data);
      const ordered = inDisplayOrder(data.sheets);
      const firstWithRows = ordered.find((s) => s.rows.length) || ordered[0];
      setTab(firstWithRows?.key || null);
      setFilter("all"); setShown(ROW_PAGE);
      setOpenOverride(null); setStage("review");
    } catch (err) {
      setError(errorText(err, "The file could not be checked. Make sure it is the sample workbook, filled in."));
      setStage("upload");
    } finally {
      setBusy("");
    }
  }, [companyId]);

  const toggleSheet = (key) => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    setSelected(next);
    // Changing what is imported after a check means checking again.
    if (preview && file && next.length) runPreview(file, next);
  };
  const selectAll = () => {
    setSelected([...allowedKeys]);
    if (preview && file) runPreview(file, allowedKeys);
  };

  const onDownloadSample = async () => {
    setBusy("sample"); setError("");
    try {
      await downloadOnboardingSample(companyId, sheetsCsv, sampleFileName(companyName));
      setDownloaded(true);
      if (stage === "sample") goTo("upload");
    } catch (err) {
      setError(errorText(err, "The sample could not be downloaded. Please try again."));
    } finally {
      setBusy("");
    }
  };

  const pickFile = (f) => {
    if (!f) return;
    setFile(f);
    runPreview(f, selected);
  };

  const onImport = async () => {
    const t = summarise(preview);
    const ok = await confirm({
      title: "Import these rows?",
      message: `${t.willCreate} new record${t.willCreate === 1 ? "" : "s"} will be added to ${companyName}. `
        + "Records that already exist are not changed"
        + (t.errors ? `, and the ${t.errors} row${t.errors === 1 ? "" : "s"} that need fixing are skipped.` : "."),
      confirmText: `Import ${t.willCreate} row${t.willCreate === 1 ? "" : "s"}`,
    });
    if (!ok) return;
    setBusy("commit"); setError("");
    try {
      const data = await commitOnboardingImport(companyId, file, sheetsCsv);
      setResult(data);
      goTo("done");
    } catch (err) {
      setError(errorText(err, "The import stopped unexpectedly. Rows already imported are kept; upload the file again to finish the rest."));
    } finally {
      setBusy("");
    }
  };

  const onFixList = async () => {
    setBusy("fix"); setError("");
    try {
      await downloadOnboardingFixList(companyId, file, sheetsCsv, "import-data-rows-to-fix.xlsx");
    } catch (err) {
      setError(errorText(err, "The rows to fix could not be downloaded. Please try again."));
    } finally {
      setBusy("");
    }
  };

  if (!companyId) {
    return <Page><Notice tone="info">Choose a company at the top of the screen first. Its data is what this imports into.</Notice></Page>;
  }
  if (allowed.length === 0) {
    return <Page><Notice tone="info">Your role cannot create customers, items, suppliers or opening stock, so there is nothing you can import here.</Notice></Page>;
  }

  const totals = summarise(preview);
  const activeSheet = preview?.sheets.find((s) => s.key === tab) || null;
  const visibleRows = activeSheet ? rowsFor(activeSheet, filter) : [];
  const missing = missingSheets(preview);
  const chosenTitles = SHEETS.filter((s) => selected.includes(s.key)).map((s) => s.title);

  return (
    <Page companyName={companyName}>
      {/* Page level, not inside the Upload step: that step folds away once a
          file is checked, and "Choose a different file" still needs it. */}
      <input ref={fileInput} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
        onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
      {error && <Notice tone="error" onClose={() => setError("")}>{error}</Notice>}

      {/* 1 — Choose */}
      <StepCard id="step-choose" number={1} title="Choose what to import" status={statusOf("choose")}
        help="Bring everything in one file, or just one kind of record."
        summary={selected.length === allowedKeys.length ? `Everything: ${chosenTitles.join(", ")}` : chosenTitles.join(", ")}
        open={isOpen("choose")} onToggle={stage !== "choose" && stage !== "done" ? toggle("choose") : undefined}>
        <div style={st.choiceGrid}>
          <label style={{ ...st.choice, ...(selected.length === allowedKeys.length ? st.choiceOn : null) }}>
            <input type="checkbox" checked={selected.length === allowedKeys.length}
              onChange={() => (selected.length === allowedKeys.length ? setSelected([]) : selectAll())} style={st.checkbox} />
            <span style={st.choiceText}>
              <strong>Everything</strong>
              <span style={st.muted}>One file with every sheet below.</span>
            </span>
          </label>
          {SHEETS.map((s) => {
            const can = allowedKeys.includes(s.key);
            const on = selected.includes(s.key);
            return (
              <label key={s.key} title={can ? undefined : "Your role cannot create these records."}
                style={{ ...st.choice, ...(on ? st.choiceOn : null), ...(can ? null : st.choiceOff) }}>
                <input type="checkbox" checked={on} disabled={!can} onChange={() => toggleSheet(s.key)} style={st.checkbox} />
                <span style={st.choiceText}>
                  <strong>{s.title}</strong>
                  <span style={st.muted}>{can ? s.blurb : "Your role cannot create these records."}</span>
                </span>
              </label>
            );
          })}
        </div>
        {stage === "choose" && (
          <div style={st.actions}>
            <button type="button" style={st.primary} disabled={!selected.length} onClick={() => goTo("sample")}>
              Continue <MdArrowForward size={18} />
            </button>
          </div>
        )}
      </StepCard>

      {/* 2 — Sample */}
      <StepCard id="step-sample" number={2} title="Download the sample" status={statusOf("sample")}
        help="A workbook with one sheet per choice. Red headings are required, orange are required in some cases, grey are optional; row 2 of every sheet explains its column."
        summary={downloaded ? "Sample downloaded. Open this step to download it again." : "Skipped: you already had your file. Open this step to download the sample."}
        open={isOpen("sample")} onToggle={stageIndex > 1 && stage !== "done" ? toggle("sample") : undefined}>
        <div style={st.sheetGrid}>
          {SHEETS.filter((s) => selected.includes(s.key)).map((s) => (
            <div key={s.key} style={st.sheetTile}>
              <strong style={st.tileTitle}>{s.title}</strong>
              <span style={st.muted}>{s.blurb}</span>
              <span style={st.requiredTag}>{s.required} required column{s.required === 1 ? "" : "s"}</span>
            </div>
          ))}
        </div>
        <div style={st.actions}>
          <button type="button" style={st.primary} onClick={onDownloadSample} disabled={busy === "sample" || !selected.length}>
            <MdFileDownload size={18} /> {busy === "sample" ? "Preparing…" : "Download sample workbook"}
          </button>
          {stage === "sample" && (
            <button type="button" style={st.secondary} onClick={() => goTo("upload")}>I already have my file</button>
          )}
        </div>
      </StepCard>

      {/* 3 — Upload */}
      <StepCard id="step-upload" number={3} title="Upload your file" status={statusOf("upload")}
        help="Nothing is saved yet. The file is checked and you see exactly what will happen first."
        summary={file ? `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)` : ""}
        open={isOpen("upload")} onToggle={stageIndex > 2 && stage !== "done" ? toggle("upload") : undefined}>
        <div
          role="button" tabIndex={0}
          aria-label="Choose the filled-in workbook"
          style={{ ...st.drop, ...(dragOver ? st.dropOver : null) }}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
        >
          <MdCloudUpload size={36} color={colors.blue} aria-hidden="true" />
          <strong>{busy === "preview" ? "Checking your file…" : "Drop the file here, or tap to choose it"}</strong>
          <span style={st.muted}>Excel .xlsx or .xls, up to 10 MB</span>
          {file && busy !== "preview" && (
            <span style={st.fileChip}><MdInsertDriveFile size={16} aria-hidden="true" /> {file.name}</span>
          )}
        </div>
      </StepCard>

      {/* 4 — Review */}
      <StepCard id="step-review" number={4} title="Check what will happen" status={statusOf("review")}
        help="Rows that need fixing are skipped; everything else imports. Existing records are never changed."
        summary={preview ? `${totals.willCreate} imported, ${totals.existing} already existed, ${totals.errors} skipped` : ""}
        open={isOpen("review")} onToggle={stage === "done" ? toggle("review") : undefined}>
        {preview && (
          <>
            <div style={st.tiles}>
              <Tile status="import" value={totals.toImport} />
              <Tile status="warning" value={totals.withWarnings} />
              <Tile status="exists" value={totals.existing} />
              <Tile status="error" value={totals.errors} />
            </div>

            {missing.length > 0 && (
              <Notice tone="warning">
                The file has no {missing.join(", ")} sheet{missing.length === 1 ? "" : "s"}. {missing.length === 1 ? "It is" : "They are"} skipped.
              </Notice>
            )}
            {preview.sheets.flatMap((s) => s.sheetWarnings).map((w) => <Notice key={w} tone="warning">{w}</Notice>)}

            <div role="tablist" aria-label="Sheets" style={st.tabs}>
              {inDisplayOrder(preview.sheets).map((s) => (
                <button key={s.key} type="button" role="tab" aria-selected={tab === s.key}
                  style={{ ...st.tab, ...(tab === s.key ? st.tabOn : null) }}
                  onClick={() => { setTab(s.key); setFilter("all"); setShown(ROW_PAGE); }}>
                  {s.title}
                  <span style={st.tabCount}>{s.rows.length}</span>
                  {s.errors > 0 && <span style={st.tabErr}>{s.errors} to fix</span>}
                </button>
              ))}
            </div>

            {activeSheet && (
              <>
                <div data-admin-toolbar="" style={st.filters}>
                  {["all", "error", "warning", "import", "exists"].map((f) => {
                    const n = f === "all" ? activeSheet.rows.length : activeSheet.rows.filter((r) => r.status === f).length;
                    if (f !== "all" && n === 0) return null;
                    return (
                      <button key={f} type="button" onClick={() => { setFilter(f); setShown(ROW_PAGE); }}
                        style={{ ...st.filter, ...(filter === f ? st.filterOn : null) }}>
                        {f === "all" ? "All rows" : STATUS[f].label} · {n}
                      </button>
                    );
                  })}
                </div>

                {activeSheet.rows.length === 0 ? (
                  <p style={st.muted}>{activeSheet.present ? "This sheet is empty, so nothing from it is imported." : "Not in the file."}</p>
                ) : (
                  <ul style={st.rowList}>
                    {visibleRows.slice(0, shown).map((r) => <RowCard key={r.rowNumber} row={r} />)}
                  </ul>
                )}
                {visibleRows.length > shown && (
                  <button type="button" style={st.secondary} onClick={() => setShown((n) => n + ROW_PAGE)}>
                    Show {Math.min(ROW_PAGE, visibleRows.length - shown)} more of {visibleRows.length - shown}
                  </button>
                )}
              </>
            )}

            <Checklist items={checklist({ selected, file, preview, busy: busy === "preview" })} />

            <div style={st.actions}>
              <button type="button" style={st.primary} disabled={!canImport(preview, !!busy)} onClick={onImport}>
                <MdPlaylistAddCheck size={18} />
                {busy === "commit" ? "Importing…" : `Import ${totals.willCreate} row${totals.willCreate === 1 ? "" : "s"}`}
              </button>
              {totals.errors > 0 && (
                <button type="button" style={st.secondary} onClick={onFixList} disabled={!!busy}>
                  <MdFileDownload size={18} /> {busy === "fix" ? "Preparing…" : `Download ${totals.errors} row${totals.errors === 1 ? "" : "s"} to fix`}
                </button>
              )}
              <button type="button" style={st.secondary} onClick={() => fileInput.current?.click()} disabled={!!busy}>
                <MdRefresh size={18} /> Choose a different file
              </button>
            </div>
          </>
        )}
      </StepCard>

      {/* 5 — Done */}
      <StepCard id="step-done" number={5} title="Done" status={stage === "done" ? "active" : "waiting"}
        help="Everything imported is now on its normal screen.">
        {result && (
          <>
            <div style={st.sheetGrid}>
              {inDisplayOrder(result.sheets).map((s) => {
                const meta = sheetByKey(s.key);
                return (
                  <div key={s.key} style={st.sheetTile}>
                    <strong style={st.tileTitle}>{s.title}</strong>
                    <span style={{ color: STATUS.import.color, fontWeight: 700 }}>{s.created} added</span>
                    <span style={st.muted}>{s.skipped} skipped{s.failed ? `, ${s.failed} could not be saved` : ""}</span>
                    {meta && has(meta.viewPermission) && (
                      <Link to={meta.listPath} style={st.link}>Open {meta.listLabel} <MdArrowForward size={14} aria-hidden="true" /></Link>
                    )}
                  </div>
                );
              })}
            </div>
            {result.sheets.some((s) => s.failed) && (
              <>
                <Notice tone="warning">These rows passed the check but the save refused them. Nothing else was affected.</Notice>
                <ul style={st.rowList}>
                  {inDisplayOrder(result.sheets).flatMap((s) => s.failedRows.map((r) => ({ ...r, sheet: s.title })))
                    .map((r) => <RowCard key={`${r.sheet}-${r.rowNumber}`} row={r} sheet={r.sheet} />)}
                </ul>
              </>
            )}
            <div style={st.actions}>
              <button type="button" style={st.primary} onClick={reset}><MdRefresh size={18} /> Import another file</button>
            </div>
          </>
        )}
      </StepCard>
    </Page>
  );
}

function Page({ companyName, children }) {
  return (
    <div style={st.page}>
      <header style={st.pageHead}>
        <h2 style={st.pageTitle}>Import Data</h2>
        <p style={st.pageSub}>
          Bring {companyName ? <strong>{companyName}</strong> : "a company"}'s customers, items, suppliers and opening stock
          in from one Excel file. Only what FBR and your printed documents need is asked for.
        </p>
      </header>
      <div style={st.steps}>{children}</div>
    </div>
  );
}

const TONES = {
  info: { icon: MdInfo, color: "#0d47a1", bg: "#e3f2fd", border: "#90caf9" },
  warning: { icon: MdWarning, color: "#8a4b00", bg: "#fff4e0", border: "#ffcc80" },
  error: { icon: MdError, color: "#b71c1c", bg: "#ffebee", border: "#ef9a9a" },
};

function Notice({ tone = "info", children, onClose }) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div role={tone === "error" ? "alert" : "status"}
      style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", padding: "0.7rem 0.85rem", borderRadius: 10,
        background: t.bg, border: `1px solid ${t.border}`, color: t.color, fontSize: "0.88rem", margin: "0.25rem 0 0.75rem" }}>
      <Icon size={20} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {onClose && (
        <button data-admin-close="" type="button" onClick={onClose} aria-label="Dismiss"
          style={{ width: 44, height: 44, margin: "-0.6rem -0.6rem -0.6rem 0", display: "grid", placeItems: "center",
            border: "none", background: "transparent", color: t.color, cursor: "pointer", fontSize: "1.2rem" }}>×</button>
      )}
    </div>
  );
}

const STATUS_ICON = { import: MdCheckCircle, warning: MdWarning, exists: MdInfo, error: MdError };

function Tile({ status, value }) {
  const m = STATUS[status];
  const Icon = STATUS_ICON[status];
  return (
    <div style={{ ...st.tile, background: m.bg, borderColor: m.border, color: m.color }}>
      <Icon size={22} aria-hidden="true" />
      <span style={st.tileValue}>{value}</span>
      <span style={st.tileLabel}>{m.label}</span>
    </div>
  );
}

function RowCard({ row, sheet }) {
  const m = STATUS[row.status] || STATUS.error;
  return (
    <li style={{ ...st.rowCard, borderLeftColor: m.border }}>
      <div style={st.rowHead}>
        <span style={st.rowNum}>{sheet ? `${sheet} · ` : ""}Row {row.rowNumber}</span>
        <span style={{ ...st.chip, color: m.color, background: m.bg, borderColor: m.border }}>{m.label}</span>
      </div>
      <div style={st.rowLabel}>{row.label || <em style={st.muted}>(no name)</em>}</div>
      {row.issues.length > 0 && (
        <ul style={st.issueList}>
          {row.issues.map((i, n) => (
            <li key={n} style={{ color: i.isError ? STATUS.error.color : colors.textSecondary }}>{issueLine(i)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Checklist({ items }) {
  return (
    <ul style={st.checklist} aria-label="Before you import">
      {items.map((i) => (
        <li key={i.text} style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: i.warn ? STATUS.warning.color : i.done ? STATUS.import.color : colors.textSecondary }}>
          {i.warn ? <MdWarning size={17} aria-hidden="true" /> : i.done ? <MdCheckCircle size={17} aria-hidden="true" /> : <MdInfo size={17} aria-hidden="true" />}
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

const st = {
  page: { maxWidth: 1080, margin: "0 auto", padding: "0.25rem 0 2rem" },
  pageHead: { marginBottom: "1rem" },
  pageTitle: { margin: 0, fontSize: "1.4rem", fontWeight: 800, color: colors.textPrimary },
  pageSub: { margin: "0.35rem 0 0", fontSize: "0.9rem", color: colors.textSecondary, lineHeight: 1.5 },
  steps: { display: "flex", flexDirection: "column", gap: "0.85rem" },
  muted: { fontSize: "0.82rem", color: colors.textSecondary, lineHeight: 1.4 },
  choiceGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.6rem" },
  choice: { display: "flex", gap: "0.6rem", alignItems: "flex-start", padding: "0.75rem 0.85rem", minHeight: 44, borderRadius: 10, border: `1px solid ${colors.inputBorder}`, background: "#fff", cursor: "pointer" },
  choiceOn: { borderColor: colors.blue, background: "#f3f7ff", boxShadow: `0 0 0 1px ${colors.blue} inset` },
  choiceOff: { opacity: 0.55, cursor: "not-allowed" },
  checkbox: { width: 20, height: 20, marginTop: 2, flexShrink: 0, accentColor: colors.blue },
  choiceText: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
  actions: { display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: "1rem" },
  primary: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", minHeight: 44, padding: "0 1.1rem", borderRadius: 10, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" },
  secondary: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", minHeight: 44, padding: "0 1rem", borderRadius: 10, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontWeight: 600, fontSize: "0.88rem", cursor: "pointer" },
  sheetGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.6rem" },
  sheetTile: { display: "flex", flexDirection: "column", gap: 4, padding: "0.75rem 0.85rem", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, background: colors.inputBg },
  tileTitle: { fontSize: "0.95rem", color: colors.textPrimary },
  requiredTag: { alignSelf: "flex-start", marginTop: 4, fontSize: "0.72rem", fontWeight: 700, color: "#c62828", background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 999, padding: "1px 8px" },
  drop: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.4rem", minHeight: 150, padding: "1.25rem", borderRadius: 12, border: `2px dashed ${colors.inputBorder}`, background: colors.inputBg, textAlign: "center", cursor: "pointer", color: colors.textPrimary },
  dropOver: { borderColor: colors.blue, background: "#eef4ff" },
  fileChip: { display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: "0.82rem", color: colors.blue, maxWidth: "100%", overflowWrap: "anywhere" },
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: "0.6rem", marginBottom: "0.9rem" },
  tile: { display: "flex", flexDirection: "column", gap: 2, padding: "0.7rem 0.85rem", borderRadius: 10, border: "1px solid" },
  tileValue: { fontSize: "1.5rem", fontWeight: 800, lineHeight: 1.1 },
  tileLabel: { fontSize: "0.8rem", fontWeight: 600 },
  tabs: { display: "flex", flexWrap: "wrap", gap: "0.4rem", borderBottom: `1px solid ${colors.cardBorder}`, marginBottom: "0.7rem" },
  tab: { display: "inline-flex", alignItems: "center", gap: "0.4rem", minHeight: 44, padding: "0 0.9rem", border: "none", borderBottom: "3px solid transparent", background: "transparent", color: colors.textSecondary, fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" },
  tabOn: { color: colors.blue, borderBottomColor: colors.blue },
  tabCount: { fontSize: "0.72rem", background: "#eceff1", color: "#37474f", borderRadius: 999, padding: "1px 7px" },
  tabErr: { fontSize: "0.72rem", background: "#ffebee", color: "#b71c1c", borderRadius: 999, padding: "1px 7px" },
  filters: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.7rem" },
  filter: { minHeight: 44, padding: "0 0.8rem", borderRadius: 999, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textSecondary, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  filterOn: { background: colors.blue, borderColor: colors.blue, color: "#fff" },
  rowList: { listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "0.5rem" },
  rowCard: { padding: "0.6rem 0.75rem", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, borderLeft: "4px solid", background: "#fff", minWidth: 0 },
  rowHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" },
  rowNum: { fontSize: "0.75rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em" },
  chip: { fontSize: "0.72rem", fontWeight: 700, border: "1px solid", borderRadius: 999, padding: "1px 8px" },
  rowLabel: { marginTop: 3, fontWeight: 700, color: colors.textPrimary, fontSize: "0.92rem", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" },
  issueList: { margin: "0.35rem 0 0", paddingLeft: "1.1rem", fontSize: "0.82rem", lineHeight: 1.45 },
  checklist: { listStyle: "none", margin: "1rem 0 0", padding: "0.7rem 0.85rem", display: "flex", flexDirection: "column", gap: "0.35rem", borderRadius: 10, background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, fontSize: "0.86rem" },
  link: { display: "inline-flex", alignItems: "center", gap: 4, minHeight: 44, color: colors.blue, fontWeight: 700, fontSize: "0.85rem", textDecoration: "none" },
};
