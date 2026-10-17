@echo off
setlocal
cd /d "%~dp0"
node "src\native\launch.mjs"
if errorlevel 1 pause
