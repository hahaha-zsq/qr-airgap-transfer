@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 scripts\serve.py
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python scripts\serve.py
  goto :eof
)
start "" index.html
echo Python not found. Opened the offline page directly.
pause
