-- ============================================================================
-- replicate_prod_locally.sql
-- ----------------------------------------------------------------------------
-- Replicates production Companies 1 (Hakimi) + 2 (Roshan) data on the local
-- DB so the rule-based PO parser can be matured against the real client
-- formats. DESTRUCTIVE for these two companies' clients/challans/invoices/
-- POFormats.
--
-- What it does:
--   1) Wipes existing clients/challans/invoices/POFormats/POFormatVersions/
--      POGoldenSamples for Companies 1 and 2 (FK-safe order).
--   2) Updates Companies 1 and 2 with production NTN/STRN/FBR fields and the
--      Starting/Current Challan + Invoice numbers from prod.
--   3) Upserts the 8 ClientGroups (find-or-create by NTN-based GroupKey) so
--      POFormats can correctly key off the legal entity.
--   4) Inserts the 10 production Clients verbatim. New auto-generated Ids
--      (prod Ids may collide with other companies' rows on local DBs).
--   5) Inserts the 5 production POFormats and 15 POFormat Versions verbatim,
--      with FK references resolved by (CompanyId, NTN) lookup so they bind
--      to the freshly-inserted clients regardless of Id.
--   6) Generates 34 challans for Hakimi and 28 for Roshan distributed across
--      every status: Imported, Pending, Cancelled, No PO, Setup Required,
--      Invoiced. Builds matching Invoices + InvoiceItems for the Invoiced
--      ones so list pages render correctly.
--
-- Re-runnable: yes — re-running drops what step (1) creates and re-seeds.
--
-- Run via SSMS or:
--   sqlcmd -S "CRKRL-HUSSAHUZ1\MSSQLSERVER2" -d DeliveryChallanDb -E -i scripts/replicate_prod_locally.sql -b
--
-- Stop the API first (it locks the DeliveryChallans table during reads).
-- ============================================================================

SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRANSACTION;

-- ============================================================================
-- STEP 1: Delete existing data for Companies 1 & 2 (FK-safe order)
-- ============================================================================
PRINT '== Step 1: deleting existing data for Companies 1 & 2 ==';

-- Unlink challans from invoices first (DeliveryChallan.InvoiceId is restrict-FK).
UPDATE DeliveryChallans SET InvoiceId = NULL WHERE CompanyId IN (1, 2);

-- Invoice items, then invoices.
DELETE ii FROM InvoiceItems ii
INNER JOIN Invoices i ON ii.InvoiceId = i.Id
WHERE i.CompanyId IN (1, 2);

DELETE FROM Invoices WHERE CompanyId IN (1, 2);

-- Delivery items.
DELETE di FROM DeliveryItems di
INNER JOIN DeliveryChallans dc ON di.DeliveryChallanId = dc.Id
WHERE dc.CompanyId IN (1, 2);

-- Duplicate challans first (self-FK is Restrict).
DELETE FROM DeliveryChallans WHERE CompanyId IN (1, 2) AND DuplicatedFromId IS NOT NULL;

-- Remaining challans.
DELETE FROM DeliveryChallans WHERE CompanyId IN (1, 2);

-- POFormats and friends. Capture the format ids first (they may target any of:
-- a company in (1,2), or a client in (1,2), or none).
DECLARE @poFormatIdsToDelete TABLE (Id INT);
INSERT INTO @poFormatIdsToDelete (Id)
SELECT Id FROM POFormats
WHERE CompanyId IN (1, 2)
   OR ClientId IN (SELECT Id FROM Clients WHERE CompanyId IN (1, 2));

DELETE FROM POGoldenSamples WHERE POFormatId IN (SELECT Id FROM @poFormatIdsToDelete);
DELETE FROM POFormatVersions WHERE POFormatId IN (SELECT Id FROM @poFormatIdsToDelete);
DELETE FROM POFormats WHERE Id IN (SELECT Id FROM @poFormatIdsToDelete);

-- Clients.
DELETE FROM Clients WHERE CompanyId IN (1, 2);

-- ============================================================================
-- STEP 2: Update Companies 1 & 2 to production values
-- ============================================================================
PRINT '== Step 2: updating Companies 1 & 2 to production values ==';

UPDATE Companies SET
    Name = 'hakimi traders',
    BrandName = 'HAKIMI TRADERS',
    StartingChallanNumber = 4185,
    CurrentChallanNumber = 4213,
    StartingInvoiceNumber = 3745,
    CurrentInvoiceNumber = 3757,
    FullAddress = 'Office # 111, Industrial Town Plaza,Serai Road, Opposite S.M. ScienceCollege, Karachi',
    LogoPath = '/data/uploads/logos/company_1.png',
    NTN = '4228937-8',
    Phone = 'Murtaza0331-3368883',
    STRN = '3277876175852',
    FbrBusinessActivity = 'Wholesaler',
    FbrEnvironment = 'sandbox',
    FbrProvinceCode = 8,
    FbrSector = 'Wholesale / Retails',
    FbrToken = 'dedaacee-53be-3f58-8954-0f32c98d18d7',
    InvoiceNumberPrefix = 'INV-',
    CNIC = '4230193299489'
