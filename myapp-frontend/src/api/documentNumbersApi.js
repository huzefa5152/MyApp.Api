import httpClient from "./httpClient";

export const getDocumentNumber = (companyId, kind, { divisionId, check, excludeId } = {}) =>
  httpClient.get(`/companies/${companyId}/document-numbers/${kind}`, {
    params: {
      ...(divisionId ? { divisionId } : {}),
      ...(check == null ? {} : { check }),
      ...(excludeId == null ? {} : { excludeId }),
    },
  });
