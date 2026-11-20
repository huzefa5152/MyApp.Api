// Start-up requests that used to wait in a queue (performance audit 2026-11-20).
//
// A page load with a saved sign-in ran:  sign-in check  ->  companies and
// permissions  ->  the screen's own data.  The first hop buys nothing: the
// server checks the token on EVERY request, so asking for the companies and
// permissions at the same moment as the sign-in check is exactly as safe and
// one network round trip sooner (about 0.14 s warm, seconds on a cold site).
//
// Nothing about WHEN the answers are used changes. The contexts still wait for
// the sign-in check to succeed before they read anything; they then find the
// answer already on its way instead of asking for it.
//
// A result is handed out once, only to the same token that asked, and only
// while it is fresh. Every later load (after sign-in, on focus, on a company
// change) goes to the server as it always did.

const FRESH_MS = 10_000;

let boot = null;

export function startBootPrefetch(token, loaders, now = Date.now()) {
  if (!token || boot) return;
  const results = {};
  for (const [name, load] of Object.entries(loaders)) {
    const request = load();
    // The consumer attaches its own handlers; this only stops an unused
    // failure (a stale token) surfacing as an unhandled rejection.
    request.catch(() => {});
    results[name] = request;
  }
  boot = { token, startedAt: now, results };
}

// The in-flight request for `name`, or null when there is none to give:
// never started, already taken, asked for by another token, or too old.
export function takeBootPrefetch(name, token, now = Date.now()) {
  if (!boot) return null;
  if (boot.token !== token || now - boot.startedAt > FRESH_MS) {
    boot = null;
    return null;
  }
  const request = boot.results[name] ?? null;
  delete boot.results[name];
  return request;
}

export function resetBootPrefetch() {
  boot = null;
}
