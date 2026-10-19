import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

// Runs `run(value)` once when the URL carries `?{key}=value` and the page is
// ready, then drops the param so a refresh or Back does not repeat it. This is
// how a dashboard quick action ("New challan" → /challans?new=1) opens the
// page's own create form instead of a copy of it.
export default function useQueryAction(key, ready, run) {
  const [params, setParams] = useSearchParams();
  const value = params.get(key);
  useEffect(() => {
    if (!value || !ready) return;
    run(value);
    const next = new URLSearchParams(params);
    next.delete(key);
    setParams(next, { replace: true });
  }, [value, ready]);
}
