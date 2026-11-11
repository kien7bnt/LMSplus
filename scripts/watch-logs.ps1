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

function Show-Health {
    $be = if (Test-Url 'http://127.0.0.1:8000/health') { 'ONLINE ' } else { 'OFFLINE' }
    $fe = if (Test-Url 'http://127.0.0.1:5173/')       { 'ONLINE ' } else { 'OFFLINE' }
    $time = Get-Date -Format 'HH:mm:ss'
    $color = if ($be -eq 'ONLINE ' -and $fe -eq 'ONLINE ') { 'Green' } else { 'Yellow' }
    Write-Host "[$time] [HEALTH ] Backend :8000 = $be | Frontend :5173 = $fe" -ForegroundColor $color
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
