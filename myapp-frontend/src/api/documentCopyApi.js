import httpClient from "./httpClient";

// Copy Document — one endpoint pair serving every copyable document type.
// `type` is the backend vocabulary from Helpers/DocumentCopyTypes.cs:
// SalesQuote | SalesOrder | DeliveryChallan | Invoice | PurchaseBill | GoodsReceipt.
// Note a bill/invoice is "Invoice" here (one entity, two tabs).
export const DOC_COPY_TYPES = {
  salesQuote: "SalesQuote",
  salesOrder: "SalesOrder",
  challan: "DeliveryChallan",
  bill: "Invoice",
  purchaseBill: "PurchaseBill",
  goodsReceipt: "GoodsReceipt",
};

// Where each document type lives, so a cross-document copy can take the
// operator straight to the list holding the new document.
export const DOC_COPY_ROUTES = {
  SalesQuote: "/sales-quotes",
  SalesOrder: "/sales-orders",
  DeliveryChallan: "/challans",
  Invoice: "/bills",
  PurchaseBill: "/purchase-bills",
  GoodsReceipt: "/goods-receipts",
};

// Destinations this document can be copied into, each flagged with whether the
// signed-in user may create it — so the dialog never offers an option that 403s.
export const getCopyTargets = (sourceType, sourceId) =>
  httpClient.get(`/documents/${sourceType}/${sourceId}/copy-targets`);

// The backend allocates the new document number; never send one.
export const copyDocument = (payload) =>
  httpClient.post(`/documents/copy`, payload);
