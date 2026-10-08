import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FiInbox, FiLink, FiRefreshCw, FiSearch, FiChevronLeft, FiChevronRight, FiMail, FiCheck, FiSlash, FiRotateCcw, FiFileText, FiSave, FiPlus, FiDownload, FiTrash2 } from "react-icons/fi";
import http from "../api/httpClient";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import LineItemsEditor from "../Components/LineItemsEditor";
import EmailQuotationAssistance from "../Components/EmailQuotationAssistance";
import "./EmailWorkspacePage.css";

const actionIcons = { Inbox: FiInbox, Connections: FiLink, Refresh: FiRefreshCw, "Connect Gmail": FiPlus, Previous: FiChevronLeft, Next: FiChevronRight, "Keep enquiry": FiCheck, Ignore: FiSlash, Restore: FiRotateCcw, "Prepare quotation": FiFileText, "Save draft": FiSave, "Create quotation": FiFileText, "Add sender rule": FiPlus, "Save rules": FiSave, "Sync now": FiRefreshCw, "Unlink from company": FiLink };
function ActionLabel({ label }) {
  const Icon = actionIcons[label];
  return <>{Icon && <Icon className="ew-icon" aria-hidden="true" />}{label}</>;
}

const blankItem = () => ({ description: "", quantity: 1, unit: "", unitPrice: null, brand: "" });
const errorMessage = e => e.response?.data?.message || "Could not complete this request. Please try again.";
export default function EmailWorkspacePage() {
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  if (!has("email.workspace.use") || !has("email.inbox.view")) return <p role="alert">Email Workspace access is not assigned. Ask your administrator to enable the module and inbox permission.</p>;
  return selectedCompany ? <Workspace key={selectedCompany.id} company={selectedCompany} /> : <p>Select a company to open its email workspace.</p>;
}
function Workspace({ company }) {
  const { has } = usePermissions();
  const root = `/email-workspace/company/${company.id}`;
  const alive = useRef(true), callbackStarted = useRef(false);
  const [status, setStatus] = useState(null), [rows, setRows] = useState([]), [total, setTotal] = useState(0);
  const [page, setPage] = useState(1), [filter, setFilter] = useState("All"), [search, setSearch] = useState("");
  const [active, setActive] = useState(null), [draft, setDraft] = useState(null), [clients, setClients] = useState([]);
  const [tab, setTab] = useState("Inbox"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const requestId = useRef(0);
  const run = async action => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  const loadStatus = async () => { const { data } = await http.get(`${root}/connections`); if (alive.current) setStatus(data); };
  const loadRows = async () => {
    const seq = ++requestId.current;
    const { data } = await http.get(`${root}/messages`, { params: { filter, search, page, pageSize: 20 } });
    if (alive.current && seq === requestId.current) { setRows(data.items); setTotal(data.totalCount); }
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++requestId.current; }; }, []);
  useEffect(() => { loadStatus().catch(e => alive.current && setError(errorMessage(e))); }, [root]);
  useEffect(() => { loadRows().catch(e => alive.current && setError(errorMessage(e))); }, [root, filter, search, page]);
  useEffect(() => {
    if (!has("email.enquiries.manage") && !has("email.connections.manage")) return;
    http.get(`${root}/customers`).then(({ data }) => { if (alive.current) setClients(data); }).catch(e => alive.current && setError(errorMessage(e)));
  }, [company.id, has]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code"), state = query.get("state"), denied = query.get("error");
    if (!code && !denied) return;
    if (callbackStarted.current) return;
    callbackStarted.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    if (denied) { setError("Google connection was cancelled. You can try again in Connections."); return; }
    run(async () => {
      const { data } = await http.post("/email-workspace/oauth/complete", { code, state });
      if (!alive.current) return;
      setNotice(`Gmail connected to the selected company (company ${data.companyId}).`);
      await loadStatus(); await loadRows();
    });
  }, []);
  const read = async id => { const { data } = await http.get(`${root}/messages/${id}`); if (alive.current) { setActive(data); setDraft(data.draft ? { ...data.draft, revision: data.revision } : null); } };
  const decide = decision => run(async () => {
    await http.put(`${root}/messages/${active.id}/decision`, { decision, revision: active.revision });
    await read(active.id); await loadRows();
  });
  const prepare = () => run(async () => {
    const { data } = await http.post(`${root}/messages/${active.id}/prepare`, { decision: "Kept", revision: active.revision });
    if (alive.current) { setDraft(data); setActive(a => ({ ...a, revision: data.revision })); }
  });
  const save = () => run(async () => {
    const { data } = await http.put(`${root}/messages/${active.id}/draft`, draft);
    if (alive.current) { setDraft(d => ({ ...d, revision: data.revision })); setActive(a => ({ ...a, revision: data.revision })); setNotice("Draft saved."); }
  });
  const convert = () => run(async () => {
    const { data } = await http.post(`${root}/messages/${active.id}/convert`, draft);
    if (!alive.current) return;
    setNotice(`Quotation ${data.quoteNumber} is ready in Sales Quotes.`);
    await read(active.id); await loadRows();
  });
  const change = (key, value) => setDraft(d => ({ ...d, [key]: value, reviewed: key === "reviewed" ? value : false }));
  const download = attachment => run(async () => {
    const response = await http.get(`${root}/messages/${active.id}/attachment`, { params: { attachmentId: attachment.id }, responseType: "blob" });
    if (!alive.current) return;
    const url = URL.createObjectURL(response.data), a = document.createElement("a"); a.href = url; a.download = attachment.fileName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return <main className="ew" aria-busy={busy}>
    <header className="ew-header"><div className="ew-heading"><span className="ew-heading-icon" aria-hidden="true"><FiMail /></span><div><span className="ew-kicker">{company.name}</span><h1>Email workspace</h1><p>Choose what matters. Review the enquiry, add prices, then create a quotation.</p></div></div><div className="ew-actions ew-navigation">{["Inbox", "Connections"].map(t => <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}><ActionLabel label={t} /></button>)}<button disabled={busy} onClick={() => run(async () => { await loadStatus(); await loadRows(); })}><ActionLabel label="Refresh" /></button></div></header>
    {error && <p role="alert" className="ew-error">{error}</p>}{notice && <p role="status" className="ew-notice">{notice}</p>}
    {tab === "Connections" ? <section className="ew-panel"><h2>Gmail connections</h2><p>Authorize a Gmail account once, then link it separately to each company you can access. Your inbox is private until you keep an email or enable matching sender sharing. Initial sync includes received email from the last 30 days.</p>
      {status && !status.configured && <p className="ew-notice">Google OAuth setup is required. Ask your administrator to follow the Gmail setup guide.</p>}
      {has("email.connections.manage") && <div className="ew-actions"><button disabled={busy || !status?.configured} onClick={() => run(async () => { const { data } = await http.post(`${root}/oauth/start`); window.location.assign(data.authorizationUrl); })}><ActionLabel label="Connect Gmail" /></button><select aria-label="Link an existing Gmail account" defaultValue="" disabled={busy} onChange={e => { const id = Number(e.target.value); e.target.value = ""; if (id) run(async () => { await http.post(`${root}/connections`, { connectionId: id }); await loadStatus(); await loadRows(); }); }}><option value="">Link an existing account…</option>{status?.ownConnections.filter(c => c.status === "Connected").map(c => <option key={c.id} value={c.id}>{c.emailAddress}</option>)}</select></div>}
      {status?.links.map(link => <Connection key={`${link.id}-${link.isEnabled}`} link={link} root={root} clients={clients} canManage={has("email.connections.manage")} busy={busy} run={run} refresh={async () => { await loadStatus(); await loadRows(); }} />)}
      {!status?.links.length && <p>No mailboxes linked to this company yet.</p>}
    </section> : <><div className="ew-toolbar"><label className="ew-search">Find email<span className="ew-search-control"><FiSearch aria-hidden="true" /><input value={search} placeholder="Search subject or sender" onChange={e => { setSearch(e.target.value); setPage(1); }} /></span></label><div className="ew-actions ew-filters" aria-label="Filter emails">{["All", "Suggested", "Unreviewed", "Kept", "Ignored", "Converted"].map(f => <button key={f} aria-pressed={filter === f} onClick={() => { setFilter(f); setPage(1); }}>{f}</button>)}</div></div>
    <div className="ew-columns"><section className="ew-panel" aria-label="Emails"><h2 className="ew-inbox-title"><FiInbox className="ew-icon" aria-hidden="true" />Company inbox <small>{total}</small></h2><p className="ew-muted">Keep shares an enquiry with permitted colleagues in this company. Ignore only changes its workspace status; Gmail is unchanged.</p>
      {!rows.length && <p>No emails in this view. Connect Gmail, sync your account, or choose another filter.</p>}
      {rows.map(m => <button className="ew-email" key={m.id} disabled={busy} aria-pressed={active?.id === m.id} onClick={() => run(() => read(m.id))}><span className="ew-muted">{m.sender}</span><strong>{m.subject || "(No subject)"}</strong><span>{m.salesQuoteId ? `Converted · ${m.salesQuoteNumber}` : m.decision} · {new Date(m.receivedAt + (m.receivedAt.endsWith("Z") ? "" : "Z")).toLocaleDateString()}</span></button>)}
      <div className="ew-actions ew-pagination"><button disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)}><ActionLabel label="Previous" /></button><span>Page {page}</span><button disabled={page * 20 >= total || busy} onClick={() => setPage(p => p + 1)}><ActionLabel label="Next" /></button></div>
    </section><section className="ew-panel" aria-label="Selected enquiry">{!active ? <div className="ew-empty"><span className="ew-empty-icon" aria-hidden="true"><FiMail /></span><h2>Your next quotation starts here</h2><p>Select an email to read it. You decide what to keep and convert.</p><span className="ew-empty-steps"><span>1. Choose email</span><FiChevronRight aria-hidden="true" /><span>2. Review items</span><FiChevronRight aria-hidden="true" /><span>3. Add prices</span></span></div> : <><h2>{active.subject || "(No subject)"}</h2><p className="ew-muted">{active.sender}</p><details open={!draft}><summary>Original email</summary><pre className="ew-body">{active.text || "This email has no readable text. Check its attachments."}</pre><div className="ew-actions">{active.attachments.map(a => <button disabled={busy} key={a.id} onClick={() => download(a)}><FiDownload className="ew-icon" aria-hidden="true" /><span>Download {a.fileName}</span></button>)}</div></details>
      {active.salesQuoteId ? <p className="ew-notice">Converted to {active.salesQuoteNumber}. {has("salesquotes.list.view") && <Link to="/sales-quotes">Open Sales Quotes</Link>}</p> : <><div className="ew-actions">{has("email.inbox.manage") && <>{active.decision !== "Kept" && <button disabled={busy} onClick={() => decide("Kept")}><ActionLabel label="Keep enquiry" /></button>}{active.decision !== "Ignored" && <button disabled={busy} onClick={() => decide("Ignored")}><ActionLabel label="Ignore" /></button>}{active.decision === "Ignored" && <button disabled={busy} onClick={() => decide("Unreviewed")}><ActionLabel label="Restore" /></button>}</>}{has("email.enquiries.manage") && active.decision === "Kept" && !draft && <button disabled={busy} onClick={prepare}><ActionLabel label="Prepare quotation" /></button>}</div>
      {draft && has("email.enquiries.manage") && <div className="ew-draft"><h3>Review enquiry</h3><ul className="ew-warnings">{draft.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul><div className="ew-grid"><label>Customer<select value={draft.clientId || ""} onChange={e => change("clientId", Number(e.target.value) || null)}><option value="">Confirm customer…</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Quotation date<input type="date" value={draft.date?.slice(0, 10) || ""} onChange={e => change("date", e.target.value)} /></label><label>Valid until<input type="date" value={draft.validUntil?.slice(0, 10) || ""} onChange={e => change("validUntil", e.target.value || null)} /></label><label>Enquiry reference<input maxLength={200} value={draft.customerEnquiryRef || ""} onChange={e => change("customerEnquiryRef", e.target.value)} /></label><label>Contact person<input maxLength={200} value={draft.contactPerson || ""} onChange={e => change("contactPerson", e.target.value)} /></label><label>GST %<input type="number" min="0" max="100" value={draft.gstRate} onChange={e => change("gstRate", Number(e.target.value))} /></label></div>
      <LineItemsEditor companyId={company.id} items={draft.items} onItemsChange={items => change("items", items)} makeBlankItem={blankItem} showUnitPrice itemsHint="Check every description, quantity and unit against the original. Add unit prices." />
      <EmailQuotationAssistance root={root} message={active} draft={draft} busy={busy} run={run} changeItems={items => change("items", items)} onDraft={next => { if (alive.current) { setDraft(next); setActive(a => ({ ...a, revision: next.revision })); } }} />
      <div className="ew-grid">{draft.items.map((item, i) => <label key={i}>Item {i + 1} brand / make{draft.requiresBrand ? " (required)" : ""}<input maxLength={200} value={item.brand || ""} onChange={e => change("items", draft.items.map((x, j) => j === i ? { ...x, brand: e.target.value } : x))} /></label>)}</div><label>Notes<textarea maxLength={4000} value={draft.notes || ""} onChange={e => change("notes", e.target.value)} /></label>
      {draft.requiresSpecifications && <label className="ew-check"><input type="checkbox" checked={draft.specificationsConfirmed} onChange={e => change("specificationsConfirmed", e.target.checked)} />I checked the referenced samples / drawings and specifications.</label>}
      <label className="ew-check"><input type="checkbox" checked={draft.reviewed} onChange={e => change("reviewed", e.target.checked)} />I reviewed the customer, all items, quantities, units and prices.</label><div className="ew-actions"><button disabled={busy} onClick={save}><ActionLabel label="Save draft" /></button>{has("salesquotes.manage.create") && <button className="ew-primary" disabled={busy || !draft.reviewed} onClick={convert}><ActionLabel label="Create quotation" /></button>}</div></div>}</>}
    </>}</section></div></>}
  </main>;
}
function Connection({ link, root, clients, canManage, busy, run, refresh }) {
  const [rules, setRules] = useState(link.rules || []), [share, setShare] = useState(link.shareMatchingEmails);
  return <article className="ew-connection"><h3>{link.emailAddress}</h3><p>{link.isEnabled ? link.status : "Unlinked"} · {link.lastSyncedAt ? `Last synced ${new Date(link.lastSyncedAt + "Z").toLocaleString()}` : "Waiting for first sync"}</p>{link.lastError && <p role="status">{link.lastError}</p>}
    {link.isOwner && canManage && link.isEnabled && <><p>Only sender rules below are shared automatically. Kept enquiries are visible to permitted colleagues regardless of these rules.</p><label className="ew-check"><input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} />Share matching emails with this company</label>
    {rules.map((rule, i) => <div className="ew-grid ew-rule" key={i}><label>Sender address<input type="email" maxLength={320} value={rule.sender} placeholder="enquiries@example.com" onChange={e => setRules(rules.map((r, j) => i === j ? { ...r, sender: e.target.value } : r))} /></label><label>Subject contains (optional)<input maxLength={200} value={rule.subjectContains || ""} onChange={e => setRules(rules.map((r, j) => i === j ? { ...r, subjectContains: e.target.value } : r))} /></label><label>Customer (optional)<select value={rule.clientId || ""} onChange={e => setRules(rules.map((r, j) => i === j ? { ...r, clientId: Number(e.target.value) || null } : r))}><option value="">Confirm for each email</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button disabled={busy} onClick={() => setRules(rules.filter((_, j) => j !== i))}><FiTrash2 className="ew-icon" aria-hidden="true" /><span>Remove rule {i + 1}</span></button></div>)}
    <div className="ew-actions"><button disabled={busy || rules.length >= 100} onClick={() => setRules([...rules, { sender: "", subjectContains: "", clientId: null }])}><ActionLabel label="Add sender rule" /></button><button disabled={busy} onClick={() => run(async () => { await http.put(`${root}/connections/${link.id}`, { rules, shareMatchingEmails: share }); await refresh(); })}><ActionLabel label="Save rules" /></button><button disabled={busy || link.status !== "Connected"} onClick={() => run(async () => { await http.post(`${root}/sync/${link.connectionId}`); await refresh(); })}><ActionLabel label="Sync now" /></button><button disabled={busy} onClick={() => run(async () => { await http.delete(`${root}/connections/${link.id}`); await refresh(); })}><ActionLabel label="Unlink from company" /></button></div></>}
  </article>;
}
