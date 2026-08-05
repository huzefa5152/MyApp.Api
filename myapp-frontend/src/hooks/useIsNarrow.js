import { useState, useEffect } from "react";

// Shared mobile-breakpoint hook. Returns true when the viewport is narrower
// than `breakpoint` (default 768px = the tablet/phone cutoff). Consolidates the
// `useState(innerWidth < N) + resize listener` pattern that was copy-pasted
// across the line-item forms and report screens.
export default function useIsNarrow(breakpoint = 768) {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < breakpoint
  );
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return narrow;
}
