# Sign one file with Azure Artifact Signing (formerly Azure Trusted Signing),
# then prove it: the file must read back as a Valid Authenticode signature.
#
# Called by Tauri for every binary and installer it signs (bundle.windows.
# signCommand, set only on signed CI builds by desktop-release.yml) and by
# scripts/build-helper.mjs for the helper, which Tauri does not sign itself.
#
# Credentials: the az CLI session from the workflow's OIDC `azure/login`
# (AzureCliCredential) — no client secret exists. Every other credential source
# is excluded so a runner can never sign as some other identity.
# Account configuration:
#   AZURE_CODE_SIGNING_ENDPOINT      e.g. https://eus.codesigning.azure.net
#   AZURE_CODE_SIGNING_ACCOUNT_NAME  the Artifact Signing account
#   AZURE_CERTIFICATE_PROFILE_NAME   the Public Trust certificate profile
#
# "Returned without error" is not proof of a signature (ZelCore 8.37.1 shipped
# unsigned that way), hence the read-back check before exiting 0.
param(
  [Parameter(Mandatory = $true)][string]$Path
)
$ErrorActionPreference = 'Stop'

foreach ($name in 'AZURE_CODE_SIGNING_ENDPOINT', 'AZURE_CODE_SIGNING_ACCOUNT_NAME', 'AZURE_CERTIFICATE_PROFILE_NAME') {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "sign-windows: $name is not set" }
}
if (-not (Test-Path -LiteralPath $Path)) { throw "sign-windows: no such file: $Path" }
$file = (Resolve-Path -LiteralPath $Path).Path

Import-Module TrustedSigning

# Artifact Signing certificates live ~3 days, so every signature MUST be
# timestamped or it dies with the certificate.
$params = @{
  Endpoint               = $env:AZURE_CODE_SIGNING_ENDPOINT
  CodeSigningAccountName = $env:AZURE_CODE_SIGNING_ACCOUNT_NAME
  CertificateProfileName = $env:AZURE_CERTIFICATE_PROFILE_NAME
  Files                  = $file
  FileDigest             = 'SHA256'
  TimestampRfc3161       = 'http://timestamp.acs.microsoft.com'
  TimestampDigest        = 'SHA256'
  # Only the az CLI session (OIDC login); nothing else on the runner.
  ExcludeEnvironmentCredential        = $true
  ExcludeAzurePowerShellCredential    = $true
  ExcludeManagedIdentityCredential    = $true
  ExcludeSharedTokenCacheCredential   = $true
  ExcludeVisualStudioCredential       = $true
  ExcludeVisualStudioCodeCredential   = $true
  ExcludeWorkloadIdentityCredential   = $true
  ExcludeInteractiveBrowserCredential = $true
}

$attempts = 3
for ($i = 1; $i -le $attempts; $i++) {
  try {
    Invoke-TrustedSigning @params
    break
  } catch {
    if ($i -eq $attempts) { throw }
    Write-Host "sign-windows: attempt $i failed ($($_.Exception.Message)); retrying"
    Start-Sleep -Seconds (5 * $i)
  }
}

$sig = Get-AuthenticodeSignature -LiteralPath $file
if ($sig.Status -ne 'Valid') {
  throw "sign-windows: $file is not validly signed after signing: $($sig.Status) $($sig.StatusMessage)"
}
if (-not $sig.TimeStamperCertificate) {
  throw "sign-windows: $file has no timestamp"
}
Write-Host "sign-windows: signed $file by $($sig.SignerCertificate.Subject)"
