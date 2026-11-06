@echo off
rem Double-click or run from cmd/PowerShell. Bypasses the script execution policy for this one run.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
