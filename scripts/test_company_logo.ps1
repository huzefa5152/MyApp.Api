param([string]$Base = 'http://localhost:5149', [string]$Username = 'admin', [string]$Password = 'admin123')
$ErrorActionPreference = 'Stop'
if (!([uri]$Base).IsLoopback) { throw 'This write-based test only runs locally.' }
$token = (Invoke-RestMethod "$Base/api/auth/login" -Method Post -ContentType 'application/json' -Body (@{username=$Username;password=$Password}|ConvertTo-Json)).token
$headers = @{Authorization="Bearer $token"}
$fixture = @{name="_test_logo_$([guid]::NewGuid().ToString('N'))";ntn='9999999';fbrEnabled=$false;enableGl=$false;fbrProvinceCode=8;fbrEnvironment='sandbox';fbrBusinessActivity='Manufacturer';fbrSector='Test';invoiceNumberPrefix='LOGO';requireSalesOrderForBilling=$true;inventoryTrackingEnabled=$true;stockGuardHardBlock=$true;startingInvoiceNumber=17;startingSalesQuoteNumber=23;startingSalesOrderNumber=29;startingPurchaseBillNumber=31;startingGoodsReceiptNumber=37;startingDebitNoteNumber=41;startingCreditNoteNumber=43;isTenantIsolated=$true;defaultWithholdingTaxRate=4.5}
$company = Invoke-RestMethod "$Base/api/companies" -Method Post -Headers $headers -ContentType 'application/json' -Body ($fixture|ConvertTo-Json)
$imageFile = Join-Path ([IO.Path]::GetTempPath()) "logo-test-$([guid]::NewGuid()).png"
try {
    [IO.File]::WriteAllBytes($imageFile,[Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3X8AAAAASUVORK5CYII='))
    $before = Invoke-RestMethod "$Base/api/companies/$($company.id)" -Headers $headers
    $uploaded = Invoke-RestMethod "$Base/api/companies/$($company.id)/logo" -Method Post -Headers $headers -Form @{file=Get-Item $imageFile}
    $after = Invoke-RestMethod "$Base/api/companies/$($company.id)" -Headers $headers
    if (!$after.logoPath -or $uploaded.logoPath -ne $after.logoPath) { throw 'Logo was not saved/returned.' }
    foreach($property in $before.PSObject.Properties) {
        if($property.Name -ne 'logoPath' -and $property.Value -cne $after.($property.Name)) { throw "Logo upload changed $($property.Name)" }
    }
    Write-Output 'PASS: logo saved; every other company field preserved.'
} finally {
    Invoke-RestMethod "$Base/api/companies/$($company.id)" -Method Delete -Headers $headers | Out-Null
    Remove-Item -LiteralPath $imageFile -ErrorAction SilentlyContinue
}
