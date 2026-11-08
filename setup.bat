@echo off
setlocal
cd /d "%~dp0"

echo === AI Clip Studio setup ===

where python >nul 2>&1
if errorlevel 1 (
  echo Python was not found. Install Python 3.11+ from https://www.python.org/ and re-run this script.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20.19+ or 22.12+ from https://nodejs.org/ and re-run this script.
  pause
  exit /b 1
)

node -e "const p=process.versions.node.split('.').map(Number),a=p[0],b=p[1];if(!((a===20&&b>=19)||(a===22&&b>=12)||a>22)){process.exit(1)}"
if errorlevel 1 (
  echo Node.js 20.19+ or 22.12+ is required. Install a newer version from https://nodejs.org/ and re-run this script.
  pause
  exit /b 1
)

where ffmpeg >nul 2>&1
if errorlevel 1 if not exist "tools\ffmpeg\bin\ffmpeg.exe" (
  echo.
  echo WARNING: FFmpeg was not found on PATH or in tools\ffmpeg\bin.
  echo Media import, thumbnails, captions and rendering need FFmpeg and FFprobe.
  echo See tools\README.md for the download and folder layout.
  echo.
)

if not exist ".venv" (
  echo Creating Python virtual environment...
  python -m venv .venv
  if errorlevel 1 (
    echo Failed to create virtual environment.
    pause
    exit /b 1
  )
)

echo Installing Python dependencies...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo Python dependency installation failed.
  pause
  exit /b 1
)

echo Installing frontend dependencies...
pushd frontend
call npm install
if errorlevel 1 (
  popd
  echo Frontend dependency installation failed.
  pause
  exit /b 1
)
popd

echo Building frontend...
pushd frontend
call npm run build
popd
if errorlevel 1 (
  echo Frontend build failed.
  pause
  exit /b 1
)

echo.
echo Setup complete. Run start.bat to launch AI Clip Studio.
echo Then add API keys in Settings -^> AI Providers.
echo Media and the database default to the storage folder in this repo.
pause
