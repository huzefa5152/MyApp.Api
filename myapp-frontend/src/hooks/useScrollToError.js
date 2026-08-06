import { useEffect, useRef } from "react";

/**
 * Scroll the form's error banner into view whenever a new error appears.
 *
 * Many create/edit forms live in a scrollable modal body with the submit button
 * at the bottom and the error banner at the top. When a submit-time validation
 * error fires, the operator (down by the submit button) never sees it. Attach
 * the returned ref to the error element and this scrolls it into view (centred)
 * the moment `error` becomes truthy or changes.
 *
 * Usage:
 *   const errRef = useScrollToError(error);
 *   {error && <div ref={errRef} style={s.err}>{error}</div>}
 *
 * The ref lands on a conditionally-rendered node: React commits the node before
 * effects run, so `ref.current` is set by the time we scroll. `scrollIntoView`
 * walks to the nearest scrollable ancestor, so it works for both the shared
 * modal body and full-page forms.
 */
export default function useScrollToError(error) {
  const ref = useRef(null);
  useEffect(() => {
    if (!error || !ref.current) return;
    try {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      // Older engines: fall back to a plain (no-options) scroll.
      try { ref.current.scrollIntoView(); } catch { /* no-op */ }
    }
  }, [error]);
  return ref;
}