WHERE Id = 1;

UPDATE Companies SET
    Name = 'Roshan Traders',
    BrandName = 'ROSHAN TRADERS',
    StartingChallanNumber = 1082,
    CurrentChallanNumber = 1102,
    StartingInvoiceNumber = 971,
    CurrentInvoiceNumber = 982,
    FullAddress = 'Shop # F-44, 1st Floor, Falak City Tower,Opposite Karachi Chamber Of Commerce,Talpur Road, Karachi',
    LogoPath = NULL,
    NTN = '8183300-5',
    Phone = 'Mr. Hussain 0333-1665253',
    STRN = '4230140207959',
    FbrBusinessActivity = 'Wholesaler',
    FbrEnvironment = 'sandbox',
    FbrProvinceCode = 8,
    FbrSector = 'Wholesale / Retails',
    FbrToken = '9fd8e37e-f593-374e-a5cf-85eff0ca7930',
    InvoiceNumberPrefix = 'INV-',
    CNIC = '4230140207959'
WHERE Id = 2;

-- ============================================================================
-- STEP 3: Upsert the 8 ClientGroups (find-or-create by NTN-based GroupKey)
-- ============================================================================
PRINT '== Step 3: upserting ClientGroups ==';

DECLARE @desiredGroups TABLE (
    GroupKey       NVARCHAR(200) NOT NULL,
    DisplayName    NVARCHAR(200) NOT NULL,
    NormalizedNtn  NVARCHAR(50)  NOT NULL,
    NormalizedName NVARCHAR(200) NOT NULL
);

INSERT INTO @desiredGroups (GroupKey, DisplayName, NormalizedNtn, NormalizedName) VALUES
    ('NTN:071081804',     'LOTTE KOLSON (Pvt) Ltd',           '071081804',     'lotte kolson (pvt) ltd'),
    ('NTN:130206764703',  'SOORTY ENTERPRISES Pvt Ltd.',      '130206764703',  'soorty enterprises pvt ltd.'),
    ('NTN:86555688',   'MEKO FABRICS (Pvt) Ltd.',          '86555688',   'meko fabrics (pvt) ltd.'),
    ('NTN:06768938',   'AFROZE TEXTILE INDUSTRIES Pvt Ltd','06768938',   'afroze textile industries pvt ltd'),
    ('NTN:88260502',   'MEKO DENIM MILLS (Pvt) Ltd.',      '88260502',   'meko denim mills (pvt) ltd.'),
    ('NTN:36066672',   'AQUAGEN PVT LTD.',                 '36066672',   'aquagen pvt ltd.'),
    ('NTN:08967164',   'MUNDIA EXPORTS',                   '08967164',   'mundia exports'),
    ('NTN:07041322',   'ARTISTIC DENIM MILLS Ltd.',        '07041322',   'artistic denim mills ltd.');

MERGE INTO ClientGroups AS tgt
USING @desiredGroups AS src
   ON tgt.GroupKey = src.GroupKey
WHEN NOT MATCHED THEN
    INSERT (GroupKey, DisplayName, NormalizedNtn, NormalizedName, CreatedAt, UpdatedAt)
    VALUES (src.GroupKey, src.DisplayName, src.NormalizedNtn, src.NormalizedName, GETUTCDATE(), GETUTCDATE())
WHEN MATCHED THEN UPDATE SET
    DisplayName    = src.DisplayName,
    NormalizedNtn  = src.NormalizedNtn,
    NormalizedName = src.NormalizedName,
    UpdatedAt      = GETUTCDATE();

DECLARE @gLotte       INT = (SELECT Id FROM ClientGroups WHERE GroupKey = 'NTN:071081804');
DECLARE @gSoorty      INT = (SELECT Id FROM ClientGroups WHERE GroupKey = 'NTN:130206764703');
DECLARE @gMekoFabrics INT = (SELECT Id FROM ClientGroups WHERE GroupKey = 'NTN:86555688');
DECLARE @gAfroze      INT = (SELECT Id FROM ClientGroups WHERE GroupKey = 'NTN:06768938');
DECLARE @gMekoDenim   INT = (SELECT Id FROM ClientGroups WHERE GroupKey = 'NTN:88260502');
DECLARE @gAquagen     INT = (SELECT Id FROM ClientGroups WHERE GroupKey = 'NTN:36066672');
DECLARE @gMundia      INT = (SELECT Id FROM ClientGroups WHERE GroupKey = 'NTN:08967164');
DECLARE @gArtistic    INT = (SELECT Id FROM ClientGroups WHERE GroupKey = 'NTN:07041322');

-- ============================================================================
-- STEP 4: Insert the 10 production Clients (auto-generated Ids).
-- IDs are not preserved from prod because prod Ids 1-10 may collide with
-- other companies' rows on a local DB. Downstream FKs resolve by
-- (CompanyId, NTN) lookup instead.
-- ============================================================================
PRINT '== Step 4: inserting Clients ==';

