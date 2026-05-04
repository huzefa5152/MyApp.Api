# Self-contained end-to-end test for the Duplicate Challan feature.
#
# Creates its own [CCD-TEST] company, client, and seeded challans, then walks
# every scenario worth verifying. Leaves the test company in place at the end
# so you can re-run without setup cost; print at the bottom shows the cleanup
# command if you want a clean slate.
#
# Run:  pwsh ./scripts/test_duplicate_challan.ps1
# Tested on: Windows PowerShell 5.1 (no PS7-only operators used).
#
# Coverage (10 cases, 36 assertions):
#   TC1  Duplicate Pending  -> clone is Pending, IsImported=false (inherited)
#   TC2  Duplicate Imported -> clone is Imported, IsImported=true (regression
#                              test for the bug where these were reset)
#   TC3  Duplicate a duplicate -> grand-child DuplicatedFromId points at the
#                                 ROOT, not the intermediate copy
#   TC4  Duplicate Cancelled -> 400 BadRequest with explicit error
#   TC5  Duplicate Invoiced  -> 400 BadRequest with explicit error
#   TC6  Duplicate non-existent id -> 404 NotFound
#   TC7  Source row is NOT mutated by the duplicate operation
#   TC8  Both Pending and Imported clones appear in the /pending billable list
#   TC9  Auto-increment still picks MAX(non-imported)+1 after duplicates exist
#   TC10 Same source can be duplicated more than once, each clone has unique Id

$ErrorActionPreference = 'Stop'
$baseUrl = 'http://localhost:5134/api'
$failures = @()
function Step($n) { Write-Host "`n=== $n ===" -ForegroundColor Cyan }
function Pass($m) { Write-Host "  PASS: $m" -ForegroundColor Green }
function Fail($m) { Write-Host "  FAIL: $m" -ForegroundColor Red; $script:failures += $m }
function Info($m) { Write-Host "  ...  $m" -ForegroundColor DarkGray }
function Assert($c, $m) { if ($c) { Pass $m } else { Fail $m } }
function Read-ErrBody($ex) {
    try {
        $stream = $ex.Exception.Response.GetResponseStream(); $stream.Position = 0
        $reader = New-Object System.IO.StreamReader($stream)
        $txt = $reader.ReadToEnd()
        $json = $txt | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($null -eq $json) { return $txt } else { return $json }
    } catch { return $null }
}

# ---- login ----
$loginBody = @{ Username='admin'; Password='admin123' } | ConvertTo-Json
$auth = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $loginBody -ContentType 'application/json'
$h = @{ Authorization = "Bearer $($auth.token)" }
Step 'Login'; Pass "JWT for $($auth.username)"

# ---- create test company ----
Step 'SETUP: create [CCD-TEST] company'
$compBody = @{
    name = 'CCD-TEST QA company'
    brandName = '[CCD-TEST] Duplicate QA'
    fullAddress = 'Test Lane 1, Karachi'
    phone = '+92 21 0000000'
    NTN = '0000001'; STRN = '00-00-0000-000-00'
    StartingChallanNumber = 1000; StartingInvoiceNumber = 2000
    InvoiceNumberPrefix = 'CCD'
    FbrProvinceCode = 7
    FbrBusinessActivity = 'Manufacturer'; FbrSector = 'Steel'
    FbrToken = 'sandbox-token'; FbrEnvironment = 'Sandbox'
} | ConvertTo-Json
$comp = Invoke-RestMethod -Uri "$baseUrl/companies" -Method Post -Headers $h -Body $compBody -ContentType 'application/json'
$companyId = $comp.id
Pass "company id=$companyId brand='$($comp.brandName)'"

# ---- create client ----
Step 'SETUP: create client'
$clientBody = @{
    companyId = $companyId; name = '[CCD-TEST] Buyer'
    address = 'Buyer Plot 1'; phone = '+92 0000'
    NTN = '0000002'; STRN = '00-00-0000-002-00'
    RegistrationType = 'Registered'; FbrProvinceCode = 7
    site = 'Unit-1;Unit-2'
} | ConvertTo-Json
$client = Invoke-RestMethod -Uri "$baseUrl/clients" -Method Post -Headers $h -Body $clientBody -ContentType 'application/json'
Pass "client id=$($client.id)"

# ---- pick existing item type from global catalog ----
Step 'SETUP: pick item type'
$itemTypes = Invoke-RestMethod -Uri "$baseUrl/itemtypes" -Headers $h
$itemType = $itemTypes | Select-Object -First 1
Pass "ItemType id=$($itemType.id) name='$($itemType.name)'"

function New-PendingChallan($po) {
    $body = @{
        companyId = $companyId; clientId = $client.id; site = 'Unit-1'
        poNumber = $po
        poDate = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssZ')
        deliveryDate = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssZ')
        items = @(@{ id=0; itemTypeId=$itemType.id; description='Test bar 12mm'; quantity=10; unit='Tons'; itemTypeName='' })
    } | ConvertTo-Json -Depth 5
    return Invoke-RestMethod -Uri "$baseUrl/deliverychallans/company/$companyId" -Method Post -Headers $h -Body $body -ContentType 'application/json'
}

