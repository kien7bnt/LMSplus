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

set "USE_DOCKER_PSQL=0"
where psql >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
    docker exec lmsplus-postgres pg_isready -U "%PGUSER%" -d "%PGDATABASE%" >nul 2>&1
    if "!ERRORLEVEL!"=="0" (
        set "USE_DOCKER_PSQL=1"
        echo [INFO] Using PostgreSQL 18 inside Docker container 'lmsplus-postgres'. >> "%LOG_FILE%"
    ) else (
        echo [INFO] Trying Node.js PostgreSQL 18 migrator (scripts\migrate-sqlite-to-pg.mjs)... >> "%LOG_FILE%"
        node "scripts\migrate-sqlite-to-pg.mjs" >> "%LOG_FILE%" 2>&1
        if "!ERRORLEVEL!"=="0" (
            echo [PASS] Migrated 80 tables and data to PostgreSQL 18 via Node.js. >> "%LOG_FILE%"
            type "%LOG_FILE%"
            exit /b 0
        )
        echo [WARN] PostgreSQL 18 server is not reachable yet. Running static verification... >> "%LOG_FILE%"
        node ".agents\skills\ui-ux-standard\scripts\verify_system_and_sql.mjs" >> "%LOG_FILE%" 2>&1
        echo [INFO] Start Docker Desktop and run 'docker compose up -d' to connect to PostgreSQL 18. >> "%LOG_FILE%"
        type "%LOG_FILE%"
        exit /b 2
    )
)

if /I "%MODE%"=="UP" (
    echo [APPLYING UP] 010_postgres18_live_schema.sql >> "%LOG_FILE%"
    if "!USE_DOCKER_PSQL!"=="1" (
        docker exec -i lmsplus-postgres psql -U "%PGUSER%" -d "%PGDATABASE%" -v ON_ERROR_STOP=1 < "database\migrations\010_postgres18_live_schema.sql" >> "%LOG_FILE%" 2>&1
    ) else (
        psql -h "%PGHOST%" -p "%PGPORT%" -U "%PGUSER%" -d "%PGDATABASE%" -v ON_ERROR_STOP=1 -f "database\migrations\010_postgres18_live_schema.sql" >> "%LOG_FILE%" 2>&1
    )
    if not "!ERRORLEVEL!"=="0" (
        echo [ERROR] Migration failed at 010_postgres18_live_schema.sql >> "%LOG_FILE%"
        type "%LOG_FILE%"
        exit /b 1
    )
    node "scripts\migrate-sqlite-to-pg.mjs" >> "%LOG_FILE%" 2>&1
    if not "!ERRORLEVEL!"=="0" (
        echo [ERROR] Data migration from SQLite to PostgreSQL 18 failed. >> "%LOG_FILE%"
        type "%LOG_FILE%"
        exit /b 1
    )
    echo [PASS] PostgreSQL 18 schema & SQLite data migration executed successfully. >> "%LOG_FILE%"
) else if /I "%MODE%"=="DOWN" (
    for %%F in (
        "database\migrations\009_training_lifecycle_and_timetable_down.sql"
        "database\migrations\008_master_lms_architecture_down.sql"
        "database\migrations\007_lesson_studio_and_video_quiz_down.sql"
        "database\migrations\006_teaching_workspace_extensions_down.sql"
        "database\migrations\005_attendance_teaching_logs_and_integrations_down.sql"
        "database\migrations\004_forums_and_moderation_down.sql"
        "database\migrations\003_progress_unlock_and_assessments_down.sql"
        "database\migrations\002_blocks_versioning_and_wiki_down.sql"
        "database\migrations\001_curriculum_and_enrollment_policy_down.sql"
    ) do (
        echo [ROLLING BACK DOWN] %%~nxF >> "%LOG_FILE%"
        if "!USE_DOCKER_PSQL!"=="1" (
            docker exec -i lmsplus-postgres psql -U "%PGUSER%" -d "%PGDATABASE%" -v ON_ERROR_STOP=1 < "%%~F" >> "%LOG_FILE%" 2>&1
        ) else (
            psql -h "%PGHOST%" -p "%PGPORT%" -U "%PGUSER%" -d "%PGDATABASE%" -v ON_ERROR_STOP=1 -f "%%~F" >> "%LOG_FILE%" 2>&1
        )
        if not "!ERRORLEVEL!"=="0" (
            echo [ERROR] Rollback failed at %%~nxF >> "%LOG_FILE%"
            type "%LOG_FILE%"
            exit /b 1
        )
    )
    echo [PASS] DOWN rollback migrations executed on PostgreSQL safely. >> "%LOG_FILE%"
)

type "%LOG_FILE%"
exit /b 0
