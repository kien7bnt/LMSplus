<#
.SYNOPSIS
  Dam bao PostgreSQL 18 cuc bo (Docker Desktop + container lmsplus-postgres) san sang
  truoc khi chay migration va khoi dong Backend LMSPLUS.
#>
param(
    [switch]$AutoMigrate
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvFile = Join-Path $RootDir '.env'

# 1. Nap cau hinh .env (uu tien bien moi truong da dat truoc, giong backend/db/client.mjs)
$envMap = @{}
if (Test-Path $EnvFile) {
    foreach ($rawLine in (Get-Content -Path $EnvFile -Encoding UTF8)) {
        $trimmed = $rawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) { continue }
        $eq = $trimmed.IndexOf('=')
        if ($eq -le 0) { continue }
        $k = $trimmed.Substring(0, $eq).Trim()
        $v = $trimmed.Substring($eq + 1).Trim()
        if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        $envMap[$k] = $v
    }
}

function Get-ConfigValue([string]$Key, [string]$Default = '') {
    $procVal = [Environment]::GetEnvironmentVariable($Key)
    if (-not [string]::IsNullOrWhiteSpace($procVal)) { return $procVal }
    if ($envMap.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace($envMap[$Key])) {
        return $envMap[$Key]
    }
    return $Default
}

$dbClient = (Get-ConfigValue 'LMSPLUS_DB_CLIENT' 'auto').Trim().ToLowerInvariant()
$dbPath = Get-ConfigValue 'LMSPLUS_DB_PATH' ''
$usePgForTests = Get-ConfigValue 'LMSPLUS_USE_PG_FOR_TESTS' ''
$connStr = Get-ConfigValue 'DATABASE_URL' ''
if ([string]::IsNullOrWhiteSpace($connStr)) { $connStr = Get-ConfigValue 'POSTGRES_URL' '' }
$pgHostEnv = Get-ConfigValue 'PGHOST' ''

if ($dbClient -eq 'sqlite' -or ($dbClient -eq 'auto' -and -not [string]::IsNullOrWhiteSpace($dbPath) -and [string]::IsNullOrWhiteSpace($usePgForTests))) {
    Write-Host '[DB] Che do SQLite cuc bo - bo qua khoi dong PostgreSQL Docker.'
    exit 0
}

if ($dbClient -eq 'auto' -and [string]::IsNullOrWhiteSpace($connStr) -and [string]::IsNullOrWhiteSpace($pgHostEnv)) {
    Write-Host '[DB] Chua cau hinh DATABASE_URL/PGHOST - Backend se dung SQLite fallback.'
    exit 0
}

$pgHost = if (-not [string]::IsNullOrWhiteSpace($pgHostEnv)) { $pgHostEnv } else { '127.0.0.1' }
$pgPort = 5432
$portStr = Get-ConfigValue 'PGPORT' '5432'
[void][int]::TryParse($portStr, [ref]$pgPort)
$pgUser = Get-ConfigValue 'PGUSER' 'lmsplus'
$pgDb = Get-ConfigValue 'PGDATABASE' 'lmsplus'

if (-not [string]::IsNullOrWhiteSpace($connStr)) {
    try {
        $uri = [Uri]$connStr
        if (-not [string]::IsNullOrWhiteSpace($uri.Host)) { $pgHost = $uri.Host }
        if ($uri.Port -gt 0) { $pgPort = $uri.Port }
        if (-not [string]::IsNullOrWhiteSpace($uri.AbsolutePath) -and $uri.AbsolutePath -ne '/') {
            $pgDb = $uri.AbsolutePath.TrimStart('/')
        }
        if (-not [string]::IsNullOrWhiteSpace($uri.UserInfo) -and $uri.UserInfo.Contains(':')) {
            $pgUser = $uri.UserInfo.Split(':')[0]
        }
    } catch {
        # Giu gia tri PGHOST/PGPORT mac dinh neu URI dac biet
    }
}

$isLocalHost = @('127.0.0.1', 'localhost', '::1') -contains $pgHost.ToLowerInvariant()

function Test-TcpPort([string]$HostName, [int]$Port, [int]$TimeoutMs = 500) {
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $ar = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            return $false
        }
        $client.EndConnect($ar) | Out-Null
        return $true
    } catch {
        return $false
    } finally {
        if ($client) { try { $client.Dispose() } catch {} }
    }
}

$jsCheckReady = @'
import { createDbClient } from './backend/db/client.mjs';
const db = createDbClient();
try {
  await db.prepare('SELECT 1 AS ok').get();
  process.exit(0);
} catch {
  process.exit(1);
} finally {
  try { await db.close(); } catch {}
}
'@

$jsCheckUsers = @'
import { createDbClient } from './backend/db/client.mjs';
const db = createDbClient();
try {
  const t = await db.prepare("SELECT to_regclass('public.users') AS tbl").get();
  if (!t || !t.tbl) {
    console.log('EMPTY');
  } else {
    const c = await db.prepare('SELECT COUNT(*) AS cnt FROM users').get();
    console.log(Number((c && c.cnt) || 0) > 0 ? 'HAS_DATA' : 'EMPTY');
  }
} catch {
  console.log('EMPTY');
} finally {
  try { await db.close(); } catch {}
}
'@

