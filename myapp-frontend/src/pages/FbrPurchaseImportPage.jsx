// src/pages/FbrPurchaseImportPage.jsx
//
// FBR Annexure-A xls upload + per-row import preview.
//
// Phase 1: preview only. The Commit button is rendered but disabled
// with a "coming in Phase 2" tooltip — keeps the layout final from
// day one and signals intent to the operator.
//
// Two states:
//   • Empty:    company picker + dropzone + "Run Preview" CTA.
//   • Preview:  decision-count chips, invoice list (collapsible per
//               invoice → lines), Warnings drawer, "Download skipped
//               CSV" link.
import { useState, useMemo, useRef, useEffect } from "react";
import { MdCloudUpload, MdInfo, MdCheckCircle, MdWarning, MdError, MdBlock, MdRefresh, MdFileDownload, MdInventory } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { previewFbrPurchaseImport, commitFbrPurchaseImport, downloadFbrPurchaseSample } from "../api/fbrPurchaseImportApi";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { PageHeader, CompanyPicker, Button, Card, Field, TableWrap, EmptyState } from "../ui/Kit";
import "./FbrPurchaseImportPage.css";

// Decision → display config. Single source of truth for chip colour,
// label, and icon. Used for both summary chips and per-row tags.
const DECISION_CONFIG = {
  "will-import":              { label: "Will import",         color: "#2e7d32", bg: "#e8f5e9", border: "#a5d6a7", icon: MdCheckCircle },
  "product-will-be-created":  { label: "Product to create",   color: "#0d47a1", bg: "#e3f2fd", border: "#90caf9", icon: MdInventory },
  "already-exists":           { label: "Already in ERP",      color: "#37474f", bg: "#eceff1", border: "#b0bec5", icon: MdInfo },
  // Status=Claimed in FBR Annexure-A — the operator has already filed
  // these in their monthly Sales Tax Return, so they're already in the
  // ERP per the ERP-first workflow. Shown gray (informational, not an
  // error) — same visual weight as already-exists.
  "skip-already-claimed":     { label: "Already claimed",     color: "#37474f", bg: "#eceff1", border: "#b0bec5", icon: MdInfo },
  // Unregistered seller — Taxpayer Type ≠ Registered. Placeholder NTN
  // 9999999999999, not input-tax-claimable. Amber, not red — it's a
  // legitimate FBR row, just not for ERP intake.
  "skip-unregistered-seller": { label: "Unregistered seller", color: "#8a4b00", bg: "#fff4e0", border: "#ffcc80", icon: MdWarning },
  "skip-cancelled":           { label: "Cancelled",           color: "#b71c1c", bg: "#ffebee", border: "#ef9a9a", icon: MdBlock },
  "skip-wrong-type":          { label: "Wrong invoice type",  color: "#b71c1c", bg: "#ffebee", border: "#ef9a9a", icon: MdBlock },
  "skip-no-hs-code":          { label: "No HS Code",          color: "#8a4b00", bg: "#fff4e0", border: "#ffcc80", icon: MdWarning },
  "skip-zero-qty":            { label: "Zero / no qty",       color: "#8a4b00", bg: "#fff4e0", border: "#ffcc80", icon: MdWarning },
  // Kept in the config for back-compat — filter doesn't emit it any more.
  "skip-no-description":      { label: "No description",      color: "#8a4b00", bg: "#fff4e0", border: "#ffcc80", icon: MdWarning },
  "failed-validation":        { label: "Validation failed",   color: "#b71c1c", bg: "#ffebee", border: "#ef9a9a", icon: MdError },
};

function decisionCfg(d) {
  return DECISION_CONFIG[d] || { label: d, color: "#5f6d7e", bg: "#eceff1", border: "#b0bec5", icon: MdInfo };
}

