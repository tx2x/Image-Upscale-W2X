@echo off
rem Image Upscale W2X launcher (Windows)
rem   start.bat              local only (default)
rem   start.bat --network    share on your local network
cd /d "%~dp0"
title Image Upscale W2X

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Get it from https://nodejs.org/
  pause
  exit /b 1
)

rem First run only (needs internet): install dependencies and the engine.
rem Models are downloaded later, from the web interface.
if not exist node_modules (
  echo First run: installing dependencies...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 ( pause & exit /b 1 )
)
if not exist bin\realesrgan-ncnn-vulkan.exe (
  node scripts\setup.js
  if errorlevel 1 ( pause & exit /b 1 )
)

rem The server runs in its own window through "cmd /c" (not a batch file), so Ctrl+C
rem stops it at once, without the "Terminate batch job (Y/N)?" question.
rem If the server crashes, the window stays open so that the error can be read.
start "Image Upscale W2X" cmd /c "node server.js %* || pause"
exit /b 0
