<#
.SYNOPSIS
    Diagnostica problemas comunes del stack en Docker.

.DESCRIPTION
    Revisa, en orden, los puntos donde suele fallar el levantamiento del
    stack y reporta cada uno con OK / WARN / FAIL:

      1. Docker Desktop esta corriendo y responde.
      2. Docker Compose v2 esta disponible (docker compose, no docker-compose).
      3. Existe .env en la raiz.
      4. Los puertos del host (DB_PORT, API_PORT, WEB_PORT, PGADMIN_PORT)
         estan libres o estan tomados por nuestros propios contenedores.
      5. Estado de los contenedores del proyecto (db, api, web, pgadmin).
      6. La base responde (pg_isready dentro de db).
      7. La API responde (curl al puerto del host hacia /).

    No modifica nada. Solo lee.

.PARAMETER Verbose
    Muestra los comandos docker que ejecuta internamente.

.NOTES
    Requisitos:
      - Docker Desktop encendido (si no, este script te lo dira en el paso 1).
      - .env en la raiz.

    Si algo sale FAIL:
      - Puerto ocupado    -> scripts\fix-ports.ps1
      - Stack en mal estado -> scripts\reset-stack.ps1
      - Docker apagado    -> abre Docker Desktop y espera "Engine running"

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

$root    = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'

$script:Failures = 0
$script:Warnings = 0

function Write-Check {
    param(
        [ValidateSet('OK','WARN','FAIL','INFO')] [string]$Level,
        [string]$Message
    )
    $color = switch ($Level) {
        'OK'   { 'Green' }
        'WARN' { 'Yellow' }
        'FAIL' { 'Red' }
        'INFO' { 'Cyan' }
    }
    Write-Host ("[{0,-4}] {1}" -f $Level, $Message) -ForegroundColor $color
    if ($Level -eq 'FAIL') { $script:Failures++ }
    if ($Level -eq 'WARN') { $script:Warnings++ }
}

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

Write-Host ""
Write-Host "==== doctor: diagnostico del stack ====" -ForegroundColor Cyan
Write-Host ""

# 1. Docker Desktop responde
Write-Host "-- 1. Docker Desktop --"
$dockerOk = $false
try {
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Check OK "Docker Desktop responde."
        $dockerOk = $true
    } else {
        Write-Check FAIL "Docker no responde. Abre Docker Desktop y espera a que diga 'Engine running'."
    }
} catch {
    Write-Check FAIL "No se encontro el comando 'docker'. Instala Docker Desktop."
}
Write-Host ""

# 2. docker compose v2
Write-Host "-- 2. docker compose v2 --"
if ($dockerOk) {
    & docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Check OK "docker compose v2 disponible."
    } else {
        Write-Check FAIL "Tu Docker no tiene 'docker compose' (plugin v2). Actualiza Docker Desktop."
    }
} else {
    Write-Check WARN "Saltado porque Docker no responde."
}
Write-Host ""

# 3. .env existe
Write-Host "-- 3. archivo .env --"
$envMap = @{}
if (Test-Path $envFile) {
    Write-Check OK ".env existe en la raiz."
    $envMap = Read-EnvFile $envFile
} else {
    Write-Check FAIL ".env no existe en la raiz. Copialo desde .env.example."
}
Write-Host ""

# 4. Puertos del host libres (o tomados por nuestros propios contenedores)
Write-Host "-- 4. puertos del host --"
$portKeys = @(
    @{ Key = 'DB_PORT';      Default = '5432'; Service = 'db' },
    @{ Key = 'API_PORT';     Default = '3000'; Service = 'api' },
    @{ Key = 'WEB_PORT';     Default = '4200'; Service = 'web' },
    @{ Key = 'PGADMIN_PORT'; Default = '5050'; Service = 'pgadmin' }
)

# Snapshot de puertos publicados por contenedores del proyecto (si Docker responde)
$ourPorts = @{}
if ($dockerOk) {
    Push-Location $root
    try {
        $psJson = & docker compose ps --format json 2>$null
        if ($LASTEXITCODE -eq 0 -and $psJson) {
            foreach ($line in ($psJson -split "`n")) {
                if (-not $line.Trim()) { continue }
                try {
                    $obj = $line | ConvertFrom-Json
                    if ($obj.Publishers) {
                        foreach ($p in $obj.Publishers) {
                            if ($p.PublishedPort) { $ourPorts[[string]$p.PublishedPort] = $obj.Service }
                        }
                    }
                } catch { }
            }
        }
    } finally { Pop-Location }
}

