import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  MdCloudUpload, MdCheckCircle, MdWarning, MdError, MdRestartAlt, MdMenuBook, MdEdit, MdAdd,
} from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import { useCompany } from "../contexts/CompanyContext";
import { notify } from "../utils/notify";
import { colors } from "../theme";
import {
  previewGdCosting, previewGdCostingManual, commitGdCosting, getImportProfiles,
} from "../api/spreadsheetImportApi";
import HsCodeAutocomplete from "../Components/HsCodeAutocomplete";

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

// Task 19: what a MATCHED (cost-only) line does to the balance it matches.
// "backfill" (default) is this feature's original, one-time-history
// behaviour: SET the cost, leave quantity alone. "new-arrivals" is for the
// sheet's actual monthly use: ADD quantity, cost and selling value, so a
// month's new goods are never silently dropped by overwriting last month's
// cost onto an unchanged quantity. Neither can happen by accident — the
// operator always chooses, and the screen states the consequence (server-
// derived, in MatchNote) before Commit is ever pressed.
const MODE_BACKFILL = "backfill";
const MODE_NEW_ARRIVALS = "new-arrivals";
const MODE_CHOICES = [
  {
    value: MODE_BACKFILL,
    title: "These goods are already on the books — set their actual cost",
    body: "Use this for a one-off backfill of history. A matched line's cost is SET; quantity is left untouched.",
  },
  {
    value: MODE_NEW_ARRIVALS,
    title: "These are new arrivals — add their quantity and cost to what is on the books",
    body: "Use this for a monthly GD. A matched line's quantity, cost and selling value are ADDED to what the balance already holds.",
  },
];
// "cost-only" reads differently depending on the chosen mode; every other
// disposition's label is unaffected by it.
const dispositionLabel = (disposition, newArrivals) =>
  disposition === "cost-only" && newArrivals ? "Stock added" : (DISPOSITION_LABEL[disposition] || disposition);
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

