import axios from "axios";

/**
 * Service continuity: keeps an open page working through a short service
 * pause (a deploy) or a dropped connection, so the operator's work simply
 * resumes when the server is reachable again.
 *
 * - The deploy's offline page (`.github/offline/app_offline.htm`) is served by
 *   IIS with a 503 and carries the `erp-service-paused` marker. A request that
 *   received it never reached the application, so replaying it after recovery
 *   cannot do anything twice. Those requests wait and are replayed.
 * - A request that got no answer at all may or may not have been processed.
 *   Reads (GET/HEAD) are replayed; writes are NOT: after recovery they fail
 *   with a plain message and the operator decides. FBR calls are never
 *   replayed, whichever way they failed.
 * - New requests made while paused wait for recovery instead of failing.
 * - Recovery is detected with a cheap API call that answers without a login.
 * - When a new version has been published, it is picked up on the operator's
 *   NEXT page change (a normal page load), never by reloading the page they
 *   are working on.
 *
 * Nothing here is visible as an "update": the only UI is ReconnectingNotice.
 */

const MARKER = "erp-service-paused";
const MAX_REPLAYS = 3;
const POLL_STEPS_MS = [1500, 3000, 5000, 8000, 10000];

let paused = false;
let pausedSince = 0;
let probeUrl = "";
let resumeWaiters = [];
const listeners = new Set();

export function getContinuityState() {
  return { paused, pausedSince };
}

export function subscribeContinuity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const state = getContinuityState();
  listeners.forEach((fn) => { try { fn(state); } catch { /* a listener must not break the client */ } });
}

/** The offline page answered: IIS replied, the application never saw the request. */
export function isServicePause(error) {
  const response = error?.response;
  if (!response || response.status !== 503) return false;
  const body = typeof response.data === "string" ? response.data : "";
  return body.includes(MARKER);
}

/** No answer at all: offline, DNS, the server going away mid-request. Not a timeout. */
export function isConnectionDrop(error) {
  return !!error && !error.response && !axios.isCancel(error) && error.code !== "ECONNABORTED"
    && error.code !== "ETIMEDOUT";
}

function isRead(config) {
  return ["get", "head", "options"].includes(String(config?.method || "get").toLowerCase());
}

function isFbrCall(config) {
  return /\/fbr(\/|$)|\/fbr-/i.test(String(config?.url || ""));
}

async function serviceAnswers() {
  try {
    const response = await axios.get(probeUrl, {
      timeout: 8000, validateStatus: () => true, headers: { "Cache-Control": "no-store" },
      params: { _: Date.now() },
    });
    const body = typeof response.data === "string" ? response.data : "";
    return !(response.status === 503 && body.includes(MARKER)) && response.status < 500;
  } catch {
    return false;
  }
}

async function pollUntilBack() {
  let step = 0;
  while (paused) {
    await new Promise((resolve) => setTimeout(resolve, POLL_STEPS_MS[Math.min(step, POLL_STEPS_MS.length - 1)]));
    step += 1;
    if (await serviceAnswers()) {
      paused = false;
      const waiters = resumeWaiters;
      resumeWaiters = [];
      emit();
      waiters.forEach((resolve) => resolve());
      checkForNewVersion();
    }
  }
}

function enterPause() {
  if (paused) return;
  paused = true;
  pausedSince = Date.now();
  emit();
  pollUntilBack();
}

/** Resolves once the service answers again (immediately when it already does). */
export function whenServiceAvailable() {
  if (!paused) return Promise.resolve();
  return new Promise((resolve) => resumeWaiters.push(resolve));
}

function interruptedWriteError(error) {
  const message = "The connection was interrupted before this could be confirmed. Check whether it was saved, then try again.";
  error.response = { status: 0, data: { message, error: message }, headers: {}, config: error.config };
  error.message = message;
  return error;
}

/**
 * Wire continuity into an axios instance. Call BEFORE the instance's own
 * interceptors are registered, so a pause is handled before any generic
 * error handling sees it.
 */
export function installServiceContinuity(client, { probePath }) {
  probeUrl = probePath;

  // New requests made while paused wait for the service instead of failing.
  client.interceptors.request.use(async (config) => {
    if (paused && !config._continuityProbe) await whenServiceAvailable();
    return config;
  });

  client.interceptors.response.use((response) => response, async (error) => {
    const config = error?.config;
    if (!config) throw error;
    const pausedReply = isServicePause(error);
    const dropped = !pausedReply && isConnectionDrop(error);
    if (!pausedReply && !dropped) throw error;
    if (isFbrCall(config) && !isRead(config)) throw error;

    enterPause();
    await whenServiceAvailable();

    const replays = config._continuityReplays || 0;
    if (replays >= MAX_REPLAYS) throw error;
    if (pausedReply || isRead(config)) {
      config._continuityReplays = replays + 1;
      return client.request(config);
    }
    throw interruptedWriteError(error);
  });
}

// ── New versions ───────────────────────────────────────────────────────

const VERSION_URL = `${(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/")}version.json`;
let loadedVersion = null;
let updateReady = false;

async function readPublishedVersion() {
  try {
    const response = await axios.get(VERSION_URL, { params: { _: Date.now() }, timeout: 8000, headers: { "Cache-Control": "no-store" } });
    return typeof response.data?.version === "string" ? response.data.version : null;
  } catch {
    return null; // absent in development, or unreachable: nothing to compare
  }
}

export async function checkForNewVersion() {
  if (updateReady) return;
  const published = await readPublishedVersion();
  if (!published) return;
  if (loadedVersion == null) { loadedVersion = published; return; }
  if (published !== loadedVersion) updateReady = true;
}

/**
 * The next in-app navigation becomes a normal page load of the same address,
 * so a published version is picked up between pages — never while the
 * operator is on one.
 */
function applyUpdateOnNextNavigation() {
  const original = window.history.pushState.bind(window.history);
  window.history.pushState = (state, title, url) => {
    if (updateReady && url != null) {
      window.location.assign(String(url));
      return;
    }
    original(state, title, url);
  };
}

/** A lazily loaded screen failed to download: wait for the service, then load the address normally. */
function recoverFailedScreenLoads() {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    enterPause();
    whenServiceAvailable().then(() => window.location.reload());
  });
}

export function startVersionWatch() {
  checkForNewVersion();
  applyUpdateOnNextNavigation();
  recoverFailedScreenLoads();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForNewVersion(); });
  setInterval(checkForNewVersion, 10 * 60 * 1000);
}
