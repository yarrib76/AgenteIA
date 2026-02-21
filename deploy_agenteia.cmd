@echo off
setlocal

REM =========================
REM Configuracion
REM =========================
set "REPO_URL=https://github.com/yarrib76/AgenteIA.git"
set "REPO_DIR=C:\Proyectos\AgenteIA"
set "BRANCH=main"
set "CONTAINER=agenteia"
set "APP_PORT=3000"

echo.
echo ==========================================
echo Deploy AgenteIA (Docker)
echo Repo: %REPO_DIR%
echo Branch: %BRANCH%
echo ==========================================
echo.

where git >nul 2>&1 || (
  echo ERROR: Git no esta instalado o no esta en PATH.
  exit /b 1
)

where docker >nul 2>&1 || (
  echo ERROR: Docker no esta instalado o no esta en PATH.
  exit /b 1
)

REM 1) Clonar si no existe
if not exist "%REPO_DIR%\.git" (
  echo [1/6] Clonando repositorio...
  if not exist "%REPO_DIR%" mkdir "%REPO_DIR%"
  git clone "%REPO_URL%" "%REPO_DIR%"
  if errorlevel 1 (
    echo ERROR: Fallo git clone.
    exit /b 1
  )
) else (
  echo [1/6] Repositorio ya existe. Se actualizara con git pull.
)

REM Ir al repo
cd /d "%REPO_DIR%" || (
  echo ERROR: No se puede ingresar a %REPO_DIR%.
  exit /b 1
)

REM 2) Checkout branch y pull
echo [2/6] Actualizando repo...
git fetch origin
if errorlevel 1 (
  echo ERROR: Fallo git fetch.
  exit /b 1
)
git checkout %BRANCH%
if errorlevel 1 (
  echo ERROR: No se pudo cambiar a la rama %BRANCH%.
  exit /b 1
)
git pull origin %BRANCH%
if errorlevel 1 (
  echo ERROR: Fallo git pull.
  exit /b 1
)

REM 3) Validar .env
echo [3/6] Verificando .env...
if not exist ".env" (
  echo ERROR: Falta archivo .env en %REPO_DIR%.
  echo Crea el archivo .env y volve a ejecutar este script.
  exit /b 1
)

REM 4) Crear carpetas persistentes
echo [4/6] Preparando carpetas persistentes...
if not exist "data" mkdir "data"
if not exist "archivos" mkdir "archivos"
if not exist "wa_auth" mkdir "wa_auth"
if not exist "wa_cache" mkdir "wa_cache"

REM 5) Levantar contenedor con compose
echo [5/6] Construyendo y levantando contenedor...
docker compose up -d --build
if errorlevel 1 (
  echo ERROR: Fallo docker compose up.
  exit /b 1
)

REM 6) Verificar estado
echo [6/6] Estado del contenedor:
docker ps --filter "name=%CONTAINER%"
echo.
echo Deploy finalizado.
echo URL: http://localhost:%APP_PORT%
echo.

endlocal
exit /b 0