function formatPkr(v) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQty(v) {
  if (v == null || isNaN(v)) return "—";
  // Trim trailing zeros — qty 9380.00 → "9,380", qty 0.0004 → "0.0004"
  const n = Number(v);
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function formatDate(s) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return s; }
}

export default function FbrPurchaseImportPage() {
  const { selectedCompany, companies } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const [file, setFile] = useState(null);
  const [running, setRunning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [expandedInvoices, setExpandedInvoices] = useState(new Set());
  // Which FBR sheet layout the operator is working with. Both parse
  // automatically on upload (the parser matches columns by name across
  // layouts) — this selector drives the sample download + the on-screen
  // hint. "annexa" = claimed-only Annexure-A; "ledger" = all-purchases
  // Sales Ledger.
  const [sheetFormat, setSheetFormat] = useState("annexa");
  const [downloadingSample, setDownloadingSample] = useState(false);
  const fileInputRef = useRef(null);

  const canCommit = has?.("fbrimport.purchase.commit") ?? false;

  const summary = result?.summary;
  const counts = summary?.decisionCounts || {};

  // Auto-clear the preview when the operator switches company. Dedup
  // and the supplier/ItemType matches are scoped to a single company,
  // so a preview scoped to one tenant is misleading the moment another is
  // selected. Drop the result + collapse state but keep the picked
  // file so a one-click re-run is still possible.
  useEffect(() => {
    setResult(null);
    setCommitResult(null);
    setExpandedInvoices(new Set());
    setFile(null);
    // Reset the native <input type=file> too — without this, the
    // "Choose file" widget keeps showing the old filename even though
    // our `file` state was cleared. Operators were getting confused
    // about which company a queued upload belongs to.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [selectedCompany?.id]);

  const onSelectFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const lower = (f.name || "").toLowerCase();
    if (!lower.endsWith(".xls") && !lower.endsWith(".xlsx")) {
      notify("Please pick a .xls or .xlsx file.", "error");
      return;
    }
    setFile(f);
    setResult(null); // any new file invalidates the previous preview
  };

  const onDownloadSample = async () => {
    setDownloadingSample(true);
    try {
      await downloadFbrPurchaseSample(sheetFormat);
      notify("Sample downloaded — fictional data, safe to use in demos.", "success");
    } catch {
      notify("Could not download the sample file.", "error");
    } finally {
      setDownloadingSample(false);
    }
  };

  const onRun = async () => {
    if (!file) { notify("Pick an FBR purchase sheet (.xls / .xlsx) first.", "error"); return; }
    if (!selectedCompany) { notify("Pick a company first.", "error"); return; }
    setRunning(true);
    try {
      const data = await previewFbrPurchaseImport(file, selectedCompany.id);
      setResult(data);
      // Auto-expand the first invoice so the operator sees line detail
      // immediately for the most common case (single-invoice files).
      if (data?.invoices?.length) setExpandedInvoices(new Set([0]));
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Preview failed.";
      notify(msg, "error");
    } finally {
      setRunning(false);
    }
  };

  const onReset = () => {
    setFile(null);
    setResult(null);
    setCommitResult(null);
    setExpandedInvoices(new Set());
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Pre-flight summary for the confirmation modal — taken from the
  // current preview's decision counts. We intentionally don't fetch a
  // fresh preview here; the operator just looked at it.
  const willImportTotal = (result?.summary?.decisionCounts?.willImport || 0)
                        + (result?.summary?.decisionCounts?.productWillCreate || 0);
  const productCreateCount = result?.summary?.decisionCounts?.productWillCreate || 0;
  const willImportInvoices = result?.invoices?.filter((i) =>
    i.decision === "will-import" || i.decision === "product-will-be-created"
  ) || [];

  // Commit handler — confirms via project's useConfirm modal, then
  // re-uploads the same file. Server re-parses; this is intentional
  // (statelessness, no preview-cache TTL to manage). Idempotent — a
  // second commit of the same file just yields zero new imports
  // because the dedup matcher catches everything already-imported.
  const onCommit = async () => {
    if (!file || !selectedCompany || !result || willImportTotal === 0) return;

    const supplierEstimate = new Set(
      willImportInvoices
        .filter((i) => !i.matchedSupplierId)
        .map((i) => i.supplierNtn)
    ).size;

    const ok = await confirm({
      title: "Commit FBR Import?",
      variant: "warning",
      confirmText: "Commit",
      cancelText: "Cancel",
      message: (
        `${willImportInvoices.length} invoice${willImportInvoices.length !== 1 ? "s" : ""} `
        + `with ${willImportTotal} line${willImportTotal !== 1 ? "s" : ""} will be imported.\n`
        + (supplierEstimate ? `${supplierEstimate} new supplier${supplierEstimate !== 1 ? "s" : ""} will be created.\n` : "")
        + (productCreateCount ? `${productCreateCount} new product${productCreateCount !== 1 ? "s" : ""} will be auto-added to Item Types.\n` : "")
        + `Stock movements (Direction = In) will be recorded for every imported line.\n\n`
        + `This cannot be undone via the UI — only by deleting each Purchase Bill manually.`
      ),
    });
    if (!ok) return;

    setCommitting(true);
    try {
      const data = await commitFbrPurchaseImport(file, selectedCompany.id);
      setCommitResult(data);
      // Drop the preview pane — the operator's attention should move
      // to the result. They can clear and re-run a fresh preview if
      // needed.
      setResult(null);
      setExpandedInvoices(new Set());
      notify(`Imported ${data.counts.invoicesImported} invoice${data.counts.invoicesImported !== 1 ? "s" : ""}.`, "success");
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Commit failed.";
      notify(msg, "error");
    } finally {
      setCommitting(false);
    }
  };

  const toggleInvoice = (idx) => {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  // CSV of skipped rows for offline triage. One of the acceptance
  // criteria — operators want to mine "why did this row not come
  // through?" without re-running the upload.
  //
  // Audit H-14 (2026-05-13): prefix any string starting with =, +, -, @,
  // tab or carriage-return with a single quote so Excel doesn't
  // interpret it as a formula (=WEBSERVICE → SSRF, =HYPERLINK → exfil).
  const csvSafe = (raw) => {
    const s = String(raw ?? "");
    if (!s) return s;
    const first = s[0];
    if (first === "=" || first === "+" || first === "-" || first === "@" || first === "\t" || first === "\r") {
      return "'" + s;
    }
    return s;
  };
  const skippedCsvHref = useMemo(() => {
    if (!result?.invoices?.length) return null;
    const lines = [["Invoice", "Supplier NTN", "Supplier", "Date", "Row", "HS Code", "Description", "Quantity", "Decision"].join(",")];
    for (const inv of result.invoices) {
      for (const ln of inv.lines) {
        if (ln.decision === "will-import" || ln.decision === "product-will-be-created") continue;
        const cells = [inv.invoiceNo, inv.supplierNtn, inv.supplierName, inv.invoiceDate || "", ln.sourceRowNumber, ln.hsCode, ln.description, ln.quantity, ln.decision]
          .map((c) => `"${csvSafe(c).replaceAll('"', '""')}"`);
        lines.push(cells.join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    return URL.createObjectURL(blob);
  }, [result]);

  return (
    <div className="fbr-imp-page" style={{ padding: "1.5rem 2rem", maxWidth: 1400, margin: "0 auto" }}>
      <PageHeader
        icon={MdCloudUpload}
        tone="brand"
        title="FBR Purchase Import"
        subtitle={(
          <>
            Upload your FBR purchase sheet — Annexure-A (claimed only) or the Sales
            Ledger (all purchases) — and preview exactly which rows would land as new
            purchases before you commit.
          </>
        )}
      />

      {companies.length > 0 && <CompanyPicker />}

      {/* ── Upload card ─────────────────────────────────────────────── */}
      <Card style={styles.card}>
        <div className="fbr-imp-upload-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "1rem" }}>
          <Field label="Sheet format" className="fbr-imp-upload-row__field">
            <select
              className="k-select"
              style={{ minWidth: 200 }}
              value={sheetFormat}
              onChange={(e) => setSheetFormat(e.target.value)}
            >
              <option value="annexa">Annexure-A — claimed only</option>
              <option value="ledger">Sales Ledger — all purchases</option>
            </select>
          </Field>

          <div className="fbr-imp-upload-row__field" style={{ flex: 1, minWidth: "min(280px, 100%)" }}>
            <Field label="FBR purchase sheet (.xls / .xlsx)">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx"
                onChange={onSelectFile}
                className="k-input"
                style={styles.fileInput}
              />
              {file && (
                <div style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)", marginTop: "0.3rem", overflowWrap: "anywhere" }}>
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </div>
              )}
            </Field>
          </div>

          <div className="fbr-imp-upload-row__btns" style={{ display: "flex", gap: "0.5rem" }}>
            <Button
              variant="primary"
              icon={running ? undefined : MdCloudUpload}
              disabled={running || !file}
              onClick={onRun}
            >
              {running && <span className="btn-spinner" />}
              {running ? "Running..." : "Run Preview"}
            </Button>
            {result && (
              <Button icon={MdRefresh} onClick={onReset}>Clear</Button>
            )}
          </div>
        </div>

        {/* Sample download + format hint — both layouts parse automatically;
            the selector above chooses which fictional sample to download. */}
        <div className="fbr-imp-sample-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem", marginTop: "0.9rem", paddingTop: "0.9rem", borderTop: "1px solid var(--k-line)" }}>
          <Button
            icon={MdFileDownload}
            disabled={downloadingSample}
            onClick={onDownloadSample}
          >
            {downloadingSample ? "Preparing..." : "Download sample"}
          </Button>
          <span style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)", lineHeight: 1.4, flex: 1, minWidth: "min(240px, 100%)" }}>
            {sheetFormat === "ledger"
              ? "Sales Ledger — the IRIS export with ALL purchases (claimed + unclaimed)."
              : "Annexure-A — the claimed-only export (the input tax you filed)."}
            {" "}Both layouts upload here; the sample is fictional (safe for demos) and re-uploadable.
          </span>
        </div>
      </Card>

      {/* ── Commit result panel ─────────────────────────────────────────
           Shown after Commit completes. Replaces the preview view and
           summarises what landed in the DB. The operator can clear and
           start over (Run Preview again) once they've reviewed it. */}
      {commitResult && (
        <Card style={{ ...styles.card, borderLeft: "4px solid #2e7d32" }}>
          <div className="fbr-imp-result-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
              <MdCheckCircle size={20} color="#2e7d32" />
              <strong style={{ fontSize: "calc(var(--k-font) + 0.1rem)", color: "#2e7d32" }}>Import committed</strong>
              <span className="fbr-imp-result-head__time" style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)", overflowWrap: "anywhere" }}>
                {commitResult.fileName} · {new Date(commitResult.committedAt).toLocaleString("en-PK")}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <span style={{ ...styles.chip, color: "#2e7d32", backgroundColor: "#e8f5e9", border: "1px solid #a5d6a7" }}>
              <MdCheckCircle size={14} />
              <strong>{commitResult.counts.invoicesImported}</strong> invoices imported
            </span>
            {commitResult.counts.invoicesFailed > 0 && (
              <span style={{ ...styles.chip, color: "#b71c1c", backgroundColor: "#ffebee", border: "1px solid #ef9a9a" }}>
                <MdError size={14} />
                <strong>{commitResult.counts.invoicesFailed}</strong> failed (rolled back)
              </span>
            )}
            <span style={{ ...styles.chip, color: "#37474f", backgroundColor: "#eceff1", border: "1px solid #b0bec5" }}>
              <MdInfo size={14} />
              <strong>{commitResult.counts.invoicesSkipped}</strong> skipped
            </span>
            <span style={{ ...styles.chip, color: "#0d47a1", backgroundColor: "#e3f2fd", border: "1px solid #90caf9" }}>
              <strong>{commitResult.counts.suppliersCreated}</strong> new suppliers
            </span>
            <span style={{ ...styles.chip, color: "#0d47a1", backgroundColor: "#e3f2fd", border: "1px solid #90caf9" }}>
              <strong>{commitResult.counts.itemTypesCreated}</strong> new products
            </span>
            <span style={{ ...styles.chip, color: "#0d47a1", backgroundColor: "#e3f2fd", border: "1px solid #90caf9" }}>
              <strong>{commitResult.counts.linesImported}</strong> line items
            </span>
            <span style={{ ...styles.chip, color: "#0d47a1", backgroundColor: "#e3f2fd", border: "1px solid #90caf9" }}>
              <strong>{commitResult.counts.stockMovementsRecorded}</strong> stock movements
            </span>
          </div>

          {/* Failed rows table — only shown when something rolled back.
              Operator fixes the upstream problem and re-uploads; the
              dedup matcher will skip the already-imported invoices on
              the second pass. */}
          {commitResult.counts.invoicesFailed > 0 && (
            <div style={{ marginTop: "0.5rem" }}>
              <strong style={{ fontSize: "var(--k-font)", color: "#b71c1c" }}>Failed invoices:</strong>
              <ul style={{ marginTop: "0.3rem", paddingLeft: "1.4rem", color: "var(--k-ink)", fontSize: "var(--k-font-sm)" }}>
                {commitResult.invoices
                  .filter((i) => i.outcome === "failed")
                  .map((i, idx) => (
                    <li key={idx} style={{ marginBottom: "0.2rem" }}>
                      <strong>{i.invoiceNo}</strong> ({i.supplierName})
                      {i.errorMessage && <span style={{ color: "#b71c1c" }}> — {i.errorMessage}</span>}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* ── Workbook warnings ───────────────────────────────────────── */}
      {result?.warnings?.length > 0 && (
        <Card style={{ ...styles.card, borderLeft: "4px solid #e65100" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.4rem" }}>
            <MdWarning color="#e65100" />
            <strong style={{ color: "#e65100" }}>Workbook warnings</strong>
          </div>
          <ul style={{ margin: 0, paddingLeft: "1.4rem", color: "var(--k-muted)", fontSize: "var(--k-font-sm)", overflowWrap: "anywhere" }}>
            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Card>
      )}

      {/* ── Summary chips ───────────────────────────────────────────── */}
      {summary && (
        <Card style={styles.card}>
          <div className="fbr-imp-summary-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.75rem" }}>
            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              <strong style={{ fontSize: "calc(var(--k-font) + 0.1rem)", color: "var(--k-ink)" }}>{summary.fileName}</strong>
              <span className="fbr-imp-summary-meta" style={{ marginLeft: "0.6rem", fontSize: "var(--k-font-sm)", color: "var(--k-muted)" }}>
                {summary.totalRows} rows · {summary.totalInvoices} invoices
              </span>
            </div>
            <div className="fbr-imp-summary-actions" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              {skippedCsvHref && (
                <a
                  href={skippedCsvHref}
                  download={`fbr-skipped-${Date.now()}.csv`}
                  className="k-btn k-btn--secondary"
                  title="Export every non-importable row to CSV for offline triage"
                >
                  <MdFileDownload size={16} aria-hidden="true" /> Download skipped CSV
                </a>
              )}
              {(() => {
                // Enable conditions, in priority order — the first
                // failure becomes the disabled tooltip so the operator
                // knows EXACTLY why the button is gray.
                let disabledReason = null;
                if (!canCommit) disabledReason = "You don't have permission to commit imports.";
                else if (committing) disabledReason = "Commit in progress…";
                else if (!result) disabledReason = "Run Preview first.";
                else if (willImportTotal === 0) disabledReason = "Nothing to import — every row was already claimed, already in ERP, or skipped.";

                return (
                  <Button
                    variant="teal"
                    icon={committing ? undefined : MdCheckCircle}
                    disabled={!!disabledReason}
                    onClick={onCommit}
                    title={disabledReason || `Commit ${willImportInvoices.length} invoice${willImportInvoices.length !== 1 ? "s" : ""} (${willImportTotal} line${willImportTotal !== 1 ? "s" : ""}) into Purchase Bills.`}
                  >
                    {committing && <span className="btn-spinner" />}
                    {committing ? "Committing..." : "Commit Import"}
                  </Button>
                );
              })()}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {[
              ["will-import",             counts.willImport],
              ["product-will-be-created", counts.productWillCreate],
              ["already-exists",          counts.alreadyExists],
              ["skip-already-claimed",    counts.skipAlreadyClaimed],
              ["skip-unregistered-seller", counts.skipUnregisteredSeller],
              ["skip-no-hs-code",         counts.skipNoHsCode],
              ["skip-zero-qty",           counts.skipZeroQty],
              ["skip-no-description",     counts.skipNoDescription],
              ["skip-cancelled",          counts.skipCancelled],
              ["skip-wrong-type",         counts.skipWrongType],
              ["failed-validation",       counts.failedValidation],
            ].filter(([, n]) => n > 0).map(([d, n]) => {
              const cfg = decisionCfg(d);
              const Icon = cfg.icon;
              return (
                <span key={d} style={{ ...styles.chip, color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}` }}>
                  <Icon size={14} />
                  <strong>{n}</strong> {cfg.label}
                </span>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Invoice list ────────────────────────────────────────────── */}
      {summary && result.invoices.length === 0 && (
        <EmptyState>No invoices parsed from this file. Check the workbook warnings above.</EmptyState>
      )}

      {result?.invoices?.map((inv, idx) => {
        const cfg = decisionCfg(inv.decision);
        const Icon = cfg.icon;
        const open = expandedInvoices.has(idx);
        return (
          <Card flush key={`${inv.fbrInvoiceRefNo}-${idx}`} style={{ ...styles.card, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => toggleInvoice(idx)}
              className="fbr-imp-invoice-header"
              aria-expanded={open}
              style={{ ...styles.invoiceHeader, borderLeft: `4px solid ${cfg.border}` }}
            >
              <div className="fbr-imp-invoice-header__main" style={{ display: "flex", alignItems: "center", gap: "0.55rem", flex: 1, minWidth: 0, flexWrap: "wrap" }}>
                <span style={{ ...styles.chip, color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}` }}>
                  <Icon size={14} />
                  {cfg.label}
                </span>
                <strong style={{ color: "var(--k-ink)", fontSize: "calc(var(--k-font) + 0.05rem)", overflowWrap: "anywhere" }}>{inv.invoiceNo || "(no invoice no)"}</strong>
                <span className="fbr-imp-invoice-header__sep" style={styles.headerMeta}>·</span>
                <span className="fbr-imp-invoice-header__supplier" style={{ ...styles.headerMeta, overflowWrap: "anywhere", minWidth: 0 }}>
                  {inv.supplierName || inv.supplierNtn || "(unknown supplier)"}
                </span>
                <span className="fbr-imp-invoice-header__sep" style={styles.headerMeta}>·</span>
                <span className="fbr-imp-invoice-header__date" style={styles.headerMeta}>
                  {formatDate(inv.invoiceDate)}
                </span>
              </div>
              <div className="fbr-imp-invoice-header__meta" style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexShrink: 0 }}>
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "var(--k-font-sm)", color: "var(--k-ink)" }}>
                  Rs. {formatPkr(inv.totalGrossValue)}
                </span>
                <span style={{ fontSize: "0.78rem", color: "var(--k-muted)" }}>
                  {inv.lines.length} line{inv.lines.length !== 1 ? "s" : ""}
                </span>
                <span style={{ fontSize: "var(--k-font)", color: "var(--k-blue)" }}>{open ? "▼" : "▶"}</span>
              </div>
            </button>

            {open && (
              <div className="fbr-imp-invoice-body" style={{ padding: "0.6rem 1rem 1rem", borderTop: "1px solid var(--k-line)" }}>
                {/* Bill-level meta */}
                <div className="fbr-imp-bill-meta" style={{ display: "flex", flexWrap: "wrap", gap: "0.85rem", fontSize: "0.78rem", color: "var(--k-muted)", marginBottom: "0.55rem" }}>
                  <span><strong>FBR Ref:</strong> {inv.fbrInvoiceRefNo || "—"}</span>
                  <span><strong>Supplier NTN:</strong> {inv.supplierNtn || "—"}</span>
                  <span><strong>Match:</strong> {inv.matchedSupplierId ? `Supplier #${inv.matchedSupplierId}` : "Will create"}</span>
                  {inv.matchedPurchaseBillId && (
                    <span><strong>Existing Bill:</strong> #{inv.matchedPurchaseBillId}</span>
                  )}
                </div>

                {/* Lines table — desktop */}
                <TableWrap className="fbr-imp-table-wrap">
                  <table className="k-table k-table--compact">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>HS Code</th>
                        <th>Description</th>
                        <th className="k-num">Qty</th>
                        <th>UoM</th>
                        <th className="k-num">Value Excl Tax</th>
                        <th className="k-num">GST</th>
                        <th className="k-num">Extra Tax</th>
                        <th className="k-num">ST Withheld</th>
                        <th>Item Match</th>
                        <th>Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.lines.map((ln, lidx) => {
                        const lcfg = decisionCfg(ln.decision);
                        const LIcon = lcfg.icon;
                        return (
                          <tr key={lidx}>
                            <td style={styles.td}>{ln.sourceRowNumber}</td>
                            <td style={{ ...styles.td, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{ln.hsCode || "—"}</td>
                            <td style={styles.td}>{ln.description || <em className="k-muted">(blank)</em>}</td>
                            <td className="k-num" style={styles.td}>{formatQty(ln.quantity)}</td>
                            <td style={styles.td}>{ln.uom || "—"}</td>
                            <td className="k-num" style={styles.td}>{formatPkr(ln.valueExclTax)}</td>
                            <td className="k-num" style={styles.td}>{formatPkr(ln.gstAmount)}</td>
                            <td className="k-num" style={styles.td}>{formatPkr(ln.extraTax)}</td>
                            <td className="k-num" style={styles.td}>{formatPkr(ln.stWithheldAtSource)}</td>
                            <td style={styles.td}>
                              {ln.matchedItemTypeId ? (
                                <span>
                                  {ln.matchedItemTypeName} <small className="k-muted">· {ln.matchedBy}</small>
                                </span>
                              ) : <em className="k-muted">—</em>}
                            </td>
                            <td style={styles.td}>
                              <span style={{ ...styles.chipSmall, color: lcfg.color, backgroundColor: lcfg.bg, border: `1px solid ${lcfg.border}` }}>
                                <LIcon size={12} /> {lcfg.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>

                {/* Lines — mobile cards (CSS toggles visibility) */}
                <div className="fbr-imp-line-cards">
                  {inv.lines.map((ln, lidx) => {
                    const lcfg = decisionCfg(ln.decision);
                    const LIcon = lcfg.icon;
                    return (
                      <div className="fbr-imp-line-card" key={lidx}>
                        <div className="fbr-imp-line-card__head">
                          <span style={{ ...styles.chipSmall, color: lcfg.color, backgroundColor: lcfg.bg, border: `1px solid ${lcfg.border}` }}>
                            <LIcon size={12} /> {lcfg.label}
                          </span>
                          <span className="fbr-imp-line-card__row-num">Row {ln.sourceRowNumber}</span>
                        </div>

                        {ln.hsCode && <div className="fbr-imp-line-card__hs">HS {ln.hsCode}</div>}

                        <div className="fbr-imp-line-card__desc">
                          {ln.description || <em style={{ color: "var(--k-muted)" }}>(blank)</em>}
                        </div>

                        <div className="fbr-imp-line-card__grid">
                          <div className="fbr-imp-line-card__field">
                            <span className="fbr-imp-line-card__field-label">Qty</span>
                            <span className="fbr-imp-line-card__field-value">{formatQty(ln.quantity)}</span>
                          </div>
                          <div className="fbr-imp-line-card__field">
                            <span className="fbr-imp-line-card__field-label">UoM</span>
                            <span className={`fbr-imp-line-card__field-value${ln.uom ? "" : " fbr-imp-line-card__field-value--muted"}`}>
                              {ln.uom || "—"}
                            </span>
                          </div>
                          <div className="fbr-imp-line-card__field">
                            <span className="fbr-imp-line-card__field-label">Excl Tax</span>
                            <span className="fbr-imp-line-card__field-value">{formatPkr(ln.valueExclTax)}</span>
                          </div>
                          <div className="fbr-imp-line-card__field">
                            <span className="fbr-imp-line-card__field-label">GST</span>
                            <span className="fbr-imp-line-card__field-value">{formatPkr(ln.gstAmount)}</span>
                          </div>
                          <div className="fbr-imp-line-card__field">
                            <span className="fbr-imp-line-card__field-label">Extra Tax</span>
                            <span className="fbr-imp-line-card__field-value">{formatPkr(ln.extraTax)}</span>
                          </div>
                          <div className="fbr-imp-line-card__field">
                            <span className="fbr-imp-line-card__field-label">ST Withheld</span>
                            <span className="fbr-imp-line-card__field-value">{formatPkr(ln.stWithheldAtSource)}</span>
                          </div>
                        </div>

                        <div className="fbr-imp-line-card__match">
                          <span className="fbr-imp-line-card__match-label">Match</span>
                          {ln.matchedItemTypeId ? (
                            <span>
                              {ln.matchedItemTypeName}
                              <small style={{ color: "var(--k-muted)" }}> · {ln.matchedBy}</small>
                            </span>
                          ) : <em style={{ color: "var(--k-muted)" }}>—</em>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// Page-specific layout; themed roles (header, buttons, inputs, cards, table) come from the kit.
// The decision chips keep their fixed semantic colours (green = import, amber = skip, red = blocked).
const styles = {
  // Cards stack with the kit section gap (inline margin overrides `.k-card + .k-card`).
  card: { margin: "0 0 var(--k-gap)" },
  fileInput: { padding: "0.3rem 0.5rem", height: "auto" },
  chip: {
    display: "inline-flex", alignItems: "center", gap: "0.3rem",
    padding: "0.25rem 0.6rem",
    borderRadius: 999,
    fontSize: "0.78rem",
    fontWeight: 600,
  },
  chipSmall: {
    display: "inline-flex", alignItems: "center", gap: "0.25rem",
    padding: "0.1rem 0.45rem",
    borderRadius: 999,
    fontSize: "0.72rem",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  invoiceHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
    width: "100%",
    margin: 0,
    padding: "0.7rem 1rem",
    background: "var(--k-surface-2)",
    border: "none",
    borderRadius: 0,
    boxShadow: "none",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    fontWeight: 400,
    color: "var(--k-ink)",
  },
  headerMeta: { color: "var(--k-muted)", fontSize: "var(--k-font-sm)" },
  td: { verticalAlign: "top" },
};
