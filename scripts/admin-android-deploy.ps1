[CmdletBinding()]
param(
    [string]$DeviceSerial,
    [int]$PollSeconds = 3
)

$ErrorActionPreference = 'Stop'
$StagingApi = 'https://paisapay-api-staging.onrender.com'
$PackageName = 'com.paisapay.admin'
$AppRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\apps\admin-app'))
$ApkPath = Join-Path $AppRoot 'android\app\build\outputs\apk\debug\app-debug.apk'

function Write-Status([string]$Message) { Write-Host "[admin-android] $Message" }
function Invoke-Adb([string[]]$Arguments) {
    & $script:AdbPath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "ADB failed ($LASTEXITCODE): adb $($Arguments -join ' ')" }
}
function Get-AuthorizedDevices {
    $lines = & $script:AdbPath devices
    if ($LASTEXITCODE -ne 0) { throw 'Could not list ADB devices.' }
    foreach ($line in ($lines | Select-Object -Skip 1)) {
        if ($line -match '^\s*(\S+)\s+device\s*$') { $Matches[1] }
        elseif ($line -match '^\s*(\S+)\s+(unauthorized|offline)\s*$') {
            Write-Status "Device $($Matches[1]) is $($Matches[2]); unlock it and authorize USB debugging."
        }
    }
}

try {
    $script:AdbPath = (Get-Command adb.exe -ErrorAction SilentlyContinue).Source
    if (-not $script:AdbPath) {
        foreach ($candidate in @(
            (Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe'),
            (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'),
            (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe')
        )) {
            if ($candidate -and (Test-Path -LiteralPath $candidate)) { $script:AdbPath = $candidate; break }
        }
    }
    if (-not $script:AdbPath) { throw 'adb.exe was not found. Install Android platform-tools or add platform-tools to PATH.' }
    Write-Status "Using ADB: $script:AdbPath"
    Invoke-Adb @('start-server')

    $targets = @()
    while ($targets.Count -eq 0) {
        $available = @(Get-AuthorizedDevices)
        if ($DeviceSerial) { $targets = @($available | Where-Object { $_ -eq $DeviceSerial }) }
        else { $targets = $available }
        if ($targets.Count -eq 0) {
            if ($DeviceSerial) { Write-Status "Waiting for authorized device $DeviceSerial..." }
            else { Write-Status 'No authorized device connected. Waiting for an ADB device...' }
            Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds))
        }
    }
    Write-Status "Target device(s): $($targets -join ', ')"

    # Force the staging endpoint in this process and in both Expo/Metro children.
    $env:EXPO_PUBLIC_API_URL = $StagingApi
    $env:EXPO_NO_DOTENV = '1'
    Push-Location $AppRoot
    try {
        Write-Status 'Syncing the Android project from the current Admin app sources...'
        & npx.cmd expo prebuild --platform android --no-install
        if ($LASTEXITCODE -ne 0) { throw "Expo Android sync failed ($LASTEXITCODE)." }

        Write-Status 'Building the debug APK...'
        Push-Location (Join-Path $AppRoot 'android')
        try {
            & .\gradlew.bat --no-daemon --console=plain assembleDebug
            if ($LASTEXITCODE -ne 0) { throw "Gradle debug build failed ($LASTEXITCODE)." }
        } finally { Pop-Location }
        if (-not (Test-Path -LiteralPath $ApkPath)) { throw "Debug APK was not produced at $ApkPath" }

        # A debug Expo build loads its JavaScript from Metro. Refuse to reuse an
        # unrelated Metro instance so the app cannot silently target another API.
        $metroStatus = $null
        try { $metroStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/status' -TimeoutSec 2 } catch { }
        $markerPath = Join-Path $AppRoot '.expo\admin-android-metro.pid'
        if ($metroStatus) {
            $ownedPid = 0
            if ((Test-Path -LiteralPath $markerPath) -and [int]::TryParse((Get-Content -LiteralPath $markerPath -Raw).Trim(), [ref]$ownedPid)) {
                $ownedProcess = Get-Process -Id $ownedPid -ErrorAction SilentlyContinue
                if (-not $ownedProcess) { throw 'Metro is already serving port 8081 but the recorded staging Metro process is gone. Stop the existing Metro process and retry.' }
            } else { throw 'Port 8081 is serving an unverified Metro instance. Stop it and retry to ensure the staging API URL is used.' }
        } else {
            $expoDir = Join-Path $AppRoot '.expo'
            New-Item -ItemType Directory -Force -Path $expoDir | Out-Null
            $stdout = Join-Path $expoDir 'admin-android-metro.log'
            $stderr = Join-Path $expoDir 'admin-android-metro.err.log'
            Write-Status 'Starting Metro with the staging API configuration...'
            $metro = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', 'npx expo start --dev-client --localhost --port 8081') -WorkingDirectory $AppRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
            Set-Content -LiteralPath $markerPath -Value $metro.Id -NoNewline
            $ready = $false
            for ($i = 0; $i -lt 60; $i++) {
                Start-Sleep -Seconds 2
                if ($metro.HasExited) { throw "Staging Metro exited during startup. See $stdout and $stderr" }
                try { $metroStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/status' -TimeoutSec 2; $ready = $true; break } catch { }
            }
            if (-not $ready) { throw "Staging Metro did not become ready. See $stdout and $stderr" }
        }

        $encodedMetroUrl = [Uri]::EscapeDataString('http://localhost:8081')
        $devClientUri = "exp+paisapay-admin://expo-development-client/?url=$encodedMetroUrl"
        foreach ($serial in $targets) {
            Write-Status "Connecting device $serial to local Metro..."
            Invoke-Adb @('-s', $serial, 'reverse', 'tcp:8081', 'tcp:8081')
            Write-Status "Installing staging debug APK on $serial (app data is preserved)..."
            Invoke-Adb @('-s', $serial, 'install', '-r', $ApkPath)
            Write-Status "Launching PaisaPay Admin on $serial..."
            Invoke-Adb @('-s', $serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', $devClientUri, '-p', $PackageName)
        }
        Write-Status "SUCCESS: built and installed staging Admin APK; API URL is $StagingApi"
    } finally { Pop-Location }
} catch {
    Write-Error "FAILED: $($_.Exception.Message)"
    exit 1
}
