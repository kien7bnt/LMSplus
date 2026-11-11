@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

cd /d "%~dp0"
if not exist "logs" mkdir "logs"

set "LOG_FILE=logs\audit-verify.log"
echo ============================================================================ > "%LOG_FILE%"
echo [%DATE% %TIME%] STARTING LMSPLUS E-LEARNING UI/UX ^& SYSTEM AUDIT >> "%LOG_FILE%"
echo ============================================================================ >> "%LOG_FILE%"

echo [1/2] Running Impeccable x UI/UX Pro Max x Airbnb DLS Audit...
node ".agents\skills\ui-ux-standard\scripts\impeccable_audit.mjs" . >> "%LOG_FILE%" 2>&1
set "UI_EXIT=%ERRORLEVEL%"

echo [2/2] Running System Architecture, SQL Migration ^& Source Code Verification...
node ".agents\skills\ui-ux-standard\scripts\verify_system_and_sql.mjs" >> "%LOG_FILE%" 2>&1
set "SYS_EXIT=%ERRORLEVEL%"

type "%LOG_FILE%"

if not "%UI_EXIT%"=="0" (
    echo [ERROR] UI/UX Impeccable Audit reported issues. See %LOG_FILE%
    exit /b %UI_EXIT%
)
if not "%SYS_EXIT%"=="0" (
    echo [ERROR] System Verification reported issues. See %LOG_FILE%
    exit /b %SYS_EXIT%
)

echo.
echo [SUCCESS] All Audits Passed! Log saved to: %LOG_FILE%
exit /b 0
