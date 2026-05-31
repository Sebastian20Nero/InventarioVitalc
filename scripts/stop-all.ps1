<#
.SYNOPSIS
    Apaga el stack local del proyecto.

.DESCRIPTION
    Detiene y elimina los contenedores definidos en docker-compose.yml,
    leyendo las variables desde .env. Por defecto NO borra los volumenes,
    asi que la base de datos y la configuracion de pgAdmin se conservan
    para el siguiente arranque.

.PARAMETER RemoveVolumes
    Si se pasa, elimina tambien los volumenes (postgres_data, pgadmin_data).
    Esto borra todos los datos de la base y la configuracion guardada en
    pgAdmin. Util cuando quieres empezar desde cero.

.NOTES
    Requisitos:
      - Docker Desktop encendido.
      - .env en la raiz.

    Para volver a levantar todo usa: scripts\start-stack.ps1

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\stop-all.ps1

    Apaga el stack manteniendo los datos de la base.

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\stop-all.ps1 -RemoveVolumes

    Apaga el stack y borra todos los datos (base de datos y pgAdmin).
#>
[CmdletBinding()]
param(
    [switch]$RemoveVolumes
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

$dockerArgs = @('compose', '--env-file', '.env', 'down')
if ($RemoveVolumes) {
    $dockerArgs += '-v'
    Write-Host "[stop-all] Apagando y borrando volumenes (datos perdidos)." -ForegroundColor Yellow
} else {
    Write-Host "[stop-all] Apagando contenedores (datos conservados)." -ForegroundColor Cyan
}

Push-Location $root
try {
    & docker @dockerArgs
} finally {
    Pop-Location
}
