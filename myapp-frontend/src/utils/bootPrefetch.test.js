import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBootPrefetch, startBootPrefetch, takeBootPrefetch } from "./bootPrefetch";

// The start-up answers are handed out once, to the token that asked, while fresh.
describe("bootPrefetch", () => {
  beforeEach(() => resetBootPrefetch());

  it("starts every loader at once and hands each result out once", async () => {
    const companies = vi.fn(() => Promise.resolve({ data: ["a"] }));
    const permissions = vi.fn(() => Promise.resolve({ data: { permissions: [] } }));
    startBootPrefetch("t1", { companies, permissions }, 1000);
    expect(companies).toHaveBeenCalledTimes(1);
    expect(permissions).toHaveBeenCalledTimes(1);

    await expect(takeBootPrefetch("companies", "t1", 1500)).resolves.toEqual({ data: ["a"] });
    expect(takeBootPrefetch("companies", "t1", 1600)).toBeNull();
    await expect(takeBootPrefetch("permissions", "t1", 1700)).resolves.toEqual({
      data: { permissions: [] },
    });
  });

  it("gives nothing to a different sign-in, and nothing afterwards", () => {
    startBootPrefetch("t1", { companies: () => Promise.resolve({ data: [] }) }, 1000);
    expect(takeBootPrefetch("companies", "t2", 1100)).toBeNull();
    expect(takeBootPrefetch("companies", "t1", 1200)).toBeNull();
  });

  it("gives nothing once the answer is old", () => {
    startBootPrefetch("t1", { companies: () => Promise.resolve({ data: [] }) }, 1000);
    expect(takeBootPrefetch("companies", "t1", 1000 + 10_001)).toBeNull();
  });

  it("does nothing without a token and never starts twice", () => {
    const companies = vi.fn(() => Promise.resolve({ data: [] }));
    startBootPrefetch(null, { companies });
    expect(companies).not.toHaveBeenCalled();
    startBootPrefetch("t1", { companies }, 1000);
    startBootPrefetch("t1", { companies }, 1001);
    expect(companies).toHaveBeenCalledTimes(1);
  });

  it("hands a failure to the consumer without an unhandled rejection", async () => {
    startBootPrefetch("t1", { companies: () => Promise.reject(new Error("401")) }, 1000);
    await expect(takeBootPrefetch("companies", "t1", 1100)).rejects.toThrow("401");
  });

  it("is empty when nothing was started", () => {
    expect(takeBootPrefetch("companies", "t1")).toBeNull();
  });
});
