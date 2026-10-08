import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MdSmartToy, MdAdd, MdRefresh, MdClose, MdContentCopy, MdBlock, MdChevronLeft, MdChevronRight, MdVpnKey, MdHistory,
} from "react-icons/md";
import httpClient from "../api/httpClient";
import { getUsers } from "../api/usersApi";
import { useAuth } from "../contexts/AuthContext";
import { useConfirm } from "./ConfirmDialog";
import { notify } from "../utils/notify";
import { SCOPE_INFO, orderedScopes } from "../utils/mcpScopes";
import AllCompaniesOption from "./AllCompaniesOption";
import { colors, cardStyles, formStyles, modalSizes } from "../theme";
import SearchableSelect from "./SearchableSelect";
import { Button, IconButton, Toolbar, TableWrap, Loading, EmptyState, Alert } from "../ui/Kit";

// Seed-admin console for AI agents (Codex, Claude, automations) connected through
// the hosted MCP endpoint: create and revoke per-agent tokens, and read the
// append-only activity log of everything the agents did. Renders nothing for
// anyone but the primary admin; the API refuses them too.

const NARROW = 980;
const TOKEN_TONE = {
  Active: { bg: "#eafbef", fg: "#1b6e34", dot: "#28a745" },
  Expired: { bg: "#eef1f5", fg: "#5f6d7e", dot: "#9aa6b5" },
  Revoked: { bg: "#fff0f1", fg: "#a52834", dot: "#dc3545" },
};
const OUTCOME_TONE = {
  ok: { bg: "#eafbef", fg: "#1b6e34", dot: "#28a745", label: "Done" },
  denied: { bg: "#fff4e5", fg: "#8a4b00", dot: "#fd7e14", label: "Refused" },
  error: { bg: "#fff0f1", fg: "#a52834", dot: "#dc3545", label: "Failed" },
};
const OUTCOMES = [["", "All"], ["ok", "Done"], ["denied", "Refused"], ["error", "Failed"]];