function Test-PgQueryReady {
    Push-Location $RootDir
    try {
        $jsCheckReady | & node --input-type=module - *> $null
        return ($LASTEXITCODE -eq 0)
    } finally {
        Pop-Location
    }
}

if (-not $isLocalHost) {
    Write-Host "[DB] Dang dung PostgreSQL tu xa ($pgHost`:$pgPort). Bo qua Docker local."
    if ($AutoMigrate -and (Test-Path (Join-Path $RootDir '2-migrate-db.bat'))) {
        & (Join-Path $RootDir '2-migrate-db.bat') SCHEMA
        exit $LASTEXITCODE
    }
    exit 0
}

# 2. Kiem tra nhanh xem PostgreSQL cuc bo da san sang chua
if ((Test-TcpPort $pgHost $pgPort 600) -and (Test-PgQueryReady)) {
    Write-Host "[DB] PostgreSQL 18 da san sang tai $pgHost`:$pgPort." -ForegroundColor Green
} else {
    Write-Host "[DB] PostgreSQL tai $pgHost`:$pgPort chua phan hoi. Dang kiem tra Docker..." -ForegroundColor Yellow

    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        Write-Host "[LOI] Khong tim thay lenh 'docker' trong PATH va PostgreSQL $pgHost`:$pgPort khong hoat dong." -ForegroundColor Red
        exit 1
    }

    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[DB] Docker Engine chua chay. Dang tu dong khoi dong Docker Desktop...' -ForegroundColor Yellow
        $started = $false
        & docker desktop start *> $null
        if ($LASTEXITCODE -eq 0) {
            $started = $true
        } else {
            $desktopExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
            if (Test-Path $desktopExe) {
                Start-Process -FilePath $desktopExe
                $started = $true
            }
        }

        if (-not $started) {
            Write-Host '[LOI] Khong the khoi dong Docker Desktop tu dong. Hay mo Docker Desktop thu cong roi thu lai.' -ForegroundColor Red
            exit 1
        }

        $engineReady = $false
        for ($i = 1; $i -le 35; $i++) {
            Start-Sleep -Seconds 2
            & docker info *> $null
            if ($LASTEXITCODE -eq 0) {
                $engineReady = $true
                Write-Host "[DB] Docker Engine da san sang sau $($i * 2) giay." -ForegroundColor Green
                break
            }
            if ($i % 5 -eq 0) {
                Write-Host "[DB] Van dang cho Docker Engine khoi dong ($($i * 2)s/70s)..." -ForegroundColor Gray
            }
        }

        if (-not $engineReady) {
            Write-Host '[LOI] Het thoi gian cho Docker Engine (70s). Hay kiem tra Docker Desktop roi chay lai.' -ForegroundColor Red
            exit 1
        }
    }

    $composeFile = Join-Path $RootDir 'docker-compose.yml'
    if (Test-Path $composeFile) {
        Write-Host '[DB] Dang bat container PostgreSQL 18 & Redis (docker compose up -d)...'
        Push-Location $RootDir
        try {
            & docker compose up -d
            if ($LASTEXITCODE -ne 0) {
                Write-Host '[LOI] docker compose up -d that bai. Kiem tra xem cong 5432 co dang bi ung dung khac chiem khong.' -ForegroundColor Red
                exit 1
            }
        } finally {
            Pop-Location
        }
    }

    $pgReady = $false
    for ($i = 1; $i -le 20; $i++) {
        & docker exec lmsplus-postgres pg_isready -U $pgUser -d $pgDb *> $null
        if ($LASTEXITCODE -eq 0 -and (Test-TcpPort $pgHost $pgPort 500) -and (Test-PgQueryReady)) {
            $pgReady = $true
            Write-Host "[DB] PostgreSQL 18 (lmsplus-postgres) da san sang tai $pgHost`:$pgPort." -ForegroundColor Green
            break
        }
        Start-Sleep -Seconds 2
    }

    if (-not $pgReady) {
        Write-Host "[LOI] PostgreSQL 18 chua san sang sau 40 giay tai $pgHost`:$pgPort." -ForegroundColor Red
        exit 1
    }
}

# 3. Ap dung schema 010 + migrations 011+ an toan (chi copy du lieu SQLite neu bang users con trong)
if ($AutoMigrate -and (Test-Path (Join-Path $RootDir '2-migrate-db.bat'))) {
    Push-Location $RootDir
    try {
        $hasDataOut = ($jsCheckUsers | & node --input-type=module - 2>$null | Out-String).Trim()
    } finally {
        Pop-Location
    }

    $mode = if ($hasDataOut -eq 'HAS_DATA') { 'SCHEMA' } else { 'UP' }
    Write-Host "[DB] Dang dong bo schema PostgreSQL 18 (che do: $mode)..."
    Push-Location $RootDir
    try {
        & (Join-Path $RootDir '2-migrate-db.bat') $mode *> $null
        if ($LASTEXITCODE -ne 0) {
            Write-Host '[CANH BAO] Dong bo migration that bai. Xem chi tiet tai logs\db-migration.log' -ForegroundColor Yellow
            exit 1
        }
        Write-Host '[DB] Schema PostgreSQL 18 va migrations da cap nhat (xem logs\db-migration.log).' -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

exit 0