INSERT INTO Clients (Name, Address, Phone, Email, CreatedAt, CompanyId, NTN, STRN, Site, CNIC, FbrProvinceCode, RegistrationType, ClientGroupId) VALUES
    ('LOTTE KOLSON (Pvt) Ltd',            'L-14, Block 21 F.B.Industrial Area Karachi',                                    '', '', '2026-04-17 15:21:51.222', 1, '0710818-04',    '02-03-2100-001-82', 'Karachi;Unit 1 Lahore;Unit 7 Lahore', NULL, 8, 'Registered', @gLotte),
    ('SOORTY ENTERPRISES Pvt Ltd.',       'Circle A-2,Zone Companies V Karachi',                                            '', '', '2026-04-17 16:03:46.165', 1, '13-02-0676470-3','02-16-6114-001-55', '',                                    NULL, 8, 'Registered', @gSoorty),
    ('MEKO FABRICS (Pvt) Ltd.',           'WH-25 3/A K.C.I.P Korangi Crossing Karachi',                                  NULL, NULL, '2026-04-17 16:07:33.290', 1, '8655568-8',     '3277876354879',     'AGRIVOLTAIC FARM;SPINNING UNIT-KOTRI', NULL, 8, 'Registered', @gMekoFabrics),
    ('AFROZE TEXTILE INDUSTRIES Pvt Ltd', 'L-A-1/A Block-22 F.B.AREA Karachi, 754950',                                      '', '', '2026-04-17 16:14:26.015', 1, '0676893-8',     '11-00-6001-010-73', '',                                     NULL, 8, 'Registered', @gAfroze),
    ('MEKO DENIM MILLS (Pvt) Ltd.',       'Plot F-131 Hub River Road, SITE. Karachi',                                    NULL, NULL, '2026-04-17 16:16:35.938', 1, '8826050-2',     '327787622231-3',    'T-GARMENT;A-MAIN STORE. KOTRI;MDM-K. KOTRI-II;N-Knitting;MDM-C.KOTRI;F-MDMSITE-2;G-Garment-2', NULL, 8, 'Registered', @gMekoDenim),
    ('AQUAGEN PVT LTD.',                  '2000,Square Yard,Adjacent To Masjid-E-Habib PNS Karsaz',                         '', '', '2026-04-17 16:19:10.737', 2, '36066672',      '1700360666711',     '',                                     NULL, 8, 'Registered', @gAquagen),
    ('MEKO FABRICS (Pvt) Ltd.',           'WH-25 3/A K.C.I.P Korangi Crossing Karachi',                                  NULL, NULL, '2026-04-17 16:20:47.095', 2, '8655568-8',     '3277876354879',     'AGRIVOLTAIC FARM;SPINNING UNIT-KOTRI', NULL, 8, 'Registered', @gMekoFabrics),
    ('MEKO DENIM MILLS (Pvt) Ltd.',       'Plot F-131 Hub River Road, SITE. Karachi',                                    NULL, NULL, '2026-04-17 16:21:46.940', 2, '8826050-2',     '327787622231-3',    'T-GARMENT;A-MAIN STORE. KOTRI;MDM-K. KOTRI-II;N-Knitting;MDM-C.KOTRI;F-MDMSITE-2;G-Garment-2', NULL, 8, 'Registered', @gMekoDenim),
    ('MUNDIA EXPORTS',                    'Plot No X-4 Mangho Pir Road Site Karachi',                                       '', '', '2026-04-24 16:00:29.727', 1, '0896716-4',     '42301-0857304-5',   '',                                     NULL, 8, 'Registered', @gMundia),
    ('ARTISTIC DENIM MILLS Ltd.',         'Plot # 5-9,23-26 Sector 16, Korangi Industrial Area Karachi Sindh Pakistan.',    '', '', '2026-04-24 16:02:00.205', 1, '0704132-2',     '12-02-5209-003-91', '',                                     NULL, 8, 'Registered', @gArtistic);

