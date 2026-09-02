import { useState, useEffect } from "react";
import { MdClose, MdCloudDownload, MdCheckCircle, MdWarning, MdKey } from "react-icons/md";
import {
  importHsCodes,
  importHsCodesFromTariff,
  backfillHsUoms,
  getFbrReferenceToken,
  setFbrReferenceToken,
} from "../api/hsCodeApi";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBorder: "#d0d7e2",
  warn: "#8a6d3b",
  warnBg: "#fdf6e3",
  ok: "#1b7f4f",
};

/**
 * "Import HS Codes" — pulls FBR's tariff into the local HS master.
 *
 * The import is an UPSERT: a code we already hold keeps its row, a code we have
 * never seen is added. That is why the dialog says it is safe to run again, and
 * why the summary separates "new" from "already existing" — running it twice
 * should show everything under "already existing" the second time.
 *
 * Credentials: reading FBR's catalog still needs a bearer token, but it is an
 * INSTALLATION-wide reference token, not a company's. It reads reference data
 * only — it does not switch FBR integration on for any company, and companies
 * with FBR off use the imported codes exactly like everyone else.
 */
export default function HsCodeImportModal({ companyId, onClose, onImported }) {
  const { has } = usePermissions();
  const canManageToken = has("hscodes.token.manage");

  const [tokenStatus, setTokenStatus] = useState(null);
  const [tokenInput, setTokenInput] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [savingToken, setSavingToken] = useState(false);
  const [showTokenField, setShowTokenField] = useState(false);

  const [createItemTypes, setCreateItemTypes] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  // Set when the API answers with the SPA's own HTML — see isStaleBackend.
  const [staleBackend, setStaleBackend] = useState(false);

  // The SPA is served for any path the API doesn't handle, so a server running
  // an older build answers these calls with index.html and a 200. Axios parses
  // that as a string, the response has no fields we asked for, and the dialog
  // would otherwise look like it silently ignored the operator — which is
  // exactly what "unable to save token" felt like. Detect it and say so.
  const isStaleBackend = (data) =>
    typeof data === "string" || data == null || typeof data !== "object";

  const STALE_MESSAGE =
    "The server is running an older build that doesn't have the HS code import yet. " +
    "Restart the backend, then reopen this dialog.";

  useEffect(() => {
    (async () => {
      try {
        const { data } = await getFbrReferenceToken();
        if (isStaleBackend(data)) {
          setStaleBackend(true);
          setTokenStatus(null);
          return;
        }
        setTokenStatus(data);
        setEnvironment(data?.environment || "production");
        // Nothing to import with → open the token field straight away rather
        // than letting the operator press a button that can only fail.
        if (!data?.isConfigured && !data?.hasCompanyTokenFallback) setShowTokenField(true);
      } catch {
        setTokenStatus(null);
      }
    })();
  }, []);

  const saveToken = async () => {
    if (!tokenInput.trim()) return;
    setSavingToken(true);
    try {
      const { data } = await setFbrReferenceToken(tokenInput.trim(), environment);
      if (isStaleBackend(data)) {
        setStaleBackend(true);
        notify(STALE_MESSAGE, "error");
        return;
      }
      setTokenStatus(data);
      setTokenInput("");
      setShowTokenField(false);
      notify("Reference token saved.", "success");
    } catch (err) {
      notify(err?.response?.data?.message || "Could not save the token.", "error");
    } finally {
      setSavingToken(false);
    }
  };

  // The token-free path. Kept as its own action rather than a fallback inside
  // runImport: which source the master came from matters, so the operator picks
  // it rather than discovering it after the fact.
  const runTariffImport = async () => {
    setRunning(true);
    setResult(null);
    try {
      const { data } = await importHsCodesFromTariff({ createItemTypes });
      setResult(data);
      if (data?.errors?.length && data.totalReceived === 0) {
        notify("The bundled tariff could not be read — see the details.", "error");
      } else {
        notify(
          `Loaded from ${data.source} — ${data.added} new, ${data.alreadyExisting} already existing.`,
          "success",
        );
        onImported?.(data);
      }
    } catch (err) {
      notify(err?.response?.data?.message || "The import failed. Please try again.", "error");
    } finally {
      setRunning(false);
    }
  };

  // Units are the one thing the published tariff cannot give us, so they are
  // fetched separately — one call per code, in batches, until done.
  const runUomBackfill = async () => {
    setRunning(true);
    let filled = 0, attempted = 0, rounds = 0;
    try {
      for (;;) {
        const { data } = await backfillHsUoms({ companyId, max: 100, onlyInUse: true });
        if (data?.errors?.length && data.attempted === 0) {
          notify(data.errors[0], "error");
          return;
        }
        filled += data.filled || 0;
        attempted += data.attempted || 0;
        rounds += 1;
        // Stop when there is nothing left, nothing moved, or we have run long
        // enough that the operator deserves an answer rather than a spinner.
        if (!data.moreToDo || data.attempted === 0 || rounds >= 12) {
          notify(
            `Units filled for ${filled} of ${attempted} code(s) checked` +
            (data.moreToDo ? " — press again to continue." : "."),
            "success",
          );
          onImported?.(data);
          return;
        }
      }
    } catch (err) {
      notify(err?.response?.data?.message || "The unit backfill failed.", "error");
    } finally {
      setRunning(false);
    }
  };

  const runImport = async () => {
    setRunning(true);
    setResult(null);
    try {
      const { data } = await importHsCodes({ companyId, createItemTypes });
      if (isStaleBackend(data)) {
        setStaleBackend(true);
        notify(STALE_MESSAGE, "error");
        return;
      }
      setResult(data);
      if (data?.errors?.length && data.totalReceived === 0) {
        notify("Import could not read FBR's catalog — see the details.", "error");
      } else {
        notify(
          `HS code import finished — ${data.added} new, ${data.alreadyExisting} already existing.`,
          "success",
        );
        onImported?.(data);
      }
    } catch (err) {
      notify(err?.response?.data?.message || "The import failed. Please try again.", "error");
    } finally {
      setRunning(false);
    }
  };

  const canRun = tokenStatus?.isConfigured || tokenStatus?.hasCompanyTokenFallback;

  return (
    <div style={styles.backdrop} onClick={running ? undefined : onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.head}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <MdCloudDownload size={22} color={colors.blue} />
            <h3 style={styles.title}>Import HS Codes</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            style={styles.iconBtn}
            aria-label="Close"
          >
            <MdClose size={20} />
          </button>
        </div>

        <div style={styles.body}>
          <p style={styles.lead}>
            Pulls Pakistan Customs / PCT codes from FBR into this system's HS code master.
            Codes you already have are kept as they are; only codes that are new get added,
            so you can run this again whenever FBR updates the tariff.
          </p>

          <div style={styles.note}>
            This is reference data. It does <strong>not</strong> switch FBR integration on for
            any company — companies with FBR off use these codes for their item types just the same.
          </div>

          {staleBackend && (
            <div style={styles.staleBox}>
              <MdWarning size={16} color={colors.warn} style={{ flexShrink: 0 }} />
              <div>{STALE_MESSAGE}</div>
            </div>
          )}

          {/* ── Credentials ─────────────────────────────────────────── */}
          <div style={styles.section}>
            <div style={styles.sectionHead}>
              <MdKey size={16} color={colors.textSecondary} />
              <span>FBR reference token</span>
            </div>
            {tokenStatus?.isConfigured ? (
              <div style={styles.tokenRow}>
                <MdCheckCircle size={16} color={colors.ok} />
                <span>
                  Configured ({tokenStatus.preview}) · {tokenStatus.environment}
                </span>
                {canManageToken && !showTokenField && (
                  <button type="button" style={styles.linkBtn} onClick={() => setShowTokenField(true)}>
                    Replace
                  </button>
                )}
              </div>
            ) : tokenStatus?.hasCompanyTokenFallback ? (
              <div style={styles.tokenRow}>
                <MdWarning size={16} color={colors.warn} />
                <span>
                  Not set — the selected company's own FBR token will be used for this import.
                </span>
                {canManageToken && !showTokenField && (
                  <button type="button" style={styles.linkBtn} onClick={() => setShowTokenField(true)}>
                    Set one
                  </button>
                )}
              </div>
            ) : (
              <div style={styles.tokenRow}>
                <MdWarning size={16} color={colors.warn} />
                <span>
                  {canManageToken
                    ? "No token available yet. Paste one below to run the import."
                    : "No token is configured. Ask an administrator to set the FBR reference token."}
                </span>
              </div>
            )}

            {canManageToken && showTokenField && (
              <div style={styles.tokenForm}>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Paste the FBR token"
                  style={styles.input}
                  autoComplete="off"
                />
                <select
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                  style={styles.select}
                >
                  <option value="production">Production</option>
                  <option value="sandbox">Sandbox</option>
                </select>
                <button
                  type="button"
                  onClick={saveToken}
                  disabled={savingToken || !tokenInput.trim()}
                  style={styles.secondaryBtn}
                >
                  {savingToken ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </div>

          {/* ── Options ─────────────────────────────────────────────── */}
          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={createItemTypes}
              onChange={(e) => setCreateItemTypes(e.target.checked)}
              disabled={running}
            />
            <span>
              Also create an item for each new HS code
              <span style={styles.hint}>
                Named "HS Code 6109.1000" until you rename it. They are added unfavourited, so
                they stay out of the bill and challan pickers until you curate them.
              </span>
            </span>
          </label>

          {/* ── Progress / result ───────────────────────────────────── */}
          {running && (
            <div style={styles.progress}>
              <span style={styles.spinner} />
              <div>
                <strong>Importing…</strong>
                <div style={styles.hint}>
                  FBR's tariff runs to thousands of codes — this can take a minute. Leave this open.
                </div>
              </div>
            </div>
          )}

          {result && !running && (
            <div style={styles.result}>
              <div style={styles.resultTitle}>
                <MdCheckCircle size={18} color={colors.ok} /> HS Code Import Completed
              </div>
              <dl style={styles.stats}>
                <Stat label="Total records received" value={result.totalReceived} />
                <Stat label="New HS codes added" value={result.added} />
                <Stat label="Already existing" value={result.alreadyExisting} />
                <Stat label="Descriptions updated" value={result.updated} />
                <Stat label="Skipped/failed" value={result.skipped} />
                <Stat label="Items created" value={result.itemTypesCreated} />
              </dl>
              {result.source && <div style={styles.hint}>Source: {result.source}</div>}
              {result.errors?.length > 0 && (
                <ul style={styles.errors}>
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div style={styles.foot}>
          <button type="button" onClick={onClose} disabled={running} style={styles.secondaryBtn}>
            {result ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={runUomBackfill}
            disabled={running || !canRun}
            title={canRun
              ? "Asks FBR for the unit of each code that has none. The published tariff carries no units, so this is what fills them in."
              : "Needs an FBR reference token."}
            style={{ ...styles.secondaryBtn, opacity: running || !canRun ? 0.6 : 1 }}
          >
            {running ? "Working…" : "Fill missing units"}
          </button>
          <button
            type="button"
            onClick={runTariffImport}
            disabled={running}
            title="Loads Pakistan's published customs tariff, which ships with the product. No FBR token needed. Does not bring units."
            style={{ ...styles.secondaryBtn, opacity: running ? 0.6 : 1 }}
          >
            {running ? "Loading…" : "Load from published tariff"}
          </button>
          <button
            type="button"
            onClick={runImport}
            disabled={running || !canRun}
            title={canRun
              ? "Reads FBR's own catalog. Brings units as well as codes."
              : "Needs an FBR reference token. Use “Load from published tariff” instead."}
            style={{ ...styles.primaryBtn, opacity: running || !canRun ? 0.6 : 1 }}
          >
            {running ? "Importing…" : result ? "Run again" : "Import from FBR"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={styles.stat}>
      <dt style={styles.statLabel}>{label}</dt>
      <dd style={styles.statValue}>{Number(value ?? 0).toLocaleString()}</dd>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(16,24,40,0.5)", display: "flex",
    alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 1200,
  },
  modal: {
    background: "#fff", borderRadius: 14, width: "100%", maxWidth: 560,
    maxHeight: "90vh", display: "flex", flexDirection: "column",
    boxShadow: "0 18px 48px rgba(16,24,40,0.24)",
  },
  head: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "1rem 1.1rem", borderBottom: `1px solid ${colors.cardBorder}`,
  },
  title: { margin: 0, fontSize: "1.05rem", color: colors.textPrimary },
  iconBtn: {
    display: "grid", placeItems: "center", width: 36, height: 36, border: "none",
    background: "transparent", borderRadius: 8, cursor: "pointer", color: colors.textSecondary,
  },
  body: { padding: "1.1rem", overflowY: "auto", display: "grid", gap: "0.9rem" },
  lead: { margin: 0, fontSize: "0.88rem", lineHeight: 1.5, color: colors.textPrimary },
  note: {
    fontSize: "0.8rem", lineHeight: 1.45, color: colors.textPrimary,
    background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 8, padding: "0.6rem 0.75rem",
  },
  staleBox: {
    display: "flex", gap: "0.5rem", alignItems: "flex-start", fontSize: "0.83rem",
    lineHeight: 1.45, color: colors.textPrimary, background: colors.warnBg,
    border: "1px solid #f0e0b6", borderRadius: 8, padding: "0.6rem 0.75rem",
  },
  section: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.75rem" },
  sectionHead: {
    display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem",
    fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em",
    color: colors.textSecondary, marginBottom: "0.5rem",
  },
  tokenRow: {
    display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap",
    fontSize: "0.83rem", color: colors.textPrimary,
  },
  tokenForm: {
    display: "flex", gap: "0.5rem", marginTop: "0.6rem", flexWrap: "wrap",
  },
  input: {
    flex: "1 1 200px", minWidth: 0, padding: "0.5rem 0.7rem", borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`, fontSize: "0.85rem",
  },
  select: {
    padding: "0.5rem 0.7rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`,
    fontSize: "0.85rem", background: "#fff",
  },
  linkBtn: {
    border: "none", background: "transparent", color: colors.blue, cursor: "pointer",
    fontSize: "0.83rem", fontWeight: 600, padding: 0, textDecoration: "underline",
  },
  checkRow: {
    display: "flex", gap: "0.55rem", alignItems: "flex-start", fontSize: "0.85rem",
    color: colors.textPrimary, cursor: "pointer",
  },
  hint: { display: "block", fontSize: "0.78rem", color: colors.textSecondary, marginTop: "0.2rem", lineHeight: 1.4 },
  progress: {
    display: "flex", gap: "0.7rem", alignItems: "center", padding: "0.75rem",
    background: colors.warnBg, border: "1px solid #f0e0b6", borderRadius: 10, fontSize: "0.85rem",
  },
  spinner: {
    width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
    border: `2px solid ${colors.cardBorder}`, borderTopColor: colors.blue,
    animation: "spin 0.8s linear infinite",
  },
  result: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.85rem" },
  resultTitle: {
    display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700,
    fontSize: "0.92rem", color: colors.textPrimary, marginBottom: "0.6rem",
  },
  stats: {
    margin: 0, display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "0.4rem 1rem",
  },
  stat: { display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.84rem" },
  statLabel: { margin: 0, color: colors.textSecondary },
  statValue: { margin: 0, fontWeight: 700, color: colors.textPrimary, fontVariantNumeric: "tabular-nums" },
  errors: {
    margin: "0.7rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem",
    color: colors.warn, lineHeight: 1.45,
  },
  foot: {
    display: "flex", justifyContent: "flex-end", gap: "0.6rem",
    padding: "0.85rem 1.1rem", borderTop: `1px solid ${colors.cardBorder}`,
  },
  secondaryBtn: {
    padding: "0.55rem 1rem", borderRadius: 10, border: `1px solid ${colors.inputBorder}`,
    background: "#fff", color: colors.textPrimary, fontSize: "0.86rem", fontWeight: 600, cursor: "pointer",
  },
  primaryBtn: {
    padding: "0.55rem 1.2rem", borderRadius: 10, border: "none",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff",
    fontSize: "0.86rem", fontWeight: 600, cursor: "pointer",
  },
};
