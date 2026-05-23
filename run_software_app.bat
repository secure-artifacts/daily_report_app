@echo off
cd /d "%~dp0"
if not exist node_modules\electron (
  echo First run: installing desktop runtime...
  npm install
)
npm run software
