@echo off
chcp 65001 >nul
title Daedalus - Local-First Coding CLI
color 0A

echo  +------------------------------------------+
echo  ^|         Launching Daedalus CLI...         ^|
echo  +------------------------------------------+
echo.

node "%~dp0dist/index.js" %*

if errorlevel 1 (
    echo.
    echo  [ERROR] Daedalus exited with code %errorlevel%
    echo  Make sure it's installed globally: npm link
    pause
)