-- Capture the new client Ids by (CompanyId, NTN) for downstream FK refs.
DECLARE @cLotte_C1       INT = (SELECT TOP 1 Id FROM Clients WHERE CompanyId = 1 AND NTN = '0710818-04');
DECLARE @cSoorty_C1      INT = (SELECT TOP 1 Id FROM Clients WHERE CompanyId = 1 AND NTN = '13-02-0676470-3');
DECLARE @cMekoFabrics_C1 INT = (SELECT TOP 1 Id FROM Clients WHERE CompanyId = 1 AND NTN = '8655568-8');
DECLARE @cAfroze_C1      INT = (SELECT TOP 1 Id FROM Clients WHERE CompanyId = 1 AND NTN = '0676893-8');
DECLARE @cMekoDenim_C1   INT = (SELECT TOP 1 Id FROM Clients WHERE CompanyId = 1 AND NTN = '8826050-2');
DECLARE @cMundia_C1      INT = (SELECT TOP 1 Id FROM Clients WHERE CompanyId = 1 AND NTN = '0896716-4');
DECLARE @cArtistic_C1    INT = (SELECT TOP 1 Id FROM Clients WHERE CompanyId = 1 AND NTN = '0704132-2');
DECLARE @cAquagen_C2     INT = (SELECT TOP 1 Id FROM Clients WHERE CompanyId = 2 AND NTN = '36066672');
DECLARE @cMekoFabrics_C2 INT = (SELECT TOP 1 Id FROM Clients WHERE CompanyId = 2 AND NTN = '8655568-8');
DECLARE @cMekoDenim_C2   INT = (SELECT TOP 1 Id FROM Clients WHERE CompanyId = 2 AND NTN = '8826050-2');

-- ============================================================================
-- STEP 5: Insert the 5 production POFormats (auto-generated Ids).
-- Original prod Ids: 5 (Lotte), 6 (Soorty), 7 (Meko Denim/Fabrics), 8 (Meko
-- Fabric Pvt Ltd / C1), 9 (Meko Fabric PO / C2). Local Ids will differ; we
-- look them up via Notes/CompanyId/ClientId fingerprints right after insert.
-- ============================================================================
PRINT '== Step 5: inserting POFormats ==';

INSERT INTO POFormats (Name, CompanyId, SignatureHash, KeywordSignature, RuleSetJson, CurrentVersion, IsActive, Notes, CreatedAt, UpdatedAt, ClientId, ClientGroupId) VALUES
    ('Lotte Kolson PO', NULL,
     '4370fee2ae72452c5de0aa8d787b1ddbfbed48128b1fb9483b7b9253fa4fcaa3',
     'address|amount|area karachi. phone|delivery|fax|first floor office|gst|hakimi traders p.o|in words|item|items|karachi pur. req|location|no|noman aslam page no|order|print date|printed by|quantity|remarks|[s.no](http://s.no)|sales t terms|special instructions|supplier name|tax|total|unit',
     '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P.O. #","poDateLabel":"P.O. Date","descriptionHeader":"Item Name","quantityHeader":"Quantity","unitHeader":"Unit"}',
     2, 1,
     'LOTTE Kolson (Pvt.) Limited - Non-Inventory POs. Layout: SNo, ItemId, Item Name, Delivery Date, Quantity, Unit, Unit Price, Total. Qty-then-Unit column order.',
     '2026-04-24 01:22:32.462', '2026-04-24 01:45:52.999', @cLotte_C1, @gLotte),
    ('Soorty Enterprises PO', NULL,
     'a55ce760344cf0bfef0695b3ca3db0e0f08ed007717b4045895a80819a72a2e2',
     'address|amount|amount in words|attn|contact person|control no|delivery|fax|head office|item|items|ntn|order|pakistan|po|purchases sales tax|quantity|quotation no. bank|rate|reference|rfq number sales tax|scm p.o. no. reference|supplier copy tsor.l|tax|total|unit',
     '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P.O. Number","poDateLabel":"P.O. Date","descriptionHeader":"Item","quantityHeader":"Quantity","unitHeader":"Unit"}',
     2, 1,
     'SOORTY ENTERPRISES (PVT) LTD - General Purchases. Layout: SrNo, Item, Narration, Department, Parent, Tol, Quantity, Unit, Rate, Disc Rate, Amount. Qty-then-Unit column order.',
     '2026-04-24 01:22:32.674', '2026-04-24 01:45:45.954', @cSoorty_C1, @gSoorty),
    ('Meko Denim/Fabrics PO', NULL,
     'b0349cdeeb2afca2d6bd5ff0e122ab81d05f354cbe81a70d0ea16238878a412d',
     'amount|item|karachi. email|officer head office|order|qty|rate|tax|total|unit',
     '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',
     6, 1,
     'MEKO DENIM MILLS / MEKO FABRICS - Weaving / Spinning units. Layout: Code, Item Name, Unit, Qty, Rate, Excl-Tax, ST Rate, S/Tax, ET Rate, ET Amt, Total. Unit-then-Qty column order (engine auto-detects from header position).',
     '2026-04-24 01:22:32.683', '2026-04-24 13:40:35.758', @cMekoDenim_C1, @gMekoDenim),
    ('Meko Fabric Pvt Ltd', 1,
     '438ab55f7d165a88703686a6c0fc717907786a3c5d796dc8904aac3b937dd19a',
     'amount|director c.e.o note|item|ltd ntn|order|pm head office|qty|rate|tax|total|unit|valid address office',
     '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',
     3, 1,
     'MEKO DENIM MILLS / MEKO FABRICS - Weaving / Spinning units. Layout: Code, Item Name, Unit, Qty, Rate, Excl-Tax, ST Rate, S/Tax, ET Rate, ET Amt, Total. Unit-then-Qty column order (engine auto-detects from header position).',
     '2026-04-24 13:39:55.560', '2026-04-27 16:26:33.035', @cMekoFabrics_C1, @gMekoFabrics),
    ('Meko Fabric PO', 2,
     '438ab55f7d165a88703686a6c0fc717907786a3c5d796dc8904aac3b937dd19a',
     'amount|director c.e.o note|item|ltd ntn|order|pm head office|qty|rate|tax|total|unit|valid address office',
     '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',
     2, 1,
     'MEKO DENIM MILLS / MEKO FABRICS - Weaving / Spinning units. Layout: Code, Item Name, Unit, Qty, Rate, Excl-Tax, ST Rate, S/Tax, ET Rate, ET Amt, Total. Unit-then-Qty column order (engine auto-detects from header position).',
     '2026-04-26 17:26:38.471', '2026-04-26 17:26:48.478', @cMekoFabrics_C2, @gMekoFabrics);

