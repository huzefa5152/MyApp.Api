import { useEffect, useState } from "react";
import { MdAdd, MdDelete, MdLink } from "react-icons/md";
import { useConfirm } from "../ConfirmDialog";
import { notify } from "../../utils/notify";
import { colors } from "../../theme";
import {
  getConsignmentCharges, addConsignmentCharge, deleteConsignmentCharge, getImportLcs, linkConsignmentLc,
} from "../../api/importConsignmentApi";

/**
 * Under an expanded GD on the Consignments screen (2026-10-05):
 *   - the GD's own charges (freight, clearing agent, wharfage, demurrage, port),
 *     spread by assessed value into the lines' landed cost;
 *   - the LC the goods shipped against, and the bill of lading.
 * The server decides every figure; this only collects the input.
 */
const KINDS = [
  ["freight", "Freight"], ["clearing", "Clearing agent"], ["wharfage", "Wharfage"],
  ["demurrage", "Demurrage / detention"], ["port", "Port / terminal"], ["other", "Other"],
];
const money = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kindLabel = (k) => (KINDS.find(([x]) => x === k) || [k, k])[1];

export default function ConsignmentExtras({ detail, canManageCharges, canManageLc, canSeeLc, onChanged }) {
  const confirm = useConfirm();
  const arrivals = (detail?.mode || "").toLowerCase() === "new-arrivals";
  const [charges, setCharges] = useState([]);
  const [draft, setDraft] = useState({ kind: "freight", amount: "", paidTo: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [lcs, setLcs] = useState([]);
  const [link, setLink] = useState({ lcId: "", blNumber: "" });

  useEffect(() => {
    if (!detail?.id) return;
    getConsignmentCharges(detail.id).then(({ data }) => setCharges(data || [])).catch(() => setCharges([]));
    setLink({ lcId: detail.importLcId ? String(detail.importLcId) : "", blNumber: detail.blNumber || "" });
    if (canSeeLc) getImportLcs(detail.companyId).then(({ data }) => setLcs(data || [])).catch(() => setLcs([]));
  }, [detail, canSeeLc]);

  const add = async () => {
    const amount = Number(draft.amount);
    if (!(amount > 0)) { notify("Enter the charge's amount.", "error"); return; }
    setBusy(true);
    try {
      const { data } = await addConsignmentCharge(detail.id, { ...draft, amount });
      setCharges(data.charges || []);
      setDraft({ kind: draft.kind, amount: "", paidTo: "", description: "" });
      notify(`Charge added. Landed cost incl. charges: ${money(data.landedCostWithCharges)}.`, "success");
      onChanged?.();
    } catch (e) { notify(e?.response?.data?.message || "The charge was not added.", "error"); }
    finally { setBusy(false); }
  };

  const remove = async (c) => {
    if (!(await confirm({ title: "Remove this charge?", message: `${kindLabel(c.kind)} ${money(c.amount)} comes off GD ${detail.gdNumber}'s landed cost.`, confirmText: "Remove", variant: "danger" }))) return;
    setBusy(true);
    try {
      const { data } = await deleteConsignmentCharge(detail.id, c.id);
      setCharges(data.charges || []);
      onChanged?.();
    } catch (e) { notify(e?.response?.data?.message || "The charge was not removed.", "error"); }
    finally { setBusy(false); }
  };

  const saveLink = async () => {
    setBusy(true);
    try {
      await linkConsignmentLc(detail.id, { lcId: link.lcId ? Number(link.lcId) : null, blNumber: link.blNumber });
      notify("Saved.", "success");
      onChanged?.();
    } catch (e) { notify(e?.response?.data?.message || "Not saved.", "error"); }
    finally { setBusy(false); }
  };

  if (!detail) return null;
  const total = charges.reduce((a, c) => a + Number(c.amount || 0), 0);

  return (
    <div style={st.wrap}>
      <section style={st.card}>
        <h4 style={st.h4}>GD charges <span style={st.muted}>— spread by assessed value into landed cost</span></h4>
        {!arrivals ? <p style={st.muted}>Charges can be added to a GD brought in as new goods.</p> : (
          <>
            {charges.length === 0 ? <p style={st.muted}>No charges yet: freight, the clearing agent's bill, wharfage or demurrage go here.</p> : (
              <ul style={st.list}>
                {charges.map((c) => (
                  <li key={c.id} style={st.item}>
                    <span style={{ minWidth: 0 }}>
                      <strong>{kindLabel(c.kind)}</strong> {c.paidTo ? `· ${c.paidTo}` : ""} {c.description ? `· ${c.description}` : ""}
                    </span>
                    <span style={st.amount}>{money(c.amount)}</span>
                    {canManageCharges && (
                      <button type="button" onClick={() => remove(c)} disabled={busy} aria-label="Remove charge" title="Remove charge" style={st.iconBtn}>
                        <MdDelete size={18} />
                      </button>
                    )}
                  </li>
                ))}
                <li style={{ ...st.item, fontWeight: 700 }}><span>Total charges</span><span style={st.amount}>{money(total)}</span><span style={{ width: 44 }} /></li>
              </ul>
            )}
            {canManageCharges && (
              <div style={st.form}>
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} style={st.input} disabled={busy}>
                  {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input type="number" min="0" step="0.01" placeholder="Amount" value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })} style={st.input} disabled={busy} />
                <input placeholder="Paid to (agent, shipping line)" value={draft.paidTo}
                  onChange={(e) => setDraft({ ...draft, paidTo: e.target.value })} style={st.input} disabled={busy} />
                <button type="button" onClick={add} disabled={busy} style={st.primary}>
                  <MdAdd size={18} style={{ flexShrink: 0 }} /> Add charge
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {canSeeLc && (
        <section style={st.card}>
          <h4 style={st.h4}>Letter of credit &amp; bill of lading</h4>
          <div style={st.form}>
            <select value={link.lcId} onChange={(e) => setLink({ ...link, lcId: e.target.value })} style={st.input} disabled={busy || !canManageLc}>
              <option value="">No LC</option>
              {lcs.map((l) => <option key={l.id} value={l.id}>{l.lcNumber}{l.supplierName ? ` — ${l.supplierName}` : ""}</option>)}
            </select>
            <input placeholder="Bill of lading no." value={link.blNumber} onChange={(e) => setLink({ ...link, blNumber: e.target.value })}
              style={st.input} disabled={busy || !canManageLc} />
            {canManageLc && (
              <button type="button" onClick={saveLink} disabled={busy} style={st.primary}>
                <MdLink size={18} style={{ flexShrink: 0 }} /> Save
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

const st = {
  wrap: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: "0.75rem", marginTop: "0.75rem" },
  card: { background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.7rem 0.85rem" },
  h4: { margin: "0 0 0.5rem", fontSize: 14 },
  muted: { color: "#5f6d7e", fontSize: 12.5, fontWeight: 400, margin: 0 },
  list: { listStyle: "none", padding: 0, margin: "0 0 0.5rem", display: "grid", gap: 4 },
  item: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, minHeight: 36, borderBottom: `1px solid ${colors.cardBorder}` },
  amount: { marginLeft: "auto", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  form: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" },
  input: { flex: "1 1 140px", minHeight: 44, padding: "0.35rem 0.6rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: 13.5, boxSizing: "border-box", minWidth: 0 },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0.4rem 0.9rem", borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer" },
  iconBtn: { display: "grid", placeItems: "center", width: 44, height: 44, border: "none", background: "transparent", color: colors.danger, cursor: "pointer", borderRadius: 8 },
};
