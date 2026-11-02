// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import InvoiceDocumentView from "./InvoiceDocumentView";
afterEach(cleanup);
it("shows filing values and recorded taxes without editing controls", () => {
  render(<InvoiceDocumentView bill={{clientName:"Sample buyer", gstAmount:18, furtherTaxAmount:4, subtotal:999}} rows={[{description:"Filed supply",quantity:2,uom:"Pcs",valueExclTax:100}]} />);
  expect(screen.getByText("Sample buyer")).toBeTruthy();
  expect(screen.getByRole("table", {name:"Invoice items"})).toBeTruthy();
  expect(screen.getByText("2 Pcs")).toBeTruthy();
  expect(screen.getByText("50.00")).toBeTruthy();
  expect(screen.getByRole("cell", {name:"—"})).toBeTruthy();
  expect(screen.getByText("Rs. 122.00")).toBeTruthy();
  expect(screen.queryByRole("spinbutton")).toBeNull();
});
it("explains stale filing values", () => {
  render(<InvoiceDocumentView bill={{}} rows={[]} requiresReview />);
  expect(screen.getByText(/need review before FBR/)).toBeTruthy();
});

