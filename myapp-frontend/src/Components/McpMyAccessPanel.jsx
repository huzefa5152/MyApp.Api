import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import httpClient from "../api/httpClient";
import { useConfirm } from "./ConfirmDialog";
import { MdSmartToy, MdCheckCircle, MdLock, MdContentCopy, MdMenuBook, MdLink, MdLinkOff, MdHistory, MdChevronLeft, MdChevronRight } from "react-icons/md";
import { notify } from "../utils/notify";
import "./McpCatalogAccessPanel.css";

const TONE = { Active: "is-ok", Expired: "", Revoked: "is-bad" };
const OUTCOME = { ok: ["is-ok", "Done"], denied: ["is-warn", "Refused"], error: ["is-bad", "Failed"] };

export default function McpMyAccessPanel() {
  const confirm = useConfirm();
  const [status, setStatus] = useState(null);
  const [activity, setActivity] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState("ChatGPT");
  const [showInactive, setShowInactive] = useState(false);
  const load = useCallback(async () => {
    try { setStatus((await httpClient.get("/mcp/me/status")).data); setError(""); }
    catch { setError("Could not load your MCP connections. Try again."); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let alive = true; setActivity(null);
    httpClient.get("/mcp/me/activity", {params:{page,pageSize:10}})
      .then(({data}) => { if (alive) setActivity(data); }).catch(() => { if (alive) setActivity({items:[],unavailable:true}); });
    return () => { alive = false; };
  }, [page]);
  const revoke = async connection => {
    if (!await confirm({title:"Disconnect this app?",message:`Disconnect ${connection.name}? It will need a new OAuth sign-in to access your account again.`,variant:"danger",confirmText:"Disconnect"})) return;
    setBusy(true);
    try { await httpClient.post(`/mcp/me/tokens/${connection.id}/revoke`); await load(); }
    catch { setError("Could not disconnect the app. Reload to check its status."); }
    finally { setBusy(false); }
  };
  const url = `${window.location.origin}/mcp`;
  const date = value => value ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`).toLocaleString() : "Not used yet";
  // Revoked and expired links are history: keep them, but behind one click.
  const active = status?.tokens.filter(t => t.status === "Active") ?? [];
  const inactive = status?.tokens.filter(t => t.status !== "Active") ?? [];
  const copy = async () => { try { await navigator.clipboard.writeText(url); notify("Server address copied.", "success"); } catch { notify("Copy failed. Select the address and copy it by hand.", "error"); } };
  return <section className="mcp-catalog" aria-label="MCP OAuth connections">
    <div className="mcp-head"><div className="mcp-head-left">
      <div className="mcp-head-icon"><MdSmartToy aria-hidden /></div>
      <div><h2>Connect your AI with OAuth</h2>
        <p>Link ChatGPT, Claude or another agent to your ERP account. Your assigned companies and role permissions apply.</p></div>
    </div></div>
    {error && <p className="mcp-catalog-alert" role="alert">{error}<button className="mcp-catalog-button" onClick={load}>Try again</button></p>}
    {!status && !error && <div className="mcp-card mcp-catalog-loading" role="status">Loading connection access…</div>}
    {status && <div className={`mcp-card mcp-status ${status.enabled ? "is-on" : "is-off"}`}>
      {status.enabled ? <MdCheckCircle aria-hidden /> : <MdLock aria-hidden />}
      <div><strong>{status.enabled ? "MCP access enabled" : "Purchase this premium feature"}</strong>
        <span className="mcp-catalog-help">{status.enabled ? "Connect with your own ERP account. Your assigned companies and role permissions apply." : "Contact your administrator to purchase MCP access. The seed administrator must enable access before you can connect."}</span></div>
    </div>}

    <div className="mcp-card">
      <div className="mcp-picker">
        <label className="mcp-catalog-search">AI application<select value={client} onChange={e => setClient(e.target.value)}>
          {["ChatGPT","Claude","Other OAuth-compatible agent"].map(name => <option key={name}>{name}</option>)}
        </select></label>
        <div><span className="mcp-label">MCP server address</span>
          <div className="mcp-code-row"><code className="mcp-code">{url}</code>
            <button type="button" className="mcp-icon-btn" onClick={copy} aria-label="Copy server address" title="Copy"><MdContentCopy /></button></div></div>
      </div>
      <ol className="mcp-steps">
        <li>{client === "ChatGPT" ? "In ChatGPT Settings, open Apps and enable Developer mode in Advanced settings, then create a custom app." : client === "Claude" ? "In Claude Settings, open Connectors and add a custom connector." : "Add a remote HTTP MCP server in your agent’s configuration."}</li>
        <li><span>Enter the server address above and choose <strong>OAuth</strong> authentication.</span></li>
        <li>Sign in with your ERP account. Review the requesting app, choose your assigned companies and approve only the actions you need.</li>
        <li>Return to your AI application and enable the connection in your conversation.</li>
      </ol>
      <p className="mcp-catalog-help" style={{ marginTop: "1rem" }}>Catalog access is configured by the seed administrator. An OAuth connection can only narrow that access.</p>
      <Link to="/mcp-guide" className="mcp-link"><MdMenuBook aria-hidden /> Read the full OAuth setup guide</Link>
    </div>

    <h3 className="mcp-section-title"><MdLink aria-hidden /> Connected apps</h3>
    {status && !active.length && <div className="mcp-card mcp-empty"><MdLinkOff aria-hidden />{inactive.length ? "No active connections." : "No connected apps yet."} Start the OAuth connection from your AI application.</div>}
    {inactive.length > 0 && <button type="button" className="mcp-catalog-button" style={{ marginBottom: ".8rem" }} aria-expanded={showInactive}
      onClick={() => setShowInactive(v => !v)}>{showInactive ? "Hide" : "Show"} {inactive.length} revoked or expired</button>}
    <div className="mcp-catalog-groups">{[...active, ...(showInactive ? inactive : [])].map(connection => <article key={connection.id} className="mcp-card mcp-conn">
      <div className="mcp-conn-top"><div><h4>{connection.name}</h4>
        <span className="mcp-catalog-help">{connection.signIn ? "OAuth connection" : "Existing legacy connection"}</span></div>
        <span className={`mcp-badge ${TONE[connection.status] || ""}`}>{connection.status}</span></div>
      <div className="mcp-chips">{connection.allCompanies ? <span className="mcp-chip is-warn">All companies (seed administrator)</span> : connection.companies.map(c => <span key={c.id ?? c.name} className="mcp-chip">{c.name}</span>)}</div>
      <div className="mcp-meta"><div><span>Last used</span><span>{date(connection.lastUsedAt)}</span></div></div>
      {connection.status === "Active" && <button className="mcp-catalog-button mcp-catalog-danger" disabled={busy} onClick={() => revoke(connection)}><MdLinkOff aria-hidden /> Disconnect {connection.name}</button>}
    </article>)}</div>

    <h3 className="mcp-section-title"><MdHistory aria-hidden /> Recent AI activity</h3>
    {!activity && <div className="mcp-card mcp-catalog-loading" role="status">Loading recent activity…</div>}
    {activity?.unavailable && <p className="mcp-catalog-alert">Activity could not be loaded. Reload this page to try again.</p>}
    {activity && !activity.unavailable && !activity.items.length && <div className="mcp-card mcp-empty"><MdHistory aria-hidden />No activity yet.</div>}
    {activity && !activity.unavailable && activity.items.length > 0 && <ul className="mcp-activity">{activity.items.map(entry => <li key={entry.id}>
      <div><code>{entry.tool}</code><small>{entry.agentName || "Connection"} · {date(entry.at)}</small></div>
      <span className={`mcp-badge ${OUTCOME[entry.outcome]?.[0] || "is-bad"}`}>{OUTCOME[entry.outcome]?.[1] || entry.outcome}</span>
    </li>)}</ul>}
    {activity && !activity.unavailable && activity.total > 10 && <div className="mcp-pager">
      <span>Page {page} of {Math.ceil(activity.total / 10)}</span>
      <div>
        <button className="mcp-icon-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous activity"><MdChevronLeft /></button>
        <button className="mcp-icon-btn" disabled={page * 10 >= activity.total} onClick={() => setPage(p => p + 1)} aria-label="Next activity"><MdChevronRight /></button>
      </div>
    </div>}
  </section>;
}
