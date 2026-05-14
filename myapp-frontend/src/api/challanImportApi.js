import httpClient from "./httpClient";

// Two-step import: /preview parses the uploaded Excel files against the
// company's Challan template and returns an editable preview grid with no
// DB writes. /commit takes the (possibly user-edited) rows and persists them.

// `sheetName` — optional. When set, overrides the template's pinned sheet
// for this import batch only. Use it when one batch of legacy files holds
// its data on a different sheet than the template's default.
export const previewChallanImport = (companyId, files, sheetName) => {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  if (sheetName) form.append("sheetName", sheetName);
  return httpClient.post(
    `/deliverychallans/company/${companyId}/import-excel/preview`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
};

export const commitChallanImport = (companyId, rows) =>
  httpClient.post(
    `/deliverychallans/company/${companyId}/import-excel/commit`,
    rows
  );