// ── "Enter a line by hand" (Task 18) ────────────────────────────────────────
// The form itself never decides anything: submitting it calls
// previewGdCostingManual, which builds ONE consignment line SERVER-SIDE and
// runs it through the exact same match/cost pipeline the file preview uses,
// returning the same GdCostingPreviewDto shape — same table, same
// disposition, same Commit button below. The 18/3/6 defaults are the rates
// every real GD costing sheet seen so far actually uses (Helpers/
// ImportCostingCalculator.cs), not a guess.
const DEFAULT_MANUAL = {
  gdNumber: "", gdDate: "", description: "", hsCode: "", quantity: "", unit: "",
  assessedValue: "0", customsDuty: "0", acd: "0", regulatoryDuty: "0", others: "0",
  salesTaxRate: "18", astRate: "3", incomeTaxRate: "6", addOnProfit: "0", sellingValue: "",
};

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Client-side mirror of Helpers/ImportCostingCalculator.cs's formula, for
 * INSTANT feedback only as the operator types — so the arithmetic is visible
 * before spending a round trip on it. NOT authoritative: previewGdCostingManual
 * recomputes this exact same formula on the server (the ONE place it is
 * computed for real — see that file's own doc comment), and the server's
 * figures are what land in the preview table and what commit writes. This
 * duplication is deliberately narrow (one pure function, no matching, no
 * persistence) and never substitutes for the server round trip.
 */
function computeManualCosting(m) {
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const cost = round2(n(m.assessedValue) + n(m.customsDuty) + n(m.acd) + n(m.regulatoryDuty));
  const st = Math.max(0, n(m.salesTaxRate));
  const ast = Math.max(0, n(m.astRate));
  const it = Math.max(0, n(m.incomeTaxRate));
  const salesTax = round2(cost * st / 100);
  const astAmount = round2(cost * ast / 100);
  const subtotal = round2(cost + salesTax + astAmount + n(m.others));
  const incomeTax = round2(subtotal * it / 100);
  const inputTax = round2(salesTax + astAmount);
  const sellingValue = st > 0
    ? round2((inputTax * 100 / st) + round2(n(m.addOnProfit)))
    : round2(cost + round2(n(m.addOnProfit)));
  return { cost, salesTax, ast: astAmount, subtotal, incomeTax, inputTax, sellingValue };
}

// companyId/quantity travel as text through controlled inputs; this turns
// what's on screen into the numbers (and null-when-blank optional selling
// value) the server DTO expects.
const toManualPayload = (m) => {
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  return {
    gdNumber: m.gdNumber.trim(),
    gdDate: m.gdDate || null,
    description: m.description.trim(),
    hsCode: m.hsCode.trim(),
    quantity: n(m.quantity),
    unit: m.unit.trim() || null,
    assessedValue: n(m.assessedValue),
    customsDuty: n(m.customsDuty),
    acd: n(m.acd),
    regulatoryDuty: n(m.regulatoryDuty),
    others: n(m.others),
    salesTaxRate: n(m.salesTaxRate),
    astRate: n(m.astRate),
    incomeTaxRate: n(m.incomeTaxRate),
    addOnProfit: n(m.addOnProfit),
    sellingValue: m.sellingValue === "" || m.sellingValue == null ? null : n(m.sellingValue),
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
  padding: "0.55rem 0.6rem", fontSize: 13.5, borderBottom: `1px solid ${colors.cardBorder}`,
  verticalAlign: "top",
};
// User-supplied text (item description, match note) must never use
// nowrap+ellipsis — it visually collapses distinct values that share a
// prefix. Clamp to two lines instead (CLAUDE.md §3).
const wrap2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

// Segmented "Upload a workbook" / "Enter a line by hand" toggle. >=44px tall
// per the house tap-target rule.
const modeBtn = (active) => ({
  padding: "0.6rem 0.9rem", minHeight: 44, borderRadius: 8,
  border: `1px solid ${active ? colors.blue : colors.cardBorder}`,
  background: active ? colors.blue : "#fff",
  color: active ? "#fff" : colors.textPrimary,
  fontWeight: 600, fontSize: 13.5, cursor: "pointer",
});

/**
 * Task 19: the two-way choice of what a MATCHED line does to the balance it
 * matches — spelled out in full rather than a bare toggle labelled "mode",
 * because the whole point is that the operator always knows which one they
 * are doing. Radio cards, not a checkbox: exactly one of the two is always
 * true, unlike "bring in as new stock" below it (which is a genuine opt-in
 * on top of whichever mode is chosen here). >=44px tall per the house
 * tap-target rule; grid so it collapses to one column on a phone.
 */
function ModeChoice({ mode, onChange, disabled }) {
  return (
    <div style={{ ...grid, margin: "0.5rem 0 0.9rem" }}>
      {MODE_CHOICES.map((opt) => {
        const active = mode === opt.value;
        return (
          <label key={opt.value} style={{
            display: "flex", gap: 10, alignItems: "flex-start",
            padding: "0.65rem 0.75rem", borderRadius: 9, minHeight: 44, boxSizing: "border-box",
            border: `1px solid ${active ? colors.blue : colors.cardBorder}`,
            background: active ? "#eef4ff" : colors.cardBg,
            cursor: disabled ? "not-allowed" : "pointer",
          }}>
            <input type="radio" name="gdCostingImportMode" checked={active} disabled={disabled}
              onChange={() => onChange(opt.value)}
              style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }} />
            <span>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{opt.title}</div>
              <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>{opt.body}</div>
            </span>
          </label>
        );
      })}
    </div>
  );
}

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

