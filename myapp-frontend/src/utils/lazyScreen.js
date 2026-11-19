import { createElement, lazy, useState } from "react";

// A lazily loaded screen whose code can be fetched BEFORE it is shown
// (performance audit 2026-11-20).
//
// React.lazy only starts the download when the screen first renders, which
// cost two things, both measured on production:
//
//   * A full page load. The screen's code was not asked for until the sign-in
//     check and the company list had come back. Then React had already put the
//     empty placeholder on screen, and it holds back a just-loaded screen for
//     up to 0.3 s after a placeholder appears, so the screen's own request
//     started about 0.19 s late (it looked as if the dashboard waited for the
//     stamps request; it was waiting for the next redraw).
//   * The first visit to each screen after a deploy: 0.2-0.9 s to fetch its
//     code before anything else could start.
//
// `preload()` starts the same download early. Once the code is in hand the
// screen renders directly, with no placeholder at all. Nothing else changes:
// it is the same module, shown by the same route, behind the same guards.
export function lazyScreen(factory) {
  let Loaded = null;
  let pending = null;

  const load = () =>
    (pending ??= factory().then(
      (module) => {
        Loaded = module.default;
        return module;
      },
      (error) => {
        // A failed early fetch (offline, a deploy in progress) must not poison
        // the real attempt the screen makes when it is opened.
        pending = null;
        throw error;
      },
    ));

  const Lazy = lazy(load);

  function Screen(props) {
    // Decided once per mount, so the component underneath never changes type
    // (which would remount the screen and lose its state).
    const [Impl] = useState(() => Loaded ?? Lazy);
    return createElement(Impl, props);
  }

  Screen.preload = () => {
    load().catch(() => {});
  };
  return Screen;
}
