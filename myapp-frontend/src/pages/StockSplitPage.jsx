import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MdArrowBack, MdCallSplit } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors } from "../theme";
import { getStockOnHand, getSplitLines, splitItem } from "../api/stockApi";

/**
 * Split a merged item (2026-10-03). Some clients' items hold several different
 * products under one HS code. Pick the item, tick the GD lines that are really
 * another product, and move them -- with their quantity, value, landed cost,
 * GD and claim month -- to an existing item or a new one. The server does it
 * in one transaction; past sales stay on the original item.
 */
const money = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

export default function StockSplitPage() {
  const { selectedCompany } = useCompany();
  const confirm = useConfirm();
  const companyId = selectedCompany?.id;
  const [items, setItems] = useState([]);
  const [source, setSource] = useState("");
  const [lines, setLines] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [targetMode, setTargetMode] = useState("new");
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const loadItems = async () => {
    if (!companyId) return;
    try {
      const { data } = await getStockOnHand(companyId);
      setItems((data || []).filter((r) => Number(r.onHand) > 0).sort((a, b) => a.itemTypeName.localeCompare(b.itemTypeName)));
    } catch { setItems([]); }
  };
  useEffect(() => { loadItems(); setSource(""); setLines([]); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  const loadLines = async (id) => {
    setSource(id); setPicked(new Set()); setLines([]);
    if (!id) return;
    setBusy(true);
    try {
      const { data } = await getSplitLines(companyId, id);
      setLines(data || []);
    } catch (e) {
      notify(e?.response?.data?.message || "Could not load the item's GD lines.", "error");
    } finally { setBusy(false); }
  };

  const toggle = (key) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key); else next.add(key);
    setPicked(next);
    // Suggest the moved lines' own product name for a new item.
    if (!newName) {
      const first = lines.find((l) => next.has(l.poolKey));
      if (first?.description) setNewName(first.description);
    }
  };

  const moving = useMemo(() => lines.filter((l) => picked.has(l.poolKey)), [lines, picked]);
  const sourceName = items.find((i) => String(i.itemTypeId) === String(source))?.itemTypeName || "";
  const canMove = moving.length > 0 && moving.length < lines.length
    && (targetMode === "new" ? newName.trim().length > 0 : !!target && String(target) !== String(source));

  const move = async () => {
    const dest = targetMode === "new" ? `a new item "${newName.trim()}"` : `"${items.find((i) => String(i.itemTypeId) === String(target))?.itemTypeName}"`;
    const ok = await confirm({
      title: "Move these GD lines?",
      message: `${moving.length} GD line(s) — ${qty(moving.reduce((s, l) => s + l.quantity, 0))} units worth `
        + `${money(moving.reduce((s, l) => s + l.valueExcludingTax, 0))} — move from "${sourceName}" to ${dest}. `
        + "Their GD, date and claim month go with them; past sales stay on the original item.",
      confirmText: "Move",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await splitItem(companyId, {
        sourceItemTypeId: Number(source), poolKeys: moving.map((l) => l.poolKey),
        ...(targetMode === "new" ? { newItemName: newName.trim() } : { targetItemTypeId: Number(target) }),
      });
      notify(`${data.linesMoved} GD line(s) moved to ${data.targetItemTypeName}.`, "success");
      setNewName(""); setTarget("");
      await loadItems();
      await loadLines(source);
    } catch (e) {
      notify(e?.response?.data?.message || "The lines were not moved.", "error");
    } finally { setBusy(false); }
  };

  return (
    <div style={st.page}>
      <Link to="/stock" style={st.back}><MdArrowBack style={{ flexShrink: 0 }} size={16} /> Stock Dashboard</Link>
      <h1 style={st.h1}>Split an item by GD line</h1>
      <p style={st.muted}>
        When one item holds several different products, move the GD lines that are really another product to their own item.
        Quantity, value, landed cost, GD and claim month move with them.
      </p>

      <label style={st.field}>
        <span style={st.label}>Item to split</span>
        <select value={source} onChange={(e) => loadLines(e.target.value)} style={st.select} disabled={busy}>
          <option value="">Choose an item holding stock…</option>
          {items.map((i) => <option key={i.itemTypeId} value={i.itemTypeId}>{i.itemTypeName} — {qty(i.onHand)} held</option>)}
        </select>
      </label>

      {source && lines.length > 0 && (
        <section style={st.card}>
          <h2 style={st.h2}>GD lines ({lines.length}) — tick the ones to move</h2>
          {lines.map((l) => (
            <label key={l.poolKey} style={st.line}>
              <input type="checkbox" checked={picked.has(l.poolKey)} onChange={() => toggle(l.poolKey)} disabled={busy}
                style={{ width: 20, height: 20, flexShrink: 0 }} />
              <span style={{ minWidth: 0 }}>
                <strong>{l.gdNumber || "Opening (no GD)"}</strong>
                {l.description ? <> · <span style={st.desc}>{l.description}</span></> : null}
                <div style={st.muted}>
                  {l.hsCode || "no HS"} · {qty(l.quantity)} units · {money(l.valueExcludingTax)}
                  {l.claimMonth ? ` · claimed ${new Date(l.claimMonth).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : ""}
                </div>
              </span>
            </label>
          ))}
        </section>
      )}
      {source && !busy && lines.length === 0 && <p style={st.muted}>This item holds no GD lines to split.</p>}

      {moving.length > 0 && (
        <section style={st.card}>
          <h2 style={st.h2}>Move them to</h2>
          <div style={st.choices}>
            <label style={st.radio}><input type="radio" checked={targetMode === "new"} onChange={() => setTargetMode("new")} /> A new item</label>
            <label style={st.radio}><input type="radio" checked={targetMode === "existing"} onChange={() => setTargetMode("existing")} /> An existing item</label>
          </div>
          {targetMode === "new" ? (
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New item name" style={st.input} disabled={busy} />
          ) : (
            <select value={target} onChange={(e) => setTarget(e.target.value)} style={st.select} disabled={busy}>
              <option value="">Choose the item…</option>
              {items.filter((i) => String(i.itemTypeId) !== String(source)).map((i) => (
                <option key={i.itemTypeId} value={i.itemTypeId}>{i.itemTypeName}</option>
              ))}
            </select>
          )}
          {moving.length === lines.length && <p style={st.err}>Leave at least one line on the item — to move everything, rename the item instead.</p>}
          <button type="button" onClick={move} disabled={busy || !canMove} style={st.primary}>
            <MdCallSplit style={{ flexShrink: 0 }} size={18} /> Move {moving.length} line(s)
          </button>
        </section>
      )}
    </div>
  );
}

const st = {
  page: { padding: "1rem", maxWidth: 900, margin: "0 auto" },
  back: { display: "inline-flex", alignItems: "center", gap: 4, color: colors.blue, fontSize: 13, textDecoration: "none", minHeight: 44 },
  h1: { margin: "0.25rem 0 0.4rem", fontSize: "1.35rem", color: colors.textPrimary },
  h2: { margin: "0 0 0.6rem", fontSize: "1rem" },
  muted: { color: "#5f6d7e", fontSize: 13, margin: "0.15rem 0" },
  field: { display: "flex", flexDirection: "column", gap: 4, margin: "0.75rem 0" },
  label: { fontSize: 12, fontWeight: 700, color: "#5f6d7e" },
  select: { width: "100%", maxWidth: 560, minHeight: 44, padding: "0.4rem 0.6rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: 14 },
  input: { width: "100%", maxWidth: 560, minHeight: 44, padding: "0.4rem 0.6rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box" },
  card: { background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.85rem", margin: "0.75rem 0" },
  line: { display: "flex", gap: 10, alignItems: "flex-start", padding: "0.55rem 0", borderTop: `1px solid ${colors.cardBorder}`, cursor: "pointer", minHeight: 44 },
  desc: { overflowWrap: "anywhere" },
  choices: { display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "0.6rem" },
  radio: { display: "flex", alignItems: "center", gap: 6, minHeight: 44, cursor: "pointer" },
  err: { color: "#b71c1c", fontSize: 13 },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, marginTop: "0.75rem", padding: "0.5rem 1.1rem",
    borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer" },
};
