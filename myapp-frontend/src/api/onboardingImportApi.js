// Onboarding import — one workbook of customers, items, suppliers and opening
// stock. Preview writes nothing; commit re-sends the same file and the server
// re-reads it, so what was reviewed is what lands.
import httpClient from "./httpClient";

const base = (companyId) => `/onboarding-import/company/${companyId}`;

function form(file, sheets) {
  const f = new FormData();
  f.append("file", file);
  if (sheets) f.append("sheets", sheets);
  return f;
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// A failed blob request carries its JSON error as a Blob; surface its message
// the way every other call does.
async function blobError(err) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      err.response.data = parsed;
      if (!parsed.message && parsed.error) parsed.message = parsed.error;
    } catch { /* not JSON — leave it */ }
  }
  return err;
}

export async function downloadOnboardingSample(companyId, sheets, fileName) {
  try {
    const res = await httpClient.get(`${base(companyId)}/sample`, {
      params: { sheets }, responseType: "blob", timeout: 60000,
    });
    saveBlob(res.data, fileName);
  } catch (err) {
    throw await blobError(err);
  }
}

export async function previewOnboardingImport(companyId, file, sheets) {
  const { data } = await httpClient.post(`${base(companyId)}/preview`, form(file, sheets), {
    headers: { "Content-Type": "multipart/form-data" }, timeout: 120000,
  });
  return data;
}

export async function commitOnboardingImport(companyId, file, sheets) {
  const { data } = await httpClient.post(`${base(companyId)}/commit`, form(file, sheets), {
    headers: { "Content-Type": "multipart/form-data" }, timeout: 300000,
  });
  return data;
}

export async function downloadOnboardingFixList(companyId, file, sheets, fileName) {
  try {
    const res = await httpClient.post(`${base(companyId)}/fix-list`, form(file, sheets), {
      headers: { "Content-Type": "multipart/form-data" }, responseType: "blob", timeout: 120000,
    });
    saveBlob(res.data, fileName);
  } catch (err) {
    throw await blobError(err);
  }
}
