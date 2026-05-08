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
import { previewFbrPurchaseImport, commitFbrPurchaseImport } from "../api/fbrPurchaseImportApi";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

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
  const { selectedCompany, companies, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const [file, setFile] = useState(null);
  const [running, setRunning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [expandedInvoices, setExpandedInvoices] = useState(new Set());
  const fileInputRef = useRef(null);

  const canCommit = has?.("fbrimport.purchase.commit") ?? false;

  const summary = result?.summary;
  const counts = summary?.decisionCounts || {};

  // Auto-clear the preview when the operator switches company. Dedup
  // and the supplier/ItemType matches are scoped to a single company,
  // so a Hakimi-scoped preview is misleading the moment Roshan is
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
      notify.error("Please pick a .xls or .xlsx file.");
      return;
    }
    setFile(f);
    setResult(null); // any new file invalidates the previous preview
  };

  const onRun = async () => {
    if (!file) { notify.error("Pick an FBR Annexure-A xls file first."); return; }
    if (!selectedCompany) { notify.error("Pick a company first."); return; }
    setRunning(true);
    try {
      const data = await previewFbrPurchaseImport(file, selectedCompany.id);
      setResult(data);
      // Auto-expand the first invoice so the operator sees line detail
      // immediately for the most common case (single-invoice files).
      if (data?.invoices?.length) setExpandedInvoices(new Set([0]));
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Preview failed.";
      notify.error(msg);
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
      notify.success(`Imported ${data.counts.invoicesImported} invoice${data.counts.invoicesImported !== 1 ? "s" : ""}.`);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Commit failed.";
      notify.error(msg);
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
  const skippedCsvHref = useMemo(() => {
    if (!result?.invoices?.length) return null;
    const lines = [["Invoice", "Supplier NTN", "Supplier", "Date", "Row", "HS Code", "Description", "Quantity", "Decision"].join(",")];
    for (const inv of result.invoices) {
      for (const ln of inv.lines) {
        if (ln.decision === "will-import" || ln.decision === "product-will-be-created") continue;
        const cells = [inv.invoiceNo, inv.supplierNtn, inv.supplierName, inv.invoiceDate || "", ln.sourceRowNumber, ln.hsCode, ln.description, ln.quantity, ln.decision]
          .map((c) => `"${String(c ?? "").replaceAll('"', '""')}"`);
        lines.push(cells.join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    return URL.createObjectURL(blob);
  }, [result]);

  return (
    <div style={{ padding: "1.5rem 2rem", maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "0.85rem", marginBottom: "0.75rem" }}>
        <div style={styles.headerIcon}><MdCloudUpload size={28} color="#fff" /></div>
        <div>
          <h2 style={styles.pageTitle}>FBR Purchase Import</h2>
          <p style={styles.pageSubtitle}>
            Phase 1 preview — upload your Annexure-A xls and see exactly which rows
            would land as new purchases (no DB writes yet).
          </p>
        </div>
      </header>

      {/* ── Upload card ─────────────────────────────────────────────── */}
      <section style={styles.card}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "1rem" }}>
          <div style={{ minWidth: 220 }}>
            <label style={styles.label}>Company</label>
            <select
              style={styles.input}
              value={selectedCompany?.id || ""}
              onChange={(e) => {
                const id = parseInt(e.target.value);
                const c = companies.find((cc) => cc.id === id);
                if (c) setSelectedCompany(c);
              }}
            >
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 280 }}>
            <label style={styles.label}>Annexure-A file (.xls / .xlsx)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx"
              onChange={onSelectFile}
              style={{ ...styles.input, padding: "0.4rem 0.5rem" }}
            />
            {file && (
              <div style={{ fontSize: "0.78rem", color: colors.textSecondary, marginTop: "0.3rem" }}>
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              style={{ ...styles.primaryBtn, opacity: running || !file ? 0.5 : 1 }}
              disabled={running || !file}
              onClick={onRun}
            >
              {running ? <span className="btn-spinner" /> : <MdCloudUpload size={16} />}
              {running ? "Running..." : "Run Preview"}
            </button>
            {result && (
              <button type="button" style={styles.secondaryBtn} onClick={onReset}>
                <MdRefresh size={16} /> Clear
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Commit result panel ─────────────────────────────────────────
           Shown after Commit completes. Replaces the preview view and
           summarises what landed in the DB. The operator can clear and
           start over (Run Preview again) once they've reviewed it. */}
      {commitResult && (
        <section style={{ ...styles.card, borderLeft: "4px solid #2e7d32" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <MdCheckCircle size={20} color="#2e7d32" />
              <strong style={{ fontSize: "1rem", color: "#2e7d32" }}>Import committed</strong>
              <span style={{ fontSize: "0.82rem", color: colors.textSecondary }}>
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
              <strong style={{ fontSize: "0.85rem", color: "#b71c1c" }}>Failed invoices:</strong>
              <ul style={{ marginTop: "0.3rem", paddingLeft: "1.4rem", color: colors.textPrimary, fontSize: "0.83rem" }}>
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
        </section>
      )}

      {/* ── Workbook warnings ───────────────────────────────────────── */}
      {result?.warnings?.length > 0 && (
        <section style={{ ...styles.card, borderLeft: "4px solid #e65100" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.4rem" }}>
            <MdWarning color="#e65100" />
            <strong style={{ color: "#e65100" }}>Workbook warnings</strong>
          </div>
          <ul style={{ margin: 0, paddingLeft: "1.4rem", color: colors.textSecondary, fontSize: "0.83rem" }}>
            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </section>
      )}

      {/* ── Summary chips ───────────────────────────────────────────── */}
      {summary && (
        <section style={styles.card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.75rem" }}>
            <div>
              <strong style={{ fontSize: "1rem", color: colors.textPrimary }}>{summary.fileName}</strong>
              <span style={{ marginLeft: "0.6rem", fontSize: "0.83rem", color: colors.textSecondary }}>
                {summary.totalRows} rows · {summary.totalInvoices} invoices
              </span>
            </div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {skippedCsvHref && (
                <a
                  href={skippedCsvHref}
                  download={`fbr-skipped-${Date.now()}.csv`}
                  style={styles.secondaryLink}
                  title="Export every non-importable row to CSV for offline triage"
                >
                  <MdFileDownload size={14} /> Download skipped CSV
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
                  <button
                    type="button"
                    style={{
                      ...styles.primaryBtn,
                      backgroundColor: disabledReason ? "#9e9e9e" : "#2e7d32",
                      cursor: disabledReason ? "not-allowed" : "pointer",
                    }}
                    disabled={!!disabledReason}
                    onClick={onCommit}
                    title={disabledReason || `Commit ${willImportInvoices.length} invoice${willImportInvoices.length !== 1 ? "s" : ""} (${willImportTotal} line${willImportTotal !== 1 ? "s" : ""}) into Purchase Bills.`}
                  >
                    {committing ? <span className="btn-spinner" /> : <MdCheckCircle size={16} />}
                    {committing ? "Committing..." : "Commit Import"}
                  </button>
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
        </section>
      )}

      {/* ── Invoice list ────────────────────────────────────────────── */}
      {summary && result.invoices.length === 0 && (
        <section style={styles.card}>
          <p style={{ margin: 0, color: colors.textSecondary }}>
            No invoices parsed from this file. Check the workbook warnings above.
          </p>
        </section>
      )}

      {result?.invoices?.map((inv, idx) => {
        const cfg = decisionCfg(inv.decision);
        const Icon = cfg.icon;
        const open = expandedInvoices.has(idx);
        return (
          <section key={`${inv.fbrInvoiceRefNo}-${idx}`} style={{ ...styles.card, padding: 0, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => toggleInvoice(idx)}
              style={{ ...styles.invoiceHeader, borderLeft: `4px solid ${cfg.border}` }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flex: 1, minWidth: 0 }}>
                <span style={{ ...styles.chip, color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}` }}>
                  <Icon size={14} />
                  {cfg.label}
                </span>
                <strong style={{ color: colors.textPrimary, fontSize: "0.95rem" }}>{inv.invoiceNo || "(no invoice no)"}</strong>
                <span style={{ color: colors.textSecondary, fontSize: "0.82rem" }}>
                  · {inv.supplierName || inv.supplierNtn || "(unknown supplier)"}
                </span>
                <span style={{ color: colors.textSecondary, fontSize: "0.82rem" }}>
                  · {formatDate(inv.invoiceDate)}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexShrink: 0 }}>
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.82rem", color: colors.textPrimary }}>
                  Rs. {formatPkr(inv.totalGrossValue)}
                </span>
                <span style={{ fontSize: "0.78rem", color: colors.textSecondary }}>
                  {inv.lines.length} line{inv.lines.length !== 1 ? "s" : ""}
                </span>
                <span style={{ fontSize: "0.85rem", color: colors.blue }}>{open ? "▼" : "▶"}</span>
              </div>
            </button>

            {open && (
              <div style={{ padding: "0.6rem 1rem 1rem", borderTop: `1px solid ${colors.cardBorder}` }}>
                {/* Bill-level meta */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.85rem", fontSize: "0.78rem", color: colors.textSecondary, marginBottom: "0.55rem" }}>
                  <span><strong>FBR Ref:</strong> {inv.fbrInvoiceRefNo || "—"}</span>
                  <span><strong>Supplier NTN:</strong> {inv.supplierNtn || "—"}</span>
                  <span><strong>Match:</strong> {inv.matchedSupplierId ? `Supplier #${inv.matchedSupplierId}` : "Will create"}</span>
                  {inv.matchedPurchaseBillId && (
                    <span><strong>Existing Bill:</strong> #{inv.matchedPurchaseBillId}</span>
                  )}
                </div>

                {/* Lines table */}
                <div style={{ overflowX: "auto" }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Row</th>
                        <th style={styles.th}>HS Code</th>
                        <th style={styles.th}>Description</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Qty</th>
                        <th style={styles.th}>UoM</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Value Excl Tax</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>GST</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Extra Tax</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>ST Withheld</th>
                        <th style={styles.th}>Item Match</th>
                        <th style={styles.th}>Decision</th>
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
                            <td style={styles.td}>{ln.description || <em style={{ color: colors.textSecondary }}>(blank)</em>}</td>
                            <td style={{ ...styles.td, textAlign: "right" }}>{formatQty(ln.quantity)}</td>
                            <td style={styles.td}>{ln.uom || "—"}</td>
                            <td style={{ ...styles.td, textAlign: "right" }}>{formatPkr(ln.valueExclTax)}</td>
                            <td style={{ ...styles.td, textAlign: "right" }}>{formatPkr(ln.gstAmount)}</td>
                            <td style={{ ...styles.td, textAlign: "right" }}>{formatPkr(ln.extraTax)}</td>
                            <td style={{ ...styles.td, textAlign: "right" }}>{formatPkr(ln.stWithheldAtSource)}</td>
                            <td style={styles.td}>
                              {ln.matchedItemTypeId ? (
                                <span style={{ color: colors.textPrimary }}>
                                  {ln.matchedItemTypeName} <small style={{ color: colors.textSecondary }}>· {ln.matchedBy}</small>
                                </span>
                              ) : <em style={{ color: colors.textSecondary }}>—</em>}
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
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

const styles = {
  headerIcon: {
    width: 48, height: 48, borderRadius: 12,
    background: "linear-gradient(135deg, #0d47a1, #00897b)",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  pageTitle: { margin: 0, fontSize: "1.4rem", fontWeight: 800, color: colors.textPrimary },
  pageSubtitle: { margin: 0, fontSize: "0.85rem", color: colors.textSecondary },
  card: {
    background: "#fff",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 12,
    padding: "1rem 1.1rem",
    margin: "1rem 0",
  },
  label: { display: "block", fontSize: "0.78rem", color: colors.textSecondary, marginBottom: "0.25rem", fontWeight: 600 },
  input: {
    width: "100%",
    padding: "0.5rem 0.6rem",
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: 8,
    backgroundColor: colors.inputBg,
    fontSize: "0.88rem",
    fontFamily: "inherit",
    color: colors.textPrimary,
    outline: "none",
  },
  primaryBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.4rem",
    padding: "0.55rem 1rem",
    backgroundColor: colors.blue,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.88rem",
  },
  secondaryBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.35rem",
    padding: "0.55rem 0.9rem",
    backgroundColor: "#fff",
    color: colors.blue,
    border: `1px solid ${colors.blue}`,
    borderRadius: 8,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.85rem",
  },
  secondaryLink: {
    display: "inline-flex", alignItems: "center", gap: "0.3rem",
    padding: "0.45rem 0.7rem",
    backgroundColor: "#fff",
    color: colors.teal,
    border: `1px solid ${colors.teal}`,
    borderRadius: 8,
    fontWeight: 600,
    fontSize: "0.8rem",
    textDecoration: "none",
  },
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
    padding: "0.7rem 1rem",
    background: "#fafbfd",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.8rem",
  },
  th: {
    textAlign: "left",
    padding: "0.45rem 0.5rem",
    backgroundColor: "#f4f7fb",
    color: colors.textPrimary,
    fontWeight: 700,
    fontSize: "0.74rem",
    borderBottom: `2px solid ${colors.cardBorder}`,
    textTransform: "uppercase",
    letterSpacing: "0.02em",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "0.45rem 0.5rem",
    borderBottom: `1px solid ${colors.cardBorder}`,
    color: colors.textPrimary,
    verticalAlign: "top",
  },
};
