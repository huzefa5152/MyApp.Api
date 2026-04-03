import httpClient from "./httpClient";

export const getDeliveryChallansByCompany = (companyId) =>
  httpClient.get(`/deliverychallans/company/${companyId}`); // lowercase 'c'

export const createDeliveryChallan = (companyId, payload) =>
  httpClient.post(`/deliverychallans/company/${companyId}`, payload);

export const getDeliveryChallansCount = () =>
  httpClient.get("/deliverychallans/count");
