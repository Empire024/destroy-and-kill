@echo off
cd /d "%~dp0"
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
echo Node.js or Python is required.
echo The standalone HTML can run the main game, but Prague needs this proxy launcher.
pause
