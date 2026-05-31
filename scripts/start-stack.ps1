<#
.SYNOPSIS
    Levanta el stack del proyecto en local con Docker Compose.

.DESCRIPTION
    Construye las imagenes (si hace falta) y arranca los servicios definidos
    en docker-compose.yml usando las variables del archivo .env de la raiz.

    Servicios:
      - db      -> PostgreSQL 16
      - pgadmin -> UI web para administrar Postgres
      - api     -> Backend NestJS (Prisma)
      - web     -> Frontend Angular servido por Nginx

    El script valida que exista .env en la raiz; si no existe lo crea
    automaticamente copiando .env.example.

.PARAMETER DbOnly
    Si se pasa, levanta unicamente db + pgadmin. Util la primera vez que
    inicializas la base de datos manualmente desde pgAdmin antes de levantar
    el resto del stack.

.PARAMETER NoBuild
    Si se pasa, no reconstruye las imagenes (solo levanta lo que ya este
    construido). Util para iteraciones rapidas cuando no cambiaste el codigo.

.NOTES
    Requisitos:
      - Docker Desktop encendido.
      - .env en la raiz (se autocrea desde .env.example si no existe).

    URLs por defecto (segun .env):
      - Frontend: http://127.0.0.1:4200
      - API:      http://127.0.0.1:3001
      - Swagger:  http://127.0.0.1:3001/docs
      - pgAdmin:  http://127.0.0.1:5051

    Para apagar todo usa: scripts\stop-all.ps1

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\start-stack.ps1

    Levanta todo el stack (db, pgadmin, api, web).

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\start-stack.ps1 -DbOnly

    Levanta solo db + pgadmin para inicializar la base manualmente.

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\start-stack.ps1 -NoBuild

    Levanta sin reconstruir imagenes.
#>
[CmdletBinding()]
param(
    [switch]$DbOnly,
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$envExample = Join-Path $root '.env.example'

# 0. Docker Desktop responde?
# Nota: bajamos $ErrorActionPreference durante el check porque docker info
# puede imprimir warnings benignos a stderr (p.ej. "daemon is not using the
# default seccomp profile") y, bajo 'Stop', PowerShell los convierte en
# NativeCommandError terminante ANTES de aplicar redirecciones. Solo nos
# importa el exit code.
$dockerOk = $false
$__prev   = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
try {
    & docker info 2>&1 | Out-Null
    $dockerOk = ($LASTEXITCODE -eq 0)
} catch {
    $dockerOk = $false
} finally {
    $ErrorActionPreference = $__prev
}
if (-not $dockerOk) {
    Write-Host "[start-stack] Docker no responde." -ForegroundColor Red
    Write-Host "             Abre Docker Desktop y espera a que diga 'Engine running'." -ForegroundColor Yellow
    Write-Host "             Para diagnosticar mas a fondo: scripts\doctor.ps1" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $envFile)) {
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-Host "[start-stack] .env no existia, lo cree desde .env.example" -ForegroundColor Yellow
    } else {
        Write-Error "[start-stack] No existe .env ni .env.example en la raiz."
        exit 1
    }
}

$services = if ($DbOnly) { @('db', 'pgadmin') } else { @('db', 'pgadmin', 'api', 'web') }

$dockerArgs = @('compose', '--env-file', '.env', 'up', '-d')
if (-not $NoBuild) { $dockerArgs += '--build' }
$dockerArgs += $services

Push-Location $root
try {
    Write-Host "[start-stack] docker $($dockerArgs -join ' ')" -ForegroundColor Cyan
    & docker @dockerArgs
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Host ""
        Write-Host "[start-stack] docker compose fallo (exit $code)." -ForegroundColor Red
        Write-Host "Pistas comunes:" -ForegroundColor Yellow
        Write-Host "  - 'port is already allocated' -> scripts\fix-ports.ps1" -ForegroundColor Yellow
        Write-Host "  - build raro / cache podrido  -> scripts\reset-stack.ps1" -ForegroundColor Yellow
        Write-Host "  - diagnostico general         -> scripts\doctor.ps1" -ForegroundColor Yellow
        exit $code
    }
    Write-Host ""
    & docker compose ps
} finally {
    Pop-Location
}
