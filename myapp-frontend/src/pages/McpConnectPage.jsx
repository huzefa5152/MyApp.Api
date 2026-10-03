import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MdSmartToy, MdCheckCircle, MdBlock, MdInfo, MdShield } from "react-icons/md";
import httpClient from "../api/httpClient";
import { SCOPE_INFO, orderedScopes } from "../utils/mcpScopes";
import AllCompaniesOption from "../Components/AllCompaniesOption";
import { PageHeader, Card, Button, Alert, Loading } from "../ui/Kit";

// "Sign in to connect": where an AI product (claude.ai, ChatGPT, Codex...) sends a user
// to approve a connection. The user is already signed in to the ERP (the app routes an
// anonymous visitor through the login screen first). Approving mints a token for THIS
// user, limited to the companies they tick; nothing is shared until they press Approve.

export default function McpConnectPage() {
  const [params] = useSearchParams();
  const request = useMemo(() => ({
    clientId: params.get("client_id") || "",
    redirectUri: params.get("redirect_uri") || "",
    state: params.get("state") || "",
    codeChallenge: params.get("code_challenge") || "",
    codeChallengeMethod: params.get("code_challenge_method") || "",
  }), [params]);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState([]);
  const [scopes, setScopes] = useState(["read"]);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    httpClient.get("/oauth/authorize-info", { params: { client_id: request.clientId, redirect_uri: request.redirectUri } })
      .then(r => { if (live) { setInfo(r.data); setPicked(r.data.companies.map(c => c.id)); } })
      .catch(e => live && setError(e.response?.data?.message || "This connection request is not valid. Start again from your AI application."));
    return () => { live = false; };
  }, [request.clientId, request.redirectUri]);

  const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleScope = k => setScopes(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);
  const send = async approve => {
    setBusy(true); setError("");
    try {
      const body = { clientId: request.clientId, redirectUri: request.redirectUri, state: request.state || null,
        codeChallenge: request.codeChallenge, codeChallengeMethod: request.codeChallengeMethod, companyIds: all ? [] : picked, allCompanies: all, scopes };
      const r = await httpClient.post(approve ? "/oauth/authorize" : "/oauth/deny", body);
      window.location.assign(r.data.redirectUrl);
    } catch (e) { setError(e.response?.data?.message || "Could not complete the connection."); setBusy(false); }
  };

  const wrap = { maxWidth: 560, margin: "0 auto" };
  if (error && !info) return <div style={wrap}><Alert tone="error" icon={MdBlock}>{error}</Alert></div>;
  if (!info) return <div style={wrap}><Card><Loading>Loading…</Loading></Card></div>;

  return <div style={wrap}>
    <Card>
      <PageHeader
        icon={MdSmartToy}
        tone="brand"
        title={<span style={{ overflowWrap: "anywhere", minWidth: 0 }}>Connect “{info.clientName}”</span>}
        subtitle={<span style={{ overflowWrap: "anywhere" }}>wants to connect to your Trader ERP account. It will return to <strong>{info.redirectHost}</strong>.</span>}
      />

      {!info.enabled ? <Alert tone="warn" icon={MdInfo}>
        MCP is not enabled for your account. Ask your administrator to give you the MCP Access role, then try again.</Alert>
      : <>
        <div style={s.points}>
          <div style={s.point}><MdShield aria-hidden style={s.pi} /><span>It can <strong>look things up</strong> in the companies you choose below, with the same limits as your own login.{scopes.length === 1 ? " It cannot change anything." : " It can also do the extra things you tick, and each change is shown to you to approve first."}</span></div>
          <div style={s.point}><MdCheckCircle aria-hidden style={s.pi} /><span>Everything it does is recorded under your name, and you can see it in My Profile, MCP &amp; AI.</span></div>
          <div style={s.point}><MdBlock aria-hidden style={s.pi} /><span>You can disconnect it at any time from the same page.</span></div>
        </div>
        {info.scopes.length > 1 && <>
          <label style={s.label}>Also allow</label>
          <div style={s.scopesBox}>{orderedScopes(info.scopes).filter(k => k !== "read").map(k => <label key={k} style={{ ...s.check, ...(scopes.includes(k) ? s.checkOn : {}), alignItems: "flex-start" }}>
            <input type="checkbox" checked={scopes.includes(k)} onChange={() => toggleScope(k)} />
            <span><strong>{SCOPE_INFO[k].label}</strong><span style={s.scopeHelp}>{SCOPE_INFO[k].help}</span></span></label>)}</div>
        </>}
        <label style={s.label}>Companies it may reach</label>
        {info.canUseAllCompanies && <AllCompaniesOption checked={all} onChange={setAll} />}
        {!all && <div style={s.checks}>{info.companies.map(c => <label key={c.id} style={{ ...s.check, ...(picked.includes(c.id) ? s.checkOn : {}) }}>
          <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} /> {c.name}</label>)}</div>}
        {error && <div style={{ marginTop: "0.8rem" }}><Alert tone="error">{error}</Alert></div>}
        <p style={s.hint}>Only approve if you just started this from {info.clientName}. Signed in as you; not you? <Link to="/profile">Switch account from your profile</Link>.</p>
        <div style={s.foot}>
          <Button variant="secondary" disabled={busy} onClick={() => send(false)}>Cancel</Button>
          <Button variant="primary" disabled={!(all || picked.length) || busy} onClick={() => send(true)}>Approve and connect</Button>
        </div>
      </>}
    </Card>
  </div>;
}

const s = {
  points: { display: "grid", gap: "0.55rem", margin: "0.4rem 0 1rem" },
  point: { display: "flex", gap: "0.55rem", alignItems: "flex-start", fontSize: "var(--k-font)", lineHeight: 1.45, color: "var(--k-ink)" },
  pi: { fontSize: "1.2rem", flexShrink: 0, marginTop: 1, color: "var(--k-blue)" },
  label: { display: "block", margin: "0.4rem 0 0.4rem", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--k-muted)" },
  checks: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.5rem" },
  check: { display: "flex", alignItems: "center", gap: "0.5rem", minHeight: "var(--k-btn-h)", padding: "0.4rem 0.8rem", borderRadius: "var(--k-radius)", border: "1px solid var(--k-line-strong)", background: "var(--k-input-bg)", fontSize: "var(--k-font)", color: "var(--k-ink)", cursor: "pointer" },
  checkOn: { borderColor: "var(--k-blue)", background: "rgba(13,71,161,0.07)" },
  scopesBox: { display: "grid", gap: "0.5rem", marginBottom: "0.4rem" },
  scopeHelp: { display: "block", fontSize: "var(--k-font-sm)", fontWeight: 400, color: "var(--k-muted)", marginTop: 2 },
  hint: { margin: "1rem 0 0", fontSize: "var(--k-font-sm)", color: "var(--k-muted)", lineHeight: 1.45 },
  foot: { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "0.6rem", marginTop: "1.1rem" },
};
