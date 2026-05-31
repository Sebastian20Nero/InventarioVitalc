<#
.SYNOPSIS
    Detecta quien esta ocupando los puertos del host que usa el stack.

.DESCRIPTION
    Lee los puertos publicados en .env (DB_PORT, API_PORT, WEB_PORT,
    PGADMIN_PORT) y, para cada uno, busca quien lo tiene tomado en el host.
    Para cada puerto ocupado muestra:
      - PID
      - nombre del proceso
      - si es uno de nuestros contenedores Docker, lo aclara

    No mata nada por si solo. Para matar el proceso:
      Stop-Process -Id <PID> -Force

.PARAMETER Kill
    Si se pasa, intenta matar el primer proceso que tiene el puerto
    (despues de pedir confirmacion). Util cuando dejaste un nodejs/postgres
    local pegado bloqueando el levantamiento de Docker.

.NOTES
    Si el puerto esta tomado por Docker mismo (com.docker.backend), NO lo
    mates: significa que el contenedor del proyecto ya esta arriba y todo
    esta bien. Usa 'docker compose ps' para confirmar.

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\fix-ports.ps1

    Solo lista quien tiene cada puerto.

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\fix-ports.ps1 -Kill

    Lista y, para cada puerto en conflicto NO-Docker, ofrece matarlo.
#>
[CmdletBinding()]
param(
    [switch]$Kill
)

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'

function Read-EnvFile {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path $Path)) { return $map }
    foreach ($line in Get-Content $Path) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        $eq = $t.IndexOf('=')
        if ($eq -lt 1) { continue }
        $key = $t.Substring(0, $eq).Trim()
        $val = $t.Substring($eq + 1).Trim().Trim('"').Trim("'")
        $map[$key] = $val
    }
    return $map
}

$envMap = Read-EnvFile $envFile

$portKeys = @(
    @{ Key = 'DB_PORT';      Default = '5432'; Service = 'db' },
    @{ Key = 'API_PORT';     Default = '3000'; Service = 'api' },
    @{ Key = 'WEB_PORT';     Default = '4200'; Service = 'web' },
    @{ Key = 'PGADMIN_PORT'; Default = '5050'; Service = 'pgadmin' }
)

Write-Host ""
Write-Host "==== fix-ports: puertos del stack ====" -ForegroundColor Cyan
Write-Host ""

foreach ($pk in $portKeys) {
    $port = $envMap[$pk.Key]
    if (-not $port) { $port = $pk.Default }

    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) {
        Write-Host ("{0,-13} ({1}): libre." -f $pk.Key, $port) -ForegroundColor Green
        continue
    }

    $pid_   = $conn[0].OwningProcess
    $proc   = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
    $name   = if ($proc) { $proc.ProcessName } else { '<desconocido>' }
    $isDocker = $name -match '^(com\.docker|docker|wslhost|vpnkit)'

    if ($isDocker) {
        Write-Host ("{0,-13} ({1}): tomado por Docker (PID {2}, {3}). Probablemente es nuestro contenedor '{4}'. NO lo mates." -f $pk.Key, $port, $pid_, $name, $pk.Service) -ForegroundColor Cyan
    } else {
        Write-Host ("{0,-13} ({1}): OCUPADO por PID {2} ({3}). No es Docker." -f $pk.Key, $port, $pid_, $name) -ForegroundColor Red

        if ($Kill) {
            $ans = Read-Host ("Matar PID {0} ({1})? [y/N]" -f $pid_, $name)
            if ($ans -eq 'y' -or $ans -eq 'Y') {
                try {
                    Stop-Process -Id $pid_ -Force -ErrorAction Stop
                    Write-Host ("  -> PID {0} terminado." -f $pid_) -ForegroundColor Yellow
                } catch {
                    Write-Host ("  -> No se pudo terminar PID {0}: {1}" -f $pid_, $_.Exception.Message) -ForegroundColor Red
                    Write-Host "     Reintenta esta consola como Administrador." -ForegroundColor Yellow
                }
            }
        } else {
            Write-Host ("  Para matarlo:  Stop-Process -Id {0} -Force" -f $pid_) -ForegroundColor Yellow
            Write-Host  "  Para cambiar el puerto en vez de matar: edita .env y reinicia con start-stack.ps1." -ForegroundColor Yellow
        }
    }
}

Write-Host ""
