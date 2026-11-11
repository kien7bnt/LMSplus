@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"
if not exist "logs" mkdir "logs"

echo ============================================================================
echo LMSPLUS E-LEARNING - LOG HEALTH ^& DIAGNOSTICS CHECKER
echo Directory: %~dp0logs
echo Time:      %DATE% %TIME%
echo ============================================================================

set "FOUND_LOGS=0"
set "TOTAL_ERRORS=0"

for %%L in ("logs\*.log") do (
    set /a FOUND_LOGS+=1
    echo.
    echo ----------------------------------------------------------------------------
    echo [LOG FILE] %%~nxL ^(Size: %%~zL bytes ^| Modified: %%~tL^)
    echo ----------------------------------------------------------------------------

    findstr /I /C:"[ERROR]" /C:"PermissionError" /C:"STATUS: ACTION REQUIRED" /C:"VERIFICATION FAILED" "%%~L" >nul 2>&1
    if "!ERRORLEVEL!"=="0" (
        set /a TOTAL_ERRORS+=1
        echo [STATUS] WARNING/ERROR DETECTED IN %%~nxL:
        findstr /I /N /C:"[ERROR]" /C:"PermissionError" /C:"STATUS: ACTION REQUIRED" /C:"VERIFICATION FAILED" "%%~L"
    ) else (
        echo [STATUS] HEALTHY ^(0 Critical Errors Detected^)
    )

    echo --- Key Summary Lines ---
    findstr /I /C:"STATUS:" /C:"[PASS]" /C:"Scanned" /C:"Total SQL Tables" "%%~L"
)

if "%FOUND_LOGS%"=="0" (
    echo [WARN] No log files found in logs\ directory yet. Running 1-audit-and-verify.bat first...
    call "%~dp01-audit-and-verify.bat"
)

echo.
echo ============================================================================
echo SUMMARY: Scanned %FOUND_LOGS% log file^(s^) ^| Files with Errors: %TOTAL_ERRORS%
echo ============================================================================
exit /b %TOTAL_ERRORS%
