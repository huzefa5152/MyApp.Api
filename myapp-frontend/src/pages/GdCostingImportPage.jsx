import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  MdCloudUpload, MdCheckCircle, MdWarning, MdError, MdRestartAlt, MdMenuBook,
} from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import { useCompany } from "../contexts/CompanyContext";
import { notify } from "../utils/notify";
import { colors } from "../theme";
import { previewGdCosting, commitGdCosting, getImportProfiles } from "../api/spreadsheetImportApi";

/**
 * Purchases → Import Costing.
 *
 * Loads the ACTUAL LANDED COST of stock already on the books from a customs
 * GD (Goods Declaration) costing workbook. Stock already carries a selling
 * value; this screen supplies the cost side, so margin becomes answerable.
 *
 * Three steps: choose company + file, preview, commit. There is exactly one
 * built-in workbook layout (see GdCostingImportService / GdCostingMapping),
 * so unlike the general Spreadsheet Import screen there is no separate
 * mapping step — the installation's default "GdCosting" import profile is
 * resolved quietly in the background and used for every preview.
 *
 * The preview table is the whole value of this screen: nothing is written
 * until the operator has seen, per line, what would happen and pressed
 * Commit. Preview never writes anything; commit takes the reviewed lines
 * back and never re-reads the file, exactly like the opening-stock and
 * customer-ledger importers.
 */

const DISPOSITION_LABEL = {
  "cost-only": "Cost set",
  "stock-posted": "Not matched",
  "ambiguous": "Ambiguous",
};
const DISPOSITION_TONE = {
  "cost-only": colors.success,
  "stock-posted": colors.textSecondary,
  "ambiguous": "#b26a00",
};
// Fixed caption for an unmatched line. The server's own note differs by case
// (no HS code vs. no opening balance under this HS code) — this is the one
// thing the operator needs to know either way, and it is not committed
// unless "bring in as new stock" is switched on (see WILL_CREATE_NOTE).
const NOT_MATCHED_NOTE = "Not matched — no stock on the books for this GD and HS code";
// Shown instead of NOT_MATCHED_NOTE once the operator opts in — the server
// re-verifies this independently at commit (a real match, or more than one,
// overrides whatever the preview showed), so this is a preview of INTENT,
// not a guarantee.
const WILL_CREATE_NOTE = "Will be created as new stock — a new item type and opening balance";

const money = (n) =>
  (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n) =>
  (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

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
  padding: "0.55rem 0.6rem", fontSize: 13.5, borderBottom: `1px solid ${colors.cardBorder}`,
  verticalAlign: "top",
};
// User-supplied text (item description, match note) must never use
// nowrap+ellipsis — it visually collapses distinct values that share a
// prefix. Clamp to two lines instead (CLAUDE.md §3).
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

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: colors.textSecondary }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

// Commit takes the reviewed lines back, never re-reads the file — echo every
// field the server's GdCostingLineDto carries, exactly as preview sent it.
const toCommitLine = (l) => ({
  sourceRow: l.sourceRow,
  gdNumber: l.gdNumber,
  gdDate: l.gdDate,
  description: l.description,
  hsCode: l.hsCode,
  quantity: l.quantity,
  unit: l.unit,
  assessedValue: l.assessedValue,
  customsDuty: l.customsDuty,
  acd: l.acd,
  regulatoryDuty: l.regulatoryDuty,
  others: l.others,
  salesTaxRate: l.salesTaxRate,
  astRate: l.astRate,
  incomeTaxRate: l.incomeTaxRate,
  addOnProfit: l.addOnProfit,
  cost: l.cost,
  salesTax: l.salesTax,
  ast: l.ast,
  subtotal: l.subtotal,
  incomeTax: l.incomeTax,
  inputTax: l.inputTax,
  sellingValue: l.sellingValue,
  sheetSellingValue: l.sheetSellingValue,
  disposition: l.disposition,
  openingStockBalanceId: l.openingStockBalanceId,
  itemTypeId: l.itemTypeId,
  itemTypeName: l.itemTypeName,
  matchedBalanceQuantity: l.matchedBalanceQuantity,
  derivedActualCost: l.derivedActualCost,
  matchNote: l.matchNote,
});

