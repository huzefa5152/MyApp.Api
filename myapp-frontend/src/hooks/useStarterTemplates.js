import { useEffect, useMemo, useState } from "react";
import httpClient from "../api/httpClient";
import { STARTER_TEMPLATES } from "../utils/starterTemplates";

/**
 * Every starter the gallery and picker offer: the designs shipped in code, then the shared ones
 * the system administrator added for every company (GET /api/starter-templates, 2026-10-29).
 * A shared starter is shaped like a code one ({ id, type, name, description, html }) with
 * source "shared" and id "shared-{id}", so the apply flow is unchanged. If the call fails, the
 * code starters still show -- a gallery must never go empty because of a network error.
 */
export function toSharedStarter(row) {
  return {
    id: `shared-${row.id}`,
    type: row.templateType,
    name: row.name,
    description: row.description || "",
    html: row.htmlContent || "",
    source: "shared",
  };
}

export function mergeStarters(codeStarters, sharedRows) {
  return [...codeStarters, ...(sharedRows || []).map(toSharedStarter)];
}

export default function useStarterTemplates() {
  const [shared, setShared] = useState([]);
  useEffect(() => {
    let live = true;
    httpClient.get("/starter-templates")
      .then((r) => { if (live) setShared(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (live) setShared([]); });
    return () => { live = false; };
  }, []);
  return useMemo(() => mergeStarters(STARTER_TEMPLATES, shared), [shared]);
}
