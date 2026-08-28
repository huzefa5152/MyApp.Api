import { useEffect, useState } from "react";
import { MdCopyAll, MdInfoOutline, MdCheck } from "react-icons/md";
import { getCopyTargets, copyDocument } from "../api/documentCopyApi";
import { formStyles, modalSizes } from "../theme";
import { todayYmd } from "../utils/dateInput";

const colors = {
  textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3",
  inputBg: "#f8f9fb", inputBorder: "#d0d7e2", danger: "#dc3545", dangerLight: "#fff0f1",
  blue: "#0d47a1", blueLight: "#e3f2fd", teal: "#00897b",
};

/**
 * Copy a document — as another of the same kind, or into the next document in
 * the flow. The destination list, its permission flags and the fixed-behaviour
 * notes all come from the server, so this component never hard-codes which
 * conversions exist.
 *
 * @param {string} sourceType  backend type key (see DOC_COPY_TYPES)
 * @param {number} sourceId
 * @param {string} sourceLabel what to show as the source, e.g. "Bill #1042"
 * @param {function} onClose
 * @param {function} onCopied  (result) => void — result carries the new id/number
 */
export default function CopyDocumentModal({ sourceType, sourceId, sourceLabel, onClose, onCopied }) {
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [destination, setDestination] = useState("");
  const [copyDetails, setCopyDetails] = useState(true);
  const [copyAttachments, setCopyAttachments] = useState(false);
  const [date, setDate] = useState(todayYmd());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getCopyTargets(sourceType, sourceId);
        if (cancelled) return;
        setInfo(data);
        // Same-document copy is the common case, so it is preselected.
        const first = (data.targets || []).find((t) => t.isSameDocument && t.allowed)
          || (data.targets || []).find((t) => t.allowed);
        setDestination(first?.type || "");
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || "Could not load the copy options.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sourceType, sourceId]);

  const selected = (info?.targets || []).find((t) => t.type === destination);
  const canSubmit = !!selected?.allowed && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await copyDocument({
        sourceType,
        sourceId,
        destinationType: destination,
        // Every document in the system needs at least one line, so lines are
        // always copied — the server rejects the alternative outright.
        copyLineItems: true,
        copyDocumentDetails: copyDetails,
        copyAttachments,
        date: date ? new Date(date).toISOString() : null,
      });
      onCopied?.(data);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Could not copy the document.");
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px`, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            <MdCopyAll size={17} style={{ verticalAlign: "-3px", marginRight: 6 }} />
            Copy Document
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <div style={formStyles.body}>
          {error && <div style={s.err}>{error}</div>}

          {loading ? (
            <p style={s.sub}>Loading copy options…</p>
          ) : !info ? null : (
            <>
              <div style={s.sourceBox}>
                <span style={s.sourceLabel}>Source</span>
                <span style={s.sourceValue}>
                  {sourceLabel || `${info.sourceTypeLabel} #${info.sourceNumber}`}
                </span>
              </div>

              <div style={s.section}>
                <div style={s.sectionTitle}>Copy as</div>
                {(info.targets || []).map((t) => (
                  <label
                    key={t.type}
                    style={{ ...s.option, ...(t.allowed ? null : s.optionDisabled), ...(destination === t.type ? s.optionActive : null) }}
                    title={t.allowed ? undefined : t.reason || ""}
                  >
                    <input
                      type="radio"
                      name="copy-destination"
                      value={t.type}
                      checked={destination === t.type}
                      disabled={!t.allowed}
                      onChange={() => setDestination(t.type)}
                      style={s.radio}
                    />
                    <span style={{ minWidth: 0 }}>
                      <span style={s.optionLabel}>
                        {t.label}
                        {t.isSameDocument && <span style={s.badge}>same document</span>}
                      </span>
                      {!t.allowed && <span style={s.optionNote}>{t.reason}</span>}
                      {t.allowed && t.fixedBehaviourNote && (
                        <span style={s.optionNote}>
                          <MdInfoOutline size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                          {t.fixedBehaviourNote}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>

              <div style={s.section}>
                <div style={s.sectionTitle}>Information to copy</div>

                {/* Deliberately NOT a checkbox: every document in this system
                    needs at least one line, so there is no choice to offer. A
                    disabled, permanently-ticked control would advertise one.
                    Stated as a plain row so the operator still sees that lines
                    come across. */}
                <div style={s.fixedRow}>
                  <MdCheck size={16} style={s.fixedTick} />
                  <span>
                    <span style={s.checkLabel}>Line items</span>
                    <span style={s.optionNote}>Always copied — a document can't be saved without lines.</span>
                  </span>
                </div>

                <label style={s.check}>
                  <input type="checkbox" checked={copyDetails} onChange={(e) => setCopyDetails(e.target.checked)} style={s.checkbox} />
                  <span>
                    <span style={s.checkLabel}>Document details</span>
                    <span style={s.optionNote}>Reference numbers, terms, site and notes. The party, division and tax settings always come across.</span>
                  </span>
                </label>

                {info.attachmentCount > 0 && (
                  <label style={s.check}>
                    <input type="checkbox" checked={copyAttachments} onChange={(e) => setCopyAttachments(e.target.checked)} style={s.checkbox} />
                    <span>
                      <span style={s.checkLabel}>Attachments ({info.attachmentCount})</span>
                      <span style={s.optionNote}>Each file is duplicated, so removing one copy leaves the other intact.</span>
                    </span>
                  </label>
                )}
              </div>

              <div style={s.section}>
                <div style={s.sectionTitle}>New document date</div>
                <input type="date" style={s.input} value={date} onChange={(e) => setDate(e.target.value)} />
                <span style={s.optionNote}>The number is allocated by the system when the copy is created.</span>
              </div>
            </>
          )}
        </div>

        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.submit, opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? "pointer" : "not-allowed" }}
            disabled={!canSubmit}
            onClick={submit}
          >
            {saving ? <span className="btn-spinner" /> : <MdCopyAll size={15} />}
            {saving ? " Copying…" : " Copy Document"}
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  sub: { fontSize: "0.85rem", color: colors.textSecondary },
  err: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, fontSize: "0.85rem" },
  sourceBox: { display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap", padding: "0.6rem 0.8rem", borderRadius: 8, backgroundColor: colors.blueLight, marginBottom: "1.1rem" },
  sourceLabel: { fontSize: "0.7rem", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.03em", color: colors.blue },
  sourceValue: { fontSize: "0.92rem", fontWeight: 700, color: colors.textPrimary },
  section: { marginBottom: "1.1rem" },
  sectionTitle: { fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.03em", color: colors.textSecondary, marginBottom: "0.5rem" },
  option: { display: "flex", gap: "0.6rem", alignItems: "flex-start", padding: "0.6rem 0.7rem", border: `1px solid ${colors.cardBorder}`, borderRadius: 8, marginBottom: "0.4rem", cursor: "pointer", minHeight: 44 },
  optionActive: { borderColor: colors.blue, backgroundColor: colors.blueLight },
  optionDisabled: { opacity: 0.55, cursor: "not-allowed" },
  optionLabel: { display: "block", fontSize: "0.9rem", fontWeight: 600, color: colors.textPrimary },
  optionNote: { display: "block", fontSize: "0.76rem", color: colors.textSecondary, marginTop: "0.15rem", lineHeight: 1.35 },
  badge: { marginLeft: 8, fontSize: "0.66rem", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.03em", color: colors.teal },
  radio: { marginTop: 3, width: 16, height: 16, flexShrink: 0 },
  check: { display: "flex", gap: "0.6rem", alignItems: "flex-start", padding: "0.5rem 0.2rem", cursor: "pointer", minHeight: 44 },
  fixedRow: { display: "flex", gap: "0.6rem", alignItems: "flex-start", padding: "0.5rem 0.2rem" },
  fixedTick: { marginTop: 2, flexShrink: 0, color: colors.teal },
  checkbox: { marginTop: 3, width: 16, height: 16, flexShrink: 0 },
  checkLabel: { display: "block", fontSize: "0.9rem", fontWeight: 600, color: colors.textPrimary },
  input: { width: "100%", maxWidth: 220, padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
};
