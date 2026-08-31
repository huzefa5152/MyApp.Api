import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MdCloudUpload, MdCheckCircle, MdWarning, MdError, MdHistory,
  MdInventory2, MdReceiptLong, MdSave, MdRestartAlt,
} from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import { useCompany } from "../contexts/CompanyContext";
import { notify } from "../utils/notify";
import { colors } from "../theme";
import {
  identifyWorkbook, previewOpeningStock, commitOpeningStock,
  previewCustomerLedger, commitCustomerLedger,
  getImportRuns, supersedeImportRun,
  getImportProfiles, createImportProfile,
} from "../api/spreadsheetImportApi";

/**
 * Accounting → Spreadsheet Import.
 *
 * Onboarding a business from its own Excel books: an opening stock sheet, and a
 * customer outstanding ledger. Four steps, in order — pick what you are
 * importing, upload it, say which column is which (once; the layout is then
 * remembered), review, import.
 *
 * The review step is the one that matters. A reporting import fails as a
 * plausible wrong number rather than a crash, so nothing is written until the
 * numbers are shown agreeing with the source workbook.
 */

const KINDS = [
  { key: "OpeningStock", label: "Opening stock", icon: MdInventory2, perm: "spreadsheetimport.stock.run",
    blurb: "What the business is holding, and what it is worth." },
  { key: "CustomerLedger", label: "Customer ledger", icon: MdReceiptLong, perm: "spreadsheetimport.ledger.run",
    blurb: "What each customer owed, invoice by invoice." },
];

// Mapping fields per kind. Driving the form from data keeps one renderer for
// both kinds, and makes adding a layout a matter of describing its fields.
const FIELDS = {
  OpeningStock: [
    { path: "columns.itemName", label: "Item name", kind: "col", required: true },
    { path: "columns.hsCodeFull", label: "HS code (8-digit)", kind: "col" },
    { path: "columns.hsCodeShort", label: "HS code (4-digit)", kind: "col" },
    { path: "columns.unit", label: "Unit", kind: "col" },
    { path: "columns.balanceQty", label: "Closing quantity", kind: "col", required: true },
    { path: "columns.balanceValue", label: "Closing value", kind: "col" },
    { path: "columns.lotRef", label: "Lot / GD number", kind: "col" },
    { path: "headerRow", label: "Heading row", kind: "row" },
    { path: "firstDataRow", label: "First data row", kind: "row", required: true },
    { path: "hsCodeStripSuffix", label: "Strip from HS code", kind: "text", hint: "e.g. :-" },
  ],
  CustomerLedger: [
    { path: "indexColumns.name", label: "Index: customer name", kind: "col", required: true },
    { path: "indexColumns.opening", label: "Index: opening", kind: "col" },
    { path: "indexColumns.debit", label: "Index: debit", kind: "col" },
    { path: "indexColumns.credit", label: "Index: credit", kind: "col" },
    { path: "indexColumns.closing", label: "Index: closing", kind: "col" },
    { path: "indexFirstRow", label: "Index: first row", kind: "row", required: true },
    { path: "clientNameCell", label: "Customer name cell", kind: "text", hint: "e.g. A3", required: true },
    { path: "firstDataRow", label: "First transaction row", kind: "row", required: true },
    { path: "columns.date", label: "Date", kind: "col" },
    { path: "columns.debit", label: "Debit (money in)", kind: "col", required: true },
    { path: "columns.credit", label: "Credit (invoice)", kind: "col", required: true },
    { path: "columns.balance", label: "Balance (compared only)", kind: "col" },
    { path: "periodStart", label: "Period starts", kind: "date" },
    { path: "periodEnd", label: "Period ends", kind: "date", required: true },
    { path: "openingDate", label: "Opening balances dated", kind: "date" },
  ],
};

