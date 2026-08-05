@echo off
title DESTROY AND KILL
cd /d "%~dp0"

echo Starting DESTROY AND KILL...
echo.

REM A previous run - or one that crashed, or a dev server left behind - keeps
REM port 8765 held, and the launcher used to just flash up and vanish. Free it.
set GAMEPORT=8765
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":%GAMEPORT% "') do (
  echo   Port %GAMEPORT% was still held by process %%P - closing it.
  taskkill /F /PID %%P >nul 2>nul
)

where node >nul 2>nul
if %errorlevel%==0 (
  node serve_game.js
  goto :done
)
where py >nul 2>nul
if %errorlevel%==0 (
  py serve_game.py
  goto :done
)
where python >nul 2>nul
if %errorlevel%==0 (
  python serve_game.py
  goto :done
)

echo.
echo  Node.js or Python is required to run the game.
echo  Install Node.js from https://nodejs.org/ - it takes about a minute.
echo.
pause
goto :eof

:done
REM If the server exits straight away something went wrong. Keep the window up
REM so the error is readable instead of flashing past.
if %errorlevel% neq 0 (
  echo.
  echo  The server stopped with an error ^(code %errorlevel%^).
  echo.
  pause
)
