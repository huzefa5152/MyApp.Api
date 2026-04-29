import httpClient from "./httpClient";

// Full units list with the AllowsDecimalQuantity flag. Used by the Units
// admin page AND by every form that needs to gate the quantity input
// (decimal vs integer) on the picked UOM.
//
// Server returns:
//   [ { id, name, allowsDecimalQuantity }, ... ]
export const getAllUnits = () => httpClient.get("/units");

// Toggle the AllowsDecimalQuantity flag for one unit. Gated by the
// existing config.units.manage permission server-side.
export const updateUnit = (id, allowsDecimalQuantity) =>
  httpClient.put(`/units/${id}`, { allowsDecimalQuantity });
