# Run the LOCAL DEV backend (database = DeliveryChallanDb).
# Mirror of the "Built Frontend (Backend)" .claude/launch.json entry —
# useful when you'd rather drive the run from a terminal than the IDE.
#
# Uses appsettings.json + appsettings.Development.json. Binds the API
# to http://localhost:5134 so the existing frontend dev server / preview
# tooling find it unchanged.
#
# Run from the repo root:
#     pwsh scripts/run-dev.ps1
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot/..
try {
    $env:ASPNETCORE_ENVIRONMENT = "Development"
    Write-Host "Starting DEV backend on http://localhost:5134 (DB: DeliveryChallanDb)..." -ForegroundColor Cyan
    dotnet run --no-launch-profile --urls "http://localhost:5134"
}
finally {
    Pop-Location
}
