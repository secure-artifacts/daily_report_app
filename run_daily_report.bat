@echo off
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
  python daily_report_app.py
) else (
  py daily_report_app.py
)
