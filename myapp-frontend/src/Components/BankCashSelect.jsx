import { useState, useEffect } from "react";
import { formStyles, colors } from "../theme";
import SearchableSelect from "./SearchableSelect";
import { getBankCashAccounts } from "../api/accountApi";

/**
 * Reusable "Received in / Paid from" bank-or-cash account picker. Loads the
 * company's bank/cash accounts and renders them in the standard searchable
 * dropdown ([SearchableSelect]) so a long list (e.g. 30 bank accounts) can be
 * typed-to-filter. Falls back to a free-text box only when the company has no
 * bank/cash accounts yet.
 *
 * Props:
 *   companyId
 *   value            — selected account id ("" when none)
 *   name             — current account name (free-text fallback value / display)
 *   onChange(id,name)— id is null for the free-text fallback / cleared
 *   includeAccount   — {id, name} to guarantee an out-of-list account stays
 *                      selectable (used on edit so a payment's current account
 *                      is never dropped)
 *   autoSelectSingle — auto-pick the only account (create flow)
 *   onLoaded(list)   — fired once with the loaded accounts (parent uses the
 *                      count to decide whether the field is mandatory)
 *   label, labelStyle, style, placeholder
 */
export default function BankCashSelect({
  companyId, value, name, onChange, includeAccount = null,
  autoSelectSingle = false, onLoaded, label, labelStyle, style,
  placeholder = "— Select account —",
}) {
  const [accounts, setAccounts] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getBankCashAccounts(companyId)
      .then(({ data }) => {
        if (cancelled) return;
        // Display the account NAME only (no GL code). Code is still searchable.
        let list = (data || []).map((a) => ({ ...a, label: a.name }));
        if (includeAccount?.id && !list.some((a) => a.id === includeAccount.id)) {
          list = [{ id: includeAccount.id, name: includeAccount.name, label: includeAccount.name }, ...list];
        }
        setAccounts(list);
        onLoaded?.(list);
        if (autoSelectSingle && !value && list.length === 1) onChange?.(list[0].id, list[0].name);
      })
      .catch(() => { if (!cancelled) { setAccounts([]); onLoaded?.([]); } })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const field = accounts.length > 0 ? (
    <SearchableSelect
      items={accounts}
      value={value}
      onChange={(id, acct) => onChange?.(id || null, acct ? acct.name : null)}
      labelKey="label"
      searchKeys={["name", "code", "label"]}
      placeholder={placeholder}
      style={style}
    />
  ) : (
    <>
      <input
        style={formStyles.input}
        value={name || ""}
        onChange={(e) => onChange?.(null, e.target.value)}
        placeholder="e.g. Meezan A/C 1234, Cash"
      />
      {loaded && (
        <span style={{ fontSize: "0.72rem", color: colors.textSecondary, marginTop: 4, display: "block" }}>
          Add Bank &amp; Cash accounts in Chart of Accounts to pick from a list.
        </span>
      )}
    </>
  );

  if (!label) return field;
  return (
    <div style={formStyles.formGroup}>
      <label style={labelStyle || formStyles.label}>{label}</label>
      {field}
    </div>
  );
}
