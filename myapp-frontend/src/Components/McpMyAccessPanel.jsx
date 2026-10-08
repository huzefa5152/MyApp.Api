import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import httpClient from "../api/httpClient";
import { useConfirm } from "./ConfirmDialog";
import "./McpCatalogAccessPanel.css";

export default function McpMyAccessPanel() {
  const confirm = useConfirm();
  const [status, setStatus] = useState(null);
  const [activity, setActivity] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState("ChatGPT");
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
  return <section className="mcp-catalog" aria-label="MCP OAuth connections">
    <h2>Connect your AI with OAuth</h2>
    {error && <p className="mcp-catalog-alert" role="alert">{error}<button className="mcp-catalog-button" onClick={load}>Try again</button></p>}
    {!status && !error && <p role="status">Loading connection access…</p>}
    {status && <p className={status.enabled ? "mcp-catalog-success" : "mcp-catalog-note"}>
      <strong>{status.enabled ? "MCP access enabled" : "Purchase this premium feature"}</strong><br />
      {status.enabled ? "Connect with your own ERP account. Your assigned companies and role permissions apply." : "Contact your administrator to purchase MCP access. The seed administrator must enable access before you can connect."}
    </p>}
    <label className="mcp-catalog-search">AI application<select value={client} onChange={e => setClient(e.target.value)}>
      {["ChatGPT","Claude","Other OAuth-compatible agent"].map(name => <option key={name}>{name}</option>)}
    </select></label>
    <p><strong>MCP server address</strong></p>
    <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",padding:16,background:"#eef3f8",borderRadius:8}}>{url}</pre>
    <ol style={{lineHeight:1.8,paddingLeft:24}}>
      <li>{client === "ChatGPT" ? "In ChatGPT Settings, open Apps and enable Developer mode in Advanced settings, then create a custom app." : client === "Claude" ? "In Claude Settings, open Connectors and add a custom connector." : "Add a remote HTTP MCP server in your agent’s configuration."}</li>
      <li>Enter the server address above and choose <strong>OAuth</strong> authentication.</li>
      <li>Sign in with your ERP account. Review the requesting app, choose your assigned companies and approve only the actions you need.</li>
      <li>Return to your AI application and enable the connection in your conversation.</li>
    </ol>
    <p>Catalog access is configured by the seed administrator. An OAuth connection can only narrow that access.</p>
    <Link to="/mcp-guide" style={{display:"inline-block",minHeight:44}}>Read the full OAuth setup guide</Link>
    <h3>Connected apps</h3>
    {status && !status.tokens.length && <p className="mcp-catalog-note">No connected apps yet. Start the OAuth connection from your AI application.</p>}
    <div className="mcp-catalog-groups">{status?.tokens.map(connection => <article key={connection.id} className="mcp-catalog-group">
      <div className="mcp-catalog-group-heading"><h4>{connection.name}</h4><span>{connection.status}</span></div>
      <p>{connection.signIn ? "OAuth connection" : "Existing legacy connection"}</p>
      <p>{connection.allCompanies ? "All companies (seed administrator)" : connection.companies.map(c => c.name).join(", ")}</p>
      <p>Last used: {date(connection.lastUsedAt)}</p>
      {connection.status === "Active" && <button className="mcp-catalog-button" disabled={busy} onClick={() => revoke(connection)}>Disconnect {connection.name}</button>}
    </article>)}</div>
    <h3>Recent AI activity</h3>
    {!activity && <p role="status">Loading recent activity…</p>}
    {activity?.unavailable && <p>Activity could not be loaded. Reload this page to try again.</p>}
    {activity && !activity.unavailable && !activity.items.length && <p>No activity yet.</p>}
    <div className="mcp-catalog-groups">{activity?.items.map(entry => <article className="mcp-catalog-group" key={entry.id}>
      <strong>{entry.tool}</strong><p>{entry.agentName || "Connection"} · {entry.outcome}</p><small>{date(entry.at)}</small>
    </article>)}</div>
    {activity && !activity.unavailable && activity.total > 10 && <div className="mcp-catalog-footer">
      <button className="mcp-catalog-button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous activity</button>
      <span>Page {page} of {Math.ceil(activity.total / 10)}</span>
      <button className="mcp-catalog-button" disabled={page * 10 >= activity.total} onClick={() => setPage(p => p + 1)}>Next activity</button>
    </div>}
  </section>;
}