-- Capture the new POFormat Ids by name + (ClientId or CompanyId) so STEP 6
-- can attach versions.
DECLARE @pfLotte    INT = (SELECT TOP 1 Id FROM POFormats WHERE Name = 'Lotte Kolson PO'         AND ClientId = @cLotte_C1);
DECLARE @pfSoorty   INT = (SELECT TOP 1 Id FROM POFormats WHERE Name = 'Soorty Enterprises PO'   AND ClientId = @cSoorty_C1);
DECLARE @pfMekoDF   INT = (SELECT TOP 1 Id FROM POFormats WHERE Name = 'Meko Denim/Fabrics PO'   AND ClientId = @cMekoDenim_C1);
DECLARE @pfMekoFC1  INT = (SELECT TOP 1 Id FROM POFormats WHERE Name = 'Meko Fabric Pvt Ltd'     AND CompanyId = 1);
DECLARE @pfMekoFC2  INT = (SELECT TOP 1 Id FROM POFormats WHERE Name = 'Meko Fabric PO'          AND CompanyId = 2);

-- ============================================================================
-- STEP 6: Insert the 15 production POFormatVersions (auto-generated Ids).
-- POFormatId references resolve via the @pfXxx variables captured in step 5.
-- ============================================================================
PRINT '== Step 6: inserting POFormatVersions ==';

