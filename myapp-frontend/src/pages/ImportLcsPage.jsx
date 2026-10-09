import { useCallback, useEffect, useState, Fragment } from "react";
import { MdAdd, MdEdit, MdDelete, MdExpandMore, MdChevronRight } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, dropdownStyles } from "../theme";
import { getImportLcs, createImportLc, updateImportLc, deleteImportLc } from "../api/importConsignmentApi";

/**
 * Purchases -> Letters of Credit (2026-10-05). The bank instruments an
 * importer pays foreign suppliers with, and the GDs that cleared goods shipped
 * against each one (linked from the Consignments screen). Record-keeping only:
 * nothing here posts to the ledger. Every figure under an LC is the server's,
 * summed from the GDs linked to it.
 */
const money = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayLabel = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const blank = () => ({ lcNumber: "", bankName: "", supplierName: "", currency: "USD", foreignAmount: "", exchangeRate: "", openedOn: today(), expiresOn: "", status: "open", notes: "" });

export default function ImportLcsPage() {
  const { companies, selectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canManage = has("importcosting.lc.manage");
  const [companyId, setCompanyId] = useState(selectedCompany?.id ? String(selectedCompany.id) : "");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null); // { id?, ...fields }
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!companyId && selectedCompany?.id) setCompanyId(String(selectedCompany.id)); }, [selectedCompany, companyId]);

  const load = useCallback(async () => {
    if (!companyId) { setRows([]); return; }
    setLoading(true);
    try { const { data } = await getImportLcs(companyId); setRows(data || []); }
    catch { setRows([]); }
    finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const edit = (lc) => setForm({
    id: lc.id, lcNumber: lc.lcNumber, bankName: lc.bankName || "", supplierName: lc.supplierName || "",
    currency: lc.currency || "USD", foreignAmount: String(lc.foreignAmount ?? ""), exchangeRate: lc.exchangeRate == null ? "" : String(lc.exchangeRate),
    openedOn: (lc.openedOn || "").slice(0, 10), expiresOn: (lc.expiresOn || "").slice(0, 10), status: lc.status || "open", notes: lc.notes || "",
  });

  const save = async (e) => {
    e.preventDefault();
    const body = {
      ...form, foreignAmount: Number(form.foreignAmount || 0),
      exchangeRate: form.exchangeRate === "" ? null : Number(form.exchangeRate),
      expiresOn: form.expiresOn || null,
    };
    setBusy(true);
    try {
      if (form.id) await updateImportLc(form.id, body); else await createImportLc(companyId, body);
      notify(form.id ? "LC updated." : "LC recorded.", "success");
      setForm(null);
      load();
    } catch (err) { notify(err?.response?.data?.message || "The LC was not saved.", "error"); }
    finally { setBusy(false); }
  };

  const remove = async (lc) => {
    const msg = lc.gdCount ? `${lc.gdCount} GD(s) linked to it keep their goods and figures and lose the link.` : "Nothing is linked to it.";
    if (!(await confirm({ title: `Delete LC ${lc.lcNumber}?`, message: msg, confirmText: "Delete", variant: "danger" }))) return;
    try { await deleteImportLc(lc.id); load(); }
    catch (err) { notify(err?.response?.data?.message || "The LC was not deleted.", "error"); }
  };

  const f = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }), disabled: busy });

  return (
    <div style={st.page}>
      <header style={st.header}>
        <div style={{ minWidth: 0 }}>
          <h1 style={st.h1}>Letters of Credit</h1>
          <p style={st.muted}>Each LC with the GDs cleared against it. Link a GD to its LC from Consignments. Nothing here posts to the ledger.</p>
        </div>
        <label style={st.companyField}>
          <span style={st.label}>Company</span>
          <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setForm(null); }} style={{ ...dropdownStyles.base, minHeight: 44, width: "100%" }}>
            <option value="">Choose a company…</option>
            {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </header>

      {companyId && canManage && !form && (
        <button type="button" onClick={() => setForm(blank())} style={st.primary}><MdAdd size={18} style={{ flexShrink: 0 }} /> New LC</button>
      )}

      {form && (
        <form onSubmit={save} style={st.card}>
          <h3 style={{ margin: "0 0 0.6rem", fontSize: 15 }}>{form.id ? `Edit LC ${form.lcNumber}` : "New LC"}</h3>
          <div style={st.grid}>
            <Field label="LC number *"><input required maxLength={60} style={st.input} {...f("lcNumber")} /></Field>
            <Field label="Bank"><input maxLength={120} style={st.input} {...f("bankName")} /></Field>
            <Field label="Supplier"><input maxLength={200} style={st.input} {...f("supplierName")} /></Field>
            <Field label="Currency"><input maxLength={10} style={st.input} {...f("currency")} /></Field>
            <Field label="Amount (foreign)"><input type="number" min="0" step="0.01" style={st.input} {...f("foreignAmount")} /></Field>
            <Field label="Exchange rate (PKR)"><input type="number" min="0" step="0.0001" style={st.input} {...f("exchangeRate")} /></Field>
            <Field label="Opened on *"><input type="date" required style={st.input} {...f("openedOn")} /></Field>
            <Field label="Expires on"><input type="date" style={st.input} {...f("expiresOn")} /></Field>
            <Field label="Status">
              <select style={st.input} {...f("status")}><option value="open">Open</option><option value="closed">Closed</option></select>
            </Field>
          </div>
          <Field label="Notes"><input maxLength={500} style={st.input} {...f("notes")} /></Field>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "0.75rem" }}>
            <button type="submit" disabled={busy} style={st.primary}>{form.id ? "Save" : "Record LC"}</button>
            <button type="button" onClick={() => setForm(null)} disabled={busy} style={st.ghost}>Cancel</button>
          </div>
        </form>
      )}

      {!companyId ? <p style={st.muted}>Choose a company to see its LCs.</p>
        : loading ? <p style={st.muted}>Loading…</p>
          : rows.length === 0 ? <p style={st.muted}>No LCs recorded for this company.</p> : (
            <div style={st.gridBox}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={{ ...st.th, width: 44 }} aria-label="Expand" />
                    <th style={st.th}>LC</th>
                    <th style={st.th}>Supplier / bank</th>
                    <th style={st.th}>Opened</th>
                    <th style={{ ...st.th, textAlign: "right" }}>Amount</th>
                    <th style={{ ...st.th, textAlign: "right" }}>GDs</th>
                    <th style={{ ...st.th, textAlign: "right" }}>Landed cost</th>
                    <th style={{ ...st.th, textAlign: "right" }}>Outstanding to clear</th>
                    <th style={st.th}>Status</th>
                    {canManage && <th style={{ ...st.th, width: 96 }} aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((lc) => (
                    <Fragment key={lc.id}>
                      <tr>
                        <td style={st.td}>
                          <button type="button" onClick={() => setOpen(open === lc.id ? null : lc.id)} style={st.iconBtn}
                            aria-label={open === lc.id ? "Hide GDs" : "Show GDs"} title={open === lc.id ? "Hide GDs" : "Show GDs"}>
                            {open === lc.id ? <MdExpandMore size={20} /> : <MdChevronRight size={20} />}
                          </button>
                        </td>
                        <td style={{ ...st.td, fontWeight: 700 }}>{lc.lcNumber}</td>
                        <td style={{ ...st.td, ...st.wrap }}>{lc.supplierName || "—"}<div style={st.small}>{lc.bankName || ""}</div></td>
                        <td style={st.td}>{dayLabel(lc.openedOn)}{lc.expiresOn ? <div style={st.small}>expires {dayLabel(lc.expiresOn)}</div> : null}</td>
                        <td style={st.num}>{lc.currency} {money(lc.foreignAmount)}{lc.exchangeRate ? <div style={st.small}>@ {lc.exchangeRate}</div> : null}</td>
                        <td style={st.num}>{lc.gdCount}</td>
                        <td style={st.num}>{money(lc.landedCost)}</td>
                        <td style={st.num}>{money(lc.outstanding)}</td>
                        <td style={st.td}><span style={{ ...st.pill, ...(lc.status === "open" ? st.pillOpen : st.pillClosed) }}>{lc.status === "open" ? "Open" : "Closed"}</span></td>
                        {canManage && (
                          <td style={st.td}>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button type="button" onClick={() => edit(lc)} style={st.iconBtn} aria-label="Edit LC" title="Edit LC"><MdEdit size={18} /></button>
                              <button type="button" onClick={() => remove(lc)} style={{ ...st.iconBtn, color: colors.danger }} aria-label="Delete LC" title="Delete LC"><MdDelete size={18} /></button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {open === lc.id && (
                        <tr>
                          <td colSpan={canManage ? 10 : 9} style={{ ...st.td, background: "#f8fafc", whiteSpace: "normal" }}>
                            {lc.gds.length === 0 ? <p style={st.muted}>No GD linked yet. Open the GD on Consignments and choose this LC.</p> : (
                              <table style={st.table}>
                                <thead><tr>
                                  <th style={st.th}>GD</th><th style={st.th}>Date</th><th style={st.th}>B/L</th>
                                  <th style={{ ...st.th, textAlign: "right" }}>Assessed</th><th style={{ ...st.th, textAlign: "right" }}>Landed</th>
                                  <th style={{ ...st.th, textAlign: "right" }}>Owed</th><th style={{ ...st.th, textAlign: "right" }}>Settled</th>
                                </tr></thead>
                                <tbody>
                                  {lc.gds.map((g) => (
                                    <tr key={g.id}>
                                      <td style={st.td}>{g.gdNumber}</td><td style={st.td}>{dayLabel(g.gdDate)}</td><td style={st.td}>{g.blNumber || "—"}</td>
                                      <td style={st.num}>{money(g.assessedValue)}</td><td style={st.num}>{money(g.landedCost)}</td>
                                      <td style={st.num}>{money(g.owed)}</td><td style={st.num}>{money(g.settled)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}

function Field({ label, children }) {
  return <label style={st.field}><span style={st.label}>{label}</span>{children}</label>;
}

const st = {
  page: { padding: 0, maxWidth: 1280, margin: "0 auto" },
  header: { display: "flex", flexWrap: "wrap", gap: "0.75rem 1.5rem", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "0.75rem" },
  h1: { margin: 0, fontSize: 22 },
  muted: { color: "#5f6d7e", fontSize: 13, margin: "0.25rem 0" },
  small: { fontSize: 11.5, color: "#5f6d7e", marginTop: 2 },
  companyField: { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 240px", maxWidth: 360 },
  card: { background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.85rem 1rem", margin: "0.5rem 0 1rem" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.6rem", marginBottom: "0.6rem" },
  field: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  label: { fontSize: 12, fontWeight: 700, color: "#5f6d7e" },
  input: { minHeight: 44, padding: "0.35rem 0.6rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box", width: "100%" },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0.4rem 1rem", borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer", marginBottom: "0.75rem" },
  ghost: { display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0.4rem 1rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", cursor: "pointer", marginBottom: "0.75rem" },
  gridBox: { overflow: "auto", maxHeight: "70vh", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, background: "#fff" },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 },
  th: { position: "sticky", top: 0, zIndex: 1, textAlign: "left", padding: "0.5rem 0.6rem", background: "#f3f6fa", borderBottom: `1px solid ${colors.cardBorder}`, whiteSpace: "nowrap" },
  td: { padding: "0.4rem 0.6rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "top", whiteSpace: "nowrap" },
  num: { padding: "0.4rem 0.6rem", borderBottom: `1px solid ${colors.cardBorder}`, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", verticalAlign: "top" },
  wrap: { whiteSpace: "normal", minWidth: 180, maxWidth: 300, overflowWrap: "anywhere" },
  pill: { display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 700 },
  pillOpen: { background: "#e8f5e9", color: "#1b5e20" },
  pillClosed: { background: "#eef2f7", color: "#5f6d7e" },
  iconBtn: { display: "grid", placeItems: "center", width: 44, height: 44, border: "none", background: "transparent", color: colors.blue, cursor: "pointer", borderRadius: 8 },
};
