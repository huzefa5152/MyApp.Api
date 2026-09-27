import { Link } from "react-router-dom";
import { MdUploadFile } from "react-icons/md";
import { usePermissions } from "../../contexts/PermissionsContext";
import { IMPORT_PERMISSION, importLinkFor, sheetByKey } from "../../utils/onboardingImport";
import { colors } from "../../theme";

// "Import from Excel" on a list page: opens Import Data with only this page's
// sheet chosen. Renders only when the user can run the import AND create this
// kind of record — the same two checks the server makes, so it never leads to
// a sheet the import would refuse.
export default function ImportFromExcelButton({ sheet }) {
  const { has } = usePermissions();
  const meta = sheetByKey(sheet);
  if (!meta || !has(IMPORT_PERMISSION) || !has(meta.permission)) return null;
  return (
    <Link to={importLinkFor(sheet)} style={style} title={`Import ${meta.title.toLowerCase()} from an Excel file`}>
      <MdUploadFile size={18} aria-hidden="true" /> Import from Excel
    </Link>
  );
}

const style = {
  display: "inline-flex", alignItems: "center", gap: "0.4rem", minHeight: 44, padding: "0 1rem",
  borderRadius: 10, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue,
  fontWeight: 600, fontSize: "0.88rem", textDecoration: "none", whiteSpace: "nowrap",
};
