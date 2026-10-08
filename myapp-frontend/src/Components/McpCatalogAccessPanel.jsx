import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import httpClient from "../api/httpClient";
import { useAuth } from "../contexts/AuthContext";
import "./McpCatalogAccessPanel.css";

const groupLabels = {
  core: "Workspace", discovery: "Workspace", sales: "Sales", purchases: "Purchases",
  inventory: "Inventory", accounting: "Accounting", reports: "Reports",
  templates: "Print designs", onboarding: "Getting started", administration: "Administration",
};
const groupLabel = value => groupLabels[value] || value || "Other actions";
const toolLabel = tool => tool.label || "AI action";
const sorted = values => [...values].sort();
function draftFrom(data) {
  return {
    accessGranted: Boolean(data.accessGranted), writesGranted: Boolean(data.writesGranted),
    accessEnabled: Boolean(data.accessEnabled), writesEnabled: Boolean(data.writesEnabled),
    grantedTools: new Set(data.tools.filter(tool => tool.configurable && tool.granted).map(tool => tool.name)),
    selectedTools: new Set(data.tools.filter(tool => tool.configurable && tool.selected).map(tool => tool.name)),
  };
}
function payloadFrom(data, draft) {
  return { revision: data.revision, accessGranted: draft.accessGranted, writesGranted: draft.writesGranted,
    accessEnabled: draft.accessEnabled, writesEnabled: draft.writesEnabled,
    grantedTools: sorted(draft.grantedTools), selectedTools: sorted(draft.selectedTools) };
}

