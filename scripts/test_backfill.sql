-- Trace through the Common Clients backfill manually to find why
-- the live run reported 0 groups despite 33 clients existing.
SET NOCOUNT ON;

PRINT '=== Step 1: Digits CTE rows ===';
;WITH Digits(Id, DigitsNtn) AS (
    SELECT c.Id,
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             ISNULL(c.NTN, ''),
             ' ',  ''), '-', ''), '/', ''), '.', ''), '(', ''), ')', ''),
             ',', ''), ':', ''), '\', ''), '''''', ''), '"', ''), '+', ''), CHAR(9), '')
      FROM Clients c
)
SELECT TOP 5 * FROM Digits;

PRINT '';
PRINT '=== Step 2: Keyed CTE rows ===';
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
SELECT TOP 15 Id, Name, NTN, DigitsNtn, GroupKey FROM Keyed ORDER BY GroupKey;

PRINT '';
PRINT '=== Step 3: distinct GroupKeys (count + sample) ===';
;WITH Digits(Id, DigitsNtn) AS (
    SELECT c.Id,
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             ISNULL(c.NTN, ''),
             ' ',  ''), '-', ''), '/', ''), '.', ''), '(', ''), ')', ''),
             ',', ''), ':', ''), '\', ''), '''''', ''), '"', ''), '+', ''), CHAR(9), '')
      FROM Clients c
),
Keyed AS (
    SELECT c.Id,
           CASE
             WHEN LEN(d.DigitsNtn) >= 7 THEN N'NTN:'  + d.DigitsNtn
             ELSE                            N'NAME:' + LOWER(LTRIM(RTRIM(c.Name)))
           END AS GroupKey
      FROM Clients c
      JOIN Digits  d ON d.Id = c.Id
)
SELECT COUNT(DISTINCT GroupKey) AS DistinctKeys FROM Keyed;
