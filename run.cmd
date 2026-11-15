@echo off
rem Runs the dashboard. When a new commit lands in this folder the dashboard exits with code 75
rem and is started again at once with the new code (the log keeps going). If it crashes, it
rem waits 60 s and tries again. Ctrl+C stops it.
cd /d %~dp0
set "AINK_RESTART="
:start
node src\main.mjs %*
if "%errorlevel%"=="75" goto restart
if "%errorlevel%"=="0" goto end
echo Dashboard stopped with an error (exit code %errorlevel%). Trying again in 60 seconds...
timeout /t 60 /nobreak >nul
:restart
set "AINK_RESTART=1"
goto start
:end
