"""
TechvoLogix (Manager.io) → JSON exporter.

Pulls every entity needed for the MyApp migration out of the Manager.io REST
API (`/api2`) into local JSON files — one file per entity — so the .NET
ManagerImport ETL can load them idempotently. READ-ONLY: issues only HTTP GET.

The Manager API is auth'd by a per-business API key sent in the `X-API-KEY`
header (the browser session cookie does NOT authenticate it). Key creation is
restricted to the Manager *server* admin (TechvoLogix), so the key must be
supplied here — it is never minted by this script.

API facts (discovered 2026-06-28, Manager v24.3.10.1347):
  - Base: https://accounts.techvologix.com/api2
  - `GET /api2`            -> OpenAPI 3.0 spec (no auth needed) — used by --discover
  - `GET /api2/{entity}`   -> list; paginates via `skip` + `pageSize` query params
  - Line items / allocations are SEPARATE endpoints:
      *-lines  (sales-invoice-lines, purchase-invoice-lines, delivery-note-lines, …)
      payment-lines / receipt-lines  == payment/receipt allocations
  - One API key == one business. Run once per business with its own key + outdir.

Usage:
  # 1. Confirm the key works and dump field shapes (1 row per entity):
  python scripts/techvologix_export.py --key XXXX --outdir data/export/jorbai --probe

  # 2. Full pull (resumable — re-run skips entities already fully downloaded):
  python scripts/techvologix_export.py --key XXXX --outdir data/export/jorbai

  # List every entity the API exposes (no key needed):
  python scripts/techvologix_export.py --discover

Flags:
  --key      X-API-KEY for the target business (or set env TECHVO_API_KEY)
  --base     API base URL (default: https://accounts.techvologix.com/api2)
  --outdir   directory to write {entity}.json files (default: data/export)
  --probe    fetch only the first row of each entity (validate auth + see shape)
  --discover GET /api2 and print all entity paths, then exit (no key required)
  --only     comma-separated entity list to limit the pull (e.g. payments,receipts)
  --page     page size for bulk pulls (default: 1000)

Exit code 0 = all requested entities pulled. 1 = any entity failed (e.g. 401).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

DEFAULT_BASE = "https://accounts.techvologix.com/api2"

# Entities we migrate, in a sensible pull order. Headers first, then their
# line/allocation children. Names are the API path segments (confirm via
# --discover; adjust if the live spec differs).
# NOTE on the chart of accounts: the Manager API exposes NO single
# `chart-of-accounts` / `control-accounts` / `accounts` data endpoint. The CoA
# is reconstructed from:
#   - typed account endpoints: bank-and-cash-accounts, capital-accounts, special-accounts
#   - party ledgers (most of the scraped "accounts" — advances, AR/AP balances)
#     which arrive via `customers` / `suppliers` under the AR/AP control accounts
#   - custom P&L/BS accounts are FORM-only (no JSON list) → seed from MyApp's
#     sector preset and map by name during load, or read from the GL view.
# Resolve the exact custom-account story in the --probe phase with a live key.
ENTITIES: list[str] = [
    # ── foundation / masters ────────────────────────────────────────────
    "divisions",
    "tax-codes",
    "bank-and-cash-accounts",
    "capital-accounts",
    "special-accounts",
    "inventory-items",
    "non-inventory-items",
    "inventory-kits",
    "folders",
    "customers",
    "suppliers",
    # ── sales documents (header + lines + footers) ──────────────────────
    "sales-quotes", "sales-quote-lines", "sales-quote-footers",
    "sales-orders", "sales-order-lines", "sales-order-footers",
    "delivery-notes", "delivery-note-lines", "delivery-note-footers",
    "sales-invoices", "sales-invoice-lines", "sales-invoice-footers",
    "credit-notes", "credit-note-lines", "credit-note-footers",
    # ── purchase documents (header + lines + footers) ───────────────────
    "purchase-invoices", "purchase-invoice-lines", "purchase-invoice-footers",
    "debit-notes", "debit-note-lines", "debit-note-footers",
    "goods-receipts", "goods-receipt-lines", "goods-receipt-footers",
    # ── money in / out (allocations live in *-lines) ────────────────────
    "receipts", "receipt-lines", "receipt-footers",
    "payments", "payment-lines", "payment-footers",
    "inter-account-transfers", "inter-account-transfer-footers",
    "withholding-tax-receipts",
    # ── other ledgers ───────────────────────────────────────────────────
    "journal-entries", "journal-entry-footers",
    "projects",
    "employees",
]


def _req(url: str, key: str | None, timeout: int = 60) -> Any:
    """GET a URL, return parsed JSON. Raises urllib.error.HTTPError on != 2xx."""
    req = urllib.request.Request(url, method="GET")
    req.add_header("Accept", "application/json")
    if key:
        req.add_header("X-API-KEY", key)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body.strip() else None


def _rows(payload: Any) -> list[Any]:
    """Normalise a list response: API may return a bare array or {items|data|results: []}."""
    if payload is None:
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for k in ("items", "data", "results", "value", "records"):
            if isinstance(payload.get(k), list):
                return payload[k]
        # single object response
        return [payload]
    return []


def discover(base: str) -> int:
    """Print every entity path in the OpenAPI spec (no key needed)."""
    try:
        spec = _req(base, key=None)
    except urllib.error.URLError as e:
        print(f"FAILED to fetch spec from {base}: {e}", file=sys.stderr)
        return 1
    paths = sorted((spec or {}).get("paths", {}).keys())
    print(f"# {(spec or {}).get('info', {}).get('title', 'API')} "
          f"v{(spec or {}).get('info', {}).get('version', '?')} — {len(paths)} paths\n")
    for p in paths:
        print(p.lstrip("/"))
    return 0


def pull_entity(base: str, key: str, entity: str, outdir: str,
                page_size: int, probe: bool) -> tuple[str, int, str]:
    """Pull one entity fully (or one row if probe). Returns (entity, count, status)."""
    out_path = os.path.join(outdir, f"{entity}.json")
    # resumable: skip a completed file (probe always re-runs, it's cheap)
    if not probe and os.path.exists(out_path):
        try:
            with open(out_path, encoding="utf-8") as f:
                existing = json.load(f)
            return (entity, len(existing), "SKIP (exists)")
        except (json.JSONDecodeError, OSError):
            pass  # corrupt/partial — re-pull

    collected: list[Any] = []
    skip = 0
    size = 1 if probe else page_size
    while True:
        url = f"{base}/{entity}?skip={skip}&pageSize={size}"
        try:
            rows = _rows(_req(url, key))
        except urllib.error.HTTPError as e:
            return (entity, len(collected), f"HTTP {e.code}")
        except urllib.error.URLError as e:
            return (entity, len(collected), f"ERR {e}")
        collected.extend(rows)
        if probe or len(rows) < size:
            break
        skip += size
        time.sleep(0.15)  # be gentle on the source server

    if not probe:
        os.makedirs(outdir, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(collected, f, ensure_ascii=False, indent=1)
    return (entity, len(collected), "PROBE" if probe else "OK")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Export TechvoLogix (Manager.io) data to JSON.")
    ap.add_argument("--key", default=os.environ.get("TECHVO_API_KEY"))
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--outdir", default="data/export")
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--discover", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--page", type=int, default=1000)
    args = ap.parse_args(argv)

    if args.discover:
        return discover(args.base)

    if not args.key:
        print("ERROR: no API key. Pass --key or set TECHVO_API_KEY.", file=sys.stderr)
        print("       (Key must be created by the TechvoLogix server admin.)", file=sys.stderr)
        return 1

    entities = [e.strip() for e in args.only.split(",") if e.strip()] or ENTITIES
    print(f"{'PROBE' if args.probe else 'EXPORT'} {len(entities)} entities "
          f"from {args.base} -> {args.outdir}\n")

    failures = 0
    for entity in entities:
        name, count, status = pull_entity(
            args.base, args.key, entity, args.outdir, args.page, args.probe)
        flag = "" if status.startswith(("OK", "SKIP", "PROBE")) else "  <-- CHECK"
        print(f"  {name:<28} {count:>7}  {status}{flag}")
        if flag:
            failures += 1

    print(f"\n{'Probe' if args.probe else 'Export'} complete. "
          f"{len(entities) - failures}/{len(entities)} entities OK.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
