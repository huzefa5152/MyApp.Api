import { useCallback, useEffect, useState } from "react";
import { getEntityAttachmentCounts } from "../api/attachmentApi";
import { usePermissions } from "../contexts/PermissionsContext";

// Batch attachment-count lookup for a page of documents. Given the loaded
// records' ids, fetches { entityId: count } in ONE call so a list can show a
// paperclip badge per row without N round-trips. Reusable across every
// transaction module (Sales Quote, Invoice, Payment, …).
//
// - Returns {} and skips the call when the user lacks attachments.list.view
//   (badges simply don't render — nothing to gate a button on).
// - Re-fetches whenever the company or the id set changes.
// - `refresh()` re-pulls after the quick modal adds/removes a file so the badge
//   count stays live.
export function useEntityAttachmentCounts(companyId, entityType, ids) {
  const { has } = usePermissions();
  const canView = has("attachments.list.view");
  const [counts, setCounts] = useState({});

  // Stable key so the effect only re-runs when the actual id set changes,
  // not on every render's new array identity.
  const idKey = (ids || []).join(",");

  const refresh = useCallback(async () => {
    if (!companyId || !entityType || !canView || !idKey) { setCounts({}); return; }
    try {
      const { data } = await getEntityAttachmentCounts(companyId, entityType, idKey.split(","));
      // Only accept a plain id→count object; an absent endpoint serves index.html
      // (200 text/html) via SPA fallback, which must not leak into the UI.
      setCounts(data && typeof data === "object" && !Array.isArray(data) ? data : {});
    } catch { setCounts({}); }
  }, [companyId, entityType, canView, idKey]);

  useEffect(() => { refresh(); }, [refresh]);

  return { counts, refresh };
}
