// Start-up answers are handed out once, to the token that asked, while fresh
// (performance audit 2026-11-20, myapp-frontend/src/utils/bootPrefetch.js).
//   node scripts/test_boot_prefetch.mjs
import assert from "node:assert/strict";

const { startBootPrefetch, takeBootPrefetch, resetBootPrefetch } = await import(
  new URL("../myapp-frontend/src/utils/bootPrefetch.js", import.meta.url).href
);

let pass = 0;
const failures = [];
async function check(label, fn) {
  resetBootPrefetch();
  try {
    await fn();
    pass++;
    console.log(`  PASS ${label}`);
  } catch (e) {
    failures.push(label);
    console.log(`  FAIL ${label}: ${e.message}`);
  }
}

const counter = (value) => {
  const fn = () => {
    fn.calls++;
    return Promise.resolve(value);
  };
  fn.calls = 0;
  return fn;
};

await check("starts every loader at once and hands each result out once", async () => {
  const companies = counter({ data: ["a"] });
  const permissions = counter({ data: { permissions: [] } });
  startBootPrefetch("t1", { companies, permissions }, 1000);
  assert.equal(companies.calls, 1);
  assert.equal(permissions.calls, 1);
  assert.deepEqual(await takeBootPrefetch("companies", "t1", 1500), { data: ["a"] });
  assert.equal(takeBootPrefetch("companies", "t1", 1600), null);
  assert.deepEqual(await takeBootPrefetch("permissions", "t1", 1700), { data: { permissions: [] } });
});

await check("gives nothing to a different sign-in, and nothing afterwards", async () => {
  startBootPrefetch("t1", { companies: counter({ data: [] }) }, 1000);
  assert.equal(takeBootPrefetch("companies", "t2", 1100), null);
  assert.equal(takeBootPrefetch("companies", "t1", 1200), null);
});

await check("gives nothing once the answer is old", async () => {
  startBootPrefetch("t1", { companies: counter({ data: [] }) }, 1000);
  assert.equal(takeBootPrefetch("companies", "t1", 1000 + 10_001), null);
});

await check("does nothing without a token and never starts twice", async () => {
  const companies = counter({ data: [] });
  startBootPrefetch(null, { companies });
  assert.equal(companies.calls, 0);
  startBootPrefetch("t1", { companies }, 1000);
  startBootPrefetch("t1", { companies }, 1001);
  assert.equal(companies.calls, 1);
});

await check("hands a failure to the consumer without an unhandled rejection", async () => {
  startBootPrefetch("t1", { companies: () => Promise.reject(new Error("401")) }, 1000);
  await assert.rejects(takeBootPrefetch("companies", "t1", 1100), /401/);
});

await check("is empty when nothing was started", async () => {
  assert.equal(takeBootPrefetch("companies", "t1"), null);
});

console.log(`\n${pass}/${pass + failures.length} boot prefetch checks passed`);
process.exit(failures.length ? 1 : 0);