export default function McpCatalogAccessPanel({ targetUserId, onSaved, onDirtyChange }) {
  const { user } = useAuth();
  const userId = Number(targetUserId ?? user?.id ?? user?.userId);
  const [catalog, setCatalog] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState("");
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true); setError(""); setConflict(false); setSaved(false);
    setCatalog(null); setDraft(null);
    if (!Number.isInteger(userId) || userId <= 0) {
      setLoading(false);
      if (user) setError("Choose an account to manage its AI access.");
      return;
    }
    try {
      const { data } = await httpClient.get(`/mcp/catalog/${userId}`);
      if (current !== requestId.current) return;
      setCatalog(data); setDraft(draftFrom(data));
    } catch (err) {
      if (current !== requestId.current) return;
      setError(err.response?.status === 403 || err.response?.status === 404
        ? "These AI access settings are unavailable for your account."
        : "Could not load AI access settings. Try loading them again.");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [userId, user]);
  useEffect(() => { load(); return () => { requestId.current += 1; }; }, [load]);

  const canManage = Boolean(catalog?.canManageGrants);
  const canSelect = Boolean(catalog?.isSelf || canManage);
  const canGrantTool = tool => canManage && tool.configurable && tool.eligible && tool.grantable;
  const canSelectTool = tool => canSelect && tool.configurable && tool.eligible
    && draft?.grantedTools.has(tool.name) && (catalog?.isSelf || tool.grantable);
  const active = tool => Boolean(draft?.accessGranted && draft?.accessEnabled && tool.eligible
    && (!tool.configurable || (draft.grantedTools.has(tool.name) && draft.selectedTools.has(tool.name)))
    && (!tool.write || (draft.writesGranted && draft.writesEnabled)));
  const dirty = Boolean(catalog && draft && JSON.stringify(payloadFrom(catalog, draft))
    !== JSON.stringify(payloadFrom(catalog, draftFrom(catalog))));

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const groups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const result = new Map();
    for (const tool of catalog?.tools || []) {
      const label = groupLabel(tool.group);
      if (query && !`${label} ${toolLabel(tool)}`.toLocaleLowerCase().includes(query)) continue;
      if (!result.has(label)) result.set(label, []);
      result.get(label).push(tool);
    }
    return [...result].sort(([left], [right]) => left.localeCompare(right));
  }, [catalog, search]);

  const changeFlag = (key, checked) => {
    setSaved(false); setError("");
    setDraft(previous => ({ ...previous, [key]: checked,
      ...(key === "accessGranted" && !checked ? { writesGranted: false } : {}) }));
  };
  const changeTool = (tool, checked, grant = false) => {
    if (grant ? !canGrantTool(tool) : !canSelectTool(tool)) return;
    setSaved(false); setError("");
    setDraft(previous => {
      const grantedTools = new Set(previous.grantedTools);
      const selectedTools = new Set(previous.selectedTools);
      if (grant) {
        if (checked) { grantedTools.add(tool.name); selectedTools.add(tool.name); }
        else { grantedTools.delete(tool.name); selectedTools.delete(tool.name); }
      } else if (checked) selectedTools.add(tool.name);
      else selectedTools.delete(tool.name);
      return { ...previous, grantedTools, selectedTools };
    });
  };
  const changeGroup = (tools, checked) => {
    setSaved(false); setError("");
    setDraft(previous => {
      const grantedTools = new Set(previous.grantedTools);
      const selectedTools = new Set(previous.selectedTools);
      for (const tool of tools) {
        if (canManage) {
          if (!canGrantTool(tool)) continue;
          if (checked) { grantedTools.add(tool.name); selectedTools.add(tool.name); }
          else { grantedTools.delete(tool.name); selectedTools.delete(tool.name); }
        } else {
          if (!canSelectTool(tool)) continue;
          if (checked) selectedTools.add(tool.name);
          else selectedTools.delete(tool.name);
        }
      }
      return { ...previous, grantedTools, selectedTools };
    });
  };

  const save = async () => {
    if (!dirty || saving || conflict) return;
    const current = requestId.current;
    setSaving(true); setError(""); setSaved(false);
    try {
      const { data } = await httpClient.put(`/mcp/catalog/${userId}`, payloadFrom(catalog, draft));
      if (current !== requestId.current) return;
      setCatalog(data); setDraft(draftFrom(data)); setSaved(true);
      onSaved?.(data);
    } catch (err) {
      if (current !== requestId.current) return;
      if (err.response?.status === 409) {
        setConflict(true);
        setError("Access changed while you were editing. Reload the latest settings and review your choices before saving.");
      } else setError(err.response?.status === 403 || err.response?.status === 404
        ? "You can no longer change these settings. Reload to check your access."
        : "Could not save these settings. Your choices are kept here so you can try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="mcp-catalog mcp-catalog-loading" role="status">Loading AI access…</div>;
  if (!catalog || !draft) return <div className="mcp-catalog">
    {error && <p className="mcp-catalog-alert" role="alert">{error}</p>}
    <button type="button" className="mcp-catalog-button" onClick={load}>Load again</button>
  </div>;

  const accountName = catalog.fullName || catalog.username || "Selected account";
  return <section className="mcp-catalog" aria-label={`AI access for ${accountName}`} aria-busy={saving}>
    <div className="mcp-catalog-heading">
      <div><h3>{`MCP access for ${accountName}`}</h3>
        <p className="mcp-catalog-account">{accountName}{catalog.username && catalog.username !== accountName ? ` · ${catalog.username}` : ""}</p></div>
      <span className={`mcp-catalog-badge ${draft.accessGranted && draft.accessEnabled ? "is-active" : ""}`}>
        {draft.accessGranted && draft.accessEnabled ? "On" : "Off"}</span>
    </div>
    <p className="mcp-catalog-help">Choose the actions AI may use for this account. Company access and the account’s existing permissions still apply.</p>
    {catalog.legacy && <p className="mcp-catalog-note">Review the choices below and save to keep an explicit list of AI actions.</p>}
    {!draft.accessGranted && !canManage && <p className="mcp-catalog-note">Purchase this premium feature. Contact your administrator to purchase MCP access; the primary administrator will enable your account.</p>}

    <fieldset className="mcp-catalog-controls" disabled={saving || conflict}>
      <legend>Connection permissions</legend>
      <div className="mcp-catalog-switches">
        <label className="mcp-catalog-toggle"><input type="checkbox" checked={draft.accessGranted && draft.accessEnabled} disabled={!canManage} onChange={event => {
          changeFlag("accessGranted", event.target.checked); changeFlag("accessEnabled", event.target.checked);
        }} /><span><strong>Enable MCP access</strong><small>Allow this user to connect through OAuth using the actions selected below.</small></span></label>
        <label className="mcp-catalog-toggle"><input type="checkbox" checked={draft.writesGranted && draft.writesEnabled} disabled={!canManage || !draft.accessGranted || !draft.accessEnabled} onChange={event => {
          changeFlag("writesGranted", event.target.checked); changeFlag("writesEnabled", event.target.checked);
        }} /><span><strong>Allow changes through MCP</strong><small>Enable write actions. Keep this off for read-only access; changes still require approval.</small></span></label>
      </div>
    </fieldset>

    <div className="mcp-catalog-toolbar">
      <label className="mcp-catalog-search">Find an action<input type="search" placeholder="Search actions or groups" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <p className="mcp-catalog-help">{catalog.tools.filter(active).length} actions active{dirty ? " after saving" : ""}</p>
    </div>
    <div className="mcp-catalog-groups">
      {groups.map(([label, tools]) => <article className="mcp-catalog-group" key={label}>
        <div className="mcp-catalog-group-heading"><h4>{label}</h4>
          <span>{tools.filter(tool => !tool.configurable || (canManage ? draft.grantedTools.has(tool.name) : draft.selectedTools.has(tool.name))).length}/{tools.length}</span></div>
        <div className="mcp-catalog-group-actions" role="group" aria-label={`${label} choices`}>
          <button type="button" className="mcp-catalog-button" disabled={saving || conflict || !tools.some(canManage ? canGrantTool : canSelectTool)} onClick={() => changeGroup(tools, true)}>Allow shown actions</button>
          <button type="button" className="mcp-catalog-button" disabled={saving || conflict || !tools.some(canManage ? canGrantTool : canSelectTool)} onClick={() => changeGroup(tools, false)}>Remove shown actions</button>
        </div>
        <div className="mcp-catalog-tools">{tools.map(tool => <div className={`mcp-catalog-tool ${!tool.eligible ? "is-unavailable" : ""}`} key={tool.name}>
          <div className="mcp-catalog-tool-title"><strong>{toolLabel(tool)}</strong>
            <span className="mcp-catalog-tool-kind">{tool.write ? "Write" : "Read"}</span></div>
          {!tool.configurable ? <small className="mcp-catalog-help">Included automatically</small> : <div className="mcp-catalog-tool-choices">
            <label><input type="checkbox" checked={draft.grantedTools.has(tool.name) && draft.selectedTools.has(tool.name)} disabled={saving || conflict || !canGrantTool(tool)} onChange={event => changeTool(tool, event.target.checked, true)} /><span>Allow action</span></label>
            <small className={active(tool) ? "mcp-catalog-active-text" : "mcp-catalog-help"}>{active(tool) ? "Active" : "Inactive"}</small>
          </div>}
          {!tool.eligible && <small className="mcp-catalog-help">Unavailable with this account’s permissions.</small>}
          {canManage && tool.configurable && tool.eligible && !tool.grantable && <small className="mcp-catalog-help">This action is outside your management access.</small>}
        </div>)}</div>
      </article>)}
    </div>
    {groups.length === 0 && <p className="mcp-catalog-note">No actions match this search.</p>}
    {error && <p className="mcp-catalog-alert" role="alert">{error}</p>}
    {saved && <p className="mcp-catalog-success" role="status">MCP access saved for {accountName} (@{catalog.username}).</p>}
    <div className="mcp-catalog-footer">
      <button type="button" className="mcp-catalog-button" disabled={saving} onClick={load}>{conflict ? "Reload latest settings" : "Reload settings"}</button>
      {canSelect && <button type="button" className="mcp-catalog-button mcp-catalog-primary" disabled={!dirty || saving || conflict} onClick={save}>{saving ? "Saving…" : `Save access for ${accountName}`}</button>}
      {dirty && !conflict && <span className="mcp-catalog-help">Unsaved changes</span>}
    </div>
  </section>;
}
