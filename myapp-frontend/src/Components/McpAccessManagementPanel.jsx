import { useEffect, useState } from "react";
import { MdShield, MdPersonSearch } from "react-icons/md";
import httpClient from "../api/httpClient";
import { useAuth } from "../contexts/AuthContext";
import { useConfirm } from "./ConfirmDialog";
import McpCatalogAccessPanel from "./McpCatalogAccessPanel";
import "./McpCatalogAccessPanel.css";

export default function McpAccessManagementPanel({ targetUserId }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(targetUserId ? String(targetUserId) : "");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState(null);
  const [companyError, setCompanyError] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    let alive = true;
    httpClient.get("/users").then(({data}) => { if (alive) setUsers(data); })
      .catch(() => { if (alive) setError("Could not load users. Reload this page to try again."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true; setCompanies(null); setCompanyError(false);
    if (!selected) return () => { alive = false; };
    const seed = Number(selected) === Number(user?.id ?? user?.userId);
    httpClient.get(seed ? "/companies" : `/usercompanies/user/${selected}`)
      .then(({data}) => { if (alive) setCompanies(seed ? data.map(c => c.name) : data.companies.filter(c => c.hasExplicitGrant).map(c => c.companyName)); })
      .catch(() => { if (alive) setCompanyError(true); });
    return () => { alive = false; };
  }, [selected, user]);
  const account = users.find(u => String(u.id) === selected);
  const filtered = users.filter(u => `${u.fullName} ${u.username}`.toLowerCase().includes(query.toLowerCase()) || String(u.id) === selected);
  const choose = async id => {
    if (dirty && !await confirm({title:"Discard unsaved MCP settings?",message:"The current account has unsaved changes. Discard them before choosing another user?",variant:"warning",confirmText:"Discard changes"})) return;
    setDirty(false); setSelected(id);
  };
  const initials = (account?.fullName || account?.username || "?").split(" ").filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join("");
  return <section className="mcp-catalog" aria-label="Manage user MCP access">
    <div className="mcp-head"><div className="mcp-head-left">
      <div className="mcp-head-icon"><MdShield aria-hidden /></div>
      <div><h2>Manage MCP access</h2>
        <p>Choose a user, review their company access, then allow the AI actions they need. Only the seed administrator can configure these settings.</p></div>
    </div></div>
    {error && <p className="mcp-catalog-alert" role="alert">{error}</p>}
    <div className="mcp-card mcp-picker">
      <label className="mcp-catalog-search">Find a user<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or username" /></label>
      <label className="mcp-catalog-search">User receiving MCP access<select aria-label="User receiving MCP access" value={selected} onChange={e => choose(e.target.value)} disabled={loading}>
        <option value="">{loading ? "Loading users…" : `Choose a user (${filtered.length})`}</option>
        {filtered.map(u => <option key={u.id} value={u.id}>{u.fullName || u.username} · @{u.username} · #{u.id}</option>)}
      </select></label>
    </div>
    {selected && !loading && !account && <p role="alert" className="mcp-catalog-alert">This user is unavailable. Choose another user.</p>}
    {account && <>
      <div className="mcp-catalog-selected-account">
        <span className="mcp-avatar" aria-hidden>{initials}</span>
        <div>
          <strong>Configuring: {account.fullName || account.username}</strong>
          <span className="mcp-catalog-help">@{account.username} · User #{account.id} · {account.role || "User"}</span>
          {companyError ? <span className="mcp-catalog-help">Company access could not be loaded.</span>
            : companies === null ? <span className="mcp-catalog-help">Loading company access…</span>
            : companies.length ? <div className="mcp-chips" aria-label="Assigned companies">{companies.map(c => <span key={c} className="mcp-chip">{c}</span>)}</div>
            : <span className="mcp-chip is-warn">No companies assigned. MCP cannot access company data until a company is assigned.</span>}
        </div>
      </div>
      <McpCatalogAccessPanel key={account.id} targetUserId={account.id} onDirtyChange={setDirty} />
    </>}
    {!selected && <div className="mcp-card mcp-empty"><MdPersonSearch aria-hidden />Select a user to review and configure their MCP access. No account is selected automatically.</div>}
  </section>;
}
