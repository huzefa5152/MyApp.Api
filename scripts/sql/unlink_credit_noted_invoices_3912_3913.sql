/* ============================================================================
   Release the challans behind invoices 3912 and 3913 (Hakimi Traders) so they
   can be billed again.

   WHY
   ---
   Both invoices were submitted to FBR and then fully reversed by a credit note:

       invoice 495 (#3912)  7,056.40   reversed by credit note 501 (CN #2)
       invoice 496 (#3913) 12,980.00   reversed by credit note 500 (CN #1)

   Reversing the money does not currently release the delivery challans: they
   stay Status='Invoiced' with InvoiceId pointing at the reversed invoice, so
   they never come back into the "pending challans to bill" picker and the goods
   cannot be re-billed on a new number.

   WHAT MAKES A CHALLAN BILLABLE AGAIN
   -----------------------------------
   Two conditions, and only these two:
     * DeliveryChallans.Status IN ('Pending','Imported')
         -- DeliveryChallanRepository.GetPendingChallansByCompanyAsync
     * DeliveryChallans.InvoiceId IS NULL
         -- the bill form's own filter (InvoiceForm.jsx: !c.invoiceId)

   WHAT THIS SCRIPT DELIBERATELY DOES NOT DO
   -----------------------------------------
   * It does NOT clear InvoiceItems.DeliveryItemId on the reversed invoices.
     Those links are the historical record of what 3912/3913 were built from,
     and every challan-edit path finds its bill through DeliveryChallans.
     InvoiceId (never backwards from a delivery item), so a null InvoiceId is
     enough to stop an edit reaching the old bill.
   * It does NOT cancel or delete the invoices or the credit notes. The credit
     note is the reversal; the invoice stays as filed.
   * It does NOT touch stock. Both credit notes were raised with
     NoteAffectsStock = 1, and their IN movements already cancel the invoices'
     OUT exactly (9.00 and 16.00 of item type 130), so the goods are back on
     hand and re-billing will book a fresh, correct outward movement.

   HOW TO RUN
   ----------
   Run it whole. It opens a transaction, prints the before and after, and
   COMMITs only when exactly 3 rows changed — otherwise it ROLLBACKs and says
   so. Read the output before trusting it.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CompanyId int = 1;                    -- Hakimi Traders
DECLARE @Challans TABLE (Id int PRIMARY KEY);

/* The three challans behind the two reversed invoices, resolved by DATA rather
   than by hard-coded ids: an invoice that has been fully credit-noted, and the
   challans still pointing at it. */
INSERT INTO @Challans (Id)
SELECT dc.Id
FROM DeliveryChallans dc
JOIN Invoices inv ON inv.Id = dc.InvoiceId
WHERE dc.CompanyId = @CompanyId
  AND inv.InvoiceNumber IN (3912, 3913)
  AND inv.DocumentType = 4                      -- a sale bill, not a note
  AND dc.Status = 'Invoiced'
  /* only where a live credit note actually reverses that invoice */
  AND EXISTS (SELECT 1 FROM Invoices cn
              WHERE cn.OriginalInvoiceId = inv.Id
                AND cn.DocumentType = 10
                AND cn.IsCancelled = 0);

PRINT '--- BEFORE ---';
SELECT dc.Id AS ChallanId, dc.ChallanNumber, dc.Status, dc.InvoiceId,
       i.InvoiceNumber AS BilledOn, dc.PoNumber
FROM DeliveryChallans dc
LEFT JOIN Invoices i ON i.Id = dc.InvoiceId
WHERE dc.Id IN (SELECT Id FROM @Challans)
ORDER BY dc.ChallanNumber;

BEGIN TRANSACTION;

UPDATE dc
   SET dc.Status    = 'Pending',
       dc.InvoiceId = NULL
FROM DeliveryChallans dc
WHERE dc.Id IN (SELECT Id FROM @Challans);

DECLARE @Changed int = @@ROWCOUNT;
PRINT CONCAT('rows updated: ', @Changed);

IF @Changed = 3
BEGIN
    COMMIT TRANSACTION;
    PRINT 'COMMITTED — challans 4387, 4391 and 4393 are billable again.';
END
ELSE
BEGIN
    ROLLBACK TRANSACTION;
    PRINT 'ROLLED BACK — expected exactly 3 challans. Nothing was changed.';
    PRINT 'Re-check the invoice numbers and that each still has a live credit note.';
END

PRINT '--- AFTER ---';
SELECT dc.Id AS ChallanId, dc.ChallanNumber, dc.Status,
       ISNULL(CAST(dc.InvoiceId AS varchar(10)), 'NULL') AS InvoiceId,
       CASE WHEN dc.Status IN ('Pending','Imported') AND dc.InvoiceId IS NULL
            THEN 'billable' ELSE 'NOT billable' END AS Rebillable
FROM DeliveryChallans dc
WHERE dc.Id IN (SELECT Id FROM @Challans)
ORDER BY dc.ChallanNumber;
