// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AuthContext from "../contexts/AuthContext";
import CompanyForm from "./CompanyForm";
import { createCompany } from "../api/companyApi";

vi.mock("../api/companyApi", () => ({ createCompany: vi.fn(async () => ({ data: { id: 1 } })), updateCompany: vi.fn(), uploadCompanyLogo: vi.fn(), getCompanyById: vi.fn() }));
vi.mock("../api/fbrLookupApi", () => ({ getFbrLookupsByCategory: vi.fn(async () => ({ data: [] })) }));
vi.mock("../api/printTemplateApi", () => ({ seedDefaultTemplates: vi.fn(async () => ({})) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const mount = (seed) => render(<AuthContext.Provider value={{ user: { isSeedAdmin: seed } }}><CompanyForm onClose={() => {}} onSaved={() => {}} /></AuthContext.Provider>);

it("shows both default-off choices only to the seed administrator", () => {
    mount(true);
    expect(screen.getByRole("checkbox", { name: "Print original bill lines on tax invoices" }).checked).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Send blank FBR product descriptions" }).checked).toBe(false);
});
it("does not offer policy configuration to an ordinary company administrator", () => {
    mount(false);
    expect(screen.queryByRole("checkbox", { name: "Print original bill lines on tax invoices" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Send blank FBR product descriptions" })).toBeNull();
});
it("hides the unused layout choice and restores its saved selection when switched off", () => {
    mount(true);
    const layout = () => screen.queryByRole("combobox", { name: "Default Sales Tax Invoice layout" });
    expect(layout().value).toBe("individual");
    fireEvent.change(layout(), { target: { value: "grouped" } });
    const originalLines = screen.getByRole("checkbox", { name: "Print original bill lines on tax invoices" });
    fireEvent.click(originalLines);
    expect(layout()).toBeNull();
    expect(screen.queryByText(/Default for new bills only/)).toBeNull();
    fireEvent.click(originalLines);
    expect(layout().value).toBe("grouped");
});
it("saves the explicit seed administrator choices", async () => {
    const view = mount(true);
    fireEvent.change(view.container.querySelector('input[name="name"]'), { target: { value: "Synthetic company" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Print original bill lines on tax invoices" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Send blank FBR product descriptions" }));
    fireEvent.click(screen.getByRole("button", { name: "Create", exact: true }));
    await waitFor(() => expect(createCompany).toHaveBeenCalled());
    expect(createCompany.mock.calls[0][0]).toMatchObject({ taxInvoiceUseOriginalBillLines: true, fbrOmitProductDescription: true });
});
