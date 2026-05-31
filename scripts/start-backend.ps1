<#
.SYNOPSIS
    Alias retrocompatible de scripts\start-stack.ps1.

.DESCRIPTION
    Antes este script se llamaba "start-backend" pero en realidad levanta
    todo el stack (db, pgadmin, api, web), no solo el backend. Se renombro
    a "start-stack.ps1" y este archivo queda como atajo para no romper
    referencias o memoria muscular existentes.

    Reenvia todos los argumentos recibidos al script real. Es decir,
    soporta los mismos parametros que start-stack.ps1 (-DbOnly, -NoBuild).

.NOTES
    Usa preferentemente:
        powershell -ExecutionPolicy Bypass -File .\scripts\start-stack.ps1

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1

    Equivalente a llamar a start-stack.ps1.

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -DbOnly

    Reenvia el flag a start-stack.ps1.
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Forwarded
)

& "$PSScriptRoot\start-stack.ps1" @Forwarded
