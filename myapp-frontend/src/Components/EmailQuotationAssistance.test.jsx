// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EmailQuotationAssistance from "./EmailQuotationAssistance";
import http from "../api/httpClient";
import { readPoFile } from "../utils/poOcr.js";

vi.mock("../api/httpClient", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock("../utils/poOcr.js", () => ({ readPoFile: vi.fn() }));
const root = "/email-workspace/company/1";
const base = `${root}/messages/3`;
const original = { description: "Steel bolt M12", quantity: 2, unit: "Nos", unitPrice: null };
const initial = { clientId: 7, revision: "original", reviewed: true, items: [original] };
const attachment = { id: "csv", fileName: "enquiry.csv", mimeType: "text/csv" };
const preview = { fileName: "enquiry.csv", text: "Description,Qty,Unit", warnings: [], requiresOcr: false, items: [{ description: "Washer", quantity: 4, unit: "Nos", unitPrice: null }] };
const price = { unitPrice: 75, date: "2026-10-08", documentNumber: 12 };
const candidate = { description: "Steel bolt M12", unit: "Nos", score: 100, reason: "Exact description", lastQuote: price, lastPurchase: null };
function Harness({ source = attachment }) {
  const [draft, setDraft] = useState(initial);
  return <><p data-testid="current">{draft.items.map(i => `${i.description}: ${i.quantity} ${i.unit} at ${i.unitPrice ?? "unpriced"}`).join("; ")}</p><p>{draft.reviewed ? "Review confirmed" : "Review required"}</p>
    <button onClick={() => setDraft(d => ({ ...d, clientId: 8 }))}>Change customer</button>
    <EmailQuotationAssistance root={root} message={{ id: 3, attachments: [source] }} draft={draft} onDraft={setDraft}
      changeItems={items => setDraft(d => ({ ...d, items, reviewed: false }))} busy={false} run={action => action()} /></>;
}
beforeEach(() => { vi.resetAllMocks(); http.put.mockResolvedValue({ data: { revision: "saved" } }); });
afterEach(cleanup);
it("previews without applying and requires an explicit replace choice", async () => {
  http.post.mockImplementation(url => Promise.resolve({ data: url.endsWith("/attachment-preview") ? preview : { ...initial, items: preview.items, reviewed: false, revision: "applied" } }));
  render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Read items from enquiry.csv" }));
  await screen.findByText("Attachment preview: enquiry.csv");
  expect(screen.getByTestId("current").textContent).toContain("Steel bolt M12");
  expect(http.post).toHaveBeenCalledWith(`${base}/attachment-preview`, { attachmentId: "csv", revision: "saved" });
  expect(http.post).not.toHaveBeenCalledWith(`${base}/attachment-items`, expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "Replace draft items with attachment" }));
  await waitFor(() => expect(screen.getByTestId("current").textContent).toContain("Washer: 4 Nos at unpriced"));
  expect(screen.getByText("Review required")).toBeTruthy();
  expect(http.post).toHaveBeenCalledWith(`${base}/attachment-items`, { attachmentId: "csv", revision: "saved", mode: "Replace" });
});
it("never applies suggested prices automatically and clears review on acceptance", async () => {
  http.post.mockResolvedValue({ data: [{ index: 0, candidates: [candidate] }] });
  render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Find catalogue matches and prices" }));
  const use = await screen.findByRole("button", { name: "Use last quoted price for item 1" });
  expect(screen.getByTestId("current").textContent).toContain("unpriced"); expect(screen.getByText("Review confirmed")).toBeTruthy();
  fireEvent.click(use); await screen.findByText("Review required");
  expect(screen.getByTestId("current").textContent).toContain("at 75");
  expect(screen.queryByText(/Latest recorded purchase cost/)).toBeNull();
});
it("accepting a catalogue description preserves quantity and clears an old price", async () => {
  http.post.mockResolvedValue({ data: [{ index: 0, candidates: [{ ...candidate, description: "Bolt steel M12" }] }] });
  render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Find catalogue matches and prices" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use this catalogue description for item 1" }));
  expect(screen.getByTestId("current").textContent).toContain("Bolt steel M12: 2 Nos at unpriced");
  expect(screen.getByText("Review required")).toBeTruthy();
});
it("discards price results if the customer changes during the request", async () => {
  let finish; http.post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Find catalogue matches and prices" }));
  await waitFor(() => expect(http.post).toHaveBeenCalled()); fireEvent.click(screen.getByRole("button", { name: "Change customer" }));
  await act(async () => finish({ data: [{ index: 0, candidates: [candidate] }] }));
  expect(screen.queryByRole("button", { name: "Use last quoted price for item 1" })).toBeNull();
});
it("reads images through local OCR and still waits for an item-apply decision", async () => {
  const pages = [[{ text: "Washer", left: 0, right: 60, top: 0, bottom: 10, confidence: 95 }]];
  readPoFile.mockResolvedValue(pages); http.get.mockResolvedValue({ data: new Blob(["sample"]) });
  http.post.mockResolvedValueOnce({ data: { ...preview, fileName: "scan.png", requiresOcr: true, items: [] } }).mockResolvedValueOnce({ data: { ...preview, fileName: "scan.png" } });
  render(<Harness source={{ id: "image", fileName: "scan.png", mimeType: "image/png" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Read items from scan.png" }));
  fireEvent.click(await screen.findByRole("button", { name: "Read with OCR" }));
  await screen.findByRole("button", { name: "Append attachment items" });
  expect(http.post).toHaveBeenLastCalledWith(`${base}/attachment-preview`, { attachmentId: "image", revision: "saved", pages });
  expect(screen.getByTestId("current").textContent).toContain("Steel bolt M12");
  expect(http.post.mock.calls.every(([url]) => !url.endsWith("/attachment-items"))).toBe(true);
});
