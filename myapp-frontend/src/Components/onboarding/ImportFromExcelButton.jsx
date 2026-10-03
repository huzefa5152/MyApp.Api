import { Link } from "react-router-dom";
import { MdUploadFile } from "react-icons/md";
import { usePermissions } from "../../contexts/PermissionsContext";
import { IMPORT_PERMISSION, importLinkFor, sheetByKey } from "../../utils/onboardingImport";

// "Import from Excel" on a list page: opens Import Data with only this page's
// sheet chosen. Renders only when the user can run the import AND create this
// kind of record — the same two checks the server makes, so it never leads to
// a sheet the import would refuse. Styled as the kit's secondary button so it
// sits next to the page's primary "New …" button in every theme.
export default function ImportFromExcelButton({ sheet }) {
  const { has } = usePermissions();
  const meta = sheetByKey(sheet);
  if (!meta || !has(IMPORT_PERMISSION) || !has(meta.permission)) return null;
  return (
    <Link to={importLinkFor(sheet)} className="k-btn k-btn--secondary" title={`Import ${meta.title.toLowerCase()} from an Excel file`}>
      <MdUploadFile size={17} aria-hidden="true" /> Import from Excel
    </Link>
  );
}
