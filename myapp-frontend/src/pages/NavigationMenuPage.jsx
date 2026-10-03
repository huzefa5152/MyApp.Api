import { useState } from "react";
import { MdMenu, MdFolder, MdLock } from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import FoldersManager from "../Components/FoldersManager";
import { PageHeader, Tabs, EmptyState } from "../ui/Kit";

// Configuration → Navigation Menu. A tabbed config surface; the first tab is
// the Folders document library. Built as a tab strip so future navigation /
// menu configuration tabs slot in alongside Folders without a new route.
const TABS = [
  { key: "folders", label: "Folders", icon: MdFolder, perm: "folders.list.view" },
];

export default function NavigationMenuPage() {
  const { has } = usePermissions();
  const [active, setActive] = useState("folders");

  const visibleTabs = TABS.filter((t) => has(t.perm));
  if (visibleTabs.length === 0) {
    return (
      <EmptyState icon={MdLock} boxed={false}>
        You don't have access to Navigation Menu configuration.
      </EmptyState>
    );
  }
  const activeKey = visibleTabs.some((t) => t.key === active) ? active : visibleTabs[0].key;

  return (
    <div>
      <PageHeader
        icon={MdMenu}
        tone="brand"
        title="Navigation Menu"
        subtitle="Document management & navigation configuration"
      />

      <Tabs
        tabs={visibleTabs.map(({ key, label, icon }) => ({ key, label, icon }))}
        value={activeKey}
        onChange={setActive}
        label="Navigation Menu sections"
        idPrefix="navmenu-tab"
      />

      {activeKey === "folders" && (
        <div role="tabpanel" id="navmenu-tab-panel-folders" aria-labelledby="navmenu-tab-folders">
          <FoldersManager />
        </div>
      )}
    </div>
  );
}