const money = (n) =>
  (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n) =>
  (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

const STATUS_LABEL = {
  "matched": "Matched",
  "matched-renamed": "Reused placeholder",
  "matched-classified": "HS code filled in",
  "ambiguous": "Needs a choice",
  "will-create": "Will create",
  "hs-unknown": "Unknown HS code",
  "error": "Cannot import",
};
const STATUS_TONE = {
  "matched": colors.success, "matched-renamed": colors.success, "matched-classified": colors.success,
  "will-create": colors.blueLight, "ambiguous": "#b26a00",
  "hs-unknown": colors.danger, "error": colors.danger,
};

const get = (obj, path) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

const set = (obj, path, value) => {
  const keys = path.split(".");
  const next = structuredClone(obj);
  let cur = next;
  keys.slice(0, -1).forEach((k) => { cur[k] = cur[k] ?? {}; cur = cur[k]; });
  cur[keys[keys.length - 1]] = value;
  return next;
};

const scaffold = (kind, sheets) => {
  const first = sheets?.[0];
  if (kind === "OpeningStock") {
    return {
      sheetSelect: { mode: "byIndex", index: first?.index ?? 0 },
      headerRow: 1, firstDataRow: 2,
      columns: { itemName: 1, hsCodeFull: 2, unit: 3, balanceQty: 4, balanceValue: 5 },
      hsCodeStripSuffix: "",
    };
  }
  return {
    indexSheet: { mode: "byIndex", index: first?.index ?? 0 },
    indexFirstRow: 2,
    indexColumns: { name: 1, opening: 2, debit: 3, credit: 4, closing: 5 },
    clientSheets: { mode: "allExcept", except: first ? [first.name] : [] },
    clientNameCell: "A1",
    firstDataRow: 2,
    columns: { date: 1, refAny: [2, 3], debit: 4, credit: 5, balance: 6 },
    creditIsInvoice: true,
    undatedRule: "carryPreviousRow",
    openingBand: 900000, unreferencedBand: 950000,
  };
};

const card = {
  background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
  borderRadius: 12, padding: "1rem 1.1rem", marginBottom: "1rem",
};
const grid = {
  display: "grid", gap: "0.75rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
};
const input = {
  width: "100%", padding: "0.55rem 0.65rem", borderRadius: 8,
  border: `1px solid ${colors.inputBorder}`, background: colors.inputBg,
  color: colors.textPrimary, fontSize: 14, minHeight: 44, boxSizing: "border-box",
};
const btn = (tone = colors.blue, disabled = false) => ({
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "0.6rem 1rem", minHeight: 44, borderRadius: 9, border: "none",
  background: disabled ? "#c8d1de" : tone, color: "#fff", fontWeight: 600,
  fontSize: 14, cursor: disabled ? "not-allowed" : "pointer",
});
const th = {
  textAlign: "left", padding: "0.5rem 0.6rem", fontSize: 12,
  textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary,
  borderBottom: `1px solid ${colors.cardBorder}`, whiteSpace: "nowrap",
};
const td = {
  padding: "0.55rem 0.6rem", fontSize: 14, borderBottom: `1px solid ${colors.cardBorder}`,
  verticalAlign: "top",
};
const wrap2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

function Banner({ tone, icon: Icon, children }) {
  const tint = { error: colors.dangerLight, warn: "#fff8e6", ok: "#eefaf1" }[tone];
  const line = { error: colors.danger, warn: "#b26a00", ok: colors.success }[tone];
  return (
    <div style={{
      display: "flex", gap: 10, padding: "0.7rem 0.85rem", borderRadius: 9,
      background: tint, borderLeft: `3px solid ${line}`, marginBottom: "0.6rem",
      fontSize: 14, color: colors.textPrimary,
    }}>
      <Icon size={18} style={{ color: line, flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export default function SpreadsheetImportPage() {
  const { has } = usePermissions();
  const { companies, selectedCompany } = useCompany();

  const allowedKinds = KINDS.filter((k) => has(k.perm));
  const [kind, setKind] = useState(allowedKinds[0]?.key || "OpeningStock");
  const [companyId, setCompanyId] = useState(selectedCompany?.id || "");
  const [tab, setTab] = useState("import");

  const [file, setFile] = useState(null);
  const [ident, setIdent] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState("");
  const [mapping, setMapping] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);

  const [asOfDate, setAsOfDate] = useState(() => `${new Date().getFullYear()}-07-01`);
  const [postValue, setPostValue] = useState(true);
  const [enableTracking, setEnableTracking] = useState(true);
  const [setCutover, setSetCutover] = useState(true);

  const [runs, setRuns] = useState([]);
  const [layoutName, setLayoutName] = useState("");

  const isStock = kind === "OpeningStock";
  const canView = allowedKinds.length > 0;

  useEffect(() => { if (selectedCompany?.id && !companyId) setCompanyId(selectedCompany.id); },
    [selectedCompany, companyId]);

  const resetFlow = useCallback(() => {
    setFile(null); setIdent(null); setPreview(null); setResult(null);
    setProfileId(""); setMapping(null); setLayoutName("");
  }, []);

  useEffect(() => { resetFlow(); }, [kind, companyId, resetFlow]);

  const loadRuns = useCallback(async () => {
    if (!companyId || !has("spreadsheetimport.runs.view")) return;
    try {
      const { data } = await getImportRuns({ companyId, pageSize: 25 });
      setRuns(data?.items || []);
    } catch { /* the banner from httpClient is enough */ }
  }, [companyId, has]);

  useEffect(() => { if (tab === "history") loadRuns(); }, [tab, loadRuns]);

  // ── Step 2: identify ──────────────────────────────────────────────
  const onIdentify = async (chosen) => {
    if (!chosen || !companyId) return;
    setBusy("identify"); setIdent(null); setPreview(null); setResult(null);
    try {
      const { data } = await identifyWorkbook({ file: chosen, companyId, kind });
      setIdent(data);
      setMapping(scaffold(kind, data.sheets));

      const { data: saved } = await getImportProfiles({ kind, companyId });
      setProfiles(saved || []);

      if (data.matchedProfile) {
        setProfileId(String(data.matchedProfile.profileId));
        notify(`Recognised as "${data.matchedProfile.name}".`, "success");
      }
    } catch { /* httpClient surfaces it */ } finally { setBusy(""); }
  };

  const onPickFile = (e) => {
    const chosen = e.target.files?.[0] || null;
    setFile(chosen);
    if (chosen) onIdentify(chosen);
  };

  // ── Step 3/4: preview ─────────────────────────────────────────────
  const onPreview = async () => {
    if (!file || !companyId) return;
    setBusy("preview"); setPreview(null); setResult(null);
    try {
      const args = {
        file, companyId,
        ...(profileId ? { profileId: Number(profileId) } : { mappingJson: JSON.stringify(mapping) }),
      };
      const { data } = isStock
        ? await previewOpeningStock(args)
        : await previewCustomerLedger(args);
      setPreview(data);
      if (!isStock && data.periodEnd) setAsOfDate((d) => d);
    } catch { /* surfaced */ } finally { setBusy(""); }
  };

  const onSaveLayout = async () => {
    if (!layoutName.trim() || !ident) return;
    setBusy("save");
    try {
      const { data } = await createImportProfile({
        kind, layout: isStock ? "LotRows" : "IndexPlusPerClientSheets",
        name: layoutName.trim(), companyId: Number(companyId),
        signatureHash: ident.signatureHash, tokenSignature: ident.tokenSignature,
        mappingJson: JSON.stringify(mapping),
      });
      setProfiles((p) => [data, ...p]);
      setProfileId(String(data.id));
      setLayoutName("");
      notify("Layout saved. The next file in this shape is recognised automatically.", "success");
    } catch { /* surfaced */ } finally { setBusy(""); }
  };

  // ── Step 5: commit ────────────────────────────────────────────────
  const onCommit = async () => {
    if (!preview?.canCommit) return;
    setBusy("commit");
    try {
      if (isStock) {
        const { data } = await commitOpeningStock({
          companyId: Number(companyId),
          importProfileId: preview.importProfileId, profileVersion: preview.profileVersion,
          fileSha256: preview.fileSha256, fileName: preview.fileName,
          fileSizeBytes: preview.fileSizeBytes,
          asOfDate, postInventoryValue: postValue, enableInventoryTracking: enableTracking,
          rows: preview.rows.map((r) => ({
            itemName: r.itemName, hsCode: r.hsCode, isHsCodePartial: r.isHsCodePartial,
            unit: r.unit, quantity: r.quantity, value: r.value,
            lotRefs: r.lotRefs, itemTypeId: r.itemTypeId,
          })),
        });
        setResult(data);
      } else {
        const { data } = await commitCustomerLedger({
          companyId: Number(companyId),
          importProfileId: preview.importProfileId, profileVersion: preview.profileVersion,
          fileSha256: preview.fileSha256, fileName: preview.fileName,
          fileSizeBytes: preview.fileSizeBytes,
          openingDate: preview.openingDate, periodEnd: preview.periodEnd,
          setGlCutover: setCutover,
          clients: preview.clients, invoices: preview.invoices, receipts: preview.receipts,
        });
        setResult(data);
      }
      setPreview(null);
      notify("Imported.", "success");
      loadRuns();
    } catch { /* surfaced */ } finally { setBusy(""); }
  };

  const onSupersede = async (run) => {
    const reason = window.prompt(
      `Set aside the import of "${run.originalFileName}"?\n\nThis lets the same file be imported again. It does NOT remove what it already wrote.\n\nWhy?`);
    if (!reason?.trim()) return;
    try {
      await supersedeImportRun({ runId: run.id, companyId, reason: reason.trim() });
      notify("Import set aside.", "success");
      loadRuns();
    } catch { /* surfaced */ }
  };

  const chooseCandidate = (rowIndex, itemTypeId) => {
    setPreview((p) => {
      const next = structuredClone(p);
      next.rows[rowIndex].itemTypeId = itemTypeId;
      next.rows[rowIndex].status = itemTypeId ? "matched" : "will-create";
      return next;
    });
  };

  const sheetOptions = ident?.sheets || [];
  const ambiguous = useMemo(
    () => (preview?.rows || []).filter((r) => r.status === "ambiguous").length, [preview]);

  if (!canView) {
    return <div style={{ padding: "1.5rem" }}>
      <Banner tone="warn" icon={MdWarning}>You do not have permission to run a spreadsheet import.</Banner>
    </div>;
  }

  return (
    <div style={{ padding: "1.25rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 0.25rem", color: colors.textPrimary }}>Spreadsheet Import</h1>
      <p style={{ margin: "0 0 1rem", color: colors.textSecondary, fontSize: 14, maxWidth: "62ch" }}>
        Load a business's own Excel books into a company. Nothing is written until you have
        reviewed what the file says.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap" }}>
        <button onClick={() => setTab("import")} style={btn(tab === "import" ? colors.blue : "#8b98a9")}>
          <MdCloudUpload size={18} /> Import
        </button>
        {has("spreadsheetimport.runs.view") && (
          <button onClick={() => setTab("history")} style={btn(tab === "history" ? colors.blue : "#8b98a9")}>
            <MdHistory size={18} /> History
          </button>
        )}
      </div>

      {/* ── Step 1 ─────────────────────────────────────────────── */}
      <div style={card}>
        <div style={grid}>
          <label style={{ fontSize: 13, color: colors.textSecondary }}>
            Company
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={input}>
              <option value="">Choose a company…</option>
              {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 13, color: colors.textSecondary }}>
            What are you importing?
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={input}>
              {allowedKinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
        </div>
        <p style={{ margin: "0.6rem 0 0", fontSize: 13, color: colors.textSecondary }}>
          {KINDS.find((k) => k.key === kind)?.blurb}
        </p>
      </div>

      {tab === "history" ? (
        <HistoryTab runs={runs} onSupersede={onSupersede} canForce={has("spreadsheetimport.reimport.force")} />
      ) : (
        <>
          {/* ── Step 2: upload ─────────────────────────────────── */}
          <div style={card}>
            <h2 style={{ fontSize: 15, margin: "0 0 0.6rem" }}>1 · Upload the workbook</h2>
            <input type="file" accept=".xls,.xlsx,.xlsm" onChange={onPickFile}
              disabled={!companyId || !!busy} style={{ ...input, padding: "0.5rem" }} />
            <p style={{ margin: "0.5rem 0 0", fontSize: 12.5, color: colors.textSecondary }}>
              Excel only (.xls, .xlsx, .xlsm), up to 10 MB. Close the file in Excel first.
            </p>
            {busy === "identify" && <p style={{ fontSize: 13 }}>Reading the workbook…</p>}
          </div>

          {/* ── Step 3: layout ─────────────────────────────────── */}
          {ident && (
            <div style={card}>
              <h2 style={{ fontSize: 15, margin: "0 0 0.6rem" }}>2 · Which layout is this?</h2>

              {ident.errors?.map((e, i) => <Banner key={i} tone="error" icon={MdError}>{e}</Banner>)}
              {ident.warnings?.map((w, i) => <Banner key={i} tone="warn" icon={MdWarning}>{w}</Banner>)}

              {(profiles.length > 0 || ident.matchedProfile) && (
                <label style={{ fontSize: 13, color: colors.textSecondary, display: "block", marginBottom: "0.7rem" }}>
                  Saved layout
                  <select value={profileId} onChange={(e) => setProfileId(e.target.value)} style={input}>
                    <option value="">Map the columns myself</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.isShared ? " (shared)" : ""} · v{p.currentVersion}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {!profileId && mapping && (
                <>
                  <SheetPreview sheets={sheetOptions} />
                  <MappingForm
                    fields={FIELDS[kind]} mapping={mapping} setMapping={setMapping}
                    sheets={sheetOptions} isStock={isStock}
                  />
                  <div style={{ ...grid, marginTop: "0.8rem" }}>
                    <label style={{ fontSize: 13, color: colors.textSecondary }}>
                      Save this layout as
                      <input value={layoutName} onChange={(e) => setLayoutName(e.target.value)}
                        placeholder="e.g. Alpha Traders stock sheet" style={input} />
                    </label>
                    <div style={{ display: "flex", alignItems: "flex-end" }}>
                      {has("spreadsheetimport.profiles.manage") && (
                        <button onClick={onSaveLayout} disabled={!layoutName.trim() || !!busy}
                          style={btn(colors.teal, !layoutName.trim() || !!busy)}>
                          <MdSave size={18} /> Save layout
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div style={{ marginTop: "0.9rem" }}>
                <button onClick={onPreview} disabled={!!busy || (ident.errors || []).length > 0}
                  style={btn(colors.blue, !!busy || (ident.errors || []).length > 0)}>
                  {busy === "preview" ? "Reading…" : "Review what this would do"}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: review ─────────────────────────────────── */}
          {preview && (isStock
            ? <StockPreview
                preview={preview} ambiguous={ambiguous} chooseCandidate={chooseCandidate}
                asOfDate={asOfDate} setAsOfDate={setAsOfDate}
                postValue={postValue} setPostValue={setPostValue}
                enableTracking={enableTracking} setEnableTracking={setEnableTracking}
                onCommit={onCommit} busy={busy} />
            : <LedgerPreview
                preview={preview} setCutover={setCutover} setSetCutover={setSetCutover}
                onCommit={onCommit} busy={busy} />)}

          {/* ── Done ───────────────────────────────────────────── */}
          {result && (
            <div style={card}>
              <Banner tone="ok" icon={MdCheckCircle}>Imported.</Banner>
              <div style={grid}>
                {Object.entries(result)
                  .filter(([k, v]) => typeof v === "number" && k !== "importRunId")
                  .map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: 12, color: colors.textSecondary }}>
                        {k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{money(v)}</div>
                    </div>
                  ))}
              </div>
              {(result.messages || []).map((m, i) =>
                <p key={i} style={{ fontSize: 13.5, margin: "0.4rem 0 0" }}>{m}</p>)}
              <button onClick={resetFlow} style={{ ...btn(colors.teal), marginTop: "0.9rem" }}>
                <MdRestartAlt size={18} /> Import another file
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sheet preview grid ──────────────────────────────────────────────────────

function SheetPreview({ sheets }) {
  const [active, setActive] = useState(0);
  const sheet = sheets[active];
  if (!sheet) return null;
  const width = Math.max(...(sheet.rows || [[]]).map((r) => r.length), 1);

  return (
    <div style={{ marginBottom: "0.9rem" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.5rem" }}>
        {sheets.map((s, i) => (
          <button key={s.index} onClick={() => setActive(i)} style={{
            padding: "0.35rem 0.6rem", minHeight: 36, borderRadius: 7, fontSize: 12.5,
            border: `1px solid ${i === active ? colors.blue : colors.inputBorder}`,
            background: i === active ? "rgba(13,71,161,0.08)" : colors.inputBg,
            color: colors.textPrimary, cursor: "pointer", maxWidth: 200,
          }}>
            <span style={wrap2}>{s.name || `Sheet ${s.index + 1}`}</span>
          </button>
        ))}
      </div>
      <div style={{ overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...th, position: "sticky", left: 0, background: colors.cardBg }}>row</th>
              {Array.from({ length: width }, (_, c) => <th key={c} style={th}>{c + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {(sheet.rows || []).map((row, r) => (
              <tr key={r}>
                <td style={{ ...td, color: colors.textSecondary, position: "sticky", left: 0, background: colors.cardBg }}>
                  {r + 1}
                </td>
                {Array.from({ length: width }, (_, c) => (
                  <td key={c} style={{ ...td, whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "clip" }}>
                    {row[c] || ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: colors.textSecondary, margin: "0.4rem 0 0" }}>
        Column numbers are along the top — use them below. {sheet.lastRow} rows in this sheet.
      </p>
    </div>
  );
}

// ── Mapping form ────────────────────────────────────────────────────────────

function MappingForm({ fields, mapping, setMapping, sheets, isStock }) {
  const upd = (path, value) => setMapping((m) => set(m, path, value));
  const sheetPath = isStock ? "sheetSelect" : "indexSheet";
  const sheetIndex = get(mapping, `${sheetPath}.index`) ?? 0;

  return (
    <div style={grid}>
      <label style={{ fontSize: 13, color: colors.textSecondary }}>
        {isStock ? "Data sheet" : "Index sheet"}
        <select value={sheetIndex} style={input}
          onChange={(e) => {
            const idx = Number(e.target.value);
            let next = set(mapping, sheetPath, { mode: "byIndex", index: idx });
            if (!isStock) {
              const name = sheets.find((s) => s.index === idx)?.name;
              next = set(next, "clientSheets", { mode: "allExcept", except: name ? [name] : [] });
            }
            setMapping(next);
          }}>
          {sheets.map((s) => (
            <option key={s.index} value={s.index}>{s.name || `Sheet ${s.index + 1}`}</option>
          ))}
        </select>
      </label>

      {fields.map((f) => {
        const value = get(mapping, f.path);
        return (
          <label key={f.path} style={{ fontSize: 13, color: colors.textSecondary }}>
            {f.label}{f.required ? " *" : ""}
            {f.kind === "text" ? (
              <input value={value ?? ""} placeholder={f.hint || ""} style={input}
                onChange={(e) => upd(f.path, e.target.value)} />
            ) : f.kind === "date" ? (
              <input type="date" value={(value || "").slice(0, 10)} style={input}
                onChange={(e) => upd(f.path, e.target.value || null)} />
            ) : (
              <input type="number" min={f.kind === "col" ? 1 : 1} value={value ?? ""} style={input}
                placeholder={f.kind === "col" ? "column number" : "row number"}
                onChange={(e) => upd(f.path, e.target.value === "" ? null : Number(e.target.value))} />
            )}
          </label>
        );
      })}

      {!isStock && (
        <label style={{ fontSize: 13, color: colors.textSecondary }}>
          Reference column(s)
          <input value={(get(mapping, "columns.refAny") || []).join(", ")} style={input}
            placeholder="e.g. 3, 4"
            onChange={(e) => upd("columns.refAny",
              e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => n > 0))} />
          <span style={{ fontSize: 11.5 }}>
            The invoice number moves between columns on some sheets — list every one it can be in.
          </span>
        </label>
      )}
    </div>
  );
}

// ── Opening stock review ────────────────────────────────────────────────────

function StockPreview({
  preview, ambiguous, chooseCandidate, asOfDate, setAsOfDate,
  postValue, setPostValue, enableTracking, setEnableTracking, onCommit, busy,
}) {
  return (
    <div style={card}>
      <h2 style={{ fontSize: 15, margin: "0 0 0.6rem" }}>3 · Review</h2>

      {preview.blockingErrors?.map((e, i) => <Banner key={i} tone="error" icon={MdError}>{e}</Banner>)}
      {preview.warnings?.map((w, i) => <Banner key={i} tone="warn" icon={MdWarning}>{w}</Banner>)}

      <div style={{ ...grid, marginBottom: "0.9rem" }}>
        <Stat label="Sheet rows" value={preview.sourceRowCount} />
        <Stat label="Items" value={preview.rows.length} />
        <Stat label="Total quantity" value={qty(preview.totalQuantity)} />
        <Stat label="Total value" value={money(preview.totalValue)} />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Item</th><th style={th}>HS code</th><th style={th}>Unit</th>
              <th style={{ ...th, textAlign: "right" }}>Quantity</th>
              <th style={{ ...th, textAlign: "right" }}>Value</th>
              <th style={th}>What happens</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r, i) => (
              <tr key={i}>
                <td style={td}><div style={wrap2}>{r.itemName}</div></td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{r.hsCode || "—"}</td>
                <td style={td}>{r.unit || "—"}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{qty(r.quantity)}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.value)}</td>
                <td style={td}>
                  <span style={{ color: STATUS_TONE[r.status], fontWeight: 600, fontSize: 13 }}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                  {r.status === "ambiguous" && (
                    <select style={{ ...input, marginTop: 6 }} value={r.itemTypeId ?? ""}
                      onChange={(e) => chooseCandidate(i, e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Create a separate item</option>
                      {r.candidates.map((c) => (
                        <option key={c.itemTypeId} value={c.itemTypeId}>
                          Reuse "{c.name}" ({c.hsCode || "no HS code"})
                        </option>
                      ))}
                    </select>
                  )}
                  {r.messages?.map((m, k) => (
                    <div key={k} style={{ fontSize: 12, color: colors.textSecondary }}>{m}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...grid, marginTop: "1rem" }}>
        <label style={{ fontSize: 13, color: colors.textSecondary }}>
          These quantities are as at
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} style={input} />
        </label>
        <Check label="Post the total value to the Inventory account" checked={postValue} onChange={setPostValue} />
        <Check label="Track every item type as inventory" checked={enableTracking} onChange={setEnableTracking} />
      </div>

      {enableTracking && (
        <Banner tone="warn" icon={MdWarning}>
          Turning this on also blocks selling more of an item than is on hand. Tell the team —
          it changes their day-to-day, not just this import.
        </Banner>
      )}

      <button onClick={onCommit} disabled={!preview.canCommit || ambiguous > 0 || !!busy}
        style={{ ...btn(colors.success, !preview.canCommit || ambiguous > 0 || !!busy), marginTop: "0.6rem" }}>
        {busy === "commit" ? "Importing…" : `Import ${preview.rows.length} item(s)`}
      </button>
      {ambiguous > 0 && (
        <p style={{ fontSize: 13, color: "#b26a00", margin: "0.5rem 0 0" }}>
          Choose what to do with the {ambiguous} item(s) marked "Needs a choice" first.
        </p>
      )}
    </div>
  );
}

// ── Customer ledger review ──────────────────────────────────────────────────

function LedgerPreview({ preview, setCutover, setSetCutover, onCommit, busy }) {
  return (
    <div style={card}>
      <h2 style={{ fontSize: 15, margin: "0 0 0.6rem" }}>3 · Review and reconcile</h2>

      {preview.blockingErrors?.map((e, i) => <Banner key={i} tone="error" icon={MdError}>{e}</Banner>)}
      {preview.warnings?.map((w, i) => <Banner key={i} tone="warn" icon={MdWarning}>{w}</Banner>)}

      <div style={{ ...grid, marginBottom: "0.9rem" }}>
        <Stat label="Customers" value={preview.clients.length} />
        <Stat label="Invoices" value={preview.invoices.length} />
        <Stat label="Receipts" value={preview.receipts.length} />
        <Stat label="Opening" value={money(preview.totalOpening)} />
        <Stat label="Closing (calculated)" value={money(preview.totalComputedClosing)} />
        <Stat label="Closing (from the sheet)" value={money(preview.totalStatedClosing)} />
      </div>

      {preview.clientsOutOfBalance === 0 ? (
        <Banner tone="ok" icon={MdCheckCircle}>
          Every customer reconciles against the index sheet.
        </Banner>
      ) : (
        <Banner tone="error" icon={MdError}>
          {preview.clientsOutOfBalance} customer(s) do not reconcile. Fix the workbook and upload again.
        </Banner>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Customer</th>
              <th style={{ ...th, textAlign: "right" }}>Opening</th>
              <th style={{ ...th, textAlign: "right" }}>Invoiced</th>
              <th style={{ ...th, textAlign: "right" }}>Received</th>
              <th style={{ ...th, textAlign: "right" }}>Calculated</th>
              <th style={{ ...th, textAlign: "right" }}>From the sheet</th>
              <th style={{ ...th, textAlign: "right" }}>Difference</th>
            </tr>
          </thead>
          <tbody>
            {preview.clients.map((c) => {
              const off = Math.abs(c.difference) > 0.005;
              return (
                <tr key={c.indexRow}>
                  <td style={td}>
                    <div style={wrap2}>{c.indexName}</div>
                    {c.sheetName && (
                      <div style={{ fontSize: 12, color: "#b26a00" }}>sheet says: {c.sheetName}</div>
                    )}
                    {c.existingClientName && (
                      <div style={{ fontSize: 12, color: colors.textSecondary }}>
                        updates existing: {c.existingClientName}
                      </div>
                    )}
                    {c.warnings?.map((w, k) => (
                      <div key={k} style={{ fontSize: 12, color: colors.textSecondary }}>{w}</div>
                    ))}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(c.opening)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(c.totalCredit)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(c.totalDebit)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(c.computedClosing)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(c.statedClosing)}</td>
                  <td style={{
                    ...td, textAlign: "right", fontVariantNumeric: "tabular-nums",
                    color: off ? colors.danger : colors.textSecondary, fontWeight: off ? 600 : 400,
                  }}>
                    {money(c.difference)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <Check label="Freeze the ledger at the period end and load the receivable total"
          checked={setCutover} onChange={setSetCutover} />
      </div>

      <Banner tone="warn" icon={MdWarning}>
        The workbook records totals only, with no tax split, so the tax reports will show
        no output tax for this period. That is correct for a year already filed — but say
        so to whoever opens the report expecting last year's figures.
      </Banner>

      <button onClick={onCommit} disabled={!preview.canCommit || !!busy}
        style={{ ...btn(colors.success, !preview.canCommit || !!busy), marginTop: "0.6rem" }}>
        {busy === "commit"
          ? "Importing…"
          : `Import ${preview.clients.length} customer(s), ${preview.invoices.length} invoice(s)`}
      </button>
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────────────

function HistoryTab({ runs, onSupersede, canForce }) {
  if (runs.length === 0) {
    return <div style={card}><p style={{ margin: 0, color: colors.textSecondary }}>
      Nothing has been imported into this company yet.
    </p></div>;
  }
  return (
    <div style={card}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>File</th><th style={th}>What</th><th style={th}>When</th>
              <th style={th}>By</th><th style={th}>Wrote</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} style={{ opacity: r.isSuperseded ? 0.55 : 1 }}>
                <td style={td}><div style={wrap2}>{r.originalFileName}</div></td>
                <td style={td}>{r.kind === "OpeningStock" ? "Opening stock" : "Customer ledger"}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{new Date(r.importedAt).toLocaleDateString()}</td>
                <td style={td}>{r.importedByUserName || "—"}</td>
                <td style={td}>
                  {Object.entries(r.counts || {}).map(([k, v]) => (
                    <div key={k} style={{ fontSize: 12.5 }}>
                      {k.replace(/([A-Z])/g, " $1")}: <strong>{v}</strong>
                    </div>
                  ))}
                </td>
                <td style={td}>
                  {r.isSuperseded
                    ? <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                        set aside{r.supersedeReason ? ` — ${r.supersedeReason}` : ""}
                      </span>
                    : canForce && (
                        <button onClick={() => onSupersede(r)} style={{
                          ...btn(colors.danger), padding: "0.4rem 0.7rem", minHeight: 40, fontSize: 13,
                        }}>Set aside</button>
                      )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Small shared bits ───────────────────────────────────────────────────────

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: colors.textSecondary }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 10, fontSize: 13.5,
      color: colors.textPrimary, minHeight: 44, cursor: "pointer",
    }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, flexShrink: 0 }} />
      <span>{label}</span>
    </label>
  );
}
