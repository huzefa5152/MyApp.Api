import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  MdAdd, MdCheckCircle, MdClose, MdCloudUpload, MdDelete, MdEdit, MdError, MdInfoOutline,
  MdMenuBook, MdRestartAlt, MdWarning,
} from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import { useCompany } from "../contexts/CompanyContext";
import { notify } from "../utils/notify";
import { formStyles, modalSizes } from "../theme";
import {
  previewGdCosting, previewGdCostingManual, commitGdCosting, getImportProfiles,
} from "../api/spreadsheetImportApi";
import BillStep from "../Components/bill/BillStep";
import BillChecklist from "../Components/bill/BillChecklist";
import { billColors } from "../Components/bill/billTheme";
import GdLineEditor from "../Components/costing/GdLineEditor";
import GdReviewLines from "../Components/costing/GdReviewLines";
import {
  MODE_NEW_ARRIVALS, MODE_BACKFILL, COSTING_ANCHORS, lineProblems, blankLine, nextLineFrom,
  editorLineFrom, toLinePayload, previewLineToPayload, effectiveLeaveOut, entryChecklist,
  commitSummary, summarySentences, commitLabel, moneyText, qtyText, computeCosting,
} from "../utils/gdCostingEntry";

/**
 * Purchases → Import Costing -- bringing a customs GD's goods, and what they
 * cost, onto the books.
 *
 * Built from the bill screens' step pieces (Components/bill/BillStep and
 * BillChecklist), so it reads like New Bill:
 *   1. Company & what arrived  -- New arrivals (the monthly GD, the default) or
 *                                 the one-off Backfill of stock already there
 *   2. The GD                  -- upload the costing sheet, or type the lines
 *   3. Check the lines         -- what happens to stock for every line, with
 *                                 Fix / Leave out / Choose the item
 *   4. Bring it in             -- what will happen, in sentences, then commit
 *
 * The server decides everything that is saved. Every Check, Fix, Leave out and
 * Choose goes back to it (the hand-entry route, which keeps an uploaded file's
 * own identity via `source`), so what this screen shows is always the server's
 * answer. utils/gdCostingEntry only mirrors the line rules for instant red
 * messages while typing, and words the outcome. Commit sends the reviewed lines
 * back and never re-reads the file; the server re-checks every line it writes.
 */

const card = {
  background: "#fff", border: `1px solid ${billColors.cardBorder}`, borderRadius: 12,
  padding: "0.9rem 1rem", marginBottom: "0.85rem",
};

const btn = (color, disabled) => ({
  display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0.55rem 1rem",
  borderRadius: 9, border: "none", background: disabled ? "#c8d1de" : color, color: "#fff",
  fontWeight: 700, fontSize: 14, cursor: disabled ? "not-allowed" : "pointer", boxShadow: "none",
});

const ghostBtn = (color) => ({
  display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0.5rem 0.9rem",
  borderRadius: 9, border: `1px solid ${color}55`, background: "#fff", color,
  fontWeight: 700, fontSize: 13.5, cursor: "pointer", boxShadow: "none",
});

const segBtn = (active) => ({
  display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0.55rem 0.95rem",
  borderRadius: 9, border: `1px solid ${active ? billColors.blue : billColors.cardBorder}`,
  background: active ? billColors.blue : "#fff", color: active ? "#fff" : billColors.textPrimary,
  fontWeight: 700, fontSize: 13.5, cursor: "pointer", boxShadow: "none",
});

const selectStyle = {
  width: "100%", maxWidth: 420, minHeight: 44, padding: "0.5rem 0.65rem", borderRadius: 8,
  border: `1px solid ${billColors.inputBorder}`, background: billColors.inputBg, fontSize: 14,
};

