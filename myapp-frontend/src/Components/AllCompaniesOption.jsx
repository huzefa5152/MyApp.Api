import { MdPublic, MdWarning } from "react-icons/md";
import { colors } from "../theme";

// Primary admin only: connect an AI across EVERY tenant, including ones added later. Shown with a plain
// warning wherever a connection is created, because this is the widest reach the system offers.
export default function AllCompaniesOption({ checked, onChange }) {
  return <div style={{ margin: "0.4rem 0 0.6rem" }}>
    <label style={{ ...box, ...(checked ? on : {}) }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>
        <strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><MdPublic aria-hidden /> All companies (platform-wide)</strong>
        <span style={help}>Every company in every tenant, including tenants added later. Tenant users never get this: they only reach the companies assigned to them.</span>
      </span>
    </label>
    {checked && <div role="note" style={warn}><MdWarning aria-hidden style={{ fontSize: "1.2rem", flexShrink: 0 }} />
      <span>An AI with this reach can read every tenant's data. Keep it read-only unless you need more, keep the lifetime short, and watch the activity log.</span></div>}
  </div>;
}

// Sizes follow the kit tokens so the option matches the surrounding form in every theme.
const box = { display: "flex", alignItems: "flex-start", gap: "0.6rem", minHeight: "var(--k-h)", padding: "0.6rem 0.8rem", borderRadius: "var(--k-radius)", border: `1px solid ${colors.inputBorder}`, background: "var(--k-input-bg)", fontSize: "var(--k-font)", cursor: "pointer" };
const on = { borderColor: "#8a4b00", background: "#fff4e5" };
const help = { display: "block", fontSize: "0.76rem", fontWeight: 400, color: colors.textSecondary, marginTop: 2 };
const warn = { display: "flex", gap: "0.5rem", alignItems: "flex-start", marginTop: "0.5rem", padding: "0.6rem 0.8rem", borderRadius: "var(--k-radius)", background: "#fff3cd", color: "#664d03", border: "1px solid #ffecb5", fontSize: "var(--k-font-sm)", lineHeight: 1.45 };
