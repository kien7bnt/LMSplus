@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"
if not exist "logs" mkdir "logs"

set "LOG_FILE=logs\db-migration.log"
set "MODE=%~1"
if "%MODE%"=="" set "MODE=UP"

if "%PGHOST%"=="" set "PGHOST=127.0.0.1"
if "%PGPORT%"=="" set "PGPORT=5432"
if "%PGDATABASE%"=="" set "PGDATABASE=lmsplus"
if "%PGUSER%"=="" set "PGUSER=lmsplus"
if "%PGPASSWORD%"=="" set "PGPASSWORD=lmsplus_dev_password"

echo ============================================================================ > "%LOG_FILE%"
echo [%DATE% %TIME%] LMSPLUS E-LEARNING POSTGRESQL 18 MIGRATION RUNNER (MODE: %MODE%) >> "%LOG_FILE%"
echo Target DB: %PGUSER%@%PGHOST%:%PGPORT%/%PGDATABASE% >> "%LOG_FILE%"
echo ============================================================================ >> "%LOG_FILE%"

if /I "%MODE%"=="UP" (
    echo [APPLYING UP] Schema 010 + Incremental Migrations 011+ >> "%LOG_FILE%"
    node "scripts\migrate-sqlite-to-pg.mjs" >> "%LOG_FILE%" 2>&1
    if not "!ERRORLEVEL!"=="0" (
        echo [ERROR] Migration UP failed. Check Docker PostgreSQL 18 or DATABASE_URL. >> "%LOG_FILE%"
        type "%LOG_FILE%"
        exit /b 1
    )
    echo [PASS] PostgreSQL 18 schema & SQLite data migration executed successfully. >> "%LOG_FILE%"
) else if /I "%MODE%"=="SCHEMA" (
    echo [APPLYING SCHEMA-ONLY] 010 + 011+ >> "%LOG_FILE%"
    node "scripts\migrate-sqlite-to-pg.mjs" --schema-only >> "%LOG_FILE%" 2>&1
    if not "!ERRORLEVEL!"=="0" (
        echo [ERROR] Schema-only migration failed. >> "%LOG_FILE%"
        type "%LOG_FILE%"
        exit /b 1
    )
    echo [PASS] PostgreSQL 18 schema-only executed cleanly. >> "%LOG_FILE%"
) else if /I "%MODE%"=="BACKUP" (
    node "scripts\backup-restore-pg.mjs" backup >> "%LOG_FILE%" 2>&1
    type "%LOG_FILE%"
    exit /b !ERRORLEVEL!
) else if /I "%MODE%"=="DOWN" (
    set "DOWN_FILE=%~2"
    if "%DOWN_FILE%"=="" set "DOWN_FILE=database\migrations\013_performance_indexes_down.sql"
    echo [BACKUP BEFORE DOWN] Creating automatic JSON snapshot before rolling back !DOWN_FILE!... >> "%LOG_FILE%"
    node "scripts\backup-restore-pg.mjs" backup >> "%LOG_FILE%" 2>&1
    echo [ROLLING BACK DOWN] !DOWN_FILE! >> "%LOG_FILE%"
    docker exec lmsplus-postgres pg_isready -U "%PGUSER%" -d "%PGDATABASE%" >nul 2>&1
    if "!ERRORLEVEL!"=="0" (
        docker exec -i lmsplus-postgres psql -U "%PGUSER%" -d "%PGDATABASE%" -v ON_ERROR_STOP=1 < "!DOWN_FILE!" >> "%LOG_FILE%" 2>&1
    ) else (
        psql -h "%PGHOST%" -p "%PGPORT%" -U "%PGUSER%" -d "%PGDATABASE%" -v ON_ERROR_STOP=1 -f "!DOWN_FILE!" >> "%LOG_FILE%" 2>&1
    )
    if not "!ERRORLEVEL!"=="0" (
        echo [ERROR] Rollback failed at !DOWN_FILE! >> "%LOG_FILE%"
        type "%LOG_FILE%"
        exit /b 1
    )
    echo [PASS] Safe incremental rollback !DOWN_FILE! completed cleanly. >> "%LOG_FILE%"
)

type "%LOG_FILE%"
exit /b 0
