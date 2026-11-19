// @vitest-environment jsdom
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { lazyScreen } from "./lazyScreen";

const page = (text) => ({ default: () => <p>{text}</p> });

describe("lazyScreen", () => {
  afterEach(cleanup);

  it("loads on first render when nothing asked for it earlier", async () => {
    const factory = vi.fn(() => Promise.resolve(page("bills")));
    const Screen = lazyScreen(factory);
    render(
      <Suspense fallback={<span>placeholder</span>}>
        <Screen />
      </Suspense>,
    );
    expect(screen.getByText("placeholder")).toBeTruthy();
    expect(await screen.findByText("bills")).toBeTruthy();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("renders at once, with no placeholder, when it was preloaded", async () => {
    const factory = vi.fn(() => Promise.resolve(page("stock")));
    const Screen = lazyScreen(factory);
    Screen.preload();
    await act(async () => {});
    render(
      <Suspense fallback={<span>placeholder</span>}>
        <Screen />
      </Suspense>,
    );
    expect(screen.queryByText("placeholder")).toBeNull();
    expect(screen.getByText("stock")).toBeTruthy();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("fetches the code once however often it is asked for", async () => {
    const factory = vi.fn(() => Promise.resolve(page("units")));
    const Screen = lazyScreen(factory);
    Screen.preload();
    Screen.preload();
    await act(async () => {});
    render(
      <Suspense fallback={null}>
        <Screen />
      </Suspense>,
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("passes props through", async () => {
    const Screen = lazyScreen(() => Promise.resolve({ default: ({ mode }) => <p>mode {mode}</p> }));
    Screen.preload();
    await act(async () => {});
    render(
      <Suspense fallback={null}>
        <Screen mode="notes" />
      </Suspense>,
    );
    expect(screen.getByText("mode notes")).toBeTruthy();
  });

  it("tries again when an early fetch failed", async () => {
    const factory = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error("offline")))
      .mockImplementationOnce(() => Promise.resolve(page("roles")));
    const Screen = lazyScreen(factory);
    Screen.preload();
    await act(async () => {});
    render(
      <Suspense fallback={<span>placeholder</span>}>
        <Screen />
      </Suspense>,
    );
    expect(await screen.findByText("roles")).toBeTruthy();
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
