@echo off
setlocal
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8

if not exist ".venv\Scripts\python.exe" (
  echo Virtual environment not found. Run setup.bat first.
  pause
  exit /b 1
)

if not exist "frontend\dist\index.html" (
  echo Frontend build not found. Building now...
  pushd frontend
  call npm run build
  popd
  if errorlevel 1 (
    echo Frontend build failed.
    pause
    exit /b 1
  )
)

echo Starting AI Clip Studio on http://127.0.0.1:8765 ...
start /b cmd /c "timeout /t 3 >nul && start http://127.0.0.1:8765"
".venv\Scripts\python.exe" run.py

echo.
echo AI Clip Studio has stopped.
pause
