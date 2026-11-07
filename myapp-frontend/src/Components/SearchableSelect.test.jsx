// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import SearchableSelect from "./SearchableSelect";

let granted = true;
vi.mock("../contexts/PermissionsContext", () => ({
  usePermissions: () => ({ has: () => granted }),
}));
vi.mock("../contexts/CompanyContext", () => ({
  useCompany: () => ({ companies: [{ id: 5, fbrEnabled: false }] }),
}));
vi.mock("./ClientForm", () => ({
  default: ({ companyId, fbrEnabled, onSaved, onClose }) => (
    <form
      aria-label="client form"
      data-company={companyId}
      data-fbr={String(fbrEnabled)}
      onSubmit={(e) => {
        e.preventDefault();
        onSaved({ id: 9, name: "New Buyer" });
        onClose();
      }}
    >
      <button type="submit">Save client</button>
    </form>
  ),
}));
vi.mock("./SupplierForm", () => ({ default: () => <p>supplier form</p> }));

afterEach(() => {
  cleanup();
  granted = true;
});

function Picker(props) {
  const [value, setValue] = useState("");
  return (
    <SearchableSelect
      items={[{ id: 1, name: "Old Buyer" }]}
      value={value}
      onChange={setValue}
      placeholder="Pick"
      {...props}
    />
  );
}

describe("SearchableSelect quickCreate", () => {
  it("shows no shortcut on a filter that does not ask for one", () => {
    render(<Picker />);
    expect(screen.queryByRole("button", { name: "New client" })).toBeNull();
  });

  it("hides the shortcut without the create permission, without a company, and when disabled", () => {
    granted = false;
    const { rerender } = render(<Picker quickCreate="client" companyId={5} />);
    expect(screen.queryByRole("button", { name: "New client" })).toBeNull();
    granted = true;
    rerender(<Picker quickCreate="client" />);
    expect(screen.queryByRole("button", { name: "New client" })).toBeNull();
    rerender(<Picker quickCreate="client" companyId={5} disabled />);
    expect(screen.queryByRole("button", { name: "New client" })).toBeNull();
  });

  it("creates in the given company, selects the new record and does not submit the parent form", () => {
    const parentSubmit = vi.fn((e) => e.preventDefault());
    const onCreated = vi.fn();
    render(
      <form onSubmit={parentSubmit}>
        <Picker quickCreate="client" companyId={5} onCreated={onCreated} />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "New client" }));
    const form = screen.getByRole("form", { name: "client form" });
    expect(form.dataset.company).toBe("5");
    expect(form.dataset.fbr).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save client" }));
    expect(parentSubmit).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith({ id: 9, name: "New Buyer" });
    expect(screen.getByRole("button", { name: "Pick" }).textContent).toContain("New Buyer");
    expect(screen.queryByRole("form", { name: "client form" })).toBeNull();
  });

  it("drops a created record when the picker moves to another company", () => {
    const { rerender } = render(<Picker quickCreate="client" companyId={5} />);
    fireEvent.click(screen.getByRole("button", { name: "New client" }));
    fireEvent.click(screen.getByRole("button", { name: "Save client" }));
    rerender(<Picker quickCreate="client" companyId={6} />);
    expect(screen.getByRole("button", { name: "Pick" }).textContent).not.toContain("New Buyer");
  });
});
