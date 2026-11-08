# Starts AI Clip Studio hidden, opens it as a standalone app window, and stops
# the local backend when that window is closed.

$ErrorActionPreference = "Stop"
$port = 8765
$url = "http://127.0.0.1:$port"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root ".venv\Scripts\python.exe"
$dist = Join-Path $root "frontend\dist\index.html"
$logDir = Join-Path $env:LOCALAPPDATA "AIClipStudio\logs"
$launcherLog = Join-Path $logDir "launcher.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-LauncherLog([string]$message) {
  try {
    Add-Content -Path $launcherLog -Value "$(Get-Date -Format o)  $message" -Encoding UTF8
  } catch {
  }
}

function Show-LauncherMessage([string]$message, [string]$kind = "Error") {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $icon = if ($kind -eq "Information") {
      [System.Windows.Forms.MessageBoxIcon]::Information
    } else {
      [System.Windows.Forms.MessageBoxIcon]::Error
    }
    [System.Windows.Forms.MessageBox]::Show(
      $message,
      "AI Clip Studio",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      $icon
    ) | Out-Null
  } catch {
  }
}

function Test-StudioHealth {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/health" -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

$mutex = New-Object System.Threading.Mutex($false, "Local\AIClipStudioLauncher")
$hasMutex = $false
$backendPid = 0
$profile = Join-Path $env:LOCALAPPDATA "AIClipStudio\BrowserProfile"

try {
  $hasMutex = $mutex.WaitOne(0)
  if (-not $hasMutex) {
    Show-LauncherMessage "AI Clip Studio is already open. Check your taskbar." "Information"
    exit 0
  }

  Write-LauncherLog "Launcher started. Root=$root"

  if (-not (Test-Path $python)) {
    throw "The Python environment is missing. Run setup.bat once, then try again."
  }
  if (-not (Test-Path $dist)) {
    throw "The frontend build is missing. Run start.bat once so it can build the app."
  }

  # Clean profile folders left by older launcher versions.
  Get-ChildItem $env:TEMP -Directory -Filter "AIClipStudioBrowser-*" -ErrorAction SilentlyContinue |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }

  $existingApp = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$profile*") } |
    Select-Object -First 1
  if ($existingApp) {
    Write-LauncherLog "An AI Clip Studio app window is already open (PID $($existingApp.ProcessId))."
    Show-LauncherMessage "AI Clip Studio is already open. Check your taskbar." "Information"
    return
  }

  if (Test-StudioHealth) {
    Write-LauncherLog "Using the already-running local backend."
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($listener) {
      $backendPid = [int]$listener.OwningProcess
    }
  } else {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $stdoutLog = Join-Path $logDir "backend-$stamp.out.log"
    $stderrLog = Join-Path $logDir "backend-$stamp.err.log"
    $env:PYTHONIOENCODING = "utf-8"

    Write-LauncherLog "Starting backend: $python run.py"
    $backend = Start-Process `
      -FilePath $python `
      -ArgumentList @("run.py") `
      -WorkingDirectory $root `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog `
      -PassThru
    $backendPid = $backend.Id

    $deadline = (Get-Date).AddSeconds(60)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
      if ($backend.HasExited) { break }
      if (Test-StudioHealth) {
        $healthy = $true
        break
      }
      Start-Sleep -Milliseconds 500
    }

    if (-not $healthy) {
      throw "The local server did not start. See the log at $stderrLog"
    }
    Write-LauncherLog "Backend ready (PID $backendPid)."
  }

  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $browserCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    $(if ($programFilesX86) { Join-Path $programFilesX86 "Google\Chrome\Application\chrome.exe" }),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
    $(if ($programFilesX86) { Join-Path $programFilesX86 "Microsoft\Edge\Application\msedge.exe" }),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe")
  )
  $browserPath = $browserCandidates |
    Where-Object { $_ -and (Test-Path $_) } |
    Select-Object -First 1
  if (-not $browserPath) {
    throw "Google Chrome or Microsoft Edge was not found."
  }

  New-Item -ItemType Directory -Force -Path $profile | Out-Null
  $browserArgs = @(
    "--app=$url",
    "--user-data-dir=$profile",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    "--disable-session-crashed-bubble",
    "--disable-features=Translate",
    "--start-maximized"
  )

  Write-LauncherLog "Opening $url with $browserPath"
  $browser = Start-Process -FilePath $browserPath -ArgumentList $browserArgs -PassThru
  $browser.WaitForExit()
  Write-LauncherLog "App window closed."
} catch {
  Write-LauncherLog "ERROR: $($_.Exception.Message)"
  Show-LauncherMessage "AI Clip Studio could not start.`n`n$($_.Exception.Message)`n`nLogs: $logDir"
} finally {
  if ($backendPid -gt 0) {
    try {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$backendPid" -ErrorAction SilentlyContinue
      if ($process -and ($process.CommandLine -match "run\.py" -or $process.Name -match "^python")) {
        Write-LauncherLog "Stopping backend PID $backendPid."
        & taskkill.exe /PID $backendPid /T /F 2>$null | Out-Null
      } else {
        Write-LauncherLog "Backend PID $backendPid is already gone or was not the studio backend."
      }
    } catch {
      Write-LauncherLog "Could not stop backend: $($_.Exception.Message)"
    }
  }

  if ($hasMutex) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
  Write-LauncherLog "Launcher finished."
}
