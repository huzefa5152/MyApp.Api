// Offline checks that every screen is behind a permission — no backend, no DB:
//   node scripts/test_route_permissions.mjs
//
// Hiding a sidebar link is not access control. Before the route guard existed,
// typing /chart-of-accounts on a role without `accounting.coa.view` mounted the
// page and filled it with 403s. `Components/RequirePermission.jsx` now refuses
// first, and `config/routePermissions.js` is where that decision is recorded.
//
// The thing worth pinning is not the guard's rendering — it is that the map and
// the router cannot drift apart. A screen added to App.jsx without an entry
// here would fail CLOSED at runtime (correct, but discovered by an operator);
// these checks make it fail at the keyboard instead. The reverse matters too: a
// key that no longer exists in the backend catalog gates a screen shut forever,
// because no role can ever hold it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ROUTE_PERMISSIONS, permissionForPath } from "../myapp-frontend/src/config/routePermissions.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

let passed = 0, failed = 0;
const fails = [];
function check(label, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; fails.push(`${label} — ${detail}`); console.log(`  FAIL  ${label}  (${detail})`); }
}

// ── The routes the router actually serves ────────────────────────────────────
const appJsx = readFileSync(join(repo, "myapp-frontend/src/App.jsx"), "utf8");
// Only the block inside <Route element={<RequirePermission />}> … </Route>,
// because the public routes (landing, login) and the catch-all are
// deliberately outside it. Found by walking the JSX and tracking depth, so a
// route added after the guard cannot be mistaken for one inside it.
function guardedBlock(src) {
  const open = src.indexOf("<Route element={<RequirePermission />}>");
  if (open < 0) return "";
  const start = open + "<Route element={<RequirePermission />}>".length;
  const tag = /<Route[^>]*?(\/?)>|<\/Route>/g;
  tag.lastIndex = start;
  let depth = 1, m;
  while ((m = tag.exec(src)) !== null) {
    if (m[0] === "</Route>") { depth -= 1; if (depth === 0) return src.slice(start, m.index); }
    else if (m[1] !== "/") depth += 1;
  }
  return "";
}
const guarded = guardedBlock(appJsx);
const routePaths = [...guarded.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);

console.log("\n=== every guarded route names a permission ===");
check("the guarded block was found and has routes", routePaths.length > 0, `${routePaths.length} routes`);
for (const p of routePaths) {
  const has = Object.prototype.hasOwnProperty.call(ROUTE_PERMISSIONS, p);
  check(`${p} is in the map`, has, "missing from config/routePermissions.js");
}

console.log("\n=== the map has no entry for a route that no longer exists ===");
for (const p of Object.keys(ROUTE_PERMISSIONS)) {
  check(`${p} is still routed`, routePaths.includes(p), "in the map but not in App.jsx");
}

// ── Every key is real ────────────────────────────────────────────────────────
const catalog = readFileSync(join(repo, "Helpers/PermissionCatalog.cs"), "utf8");
const catalogKeys = new Set([...catalog.matchAll(/new\("([a-z0-9.]+)"/g)].map((m) => m[1]));

console.log("\n=== every mapped key exists in the backend catalog ===");
check("the catalog parsed", catalogKeys.size > 100, `${catalogKeys.size} keys`);
for (const [route, key] of Object.entries(ROUTE_PERMISSIONS)) {
  if (key === null) continue; // open to every signed-in user, by design
  check(`${key} (${route}) is a catalog key`, catalogKeys.has(key),
    "not in Helpers/PermissionCatalog.cs");
}

// ── Resolution behaviour ─────────────────────────────────────────────────────
console.log("\n=== resolution ===");
check("an exact path resolves", permissionForPath("/chart-of-accounts") === "accounting.coa.view",
  String(permissionForPath("/chart-of-accounts")));
check("a wildcard child resolves to its parent's key",
  permissionForPath("/companies/list") === "companies.manage.view",
  String(permissionForPath("/companies/list")));
check("a deeper wildcard child still resolves",
  permissionForPath("/Clients/list/42") === "clients.manage.view",
  String(permissionForPath("/Clients/list/42")));
check("the wildcard parent itself resolves",
  permissionForPath("/companies") === "companies.manage.view",
  String(permissionForPath("/companies")));
check("a route open to every signed-in user resolves to null",
  permissionForPath("/profile") === null, String(permissionForPath("/profile")));
check("an unmapped path is undecided, so the guard refuses",
  permissionForPath("/something-nobody-mapped") === undefined,
  String(permissionForPath("/something-nobody-mapped")));
check("a path that merely shares a prefix does not borrow the key",
  permissionForPath("/companies-elsewhere") === undefined,
  String(permissionForPath("/companies-elsewhere")));

// ── The screens that must never be open ──────────────────────────────────────
console.log("\n=== the screens that carry the edition boundary are gated ===");
for (const [route, key] of [
  ["/chart-of-accounts", "accounting.coa.view"],
  ["/journal-entries", "accounting.journal.view"],
  ["/accounting/overview", "accounting.reports.view"],
  ["/accounting/reports", "accounting.reports.view"],
  ["/customer-portals", "customerportals.manage.view"],
]) {
  check(`${route} requires ${key}`, ROUTE_PERMISSIONS[route] === key, String(ROUTE_PERMISSIONS[route]));
}

console.log("\n" + "=".repeat(60));
console.log(`  ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("\nFailures:"); fails.forEach((f) => console.log("  - " + f)); }
process.exit(failed === 0 ? 0 : 1);