export default function GdCostingImportPage() {
  const { has } = usePermissions();
  const { companies, selectedCompany } = useCompany();

  const [companyId, setCompanyId] = useState(selectedCompany?.id || "");
  const [file, setFile] = useState(null);

  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);

  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  // Opt-in, default off (unticked): a line matching nothing on the books is
  // skipped unless the operator explicitly asks for it to become new stock.
  const [createMissingStock, setCreateMissingStock] = useState(false);

  const canView = has("importcosting.sheet.run");

  useEffect(() => { if (selectedCompany?.id && !companyId) setCompanyId(selectedCompany.id); },
    [selectedCompany, companyId]);

  const resetFlow = useCallback(() => {
    setFile(null); setPreview(null); setResult(null); setCreateMissingStock(false);
  }, []);

  useEffect(() => { resetFlow(); }, [companyId, resetFlow]);

  // The one built-in layout, resolved quietly — there is nothing for the
  // operator to choose (see file header comment).
  const loadProfile = useCallback(async () => {
    if (!companyId) { setProfile(null); setProfileError(""); return; }
    setProfileLoading(true);
    setProfile(null); setProfileError("");
    try {
      const { data } = await getImportProfiles({ kind: "GdCosting", companyId });
      const list = data || [];
      const chosen = list.find((p) => p.isDefault) || list[0] || null;
      setProfile(chosen);
      if (!chosen) {
        setProfileError(
          "No GD costing layout is set up yet. Ask an administrator to check the import profiles.");
      }
    } catch {
      setProfileError("Could not load the GD costing layout. Reload the page and try again.");
    } finally {
      setProfileLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const onPickFile = (e) => {
    const chosen = e.target.files?.[0] || null;
    setFile(chosen);
    setPreview(null); setResult(null);
  };

  const onPreview = async () => {
    if (!file || !companyId || !profile) return;
    setBusy("preview"); setPreview(null); setResult(null);
    try {
      const { data } = await previewGdCosting({ file, companyId, profileId: profile.id });
      setPreview(data);
    } catch { /* httpClient surfaces it */ } finally { setBusy(""); }
  };

  const onCommit = async () => {
    if (!preview?.canCommit) return;
    setBusy("commit");
    try {
      const { data } = await commitGdCosting({
        companyId: Number(companyId),
        importProfileId: preview.importProfileId,
        profileVersion: preview.profileVersion,
        fileSha256: preview.fileSha256,
        fileName: preview.fileName,
        fileSizeBytes: preview.fileSizeBytes,
        lines: (preview.lines || []).map(toCommitLine),
        createMissingStock,
      });
      setResult(data);
      setPreview(null);
      notify("Imported.", "success");
    } catch { /* surfaced */ } finally { setBusy(""); }
  };

  // Group the reviewed lines by GD, in the same order the server's own
  // per-GD totals came back in (already sorted by GD number).
  const groups = useMemo(() => {
    if (!preview) return [];
    const byGd = new Map();
    for (const l of preview.lines || []) {
      const key = (l.gdNumber || "").trim().toUpperCase();
      if (!byGd.has(key)) byGd.set(key, []);
      byGd.get(key).push(l);
    }
    return (preview.consignments || []).map((c) => ({
      totals: c,
      lines: byGd.get((c.gdNumber || "").trim().toUpperCase()) || [],
    }));
  }, [preview]);

  const counts = preview?.dispositionCounts || {};
  const costOnlyCount = counts["cost-only"] || 0;
  const notMatchedCount = counts["stock-posted"] || 0;
  const ambiguousCount = counts["ambiguous"] || 0;

  if (!canView) {
    return <div style={{ padding: "1.5rem" }}>
      <Banner tone="warn" icon={MdWarning}>You do not have permission to run a GD costing import.</Banner>
    </div>;
  }

  return (
    <div style={{ padding: "1.25rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 0.25rem", color: colors.textPrimary }}>Import Costing</h1>
      <p style={{ margin: "0 0 0.4rem", color: colors.textSecondary, fontSize: 14, maxWidth: "62ch" }}>
        Load the actual landed cost of stock already on the books from a customs GD costing
        workbook, so margin becomes answerable. Nothing is written until you press Commit.
      </p>
      <Link to="/guides/import" style={{
        display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600,
        color: colors.blue, textDecoration: "none", marginBottom: "1rem", minHeight: 44,
      }}>
        <MdMenuBook size={16} aria-hidden="true" /> How to use this
      </Link>

      {/* ── Step 1: company + file ─────────────────────────────────── */}
      <div style={card}>
        <h2 style={{ fontSize: 15, margin: "0 0 0.6rem" }}>1 · Company and workbook</h2>
        <div style={grid}>
          <label style={{ fontSize: 13, color: colors.textSecondary }}>
            Company
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={input}>
              <option value="">Choose a company…</option>
              {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 13, color: colors.textSecondary }}>
            GD costing workbook
            <input type="file" accept=".xls,.xlsx,.xlsm" onChange={onPickFile}
              disabled={!companyId || !!busy} style={{ ...input, padding: "0.5rem" }} />
          </label>
        </div>
        <p style={{ margin: "0.5rem 0 0", fontSize: 12.5, color: colors.textSecondary }}>
          Excel only (.xls, .xlsx, .xlsm). Close the file in Excel first.
        </p>

        {profileError && <div style={{ marginTop: "0.6rem" }}><Banner tone="error" icon={MdError}>{profileError}</Banner></div>}
        {profile && (
          <p style={{ margin: "0.6rem 0 0", fontSize: 12.5, color: colors.textSecondary }}>
            Layout: <strong>{profile.name}</strong> (v{profile.currentVersion})
          </p>
        )}

        <div style={{ marginTop: "0.9rem" }}>
          <button onClick={onPreview} disabled={!file || !companyId || !profile || profileLoading || !!busy}
            style={btn(colors.blue, !file || !companyId || !profile || profileLoading || !!busy)}>
            <MdCloudUpload size={18} />
            {busy === "preview" ? "Reading…" : "Preview"}
          </button>
        </div>
      </div>

      {/* ── Step 2: review ─────────────────────────────────────────── */}
      {preview && (
        <div style={card}>
          <h2 style={{ fontSize: 15, margin: "0 0 0.6rem" }}>2 · Review</h2>

          {preview.blockingErrors?.map((e, i) => <Banner key={i} tone="error" icon={MdError}>{e}</Banner>)}

          <p style={{ fontSize: 15, fontWeight: 600, margin: "0 0 0.7rem" }}>
            {costOnlyCount} will have their cost set ·{" "}
            {createMissingStock
              ? `${notMatchedCount} will be created as new stock`
              : `${notMatchedCount} not matched`}{" "}
            · {ambiguousCount} ambiguous
          </p>

          {notMatchedCount > 0 && (
            <label style={{
              display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5,
              margin: "0 0 0.8rem", padding: "0.65rem 0.75rem", borderRadius: 9,
              background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
              minHeight: 44, boxSizing: "border-box", cursor: "pointer",
            }}>
              <input type="checkbox" checked={createMissingStock}
                onChange={(e) => setCreateMissingStock(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }} />
              <span>
                Also bring the {notMatchedCount} unmatched line(s) in as new stock
                (creates item types and opening balances) instead of skipping them.
                The server re-checks each one before creating anything.
              </span>
            </label>
          )}

          {preview.warnings?.length > 0 && (
            <div style={{ marginBottom: "0.8rem" }}>
              {preview.warnings.map((w, i) => <Banner key={i} tone="warn" icon={MdWarning}>{w}</Banner>)}
            </div>
          )}

          {groups.map((g) => (
            <div key={g.totals.gdNumber} style={{
              border: `1px solid ${colors.cardBorder}`, borderRadius: 10,
              padding: "0.8rem 0.9rem", marginBottom: "0.9rem",
            }}>
              <div style={{
                display: "flex", flexWrap: "wrap", justifyContent: "space-between",
                alignItems: "baseline", gap: 8, marginBottom: "0.6rem",
              }}>
                <h3 style={{ margin: 0, fontSize: 14.5 }}>GD {g.totals.gdNumber}</h3>
                <span style={{ fontSize: 12, color: colors.textSecondary }}>
                  {g.totals.gdDate ? new Date(g.totals.gdDate).toLocaleDateString() : "no date on the sheet"}
                  {" · "}{g.totals.lineCount} line(s)
                </span>
              </div>

              <div style={{ ...grid, marginBottom: "0.7rem" }}>
                <Stat label="Cost" value={money(g.totals.totalCostExcludingTax)} />
                <Stat label="Sales tax" value={money(g.totals.totalSalesTax)} />
                <Stat label="AST" value={money(g.totals.totalAst)} />
                <Stat label="Income tax" value={money(g.totals.totalIncomeTax)} />
                <Stat label="Input tax" value={money(g.totals.totalInputTax)} />
                <Stat label="Selling value" value={money(g.totals.totalSellingValue)} />
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th style={th}>GD</th>
                      <th style={th}>HS code</th>
                      <th style={th}>Description</th>
                      <th style={{ ...th, textAlign: "right" }}>Quantity</th>
                      <th style={{ ...th, textAlign: "right" }}>Cost</th>
                      <th style={{ ...th, textAlign: "right" }}>Selling value</th>
                      <th style={th}>Disposition</th>
                      <th style={th}>Match note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l) => {
                      const notMatched = l.disposition === "stock-posted";
                      const willCreate = notMatched && createMissingStock;
                      return (
                        <tr key={l.sourceRow} style={{ opacity: notMatched && !willCreate ? 0.6 : 1 }}>
                          <td style={td}>
                            <div>{l.gdNumber}</div>
                            <div style={{ fontSize: 11.5, color: colors.textSecondary }}>
                              {l.gdDate ? new Date(l.gdDate).toLocaleDateString() : "—"}
                            </div>
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{l.hsCode || "—"}</td>
                          <td style={td}><div style={wrap2}>{l.description || "—"}</div></td>
                          <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            {qty(l.quantity)}{l.unit ? ` ${l.unit}` : ""}
                          </td>
                          <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(l.cost)}</td>
                          <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(l.sellingValue)}</td>
                          <td style={td}>
                            <span style={{
                              color: willCreate ? colors.success : (DISPOSITION_TONE[l.disposition] || colors.textSecondary),
                              fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.02em",
                            }}>
                              {willCreate ? "Will create" : (DISPOSITION_LABEL[l.disposition] || l.disposition)}
                            </span>
                          </td>
                          <td style={td}>
                            <div style={wrap2}>
                              {willCreate ? WILL_CREATE_NOTE : (notMatched ? NOT_MATCHED_NOTE : (l.matchNote || "—"))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <button onClick={onCommit} disabled={!preview.canCommit || !!busy}
            style={{ ...btn(colors.success, !preview.canCommit || !!busy), marginTop: "0.4rem" }}>
            {busy === "commit"
              ? "Importing…"
              : `Commit ${costOnlyCount + (createMissingStock ? notMatchedCount : 0)} line(s)`}
          </button>
          {!preview.canCommit && (preview.blockingErrors?.length ?? 0) === 0 && (
            <p style={{ fontSize: 13, color: "#b26a00", margin: "0.5rem 0 0" }}>
              Nothing here can be committed.
            </p>
          )}
        </div>
      )}

      {/* ── Done ───────────────────────────────────────────────────── */}
      {result && (
        <div style={card}>
          <Banner tone="ok" icon={MdCheckCircle}>Imported.</Banner>
          <div style={grid}>
            <Stat label="Consignments written" value={result.consignmentsWritten} />
            <Stat label="Lines written" value={result.linesWritten} />
            <Stat label="Balances costed" value={result.balancesCosted} />
            <Stat label="Lines skipped" value={result.linesSkipped} />
            <Stat label="Lines ambiguous" value={result.linesAmbiguous} />
            <Stat label="Total cost" value={money(result.totalCostExcludingTax)} />
            <Stat label="Item types created" value={result.itemTypesCreated} />
            <Stat label="Item types adopted" value={result.itemTypesAdopted} />
            <Stat label="Opening balances created" value={result.openingBalancesCreated} />
          </div>
          {(result.messages || []).map((m, i) =>
            <p key={i} style={{ fontSize: 13.5, margin: "0.6rem 0 0" }}>{m}</p>)}
          <button onClick={resetFlow} style={{ ...btn(colors.teal), marginTop: "0.9rem" }}>
            <MdRestartAlt size={18} /> Import another file
          </button>
        </div>
      )}
    </div>
  );
}
