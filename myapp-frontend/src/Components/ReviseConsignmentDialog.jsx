import { useState } from "react";
import { MdClose, MdDownload, MdCloudUpload } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import {
  downloadImportConsignmentSheet,
  previewImportConsignmentRevision,
  commitImportConsignmentRevision,
} from "../api/importConsignmentApi";

const money = (n) =>
  n == null
    ? "-"
    : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n) =>
  n == null ? "-" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

const ACTION = {
  changed: { label: "Changed", tone: colors.blue },
  new: { label: "New", tone: colors.success },
  removed: { label: "Removed", tone: colors.danger },
};

/**
 * Revise a recorded GD from one sheet (Purchases > Consignments > a GD's
 * Revise action). The operator downloads the GD as a sheet, edits it, and
 * uploads it back; the plan shows every line that changes, is added or is
 * removed before anything is written, and it all applies together or not at
 * all. The server builds the plan and re-checks it on apply: nothing here is
 * trusted beyond the reviewed lines themselves.
 */
export default function ReviseConsignmentDialog({ consignment, onClose, onRevised }) {
  const [plan, setPlan] = useState(null);
  const [fileName, setFileName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const download = async () => {
    setBusy("download");
    setError("");
    try {
      const { data } = await downloadImportConsignmentSheet(consignment.id);
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `GD-${consignment.gdNumber}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("The sheet could not be downloaded.");
    } finally {
      setBusy("");
    }
  };

  const read = async (file) => {
    if (!file) return;
    setBusy("read");
    setError("");
    setPlan(null);
    setFileName(file.name);
    try {
      const { data } = await previewImportConsignmentRevision(consignment.id, file);
      setPlan(data);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "The file could not be read. Close it in Excel and try again.",
      );
    } finally {
      setBusy("");
    }
  };

  const apply = async () => {
    setBusy("apply");
    setError("");
    try {
      const sheet = plan.sheet || {};
      const { data } = await commitImportConsignmentRevision(consignment.id, {
        lines: sheet.lines || [],
        fileSha256: sheet.fileSha256,
        fileName: sheet.fileName,
        fileSizeBytes: sheet.fileSizeBytes,
        importProfileId: sheet.importProfileId,
        profileVersion: sheet.profileVersion,
        reason: reason.trim() || null,
      });
      onRevised(data);
    } catch (err) {
      setError(err.response?.data?.message || "The GD could not be revised. Nothing was changed.");
    } finally {
      setBusy("");
    }
  };

  const rows = (plan?.rows || []).filter((r) => r.action !== "unchanged");
  const blocked = (plan?.blockingErrors || []).length > 0;
  const canApply = plan && !blocked && rows.length > 0 && !busy;

  return (
    <div style={formStyles.backdrop} onMouseDown={onClose}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl || modalSizes.lg}px` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>Revise GD {consignment.gdNumber} from a sheet</h3>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close">
            <MdClose size={18} />
          </button>
        </div>

        <div style={formStyles.body}>
          {error && <div style={formStyles.error}>{error}</div>}

          <ol
            style={{
              margin: "0 0 0.9rem",
              paddingLeft: "1.2rem",
              color: colors.textSecondary,
              fontSize: 13.5,
              lineHeight: 1.55,
            }}
          >
            <li>Download this GD as a sheet. It is already in the format to upload.</li>
            <li>
              Change the figures, add rows for new lines and delete rows the GD no longer has. Keep
              the GD number on every row.
            </li>
            <li>
              Upload the sheet and check the plan below. Nothing changes until you press Revise.
            </li>
          </ol>

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: "0.9rem",
            }}
          >
            <button
              type="button"
              style={{
                ...formStyles.button,
                ...formStyles.cancel,
                minHeight: 44,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
              onClick={download}
              disabled={!!busy}
            >
              <MdDownload size={18} />{" "}
              {busy === "download" ? "Preparing" : "Download this GD as a sheet"}
            </button>
            <label
              style={{
                ...formStyles.button,
                ...formStyles.submit,
                minHeight: 44,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              <MdCloudUpload size={18} /> {busy === "read" ? "Reading" : "Upload the revised sheet"}
              <input
                type="file"
                accept=".xlsx,.xlsm,.xls"
                disabled={!!busy}
                style={{ display: "none" }}
                onChange={(e) => {
                  read(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {fileName && (
              <span
                style={{ fontSize: 12.5, color: colors.textSecondary, overflowWrap: "anywhere" }}
              >
                {fileName}
              </span>
            )}
          </div>

          {plan && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
                  gap: 8,
                  marginBottom: "0.8rem",
                }}
              >
                <Stat label="Changed" value={plan.changed} />
                <Stat label="New" value={plan.added} />
                <Stat label="Removed" value={plan.removed} />
                <Stat label="Unchanged" value={plan.unchanged} />
                <Stat label="Landed cost now" value={money(plan.oldTotalCost)} />
                <Stat label="After the revision" value={money(plan.newTotalCost)} />
              </div>

              {(plan.blockingErrors || []).map((m, i) => (
                <div key={`e${i}`} style={{ ...formStyles.error, marginBottom: 6 }}>
                  {m}
                </div>
              ))}
              {(plan.warnings || []).map((m, i) => (
                <div
                  key={`w${i}`}
                  style={{
                    fontSize: 12.5,
                    color: colors.textSecondary,
                    marginBottom: 4,
                    overflowWrap: "anywhere",
                  }}
                >
                  {m}
                </div>
              ))}

              {rows.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginTop: "0.6rem" }}>
                  {rows.map((r, i) => (
                    <div
                      key={i}
                      style={{
                        border: `1px solid ${r.problems?.length ? colors.danger : colors.cardBorder}`,
                        borderRadius: 8,
                        padding: "0.55rem 0.7rem",
                        background: colors.cardBg,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "baseline",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: ACTION[r.action]?.tone,
                            textTransform: "uppercase",
                          }}
                        >
                          {ACTION[r.action]?.label || r.action}
                        </span>
                        <strong style={{ overflowWrap: "anywhere" }}>{r.description}</strong>
                        <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                          {r.hsCode}
                          {r.itemTypeName && r.itemTypeName !== r.description
                            ? ` - item: ${r.itemTypeName}`
                            : ""}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))",
                          gap: "2px 14px",
                          marginTop: 4,
                          fontSize: 13,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        <Move
                          label={`Quantity${r.unit ? ` (${r.unit})` : ""}`}
                          was={r.oldQuantity}
                          now={r.newQuantity}
                          fmt={qty}
                        />
                        <Move label="Landed cost" was={r.oldCost} now={r.newCost} fmt={money} />
                        <Move
                          label="Selling value"
                          was={r.oldSellingValue}
                          now={r.newSellingValue}
                          fmt={money}
                        />
                      </div>
                      {(r.problems || []).map((p, j) => (
                        <div key={j} style={{ color: colors.danger, fontSize: 12.5, marginTop: 4 }}>
                          {p}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {!blocked && rows.length > 0 && (
                <div style={{ marginTop: "0.9rem" }}>
                  <label style={formStyles.label}>Why (kept in the history)</label>
                  <input
                    style={formStyles.input}
                    value={reason}
                    maxLength={300}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. GD revised by customs"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div style={formStyles.footer}>
          <button
            style={{ ...formStyles.button, ...formStyles.cancel, minHeight: 44 }}
            onClick={onClose}
            disabled={busy === "apply"}
          >
            Cancel
          </button>
          <button
            style={{
              ...formStyles.button,
              ...formStyles.submit,
              minHeight: 44,
              opacity: canApply ? 1 : 0.55,
            }}
            onClick={apply}
            disabled={!canApply}
          >
            {busy === "apply" ? "Revising" : "Revise the GD"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div
      style={{
        border: `1px solid ${colors.cardBorder}`,
        borderRadius: 8,
        padding: "0.4rem 0.6rem",
        background: colors.inputBg,
      }}
    >
      <div style={{ fontSize: 11.5, color: colors.textSecondary }}>{label}</div>
      <div
        style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}
      >
        {value}
      </div>
    </div>
  );
}

function Move({ label, was, now, fmt }) {
  const moved = was != null && now != null && Math.abs(was - now) > 0.00005;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: colors.textSecondary }}>{label}</span>
      <span>
        {was != null && (
          <span
            style={{
              textDecoration: moved || now == null ? "line-through" : "none",
              color: moved || now == null ? colors.textSecondary : "inherit",
            }}
          >
            {fmt(was)}
          </span>
        )}
        {now != null && (was == null || moved) && (
          <strong style={{ marginLeft: was != null ? 8 : 0 }}>{fmt(now)}</strong>
        )}
      </span>
    </div>
  );
}
