import http from "./httpClient";

// ─────────────────────────────────────────────────────────────────────────────
// Bulk client import: sample sheet → upload → preview → commit.
//
// The preview step writes nothing; the operator sees a per-row verdict first.
// companyId always travels as a query/body field, never as a column in the
// uploaded file, so a sheet can't target another tenant.
// ─────────────────────────────────────────────────────────────────────────────

/** Sample CSV as a Blob, ready to hand to a download. */
export const downloadClientImportTemplate = () =>
  http.get("/clients/import/template", { responseType: "blob" });

/** Parse the sheet and classify every row (New / Duplicate / Error). No writes. */
export const previewClientImport = (companyId, file) => {
  const form = new FormData();
  form.append("file", file);
  return http.post("/clients/import/preview", form, {
    params: { companyId },
    headers: { "Content-Type": "multipart/form-data" },
  });
};

/** Create the confirmed rows. Duplicates are skipped unless includeDuplicates. */
export const commitClientImport = (companyId, rows, includeDuplicates = false) =>
  http.post("/clients/import/commit", { companyId, rows, includeDuplicates });