# ---- seed challans across statuses ----
Step 'SETUP: seed Pending challans'
$cA = New-PendingChallan 'PO-A-Pending'
$cB = New-PendingChallan 'PO-B-WillCancel'
$cC = New-PendingChallan 'PO-C-WillBill'
Pass "cA #$($cA.challanNumber) id=$($cA.id) status=$($cA.status)"
Pass "cB #$($cB.challanNumber) id=$($cB.id)"
Pass "cC #$($cC.challanNumber) id=$($cC.id)"

# Imported via the historical-import endpoint, ChallanNumber < StartingChallanNumber
# so ReadyStatusFor() classifies it as Imported.
Step 'SETUP: import historical Imported (#50)'
$importRow = @{
    fileName = '[CCD-TEST] historical.xlsx'
    challanNumber = 50
    clientId = $client.id
    poNumber = 'PO-OLD-2020'
    poDate = '2020-01-15T00:00:00Z'
    deliveryDate = '2020-01-20T00:00:00Z'
    site = 'Unit-2'
    items = @(@{ itemTypeId=$itemType.id; description='Historical bar 10mm'; quantity=5; unit='Tons' })
}
# PS 5.1 unwraps single-element arrays in pipeline -- force array via comma operator + InputObject
$importBody = ConvertTo-Json -InputObject @(,$importRow) -Depth 5
$importResp = Invoke-RestMethod -Uri "$baseUrl/DeliveryChallans/company/$companyId/import-excel/commit" -Method Post -Headers $h -Body $importBody -ContentType 'application/json'
$importedRow = $importResp[0]
if (-not $importedRow.success) { Fail "import failed: $($importedRow.error)"; return }
$cI = Invoke-RestMethod -Uri "$baseUrl/deliverychallans/$($importedRow.insertedId)" -Headers $h
Pass "Imported #$($cI.challanNumber) id=$($cI.id) status=$($cI.status) isImp=$($cI.isImported)"

Step 'SETUP: cancel cB'
Invoke-RestMethod -Uri "$baseUrl/deliverychallans/$($cB.id)/cancel" -Method Put -Headers $h | Out-Null
$cB = Invoke-RestMethod -Uri "$baseUrl/deliverychallans/$($cB.id)" -Headers $h
Pass "cB status=$($cB.status)"

Step 'SETUP: bill cC'
$cC = Invoke-RestMethod -Uri "$baseUrl/deliverychallans/$($cC.id)" -Headers $h
$invBody = @{
    date = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssZ')
    companyId = $companyId; clientId = $client.id; gstRate = 18
    paymentTerms = '30 days'; paymentMode = 'Bank Transfer'
    challanIds = @($cC.id)
    items = @(@{ deliveryItemId=$cC.items[0].id; unitPrice=1000; uom='Tons'; saleType='Goods at standard rate (default)' })
} | ConvertTo-Json -Depth 5
$inv = Invoke-RestMethod -Uri "$baseUrl/invoices" -Method Post -Headers $h -Body $invBody -ContentType 'application/json'
$cC = Invoke-RestMethod -Uri "$baseUrl/deliverychallans/$($cC.id)" -Headers $h
Pass "cC status=$($cC.status) bill #$($inv.invoiceNumber)"

# ---- helper for capturing duplicate response + error body ----
function Try-Dup($id) {
    try {
        return [PSCustomObject]@{ Status=201; Body=(Invoke-RestMethod -Uri "$baseUrl/deliverychallans/$id/duplicate" -Method Post -Headers $h) }
    } catch {
        $code = 0; $body = $null
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode; $body = Read-ErrBody $_ }
        return [PSCustomObject]@{ Status=$code; Body=$body }
    }
}
$createdIds = @()

# ---- TC1 ----
Step 'TC1: Duplicate Pending'
$r1 = Try-Dup $cA.id
Assert ($r1.Status -eq 201) "201 Created"
$d1 = $r1.Body; $createdIds += $d1.id
Assert ($d1.id -ne $cA.id) "fresh Id"
Assert ($d1.challanNumber -eq $cA.challanNumber) "same ChallanNumber"
Assert ($d1.status -eq 'Pending') "status inherited = Pending"
Assert ($d1.isImported -eq $false) "isImported = false (inherited)"
Assert ($d1.duplicatedFromId -eq $cA.id) "DuplicatedFromId = cA"
Assert ($d1.duplicatedFromChallanNumber -eq $cA.challanNumber) "DupFromChallanNumber populated"
Assert ($null -eq $d1.invoiceId) "invoiceId null"
Assert (($d1.items|Measure-Object).Count -eq ($cA.items|Measure-Object).Count) "item count matches"

