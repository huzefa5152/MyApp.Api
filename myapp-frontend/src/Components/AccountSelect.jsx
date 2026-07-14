/**
 * AccountSelect — generic Chart-of-Accounts picker.
 *
 * A single reusable GL-account dropdown, grouped so the natural side surfaces
 * first (Income for sales lines, Expense for purchase/COGS lines) with every
 * other account under "Other accounts". Use it anywhere an operator picks a GL
 * account — item-type GL mapping, non-inventory items, per-line bill accounts,
 * and any future accounting screen.
 *
 * The caller fetches the flat account list ONCE (via `getAccountsFlat(companyId)`)
 * and passes it in — the component never fetches, so it's safe to render one per
 * table row without N network calls.
 *
 * Props:
 *   accounts    — AccountDto[] (id, name, code, accountType, …). Caller-filtered
 *                 to active accounts if desired.
 *   value       — selected account id (number | string | null/"")
 *   onChange    — (idOrNull) => void   — receives a number, or null when cleared
 *   side        — "income" | "expense" | null — which account type leads the list
 *   placeholder — text for the empty option (e.g. "Use company default")
 *   disabled, style — passthroughs
 *   unavailable — when true, the empty option reads "(chart of accounts unavailable)"
 *   showType    — append "(AccountType)" to the "Other accounts" rows (default true)
 */
export default function AccountSelect({
  accounts = [],
  value,
  onChange,
  side = null,
  placeholder = "Use company default",
  disabled = false,
  style,
  unavailable = false,
  showType = true,
}) {
  const primaryType = side === "income" ? "Income" : side === "expense" ? "Expense" : null;
  const primary = primaryType ? accounts.filter((a) => a.accountType === primaryType) : [];
  const rest = primaryType ? accounts.filter((a) => a.accountType !== primaryType) : accounts;

  const label = (a) => `${a.code ? `${a.code} — ` : ""}${a.name}`;

  return (
    <select
      style={style}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value ? parseInt(e.target.value, 10) : null)}
    >
      <option value="">{unavailable ? "(chart of accounts unavailable)" : placeholder}</option>
      {primary.length > 0 && (
        <optgroup label={primaryType}>
          {primary.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
        </optgroup>
      )}
      {rest.length > 0 && (
        <optgroup label={primaryType ? "Other accounts" : "Accounts"}>
          {rest.map((a) => (
            <option key={a.id} value={a.id}>
              {label(a)}{primaryType && showType ? ` (${a.accountType})` : ""}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
