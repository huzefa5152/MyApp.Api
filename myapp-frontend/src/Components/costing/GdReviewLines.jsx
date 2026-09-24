import { useMemo } from "react";
import { MdAddCircleOutline, MdBuild, MdErrorOutline, MdRemoveCircleOutline, MdWarningAmber } from "react-icons/md";
import { billColors } from "../bill/billTheme";
import { lineAnchor, lineOutcome, moneyText, qtyText } from "../../utils/gdCostingEntry";

/**
 * "Check the lines": every reviewed line, grouped by GD, each saying what will
 * happen to stock in plain words (utils/gdCostingEntry.lineOutcome), with the
 * three things an operator can do about it -- Fix it, leave it out (or bring it
 * back in), and, where several items share its code, choose which one it is.
 *
 * Cards, not a wide table: a GD runs to 26 lines, and on a phone a table
 * either scrolls sideways or clips the one column that says what happens.
 */

const tone = {
  adds: { accent: billColors.success, tint: billColors.successLight, label: billColors.success },
  new: { accent: billColors.teal, tint: "#effaf8", label: billColors.teal },
  cost: { accent: billColors.blue, tint: billColors.blueSoft, label: billColors.blue },
  choose: { accent: billColors.warn, tint: billColors.warnLight, label: billColors.warn },
  "left-out": { accent: billColors.muted, tint: billColors.mutedLight, label: billColors.textSecondary },
  fix: { accent: billColors.danger, tint: billColors.dangerLight, label: billColors.danger },
};

const wrap2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

const actionBtn = (color, filled = false) => ({
  display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0.45rem 0.85rem",
  borderRadius: 9, border: `1px solid ${color}55`, background: filled ? color : "#fff",
  color: filled ? "#fff" : color, fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "none",
});

function Figure({ label, value }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 11, color: billColors.textSecondary }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

// The server's match note, minus what the outcome line already says: a new
// item's "no opening balance was found", an ambiguous line's list (the picker
// shows it), and New Arrivals' "adds N to the M already on the books". What is
// left -- how an ambiguous code was settled, a Backfill coverage note -- is new.
function extraNote(line, mode) {
  if (!line.matchNote || line.leaveOut) return null;
  if (line.disposition === "stock-posted" || line.disposition === "ambiguous") return null;
  const rest = mode === "new-arrivals"
    ? line.matchNote.replace(/\s*Adds [^.]*already on the books \(new total [^)]*\)\.\s*/g, " ").trim()
    : line.matchNote.trim();
  return rest || null;
}

