@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

REM =====================================================
REM  LMSPLUS E-Learning - Quick Start Script for Windows
REM  Mo 3 cua so rieng (khong tu dong dong):
REM    - LMSPLUS Backend  (Port 8000)
REM    - LMSPLUS Frontend (Port 5173)
REM    - LMSPLUS Logs     (theo doi log thoi gian thuc)
REM  Cua so chinh nay cung duoc giu lai de dieu khien.
REM =====================================================

set "BASE_DIR=%~dp0"
set "LOG_DIR=%BASE_DIR%logs"
cd /d "%BASE_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:START
cls
title LMSPLUS Launcher
echo.
echo  =====================================================
echo   LMSPLUS E-Learning - He thong Hoc tap ^& Giang day
echo  =====================================================
echo.

REM -----------------------------------------------------
REM  KIEM TRA NODE.JS (Backend + Frontend deu chay bang Node)
REM -----------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo [LOI] Node.js chua duoc cai dat hoac chua duoc them vao PATH.
    echo Vui long cai dat Node.js 22+ tai https://nodejs.org/
    goto MENU
)
for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
echo       Node.js: !NODE_VER!

REM =====================================================
REM  1. DON DEP TIEN TRINH CU (GIAI PHONG PORT)
REM =====================================================
echo [1/5] Dong cua so cu va giai phong port 8000, 5173...
call :STOP_SERVICES >nul 2>&1

REM =====================================================
REM  2. KIEM TRA NHANH (UI/UX + MIGRATION) - KHONG CHAN KHOI DONG
REM =====================================================
echo [2/5] Kiem tra chuan giao dien va migration (ghi vao logs\)...
if exist "%BASE_DIR%1-audit-and-verify.bat" call "%BASE_DIR%1-audit-and-verify.bat" >nul 2>&1
if exist "%BASE_DIR%2-migrate-db.bat" call "%BASE_DIR%2-migrate-db.bat" >nul 2>&1

REM =====================================================
REM  3. KHOI DONG BACKEND
REM =====================================================
echo [3/5] Khoi dong Backend (SQLite + JWT API)...
echo ================= BACKEND START %DATE% %TIME% ================= >> "%LOG_DIR%\backend.log"
start "LMSPLUS Backend (Port 8000)" /D "%BASE_DIR%" cmd /k "chcp 65001 >nul && title LMSPLUS Backend (Port 8000) && node backend\server_fallback.mjs"

echo       Dang khoi dong Backend - doi 3 giay...
ping 127.0.0.1 -n 4 >nul

REM =====================================================
REM  4. KHOI DONG FRONTEND
REM =====================================================
echo [4/5] Chuan bi va khoi dong Frontend...
cd /d "%BASE_DIR%frontend"
if not exist "node_modules" (
    echo       Dang cai dat npm dependencies...
    call npm install
)
cd /d "%BASE_DIR%"

echo ================= FRONTEND START %DATE% %TIME% ================= >> "%LOG_DIR%\frontend.log"
REM Hien log tren cua so va dong thoi ghi UTF-8 khong BOM vao logs\frontend.log
start "LMSPLUS Frontend (Port 5173)" /D "%BASE_DIR%frontend" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "$Host.UI.RawUI.WindowTitle='LMSPLUS Frontend (Port 5173)'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; $utf8NoBom=[System.Text.UTF8Encoding]::new($false); npm run dev -- --host 127.0.0.1 --port 5173 --strictPort 2>&1 | ForEach-Object { $line=[string]$_; Write-Host $line; [System.IO.File]::AppendAllText('..\logs\frontend.log', $line + [Environment]::NewLine, $utf8NoBom) }"

echo       Dang khoi dong Frontend - doi 4 giay...
ping 127.0.0.1 -n 5 >nul

REM =====================================================
REM  5. MO CUA SO LOG + TRINH DUYET
REM =====================================================
echo [5/5] Mo cua so theo doi log va trinh duyet...
start "LMSPLUS Logs" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%BASE_DIR%scripts\watch-logs.ps1"
start "" http://localhost:5173

echo.
echo  =====================================================
echo   LMSPLUS da khoi dong!
echo  =====================================================
echo   Frontend    : http://localhost:5173
echo   Backend API : http://127.0.0.1:8000
echo   Health      : http://127.0.0.1:8000/health
echo   Log files   : %LOG_DIR%
echo.
echo   Tai khoan dung thu (mat khau: 123456):
echo     Quan tri vien : admin@lmsplus.edu.vn
echo     Giao vu       : giaovu@lmsplus.edu.vn
echo     Giang vien    : thuha.gv@lmsplus.edu.vn
echo     Hoc vien      : minhanh.hs@lmsplus.edu.vn
echo.
echo   Luu y:
echo     - Khong tat cac cua so 'LMSPLUS Backend', 'LMSPLUS Frontend', 'LMSPLUS Logs'.
echo     - Neu cua so Backend/Frontend bao loi, cua so van giu lai de ban doc loi.
echo  =====================================================

:MENU
echo.
echo   [R] Khoi dong lai toan bo     [L] Mo lai cua so Log
echo   [C] Kiem tra loi trong log    [S] Dung tat ca dich vu
echo   [Q] Thoat cua so nay (dich vu van chay)
choice /C RLCSQ /N /M "  Chon thao tac: "
if errorlevel 5 goto END
if errorlevel 4 goto STOP
if errorlevel 3 goto CHECK
if errorlevel 2 goto LOGS
if errorlevel 1 goto START
goto MENU

:LOGS
start "LMSPLUS Logs" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%BASE_DIR%scripts\watch-logs.ps1"
goto MENU

:CHECK
if exist "%BASE_DIR%4-check-logs.bat" (
    call "%BASE_DIR%4-check-logs.bat"
) else (
    echo [WARN] Khong tim thay 4-check-logs.bat
)
goto MENU

:STOP
echo   Dang dung Backend, Frontend va cua so Log...
call :STOP_SERVICES >nul 2>&1
echo   Da dung tat ca dich vu.
goto MENU

:END
endlocal
exit /b 0

REM =====================================================
REM  HAM: dong cua so cu + giai phong port
REM =====================================================
:STOP_SERVICES
taskkill /FI "WINDOWTITLE eq LMSPLUS Backend*" /T /F
taskkill /FI "WINDOWTITLE eq LMSPLUS Frontend*" /T /F
taskkill /FI "WINDOWTITLE eq LMSPLUS Logs*" /T /F
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction Stop | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } catch {}"
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction Stop | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } catch {}"
exit /b 0
