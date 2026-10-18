// The open drill and its URL keys, shared by the Overview and Accounting pages.
//
// KpiDrilldown owns ?drill= and ?group= (it moves between levels); the page owns
// only the window keys ?dperiod=&dfrom=&dto=. setSearchParams' updater sees the
// params of the last render, so the panel's own writes can drop d* keys written
// in the same or a neighbouring commit: they are re-added whenever the URL
// disagrees with the open drill. Only d* keys are touched, so this can never
// undo a level change. Seeded from the URL, so Back from "Open bill" reopens it.
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { drillFromSearch, drillToSearch } from "../../utils/dashboardDrill";

const WINDOW_KEYS = ["dperiod", "dfrom", "dto"];

export default function useDrillState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [drill, setDrill] = useState(() => {
    const s = drillFromSearch(searchParams);
    return s ? { ...s, period: searchParams.get("dperiod") || null, from: searchParams.get("dfrom") || null, to: searchParams.get("dto") || null } : null;
  });

  // opts.period (+ from/to for "custom"): the window the drill reads.
  const openDrill = useCallback((kind, opts = {}) => {
    setDrill({ kind, groupKey: opts.groupKey || null, period: opts.period || null, from: opts.from || null, to: opts.to || null });
  }, []);

  useEffect(() => {
    if (!drill) return;
    const want = [["dperiod", drill.period], ["dfrom", drill.from], ["dto", drill.to]];
    if (want.every(([k, v]) => (searchParams.get(k) || null) === (v || null))) return;
    setSearchParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of want) { if (v) n.set(k, v); else n.delete(k); }
      return n;
    }, { replace: true });
  }, [drill, searchParams, setSearchParams]);

  // Clears every drill key in one update: KpiDrilldown clears drill/group too, and
  // two updates from one tick would otherwise overwrite each other.
  const closeDrill = useCallback(() => {
    setDrill(null);
    setSearchParams((p) => { const n = drillToSearch(p, null); WINDOW_KEYS.forEach((k) => n.delete(k)); return n; }, { replace: true });
  }, [setSearchParams]);

  return { drill, openDrill, closeDrill };
}
