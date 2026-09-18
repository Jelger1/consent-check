@echo off
setlocal
title Consent-check
cd /d "%~dp0"

rem ============================================================================
rem  Dubbelklik dit bestand om de tool te starten.
rem  Het installeert de eerste keer zelf wat nodig is en opent daarna je browser.
rem ============================================================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is nog niet geinstalleerd. Dat heeft de tool nodig.
  echo.
  echo   1. Download de LTS-versie op https://nodejs.org
  echo   2. Installeer die, alles standaard laten staan
  echo   3. Dubbelklik dit bestand opnieuw
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

node "%~dp0scripts\start.js"

rem Bij een fout blijft het venster open, zodat de melding leesbaar blijft.
if errorlevel 1 pause