function LineCard({ line, mode, busy, onFix, onToggleLeaveOut, onChoose }) {
  const o = lineOutcome(line, mode);
  const note = extraNote(line, mode);
  const t = o.blocking ? tone.fix : tone[o.kind] || tone.cost;
  const problems = line.problems || [];
  const warnings = [line.overwriteWarning, line.costPlausibilityWarning, line.rateWarning].filter(Boolean);
  const selling = line.sheetSellingValue ?? line.sellingValue;

  return (
    <div id={lineAnchor(line.sourceRow)} style={{
      border: `1px solid ${billColors.cardBorder}`, borderLeft: `4px solid ${t.accent}`, borderRadius: 10,
      background: line.leaveOut ? billColors.mutedLight : "#fff", padding: "0.7rem 0.8rem",
      marginBottom: "0.6rem", scrollMarginTop: 12, opacity: line.leaveOut ? 0.85 : 1,
    }}>
      <div style={{
        display: "grid", gap: "0.5rem 0.9rem", alignItems: "start",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: billColors.textSecondary, fontWeight: 700 }}>Row {line.sourceRow}</div>
          <div style={{ ...wrap2, fontWeight: 700, fontSize: 14 }}>{line.description || "(no item name)"}</div>
          <div style={{ fontSize: 12.5, color: billColors.textSecondary, marginTop: 2 }}>
            HS {line.hsCode || "—"} · {qtyText(line.quantity)}{line.unit ? ` ${line.unit}` : " (no unit)"}
            {line.matchedItemUnit && line.unit && line.matchedItemUnit !== line.unit
              ? ` · item kept in ${line.matchedItemUnit}` : ""}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: t.label }}>
            {o.blocking ? `Needs fixing · ${o.title}` : o.title}
          </div>
          <div style={{ fontSize: 12.5, color: billColors.textPrimary, marginTop: 2 }}>{o.detail}</div>
          {note && (
            <div style={{ ...wrap2, fontSize: 11.5, color: billColors.textSecondary, marginTop: 3 }}>{note}</div>
          )}
        </div>

        <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Figure label="Landed cost" value={moneyText(line.cost)} />
          <Figure label="Selling value" value={moneyText(selling)} />
        </div>
      </div>

      {problems.length > 0 && (
        <ul style={{ margin: "0.55rem 0 0", padding: 0, listStyle: "none" }}>
          {problems.map((p, i) => (
            <li key={i} style={{
              display: "flex", gap: 5, alignItems: "flex-start", fontSize: 12.5, fontWeight: 600,
              color: line.leaveOut ? billColors.textSecondary : billColors.danger, marginTop: 2,
            }}>
              <MdErrorOutline size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {p.message}
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && !line.leaveOut && (
        <ul style={{ margin: "0.4rem 0 0", padding: 0, listStyle: "none" }}>
          {warnings.map((w, i) => (
            <li key={i} style={{ display: "flex", gap: 5, alignItems: "flex-start", fontSize: 12, color: "#8a4b00", marginTop: 2 }}>
              <MdWarningAmber size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {w}
            </li>
          ))}
        </ul>
      )}

      {(line.candidates || []).length > 1 && !line.leaveOut && (
        <div style={{ marginTop: "0.6rem" }}>
          <label htmlFor={`choose-${line.sourceRow}`} style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: billColors.warn, marginBottom: 4 }}>
            Which item are these goods?
          </label>
          <select id={`choose-${line.sourceRow}`} disabled={busy}
            value={line.chosenOpeningStockBalanceId ?? (line.disposition === "cost-only" ? line.openingStockBalanceId ?? "" : "")}
            onChange={(e) => onChoose(line, e.target.value ? Number(e.target.value) : null)}
            style={{
              width: "100%", maxWidth: 420, minHeight: 44, padding: "0.45rem 0.6rem", borderRadius: 8,
              border: `1px solid ${billColors.inputBorder}`, background: billColors.inputBg, fontSize: 13.5,
            }}>
            <option value="">Choose the item…</option>
            {line.candidates.map((c) => (
              <option key={c.openingStockBalanceId} value={c.openingStockBalanceId}>
                {c.itemTypeName} — {qtyText(c.quantity)}{c.unit ? ` ${c.unit}` : ""} on the books
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "0.6rem" }}>
        <button type="button" onClick={() => onFix(line)} disabled={busy} style={actionBtn(billColors.blue, o.blocking)}>
          <MdBuild size={16} /> {o.blocking ? "Fix this line" : "Edit"}
        </button>
        {line.leaveOut ? (
          <button type="button" onClick={() => onToggleLeaveOut(line, false)} disabled={busy} style={actionBtn(billColors.success)}>
            <MdAddCircleOutline size={17} /> Bring it in
          </button>
        ) : (
          <button type="button" onClick={() => onToggleLeaveOut(line, true)} disabled={busy} style={actionBtn(billColors.textSecondary)}>
            <MdRemoveCircleOutline size={17} /> Leave out
          </button>
        )}
      </div>
    </div>
  );
}

export default function GdReviewLines({ preview, mode, busy, onFix, onToggleLeaveOut, onChoose }) {
  const groups = useMemo(() => {
    const byGd = new Map();
    for (const l of preview?.lines || []) {
      const key = (l.gdNumber || "").trim().toUpperCase();
      if (!byGd.has(key)) byGd.set(key, []);
      byGd.get(key).push(l);
    }
    const totals = new Map((preview?.consignments || []).map((c) => [(c.gdNumber || "").trim().toUpperCase(), c]));
    return [...byGd.entries()].map(([key, lines]) => ({ key, lines, totals: totals.get(key) }));
  }, [preview]);

  return groups.map((g) => (
    <section key={g.key || "no-gd"} style={{
      border: `1px solid ${billColors.cardBorder}`, borderRadius: 12, padding: "0.8rem 0.85rem",
      marginBottom: "0.9rem", background: "#fcfdff",
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: "0.6rem" }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>GD {g.lines[0]?.gdNumber || "(no number)"}</h3>
        <span style={{ fontSize: 12.5, color: billColors.textSecondary }}>
          {g.totals?.gdDate ? new Date(g.totals.gdDate).toLocaleDateString() : "no GD date"}
          {" · "}{g.lines.length} line{g.lines.length === 1 ? "" : "s"}
          {g.totals ? ` · landed cost ${moneyText(g.totals.totalCostExcludingTax)} · input tax ${moneyText(g.totals.totalInputTax)}` : ""}
        </span>
      </div>
      {g.lines.map((l) => (
        <LineCard key={l.sourceRow} line={l} mode={mode} busy={busy}
          onFix={onFix} onToggleLeaveOut={onToggleLeaveOut} onChoose={onChoose} />
      ))}
    </section>
  ));
}
