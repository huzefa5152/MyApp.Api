import httpClient from "./httpClient";

export const parsePdf = (file) => {
  const formData = new FormData();
  formData.append("file", file);
  return httpClient.post("/poimport/parse-pdf", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const parseText = (text) =>
  httpClient.post("/poimport/parse-text", { text });

export const ensureLookups = (descriptions, units) =>
  httpClient.post("/poimport/ensure-lookups", { descriptions, units });
