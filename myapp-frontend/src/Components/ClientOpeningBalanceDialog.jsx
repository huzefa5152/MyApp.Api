import { useEffect, useState } from "react";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import { getClientOpeningBalance, setClientOpeningBalance } from "../api/customerLedgerApi";
import { notify } from "../utils/notify";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * What a customer owed (or had paid ahead) when their books started here.
 * The server keeps ONE opening document per client, so saving replaces the
 * earlier figure and "Remove" clears it. It shows on the customer's ledger,
 * statement and A/R, and posts against Retained earnings -- never Sales.
 */
export default function ClientOpeningBalanceDialog({ companyId, client, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(null);
  const [side, setSide] = useState("owes");   // "owes" | "advance"
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());

  useEffect(() => {
    let cancelled = false;
    getClientOpeningBalance(companyId, client.id)
      .then(({ data }) => {
        if (cancelled) return;
        setCurrent(data);
        if (data.amount) {
          setSide(data.amount < 0 ? "advance" : "owes");
          setAmount(String(Math.abs(data.amount)));
          setDate(String(data.date).slice(0, 10));
        }
      })
      .catch(() => !cancelled && setError("Could not load the opening balance."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [companyId, client.id]);

  const save = async (signed) => {
    setSaving(true);
    setError("");
    try {
      await setClientOpeningBalance(companyId, client.id, { amount: signed, date });
      notify(signed === 0 ? "Opening balance removed." : "Opening balance saved.", "success");
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e?.response?.data?.error || "Could not save the opening balance.");
    } finally {
      setSaving(false);
    }
  };

  const value = Number(amount);
  const valid = amount !== "" && Number.isFinite(value) && value > 0 && !!date;
  const settled = Number(current?.amountSettled || 0);

  return (
    <div style={formStyles.backdrop} onClick={() => !saving && onClose()}>
      <div style={{ ...formStyles.modal, maxWidth: modalSizes.sm }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>Opening balance</h3>
          <button type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose /></button>
        </div>

        <div style={formStyles.body}>
          <div style={s.client}>{client.name}</div>
          {error && <div style={formStyles.error}>{error}</div>}

          {loading ? (
            <div style={s.muted}>Loading…</div>
          ) : (
            <>
              <div style={formStyles.formGroup}>
                <span style={formStyles.label}>The customer…</span>
                <div style={s.toggle} role="radiogroup">
                  {[["owes", "Owes us"], ["advance", "Paid us ahead"]].map(([k, label]) => (
                    <button key={k} type="button" role="radio" aria-checked={side === k}
                      style={{ ...s.toggleBtn, ...(side === k ? s.toggleOn : null) }}
                      onClick={() => setSide(k)}>{label}</button>
                  ))}
                </div>
              </div>

              <div style={formStyles.formGroup}>
                <label style={formStyles.label} htmlFor="ob-amount">Amount (Rs)</label>
                <input id="ob-amount" type="number" min="0" step="0.01" inputMode="decimal" style={formStyles.input}
                  value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
              </div>

              <div style={formStyles.formGroup}>
                <label style={formStyles.label} htmlFor="ob-date">As at</label>
                <input id="ob-date" type="date" style={formStyles.input} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>

              <div style={s.muted}>
                {current?.amount
                  ? `Currently ${current.amount < 0 ? "paid ahead" : "owes"} Rs ${fmt(Math.abs(current.amount))}. Saving replaces it.`
                  : "Brought forward from the old books. It is not a sale and is never sent to FBR."}
                {settled > 0 && ` Receipts of Rs ${fmt(settled)} are already applied to it, so it cannot go below that.`}
              </div>
            </>
          )}
        </div>

        <div style={formStyles.footer}>
          {!!current?.amount && (
            <button type="button" style={{ ...formStyles.button, ...s.remove }} disabled={saving || settled > 0}
              title={settled > 0 ? "Receipts are applied to it" : undefined} onClick={() => save(0)}>Remove</button>
          )}
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...formStyles.button, ...formStyles.submit, opacity: valid && !saving ? 1 : 0.6 }}
            disabled={!valid || saving || loading} onClick={() => save(side === "advance" ? -value : value)}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  client: { fontWeight: 700, color: colors.textPrimary, marginBottom: "0.85rem", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  muted: { fontSize: "0.8rem", color: colors.textSecondary, lineHeight: 1.45 },
  toggle: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" },
  toggleBtn: { minHeight: 44, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, color: colors.textSecondary, fontWeight: 600, cursor: "pointer" },
  toggleOn: { borderColor: colors.blue, background: `${colors.blue}12`, color: colors.blue },
  remove: { backgroundColor: colors.dangerLight, color: colors.danger, marginRight: "auto" },
};
