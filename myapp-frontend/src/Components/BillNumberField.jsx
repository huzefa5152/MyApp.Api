import { useState, useEffect, useRef, useCallback } from "react";
import { MdCheckCircle, MdErrorOutline, MdRefresh } from "react-icons/md";
import { getNextInvoiceNumber } from "../api/invoiceApi";

// The "Bill / Invoice No." control, shared by BOTH bill-create forms
// (InvoiceForm = from a challan, StandaloneInvoiceForm = without one). One
// component on purpose: the two forms sitting side by side in the same app
// must not be able to disagree about what the next number is, or about which
// hand-typed numbers they accept.
//
// A bill and a tax invoice are the SAME row printed through two templates, so
// there is ONE number here — the Bills list heads this column "Bill #" and the
// Invoices list heads it "Invoice #".
//
// Auto is the default and is what every existing caller got before this
// control existed: the parent holds `number` as "" and sends null, and the
// server allocates MAX + 1 under its per-company lock.
//
// The availability check is ADVISORY. It reads outside that lock, so a number
// that reads free here can still be taken by the time Save is pressed; the
// create path re-checks under the lock and reports a plain message. This exists
// so the operator learns about a clash BEFORE filling in a whole bill.
//
// variant="edit" serves the Edit Bill screen, where the bill already HAS a
// number: no Auto/Custom choice, the box starts on the current number, and
// leaving it alone is always valid. It shares this file rather than growing a
// second control so one set of rules decides what a number may be, wherever it
// is typed. `lockedReason`, when given, renders the number read-only and says
// why — the Edit screen passes it once a bill has gone to FBR.

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  danger: "#dc3545",
  warn: "#e65100",
  ok: "#2e7d32",
};

/**
 * @param {number}   companyId
 * @param {"create"|"edit"} variant
 * @param {"auto"|"custom"} mode            create only
 * @param {(m: "auto"|"custom") => void} onModeChange
 * @param {string}   number          raw text of the number box (controlled)
 * @param {(v: string) => void} onNumberChange
 * @param {(ok: boolean) => void} onValidityChange  false while the entry is unusable
 * @param {number}   currentNumber   edit only: the number the bill already has
 * @param {string}   lockedReason    edit only: renders read-only and explains why
 * @param {boolean}  disabled
 */
