import { useEffect, useState } from "react";

// The value once it has stopped changing for `delay` ms. List screens search with
// it, so typing a PO number sends one request instead of one per keystroke.
export default function useDebouncedValue(value, delay = 350) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
