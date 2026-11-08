[CmdletBinding()]
param([int]$PollSeconds = 2)

$ErrorActionPreference = 'Stop'
$DeployScript = Join-Path $PSScriptRoot 'admin-android-deploy.ps1'

function Resolve-Adb {
    $path = (Get-Command adb.exe -ErrorAction SilentlyContinue).Source
    if ($path) { return $path }
    foreach ($candidate in @(
        (Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe'),
        (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'),
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe')
    )) { if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate } }
    throw 'adb.exe was not found. Install Android platform-tools or add platform-tools to PATH.'
}
function Get-AuthorizedDevices([string]$AdbPath) {
    $lines = & $AdbPath devices
    if ($LASTEXITCODE -ne 0) { throw 'Could not list ADB devices.' }
    $result = @()
    foreach ($line in ($lines | Select-Object -Skip 1)) {
        if ($line -match '^\s*(\S+)\s+device\s*$') { $result += $Matches[1] }
        elseif ($line -match '^\s*(\S+)\s+(unauthorized|offline)\s*$') { Write-Host "[admin-android-watch] $($Matches[1]) is $($Matches[2]); waiting for authorization/connection." }
    }
    return $result
}

try {
    $adbPath = Resolve-Adb
    Write-Host "[admin-android-watch] Watching for new authorized Android devices with $adbPath"
    & $adbPath start-server
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the ADB server.' }
    $known = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    while ($true) {
        $devices = @(Get-AuthorizedDevices $adbPath)
        $connected = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($serial in $devices) { [void]$connected.Add($serial) }
        foreach ($serial in @($known)) { if (-not $connected.Contains($serial)) { [void]$known.Remove($serial); Write-Host "[admin-android-watch] Device disconnected: $serial" } }
        foreach ($serial in $devices) {
            if ($known.Add($serial)) {
                Write-Host "[admin-android-watch] New device detected: $serial. Building and installing once..."
                & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $DeployScript -DeviceSerial $serial
                if ($LASTEXITCODE -ne 0) { Write-Host "[admin-android-watch] Deployment failed for $serial. It will not rebuild until the device disconnects and reconnects." }
            }
        }
        Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds))
    }
} catch {
    Write-Error "[admin-android-watch] FAILED: $($_.Exception.Message)"
    exit 1
} finally {
    Write-Host '[admin-android-watch] Stopped.'
}
