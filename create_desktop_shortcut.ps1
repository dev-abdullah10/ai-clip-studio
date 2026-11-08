# Creates (or refreshes) the AI Clip Studio desktop shortcut.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root "launch_app.ps1"
$icon = Join-Path $root "branding\ai-clip-studio.ico"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Clipping AI.lnk"

if (-not (Test-Path $launcher)) {
  throw "launch_app.ps1 was not found."
}
if (-not (Test-Path $icon)) {
  throw "branding\ai-clip-studio.ico was not found. Run branding\make_icon.ps1 first."
}

$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = "Open AI Clip Studio"
$shortcut.Save()

Write-Host "Created $shortcutPath"
