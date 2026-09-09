/* ============================================================================
   Mark Hakimi bills 3912 and 3913 as cancelled at the FBR portal.

   RUN THIS ONLY AFTER THE DEPLOY. The FbrCancelledAt / FbrCancelledReason /
   FbrCancelledBy columns arrive with migration
   20260903183946_AddInvoiceFbrCancelled, which applies on the next startup.
   Before that this script fails with "Invalid column name" and changes nothing.

   WHY A SCRIPT AT ALL
   -------------------
   The UI route (bill -> Correct -> "Cancelled on the FBR portal") is safe for
   these two and is the better option: it records WHO marked it and WHEN, and
   writes an audit row. It will NOT move stock, because both bills carry a live
   credit note raised with NoteAffectsStock = 1 and the service skips the stock
   purge in exactly that case:

       3912  ->  CN #2, affects stock   |  3913  ->  CN #1, affects stock

   This script exists for the case where you would rather not go through the UI
   at all. It sets the three columns and nothing else.

   WHAT IT DELIBERATELY DOES NOT DO
   --------------------------------
   * No stock movements are touched. The credit notes already returned the
     goods (invoice OUT 9.00 and 16.00 of item type 130, cancelled by the notes'
     IN of the same amounts). Deleting the invoices' movements now would leave
     the notes' inward half unmatched and inflate on-hand.
   * No challans are touched. unlink_credit_noted_invoices_3912_3913.sql
     already released 4387, 4391 and 4393 — verified: no challan still points
     at either bill.
   * IsCancelled is NOT set. This is not a void: the bills keep their numbers
     and their IRNs and stay visible, carrying the FBR-cancelled marker.
   * No audit row is written, because that is the app's job. If you want the
     trail, use the UI instead.

   HOW TO RUN
   ----------
   Whole file. It prints the before and after, and commits only when exactly
   two rows change.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CompanyId int = 1;                     -- Hakimi Traders
DECLARE @Reason    nvarchar(400) = N'Cancelled at the FBR portal within 72 hours';
DECLARE @By        nvarchar(200) = N'data-correction';   -- not a real login

DECLARE @Targets TABLE (Id int PRIMARY KEY, InvoiceNumber int);

/* Resolved by DATA, not by hard-coded ids: a filed sale bill, fully reversed by
   a live credit note, not already marked. */
INSERT INTO @Targets (Id, InvoiceNumber)
SELECT inv.Id, inv.InvoiceNumber
FROM Invoices inv
WHERE inv.CompanyId = @CompanyId
  AND inv.InvoiceNumber IN (3912, 3913)
  AND inv.DocumentType = 4                      -- a sale, not a note
  AND inv.FbrStatus = 'Submitted'               -- there was a filing to withdraw
  AND inv.IsCancelled = 0
  AND inv.FbrCancelledAt IS NULL                -- idempotent: re-running is a no-op
  AND EXISTS (SELECT 1 FROM Invoices cn
              WHERE cn.OriginalInvoiceId = inv.Id
                AND cn.DocumentType = 10
                AND cn.IsCancelled = 0);

PRINT '--- BEFORE ---';
SELECT inv.Id, inv.InvoiceNumber, inv.FbrStatus, inv.FbrInvoiceNumber,
       inv.IsCancelled,
       ISNULL(CONVERT(varchar(19), inv.FbrCancelledAt, 120), 'NULL') AS FbrCancelledAt,
       (SELECT COUNT(*) FROM DeliveryChallans dc WHERE dc.InvoiceId = inv.Id) AS ChallansStillLinked
FROM Invoices inv
WHERE inv.Id IN (SELECT Id FROM @Targets)
ORDER BY inv.InvoiceNumber;

BEGIN TRANSACTION;

UPDATE inv
   SET inv.FbrCancelledAt     = SYSUTCDATETIME(),
       inv.FbrCancelledReason = @Reason,
       inv.FbrCancelledBy     = @By
FROM Invoices inv
WHERE inv.Id IN (SELECT Id FROM @Targets);

DECLARE @Changed int = @@ROWCOUNT;
PRINT CONCAT('rows updated: ', @Changed);

IF @Changed = 2
BEGIN
    COMMIT TRANSACTION;
    PRINT 'COMMITTED — 3912 and 3913 now carry the FBR-cancelled marker.';
    PRINT 'They stay visible with their numbers and IRNs, and drop out of the Sales Report.';
END
ELSE
BEGIN
    ROLLBACK TRANSACTION;
    PRINT 'ROLLED BACK — expected exactly 2 bills. Nothing was changed.';
    PRINT 'Most likely they are already marked (this script skips those), or the';
    PRINT 'migration has not been applied yet.';
END

PRINT '--- AFTER ---';
SELECT inv.InvoiceNumber,
       ISNULL(CONVERT(varchar(19), inv.FbrCancelledAt, 120), 'NULL') AS FbrCancelledAt,
       inv.FbrCancelledReason,
       inv.IsCancelled AS StillNotVoided,
       inv.FbrInvoiceNumber AS KeepsItsIRN
FROM Invoices inv
WHERE inv.CompanyId = @CompanyId AND inv.InvoiceNumber IN (3912, 3913)
ORDER BY inv.InvoiceNumber;

/* Sanity check: stock must be unchanged and still square. Each bill's outward
   total should equal its credit note's inward total. */
PRINT '--- stock check (each pair must net to zero) ---';
SELECT inv.InvoiceNumber AS Bill,
       CAST(SUM(CASE WHEN m.SourceId = inv.Id THEN
                     CASE WHEN m.Direction = 2 THEN -m.Quantity ELSE m.Quantity END
                ELSE 0 END) AS decimal(18,4)) AS BillNet,
       CAST(SUM(CASE WHEN m.SourceId = cn.Id THEN
                     CASE WHEN m.Direction = 2 THEN -m.Quantity ELSE m.Quantity END
                ELSE 0 END) AS decimal(18,4)) AS NoteNet
FROM Invoices inv
JOIN Invoices cn ON cn.OriginalInvoiceId = inv.Id AND cn.DocumentType = 10 AND cn.IsCancelled = 0
JOIN StockMovements m ON m.SourceId IN (inv.Id, cn.Id)
WHERE inv.CompanyId = @CompanyId AND inv.InvoiceNumber IN (3912, 3913)
GROUP BY inv.InvoiceNumber;
