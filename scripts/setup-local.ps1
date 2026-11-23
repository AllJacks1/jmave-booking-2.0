# Creates the local databases and writes .env.local (Windows, local Postgres).
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
# Prompts for the Postgres password; never prints secrets.

param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin",
  [string]$PgUser = "postgres",
  [string]$PgHost = "localhost",
  [int]$PgPort = 5432
)

$ErrorActionPreference = "Stop"
if (Test-Path ".env.local") {
  Write-Host ".env.local already exists - leaving it alone." -ForegroundColor Yellow
  exit 1
}

$secure = Read-Host "Password for Postgres user '$PgUser'" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:PGPASSWORD = $plain

foreach ($db in @("jmave_dev", "jmave_test", "jmave_e2e")) {
  $exists = & "$PgBin\psql.exe" -h $PgHost -p $PgPort -U $PgUser -tAc "select 1 from pg_database where datname = '$db'"
  if ($LASTEXITCODE -ne 0) { throw "Could not connect to Postgres." }
  if ($exists -ne "1") {
    & "$PgBin\createdb.exe" -h $PgHost -p $PgPort -U $PgUser $db
    Write-Host "created $db"
  } else {
    Write-Host "$db already exists"
  }
}

function New-Secret([int]$bytes) {
  $b = New-Object byte[] $bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ([Convert]::ToBase64String($b) -replace '[+/=]', '')
}

$enc = [Uri]::EscapeDataString($plain)
$base = "postgres://$($PgUser):$enc@$($PgHost):$PgPort"
$lines = @(
  "DATABASE_URL=$base/jmave_dev",
  "TEST_DATABASE_URL=$base/jmave_test",
  "E2E_DATABASE_URL=$base/jmave_e2e",
  "BETTER_AUTH_SECRET=$(New-Secret 32)",
  "APP_URL=http://localhost:3000",
  "SETUP_TOKEN=$(New-Secret 24)"
)
# UTF-8 without BOM (works on Windows PowerShell 5.1 and PowerShell 7).
[IO.File]::WriteAllText((Join-Path (Get-Location) ".env.local"), (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))

Remove-Item Env:PGPASSWORD
Write-Host "Wrote .env.local (DATABASE_URL, TEST_DATABASE_URL, E2E_DATABASE_URL, BETTER_AUTH_SECRET, APP_URL, SETUP_TOKEN)." -ForegroundColor Green
Write-Host "Your local SETUP_TOKEN is in .env.local."
