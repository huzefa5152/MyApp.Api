// Helpers for naming the GL account a document line will post to.
//
// Used by the bill / purchase-bill forms to SHOW which Chart-of-Accounts
// account a line's amount lands in when an item type is picked. The item-type
// overlay carries an explicit account; when it doesn't, the line falls back to
// the company's default sales/purchase account (PostingService resolution
// order) — these helpers name that fallback so the operator always sees the
// target account, not a bare "— default —".

/** "code — name" for the account with `accountId`, or null when not found. */
export function findAccountLabel(accounts, accountId) {
  if (accountId == null || accountId === "") return null;
  const a = (accounts || []).find((x) => String(x.id) === String(accountId));
  if (!a) return null;
  return `${a.code ? `${a.code} — ` : ""}${a.name}`;
}

/**
 * Placeholder for the per-line Account picker when the line carries no explicit
 * account — names the resolved company-default account (e.g. "→ 4000 — Sales")
 * so the operator sees where the amount will land. Falls back to a generic
 * label when the default isn't configured (enabling GL pins it, so that's rare).
 */
export function defaultAccountPlaceholder(accounts, defaultAccountId) {
  const label = findAccountLabel(accounts, defaultAccountId);
  return label ? `→ ${label}` : "— company default —";
}
