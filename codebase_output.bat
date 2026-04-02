@echo off
REM ================================
REM Codebase export script
REM ================================

set INPUT_DIR=./src

set OUTPUT_FILE=codebase.txt

codebase-to-text ^
  --input "%INPUT_DIR%" ^
  --output "%OUTPUT_FILE%" ^
  --output_type "txt" ^
  --exclude "*.exe" ^
  --exclude "*.dll" ^
  --exclude "*.dcu" ^
  --exclude "*.obj" ^
  --exclude "*.pdb" ^
  --exclude "*.log" ^
  --exclude "*.tmp" ^
  --exclude "*.pyc" ^
  --exclude "*.zip" ^
  --exclude "*.7z" ^
  --exclude "*.rar" ^
  --exclude "codebase_output.bat" ^
  --exclude "dist/" ^
  --exclude ".git/" ^
  --exclude "vendor/" ^
  --exclude "build/" ^
  --exclude "storage/" ^
  --exclude "dist/" ^
  --exclude "venv/" ^
  --exclude "__pycache__/" ^
  --exclude "node_modules/" ^
  --exclude "temp/" ^
  --exclude "%OUTPUT_FILE%" ^
  --exclude_hidden ^
  --verbose

echo.
echo Codebase exported to %OUTPUT_FILE%
pause
