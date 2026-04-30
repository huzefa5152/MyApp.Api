-- Force-runs the Common Clients backfill against current state.
-- For local dev only.
SET NOCOUNT ON;

PRINT '=== Before ===';
SELECT (SELECT COUNT(*) FROM ClientGroups) AS Groups,
       (SELECT COUNT(*) FROM Clients WHERE ClientGroupId IS NOT NULL) AS LinkedClients;

;WITH Digits(Id, DigitsNtn) AS (
    SELECT c.Id,
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             ISNULL(c.NTN, ''),
             ' ',  ''), '-', ''), '/', ''), '.', ''), '(', ''), ')', ''),
             ',', ''), ':', ''), '\', ''), '''''', ''), '"', ''), '+', ''), CHAR(9), '')
      FROM Clients c
),
Keyed AS (
    SELECT c.Id, c.CompanyId, c.Name, c.NTN, c.CreatedAt,
           d.DigitsNtn,
           LOWER(LTRIM(RTRIM(c.Name))) AS NormName,
           CASE
             WHEN LEN(d.DigitsNtn) >= 7 THEN N'NTN:'  + d.DigitsNtn
             ELSE                            N'NAME:' + LOWER(LTRIM(RTRIM(c.Name)))
           END AS GroupKey
      FROM Clients c
      JOIN Digits  d ON d.Id = c.Id
)
INSERT INTO ClientGroups (GroupKey, DisplayName, NormalizedNtn, NormalizedName, CreatedAt, UpdatedAt)
SELECT k.GroupKey,
       (SELECT TOP 1 k2.Name
          FROM Keyed k2
         WHERE k2.GroupKey = k.GroupKey
         ORDER BY k2.CreatedAt, k2.Id),
       CASE WHEN LEFT(k.GroupKey, 4) = N'NTN:' THEN SUBSTRING(k.GroupKey, 5, LEN(k.GroupKey)) ELSE NULL END,
       (SELECT TOP 1 k2.NormName
          FROM Keyed k2
         WHERE k2.GroupKey = k.GroupKey
         ORDER BY k2.CreatedAt, k2.Id),
       SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM (SELECT DISTINCT GroupKey FROM Keyed) k
 WHERE NOT EXISTS (SELECT 1 FROM ClientGroups g WHERE g.GroupKey = k.GroupKey);

PRINT 'After Step 2 (insert):';
SELECT COUNT(*) AS Groups FROM ClientGroups;

-- Step 3: link Clients
;WITH Digits2(Id, DigitsNtn) AS (
    SELECT c.Id,
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             ISNULL(c.NTN, ''),
             ' ',  ''), '-', ''), '/', ''), '.', ''), '(', ''), ')', ''),
             ',', ''), ':', ''), '\', ''), '''''', ''), '"', ''), '+', ''), CHAR(9), '')
      FROM Clients c
),
Keyed2 AS (
    SELECT c.Id,
           CASE
             WHEN LEN(d.DigitsNtn) >= 7 THEN N'NTN:'  + d.DigitsNtn
             ELSE                            N'NAME:' + LOWER(LTRIM(RTRIM(c.Name)))
           END AS GroupKey
      FROM Clients c
      JOIN Digits2 d ON d.Id = c.Id
     WHERE c.ClientGroupId IS NULL
)
UPDATE c
   SET c.ClientGroupId = g.Id
  FROM Clients c
  JOIN Keyed2  k ON k.Id = c.Id
  JOIN ClientGroups g ON g.GroupKey = k.GroupKey
 WHERE c.ClientGroupId IS NULL;

PRINT 'After Step 3 (link clients):';
SELECT COUNT(*) AS LinkedClients FROM Clients WHERE ClientGroupId IS NOT NULL;

PRINT '=== Multi-company groups (would show in Common Clients UI) ===';
SELECT g.Id, g.GroupKey, g.DisplayName,
       (SELECT COUNT(DISTINCT c.CompanyId) FROM Clients c WHERE c.ClientGroupId = g.Id) AS Companies
  FROM ClientGroups g
 WHERE (SELECT COUNT(DISTINCT c.CompanyId) FROM Clients c WHERE c.ClientGroupId = g.Id) >= 2
 ORDER BY Companies DESC, g.DisplayName;
