import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdExpandMore } from "react-icons/md";
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
  // Groups start collapsed: the catalog is long, and the seed admin works one area at a time.
  const [open, setOpen] = useState(() => new Set());
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

  const searching = search.trim() !== "";
  const allOpen = groups.length > 0 && groups.every(([label]) => open.has(label));
  const accountName = catalog.fullName || catalog.username || "Selected account";
  return <section className="mcp-catalog" aria-label={`AI access for ${accountName}`} aria-busy={saving}>
    <div className="mcp-card">
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
    </div>

    <div className="mcp-catalog-toolbar">
      <label className="mcp-catalog-search">Find an action<input type="search" placeholder="Search actions or groups" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="mcp-toolbar-right">
        <span className="mcp-chip">{catalog.tools.filter(active).length} of {catalog.tools.length} active{dirty ? " after saving" : ""}</span>
        <button type="button" className="mcp-catalog-button" disabled={searching} onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map(([label]) => label)))}>
          {allOpen ? "Collapse all" : "Expand all"}</button>
      </div>
    </div>
    <div className="mcp-accordion">
      {groups.map(([label, tools]) => {
        const changeable = tools.filter(canManage ? canGrantTool : canSelectTool);
        const on = tools.filter(tool => !tool.configurable || (canManage ? draft.grantedTools.has(tool.name) : draft.selectedTools.has(tool.name))).length;
        const allOn = changeable.length > 0 && changeable.every(tool => draft.grantedTools.has(tool.name) && draft.selectedTools.has(tool.name));
        const someOn = changeable.some(tool => draft.grantedTools.has(tool.name) && draft.selectedTools.has(tool.name));
        const expanded = searching || open.has(label);
        const id = `mcp-group-${label.replace(/\W+/g, "-")}`;
        return <article className={`mcp-group ${expanded ? "is-open" : ""}`} key={label}>
          <div className="mcp-group-head">
            <input type="checkbox" aria-label={`Allow every ${label} action`} title={changeable.length ? "Allow or remove every action in this group" : "Nothing to change in this group"}
              checked={allOn} ref={el => { if (el) el.indeterminate = someOn && !allOn; }}
              disabled={saving || conflict || !changeable.length} onChange={() => changeGroup(tools, !allOn)} />
            <button type="button" className="mcp-group-toggle" aria-expanded={expanded} aria-controls={id} disabled={searching}
              onClick={() => setOpen(previous => { const next = new Set(previous); next.has(label) ? next.delete(label) : next.add(label); return next; })}>
              <span className="mcp-group-name">{label}</span>
              <span className={`mcp-group-count ${on === tools.length ? "is-full" : on ? "" : "is-empty"}`}>{on}/{tools.length}</span>
              <MdExpandMore className="mcp-group-chevron" aria-hidden />
            </button>
          </div>
          {expanded && <div className="mcp-group-body" id={id}>{tools.map(tool => {
            const checked = !tool.configurable || (draft.grantedTools.has(tool.name) && draft.selectedTools.has(tool.name));
            const note = !tool.eligible ? "Unavailable with this account’s permissions."
              : canManage && tool.configurable && !tool.grantable ? "Outside your management access." : null;
            return <label className={`mcp-tool ${!tool.eligible ? "is-unavailable" : ""} ${tool.configurable ? "" : "is-fixed"}`} key={tool.name}>
              <input type="checkbox" checked={checked} disabled={!tool.configurable || saving || conflict || !canGrantTool(tool)}
                onChange={event => changeTool(tool, event.target.checked, true)} aria-label={`Allow ${toolLabel(tool)}`} />
              <span className="mcp-tool-text"><span className="mcp-tool-name">{toolLabel(tool)}</span>
                <small>{note || (!tool.configurable ? "Included automatically" : active(tool) ? "Active" : "Inactive")}</small></span>
              <span className={`mcp-catalog-tool-kind ${tool.write ? "is-write" : ""}`}>{tool.write ? "Write" : "Read"}</span>
            </label>;
          })}</div>}
        </article>;
      })}
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
