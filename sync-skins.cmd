@echo off
rem Rescan the skins directory and rebuild manifest.js.
rem Double-click after dropping in a new skin folder, then press F5 in Mirasim.
cd /d "%~dp0"
node sync.mjs
echo.
pause
