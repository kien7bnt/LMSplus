@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"
if not exist "logs" mkdir "logs"

set "LOG_FILE=logs\db-migration.log"
set "MODE=%~1"
if "%MODE%"=="" set "MODE=UP"

if "%PGHOST%"=="" set "PGHOST=localhost"
if "%PGPORT%"=="" set "PGPORT=5432"
if "%PGDATABASE%"=="" set "PGDATABASE=lmsplus"
if "%PGUSER%"=="" set "PGUSER=lmsplus"
if "%PGPASSWORD%"=="" set "PGPASSWORD=lmsplus_dev_password"

echo ============================================================================ > "%LOG_FILE%"
echo [%DATE% %TIME%] LMSPLUS E-LEARNING POSTGRESQL MIGRATION RUNNER (MODE: %MODE%) >> "%LOG_FILE%"
echo Target DB: %PGUSER%@%PGHOST%:%PGPORT%/%PGDATABASE% >> "%LOG_FILE%"
echo ============================================================================ >> "%LOG_FILE%"

set "USE_DOCKER_PSQL=0"
where psql >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
    docker exec lmsplus-postgres pg_isready -U "%PGUSER%" -d "%PGDATABASE%" >nul 2>&1
    if "!ERRORLEVEL!"=="0" (
        set "USE_DOCKER_PSQL=1"
        echo [INFO] Using PostgreSQL 16 inside Docker container 'lmsplus-postgres'. >> "%LOG_FILE%"
    ) else (
        echo [WARN] Neither local psql nor running 'lmsplus-postgres' Docker container found. >> "%LOG_FILE%"
        echo [INFO] Running static DDL verification only... >> "%LOG_FILE%"
        node ".agents\skills\ui-ux-standard\scripts\verify_system_and_sql.mjs" >> "%LOG_FILE%" 2>&1
        echo [INFO] STATIC CHECK ONLY - start Docker Desktop and run 'docker compose up -d' to execute against PostgreSQL. >> "%LOG_FILE%"
        type "%LOG_FILE%"
        exit /b 2
    )
)

if /I "%MODE%"=="UP" (
    for %%F in (
        "database\migrations\000_lmsplus_core_baseline_if_not_exists.sql"
        "database\migrations\001_curriculum_and_enrollment_policy_up.sql"
        "database\migrations\002_blocks_versioning_and_wiki_up.sql"
        "database\migrations\003_progress_unlock_and_assessments_up.sql"
        "database\migrations\004_forums_and_moderation_up.sql"
        "database\migrations\005_attendance_teaching_logs_and_integrations_up.sql"
        "database\migrations\006_teaching_workspace_extensions_up.sql"
        "database\migrations\007_lesson_studio_and_video_quiz_up.sql"
    ) do (
        echo [APPLYING UP] %%~nxF >> "%LOG_FILE%"
        if "!USE_DOCKER_PSQL!"=="1" (
            docker exec -i lmsplus-postgres psql -U "%PGUSER%" -d "%PGDATABASE%" -v ON_ERROR_STOP=1 < "%%~F" >> "%LOG_FILE%" 2>&1
        ) else (
            psql -h "%PGHOST%" -p "%PGPORT%" -U "%PGUSER%" -d "%PGDATABASE%" -v ON_ERROR_STOP=1 -f "%%~F" >> "%LOG_FILE%" 2>&1
        )
        if not "!ERRORLEVEL!"=="0" (
            echo [ERROR] Migration failed at %%~nxF >> "%LOG_FILE%"
            type "%LOG_FILE%"
            exit /b 1
        )
    )
    echo [PASS] All UP migrations (000..007) executed on PostgreSQL successfully. >> "%LOG_FILE%"
) else if /I "%MODE%"=="DOWN" (
    for %%F in (
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
    echo [PASS] All DOWN rollback migrations (007..001) executed on PostgreSQL safely. >> "%LOG_FILE%"
)

type "%LOG_FILE%"
exit /b 0
