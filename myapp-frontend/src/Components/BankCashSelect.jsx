import { useState, useEffect, useRef } from "react";
import { formStyles, colors } from "../theme";
import SearchableSelect from "./SearchableSelect";
import CreateBankCashModal from "./CreateBankCashModal";
import { getBankCashAccounts, getCoaTree } from "../api/accountApi";
import { usePermissions } from "../contexts/PermissionsContext";

const flattenGroups = (nodes) => (nodes || []).flatMap(g => [{ id: g.id, name: g.name }, ...flattenGroups(g.children)]);

export default function BankCashSelect({
  companyId, value, name, onChange, includeAccount = null,
  autoSelectSingle = false, onLoaded, onStatusChange, onCreated,
  label, labelStyle, style, placeholder = "— Select account —",
}) {
  const { has } = usePermissions();
  const canCreate = has("accounting.coa.manage") && has("accounting.coa.view");
  const [accounts, setAccounts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupError, setGroupError] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(false);
  const callbacks = useRef({ onChange, onLoaded, onStatusChange, value, includeAccount });
  callbacks.current = { onChange, onLoaded, onStatusChange, value, includeAccount };
  const companyRef = useRef(companyId);
  companyRef.current = companyId;

  useEffect(() => {
    let cancelled = false;
    setAccounts([]); setStatus("loading"); setCreating(false); setGroupError(""); setLoadingGroups(false);
    callbacks.current.onStatusChange?.("loading");
    getBankCashAccounts(companyId)
      .then(({ data }) => {
        if (cancelled) return;
        const cb = callbacks.current;
        let list = (data || []).map(a => ({ ...a, label: a.name }));
        if (cb.includeAccount?.id && !list.some(a => a.id === cb.includeAccount.id)) {
          list = [{ ...cb.includeAccount, label: cb.includeAccount.name }, ...list];
        }
        setAccounts(list); setStatus("ready"); cb.onLoaded?.(list); cb.onStatusChange?.("ready");
        if (autoSelectSingle && !cb.value && list.length === 1) cb.onChange?.(list[0].id, list[0].name);
      })
      .catch(() => {
        if (!cancelled) { setStatus("error"); callbacks.current.onStatusChange?.("error"); }
      });
    return () => { cancelled = true; };
  }, [companyId, reload, autoSelectSingle]);

  const openCreate = async () => {
    setLoadingGroups(true); setGroupError("");
    const requestedCompany = companyId;
    try {
      const { data } = await getCoaTree(companyId);
      if (companyRef.current !== requestedCompany) return;
      setGroups(flattenGroups(data?.balanceSheet)); setCreating(true);
    } catch {
      if (companyRef.current === requestedCompany) setGroupError("Could not load account groups. Try creating the account again.");
    } finally { if (companyRef.current === requestedCompany) setLoadingGroups(false); }
  };

  const field = <>
    {status === "loading" ? <span role="status">Loading bank/cash accounts…</span> : status === "error" ?
      <div role="alert">Could not load bank/cash accounts. <button type="button" onClick={() => setReload(n => n + 1)}>Retry</button></div> :
      accounts.length > 0 ? <SearchableSelect items={accounts} value={value}
        onChange={(id, acct) => onChange?.(id || null, acct?.name || null)}
        labelKey="label" searchKeys={["name", "code", "label"]} placeholder={placeholder} style={style} /> :
      <><input style={formStyles.input} value={name || ""} onChange={e => onChange?.(null, e.target.value)} placeholder="Bank current account or cash account" />
        <span style={{ display: "block", color: colors.textSecondary, marginTop: 4 }}>No bank/cash accounts configured yet.</span></>}
    {canCreate && <button type="button" style={{ ...formStyles.button, minHeight: 44, marginTop: 8 }}
      disabled={loadingGroups || status === "loading"} onClick={openCreate}>
      {loadingGroups ? "Loading…" : "+ New bank/cash account"}
    </button>}
    {groupError && <div role="alert">{groupError}</div>}
    {creating && canCreate && <CreateBankCashModal companyId={companyId} assetGroups={groups}
      defaultGroupId={accounts[0]?.accountGroupId || groups.find(g => /bank|cash/i.test(g.name))?.id || groups[0]?.id}
      onClose={() => setCreating(false)} onCreated={(keepOpen, account) => {
        if (companyRef.current !== companyId) return;
        const list = [...accounts, { ...account, label: account.name }];
        setAccounts(list); setStatus("ready"); onLoaded?.(list); onStatusChange?.("ready");
        onChange?.(account.id, account.name); onCreated?.(account);
        if (!keepOpen) setCreating(false);
      }} />}
  </>;
  return label ? <div style={formStyles.formGroup}><label style={labelStyle || formStyles.label}>{label}</label>{field}</div> : field;
}
