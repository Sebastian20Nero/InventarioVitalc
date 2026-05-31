<#
.SYNOPSIS
    Reset duro del stack en Docker. Lo deja como recien clonado.

.DESCRIPTION
    Cuando el stack esta "raro" (contenedores zombi, build cache podrido,
    cambios en Dockerfile que no se reflejan, etc.) este script lo resetea
    al estado limpio:

      1. docker compose down (detiene y elimina contenedores y red).
      2. (opcional) elimina los volumenes del proyecto (postgres_data,
         pgadmin_data) -> borra TODOS los datos de la base.
      3. Elimina las imagenes propias del proyecto (api, web) para forzar
         rebuild desde cero.
      4. docker system prune -f (limpia capas dangling para liberar disco).
      5. docker compose build --no-cache (rebuild limpio).
      6. docker compose up -d (levanta).
      7. Llama a doctor.ps1 al final para verificar.

.PARAMETER HardReset
    Si se pasa, ademas borra los volumenes (postgres_data, pgadmin_data).
    PIERDES TODOS LOS DATOS de la base y la config de pgAdmin.
    Sin este flag los datos se conservan.

.PARAMETER NoBuild
    Si se pasa, salta el rebuild --no-cache. Solo recrea contenedores
    a partir de las imagenes ya construidas. Mas rapido.

.PARAMETER DbOnly
    Si se pasa, al final solo levanta db + pgadmin (igual que start-stack.ps1 -DbOnly).

.NOTES
    Cuando usar este script:
      - Cambiaste Dockerfile o package.json y el contenedor sigue con la
        version vieja.
      - El contenedor queda "Restarting" en loop.
      - Conflicto raro de red de Docker.
      - "image is being used by stopped container" al intentar borrar.

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\reset-stack.ps1

    Reset conservando datos (recomendado para problemas de build/red).

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\reset-stack.ps1 -HardReset

    Reset BORRANDO datos. Despues hay que volver a inicializar la base
    desde pgAdmin (ver README).

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\reset-stack.ps1 -NoBuild

    Recrea contenedores sin rebuild de imagenes.
#>
[CmdletBinding()]
param(
    [switch]$HardReset,
    [switch]$NoBuild,
    [switch]$DbOnly
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

# 0. Sanity check: Docker responde
# Bajamos $ErrorActionPreference durante el check porque docker info puede
# imprimir warnings benignos a stderr y, bajo 'Stop', PowerShell los
# convierte en NativeCommandError terminante. Solo nos importa el exit code.
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
    Write-Host "[reset-stack] Docker no responde. Abre Docker Desktop y espera 'Engine running'." -ForegroundColor Red
    exit 1
}

if ($HardReset) {
    Write-Host ""
    Write-Host "ATENCION: -HardReset borra los volumenes (postgres_data, pgadmin_data)." -ForegroundColor Red
    Write-Host "         Esto elimina TODOS los datos de la base de datos." -ForegroundColor Red
    $ans = Read-Host "Escribe 'borrar' para confirmar"
    if ($ans -ne 'borrar') {
        Write-Host "[reset-stack] cancelado." -ForegroundColor Yellow
        exit 0
    }
}

Push-Location $root
try {
    # 1. Stop + remove
    Write-Host ""
    Write-Host "[reset-stack] 1/6 - docker compose down" -ForegroundColor Cyan
    if ($HardReset) {
        & docker compose --env-file .env down -v --remove-orphans
    } else {
        & docker compose --env-file .env down --remove-orphans
    }

    # 2. Remove imagenes propias del proyecto (forzar rebuild limpio)
    Write-Host ""
    Write-Host "[reset-stack] 2/6 - eliminando imagenes del proyecto" -ForegroundColor Cyan
    foreach ($img in @('plantilla-inicio-api:latest', 'plantilla-inicio-web:latest')) {
        $exists = & docker image inspect $img 2>$null
        if ($LASTEXITCODE -eq 0) {
            & docker image rm -f $img | Out-Null
            Write-Host "  - eliminada $img" -ForegroundColor DarkGray
        }
    }

    # 3. Prune dangling
    Write-Host ""
    Write-Host "[reset-stack] 3/6 - docker system prune (capas dangling)" -ForegroundColor Cyan
    & docker system prune -f | Out-Null

    # 4. Build
    if ($NoBuild) {
        Write-Host ""
        Write-Host "[reset-stack] 4/6 - rebuild SALTADO (-NoBuild)" -ForegroundColor DarkGray
    } else {
        Write-Host ""
        Write-Host "[reset-stack] 4/6 - docker compose build --no-cache" -ForegroundColor Cyan
        & docker compose --env-file .env build --no-cache
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[reset-stack] el build fallo." -ForegroundColor Red
            exit 1
        }
    }

    # 5. Up
    Write-Host ""
    Write-Host "[reset-stack] 5/6 - docker compose up -d" -ForegroundColor Cyan
    $services = if ($DbOnly) { @('db', 'pgadmin') } else { @('db', 'pgadmin', 'api', 'web') }
    & docker compose --env-file .env up -d @services
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[reset-stack] up -d fallo." -ForegroundColor Red
        exit 1
    }

    # 6. Doctor
    Write-Host ""
    Write-Host "[reset-stack] 6/6 - doctor" -ForegroundColor Cyan
    & "$PSScriptRoot\doctor.ps1"

    Write-Host ""
    Write-Host "[reset-stack] listo." -ForegroundColor Green
    if ($HardReset) {
        Write-Host "Recuerda volver a inicializar la base desde pgAdmin (ver README)." -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}