# ---- TC2 - the original bug regression ----
Step 'TC2: Duplicate Imported (THE BUG REGRESSION)'
$r2 = Try-Dup $cI.id
Assert ($r2.Status -eq 201) "201 Created"
$d2 = $r2.Body; $createdIds += $d2.id
Assert ($d2.status -eq 'Imported') "status inherited = Imported (was being reset to Pending before fix)"
Assert ($d2.isImported -eq $true) "isImported = TRUE (was being reset to false before fix)"
Assert ($d2.challanNumber -eq $cI.challanNumber) "same ChallanNumber"
Assert ($d2.duplicatedFromId -eq $cI.id) "DuplicatedFromId = cI"

# ---- TC3 ----
Step 'TC3: Duplicate a duplicate (root collapse)'
$r3 = Try-Dup $d1.id
Assert ($r3.Status -eq 201) "201 Created"
$d3 = $r3.Body; $createdIds += $d3.id
Assert ($d3.duplicatedFromId -eq $cA.id) "Grand-child collapses to ROOT cA, not intermediate d1"
Assert ($d3.challanNumber -eq $cA.challanNumber) "same ChallanNumber"

# ---- TC4 ----
Step 'TC4: Duplicate Cancelled (must reject)'
$r4 = Try-Dup $cB.id
Assert ($r4.Status -eq 400) "400 BadRequest"
$err4 = if ($r4.Body -is [string]) { $r4.Body } else { $r4.Body.error }
Assert ($err4 -match 'Only Pending or Imported') "error msg: '$err4'"

# ---- TC5 ----
Step 'TC5: Duplicate Invoiced (must reject)'
$r5 = Try-Dup $cC.id
Assert ($r5.Status -eq 400) "400 BadRequest"
$err5 = if ($r5.Body -is [string]) { $r5.Body } else { $r5.Body.error }
Assert ($err5 -match 'Only Pending or Imported') "error msg: '$err5'"

# ---- TC6 ----
Step 'TC6: Non-existent id (must 404)'
$r6 = Try-Dup 99999999
Assert ($r6.Status -eq 404) "404 NotFound"

# ---- TC7 ----
Step 'TC7: Source rows unchanged'
$cAA = Invoke-RestMethod -Uri "$baseUrl/deliverychallans/$($cA.id)" -Headers $h
$cII = Invoke-RestMethod -Uri "$baseUrl/deliverychallans/$($cI.id)" -Headers $h
Assert ($cAA.status -eq 'Pending') "cA still Pending"
Assert ($cII.status -eq 'Imported') "cI still Imported"
Assert ($cII.isImported -eq $true) "cI isImp still true"
Assert ($null -eq $cAA.duplicatedFromId) "cA DuplicatedFromId still null"

# ---- TC8 ----
Step 'TC8: Duplicates appear in /pending'
$pen = Invoke-RestMethod -Uri "$baseUrl/deliverychallans/company/$companyId/pending" -Headers $h
$ids = $pen | ForEach-Object { $_.id }
Assert ($ids -contains $d1.id) "d1 in /pending"
Assert ($ids -contains $d2.id) "d2 (Imported clone) in /pending"
Assert ($ids -contains $d3.id) "d3 in /pending"

# ---- TC9 ----
Step 'TC9: Auto-increment integrity'
$paged = Invoke-RestMethod -Uri "$baseUrl/deliverychallans/company/$companyId/paged?page=1&pageSize=50" -Headers $h
$nonImp = $paged.items | Where-Object { -not $_.isImported }
$maxN = ($nonImp | Measure-Object -Property challanNumber -Maximum).Maximum
$expectedNext = $maxN + 1
Info "MAX(non-imp) = $maxN; expecting next = $expectedNext"
$cD = New-PendingChallan 'PO-D-AfterDuplicates'
$createdIds += $cD.id
Assert ($cD.challanNumber -eq $expectedNext) "new challan got #$($cD.challanNumber) (expected $expectedNext)"
Assert ($null -eq $cD.duplicatedFromId) "non-duplicate has DuplicatedFromId null"

# ---- TC10 ----
Step 'TC10: Duplicate same source twice'
$r10 = Try-Dup $cA.id
Assert ($r10.Status -eq 201) "201 Created on second duplicate of same source"
$d10 = $r10.Body; $createdIds += $d10.id
Assert ($d10.id -ne $d1.id) "second dup has different Id"
Assert ($d10.challanNumber -eq $cA.challanNumber) "same ChallanNumber"
Assert ($d10.duplicatedFromId -eq $cA.id) "second dup also points to cA"

# ---- summary ----
Write-Host ''
Write-Host '================================================'
if ($failures.Count -eq 0) {
    Write-Host 'ALL TESTS PASSED' -ForegroundColor Green
} else {
    Write-Host ($failures.Count.ToString() + ' FAILURE(S):') -ForegroundColor Red
    $failures | ForEach-Object { Write-Host ('  - ' + $_) -ForegroundColor Red }
}
Write-Host ''
Write-Host "Test company id=$companyId left in place. To clean up: DELETE /api/companies/$companyId"
