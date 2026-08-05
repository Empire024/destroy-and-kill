@echo off
title DESTROY AND KILL
cd /d "%~dp0"
echo Starting DESTROY AND KILL...
echo.
where node >nul 2>nul
if %errorlevel%==0 (
  node serve_game.js
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  py serve_game.py
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python serve_game.py
  goto :eof
)
echo.
echo  Node.js or Python is required to run the game.
echo  Install Node.js from https://nodejs.org/ - it takes about a minute.
echo.
pause
