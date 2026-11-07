$ErrorActionPreference = 'Stop'
$previousAdminEmail = [Environment]::GetEnvironmentVariable('ADMIN_EMAIL', 'Process')
$previousAdminPassword = [Environment]::GetEnvironmentVariable('ADMIN_PASSWORD', 'Process')
$env:ADMIN_EMAIL = 'Harborhouse@gmail.com'

$passwordBstr = [IntPtr]::Zero
$confirmationBstr = [IntPtr]::Zero
$securePassword = $null
$secureConfirmation = $null
try {
  $securePassword = Read-Host 'Enter a new admin password (12-256 characters)' -AsSecureString
  if ($securePassword.Length -lt 12 -or $securePassword.Length -gt 256) {
    throw 'Password must be between 12 and 256 characters.'
  }
  $secureConfirmation = Read-Host 'Confirm the admin password' -AsSecureString
  $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $confirmationBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConfirmation)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
  $confirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationBstr)
  if ($password -cne $confirmation) {
    throw 'Passwords do not match.'
  }

  $env:ADMIN_PASSWORD = $password
  & node (Join-Path $PSScriptRoot 'server.js')
  if ($LASTEXITCODE -ne 0) {
    throw "Server exited with code $LASTEXITCODE."
  }
} finally {
  if ($passwordBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
  }
  if ($confirmationBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationBstr)
  }
  if ($null -ne $securePassword) {
    $securePassword.Dispose()
  }
  if ($null -ne $secureConfirmation) {
    $secureConfirmation.Dispose()
  }
  $password = $null
  $confirmation = $null
  if ($null -eq $previousAdminPassword) {
    Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
  } else {
    $env:ADMIN_PASSWORD = $previousAdminPassword
  }
  if ($null -eq $previousAdminEmail) {
    Remove-Item Env:ADMIN_EMAIL -ErrorAction SilentlyContinue
  } else {
    $env:ADMIN_EMAIL = $previousAdminEmail
  }
}
