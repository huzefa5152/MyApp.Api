import { useMemo, useState } from "react";
import ComboBox from "./ComboBox";

/**
 * AccountSelect — the Chart-of-Accounts picker.
 *
 * One searchable GL-account dropdown, grouped by account type (Assets /
 * Liabilities / Equity / Income / Expenses). The `side` hint ("income" /
 * "expense") floats that type's group to the top, so a sales line leads with
 * Income and a purchase line with Expense. Built on ComboBox, so it looks and
 * behaves like every other picker in the app.
 *
 * The CALLER fetches the flat account list once (getAccountsFlat(companyId))
 * and passes it in — this component never fetches, so rendering one per table
 * row costs no extra network calls.
 *
 * Props:
 *   accounts    — AccountDto[] (id, name, code, accountType, accountGroupName…).
 *                 Filter to active accounts in the caller if you want that.
 *   value       — selected account id (number | string | null | "")
 *   onChange    — (idOrNull) => void
 *   side        — "income" | "expense" | null — which type leads the list
 *   placeholder — text for the empty option
 *   disabled, style (layout only) — passthroughs
 *   unavailable — true when the chart could not be loaded, so the empty option
 *                 says so instead of implying the company has no accounts
 */

// Canonical statement order + the label on each group header.
const TYPE_ORDER = ["Asset", "Liability", "Equity", "Income", "Expense"];
const TYPE_LABEL = { Asset: "Assets", Liability: "Liabilities", Equity: "Equity", Income: "Income", Expense: "Expenses" };
const TYPE_COLOR = {
  Asset: { fg: "#0d5c63", bg: "#e0f2f1" },
  Liability: { fg: "#8a5a00", bg: "#fff3cd" },
  Equity: { fg: "#5b3fa3", bg: "#ede7f6" },
  Income: { fg: "#1b5e20", bg: "#e8f5e9" },
  Expense: { fg: "#b3261e", bg: "#fdecea" },
};

const codeChip = { padding: "0.05rem 0.35rem", backgroundColor: "#eef2ff", color: "#0d47a1", fontFamily: "monospace", fontWeight: 700, fontSize: "0.7rem", borderRadius: 3, flexShrink: 0 };

export default function AccountSelect({
  accounts = [],
  value,
  onChange,
  side = null,
  placeholder = "Use company default",
  disabled = false,
  style,
  unavailable = false,
  ariaLabel,
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => accounts.find((a) => String(a.id) === String(value)), [accounts, value]);
  const label = (a) => `${a.code ? `${a.code} — ` : ""}${a.name}`;

  const typeOrder = useMemo(() => {
    const primary = side === "income" ? "Income" : side === "expense" ? "Expense" : null;
    return primary ? [primary, ...TYPE_ORDER.filter((t) => t !== primary)] : TYPE_ORDER;
  }, [side]);

  // Filtered + grouped in the resolved order; a non-standard accountType gets a trailing group.
  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();
    const match = (a) => !term || ["name", "code", "accountGroupName", "accountType"].some((k) => String(a[k] || "").toLowerCase().includes(term));
    const byType = new Map();
    accounts.filter(match).forEach((a) => {
      const t = a.accountType || "Other";
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(a);
    });
    const order = [...typeOrder, ...[...byType.keys()].filter((t) => !typeOrder.includes(t))];
    return order.filter((t) => byType.has(t)).map((t) => {
      const list = byType.get(t).sort((a, b) => (a.code || a.name || "").localeCompare(b.code || b.name || ""));
      return { key: t, label: `${TYPE_LABEL[t] || t} (${list.length})`, groupName: TYPE_LABEL[t] || t, tone: TYPE_COLOR[t] || { fg: "#5f6d7e", bg: "#f1f5f9" }, options: list };
    });
  }, [accounts, query, typeOrder]);

  const groupNameOf = (a) => TYPE_LABEL[a.accountType] || a.accountType || "Other";
  const noneText = unavailable ? "(chart of accounts unavailable)" : placeholder;

  return (
    <ComboBox
      sections={groups}
      query={query}
      onQuery={setQuery}
      getKey={(a) => a.id}
      isCurrent={(a) => String(a.id) === String(value)}
      // NOT nowrap + ellipsis in the list: two operator-named accounts sharing a long prefix
      // would render identically, which is how a posting ends up on the wrong account.
      renderOption={(a) => (
        <span style={{ display: "flex", alignItems: "baseline", gap: "0.6rem" }}>
          <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", overflowWrap: "anywhere" }}>
            {a.code && <span style={codeChip}>{a.code}</span>}
            {a.name}
          </span>
          {/* The account's group, muted on the right — dropped when it repeats the section header. */}
          {a.accountGroupName && a.accountGroupName !== groupNameOf(a) && (
            <span style={{ flexShrink: 0, maxWidth: "45%", overflowWrap: "anywhere", color: "#94a3b8", fontSize: "0.74rem" }}>{a.accountGroupName}</span>
          )}
        </span>
      )}
      onPick={(a) => onChange?.(a ? a.id : null)}
      noneLabel={noneText}
      // The trigger is single-line inside table rows; its title carries the full name.
      triggerTitle={selected ? label(selected) : undefined}
      triggerContent={selected ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%" }}>
          {selected.accountType && (
            <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, backgroundColor: (TYPE_COLOR[selected.accountType] || {}).fg || "#94a3b8" }} />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label(selected)}</span>
        </span>
      ) : <span className="k-combo__placeholder">{noneText}</span>}
      onClear={selected && !disabled ? () => onChange?.(null) : undefined}
      disabled={disabled}
      style={style}
      minPopWidth={260}
      searchPlaceholder="Search account by name, code, group…"
      emptyText={accounts.length === 0 ? "No accounts in the chart yet." : `No accounts match "${query}".`}
      ariaLabel={ariaLabel || "GL account"}
    />
  );
}
