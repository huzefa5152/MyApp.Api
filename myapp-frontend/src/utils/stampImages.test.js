// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { loadStampImage, MAX_INLINE_STAMP_BYTES, stampImageSrc } from "./stampImages";

const stamp = {
  id: 6,
  url: "/data/uploads/stamps/company_8/sign.png",
  updatedAt: "2026-11-04T10:00:00",
};
const png = (size = 4) => new Blob([new Uint8Array(size)], { type: "image/png" });
const answer = (blob, ok = true) => vi.fn(async () => ({ ok, blob: async () => blob }));

describe("loadStampImage", () => {
  it("fetches an image once and then reuses it", async () => {
    const fetchImage = answer(png());
    const cache = new Map();
    const first = await loadStampImage(stamp, cache, fetchImage);
    const second = await loadStampImage(stamp, cache, fetchImage);
    expect(first).toMatch(/^data:image\/png;base64,/);
    expect(second).toBe(first);
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it("fetches again when the stamp's image was replaced", async () => {
    const fetchImage = answer(png());
    const cache = new Map();
    await loadStampImage(stamp, cache, fetchImage);
    await loadStampImage({ ...stamp, updatedAt: "2026-11-04T11:00:00" }, cache, fetchImage);
    expect(fetchImage).toHaveBeenCalledTimes(2);
  });

  it("never serves one company's image for another stamp id", async () => {
    const cache = new Map();
    await loadStampImage(stamp, cache, answer(png()));
    const other = answer(png(8));
    await loadStampImage({ ...stamp, id: 7 }, cache, other);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a refused request", answer(png(), false)],
    ["an answer that is not an image", answer(new Blob(["<html>"], { type: "text/html" }))],
    ["an image too large to hold", answer(png(MAX_INLINE_STAMP_BYTES + 1))],
    [
      "a failed request",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    ],
  ])("keeps the URL after %s, and holds nothing", async (_label, fetchImage) => {
    const cache = new Map();
    expect(await loadStampImage(stamp, cache, fetchImage)).toBeNull();
    expect(cache.size).toBe(0);
  });
});

describe("stampImageSrc", () => {
  it("prefers the held image", () => {
    expect(stampImageSrc({ ...stamp, image: "data:image/png;base64,AA" })).toBe(
      "data:image/png;base64,AA",
    );
  });

  it("falls back to a versioned URL, so a replaced image shows", () => {
    expect(stampImageSrc(stamp)).toBe(`${stamp.url}?v=2026-11-04T10%3A00%3A00`);
  });

  it("gives no image for no stamp", () => {
    expect(stampImageSrc(undefined)).toBeNull();
  });
});
