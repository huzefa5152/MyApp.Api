import DocumentLinesLink from "./DocumentLinesLink";
import { usePermissions } from "../contexts/PermissionsContext";
import { lineSources } from "../utils/documentLines";
import useUi2 from "../ui2/useUi2";

// `inline`: the screen places the link itself (redesign), so skip the full-width rows above and below.
// In the compact layout the shortcut appears once, as a slim right-aligned button above the page,
// instead of a 44px row above AND below the screen.
export default function DocumentLinesNavigation({ type, children, inline = false }) {
  const { has } = usePermissions();
  const compact = useUi2();
  if (inline || !has(lineSources[type]?.permission)) return <>{children}</>;
  if (compact) {
    return (
      <>
        <div className="k-doclines"><DocumentLinesLink type={type} className="k-doclines__link" /></div>
        {children}
      </>
    );
  }
  const shortcut = (
    <div style={{ display: "flex", justifyContent: "flex-end", margin: "6px 0" }}>
      <DocumentLinesLink type={type} />
    </div>
  );
  return <>{shortcut}{children}{shortcut}</>;
}