INSERT INTO POFormatVersions (POFormatId, Version, RuleSetJson, ChangeNote, CreatedBy, CreatedAt) VALUES
    (@pfLotte,   1, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P.O. #","poDateLabel":"P.O. Date","descriptionHeader":"Item Name","quantityHeader":"Quantity","unitHeader":"Unit"}',         'Initial seed (simple-headers-v1)', 'system', '2026-04-24 01:22:32.636'),
    (@pfSoorty,  1, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P.O. Number","poDateLabel":"P.O. Date","descriptionHeader":"Item","quantityHeader":"Quantity","unitHeader":"Unit"}',         'Initial seed (simple-headers-v1)', 'system', '2026-04-24 01:22:32.679'),
    (@pfMekoDF,  1, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',                  'Initial seed (simple-headers-v1)', 'system', '2026-04-24 01:22:32.685'),
    (@pfMekoDF,  2, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',                  'Edited via simple form',           'admin',  '2026-04-24 01:45:36.569'),
    (@pfSoorty,  2, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P.O. Number","poDateLabel":"P.O. Date","descriptionHeader":"Item","quantityHeader":"Quantity","unitHeader":"Unit"}',         'Edited via simple form',           'admin',  '2026-04-24 01:45:45.954'),
    (@pfLotte,   2, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P.O. #","poDateLabel":"P.O. Date","descriptionHeader":"Item Name","quantityHeader":"Quantity","unitHeader":"Unit"}',         'Edited via simple form',           'admin',  '2026-04-24 01:45:52.999'),
    (@pfMekoDF,  3, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',                  'Edited via simple form',           'admin',  '2026-04-24 08:22:29.228'),
    (@pfMekoDF,  4, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',                  'Edited via simple form',           'admin',  '2026-04-24 08:22:43.871'),
    (@pfMekoDF,  5, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',                  'Edited via simple form',           'admin',  '2026-04-24 08:22:55.033'),
    (@pfMekoFC1, 1, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',                  'Initial version',                  'admin',  '2026-04-24 13:39:55.626'),
    (@pfMekoFC1, 2, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',                  'Edited via simple form',           'admin',  '2026-04-24 13:40:25.693'),
    (@pfMekoDF,  6, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',                  'Edited via simple form',           'admin',  '2026-04-24 13:40:35.758'),
    (@pfMekoFC2, 1, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',                  'Initial version',                  'admin',  '2026-04-26 17:26:38.579'),
    (@pfMekoFC2, 2, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',                  'Edited via simple form',           'admin',  '2026-04-26 17:26:48.478'),
    (@pfMekoFC1, 3, '{"version":1,"engine":"simple-headers-v1","poNumberLabel":"P. O. No","poDateLabel":"Date","descriptionHeader":"Item Name","quantityHeader":"Qty","unitHeader":"Unit"}',                  'Edited via simple form',           'admin',  '2026-04-27 16:26:33.035');

-- ============================================================================
-- STEP 7: Generate ~30+ challans per company across statuses
-- ============================================================================
PRINT '== Step 7: generating challans + invoices ==';

DECLARE @itemTypeId INT = (SELECT TOP 1 Id FROM ItemTypes ORDER BY Id);

-- Hakimi (Company 1) — round-robin over its 7 clients.
DECLARE @hakimiClients TABLE (n INT IDENTITY(1,1) PRIMARY KEY, ClientId INT, Site NVARCHAR(200));
INSERT INTO @hakimiClients (ClientId, Site) VALUES
    (@cLotte_C1,       'Karachi'),
    (@cSoorty_C1,      ''),
    (@cMekoFabrics_C1, 'AGRIVOLTAIC FARM'),
    (@cAfroze_C1,      ''),
    (@cMekoDenim_C1,   'T-GARMENT'),
    (@cMundia_C1,      ''),
    (@cArtistic_C1,    '');

-- Roshan (Company 2) — round-robin over its 3 clients.
DECLARE @roshanClients TABLE (n INT IDENTITY(1,1) PRIMARY KEY, ClientId INT, Site NVARCHAR(200));
INSERT INTO @roshanClients (ClientId, Site) VALUES
    (@cAquagen_C2,     ''),
    (@cMekoFabrics_C2, 'AGRIVOLTAIC FARM'),
    (@cMekoDenim_C2,   'T-GARMENT');

DECLARE @num         INT,
        @clientIdx   INT,
        @clientId    INT,
        @site        NVARCHAR(200),
        @newChallanId INT,
        @newItemId   INT,
        @invNum      INT,
        @invoiceId   INT,
        @hakimiCount INT = 7,
        @roshanCount INT = 3;

-- ---- HAKIMI: Imported (4180-4184, 5 rows) ----
SET @num = 4180;
WHILE @num <= 4184
BEGIN
    SET @clientIdx = ((@num - 4180) % @hakimiCount) + 1;
    SELECT @clientId = ClientId, @site = Site FROM @hakimiClients WHERE n = @clientIdx;
    INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
    VALUES (1, @num, @clientId, 'PO-OLD-' + CAST(@num AS NVARCHAR(10)), '2024-08-15', NULL, '2024-08-20', NULLIF(@site, ''), 'Imported', 1, 0, NULL);
    SET @newChallanId = SCOPE_IDENTITY();
    INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
    VALUES (@newChallanId, @itemTypeId, 'Historical 12mm bar', 5, 'Pcs');
    SET @num += 1;
END

-- ---- HAKIMI: Pending (4185-4192, 8 rows) ----
SET @num = 4185;
WHILE @num <= 4192
BEGIN
    SET @clientIdx = ((@num - 4185) % @hakimiCount) + 1;
    SELECT @clientId = ClientId, @site = Site FROM @hakimiClients WHERE n = @clientIdx;
    INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
    VALUES (1, @num, @clientId, 'PO-' + CAST(@num AS NVARCHAR(10)), '2026-05-01', NULL, '2026-05-02', NULLIF(@site, ''), 'Pending', 0, 0, NULL);
    SET @newChallanId = SCOPE_IDENTITY();
    INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
    VALUES (@newChallanId, @itemTypeId, 'Solenoid valve', 10, 'Pcs');
    SET @num += 1;
END

-- ---- HAKIMI: Cancelled (4193-4195, 3 rows) ----
SET @num = 4193;
WHILE @num <= 4195
BEGIN
    SET @clientIdx = ((@num - 4193) % @hakimiCount) + 1;
    SELECT @clientId = ClientId, @site = Site FROM @hakimiClients WHERE n = @clientIdx;
    INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
    VALUES (1, @num, @clientId, 'PO-CANC-' + CAST(@num AS NVARCHAR(10)), '2026-05-01', NULL, '2026-05-02', NULLIF(@site, ''), 'Cancelled', 0, 0, NULL);
    SET @newChallanId = SCOPE_IDENTITY();
    INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
    VALUES (@newChallanId, @itemTypeId, 'Cancelled order', 1, 'Pcs');
    SET @num += 1;
END

-- ---- HAKIMI: No PO (4196-4198, 3 rows) ----
SET @num = 4196;
WHILE @num <= 4198
BEGIN
    SET @clientIdx = ((@num - 4196) % @hakimiCount) + 1;
    SELECT @clientId = ClientId, @site = Site FROM @hakimiClients WHERE n = @clientIdx;
    INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
    VALUES (1, @num, @clientId, '', NULL, NULL, '2026-05-02', NULLIF(@site, ''), 'No PO', 0, 0, NULL);
    SET @newChallanId = SCOPE_IDENTITY();
    INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
    VALUES (@newChallanId, @itemTypeId, 'Pre-PO sample', 2, 'Pcs');
    SET @num += 1;
END

-- ---- HAKIMI: Setup Required (4199-4200, 2 rows) ----
SET @num = 4199;
WHILE @num <= 4200
BEGIN
    SET @clientIdx = ((@num - 4199) % @hakimiCount) + 1;
    SELECT @clientId = ClientId, @site = Site FROM @hakimiClients WHERE n = @clientIdx;
    INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
    VALUES (1, @num, @clientId, 'PO-SETUP-' + CAST(@num AS NVARCHAR(10)), '2026-05-01', NULL, '2026-05-02', NULLIF(@site, ''), 'Setup Required', 0, 0, NULL);
    SET @newChallanId = SCOPE_IDENTITY();
    INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
    VALUES (@newChallanId, @itemTypeId, 'FBR-incomplete item', 3, 'Pcs');
    SET @num += 1;
END

-- ---- HAKIMI: Invoiced (4201-4213, 13 rows + 13 invoices, 3745..3757) ----
SET @num = 4201;
SET @invNum = 3745;
WHILE @num <= 4213
BEGIN
    SET @clientIdx = ((@num - 4201) % @hakimiCount) + 1;
    SELECT @clientId = ClientId, @site = Site FROM @hakimiClients WHERE n = @clientIdx;

    INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
    VALUES (1, @num, @clientId, 'PO-BILL-' + CAST(@num AS NVARCHAR(10)), '2026-05-01', NULL, '2026-05-02', NULLIF(@site, ''), 'Invoiced', 0, 0, NULL);
    SET @newChallanId = SCOPE_IDENTITY();
    INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
    VALUES (@newChallanId, @itemTypeId, 'Billed item', 4, 'Pcs');
    SET @newItemId = SCOPE_IDENTITY();

    INSERT INTO Invoices (InvoiceNumber, Date, CompanyId, ClientId, Subtotal, GSTRate, GSTAmount, GrandTotal, AmountInWords, PaymentTerms, IsDemo, IsFbrExcluded, CreatedAt)
    VALUES (@invNum, '2026-05-02', 1, @clientId, 4000.00, 18, 720.00, 4720.00, 'Four Thousand Seven Hundred Twenty Rupees Only', '30 days', 0, 0, GETUTCDATE());
    SET @invoiceId = SCOPE_IDENTITY();

    INSERT INTO InvoiceItems (InvoiceId, DeliveryItemId, ItemTypeId, ItemTypeName, Description, Quantity, UOM, UnitPrice, LineTotal)
    VALUES (@invoiceId, @newItemId, @itemTypeId, 'Valves', 'Billed item', 4, 'Pcs', 1000.00, 4000.00);

    UPDATE DeliveryChallans SET InvoiceId = @invoiceId WHERE Id = @newChallanId;

    SET @num    += 1;
    SET @invNum += 1;
END

-- ---- ROSHAN: Imported (1075-1081, 7 rows) ----
SET @num = 1075;
WHILE @num <= 1081
BEGIN
    SET @clientIdx = ((@num - 1075) % @roshanCount) + 1;
    SELECT @clientId = ClientId, @site = Site FROM @roshanClients WHERE n = @clientIdx;
    INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
    VALUES (2, @num, @clientId, 'PO-OLD-R-' + CAST(@num AS NVARCHAR(10)), '2024-08-15', NULL, '2024-08-20', NULLIF(@site, ''), 'Imported', 1, 0, NULL);
    SET @newChallanId = SCOPE_IDENTITY();
    INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
    VALUES (@newChallanId, @itemTypeId, 'Historical Roshan item', 5, 'Pcs');
    SET @num += 1;
END

-- ---- ROSHAN: Pending (1082-1085, 4 rows) ----
SET @num = 1082;
WHILE @num <= 1085
BEGIN
    SET @clientIdx = ((@num - 1082) % @roshanCount) + 1;
    SELECT @clientId = ClientId, @site = Site FROM @roshanClients WHERE n = @clientIdx;
    INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
    VALUES (2, @num, @clientId, 'PO-R-' + CAST(@num AS NVARCHAR(10)), '2026-05-01', NULL, '2026-05-02', NULLIF(@site, ''), 'Pending', 0, 0, NULL);
    SET @newChallanId = SCOPE_IDENTITY();
    INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
    VALUES (@newChallanId, @itemTypeId, 'Roshan pending item', 10, 'Pcs');
    SET @num += 1;
END

-- ---- ROSHAN: Cancelled (1086-1087, 2 rows) ----
SET @num = 1086;
WHILE @num <= 1087
BEGIN
    SET @clientIdx = ((@num - 1086) % @roshanCount) + 1;
    SELECT @clientId = ClientId, @site = Site FROM @roshanClients WHERE n = @clientIdx;
    INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
    VALUES (2, @num, @clientId, 'PO-R-CANC-' + CAST(@num AS NVARCHAR(10)), '2026-05-01', NULL, '2026-05-02', NULLIF(@site, ''), 'Cancelled', 0, 0, NULL);
    SET @newChallanId = SCOPE_IDENTITY();
    INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
    VALUES (@newChallanId, @itemTypeId, 'Cancelled', 1, 'Pcs');
    SET @num += 1;
END

-- ---- ROSHAN: No PO (1088-1089, 2 rows) ----
SET @num = 1088;
WHILE @num <= 1089
BEGIN
    SET @clientIdx = ((@num - 1088) % @roshanCount) + 1;
    SELECT @clientId = ClientId, @site = Site FROM @roshanClients WHERE n = @clientIdx;
    INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
    VALUES (2, @num, @clientId, '', NULL, NULL, '2026-05-02', NULLIF(@site, ''), 'No PO', 0, 0, NULL);
    SET @newChallanId = SCOPE_IDENTITY();
    INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
    VALUES (@newChallanId, @itemTypeId, 'Pre-PO sample', 2, 'Pcs');
    SET @num += 1;
END

-- ---- ROSHAN: Setup Required (1090, 1 row) ----
INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
VALUES (2, 1090, @cAquagen_C2, 'PO-R-SETUP-1090', '2026-05-01', NULL, '2026-05-02', NULL, 'Setup Required', 0, 0, NULL);
SET @newChallanId = SCOPE_IDENTITY();
INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
VALUES (@newChallanId, @itemTypeId, 'FBR-incomplete item', 3, 'Pcs');

-- ---- ROSHAN: Invoiced (1091-1102, 12 rows + 12 invoices, 971..982) ----
SET @num = 1091;
SET @invNum = 971;
WHILE @num <= 1102
BEGIN
    SET @clientIdx = ((@num - 1091) % @roshanCount) + 1;
    SELECT @clientId = ClientId, @site = Site FROM @roshanClients WHERE n = @clientIdx;

    INSERT INTO DeliveryChallans (CompanyId, ChallanNumber, ClientId, PoNumber, PoDate, IndentNo, DeliveryDate, Site, Status, IsImported, IsDemo, DuplicatedFromId)
    VALUES (2, @num, @clientId, 'PO-R-BILL-' + CAST(@num AS NVARCHAR(10)), '2026-05-01', NULL, '2026-05-02', NULLIF(@site, ''), 'Invoiced', 0, 0, NULL);
    SET @newChallanId = SCOPE_IDENTITY();
    INSERT INTO DeliveryItems (DeliveryChallanId, ItemTypeId, Description, Quantity, Unit)
    VALUES (@newChallanId, @itemTypeId, 'Billed Roshan item', 4, 'Pcs');
    SET @newItemId = SCOPE_IDENTITY();

    INSERT INTO Invoices (InvoiceNumber, Date, CompanyId, ClientId, Subtotal, GSTRate, GSTAmount, GrandTotal, AmountInWords, PaymentTerms, IsDemo, IsFbrExcluded, CreatedAt)
    VALUES (@invNum, '2026-05-02', 2, @clientId, 4000.00, 18, 720.00, 4720.00, 'Four Thousand Seven Hundred Twenty Rupees Only', '30 days', 0, 0, GETUTCDATE());
    SET @invoiceId = SCOPE_IDENTITY();

    INSERT INTO InvoiceItems (InvoiceId, DeliveryItemId, ItemTypeId, ItemTypeName, Description, Quantity, UOM, UnitPrice, LineTotal)
    VALUES (@invoiceId, @newItemId, @itemTypeId, 'Valves', 'Billed Roshan item', 4, 'Pcs', 1000.00, 4000.00);

    UPDATE DeliveryChallans SET InvoiceId = @invoiceId WHERE Id = @newChallanId;

    SET @num    += 1;
    SET @invNum += 1;
END

-- ============================================================================
-- Final summary (printed; not part of the transaction commit)
-- ============================================================================
PRINT '';
PRINT '== Summary ==';

SELECT CompanyId, COUNT(*) AS ChallanCount FROM DeliveryChallans WHERE CompanyId IN (1, 2) GROUP BY CompanyId;
SELECT CompanyId, Status, COUNT(*) AS ChallanCount FROM DeliveryChallans WHERE CompanyId IN (1, 2) GROUP BY CompanyId, Status ORDER BY CompanyId, Status;
SELECT CompanyId, COUNT(*) AS InvoiceCount FROM Invoices WHERE CompanyId IN (1, 2) GROUP BY CompanyId;
SELECT 'POFormats' AS Tbl, COUNT(*) AS Total FROM POFormats
UNION ALL SELECT 'POFormatVersions', COUNT(*) FROM POFormatVersions
UNION ALL SELECT 'Clients (1,2)', COUNT(*) FROM Clients WHERE CompanyId IN (1, 2);

COMMIT TRANSACTION;
PRINT '== Done ==';
