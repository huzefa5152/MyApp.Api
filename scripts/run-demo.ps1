# Run the LOCAL DEMO backend (database = DeliveryChallanDemo).
# Reads appsettings.json + appsettings.Demo.json. Binds to a DIFFERENT
# port (5135) than the dev backend (5134) so both can run side-by-side
# during a customer walkthrough.
#
# First start ever:
#   • EF auto-creates DeliveryChallanDemo and applies every migration.
#   • Data/DemoDataSeeder lays down ~6 months of synthetic activity
#     (one demo company, 8 clients, 5 suppliers, ~40 challans, ~25 bills,
#     ~15 purchase bills, opening stock, mock-IRN FBR-submitted invoices).
#   • A marker is written to AuditLogs so subsequent boots skip seeding.
#
# Bring up the frontend separately (npm run dev under myapp-frontend/)
# pointed at http://localhost:5135 if you want a live dev UI, OR open
# http://localhost:5135 directly to get the pre-built bundle in wwwroot/.
#
# Run from the repo root:
#     pwsh scripts/run-demo.ps1
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot/..
try {
    $env:ASPNETCORE_ENVIRONMENT = "Demo"
    Write-Host "Starting DEMO backend on http://localhost:5135 (DB: DeliveryChallanDemo)..." -ForegroundColor Magenta
    Write-Host "First start will create the demo database and seed it (~10-30s)." -ForegroundColor DarkGray
    dotnet run --no-launch-profile --urls "http://localhost:5135"
}
finally {
    Pop-Location
}
