import { colors } from "../../theme";
import { useCallback, useEffect, useState } from "react";
import { MdWarning, MdCheckCircle } from "react-icons/md";
import { usePermissions } from "../../contexts/PermissionsContext";
import { getBackdatedGds, restateBackdatedGds } from "../../api/stockApi";
import { notify } from "../../utils/notify";

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

/**
 * "A GD came in dated before your last stock-sheet match" -- or before a
 * value correction made before it was entered. Lists the items
 * whose value is off for that reason and fixes them in one step: Check
 * (preview, writes nothing) then Update. Renders nothing when no item needs it
 * or the user cannot restate stock (stock.policy.manage).
 * Server: GET/POST /api/stock/company/{id}/backdated-gds[/restate].
 */
export default function LateGdMatchPanel({ companyId, refreshKey, onDone }) {
  const { has } = usePermissions();
  const allowed = has("stock.policy.manage");
  const [items, setItems] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!allowed || !companyId) return;
    try {
      const { data } = await getBackdatedGds(companyId);
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    }
  }, [allowed, companyId]);

  useEffect(() => { setPreview(null); setError(""); load(); }, [load, refreshKey]);

  if (!allowed || items.length === 0) return null;

  const run = async (commit) => {
    setBusy(true); setError("");
    try {
      const { data } = await restateBackdatedGds(companyId, commit);
      if (commit && data.committed) {
        notify((data.messages || [])[0] || "Stock-sheet match updated.", "success");
        setPreview(null);
        await load();
        onDone?.();
      } else {
        setPreview(data);
      }
    } catch (e) {
      setError(e?.response?.data?.message || e?.response?.data?.error || "Could not update the stock-sheet match.");
    } finally {
      setBusy(false);
    }
  };

  const errors = (preview?.items || []).filter((i) => i.error);

  return (
    <div style={s.box}>
      <div style={s.head}>
        <MdWarning size={20} style={{ color: colors.warn, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={s.title}>
            {items.length} item{items.length === 1 ? "" : "s"} got goods dated before their last stock-sheet match or value correction
          </div>
          <div style={s.help}>
            The match or correction was made before these units were on the books, so the value of
            these items is off. Quantities are right. Add the GDs to put the value right.
          </div>
        </div>
      </div>

      <ul style={s.list}>
        {items.map((it) => (
          <li key={it.itemTypeId} style={s.row}>
            <span style={s.name}>{it.itemTypeName}</span>
            <span style={s.sub}>
              {it.afterValueCorrection ? "value correction" : "match"} of {day(it.matchedOn)} · {it.lines.map((l) => `${l.gdNumber} (${day(l.gdDate)}, ${Number(l.quantity).toLocaleString()} units)`).join(", ")}
            </span>
          </li>
        ))}
      </ul>

      {preview && (
        <div style={s.preview}>
          {errors.length > 0 ? (
            errors.map((i) => <div key={i.itemTypeId} style={{ color: colors.danger }}>{i.itemTypeName}: {i.error}</div>)
          ) : (
            <>
              Value of these items: <strong>{money(preview.valueBefore)}</strong> now →{" "}
              <strong>{money(preview.valueAfter)}</strong> after the update. Quantities do not change.
            </>
          )}
        </div>
      )}
      {error && <div style={{ ...s.preview, color: colors.danger }}>{error}</div>}

      <div style={s.actions}>
        {!preview ? (
          <button type="button" style={s.btn(colors.blue, false)} disabled={busy} onClick={() => run(false)}>
            {busy ? "Checking…" : "Check what it will change"}
          </button>
        ) : (
          <>
            <button type="button" style={s.btn(colors.teal, true)} disabled={busy || !preview.canCommit} onClick={() => run(true)}>
              <MdCheckCircle size={18} /> {busy ? "Updating…" : "Add these GDs and put the value right"}
            </button>
            <button type="button" style={s.btn(colors.blue, false)} disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

const s = {
  box: { border: `1px solid ${colors.warn}55`, background: colors.cautionSoft, borderRadius: 12, padding: "0.8rem 0.9rem", margin: "0 0 1rem" },
  head: { display: "flex", gap: 10, alignItems: "flex-start" },
  title: { fontWeight: 800, fontSize: 14.5, color: colors.textPrimary },
  help: { fontSize: 13, color: colors.textSecondary, marginTop: 2, lineHeight: 1.45 },
  list: { listStyle: "none", margin: "0.6rem 0 0", padding: 0, display: "grid", gap: 6 },
  row: { background: "#fff", borderRadius: 8, padding: "0.45rem 0.6rem", border: `1px solid ${colors.cardBorder}` },
  name: { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontWeight: 700, fontSize: 13.5 },
  sub: { display: "block", fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  preview: { marginTop: "0.6rem", fontSize: 13.5, lineHeight: 1.5 },
  actions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: "0.7rem" },
  btn: (color, solid) => ({
    display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0.45rem 0.95rem",
    borderRadius: 8, border: `1px solid ${color}`, background: solid ? color : "#fff",
    color: solid ? "#fff" : color, fontWeight: 700, fontSize: 13.5, cursor: "pointer",
  }),
};
