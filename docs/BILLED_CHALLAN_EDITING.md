# Editing a billed delivery in Trader

For an unsubmitted bill, open **Edit delivery & update bill** from its challan
or from **Bills → Edit → Manage challans**. Supplier & cost remains separate.
The delivery editor keeps existing bill rates, accepts explicit rates for new
items (including zero), and shows an estimated whole-bill impact before save.
The linked customer and bill header are preserved.

`GET /api/deliverychallans/{id}/bill-edit` loads the current delivery, bill and
versions. `PUT` on the same route accepts both versions and priced delivery
items. Both routes require challan-update and bill-update permissions plus
access to the stored company. Item types and suppliers must belong to it.

Saving reconciles the linked bill, taxes, stock, accounting and order delivery
figures in the existing transaction. Bill-selected classifications and consultant
adjustments are preserved; changed reviewed source data needs consultant review.
Concurrent edits, allocated-receipt reductions, accounting locks, active notes,
FBR submission states and generated supplier purchases retain their safeguards.
The configured hard stock guard rolls back overselling; soft stock warnings
appear with the saved result. Submitted deliveries cannot be edited here.

No schema migration is required. Regression commands:

```text
py -3.14 scripts/test_billed_challan_edit.py --base http://127.0.0.1:5149 --database <isolated-local-db_Test>
py -3.14 scripts/test_basic_flows.py --base http://127.0.0.1:5149
py -3.14 scripts/test_stock_itemtype_reflow.py --base http://127.0.0.1:5149
```

The dedicated test requires an approved isolated local database, creates
throwaway records, installs local FBR states without contacting FBR, and checks
permissions, cross-company attempts, reconciliation, stock and accounting.
