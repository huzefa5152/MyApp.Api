import http from "./httpClient";
import { collectPagedDocuments, flattenDocumentLines, lineSources } from "../utils/documentLines";

export async function loadDocumentLines(type, companyId, filters = {}) {
  const source = lineSources[type];
  if (!source || !companyId) throw new Error("Choose a company and document type.");
  if (filters.documentId) {
    const { data } = await http.get(`/${source.path}/${filters.documentId}`);
    if (data.companyId !== companyId) throw new Error("Document is outside the selected company.");
    return flattenDocumentLines(type, [data]);
  }
  if (type === "purchaseDebit") {
    const { data } = await http.get(`/${source.path}/company/${companyId}`);
    const term = filters.search?.toLowerCase() || "";
    return flattenDocumentLines(type, (data || []).filter((doc) => {
      const date = doc.date?.slice(0, 10);
      return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to) &&
        (!term || `${doc.debitNoteNumber} ${doc.supplierName} ${doc.supplierRef} ${doc.items?.map((i) => i.description).join(" ")}`.toLowerCase().includes(term));
    }));
  }
  const documents = await collectPagedDocuments(async (page) => {
    const { data } = await http.get(`/${source.path}/company/${companyId}/paged`, {
      params: { page, pageSize: 100, dateFrom: filters.from, dateTo: filters.to,
        search: filters.search || undefined, status: filters.status || undefined,
        salesOrderId: type === "challan" ? filters.salesOrderId || undefined : undefined,
        type: source.typeParam },
    });
    return data;
  });
  return flattenDocumentLines(type, documents);
}
