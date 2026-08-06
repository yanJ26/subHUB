param(
  [string]$NodePath = "node"
)

$varsPath = Join-Path $PSScriptRoot "..\.dev.vars"
if (Test-Path -LiteralPath $varsPath) {
  foreach ($line in [IO.File]::ReadAllLines($varsPath)) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $parts = $trimmed.Split("=", 2)
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
  }
}

$logPath = Join-Path $PSScriptRoot "..\dev-server.out.log"
& $NodePath node_modules/vinext/dist/cli.js dev --hostname 127.0.0.1 *> $logPath
