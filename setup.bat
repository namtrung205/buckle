@echo off
setlocal enabledelayedexpansion

REM Ensure we always run from the directory containing this script,
REM regardless of how/where it was launched (e.g. "Run as administrator"
REM defaults the working directory to C:\WINDOWS\system32).
cd /d "%~dp0"

echo ============================================================
echo   Buckle Project - Setup Script (Windows)
echo   Auto-install tools and dependencies for new machine
echo ============================================================
echo.

REM ============================================================
REM  CONFIGURATION
REM ============================================================
set "REPO_URL=https://github.com/namtrung205/buckle.git"
set "PROJECT_DIR=buckle"

REM ============================================================
REM  CHECK ADMIN RIGHTS (for installing tools)
REM ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] Not running as Administrator.
    echo Some tool installations may require admin rights.
    echo If installation fails, re-run this script as Administrator.
    echo.
    pause
)

REM ============================================================
REM  STEP 1: CHECK / INSTALL GIT
REM ============================================================
echo [1/6] Checking Git...
where git >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('git --version') do echo   [OK] %%i
) else (
    echo   [MISSING] Git not found. Installing via winget...
    winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo   [ERROR] Failed to install Git. Please install manually from https://git-scm.com/
        pause
        exit /b 1
    )
    echo   [OK] Git installed.
)
echo.

REM ============================================================
REM  STEP 2: CHECK / INSTALL NODE.JS + NPM
REM ============================================================
echo [2/6] Checking Node.js...
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do echo   [OK] Node %%i
    for /f "tokens=*" %%i in ('npm --version') do echo   [OK] npm %%i
) else (
    echo   [MISSING] Node.js not found. Installing via winget...
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo   [ERROR] Failed to install Node.js. Please install manually from https://nodejs.org/
        pause
        exit /b 1
    )
    echo   [OK] Node.js installed.
    echo   [INFO] Please close and reopen this terminal, then re-run setup.bat
    pause
    exit /b 0
)
echo.

REM ============================================================
REM  STEP 3: CHECK / INSTALL PYTHON
REM ============================================================
echo [3/6] Checking Python...
where python >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo   [OK] %%i
) else (
    echo   [MISSING] Python not found. Installing via winget...
    winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo   [ERROR] Failed to install Python. Please install manually from https://www.python.org/downloads/
        pause
        exit /b 1
    )
    echo   [OK] Python installed.
    echo   [INFO] Please close and reopen this terminal, then re-run setup.bat
    pause
    exit /b 0
)
echo.

REM ============================================================
REM  STEP 4: CHECK / INSTALL MONGODB (OPTIONAL)
REM ============================================================
echo [4/6] Checking MongoDB (optional)...
where mongod >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] MongoDB found.
) else (
    echo   [SKIP] MongoDB not found. This is optional for user authentication.
    echo   [INFO] To install MongoDB Community Server:
    echo         winget install --id MongoDB.Server -e
    echo         Or use Docker: docker run -d -p 27017:27017 --name buckle-mongo mongo:latest
)
echo.

REM ============================================================
REM  STEP 5: CHECK / INSTALL DOCKER (OPTIONAL)
REM ============================================================
echo [5/6] Checking Docker (optional)...
where docker >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('docker --version') do echo   [OK] %%i
) else (
    echo   [SKIP] Docker not found. This is optional for containerized deployment.
    echo   [INFO] To install Docker Desktop:
    echo         winget install --id Docker.DockerDesktop -e
)
echo.

REM ============================================================
REM  STEP 6: CLONE PROJECT + INSTALL DEPENDENCIES
REM ============================================================
echo [6/6] Setting up project...

REM Check if we are already inside the project (has frontend/ and backend/)
if exist "frontend\package.json" if exist "backend\requirements.txt" (
    echo   [OK] Already inside the project directory.
    set "PROJECT_DIR=."
) else (
    REM Clone project if not exists
    if not exist "%PROJECT_DIR%" (
        echo   Cloning repository...
        git clone %REPO_URL% %PROJECT_DIR%
        if %errorlevel% neq 0 (
            echo   [ERROR] Failed to clone repository.
            pause
            exit /b 1
        )
    ) else (
        echo   [OK] Project directory already exists. Pulling latest changes...
        cd "%PROJECT_DIR%"
        git pull
        cd ..
    )
    cd "%PROJECT_DIR%"
)

REM Create .env from example if not exists
if not exist ".env" (
    echo   Creating .env from .env.example...
    copy ".env.example" ".env" >nul
    echo   [OK] .env created. Please edit it with your configuration.
) else (
    echo   [OK] .env already exists.
)

REM --- Frontend ---
echo.
echo   Installing frontend dependencies (npm install)...
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo   [ERROR] Frontend dependencies installation failed.
    pause
    exit /b 1
)
echo   [OK] Frontend dependencies installed.
cd ..

REM --- Backend ---
echo.
echo   Setting up backend virtual environment...
cd backend
if not exist "env" (
    python -m venv env
    if %errorlevel% neq 0 (
        echo   [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)
call env\Scripts\activate.bat
echo   Installing backend dependencies (pip install)...
python -m pip install --upgrade pip
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo   [ERROR] Backend dependencies installation failed.
    pause
    exit /b 1
)
echo   [OK] Backend dependencies installed.
cd ..

echo.
echo ============================================================
echo   SETUP COMPLETE!
echo ============================================================
echo.
echo   Project: %PROJECT_DIR%
echo.
echo   To start the application:
echo.
echo   Frontend:
echo     cd %PROJECT_DIR%\frontend
echo     npm run dev
echo     Open http://localhost:5173
echo.
echo   Backend:
echo     cd %PROJECT_DIR%\backend
echo     env\Scripts\activate
echo     python main.py
echo     Open http://localhost:8000/docs
echo.
echo   Docker (optional, full stack):
echo     cd %PROJECT_DIR%
echo     docker-compose up --build
echo.
echo   Note: If MongoDB is not installed, user authentication features
echo   will not work. Install MongoDB or use Docker for full functionality.
echo.
pause