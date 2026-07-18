import { MdRateReview } from "react-icons/md";

/**
 * Parser Feedback — the "did the parser get it right?" question shown on the
 * import Review screen, directly above the Create button. A clear two-option
 * question (not a checkbox) so the intent is unambiguous. Purely presentational
 * and self-contained: it owns no logic beyond raising the chosen value, so the
 * exact same file drops into either branch.
 *
 * Props:
 *   value       — null | "Correct" | "Incorrect" (matches the backend enum names)
 *   onChange(v) — called with "Correct" or "Incorrect"
 *   disabled    — optional; greys the options out
 */
export default function ParserFeedback({ value, onChange, disabled = false }) {
  const option = (val, label) => {
    const active = value === val;
    return (
      <label
        style={{
          ...styles.option,
          ...(active ? styles.optionActive : {}),
          ...(disabled ? styles.optionDisabled : {}),
        }}
      >
        <input
          type="radio"
          name="parser-feedback"
          value={val}
          checked={active}
          disabled={disabled}
          onChange={() => onChange?.(val)}
          style={styles.radio}
        />
        <span>{label}</span>
      </label>
    );
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <MdRateReview size={16} style={{ color: "#0d47a1" }} />
        <span style={styles.title}>Parser Feedback</span>
      </div>
      <div style={styles.question}>Was this Purchase Order imported correctly?</div>
      <div style={styles.options}>
        {option("Correct", "Yes, everything looks correct.")}
        {option("Incorrect", "No, I had to fix parser mistakes.")}
      </div>
      <div style={styles.hint}>Optional — your answer helps us improve the parser. It won&apos;t block creating the document.</div>
    </div>
  );
}

const styles = {
  wrap: {
    marginTop: "1rem",
    padding: "0.85rem 1rem",
    borderTop: "1px solid #e8edf3",
    borderBottom: "1px solid #e8edf3",
    backgroundColor: "#f8f9fb",
    borderRadius: 8,
  },
  header: { display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.3rem" },
  title: { fontWeight: 700, fontSize: "0.9rem", color: "#1a2332" },
  question: { fontSize: "0.88rem", color: "#1a2332", marginBottom: "0.6rem" },
  options: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  option: {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
    padding: "0.5rem 0.7rem",
    border: "1px solid #d0d7e2",
    borderRadius: 8,
    backgroundColor: "#fff",
    fontSize: "0.88rem",
    color: "#1a2332",
    cursor: "pointer",
  },
  optionActive: { borderColor: "#0d47a1", backgroundColor: "#e3f2fd", fontWeight: 600 },
  optionDisabled: { opacity: 0.6, cursor: "not-allowed" },
  radio: { width: 16, height: 16, accentColor: "#0d47a1", cursor: "inherit" },
  hint: { marginTop: "0.5rem", fontSize: "0.76rem", color: "#5f6d7e", fontStyle: "italic" },
};