foreach ($pk in $portKeys) {
    $port = $envMap[$pk.Key]
    if (-not $port) { $port = $pk.Default }
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) {
        Write-Check OK ("{0} ({1}): libre." -f $pk.Key, $port)
        continue
    }
    if ($ourPorts.ContainsKey([string]$port) -and $ourPorts[[string]$port] -eq $pk.Service) {
        Write-Check OK ("{0} ({1}): tomado por nuestro contenedor '{2}' (esperado)." -f $pk.Key, $port, $pk.Service)
        continue
    }
    $procName = ''
    try {
        $procName = (Get-Process -Id $conn[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
    } catch { }
    Write-Check FAIL ("{0} ({1}): ocupado por PID {2} ({3}). Corre scripts\fix-ports.ps1 para mas detalles." -f $pk.Key, $port, $conn[0].OwningProcess, $procName)
}
Write-Host ""

# 5. Estado de los contenedores
Write-Host "-- 5. estado de los contenedores --"
if ($dockerOk) {
    Push-Location $root
    try {
        & docker compose ps
        Write-Host ""
        $running = & docker compose ps --services --filter status=running 2>$null
        $expected = @('db','pgadmin','api','web')
        foreach ($s in $expected) {
            if ($running -contains $s) {
                Write-Check OK "$s esta running."
            } else {
                Write-Check WARN "$s no esta running."
            }
        }
    } finally { Pop-Location }
} else {
    Write-Check WARN "Saltado porque Docker no responde."
}
Write-Host ""

# 6. Postgres responde
Write-Host "-- 6. postgres responde --"
if ($dockerOk) {
    $pgUser = $envMap['POSTGRES_USER']; if (-not $pgUser) { $pgUser = 'plantilla' }
    $pgDb   = $envMap['POSTGRES_DB'];   if (-not $pgDb)   { $pgDb   = 'plantilla_inicio' }
    Push-Location $root
    try {
        & docker compose exec -T db pg_isready -U $pgUser -d $pgDb *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Check OK "Postgres acepta conexiones."
        } else {
            Write-Check FAIL "Postgres no acepta conexiones (revisa 'docker compose logs db')."
        }
    } finally { Pop-Location }
} else {
    Write-Check WARN "Saltado porque Docker no responde."
}
Write-Host ""

# 7. API responde
Write-Host "-- 7. api responde --"
$apiPort = $envMap['API_PORT']; if (-not $apiPort) { $apiPort = '3000' }
try {
    $resp = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}" -f $apiPort) -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    Write-Check OK ("API en http://127.0.0.1:{0} respondio HTTP {1}." -f $apiPort, [int]$resp.StatusCode)
} catch {
    $msg = $_.Exception.Message
    if ($msg -match '40[0-9]') {
        Write-Check OK ("API en http://127.0.0.1:{0} respondio (codigo de estado, NestJS arriba)." -f $apiPort)
    } else {
        Write-Check WARN ("API en http://127.0.0.1:{0} no responde aun. Revisa 'docker compose logs api -f'." -f $apiPort)
    }
}
Write-Host ""

# Resumen
Write-Host "==== resumen ====" -ForegroundColor Cyan
if ($script:Failures -eq 0 -and $script:Warnings -eq 0) {
    Write-Host "Todo OK." -ForegroundColor Green
    exit 0
} elseif ($script:Failures -eq 0) {
    Write-Host ("OK con {0} warning(s)." -f $script:Warnings) -ForegroundColor Yellow
    exit 0
} else {
    Write-Host ("{0} FAIL, {1} WARN. Sugerencias:" -f $script:Failures, $script:Warnings) -ForegroundColor Red
    Write-Host "  - Puerto ocupado          -> scripts\fix-ports.ps1" -ForegroundColor Yellow
    Write-Host "  - Stack en mal estado     -> scripts\reset-stack.ps1" -ForegroundColor Yellow
    Write-Host "  - Docker Desktop apagado  -> abrelo y espera 'Engine running'" -ForegroundColor Yellow
    exit 1
}
