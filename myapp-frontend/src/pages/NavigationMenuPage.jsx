import { useState } from "react";
import { MdMenu, MdFolder, MdLock } from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import FoldersManager from "../Components/FoldersManager";

const colors = { blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3" };

// Configuration → Navigation Menu. A tabbed config surface; the first tab is
// the Folders document library. Built as a tab strip so future navigation /
// menu configuration tabs slot in alongside Folders without a new route.
const TABS = [
  { key: "folders", label: "Folders", Icon: MdFolder, perm: "folders.list.view" },
];

export default function NavigationMenuPage() {
  const { has } = usePermissions();
  const [active, setActive] = useState("folders");

  const visibleTabs = TABS.filter((t) => has(t.perm));
  if (visibleTabs.length === 0) {
    return (
      <div style={st.denied}>
        <MdLock size={40} color={colors.cardBorder} />
        <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>You don't have access to Navigation Menu configuration.</p>
      </div>
    );
  }
  const activeKey = visibleTabs.some((t) => t.key === active) ? active : visibleTabs[0].key;

  return (
    <div>
      <div style={st.header}>
        <div style={st.icon}><MdMenu size={26} color="#fff" /></div>
        <div>
          <h2 style={st.title}>Navigation Menu</h2>
          <p style={st.subtitle}>Document management &amp; navigation configuration</p>
        </div>
      </div>

      <div style={st.tabs}>
        {visibleTabs.map((t) => {
          const on = t.key === activeKey;
          return (
            <button key={t.key} onClick={() => setActive(t.key)} style={{ ...st.tab, ...(on ? st.tabActive : null) }}>
              <t.Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {activeKey === "folders" && <FoldersManager />}
    </div>
  );
}

const st = {
  header: { display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.25rem" },
  icon: { width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, display: "grid", placeItems: "center", flexShrink: 0 },
  title: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  subtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  tabs: { display: "flex", gap: "0.4rem", borderBottom: `1px solid ${colors.cardBorder}`, marginBottom: "1.25rem", flexWrap: "wrap" },
  tab: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.6rem 1.1rem", border: "none", background: "transparent", color: colors.textSecondary, fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", borderBottom: "3px solid transparent", marginBottom: -1 },
  tabActive: { color: colors.blue, borderBottom: `3px solid ${colors.blue}` },
  denied: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", textAlign: "center" },
};
