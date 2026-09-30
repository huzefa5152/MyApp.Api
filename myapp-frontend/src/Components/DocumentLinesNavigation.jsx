import DocumentLinesLink from "./DocumentLinesLink";
import { usePermissions } from "../contexts/PermissionsContext";
import { lineSources } from "../utils/documentLines";

export default function DocumentLinesNavigation({ type, children }) {
  const { has } = usePermissions();
  const shortcut = has(lineSources[type]?.permission) && (
    <div style={{ display: "flex", justifyContent: "flex-end", margin: "6px 0" }}>
      <DocumentLinesLink type={type} />
    </div>
  );
  return <>{shortcut}{children}{shortcut}</>;
}
