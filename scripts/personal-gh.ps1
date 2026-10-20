param([Parameter(ValueFromRemainingArguments=$true)][string[]]$GhArguments)
$ErrorActionPreference = 'Stop'
# Scope the selected identity to this process. Do not switch global gh profiles.
$savedGhToken = $env:GH_TOKEN
try {
  $selectedToken = gh auth token --hostname github.com --user Abhigyan2000
  if ($LASTEXITCODE -ne 0) { throw 'Authenticate the Abhigyan2000 gh profile first.' }
  $env:GH_TOKEN = $selectedToken
  $verifiedLogin = gh api user --jq .login
  if ($LASTEXITCODE -ne 0 -or $verifiedLogin -ne 'Abhigyan2000') { throw 'Expected personal GitHub identity Abhigyan2000.' }
  & gh @GhArguments
  $commandExitCode = $LASTEXITCODE
} finally {
  $env:GH_TOKEN = $savedGhToken
  $selectedToken = $null
}
exit $commandExitCode
