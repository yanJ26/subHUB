param(
  [string]$NodePath = "node"
)

# Localhost-only development values. Never reuse these values on a VPS.
$env:APIHUB_GATEWAY_HOST = "127.0.0.1"
$env:APIHUB_GATEWAY_PORT = "8787"
$env:APIHUB_DB_PATH = "data/local-dev.sqlite"
$env:APIHUB_OPENCLAW_TOKEN = "local-openclaw-token-not-for-production"
$env:APIHUB_OPENCLAW_HMAC_SECRET = "local-openclaw-hmac-not-for-production"
$env:APIHUB_WEB_INTERNAL_TOKEN = "local-web-internal-token-not-for-production"
$env:APIHUB_GATE_MODEL_BASE_URL = "http://127.0.0.1:9999/v1"
$env:APIHUB_GATE_MODEL = "local-placeholder-model"
$env:APIHUB_GATE_MODEL_API_KEY = "local-placeholder-key"

$masterKeyPath = Join-Path $PSScriptRoot "..\..\data\local-secrets-master-key"
if (-not (Test-Path -LiteralPath $masterKeyPath)) {
  $keyBytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($keyBytes) } finally { $generator.Dispose() }
  [IO.Directory]::CreateDirectory((Split-Path -Parent $masterKeyPath)) | Out-Null
  [IO.File]::WriteAllText($masterKeyPath, [Convert]::ToBase64String($keyBytes))
}
$env:APIHUB_SECRETS_MASTER_KEY = [IO.File]::ReadAllText($masterKeyPath).Trim()

& $NodePath gateway/src/server.mjs
