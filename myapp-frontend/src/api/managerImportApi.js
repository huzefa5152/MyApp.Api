import httpClient from "./httpClient";

// Manager.io → MyApp ETL. Unlike the legacy .bak importer this runs through EF
// against the app's own DB, so it works on the LIVE server too. Upload a .zip
// of the exported JSON (the scripts/pull_details.py output — the folder that
// contains the `detail/` subfolder). Idempotent per ExternalRef; dry-run by
// default. Gated by the accounting.import.manager permission.
export const runManagerImport = ({ file, trialBalance, companyName, companyId, dryRun, fresh, perpetual }) => {
  const form = new FormData();
  form.append("file", file);
  if (trialBalance) form.append("trialBalance", trialBalance);
  if (companyId) form.append("companyId", String(companyId));       // import into existing company
  else form.append("companyName", companyName);                     // or create a new one by name
  form.append("dryRun", dryRun ? "true" : "false");
  form.append("fresh", fresh ? "true" : "false");
  // Full General Ledger (perpetual): build a journal entry per document + true-up
  // so the Chart of Accounts matches Manager with GL posting enabled. Needs the
  // trial balance + a perpetual/ folder in the zip.
  form.append("perpetual", perpetual ? "true" : "false");
  return httpClient.post("/manager-import/run", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 300000, // the ETL can take a while for a full business
  });
};
