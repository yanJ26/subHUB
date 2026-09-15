param(
  [string]$NodePath = "node"
)

# Localhost-only development values. Never reuse these values on a VPS.
$env:SUBHUB_GATEWAY_HOST = "127.0.0.1"
$env:SUBHUB_GATEWAY_PORT = "8790"
$env:SUBHUB_DB_PATH = "data/local-dev.sqlite"
$env:SUBHUB_WEB_INTERNAL_TOKEN = "local-web-internal-token-not-for-production"

& $NodePath gateway/src/server.mjs
