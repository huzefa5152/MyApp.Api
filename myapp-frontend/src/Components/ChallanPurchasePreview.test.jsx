// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useChallanPurchasePreview } from "./ChallanPurchasePreview";
import { previewPurchaseBillsFromChallan, createPurchaseBillsFromChallan } from "../api/purchaseBillApi";
vi.mock("../api/purchaseBillApi", () => ({ previewPurchaseBillsFromChallan: vi.fn(), createPurchaseBillsFromChallan: vi.fn() }));
vi.mock("../utils/notify", () => ({ notify: vi.fn() }));
const parentSubmit = vi.fn();
const preview = { challanNumber: 101, revision: "sample-revision", date: "2026-01-16", tracksStock: false, suppliers: [
 {supplierId:1,supplierName:"First supplier",items:[{id:1,description:"Goods one",quantity:2,uom:"Pcs",unitPrice:100,lineTotal:200}]},
 {supplierId:2,supplierName:"Second supplier",items:[{id:2,description:"Goods two",quantity:3,uom:"Pcs",unitPrice:50,lineTotal:150}]}
] };
function Fixture() {
 const purchase = useChallanPurchasePreview();
 const [result, setResult] = React.useState("");
 return <form onSubmit={parentSubmit}><button type="button" onClick={async () => { try { setResult(String(await purchase.create(17))); } catch { setResult("failed"); } }}>Preview purchases</button>{purchase.dialog}<output>{result}</output></form>;
}
beforeEach(() => { vi.clearAllMocks(); previewPurchaseBillsFromChallan.mockResolvedValue({ data: preview }); createPurchaseBillsFromChallan.mockResolvedValue({data:[{id:1},{id:2}]}); });
afterEach(cleanup);
async function open() { render(<Fixture/>); fireEvent.click(screen.getByText("Preview purchases")); await screen.findByRole("dialog"); }
it("preview shows supplier identities and defaults to zero GST without creating bills", async () => {
 await open(); expect(screen.getByText("First supplier")).toBeTruthy(); expect(screen.getByText("Second supplier")).toBeTruthy();
 expect(screen.getByText("Total payable: Rs. 350.00")).toBeTruthy(); expect(createPurchaseBillsFromChallan).not.toHaveBeenCalled();
});
it("per-supplier GST changes the displayed amount and confirmed request", async () => {
 await open(); fireEvent.change(screen.getAllByRole("spinbutton")[1],{target:{value:"18"}});
 expect(screen.getByText("Total payable: Rs. 377.00")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Create 2 purchase bills"}));
 await waitFor(() => expect(createPurchaseBillsFromChallan).toHaveBeenCalledWith(17,{revision:"sample-revision",date:"2026-01-16",suppliers:[{supplierId:1,gstRate:0,supplierBillNumber:""},{supplierId:2,gstRate:18,supplierBillNumber:""}]}));
 expect(parentSubmit).not.toHaveBeenCalled();
});
it("invalid GST prevents confirmation and explains how to correct it", async () => {
 await open(); fireEvent.change(screen.getAllByRole("spinbutton")[0],{target:{value:"101"}});
 expect(screen.getByRole("button",{name:"Create 2 purchase bills"}).disabled).toBe(true); expect(screen.getByRole("alert")).toBeTruthy();
 expect(createPurchaseBillsFromChallan).not.toHaveBeenCalled();
});
it("Not now closes the preview without creating purchases or submitting the challan form", async () => {
 await open(); fireEvent.click(screen.getByText("Not now")); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
 expect(createPurchaseBillsFromChallan).not.toHaveBeenCalled(); expect(parentSubmit).not.toHaveBeenCalled();
});
it("existing linked purchases cannot be created again through the shortcut", async () => {
 previewPurchaseBillsFromChallan.mockResolvedValue({data:{...preview,alreadyCreated:true}});
 render(<Fixture/>);fireEvent.click(screen.getByText("Preview purchases"));await waitFor(() => expect(screen.getByRole("status").textContent).toBe("true"));
 expect(screen.queryByRole("dialog")).toBeNull();expect(createPurchaseBillsFromChallan).not.toHaveBeenCalled();
});
it("API failure returns control without silently creating a zero-GST bill", async () => {
 previewPurchaseBillsFromChallan.mockRejectedValue(new Error("Local test failure"));
 render(<Fixture/>);fireEvent.click(screen.getByText("Preview purchases"));await waitFor(() => expect(screen.getByRole("status").textContent).toBe("failed"));
 expect(createPurchaseBillsFromChallan).not.toHaveBeenCalled();
});

it("fractional unit prices retain their precision while totals remain money", async () => {
 previewPurchaseBillsFromChallan.mockResolvedValue({data:{...preview,suppliers:[{...preview.suppliers[0],items:[{id:1,description:"Fractional cost",quantity:3,uom:"Pcs",unitPrice:0.333333333333,lineTotal:1}]}]}});
 await open();expect(screen.getByText(/0\.333333333333/)).toBeTruthy();expect(screen.getByText("Total payable: Rs. 1.00")).toBeTruthy();
});

it("a failed creation keeps the chosen tax and reference for a fresh reviewed retry", async () => {
 createPurchaseBillsFromChallan.mockRejectedValueOnce(new Error("Local retry test"));
 await open();fireEvent.change(screen.getAllByRole("spinbutton")[1],{target:{value:"18"}});
 fireEvent.change(screen.getAllByRole("textbox",{name:"Supplier invoice reference (optional)"})[1],{target:{value:"SAMPLE-REF"}});
 fireEvent.click(screen.getByRole("button",{name:"Create 2 purchase bills"}));await waitFor(() => expect(screen.getByRole("status").textContent).toBe("failed"));
 previewPurchaseBillsFromChallan.mockResolvedValue({data:{...preview,revision:"fresh-revision"}});
 fireEvent.click(screen.getByText("Preview purchases"));await screen.findByRole("dialog");
 expect(screen.getByText("Total payable: Rs. 377.00")).toBeTruthy();expect(screen.getAllByRole("textbox",{name:"Supplier invoice reference (optional)"})[1].value).toBe("SAMPLE-REF");
 expect(createPurchaseBillsFromChallan).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole("button",{name:"Create 2 purchase bills"}));await waitFor(() => expect(createPurchaseBillsFromChallan).toHaveBeenCalledTimes(2));
 expect(createPurchaseBillsFromChallan.mock.calls[1][1].revision).toBe("fresh-revision");expect(createPurchaseBillsFromChallan.mock.calls[1][1].suppliers[1].gstRate).toBe(18);
});
