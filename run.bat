@echo off
setlocal

:: ============================================
:: Clean up any previously running instances
:: ============================================
echo Cleaning up old processes...

:: Close old backend/frontend windows by title
taskkill /F /FI "WINDOWTITLE eq Buckle Backend*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Buckle Frontend*" >nul 2>&1

:: Give Windows a moment to release file handles
timeout /t 1 >nul

:: ============================================
:: Start Backend in a new window
:: ============================================
echo Starting Backend...
cd backend
start "Buckle Backend" cmd /k ".\venv\Scripts\activate && python main.py"
if %errorlevel% neq 0 (
    echo Error starting backend.
    pause
    exit /b %errorlevel%
)

:: Wait a moment for backend to initialize
timeout /t 2 >nul

:: ============================================
:: Start Frontend in a new window
:: ============================================
echo Starting Frontend...
cd ..\frontend
start "Buckle Frontend" cmd /k "npm run dev"
if %errorlevel% neq 0 (
    echo Error starting frontend.
    pause
    exit /b %errorlevel%
)

echo.
echo Both services are starting in separate windows.
echo Frontend should be available at: http://localhost:5173/
echo Backend is running at: http://localhost:8000/
echo.
pause