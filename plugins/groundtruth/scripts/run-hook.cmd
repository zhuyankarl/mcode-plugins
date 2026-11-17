@echo off
rem ---------------------------------------------------------------------------
rem Groundtruth Hook launcher for Windows.
rem
rem Why this file exists: MiniMax Code Desktop on Windows does not always have
rem `node` on the process PATH (a hard-coded absolute node path breaks as soon
rem as the package is installed on another machine). This launcher resolves a
rem usable node.exe itself and then runs the requested hook script, forwarding
rem stdin/stdout/exit code untouched.
rem
rem Usage: run-hook.cmd <hook-script-file-name>
rem ---------------------------------------------------------------------------
setlocal EnableExtensions

set "HOOK_DIR=%~dp0"
set "NODE_EXE="

rem 1) node.exe on PATH (covers nodejs.org installer, nvm-windows, fnm, scoop...)
for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"

rem 2) well-known install locations, in case PATH is not inherited
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%APPDATA%\nvm\node.exe" set "NODE_EXE=%APPDATA%\nvm\node.exe"
if not defined NODE_EXE if exist "%ProgramData%\nvm\node.exe" set "NODE_EXE=%ProgramData%\nvm\node.exe"

if not defined NODE_EXE (
  echo groundtruth hook: node.exe not found. Install Node.js LTS or add node to PATH. 1>&2
  exit /b 127
)

if "%~1"=="" (
  echo groundtruth hook: missing hook script argument. 1>&2
  exit /b 2
)

rem "%~1" is a bare file name inside this script's own directory.
"%NODE_EXE%" "%HOOK_DIR%%~1"
exit /b %ERRORLEVEL%
