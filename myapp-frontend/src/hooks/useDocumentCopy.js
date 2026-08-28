import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DOC_COPY_ROUTES } from "../api/documentCopyApi";
import { notify } from "../utils/notify";

/**
 * Shared wiring for the Copy action on a document list. Every document page
 * needs the same three things — hold which row is being copied, report the
 * result, and land the operator where the new document is — so they live here
 * once instead of six times.
 *
 * @param {object}   options
 * @param {string}   options.sourceType  backend type key (see DOC_COPY_TYPES)
 * @param {function} options.onRefresh   reload the current list after a same-type copy
 * @returns {{source: object|null, openCopy: function, close: function, onCopied: function}}
 */
export function useDocumentCopy({ sourceType, onRefresh }) {
  const navigate = useNavigate();
  const [source, setSource] = useState(null);

  const openCopy = useCallback((id, label) => setSource({ id, label }), []);
  const close = useCallback(() => setSource(null), []);

  const onCopied = useCallback((result) => {
    setSource(null);
    notify(
      `${result.documentTypeLabel} #${result.number} created from ${result.sourceType === result.documentType
        ? `#${result.sourceNumber}`
        : `${result.sourceType === "Invoice" ? "Bill" : result.sourceType} #${result.sourceNumber}`}.`,
      "success"
    );
    // Anything the copy dropped or adjusted is worth saying out loud — a
    // silently missing supplier IRN or rounded quantity reads as a bug.
    if (result.warnings?.length) notify(result.warnings.join(" "), "warning");

    if (result.documentType === sourceType) onRefresh?.();
    else navigate(DOC_COPY_ROUTES[result.documentType] || "/");
  }, [sourceType, onRefresh, navigate]);

  return { source, openCopy, close, onCopied };
}