const asDate = v => v ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`) : null;
const absolute = v => { const d = asDate(v); return d ? d.toLocaleString() : "Never"; };
function relative(v) {
  const d = asDate(v);
  if (!d) return "Never";
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return d.toLocaleDateString();
}
function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < NARROW);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return narrow;
}
const Badge = ({ tone, children }) => <span style={{ ...s.badge, background: tone.bg, color: tone.fg }}>
  <span style={{ ...s.dot, background: tone.dot }} />{children}</span>;

function NewTokenDialog({ onClose, onCreated }) {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState("");
  const [companies, setCompanies] = useState([]);
  const [available, setAvailable] = useState(["read"]);
  const [meta, setMeta] = useState({ canUseAllCompanies: false, maxLifetimeDays: 90 });
  const [all, setAll] = useState(false);
  const [scopes, setScopes] = useState(["read"]);
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState("");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getUsers().then(r => setUsers(r.data)).catch(() => setError("Could not load users.")); }, []);
  useEffect(() => {
    setPicked([]); setCompanies([]); setAvailable(["read"]); setScopes(["read"]); setAll(false); setMeta({ canUseAllCompanies: false, maxLifetimeDays: 90 });
    if (!userId) return;
    let live = true;
    httpClient.get(`/mcp-admin/eligibility/${userId}`).then(r => {
      if (live) { setCompanies(r.data.companies.map(c => ({ companyId: c.id, companyName: c.name }))); setAvailable(r.data.scopesAvailable); setMeta({ canUseAllCompanies: r.data.canUseAllCompanies, maxLifetimeDays: r.data.maxLifetimeDays }); setDays(d => Math.min(Number(d), r.data.maxLifetimeDays)); }
    }).catch(() => live && setError("Could not load that user's companies."));
    return () => { live = false; };
  }, [userId]);

  const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleScope = k => setScopes(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await httpClient.post("/mcp-admin/tokens", { userId: Number(userId), name, companyIds: all ? [] : picked, allCompanies: all, scopes, expiresInDays: Number(days) });
      onCreated(r.data);
    } catch (err) { setError(err.response?.data?.message || "Could not create the token."); }
    finally { setBusy(false); }
  };
  const valid = userId && name.trim() && (all || picked.length > 0);
  // "Runs as user" picker options — same text the old <option>s showed.
  const userOptions = useMemo(() => users.map(u => ({ id: u.id, label: `${u.fullName} (@${u.username})`, username: u.username })), [users]);
  return <div data-admin-backdrop="" style={formStyles.backdrop}>
    <form data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: modalSizes.md }} onSubmit={submit}>
      <div data-admin-header="" style={formStyles.header}>
        <h3 style={formStyles.title}>New agent token</h3>
        <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose /></button>
      </div>
      <div data-admin-body="" style={formStyles.body}>
        <p style={s.sub}>The token acts as one user, only in the companies you tick, and never beyond what that user may do. Every write is shown to a person to approve first.</p>
        <div style={formStyles.formGroup}>
          <label style={formStyles.label}>Agent name</label>
          <input style={formStyles.input} value={name} maxLength={100} placeholder="e.g. Codex on my laptop" onChange={e => setName(e.target.value)} />
        </div>
        <div style={formStyles.formGroup}>
          <label style={formStyles.label}>Runs as user</label>
          <SearchableSelect
            items={userOptions}
            labelKey="label"
            searchKeys={["label", "username"]}
            value={userId}
            onChange={id => setUserId(id === "" ? "" : String(id))}
            placeholder="Choose a dedicated agent user…"
            ariaLabel="Runs as user"
          />
          <p style={s.hint}>The user needs the MCP Access role. The primary admin is allowed and can span every tenant.</p>
        </div>
        <div style={formStyles.formGroup}>
          <label style={formStyles.label}>Companies the agent may reach</label>
          {!userId && <p style={s.hint}>Choose a user first.</p>}
          {userId && meta.canUseAllCompanies && <AllCompaniesOption checked={all} onChange={setAll} />}
          {userId && companies.length === 0 && !all && <p style={s.hint}>That user has no company access yet.</p>}
          {!all && <div style={s.checks}>{companies.map(c => <label key={c.companyId} style={{ ...s.check, ...(picked.includes(c.companyId) ? s.checkOn : {}) }}>
            <input type="checkbox" checked={picked.includes(c.companyId)} onChange={() => toggle(c.companyId)} /> {c.companyName}
          </label>)}</div>}
        </div>
        <div style={formStyles.formGroup}>
          <label style={formStyles.label}>What it may do</label>
          <div style={s.scopes}>{orderedScopes(available).map(k => <label key={k} style={{ ...s.scope, ...(scopes.includes(k) ? s.checkOn : {}) }}>
            <input type="checkbox" checked={scopes.includes(k)} disabled={k === "read"} onChange={() => toggleScope(k)} />
            <span><strong>{SCOPE_INFO[k].label}</strong><span style={s.scopeHelp}>{SCOPE_INFO[k].help}</span></span></label>)}</div>
          {userId && available.length === 1 && <p style={s.hint}>This user has no write access. Assign the MCP Write role to let their agents create records.</p>}
        </div>
        <div style={formStyles.formGroup}>
          <label style={formStyles.label}>Expires after</label>
          <select style={formStyles.input} value={days} onChange={e => setDays(e.target.value)}>
            {[...[7, 30, 60, 90].filter(d => d < meta.maxLifetimeDays), meta.maxLifetimeDays].map(d => [d, d === meta.maxLifetimeDays ? `${d} days (maximum)` : `${d} days`]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
      <div data-admin-footer="" style={formStyles.footer}>
        <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
        <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: valid && !busy ? 1 : 0.55 }} disabled={!valid || busy}>Create token</button>
      </div>
    </form>
  </div>;
}

export function SecretDialog({ created, onClose }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://<your-site>";
  const toml = `[mcp_servers.trader]\nurl = "${origin}/mcp"\nbearer_token_env_var = "TRADER_MCP_TOKEN"`;
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); notify(`${what} copied.`, "success"); } catch { notify("Copy failed. Select the text and copy it by hand.", "error"); } };
  return <div data-admin-backdrop="" style={formStyles.backdrop}>
    <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: modalSizes.md }} role="dialog" aria-label="Agent token created">
      <div data-admin-header="" style={formStyles.header}><h3 style={formStyles.title}>Copy your token now</h3></div>
      <div data-admin-body="" style={formStyles.body}>
        <Alert tone="warn">This is the only time the token is shown. It is stored as a hash and cannot be recovered. If you lose it, revoke it and create another.</Alert>
        <label style={formStyles.label}>Token for “{created.name}”</label>
        <div style={s.secretRow}><code style={s.code}>{created.secret}</code>
          <IconButton label="Copy token" icon={MdContentCopy} style={s.copyBtn} onClick={() => copy(created.secret, "Token")} /></div>
        <label style={{ ...formStyles.label, marginTop: "1rem" }}>Codex: put the token in the environment, then add this to ~/.codex/config.toml</label>
        <div style={s.secretRow}><pre style={{ ...s.code, margin: 0, whiteSpace: "pre-wrap" }}>{toml}</pre>
          <IconButton label="Copy config" icon={MdContentCopy} style={s.copyBtn} onClick={() => copy(toml, "Config")} /></div>
        <p style={s.hint}>Set <code>TRADER_MCP_TOKEN</code> to the token above in your user environment. Expires {absolute(created.expiresAt)}.</p>
      </div>
      <div data-admin-footer="" style={formStyles.footer}><button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.submit }} onClick={onClose}>I have copied it</button></div>
    </div>
  </div>;
}

export default function McpAgentsPanel() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const narrow = useNarrow();
  const enabled = user?.isSeedAdmin === true;
  const reqId = useRef(0);
  const [tokens, setTokens] = useState(null);
  const [tokenError, setTokenError] = useState("");
  const [activity, setActivity] = useState(null);
  const [actError, setActError] = useState("");
  const [outcome, setOutcome] = useState("");
  const [tokenFilter, setTokenFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadTokens = useCallback(async () => {
    try { setTokens((await httpClient.get("/mcp-admin/tokens")).data); setTokenError(""); }
    catch { setTokens(null); setTokenError("Could not load agent tokens."); }
  }, []);
  const loadActivity = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const r = await httpClient.get("/mcp-admin/activity", { params: { page, pageSize: 25, outcome, tokenId: tokenFilter || undefined } });
      if (id === reqId.current) { setActivity(r.data); setActError(""); }
    } catch { if (id === reqId.current) { setActivity(null); setActError("Could not load activity."); } }
  }, [page, outcome, tokenFilter]);

  useEffect(() => { if (enabled) loadTokens(); }, [enabled, loadTokens]);
  useEffect(() => { if (enabled) loadActivity(); }, [enabled, loadActivity]);
  if (!enabled) return null;

  const revoke = async t => {
    const ok = await confirm({
      title: "Revoke this agent token?",
      message: `“${t.name}” (runs as @${t.username}) stops working on its next call. Its activity history is kept.`,
      variant: "danger", confirmText: "Revoke",
    });
    if (!ok) return;
    setBusy(true);
    try { await httpClient.post(`/mcp-admin/tokens/${t.id}/revoke`); notify("Agent token revoked.", "success"); await loadTokens(); await loadActivity(); }
    catch { notify("Could not revoke. Refresh to check its status.", "error"); }
    finally { setBusy(false); }
  };

  const refresh = () => { loadTokens(); loadActivity(); };
  const from = activity && activity.total ? (activity.page - 1) * activity.pageSize + 1 : 0;
  const to = activity ? Math.min(activity.page * activity.pageSize, activity.total) : 0;
  const chips = t => [...(t.allCompanies ? [<span key="all" style={{ ...s.chip, color: "#8a4b00", background: "#fff4e5" }}>All companies</span>] : t.companies.map(c => <span key={`c${c.id}`} style={s.chip}>{c.name}</span>)),
    ...t.scopes.filter(x => x !== "read").map(x => <span key={x} style={{ ...s.chip, color: "#8a4b00", background: "#fff4e5" }}>{x}</span>)];
  const revokeBtn = t => t.status === "Active" && <Button size="sm" variant="danger" icon={MdBlock} disabled={busy} onClick={() => revoke(t)}>Revoke</Button>;

  return <section style={{ minWidth: 0 }} aria-label="AI agents">
    <div style={s.head}>
      <div style={s.headLeft}>
        <span className="k-header__icon k-tone-brand" aria-hidden="true"><MdSmartToy /></span>
        <div style={{ minWidth: 0 }}>
          <h3 style={s.title}>AI agents</h3>
          <p style={{ ...s.sub, marginBottom: 0 }}>Tokens for Codex, Claude and automations connected through MCP, and a permanent record of what they did. Primary admin only.</p>
        </div>
      </div>
      <div style={s.headRight}>
        <IconButton label="Refresh" icon={MdRefresh} onClick={refresh} />
        <Button variant="primary" icon={MdAdd} onClick={() => setShowNew(true)}>New token</Button>
      </div>
    </div>

    <h4 style={s.h4}><MdVpnKey aria-hidden /> Agent tokens</h4>
    {tokenError && <Alert tone="error">{tokenError}</Alert>}
    {!tokens && !tokenError && <Loading>Loading…</Loading>}
    {tokens && tokens.length === 0 && <EmptyState icon={MdVpnKey}>No agent tokens yet. Create one to connect Codex or Claude.</EmptyState>}
    {tokens && tokens.length > 0 && (narrow
      ? <div style={s.cards}>{tokens.map(t => <article key={t.id} className="k-card" style={s.card}>
          <div style={s.cardTop}><div style={{ minWidth: 0 }}><div style={s.strong}>{t.name}</div><div style={s.muted}>@{t.username} · <code>{t.hint}…</code></div></div>
            <Badge tone={TOKEN_TONE[t.status]}>{t.status}</Badge></div>
          <div style={s.chips}>{chips(t)}</div>
          <div style={s.metaGrid}>
            <div><span style={s.metaLabel}>Last used</span><span style={s.metaValue} title={absolute(t.lastUsedAt)}>{relative(t.lastUsedAt)}</span></div>
            <div><span style={s.metaLabel}>Expires</span><span style={s.metaValue}>{absolute(t.expiresAt)}</span></div>
          </div>
          {revokeBtn(t)}
        </article>)}</div>
      : <TableWrap data-admin-table-region=""><table className="k-table">
          <thead><tr>{["Agent", "Runs as", "Companies", "Status", "Last used", "Expires", ""].map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{tokens.map(t => <tr key={t.id}>
            <td style={s.td}><div style={s.strong}>{t.name}</div><div style={s.muted}><code>{t.hint}…</code></div></td>
            <td style={s.td}><div style={s.strong}>{t.fullName}</div><div style={s.muted}>@{t.username}</div></td>
            <td style={s.td}><div style={s.chips}>{chips(t)}</div></td>
            <td style={s.td}><Badge tone={TOKEN_TONE[t.status]}>{t.status}</Badge></td>
            <td style={{ ...s.td, whiteSpace: "nowrap" }} title={absolute(t.lastUsedAt)}>{relative(t.lastUsedAt)}</td>
            <td style={s.td}>{absolute(t.expiresAt)}</td>
            <td style={s.td} className="k-actions">{revokeBtn(t)}</td>
          </tr>)}</tbody>
        </table></TableWrap>)}

    <h4 style={{ ...s.h4, marginTop: "1.6rem" }}><MdHistory aria-hidden /> Activity</h4>
    <Toolbar>
      <div style={s.pills} role="group" aria-label="Outcome">
        {OUTCOMES.map(([k, l]) => <Button key={k || "all"} size="sm" variant={outcome === k ? "primary" : "secondary"} aria-pressed={outcome === k}
          onClick={() => { setPage(1); setOutcome(k); }}>{l}</Button>)}
      </div>
      <SearchableSelect
        items={tokens || []}
        value={tokenFilter}
        onChange={id => { setPage(1); setTokenFilter(id === "" ? "" : String(id)); }}
        placeholder="All agents"
        ariaLabel="Filter by agent"
        style={s.agentFilter}
      />
    </Toolbar>
    {actError && <Alert tone="error">{actError}</Alert>}
    {!activity && !actError && <Loading>Loading…</Loading>}
    {activity && activity.items.length === 0 && <EmptyState icon={MdHistory}>No agent activity matches these filters.</EmptyState>}
    {activity && activity.items.length > 0 && (narrow
      ? <div style={s.cards}>{activity.items.map(a => <article key={a.id} className="k-card" style={s.card}>
          <div style={s.cardTop}><div style={{ minWidth: 0 }}><div style={s.strong}>{a.tool}</div><div style={s.muted}>{a.agentName || "Login session"} · @{a.username}</div></div>
            <Badge tone={OUTCOME_TONE[a.outcome] || OUTCOME_TONE.error}>{(OUTCOME_TONE[a.outcome] || OUTCOME_TONE.error).label}</Badge></div>
          {a.detail && <div style={s.muted}>{a.detail}</div>}
          {a.resultRef && a.resultRef !== "FAILED" && <div><span style={s.chip}>{a.resultRef}</span></div>}
          <div style={s.metaGrid}>
            <div><span style={s.metaLabel}>When</span><span style={s.metaValue} title={absolute(a.at)}>{relative(a.at)}</span></div>
            <div><span style={s.metaLabel}>Company</span><span style={s.metaValue}>{a.companyId ?? "—"}</span></div>
            <div><span style={s.metaLabel}>Time</span><span style={s.metaValue}>{a.durationMs} ms</span></div>
          </div>
          {a.arguments && <details><summary style={s.muted}>Arguments</summary><pre style={s.pre}>{a.arguments}</pre></details>}
        </article>)}</div>
      : <TableWrap data-admin-table-region=""><table className="k-table">
          <thead><tr>{["When", "Agent", "Tool", "Company", "Result", "Details"].map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{activity.items.map(a => <tr key={a.id}>
            <td style={{ ...s.td, whiteSpace: "nowrap" }} title={absolute(a.at)}>{relative(a.at)}</td>
            <td style={s.td}><div style={s.strong}>{a.agentName || "Login session"}</div><div style={s.muted}>@{a.username}</div></td>
            <td style={s.td}><code>{a.tool}</code></td>
            <td style={s.td}>{a.companyId ?? "—"}</td>
            <td style={s.td}><Badge tone={OUTCOME_TONE[a.outcome] || OUTCOME_TONE.error}>{(OUTCOME_TONE[a.outcome] || OUTCOME_TONE.error).label}</Badge></td>
            <td style={s.td}>{a.detail && <div style={s.muted}>{a.detail}</div>}
              {a.resultRef && a.resultRef !== "FAILED" && <div style={{ marginTop: 4 }}><span style={s.chip}>{a.resultRef}</span></div>}
              {a.arguments && <details><summary style={s.muted}>Arguments · {a.durationMs} ms</summary><pre style={s.pre}>{a.arguments}</pre></details>}</td>
          </tr>)}</tbody>
        </table></TableWrap>)}
    {activity && activity.total > 0 && <div style={s.pager}>
      <span style={s.muted}>{from}–{to} of {activity.total}</span>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <IconButton label="Previous page" icon={MdChevronLeft} size={22} disabled={page <= 1} onClick={() => setPage(p => p - 1)} />
        <IconButton label="Next page" icon={MdChevronRight} size={22} disabled={page * activity.pageSize >= activity.total} onClick={() => setPage(p => p + 1)} />
      </div>
    </div>}

    {showNew && <NewTokenDialog onClose={() => setShowNew(false)} onCreated={data => { setShowNew(false); setCreated(data); loadTokens(); }} />}
    {created && <SecretDialog created={created} onClose={() => setCreated(null)} />}
  </section>;
}

const s = {
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.8rem", marginBottom: "var(--k-header-mb)" },
  headLeft: { display: "flex", alignItems: "center", gap: "0.9rem", minWidth: 0, flex: "1 1 320px" },
  headRight: { display: "flex", alignItems: "center", gap: "0.6rem" },
  title: { margin: 0, fontSize: "calc(var(--k-title) - 0.3rem)", fontWeight: 700, color: "var(--k-ink)" },
  h4: { display: "flex", alignItems: "center", gap: "0.4rem", margin: "0 0 0.7rem", fontSize: "calc(var(--k-font) + 0.08rem)", fontWeight: 700, color: "var(--k-ink)" },
  sub: { margin: "0.15rem 0 0.8rem", fontSize: "var(--k-sub)", color: "var(--k-muted)", lineHeight: 1.45 },
  hint: { margin: "0.3rem 0 0", fontSize: "0.78rem", color: "var(--k-muted)" },
  copyBtn: { border: "1px solid var(--k-line-strong)", background: "var(--k-input-bg)", color: "var(--k-blue)" },
  agentFilter: { width: 260, maxWidth: "100%" },
  checks: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.5rem" },
  check: { display: "flex", alignItems: "center", gap: "0.5rem", minHeight: "var(--k-btn-h)", padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "var(--k-input-bg)", fontSize: "var(--k-font)", cursor: "pointer" },
  checkOn: { borderColor: colors.blue, background: "rgba(13,71,161,0.07)" },
  scopes: { display: "grid", gap: "0.5rem" },
  scope: { display: "flex", alignItems: "flex-start", gap: "0.6rem", minHeight: "var(--k-btn-h)", padding: "0.55rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "var(--k-input-bg)", fontSize: "var(--k-font)", cursor: "pointer" },
  scopeHelp: { display: "block", fontSize: "0.76rem", fontWeight: 400, color: "var(--k-muted)", marginTop: 2 },
  secretRow: { display: "flex", alignItems: "flex-start", gap: "0.5rem" },
  code: { flex: 1, minWidth: 0, padding: "0.6rem 0.8rem", borderRadius: 8, background: "#0a1628", color: "#d6e4ff", fontSize: "0.8rem", overflowWrap: "anywhere", userSelect: "all" },
  badge: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.2rem 0.65rem", borderRadius: 999, fontSize: "0.74rem", fontWeight: 700, whiteSpace: "nowrap" },
  dot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block" },
  chips: { display: "flex", flexWrap: "wrap", gap: "0.3rem" },
  chip: { padding: "0.15rem 0.55rem", borderRadius: 6, fontSize: "0.74rem", fontWeight: 600, color: colors.blue, background: "rgba(13,71,161,0.08)" },
  strong: { fontSize: "var(--k-font)", fontWeight: 700, color: "var(--k-ink)", overflowWrap: "break-word" },
  muted: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)", overflowWrap: "anywhere" },
  td: { verticalAlign: "top", paddingTop: "0.6rem", paddingBottom: "0.6rem" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: "0.8rem" },
  card: { marginTop: 0, padding: "var(--k-card-pad)", display: "grid", gap: "0.65rem", minWidth: 0 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.6rem" },
  metaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: "0.5rem 1rem" },
  metaLabel: cardStyles.metaLabel,
  metaValue: cardStyles.metaValue,
  pills: { display: "flex", flexWrap: "wrap", gap: "0.4rem" },
  pre: { margin: "0.4rem 0 0", padding: "0.5rem 0.7rem", borderRadius: 8, background: "var(--k-surface-2)", fontSize: "0.74rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 160, overflow: "auto" },
  pager: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.8rem", marginTop: "1rem" },
};