function Banner({ tone = "warn", children }) {
  const c = {
    error: [billColors.danger, billColors.dangerLight, MdError],
    warn: [billColors.warn, billColors.warnLight, MdWarning],
    info: [billColors.blue, billColors.blueSoft, MdInfoOutline],
    ok: [billColors.success, billColors.successLight, MdCheckCircle],
  }[tone];
  const Icon = c[2];
  return (
    <div role={tone === "error" ? "alert" : undefined} style={{
      display: "flex", gap: 9, padding: "0.65rem 0.8rem", borderRadius: 9, background: c[1],
      borderLeft: `3px solid ${c[0]}`, marginBottom: "0.55rem", fontSize: 13.5, lineHeight: 1.45,
    }}>
      <Icon size={18} style={{ color: c[0], flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

// The two import modes, said in full: which act is being performed is the most
// consequential choice on the screen (GD_IMPORT_COSTING_GUIDE.md §3).
function ModeCard({ active, title, body, onPick, disabled, tone = billColors.blue }) {
  return (
    <label style={{
      display: "flex", gap: 10, alignItems: "flex-start", padding: "0.7rem 0.8rem", borderRadius: 10,
      border: `1px solid ${active ? tone : billColors.cardBorder}`, background: active ? `${tone}0f` : "#fff",
      cursor: disabled ? "not-allowed" : "pointer", minHeight: 44, boxSizing: "border-box",
    }}>
      <input type="radio" name="gdCostingMode" checked={active} disabled={disabled} onChange={onPick}
        aria-label={title} style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }} />
      <span>
        <span style={{ display: "block", fontWeight: 800, fontSize: 14 }}>{title}</span>
        <span style={{ display: "block", fontSize: 12.5, color: billColors.textSecondary, marginTop: 2 }}>{body}</span>
      </span>
    </label>
  );
}

const hasContent = (m) =>
  ["description", "hsCode", "quantity", "assessedValue"].some((k) => String(m?.[k] ?? "").trim() !== "");

export default function GdCostingImportPage() {
  const { has, isSeedAdmin, permissions } = usePermissions();
  const { companies, selectedCompany } = useCompany();
  const canRun = has("importcosting.sheet.run");
  const canSeeConsignments = has("importcosting.consignments.view");
  const canSeeStock = isSeedAdmin || [...(permissions || [])].some((k) => String(k).startsWith("stock."));

  const [companyId, setCompanyId] = useState(selectedCompany?.id ? String(selectedCompany.id) : "");
  const [mode, setMode] = useState(MODE_NEW_ARRIVALS);
  const [showBackfill, setShowBackfill] = useState(false);
  const [entry, setEntry] = useState("file");

  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState("");

  const [typed, setTyped] = useState(blankLine);
  const [typedShowAll, setTypedShowAll] = useState(false);
  const [staged, setStaged] = useState([]);

  const [preview, setPreview] = useState(null);
  const [source, setSource] = useState(null);
  const [sheetNotes, setSheetNotes] = useState([]);
  const [leaveOutChoice, setLeaveOutChoice] = useState({});
  const [chosenItem, setChosenItem] = useState({});
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [fixing, setFixing] = useState(null);

  const company = (companies || []).find((c) => String(c.id) === String(companyId));

  // The footer is FIXED to the bottom of the window, over this page's own
  // column. It cannot be `sticky`: the layout's .dl-main sets overflow-x, which
  // makes it a scroll container that never scrolls, so a sticky footer stayed
  // at the foot of a 5,000px page with the save button out of sight. The
  // column is measured so the bar never covers the sidebar.
  const pageRef = useRef(null);
  const [barBox, setBarBox] = useState(null);
  useLayoutEffect(() => {
    // The layout's own content area (padding included), so the bar reaches
    // its edges; the bar's contents are kept to this page's width inside it.
    const el = pageRef.current?.closest("main") || pageRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBarBox((b) => (b && b.left === r.left && b.width === r.width ? b : { left: r.left, width: r.width }));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  // And after every render: cheap, and it catches a sidebar that opened or
  // folded without the page itself changing size.
  useLayoutEffect(() => {
    const el = pageRef.current?.closest("main") || pageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBarBox((b) => (b && b.left === r.left && b.width === r.width ? b : { left: r.left, width: r.width }));
  });

  useEffect(() => {
    if (selectedCompany?.id && !companyId) setCompanyId(String(selectedCompany.id));
  }, [selectedCompany, companyId]);

  const clearReview = useCallback(() => {
    setPreview(null); setSource(null); setSheetNotes([]); setLeaveOutChoice({}); setChosenItem({});
    setStale(false); setFixing(null);
  }, []);

  const resetAll = useCallback(() => {
    clearReview(); setResult(null); setFile(null); setFileKey((k) => k + 1);
    setTyped(blankLine()); setTypedShowAll(false); setStaged([]);
  }, [clearReview]);

  useEffect(() => { resetAll(); }, [companyId, resetAll]);

  // The one built-in workbook layout, resolved quietly -- nothing to choose.
  useEffect(() => {
    let cancelled = false;
    setProfile(null); setProfileError("");
    if (!companyId) return undefined;
    getImportProfiles({ kind: "GdCosting", companyId })
      .then(({ data }) => {
        if (cancelled) return;
        const chosen = (data || []).find((p) => p.isDefault) || (data || [])[0] || null;
        setProfile(chosen);
        if (!chosen) setProfileError("No GD costing layout is set up yet. Ask an administrator to check the import profiles.");
      })
      .catch(() => { if (!cancelled) setProfileError("Could not load the GD costing layout. Reload the page and try again."); });
    return () => { cancelled = true; };
  }, [companyId]);

  /**
   * Every reviewed line back to the server with the review's decisions --
   * `edits` replaces lines by row (a Fix). The screen's own leave-out default
   * depends on the server's answer (Backfill leaves a line with nothing to
   * price out), so when an answer changes it, the server is asked once more.
   */
  const recheck = useCallback(async ({ base, edits = {}, modeNow, leave, chosen, src }) => {
    const build = (pv, withEdits) => (pv.lines || []).map((l) => {
      const extra = {
        sourceRow: l.sourceRow,
        leaveOut: effectiveLeaveOut(l, modeNow, leave),
        chosenOpeningStockBalanceId: chosen[l.sourceRow] ?? null,
      };
      return withEdits[l.sourceRow] ? toLinePayload(withEdits[l.sourceRow], extra) : previewLineToPayload(l, extra);
    });
    let pv = base;
    let pending = edits;
    for (let pass = 0; pass < 2; pass++) {
      const { data } = await previewGdCostingManual({ companyId, lines: build(pv, pending), mode: modeNow, source: src });
      pv = data;
      pending = {};
      if ((pv.lines || []).every((l) => l.leaveOut === effectiveLeaveOut(l, modeNow, leave))) break;
    }
    return pv;
  }, [companyId]);

  // One wrapper for every server round trip from the review: the preview on
  // screen is replaced only by a complete answer.
  const run = async (label, fn) => {
    setBusy(label);
    try {
      const pv = await fn();
      if (pv) setPreview(pv);
      return true;
    } catch {
      return false; // httpClient already told the operator
    } finally {
      setBusy("");
    }
  };

  const settleDefaults = (data, src, modeNow) =>
    (data.lines || []).some((l) => l.leaveOut !== effectiveLeaveOut(l, modeNow, {}))
      ? recheck({ base: data, modeNow, leave: {}, chosen: {}, src })
      : data;

  const onCheckFile = () => run("preview", async () => {
    setResult(null);
    const { data } = await previewGdCosting({ file, companyId, profileId: profile?.id, mode });
    const src = {
      fileName: data.fileName, fileSha256: data.fileSha256, fileSizeBytes: data.fileSizeBytes,
      importProfileId: data.importProfileId, profileVersion: data.profileVersion,
    };
    setSource(src); setSheetNotes(data.warnings || []); setLeaveOutChoice({}); setChosenItem({}); setStale(false);
    return settleDefaults(data, src, mode);
  });

  const typedLines = () => [...staged, ...(hasContent(typed) ? [typed] : [])];

  const onCheckTyped = () => {
    const lines = typedLines();
    if (lines.length === 0) { setTypedShowAll(true); return Promise.resolve(false); }
    return run("preview", async () => {
      setResult(null);
      const payload = lines.map((m, i) => toLinePayload(m, { sourceRow: i + 1 }));
      const { data } = await previewGdCostingManual({ companyId, lines: payload, mode });
      // What was in the form is now line N of the list, so the list and the
      // review describe the same lines.
      if (hasContent(typed)) { setStaged(lines); setTyped(nextLineFrom(typed)); setTypedShowAll(false); }
      setSource(null); setSheetNotes([]); setLeaveOutChoice({}); setChosenItem({}); setStale(false);
      return settleDefaults(data, null, mode);
    });
  };

  const onAddLine = () => {
    if (lineProblems(typed).length > 0) { setTypedShowAll(true); return; }
    setStaged((s) => [...s, typed]);
    setTyped(nextLineFrom(typed));
    setTypedShowAll(false);
    if (preview) setStale(true);
  };

  const onEditStaged = (i) => {
    setStaged((s) => {
      const rest = s.filter((_, x) => x !== i);
      return hasContent(typed) ? [...rest, typed] : rest;
    });
    setTyped({ ...staged[i] });
    if (preview) setStale(true);
  };

  const onRemoveStaged = (i) => {
    setStaged((s) => s.filter((_, x) => x !== i));
    if (preview) setStale(true);
  };

  const onMode = (next) => {
    if (next === mode) return;
    setMode(next);
    if (next === MODE_BACKFILL) setShowBackfill(true);
    if (preview && !stale)
      run("recheck", () => recheck({ base: preview, modeNow: next, leave: leaveOutChoice, chosen: chosenItem, src: source }));
  };

  const onToggleLeaveOut = (line, value) => {
    const leave = { ...leaveOutChoice, [line.sourceRow]: value };
    setLeaveOutChoice(leave);
    run("recheck", () => recheck({ base: preview, modeNow: mode, leave, chosen: chosenItem, src: source }));
  };

  const onChoose = (line, balanceId) => {
    const chosen = { ...chosenItem };
    if (balanceId) chosen[line.sourceRow] = balanceId; else delete chosen[line.sourceRow];
    setChosenItem(chosen);
    run("recheck", () => recheck({ base: preview, modeNow: mode, leave: leaveOutChoice, chosen, src: source }));
  };

  const onFix = (line) => setFixing({ sourceRow: line.sourceRow, draft: editorLineFrom(line), problems: line.problems || [] });

  const onSaveFix = async () => {
    const { sourceRow, draft } = fixing;
    const ok = await run("recheck", () => recheck({
      base: preview, edits: { [sourceRow]: draft }, modeNow: mode, leave: leaveOutChoice, chosen: chosenItem, src: source,
    }));
    if (!ok) return;
    // A typed GD's list follows the fix, so going back to it shows the same line.
    if (!source) setStaged((s) => s.map((m, i) => (i + 1 === sourceRow ? { ...draft } : m)));
    setFixing(null);
  };

  const onCommit = () => run("commit", async () => {
    const { data } = await commitGdCosting({
      companyId: Number(companyId),
      importProfileId: preview.importProfileId,
      profileVersion: preview.profileVersion,
      fileSha256: preview.fileSha256,
      fileName: preview.fileName,
      fileSizeBytes: preview.fileSizeBytes,
      lines: preview.lines,
      createMissingStock: true,
      mode,
    });
    setResult(data);
    clearReview(); setFile(null); setFileKey((k) => k + 1);
    setTyped(blankLine()); setStaged([]); setTypedShowAll(false);
    notify("Imported.", "success");
    return null;
  });

  const checklist = useMemo(
    () => entryChecklist({ companyId, preview, stale }),
    [companyId, preview, stale],
  );
  const summary = useMemo(() => (preview ? commitSummary(preview, mode) : null), [preview, mode]);
  const ready = !!preview && checklist.length === 0 && !busy;

  if (!canRun) {
    return (
      <div style={{ padding: "1.5rem" }}>
        <Banner tone="warn">You do not have permission to run a GD costing import.</Banner>
      </div>
    );
  }

  // ── step statuses and summaries ─────────────────────────────────────────
  const modeText = mode === MODE_NEW_ARRIVALS ? "New goods arrived" : "One-off: pricing stock already on the books";
  const step1 = companyId ? "done" : "todo";
  const step2 = preview && !stale ? "done" : stale ? "warn" : "todo";
  const lineIssues = checklist.filter((i) => i.key.startsWith("line-") || i.key.startsWith("blocking-") || i.key === "all-out");
  const step3 = !preview ? "todo" : lineIssues.length > 0 ? "warn" : "done";
  const typedCount = typedLines().length;
  const lines = preview?.lines || [];
  const fixCount = lines.filter((l) => !l.leaveOut && (l.problems || []).length > 0).length;
  const leftCount = lines.filter((l) => l.leaveOut).length;
  const notes = source ? sheetNotes : (preview?.warnings || []);

  return (
    <div ref={pageRef} style={{ padding: "1.1rem clamp(0.75rem, 2vw, 1.25rem) 7.5rem", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 0.25rem", color: billColors.textPrimary }}>Import Costing</h1>
      <p style={{ margin: "0 0 0.35rem", color: billColors.textSecondary, fontSize: 14, maxWidth: "68ch" }}>
        Bring a customs GD's goods and their landed cost onto the books. Every line is checked first,
        and nothing is saved until you press the button at the bottom.
      </p>
      <Link to="/guides/import" style={{
        display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700,
        color: billColors.blue, textDecoration: "none", marginBottom: "0.8rem", minHeight: 44,
      }}>
        <MdMenuBook size={16} aria-hidden="true" /> How to use this
      </Link>

      {result && (
        <div style={card}>
          <Banner tone="ok"><strong>Imported.</strong> The GD is recorded and its stock is on the books.</Banner>
          <div style={{ display: "grid", gap: "0.6rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", margin: "0.3rem 0 0.6rem" }}>
            {[
              ["GDs recorded", result.consignmentsWritten],
              ["Lines recorded", result.linesWritten],
              ["Items given stock or cost", result.balancesCosted],
              ["New items created", result.itemTypesCreated],
              ["Lines left out", result.linesSkipped],
              ["Landed cost", moneyText(result.totalCostExcludingTax)],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 12, color: billColors.textSecondary }}>{k}</div>
                <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{v}</div>
              </div>
            ))}
          </div>
          {(result.messages || []).length > 0 && (
            <ul style={{ margin: "0.2rem 0 0", paddingLeft: "1.2rem", fontSize: 13, lineHeight: 1.6 }}>
              {result.messages.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "0.7rem" }}>
            <button type="button" onClick={resetAll} style={btn(billColors.teal, false)}>
              <MdRestartAlt size={18} /> Import another GD
            </button>
            {canSeeConsignments && <Link to="/imports/consignments" style={{ ...ghostBtn(billColors.blue), textDecoration: "none" }}>Open Consignments</Link>}
            {canSeeStock && <Link to="/stock" style={{ ...ghostBtn(billColors.blue), textDecoration: "none" }}>See stock on hand</Link>}
          </div>
        </div>
      )}

      {/* 1 ── Company and what arrived ─────────────────────────────────── */}
      <BillStep id={COSTING_ANCHORS.company} n={1} title="Company & what arrived" status={step1}
        summary={company ? <><strong>{company.name}</strong><span>· {modeText}</span></> : null}
        help="Choose whose books this GD goes on, and say what the GD is. Almost every GD is new goods arriving.">
        <div style={{ display: "grid", gap: "0.8rem" }}>
          <div>
            <label htmlFor="costing-company" style={{ display: "block", fontSize: 13, color: billColors.textSecondary, marginBottom: 4 }}>
              Company<span aria-hidden="true" style={{ color: billColors.danger, marginLeft: 3 }}>*</span>
            </label>
            <select id="costing-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}
              disabled={!!busy} style={selectStyle}>
              <option value="">Choose a company…</option>
              {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <ModeCard active={mode === MODE_NEW_ARRIVALS} disabled={!!busy} onPick={() => onMode(MODE_NEW_ARRIVALS)}
            tone={billColors.success}
            title="New goods arrived on this GD"
            body="The monthly case. Each line adds its quantity, landed cost and selling value to the item it matches; a line that matches nothing becomes a new item." />

          {!showBackfill && mode !== MODE_BACKFILL ? (
            <button type="button" onClick={() => setShowBackfill(true)} disabled={!!busy}
              style={{ ...ghostBtn(billColors.textSecondary), justifySelf: "start", fontWeight: 600 }}>
              One-off: price stock that is already on the books…
            </button>
          ) : (
            <div>
              <ModeCard active={mode === MODE_BACKFILL} disabled={!!busy} onPick={() => onMode(MODE_BACKFILL)}
                tone={billColors.warn}
                title="One-off: these goods are already on the books"
                body="For loading the history once. A matched line SETS the item's actual cost from this GD's unit cost; quantities do not move. Never use it for a new month's GD: the new units would never appear." />
              {mode === MODE_BACKFILL && (
                <div style={{ marginTop: "0.5rem" }}>
                  <Banner tone="warn">
                    Backfill replaces any actual cost already recorded on the items it matches, and lines
                    with nothing on the books are left out unless you bring them in.
                  </Banner>
                </div>
              )}
            </div>
          )}
        </div>
      </BillStep>

      {/* 2 ── The GD ───────────────────────────────────────────────────── */}
      <BillStep id={COSTING_ANCHORS.gd} n={2} title="The GD" status={step2}
        summary={preview && !stale
          ? <span>{source ? source.fileName : `${lines.length} typed line${lines.length === 1 ? "" : "s"}`} · checked</span>
          : null}
        notice={stale ? <Banner tone="warn">You changed the lines after checking them. Press <strong>Check</strong> again before bringing them in.</Banner> : null}
        help="Upload the GD costing sheet your accountant keeps, or type the GD's lines off the paper. Either way, Check shows what will happen before anything is saved.">
        {!companyId ? (
          <Banner tone="info">Choose the company first.</Banner>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "0.8rem" }}>
              <button type="button" onClick={() => { setEntry("file"); clearReview(); }} disabled={!!busy} style={segBtn(entry === "file")}>
                <MdCloudUpload size={17} /> Upload the costing sheet
              </button>
              <button type="button" onClick={() => { setEntry("type"); clearReview(); }} disabled={!!busy} style={segBtn(entry === "type")}>
                <MdEdit size={17} /> Type the GD
              </button>
            </div>

            {entry === "file" ? (
              <div>
                <label htmlFor="costing-file" style={{ display: "block", fontSize: 13, color: billColors.textSecondary, marginBottom: 4 }}>
                  GD costing workbook (.xls, .xlsx, .xlsm)
                </label>
                <input id="costing-file" key={fileKey} type="file" accept=".xls,.xlsx,.xlsm" disabled={!!busy}
                  onChange={(e) => { setFile(e.target.files?.[0] || null); clearReview(); }}
                  style={{ ...selectStyle, padding: "0.5rem", maxWidth: 520 }} />
                <p style={{ margin: "0.45rem 0 0", fontSize: 12.5, color: billColors.textSecondary }}>
                  Close the file in Excel first. Every line needs its GD number and date, item name, HS code,
                  quantity, unit and assessed value.{" "}
                  <a href={`${import.meta.env.BASE_URL || "/"}templates/gd-costing-template.xlsx`} download
                    style={{ color: billColors.blue, fontWeight: 700 }}>
                    Download the sample sheet
                  </a>{" "}(filled-in rows and a sheet explaining every column).
                </p>
                {profileError && <div style={{ marginTop: "0.5rem" }}><Banner tone="error">{profileError}</Banner></div>}
                {profile && (
                  <p style={{ margin: "0.35rem 0 0", fontSize: 12, color: billColors.textSecondary }}>
                    Layout: {profile.name} (v{profile.currentVersion})
                  </p>
                )}
                <div style={{ marginTop: "0.8rem" }}>
                  <button type="button" onClick={onCheckFile}
                    disabled={!file || !profile || !!busy}
                    style={btn(billColors.blue, !file || !profile || !!busy)}>
                    <MdCloudUpload size={18} /> {busy === "preview" ? "Checking…" : "Check the sheet"}
                  </button>
                  {!file && <span style={{ marginLeft: 10, fontSize: 12.5, color: billColors.textSecondary }}>Choose the workbook first.</span>}
                </div>
              </div>
            ) : (
              <div>
                <GdLineEditor companyId={companyId} line={typed} showAll={typedShowAll} disabled={!!busy}
                  onChange={(patch) => { setTyped((m) => ({ ...m, ...patch })); if (preview) setStale(true); }}
                  idPrefix="typed" />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "0.8rem" }}>
                  <button type="button" onClick={onAddLine} disabled={!!busy} style={ghostBtn(billColors.blue)}>
                    <MdAdd size={18} /> Add line and type the next
                  </button>
                  <button type="button" onClick={onCheckTyped} disabled={!!busy || typedCount === 0}
                    style={btn(billColors.blue, !!busy || typedCount === 0)}>
                    <MdCloudUpload size={18} />
                    {busy === "preview" ? "Checking…" : typedCount > 0 ? `Check ${typedCount} line${typedCount === 1 ? "" : "s"}` : "Check"}
                  </button>
                </div>
                {staged.length > 0 && (
                  <div style={{ marginTop: "0.9rem" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: billColors.textSecondary, marginBottom: 6 }}>
                      Lines added ({staged.length})
                    </div>
                    {staged.map((m, i) => (
                      <div key={i} style={{
                        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem 0.8rem",
                        padding: "0.45rem 0.6rem", border: `1px solid ${billColors.cardBorder}`, borderRadius: 9, marginBottom: 6,
                      }}>
                        <span style={{ fontWeight: 800, color: billColors.textSecondary, minWidth: 28 }}>{i + 1}</span>
                        <span style={{ flex: "1 1 200px", minWidth: 0, fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {m.description || "(no item name)"}
                        </span>
                        <span style={{ fontSize: 12.5, color: billColors.textSecondary }}>
                          {m.gdNumber || "no GD"} · HS {m.hsCode || "—"} · {qtyText(m.quantity)} {m.unit}
                        </span>
                        <span style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{moneyText(computeCosting(m).cost)}</span>
                        <span style={{ display: "flex", gap: 6 }}>
                          <button type="button" onClick={() => onEditStaged(i)} disabled={!!busy} style={ghostBtn(billColors.blue)}>
                            <MdEdit size={16} /> Edit
                          </button>
                          <button type="button" onClick={() => onRemoveStaged(i)} disabled={!!busy} style={ghostBtn(billColors.danger)}
                            aria-label={`Remove line ${i + 1}`}>
                            <MdDelete size={16} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </BillStep>

      {/* 3 ── Check the lines ──────────────────────────────────────────── */}
      <BillStep id={COSTING_ANCHORS.review} n={3} title="Check the lines" status={step3}
        summary={preview ? (
          <span>
            {lines.length} line{lines.length === 1 ? "" : "s"}
            {fixCount > 0 && <strong style={{ color: billColors.danger }}> · {fixCount} to fix</strong>}
            {leftCount > 0 && <span> · {leftCount} left out</span>}
          </span>
        ) : <span style={{ color: billColors.textSecondary }}>Opens when the GD is checked</span>}
        help={preview
          ? "Each line says what will happen to your stock. Fix anything in red, choose the item where several share a code, or leave a line out: its goods then will not come in."
          : null}>
        {preview && (
          <>
            {(preview.blockingErrors || []).map((e, i) => <Banner key={i} tone="error">{e}</Banner>)}
            {(preview.overwriteWarningCount > 0 || preview.costPlausibilityWarningCount > 0 || preview.rateWarningCount > 0) && (
              <Banner tone="warn">
                Worth a look before bringing it in (the lines say why):
                {preview.overwriteWarningCount > 0 && <> {preview.overwriteWarningCount} will REPLACE an actual cost recorded earlier.</>}
                {preview.costPlausibilityWarningCount > 0 && <> {preview.costPlausibilityWarningCount} would write a cost that does not fit the stock it lands on.</>}
                {preview.rateWarningCount > 0 && <> {preview.rateWarningCount} carry a rate above 50%, usually a "1" meant as 1%.</>}
              </Banner>
            )}
            {notes.length > 0 && (
              <details style={{ marginBottom: "0.7rem" }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: billColors.textSecondary, minHeight: 32 }}>
                  Notes from reading the sheet ({notes.length})
                </summary>
                <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem", fontSize: 12.5, color: billColors.textSecondary }}>
                  {notes.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </details>
            )}
            {busy === "recheck" && <Banner tone="info">Checking again…</Banner>}
            {/* A stale review describes lines that no longer exist as typed:
                acting on it would re-check the old ones. */}
            <GdReviewLines preview={preview} mode={mode} busy={!!busy || stale}
              onFix={onFix} onToggleLeaveOut={onToggleLeaveOut} onChoose={onChoose} />
          </>
        )}
      </BillStep>

      {/* 4 ── Bring it in ──────────────────────────────────────────────── */}
      <BillStep id={COSTING_ANCHORS.commit} n={4} title="Bring it in" status={ready ? "done" : "todo"}
        summary={summary ? <span>{moneyText(summary.totalCost)} landed cost</span> : <span style={{ color: billColors.textSecondary }}>After the check</span>}>
        {summary ? (
          <div>
            <ul style={{ margin: "0 0 0.6rem", paddingLeft: "1.2rem", fontSize: 14, lineHeight: 1.6 }}>
              {summarySentences(summary).map((s, i) => <li key={i}>{s}</li>)}
            </ul>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1.2rem", fontSize: 13.5 }}>
              <span>Landed cost <strong style={{ fontVariantNumeric: "tabular-nums" }}>{moneyText(summary.totalCost)}</strong></span>
              <span>Selling value <strong style={{ fontVariantNumeric: "tabular-nums" }}>{moneyText(summary.totalSelling)}</strong></span>
            </div>
            {mode === MODE_NEW_ARRIVALS && (
              <p style={{ margin: "0.5rem 0 0", fontSize: 12.5, color: billColors.textSecondary }}>
                When the company keeps its ledger here, each GD also posts one journal entry, dated the GD's own date.
              </p>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: billColors.textSecondary }}>Check the GD first: this step then says exactly what will be saved.</p>
        )}
      </BillStep>

      {/* The footer: what is left, and the one button that saves. */}
      <div data-costing-footer style={{
        position: "fixed", bottom: 0, zIndex: 30,
        left: barBox ? barBox.left : 0, width: barBox ? barBox.width : "100%", boxSizing: "border-box",
        padding: "0.6rem clamp(0.75rem, 2vw, 1.25rem) 0.7rem", background: "#fff",
        borderTop: `1px solid ${billColors.cardBorder}`, boxShadow: "0 -6px 18px rgba(13,71,161,0.08)",
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center",
          gap: "0.5rem 0.8rem",
        }}>
          <BillChecklist items={checklist} readyText="Ready to bring in" />
          <button type="button" onClick={onCommit} disabled={!ready}
            style={{ ...btn(billColors.success, !ready), marginLeft: "auto" }}>
            <MdCheckCircle size={18} />
            {busy === "commit" ? "Saving…" : summary ? commitLabel(summary) : "Bring into stock"}
          </button>
        </div>
      </div>

      {fixing && (
        <div style={formStyles.backdrop} role="dialog" aria-modal="true" aria-labelledby="fix-title">
          <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }}>
            <div style={formStyles.header}>
              <h2 id="fix-title" style={formStyles.title}>Fix row {fixing.sourceRow}</h2>
              <button type="button" onClick={() => setFixing(null)} style={formStyles.closeButton} aria-label="Close">
                <MdClose size={18} />
              </button>
            </div>
            <div style={formStyles.body}>
              <GdLineEditor companyId={companyId} line={fixing.draft} showAll serverProblems={fixing.problems}
                disabled={busy === "recheck"} idPrefix={`fix-${fixing.sourceRow}`}
                onChange={(patch) => setFixing((f) => ({ ...f, draft: { ...f.draft, ...patch }, problems: [] }))} />
            </div>
            <div style={formStyles.footer}>
              <span style={{ marginRight: "auto", fontSize: 12.5, color: billColors.textSecondary }}>
                {lineProblems(fixing.draft).length > 0
                  ? `Still needed: ${lineProblems(fixing.draft).map((p) => p.message.replace(/\.$/, "")).join("; ")}.`
                  : "The line is complete. Saving checks it on the server again."}
              </span>
              <button type="button" onClick={() => setFixing(null)} style={formStyles.cancel}>Cancel</button>
              <button type="button" onClick={onSaveFix} disabled={busy === "recheck"}
                style={{ ...formStyles.button, minHeight: 44 }}>
                {busy === "recheck" ? "Checking…" : "Save and check again"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
