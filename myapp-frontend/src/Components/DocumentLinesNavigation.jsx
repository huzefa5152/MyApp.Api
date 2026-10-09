import { createContext, useContext } from "react";
import DocumentLinesLink from "./DocumentLinesLink";
import { usePermissions } from "../contexts/PermissionsContext";
import { lineSources } from "../utils/documentLines";

// The page's document type, for the shortcut in its header.
const DocumentLinesType = createContext(null);

/**
 * Wraps a document list page so its header can offer the Document lines
 * shortcut. It used to render the link on a full-width row above AND below the
 * page; it now lives in the title block (DocumentLinesHeaderLink), where it
 * takes no row of its own.
 */
export default function DocumentLinesNavigation({ type, children }) {
  return <DocumentLinesType.Provider value={type}>{children}</DocumentLinesType.Provider>;
}

/** The shortcut beside the page title. Same permission as before. */
export function DocumentLinesHeaderLink() {
  const type = useContext(DocumentLinesType);
  const { has } = usePermissions();
  if (!type || !has(lineSources[type]?.permission)) return null;
  return <DocumentLinesLink type={type} variant="header" />;
}
