import httpClient from "./httpClient";

// Two-step import: /preview parses the uploaded Excel files against the
// company's Challan template and returns an editable preview grid with no
// DB writes. /commit takes the (possibly user-edited) rows and persists them.

export const previewChallanImport = (companyId, files) => {
  const form = new FormData();
  for (const f of files) form.append("files", f);
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