function SectionLabel({ children }) {
  return (
    <h4 style={{
      margin: "0.9rem 0 0.5rem", fontSize: 12, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary,
    }}>{children}</h4>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ fontSize: 13, color: colors.textSecondary, display: "block" }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

/**
 * The "enter a line by hand" form — Identity / Cost / Rates / Outcome,
 * reading like the sheet's own columns (see GdCostingSheetReader /
 * GdCostingMapping.GdCostingColumns) so a line typed here and a line read
 * off a workbook are visibly the same shape. Submitting calls onPreview,
 * which hands the typed fields to previewGdCostingManual — the server
 * builds the actual line and runs it through the real pipeline; the live
 * totals below are just this screen's own instant estimate (see
 * computeManualCosting).
 */
function ManualEntryFields({
  companyId, manual, onChange, onPreview, disabled, busy,
  staged, onAddLine, onRemoveLine, onEditLine,
}) {
  const computed = useMemo(() => computeManualCosting(manual), [manual]);
  // A line is complete enough to stage on the same three fields the server
  // validates; everything else legitimately defaults to zero.
  const lineReady = !disabled
    && manual.gdNumber.trim().length > 0
    && manual.description.trim().length > 0
    && Number(manual.quantity) > 0;
  // Preview needs at least one line — staged, or complete in the form (the
  // one-line case must not require pressing Add first).
  const canPreview = !disabled && !busy && (staged.length > 0 || lineReady);

  const set = (key) => (e) => onChange({ [key]: e.target.value });

  return (
    <div>
      <SectionLabel>Identity</SectionLabel>
      <div style={grid}>
        <Field label="GD number">
          <input type="text" style={input} placeholder="e.g. KAPW-HC-8876"
            value={manual.gdNumber} onChange={set("gdNumber")} disabled={disabled} />
        </Field>
        <Field label="GD date">
          <input type="date" style={input}
            value={manual.gdDate} onChange={set("gdDate")} disabled={disabled} />
        </Field>
        <Field label="Description">
          <input type="text" style={input} placeholder="e.g. Screw Driver"
            value={manual.description} onChange={set("description")} disabled={disabled} />
        </Field>
        <Field label="Quantity">
          <input type="number" min="0" step="any" style={input}
            value={manual.quantity} onChange={set("quantity")} disabled={disabled} />
        </Field>
        <Field label="Unit">
          <input type="text" style={input} placeholder="e.g. Pcs"
            value={manual.unit} onChange={set("unit")} disabled={disabled} />
        </Field>
        <Field label="HS code">
          <HsCodeAutocomplete companyId={companyId} value={manual.hsCode} style={input}
            onChange={(v) => onChange({ hsCode: v })}
            placeholder="Type a product keyword, or an HS code…" />
        </Field>
      </div>

      <SectionLabel>Cost</SectionLabel>
      <div style={grid}>
        <Field label="Assessed value">
          <input type="number" min="0" step="any" style={input}
            value={manual.assessedValue} onChange={set("assessedValue")} disabled={disabled} />
        </Field>
        <Field label="Customs duty">
          <input type="number" min="0" step="any" style={input}
            value={manual.customsDuty} onChange={set("customsDuty")} disabled={disabled} />
        </Field>
        <Field label="ACD">
          <input type="number" min="0" step="any" style={input}
            value={manual.acd} onChange={set("acd")} disabled={disabled} />
        </Field>
        <Field label="Regulatory duty">
          <input type="number" min="0" step="any" style={input}
            value={manual.regulatoryDuty} onChange={set("regulatoryDuty")} disabled={disabled} />
        </Field>
        <Field label="Others">
          <input type="number" min="0" step="any" style={input}
            value={manual.others} onChange={set("others")} disabled={disabled} />
        </Field>
      </div>

      <SectionLabel>Rates (%)</SectionLabel>
      <div style={grid}>
        <Field label="Sales tax rate">
          <input type="number" min="0" step="any" style={input}
            value={manual.salesTaxRate} onChange={set("salesTaxRate")} disabled={disabled} />
        </Field>
        <Field label="AST rate">
          <input type="number" min="0" step="any" style={input}
            value={manual.astRate} onChange={set("astRate")} disabled={disabled} />
        </Field>
        <Field label="Income tax rate">
          <input type="number" min="0" step="any" style={input}
            value={manual.incomeTaxRate} onChange={set("incomeTaxRate")} disabled={disabled} />
        </Field>
      </div>

      <SectionLabel>Outcome</SectionLabel>
      <div style={grid}>
        <Field label="Add-on profit">
          <input type="number" min="0" step="any" style={input}
            value={manual.addOnProfit} onChange={set("addOnProfit")} disabled={disabled} />
        </Field>
        <Field label="Stated selling value (optional)">
          <input type="number" min="0" step="any" style={input}
            placeholder="Leave blank to use the computed figure"
            value={manual.sellingValue} onChange={set("sellingValue")} disabled={disabled} />
        </Field>
      </div>

      <div style={{
        ...grid, marginTop: "0.9rem", padding: "0.7rem 0.8rem",
        background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 9,
      }}>
        <Stat label="Cost" value={money(computed.cost)} />
        <Stat label="Sales tax" value={money(computed.salesTax)} />
        <Stat label="AST" value={money(computed.ast)} />
        <Stat label="Subtotal" value={money(computed.subtotal)} />
        <Stat label="Income tax" value={money(computed.incomeTax)} />
        <Stat label="Input tax" value={money(computed.inputTax)} />
        <Stat label="Selling value" value={money(computed.sellingValue)} />
      </div>
      <p style={{ margin: "0.4rem 0 0", fontSize: 12, color: colors.textSecondary }}>
        Computed live from what you've typed. Preview re-verifies it on the server before anything can be committed.
      </p>

      <div style={{ marginTop: "0.9rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <button onClick={onAddLine} disabled={!lineReady} style={btn("#5f6d7e", !lineReady)}>
          <MdAdd size={18} />
          Add line
        </button>
        <button onClick={onPreview} disabled={!canPreview} style={btn(colors.blue, !canPreview)}>
          <MdCloudUpload size={18} />
          {busy ? "Checking…" : staged.length > 0
            ? `Preview ${staged.length + (lineReady ? 1 : 0)} line(s)`
            : "Preview"}
        </button>
      </div>

      {staged.length > 0 && (
        <div style={{ marginTop: "0.9rem" }}>
          <SectionLabel>Lines on this entry ({staged.length})</SectionLabel>
          <p style={{ margin: "0 0 0.5rem", fontSize: 12.5, color: colors.textSecondary }}>
            One GD normally carries several HS codes. Add each line, then preview them
            together — they have to be checked as a set, because two lines landing on the
            same item pool into one unit cost.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th}>GD</th>
                  <th style={th}>HS code</th>
                  <th style={th}>Description</th>
                  <th style={{ ...th, textAlign: "right" }}>Quantity</th>
                  <th style={{ ...th, textAlign: "right" }}>Cost</th>
                  <th style={{ ...th, width: 96 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {staged.map((m, i) => {
                  const c = computeManualCosting(m);
                  return (
                    <tr key={i}>
                      <td style={td}>{m.gdNumber}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{m.hsCode || "—"}</td>
                      <td style={td}><div style={wrap2}>{m.description}</div></td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {qty(Number(m.quantity) || 0)}{m.unit ? ` ${m.unit}` : ""}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {money(c.cost)}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" onClick={() => onEditLine(i)} disabled={disabled}
                            title="Put this line back in the form to change it"
                            style={miniBtn(colors.blue)}>Edit</button>
                          <button type="button" onClick={() => onRemoveLine(i)} disabled={disabled}
                            title="Remove this line" style={miniBtn(colors.danger)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const miniBtn = (tone) => ({
  padding: "0.25rem 0.55rem", borderRadius: 6, border: `1px solid ${tone}40`,
  background: "#fff", color: tone, fontSize: 12, fontWeight: 700,
  cursor: "pointer", boxShadow: "none", minHeight: 30,
});

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

  // "file" (upload a workbook) or "manual" ("enter a line by hand" — Task 18).
  // Mutually exclusive input methods into the SAME preview/review/commit flow
  // below; switching clears whichever preview was showing.
  const [mode, setMode] = useState("file");
  const [manual, setManual] = useState(DEFAULT_MANUAL);
  // Lines already added to this hand-entry session. A real GD carries several
  // HS codes (Alpha's one declaration has 26 lines), and they must be previewed
  // TOGETHER -- see PreviewManualAsync for why a line at a time is wrong.
  const [stagedManual, setStagedManual] = useState([]);

  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);

  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  // Opt-in, default off (unticked): a line matching nothing on the books is
  // skipped unless the operator explicitly asks for it to become new stock.
  const [createMissingStock, setCreateMissingStock] = useState(false);
  // Task 19: what a MATCHED line does — defaults to the SAFER choice
  // (Backfill: SET, touches only cost) rather than New Arrivals (ADD,
  // touches quantity and selling value too).
  const [costingMode, setCostingMode] = useState(MODE_BACKFILL);

  const canView = has("importcosting.sheet.run");

  useEffect(() => { if (selectedCompany?.id && !companyId) setCompanyId(selectedCompany.id); },
    [selectedCompany, companyId]);

  const resetFlow = useCallback(() => {
    setFile(null); setPreview(null); setResult(null); setCreateMissingStock(false);
    setManual(DEFAULT_MANUAL); setCostingMode(MODE_BACKFILL);
  }, []);

  useEffect(() => { resetFlow(); }, [companyId, resetFlow]);

  // Switching input method never mixes a stale preview from the other one
  // into this screen — the mode itself (and any partly-typed manual fields)
  // is left alone, only the preview/result.
  const switchMode = useCallback((next) => {
    setMode(next);
    setPreview(null); setResult(null);
    // Half-built hand entry does not survive a switch to the file path: it
    // would silently ride along into the next preview.
    if (next === "file") setStagedManual([]);
  }, []);

  const updateManual = useCallback((patch) => setManual((m) => ({ ...m, ...patch })), []);

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
      const { data } = await previewGdCosting({ file, companyId, profileId: profile.id, mode: costingMode });
      setPreview(data);
    } catch { /* httpClient surfaces it */ } finally { setBusy(""); }
  };

  // "Enter a line by hand": the server builds ONE consignment line and runs
  // it through the exact same pipeline onPreview's workbook goes through —
  // no profile/mapping involved, since there is nothing to map for a
  // hand-typed line.
  // Every staged line PLUS the one still in the form if it is complete, so a
  // single-line consignment never needs "Add line" pressed first.
  const manualLinesToSend = () => {
    const formReady = manual.gdNumber.trim() && manual.description.trim() && Number(manual.quantity) > 0;
    return [...stagedManual, ...(formReady ? [manual] : [])].map(toManualPayload);
  };

  const onAddManualLine = () => {
    setStagedManual((prev) => [...prev, manual]);
    // Keep the GD header and the rates — a real GD's next line shares both, and
    // retyping them for 26 lines is how a sheet gets typed wrong.
    setManual((m) => ({
      ...DEFAULT_MANUAL,
      gdNumber: m.gdNumber, gdDate: m.gdDate, unit: m.unit,
      salesTaxRate: m.salesTaxRate, astRate: m.astRate, incomeTaxRate: m.incomeTaxRate,
    }));
    setPreview(null);
  };

  const onRemoveManualLine = (i) => {
    setStagedManual((prev) => prev.filter((_, x) => x !== i));
    setPreview(null);
  };

  // Editing pulls the row back into the form. Anything half-typed there is
  // staged first rather than silently discarded.
  const onEditManualLine = (i) => {
    setStagedManual((prev) => {
      const row = prev[i];
      const rest = prev.filter((_, x) => x !== i);
      const formReady = manual.gdNumber.trim() && manual.description.trim() && Number(manual.quantity) > 0;
      setManual(row);
      return formReady ? [...rest, manual] : rest;
    });
    setPreview(null);
  };

  const onPreviewManual = async () => {
    if (!companyId) return;
    const lines = manualLinesToSend();
    if (lines.length === 0) return;
    setBusy("preview"); setPreview(null); setResult(null);
    try {
      const { data } = await previewGdCostingManual({ companyId, lines, mode: costingMode });
      setPreview(data);
    } catch { /* httpClient surfaces it */ } finally { setBusy(""); }
  };

  // Task 19: changing Backfill/New Arrivals after a preview is already on
  // screen re-runs it, so the table and its per-line notes never describe a
  // different mode than the one Commit is about to use.
  useEffect(() => {
    if (!preview || busy) return;
    if (mode === "file") { if (file) onPreview(); }
    else if (companyId) { onPreviewManual(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costingMode]);

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
        mode: costingMode,
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
  const overwriteWarningCount = preview?.overwriteWarningCount || 0;
  const costWarningCount = preview?.costPlausibilityWarningCount || 0;
  const rateWarningCount = preview?.rateWarningCount || 0;

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

      {/* ── Step 1: company + workbook, or a hand-typed line ─────────── */}
      <div style={card}>
        <h2 style={{ fontSize: 15, margin: "0 0 0.6rem" }}>
          1 · Company and {mode === "file" ? "workbook" : "consignment line"}
        </h2>
        <div style={grid}>
          <label style={{ fontSize: 13, color: colors.textSecondary }}>
            Company
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={input}>
              <option value="">Choose a company…</option>
              {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>

        <SectionLabel>What kind of import is this?</SectionLabel>
        <ModeChoice mode={costingMode} onChange={setCostingMode} disabled={!!busy} />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0.9rem 0" }}>
          <button type="button" onClick={() => switchMode("file")}
            style={modeBtn(mode === "file")} disabled={!!busy}>
            <MdCloudUpload size={16} style={{ marginRight: 6, verticalAlign: "-3px" }} />
            Upload a workbook
          </button>
          <button type="button" onClick={() => switchMode("manual")}
            style={modeBtn(mode === "manual")} disabled={!!busy}>
            <MdEdit size={16} style={{ marginRight: 6, verticalAlign: "-3px" }} />
            Enter a line by hand
          </button>
        </div>

        {mode === "file" ? (
          <>
            <div style={grid}>
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
          </>
        ) : (
          <>
            {!companyId && (
              <Banner tone="warn" icon={MdWarning}>Choose a company first.</Banner>
            )}
            <ManualEntryFields
              companyId={companyId}
              manual={manual}
              onChange={updateManual}
              onPreview={onPreviewManual}
              disabled={!companyId || !!busy}
              busy={busy === "preview"}
              staged={stagedManual}
              onAddLine={onAddManualLine}
              onRemoveLine={onRemoveManualLine}
              onEditLine={onEditManualLine}
            />
          </>
        )}
      </div>

      {/* ── Step 2: review ─────────────────────────────────────────── */}
      {preview && (
        <div style={card}>
          <h2 style={{ fontSize: 15, margin: "0 0 0.6rem" }}>2 · Review</h2>

          {preview.blockingErrors?.map((e, i) => <Banner key={i} tone="error" icon={MdError}>{e}</Banner>)}

          <p style={{ fontSize: 15, fontWeight: 600, margin: "0 0 0.7rem" }}>
            {costOnlyCount} {costingMode === MODE_NEW_ARRIVALS
              ? "will have stock added"
              : "will have their cost set"} ·{" "}
            {createMissingStock
              ? `${notMatchedCount} will be created as new stock`
              : `${notMatchedCount} not matched`}{" "}
            · {ambiguousCount} ambiguous
          </p>

          {overwriteWarningCount > 0 && (
            <Banner tone="error" icon={MdWarning}>
              {overwriteWarningCount} line{overwriteWarningCount === 1 ? "" : "s"} will REPLACE an actual
              cost already recorded from an earlier import — see the highlighted row(s) below. Switch to
              "These are new arrivals" instead if these are additional goods, not a correction.
            </Banner>
          )}

          {costWarningCount > 0 && (
            <Banner tone="error" icon={MdWarning}>
              {costWarningCount} line{costWarningCount === 1 ? "" : "s"} would write a cost that does not
              fit the stock it lands on — see the highlighted row(s) below for the figures and why.
              Backfill spreads one GD's unit cost across an item's whole quantity, which goes wrong when
              the item merges several products or the GD covers only part of it. Import anyway if you
              know the figure is right.
            </Banner>
          )}

          {rateWarningCount > 0 && (
            <Banner tone="warn" icon={MdWarning}>
              {rateWarningCount} line{rateWarningCount === 1 ? "" : "s"} carry a rate above 50%, which is
              almost always a cell holding "1" meant as 1% — a bare 1 cannot be told apart from a
              fraction. Cost and selling value are unaffected; income tax is not.
            </Banner>
          )}

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
                        <tr key={l.sourceRow} style={{
                          opacity: notMatched && !willCreate ? 0.6 : 1,
                          background: (l.overwriteWarning || l.costPlausibilityWarning)
                            ? colors.dangerLight : undefined,
                        }}>
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
                              {willCreate ? "Will create" : dispositionLabel(l.disposition, costingMode === MODE_NEW_ARRIVALS)}
                            </span>
                          </td>
                          <td style={td}>
                            <div style={wrap2}>
                              {l.overwriteWarning && (
                                <div style={{ color: colors.danger, fontWeight: 700, marginBottom: 4 }}>
                                  {l.overwriteWarning}
                                </div>
                              )}
                              {l.costPlausibilityWarning && (
                                <div style={{ color: colors.danger, fontWeight: 700, marginBottom: 4 }}>
                                  {l.costPlausibilityWarning}
                                </div>
                              )}
                              {l.rateWarning && (
                                <div style={{ color: "#b26a00", fontWeight: 700, marginBottom: 4 }}>
                                  {l.rateWarning}
                                </div>
                              )}
                              {willCreate
                                ? WILL_CREATE_NOTE
                                : notMatched
                                  ? NOT_MATCHED_NOTE
                                  : l.matchNote
                                    || ((l.overwriteWarning || l.costPlausibilityWarning || l.rateWarning)
                                        ? null : "—")}
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
            <MdRestartAlt size={18} /> {mode === "manual" ? "Enter another line" : "Import another file"}
          </button>
        </div>
      )}
    </div>
  );
}
