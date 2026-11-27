@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo [xueCraft] 未找到 Electron 运行时。
  echo 请先在当前目录执行: npm install
  pause
  exit /b 1
)
start "xueCraft Launcher" "node_modules\electron\dist\electron.exe" .
