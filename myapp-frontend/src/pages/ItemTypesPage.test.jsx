// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ItemTypesPage from "./ItemTypesPage";
import * as api from "../api/itemTypeApi";
const state = vi.hoisted(() => ({ selectedCompany: { id: 1, name: "Company A" }, companies: [], allowed: true, setSelectedCompany: vi.fn() }));
vi.mock("../contexts/CompanyContext", () => ({ useCompany: () => state }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: () => state.allowed }) }));
vi.mock("../Components/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("../Components/onboarding/ImportFromExcelButton", () => ({ default: () => null }));
vi.mock("../Components/ItemTypeForm", () => ({ default: ({ purpose, companyId }) => <div role="dialog">{purpose} for {companyId}</div> }));
vi.mock("../api/itemTypeApi", () => ({ getItemTypes: vi.fn(), updateItemType: vi.fn(), deleteItemType: vi.fn() }));
const rows = [{ id: 1, name: "Commercial category", uom: "Nos" }, { id: 2, name: "Filing classification", hsCode: "3004.9099", uom: "Pack" }];
beforeEach(() => {
  vi.clearAllMocks(); state.selectedCompany = { id: 1, name: "Company A" }; state.companies = [state.selectedCompany]; state.allowed = true;
  api.getItemTypes.mockResolvedValue({ data: rows });
});
afterEach(cleanup);
it("separates bill categories from FBR classifications and creates in the selected context", async () => {
  render(<ItemTypesPage />);
  await screen.findAllByText("Commercial category");
  expect(screen.queryByText("Filing classification")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "FBR classifications (1)" }));
  expect(screen.queryByText("Commercial category")).toBeNull();
  expect(screen.getAllByText("Filing classification").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Add FBR classification" }));
  expect(screen.getByRole("dialog").textContent).toBe("classification for 1");
});
it("a late response from the previous company cannot replace the selected company's catalog", async () => {
  let finish;
  api.getItemTypes.mockImplementation(id => id === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: [{ id: 3, name: "Company B category" }] }));
  const ui = render(<ItemTypesPage />);
  state.selectedCompany = { id: 2, name: "Company B" }; ui.rerender(<ItemTypesPage />);
  await screen.findAllByText("Company B category");
  await act(async () => finish({ data: rows }));
  expect(screen.queryByText("Commercial category")).toBeNull();
  expect(api.getItemTypes).toHaveBeenCalledWith(2);
});
it("bill category creation opens a short category form and respects create permission", async () => {
  const ui = render(<ItemTypesPage />);
  await waitFor(() => expect(api.getItemTypes).toHaveBeenCalledWith(1));
  fireEvent.click(screen.getByRole("button", { name: "Add bill category" }));
  expect(screen.getByRole("dialog").textContent).toBe("bill for 1");
  state.allowed = false; ui.rerender(<ItemTypesPage />);
  expect(screen.queryByRole("button", { name: "Add bill category" })).toBeNull();
});
