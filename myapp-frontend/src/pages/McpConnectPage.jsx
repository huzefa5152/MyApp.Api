import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MdSmartToy, MdCheckCircle, MdBlock, MdInfo, MdShield } from "react-icons/md";
import httpClient from "../api/httpClient";
import { colors, cardStyles } from "../theme";
import { SCOPE_INFO, orderedScopes } from "../utils/mcpScopes";
import AllCompaniesOption from "../Components/AllCompaniesOption";

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
  if (error && !info) return <div style={wrap}><div role="alert" style={s.alert}><MdBlock /> {error}</div></div>;
  if (!info) return <div style={wrap}><div style={s.card}>Loading…</div></div>;

  return <div style={wrap}>
    <div style={s.card}>
      <div style={s.head}>
        <div style={s.icon}><MdSmartToy style={{ fontSize: "1.5rem", color: "#fff" }} /></div>
        <div>
          <h2 style={s.title}>Connect “{info.clientName}”</h2>
          <p style={s.sub}>wants to connect to your ERP ERP account. It will return to <strong>{info.redirectHost}</strong>.</p>
        </div>
      </div>

      {!info.enabled ? <div style={s.warn}><MdInfo style={s.wi} />
        <div>Purchase this premium feature. Contact your administrator to purchase MCP access. The primary administrator must enable your account before you can connect ChatGPT, Claude or another compatible agent.</div></div>
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
        {error && <div role="alert" style={s.alert}>{error}</div>}
        <p style={s.hint}>Only approve if you just started this from {info.clientName}. Signed in as you; not you? <Link to="/profile">Switch account from your profile</Link>.</p>
        <div style={s.foot}>
          <button style={s.ghost} disabled={busy} onClick={() => send(false)}>Cancel</button>
          <button style={{ ...s.primary, opacity: (all || picked.length) && !busy ? 1 : 0.55 }} disabled={!(all || picked.length) || busy} onClick={() => send(true)}>Approve and connect</button>
        </div>
      </>}
    </div>
  </div>;
}

const btn = { minHeight: 44, padding: "0.5rem 1.2rem", borderRadius: 8, fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" };
const s = {
  card: { ...cardStyles.card, padding: "1.4rem clamp(1rem, 3vw, 1.6rem)" },
  head: { display: "flex", gap: "0.9rem", alignItems: "center", marginBottom: "1rem" },
  icon: { width: 48, height: 48, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})` },
  title: { margin: 0, fontSize: "1.2rem", fontWeight: 700, color: colors.textPrimary, overflowWrap: "anywhere" },
  sub: { margin: "0.25rem 0 0", fontSize: "0.88rem", color: colors.textSecondary, lineHeight: 1.45, overflowWrap: "anywhere" },
  points: { display: "grid", gap: "0.55rem", margin: "0.4rem 0 1rem" },
  point: { display: "flex", gap: "0.55rem", alignItems: "flex-start", fontSize: "0.88rem", lineHeight: 1.45, color: colors.textPrimary },
  pi: { fontSize: "1.2rem", flexShrink: 0, marginTop: 1, color: colors.blue },
  label: { display: "block", margin: "0.4rem 0 0.4rem", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary },
  checks: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.5rem" },
  check: { display: "flex", alignItems: "center", gap: "0.5rem", minHeight: 44, padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, fontSize: "0.88rem", cursor: "pointer" },
  checkOn: { borderColor: colors.blue, background: "rgba(13,71,161,0.07)" },
  scopesBox: { display: "grid", gap: "0.5rem", marginBottom: "0.4rem" },
  scopeHelp: { display: "block", fontSize: "0.76rem", fontWeight: 400, color: colors.textSecondary, marginTop: 2 },
  hint: { margin: "1rem 0 0", fontSize: "0.78rem", color: colors.textSecondary, lineHeight: 1.45 },
  foot: { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "0.6rem", marginTop: "1.1rem" },
  primary: { ...btn, background: colors.blue, color: "#fff", border: "none" },
  ghost: { ...btn, background: "#fff", color: colors.blue, border: `1px solid ${colors.inputBorder}` },
  alert: { display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.8rem 1rem", margin: "0.8rem 0", borderRadius: 8, background: colors.dangerLight, color: "#842029", border: "1px solid #f5c6cb", fontSize: "0.9rem" },
  warn: { display: "flex", gap: "0.7rem", alignItems: "flex-start", padding: "0.9rem 1.1rem", borderRadius: 12, background: "#fff4e5", color: "#8a4b00", border: "1px solid #ffd9a8", fontSize: "0.9rem", lineHeight: 1.45 },
  wi: { fontSize: "1.4rem", flexShrink: 0 },
};
