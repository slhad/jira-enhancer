#Requires -Version 5.1
<#
.SYNOPSIS
  Builds Jira Enhancer for Windows and installs the Chrome native messaging host.

.DESCRIPTION
  - Prompts for allowed Chrome match patterns used in the extension manifest.
  - Optionally writes ALLOWED_SITES to the gitignored repo .env file.
  - Runs pnpm build with the selected ALLOWED_SITES.
  - If an extension ID is provided, installs the native messaging host for Chrome
    under HKCU so no administrator privileges are required.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install-windows.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install-windows.ps1 -ExtensionId abcdefghijklmnopqrstuvwxyzabcdef
#>

[CmdletBinding()]
param(
  [string]$ExtensionId,
  [string[]]$AdditionalSites = @(),
  [switch]$NoBuild,
  [switch]$NoEnvWrite,
  [switch]$DefaultsOnly
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoRoot {
  $scriptDir = Split-Path -Parent $PSCommandPath
  return (Resolve-Path (Join-Path $scriptDir '..')).Path
}

function Normalize-MatchPattern {
  param([string]$Value)

  $site = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($site)) { return $null }

  if ($site -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') {
    $site = "https://$site"
  }

  if ($site -notmatch '/.*$') {
    $site = "$site/*"
  } elseif ($site -notmatch '/$' -and $site -notmatch '\*$') {
    $site = "$site/*"
  }

  return $site
}

function Read-AdditionalSites {
  if ($DefaultsOnly) { return @() }

  Write-Host ''
  Write-Host 'Optional: add private Jira domains for this local build.'
  Write-Host 'Examples: https://jira.example.com/*, jira.example.com, https://*.example.atlassian.net/*'
  $raw = Read-Host 'Additional domains or match patterns (comma-separated, blank for none)'
  if ([string]::IsNullOrWhiteSpace($raw)) { return @() }

  return $raw.Split(',') | ForEach-Object { Normalize-MatchPattern $_ } | Where-Object { $_ }
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Value
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Update-EnvFile {
  param(
    [string]$EnvPath,
    [string]$AllowedSitesValue
  )

  if (Test-Path $EnvPath) {
    $lines = Get-Content -Path $EnvPath
    $updated = $false
    $newLines = foreach ($line in $lines) {
      if ($line -match '^\s*ALLOWED_SITES\s*=') {
        $updated = $true
        "ALLOWED_SITES=$AllowedSitesValue"
      } else {
        $line
      }
    }
    if (-not $updated) {
      $newLines += "ALLOWED_SITES=$AllowedSitesValue"
    }
    Write-Utf8NoBom -Path $EnvPath -Value (($newLines -join [Environment]::NewLine) + [Environment]::NewLine)
  } else {
    Write-Utf8NoBom -Path $EnvPath -Value "ALLOWED_SITES=$AllowedSitesValue$([Environment]::NewLine)"
  }
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

$repoRoot = Resolve-RepoRoot
$bridgeDist = Join-Path $repoRoot 'packages\bridge\dist\index.js'
$extensionDist = Join-Path $repoRoot 'packages\extension\dist'
$envPath = Join-Path $repoRoot '.env'

$defaultSites = @('https://*.atlassian.net/*', 'https://*.jira.com/*')

Write-Host 'Jira Enhancer Windows installer'
Write-Host "Repository: $repoRoot"
Write-Host ''
Write-Host 'Default extension domains:'
$defaultSites | ForEach-Object { Write-Host "  - $_" }

$normalizedAdditional = @()
$normalizedAdditional += $AdditionalSites | ForEach-Object { Normalize-MatchPattern $_ } | Where-Object { $_ }
$normalizedAdditional += Read-AdditionalSites

$allowedSites = @(($defaultSites + $normalizedAdditional) | Select-Object -Unique)
$allowedSitesValue = $allowedSites -join ','

Write-Host ''
Write-Host 'ALLOWED_SITES for this build:'
$allowedSites | ForEach-Object { Write-Host "  - $_" }

if (-not $NoEnvWrite) {
  $save = Read-Host 'Save these domains to gitignored .env for future builds? [Y/n]'
  if ([string]::IsNullOrWhiteSpace($save) -or $save -match '^(y|yes)$') {
    Update-EnvFile -EnvPath $envPath -AllowedSitesValue $allowedSitesValue
    Write-Host "Updated gitignored .env: $envPath"
  }
}

if (-not $NoBuild) {
  Assert-Command 'pnpm'
  Push-Location $repoRoot
  try {
    $env:ALLOWED_SITES = $allowedSitesValue
    Write-Host ''
    Write-Host 'Building packages...'
    pnpm build
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $extensionDist)) {
  Write-Warning "Extension dist not found at $extensionDist. Run this script without -NoBuild or run 'pnpm build'."
} else {
  Write-Host ''
  Write-Host "Chrome extension build: $extensionDist"
  Write-Host 'Load this directory via chrome://extensions -> Developer mode -> Load unpacked.'
}

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
  Write-Host ''
  Write-Host 'Native host not installed yet because no extension ID was provided.'
  Write-Host 'After loading the unpacked extension, copy its ID from chrome://extensions and rerun:'
  Write-Host "powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -ExtensionId <YOUR_EXTENSION_ID>"
  exit 0
}

if ($ExtensionId -notmatch '^[a-p]{32}$') {
  throw "ExtensionId '$ExtensionId' does not look like a Chrome extension ID (32 chars a-p)."
}

if (-not (Test-Path $bridgeDist)) {
  throw "Bridge build not found at $bridgeDist. Run this script without -NoBuild or run 'pnpm build'."
}

$nodeCommand = Get-Command 'node' -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Required command 'node' was not found on PATH."
}

$installDir = Join-Path $env:LOCALAPPDATA 'JiraEnhancer\NativeMessagingHost'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

$wrapperPath = Join-Path $installDir 'jira-enhancer-bridge.cmd'
$manifestPath = Join-Path $installDir 'com.jira_enhancer.bridge.json'

$wrapper = @"
@echo off
"$($nodeCommand.Source)" "$bridgeDist"
"@
[System.IO.File]::WriteAllText($wrapperPath, $wrapper, [System.Text.Encoding]::ASCII)

$manifest = [ordered]@{
  name = 'com.jira_enhancer.bridge'
  description = 'Jira Enhancer Native Messaging Bridge'
  path = $wrapperPath
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
Write-Utf8NoBom -Path $manifestPath -Value (($manifest | ConvertTo-Json -Depth 5) + [Environment]::NewLine)

$regKey = 'HKCU\Software\Google\Chrome\NativeMessagingHosts\com.jira_enhancer.bridge'
& reg.exe add $regKey /ve /t REG_SZ /d $manifestPath /f | Out-Null

Write-Host ''
Write-Host 'Native messaging host installed.'
Write-Host "Bridge script : $bridgeDist"
Write-Host "Wrapper       : $wrapperPath"
Write-Host "Manifest      : $manifestPath"
Write-Host "Registry key  : $regKey"
Write-Host 'Reload the extension in chrome://extensions to pick up the native host.'