export default function BillNumberField({
  companyId,
  variant = "create",
  mode = "auto",
  onModeChange,
  number = "",
  onNumberChange,
  onValidityChange,
  currentNumber,
  lockedReason,
  disabled = false,
}) {
  const isEdit = variant === "edit";
  // On edit there is no Auto: the bill has a number and the box always shows one.
  const effectiveMode = isEdit ? "custom" : mode;
  const [info, setInfo] = useState(null);      // the Auto answer
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [probe, setProbe] = useState(null);    // { available, error, formatted }
  const [probing, setProbing] = useState(false);

  // Guards a slow response for an older keystroke from overwriting a newer one.
  const probeSeq = useRef(0);

  const loadNext = useCallback(async () => {
    // The edit screen never offers "the next number" — it only needs the prefix
    // and the ceiling, which the same call carries.
    if (!companyId) return;
    setLoading(true);
    setLoadError("");
    try {
      const res = await getNextInvoiceNumber(companyId);
      setInfo(res.data);
    } catch {
      setLoadError("Could not read the next bill number.");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadNext(); }, [loadNext]);

  // Debounced availability probe. Only the custom box asks — Auto is resolved
  // server-side at save time and has nothing to check.
  useEffect(() => {
    if (effectiveMode !== "custom" || lockedReason) { setProbe(null); return; }
    const raw = (number || "").trim();
    if (!raw) { setProbe(null); return; }

    const seq = ++probeSeq.current;
    const parsed = Number(raw);
    // Leaving an existing bill on its own number is not a clash with itself.
    // The server excludes the row being renumbered for the same reason; this
    // just keeps the form from flashing a false error before it answers.
    if (isEdit && currentNumber != null && parsed === Number(currentNumber)) {
      setProbe({ available: true, error: "", unchanged: true });
      setProbing(false);
      return;
    }
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setProbe({ available: false, error: "Enter a whole number greater than zero." });
      return;
    }

    setProbing(true);
    const t = setTimeout(async () => {
      try {
        const res = await getNextInvoiceNumber(companyId, parsed);
        if (seq !== probeSeq.current) return;      // a newer keystroke won
        setProbe({
          available: res.data?.checkedAvailable === true,
          error: res.data?.checkedError || "",
          formatted: res.data?.formattedChecked || "",
        });
      } catch {
        if (seq !== probeSeq.current) return;
        // Don't claim the number is taken when we simply couldn't ask — the
        // server re-checks on save, so let the operator through.
        setProbe({ available: true, error: "", unchecked: true });
      } finally {
        if (seq === probeSeq.current) setProbing(false);
      }
    }, 400);

    return () => clearTimeout(t);
  }, [effectiveMode, isEdit, currentNumber, lockedReason, number, companyId]);

  // Report usability upward so the parent can block Save.
  const customUsable =
    lockedReason ? true
      : effectiveMode !== "custom" ? true
        : !!(number || "").trim() && probe?.available === true && !probing;

  useEffect(() => {
    onValidityChange?.(customUsable);
  }, [customUsable, onValidityChange]);

  const startingMissing = info && info.startingNumberSet === false;
  const prefix = info?.prefix || "";

  const segBtn = (active) => ({
    flex: 1,
    minHeight: 44,
    padding: "0.5rem 0.75rem",
    border: `1px solid ${active ? colors.blue : colors.inputBorder}`,
    backgroundColor: active ? colors.blue : "#fff",
    color: active ? "#fff" : colors.textSecondary,
    fontSize: "0.82rem",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  });

  const inputStyle = {
    width: "100%",
    padding: "0.55rem 0.75rem",
    borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`,
    fontSize: "0.9rem",
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div>
      <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary }}>
        Bill / Invoice No.
      </label>

      {isEdit ? null : (
      <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", marginBottom: "0.4rem" }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onModeChange?.("auto")}
          style={{ ...segBtn(mode === "auto"), borderRadius: "8px 0 0 8px", borderRight: "none" }}
          title="Use the next number in this company's sequence"
        >
          Auto
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onModeChange?.("custom")}
          style={{ ...segBtn(mode === "custom"), borderRadius: "0 8px 8px 0" }}
          title="Type the number yourself"
        >
          Custom
        </button>
      </div>
      )}

      {lockedReason ? (
        <>
          <input
            type="text"
            readOnly
            value={currentNumber == null ? "—" : String(currentNumber)}
            style={{ ...inputStyle, backgroundColor: "#eef5ff", cursor: "not-allowed" }}
          />
          <div style={{ fontSize: "0.72rem", color: colors.textSecondary, marginTop: "0.25rem" }}>
            {lockedReason}
          </div>
        </>
      ) : effectiveMode === "auto" ? (
        <>
          <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
            <input
              type="text"
              readOnly
              value={loading ? "…" : info ? String(info.nextNumber) : "—"}
              style={{ ...inputStyle, backgroundColor: "#eef5ff", cursor: "not-allowed" }}
              title="Allocated by the server when the bill is saved"
            />
            <button
              type="button"
              onClick={loadNext}
              disabled={loading || disabled}
              title="Re-read the next number"
              style={{
                display: "grid",
                placeItems: "center",
                width: 44,
                height: 44,
                flexShrink: 0,
                borderRadius: 8,
                border: `1px solid ${colors.inputBorder}`,
                backgroundColor: "#fff",
                color: colors.textSecondary,
                cursor: loading || disabled ? "not-allowed" : "pointer",
              }}
            >
              <MdRefresh size={18} />
            </button>
          </div>
          <div style={{ fontSize: "0.72rem", color: colors.textSecondary, marginTop: "0.25rem" }}>
            {loadError
              ? loadError
              : startingMissing
                ? "Set this company's starting invoice number first."
                : info && prefix
                  ? `Next in sequence · prints as ${info.formattedNext}`
                  : "Next in sequence · final number is allocated on save"}
          </div>
        </>
      ) : (
        <>
          <input
            type="number"
            min={1}
            max={info?.maxAllowed || undefined}
            step={1}
            value={number}
            disabled={disabled}
            onChange={(e) => onNumberChange?.(e.target.value)}
            placeholder={info ? `e.g. ${info.nextNumber}` : "Bill number"}
            style={{
              ...inputStyle,
              borderColor:
                probe && probe.available === false ? colors.danger
                  : probe?.available ? colors.ok
                    : colors.inputBorder,
            }}
          />
          <div style={{ fontSize: "0.72rem", marginTop: "0.25rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
            {!(number || "").trim() ? (
              <span style={{ color: colors.warn }}>Enter a bill number.</span>
            ) : probe?.unchanged ? (
              <span style={{ color: colors.textSecondary }}>Unchanged.</span>
            ) : probing ? (
              <span style={{ color: colors.textSecondary }}>Checking…</span>
            ) : probe && probe.available === false ? (
              <>
                <MdErrorOutline size={13} color={colors.danger} />
                <span style={{ color: colors.danger }}>{probe.error || "That number can't be used."}</span>
              </>
            ) : probe?.available ? (
              <>
                <MdCheckCircle size={13} color={colors.ok} />
                <span style={{ color: colors.ok }}>
                  {probe.unchecked
                    ? "Couldn't verify now — the server checks again on save."
                    : `Available${prefix && probe.formatted ? ` · prints as ${probe.formatted}` : ""}`}
                </span>
              </>
            ) : (
              <span style={{ color: colors.textSecondary }}>&nbsp;</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What the create payload should carry for `invoiceNumber`: null in Auto mode
 * (server allocates), the parsed integer in Custom mode. Exported so both forms
 * build the field the same way.
 */
export function billNumberPayload(mode, number) {
  if (mode !== "custom") return null;
  const parsed = Number((number || "").trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
