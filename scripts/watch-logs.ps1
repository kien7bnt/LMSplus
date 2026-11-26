# =====================================================
#  LMSPLUS - Theo doi log thoi gian thuc (Backend + Frontend)
#  Chay trong cua so rieng, khong tu dong dong.
# =====================================================
param(
    [string]$LogDir = (Join-Path $PSScriptRoot '..\logs')
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = 'LMSPLUS Logs'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$sources = @(
    @{ Name = 'BACKEND '; File = Join-Path $LogDir 'backend.log';  Color = 'Cyan' },
    @{ Name = 'FRONTEND'; File = Join-Path $LogDir 'frontend.log'; Color = 'Magenta' }
)

# Bat dau doc tu cuoi file (chi hien log moi)
$positions = @{}
foreach ($s in $sources) {
    if (-not (Test-Path $s.File)) { New-Item -ItemType File -Path $s.File -Force | Out-Null }
    $positions[$s.File] = (Get-Item $s.File).Length
}

function Test-Url([string]$url) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        return $r.StatusCode -lt 500
    } catch { return $false }
}

function Read-DotEnvMap {
    $map = @{}
    $envPath = Join-Path (Join-Path $PSScriptRoot '..') '.env'
    if (-not (Test-Path $envPath)) { return $map }
    foreach ($line in (Get-Content -Path $envPath -Encoding UTF8)) {
        $t = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($t) -or $t.StartsWith('#')) { continue }
        $eq = $t.IndexOf('=')
        if ($eq -le 0) { continue }
        $k = $t.Substring(0, $eq).Trim()
        $v = $t.Substring($eq + 1).Trim().Trim('"').Trim("'")
        $map[$k] = $v
    }
    return $map
}

function Get-PgHealthTarget {
    $envMap = Read-DotEnvMap
    $clientMode = if ($env:LMSPLUS_DB_CLIENT) { $env:LMSPLUS_DB_CLIENT } elseif ($envMap.ContainsKey('LMSPLUS_DB_CLIENT')) { $envMap['LMSPLUS_DB_CLIENT'] } else { 'auto' }
    if ($clientMode.ToLowerInvariant() -eq 'sqlite') { return $null }
    $dbUrl = if ($env:DATABASE_URL) { $env:DATABASE_URL } elseif ($envMap.ContainsKey('DATABASE_URL')) { $envMap['DATABASE_URL'] } else { '' }
    $pgHost = if ($env:PGHOST) { $env:PGHOST } elseif ($envMap.ContainsKey('PGHOST')) { $envMap['PGHOST'] } else { '' }
    $pgPort = 5432
    $portRaw = if ($env:PGPORT) { $env:PGPORT } elseif ($envMap.ContainsKey('PGPORT')) { $envMap['PGPORT'] } else { '5432' }
    [void][int]::TryParse($portRaw, [ref]$pgPort)
    if ($dbUrl) {
        try {
            $u = [Uri]$dbUrl
            if ($u.Host) { $pgHost = $u.Host }
            if ($u.Port -gt 0) { $pgPort = $u.Port }
        } catch {}
    }
    if ([string]::IsNullOrWhiteSpace($pgHost)) { return $null }
    return @{ Host = $pgHost; Port = $pgPort }
}

function Test-TcpPort([string]$HostName, [int]$Port, [int]$TimeoutMs = 400) {
    $c = $null
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $ar = $c.BeginConnect($HostName, $Port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
        $c.EndConnect($ar) | Out-Null
        return $true
    } catch { return $false } finally {
        if ($c) { try { $c.Dispose() } catch {} }
    }
}

$script:LastPgOfflineHint = $false

function Show-Health {
    $be = if (Test-Url 'http://127.0.0.1:8000/health') { 'ONLINE ' } else { 'OFFLINE' }
    $fe = if (Test-Url 'http://127.0.0.1:5173/')       { 'ONLINE ' } else { 'OFFLINE' }
    $pgTarget = Get-PgHealthTarget
    $pgSuffix = ''
    $pgOk = $true
    if ($pgTarget) {
        $pgUp = Test-TcpPort $pgTarget.Host $pgTarget.Port
        $pgOk = $pgUp
        $pgState = if ($pgUp) { 'ONLINE ' } else { 'OFFLINE' }
        $pgSuffix = " | Postgres :$($pgTarget.Port) = $pgState"
    }
    $time = Get-Date -Format 'HH:mm:ss'
    $color = if ($be -eq 'ONLINE ' -and $fe -eq 'ONLINE ' -and $pgOk) { 'Green' } elseif (-not $pgOk) { 'Red' } else { 'Yellow' }
    Write-Host "[$time] [HEALTH ] Backend :8000 = $be | Frontend :5173 = $fe$pgSuffix" -ForegroundColor $color
    if ($pgTarget -and -not $pgOk) {
        if (-not $script:LastPgOfflineHint) {
            Write-Host "[$time] [HINT   ] PostgreSQL ($($pgTarget.Host):$($pgTarget.Port)) dang tat. Hay mo Docker Desktop roi bam [R] trong LMSPLUS Launcher." -ForegroundColor Yellow
            $script:LastPgOfflineHint = $true
        }
    } else {
        $script:LastPgOfflineHint = $false
    }
}

Write-Host '====================================================='
Write-Host ' LMSPLUS - LOG THOI GIAN THUC (Ctrl+C de dung theo doi)'
Write-Host " Thu muc log: $LogDir"
Write-Host '====================================================='
Start-Sleep -Seconds 3
Show-Health

$tick = 0
while ($true) {
    foreach ($s in $sources) {
        $file = $s.File
        if (-not (Test-Path $file)) { continue }
        $len = (Get-Item $file).Length
        if ($len -lt $positions[$file]) { $positions[$file] = 0 }   # file bi xoa / tao lai
        if ($len -gt $positions[$file]) {
            $fs = [System.IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
            $fs.Seek($positions[$file], 'Begin') | Out-Null
            $reader = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
            $chunk = $reader.ReadToEnd()
            $positions[$file] = $fs.Position
            $reader.Close(); $fs.Close()

            foreach ($line in ($chunk -split "`r?`n")) {
                if ([string]::IsNullOrWhiteSpace($line)) { continue }
                $color = $s.Color
                if ($line -match 'ERROR|Error:|EADDRINUSE|failed|Exception') { $color = 'Red' }
                elseif ($line -match 'WARN') { $color = 'Yellow' }
                Write-Host "[$($s.Name)] $line" -ForegroundColor $color
            }
        }
    }

    Start-Sleep -Milliseconds 700
    $tick++
    if ($tick % 43 -eq 0) { Show-Health }   # khoang 30 giay kiem tra 1 lan
}
