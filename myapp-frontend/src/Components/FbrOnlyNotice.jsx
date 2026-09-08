import { MdInfoOutline } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { companyHasFbr } from "../config/navVisibility";

/**
 * Shown on an FBR-only screen when the company the operator has selected does
 * not have FBR integration on.
 *
 * The FBR Sandbox and FBR Monitor tabs appear whenever ANY company files with
 * FBR (see config/navVisibility.js), because tabs that come and go as you
 * switch company read as a bug. The cost of that choice is that the operator
 * can reach these screens with a non-FBR company selected — so the screen has
 * to say so plainly, and say which companies it WOULD work for, rather than
 * rendering an empty table that looks broken.
 */
export default function FbrOnlyNotice({ screen = "This screen", companyId = null }) {
  const { selectedCompany, companies, setSelectedCompany } = useCompany();
  // The company this screen is actually about -- the caller's pick when it
  // has its own picker, otherwise the global selection -- resolved against
  // the live list so the message cannot contradict the gate.
  const subjectId = companyId ?? selectedCompany?.id ?? null;
  const subject = (companies || []).find((c) => Number(c?.id) === Number(subjectId)) || null;
  const fbrCompanies = (companies || []).filter((c) => c?.fbrEnabled === true);

  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "flex-start",
      padding: "1rem 1.1rem", margin: "1rem 0",
      background: "#eef4ff", border: "1px solid #cddcf7",
      borderLeft: "3px solid #0d47a1", borderRadius: 9,
      color: "#1a2332", fontSize: 14, maxWidth: 780,
    }}>
      <MdInfoOutline size={20} style={{ color: "#0d47a1", flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {screen} is only for companies with FBR integration enabled.
        </div>
        <div style={{ color: "#5f6d7e" }}>
          {subject
            ? <>FBR integration is off for <strong>{subject.brandName || subject.name}</strong>.</>
            : <>No company is selected.</>}
          {" "}Turn it on under Configuration → Companies, or switch to a company that already files.
        </div>

        {fbrCompanies.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12.5, color: "#5f6d7e", marginBottom: 6 }}>
              {fbrCompanies.length === 1 ? "This company files with FBR:" : "These companies file with FBR:"}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {fbrCompanies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCompany(c)}
                  style={{
                    padding: "0.45rem 0.8rem", minHeight: 36, borderRadius: 8,
                    border: "1px solid #0d47a1", background: "#fff",
                    color: "#0d47a1", fontWeight: 600, fontSize: 13, cursor: "pointer",
                  }}
                >
                  {c.brandName || c.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
