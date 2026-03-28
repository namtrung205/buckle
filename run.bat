@echo off
setlocal

:: Start Backend in a new window
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

:: Start Frontend in a new window
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
