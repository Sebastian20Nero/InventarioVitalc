# Conexion a la base de datos

> Guia practica para conectar la API, pgAdmin y clientes externos a la base
> de datos PostgreSQL del stack. Tambien describe los modos de inicializacion
> (manual via SQL vs automatico via Prisma) y deja una propuesta priorizada
> de mejoras al final.
>
> Audiencia: el equipo de desarrollo del proyecto. Pre-requisito: tener el
> stack levantado segun el [README](../README.md).

---

## Tabla de contenido

- [1. Vision general de la red](#1-vision-general-de-la-red)
- [2. Variables que rigen la conexion](#2-variables-que-rigen-la-conexion)
- [3. Conexion del backend (NestJS + Prisma)](#3-conexion-del-backend-nestjs--prisma)
- [4. Conexion desde pgAdmin](#4-conexion-desde-pgadmin)
- [5. Conexion desde un cliente externo (DBeaver / DataGrip / psql)](#5-conexion-desde-un-cliente-externo-dbeaver--datagrip--psql)
- [6. Verificacion en 60 segundos](#6-verificacion-en-60-segundos)
- [7. Troubleshooting de conexion](#7-troubleshooting-de-conexion)
- [8. Propuesta de mejoras](#8-propuesta-de-mejoras)
- [Apendice: cheat sheet](#apendice-cheat-sheet)

---

## 1. Vision general de la red

`docker-compose.yml` crea una red interna llamada `plantilla-inicio_default`.
Dentro de esa red los servicios se ven entre si **por nombre de servicio**
(no por IP). Hacia el exterior, solo los puertos publicados son alcanzables
desde el host.

```
                  red interna Docker (plantilla-inicio_default)
   ┌────────────────────────────────────────────────────────────┐
   │                                                            │
   │   ┌─────────┐   db:5432         ┌──────────────────┐       │
   │   │   api   │ ─────────────────▶│   db (Postgres)  │       │
   │   └─────────┘                   └──────────────────┘       │
   │       ▲                                  ▲                 │
   │       │                                  │ db:5432         │
   │       │ web (browser)                    │                 │
   │       │ usa puerto del host              │                 │
   │   ┌─────────┐                    ┌─────────────┐           │
   │   │   web   │                    │   pgadmin   │           │
   │   └─────────┘                    └─────────────┘           │
   │                                                            │
   └─────────────┬────────────────┬───────────────┬─────────────┘
                 │ 4200           │ 3001          │ 5051
                 ▼                ▼               ▼
            host (127.0.0.1)  host (127.0.0.1)  host (127.0.0.1)
            DBeaver/etc -> 127.0.0.1:5433 -> db (Postgres)
```

Reglas a recordar:

| Quien se conecta | Host a usar | Puerto a usar |
|---|---|---|
| `api` -> `db` | `db` | `5432` (interno) |
| `pgadmin` -> `db` | `db` | `5432` (interno) |
| Cliente del host (DBeaver, psql.exe, etc.) -> `db` | `127.0.0.1` | `DB_PORT` del `.env` (por defecto `5433`) |
| Frontend en el navegador -> `api` | `127.0.0.1` | `API_PORT` del `.env` (por defecto `3001`) |

> Confusion clasica: dentro de la red Docker, el puerto de Postgres es
> **5432**, no `5433`. El `5433` es solo el puerto del host. Si pones `5433`
> dentro de pgAdmin (que vive en la red Docker) te dara connection refused.

---

## 2. Variables que rigen la conexion

Todo se configura desde el `.env` en la raiz del proyecto. Las variables
relevantes para conexion son:

```ini
POSTGRES_USER=plantilla
POSTGRES_PASSWORD=plantilla
POSTGRES_DB=plantilla_inicio
DB_PORT=5433              # SOLO afecta el puerto publicado al host
API_PORT=3001             # puerto del host hacia la API
PGADMIN_PORT=5051         # puerto del host hacia pgAdmin
```

`docker-compose.yml` arma la URL de conexion del backend asi:

```yaml
DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}?schema=public
```

> Notese el host `db` (nombre del servicio) y el puerto `5432` (interno).
> `DB_PORT` del `.env` no aparece aqui: el backend NUNCA usa el puerto del
> host, porque vive en la misma red Docker.

Flags relacionados con la inicializacion (los lee el entrypoint del
backend en `backend/docker-entrypoint.sh`):

```ini
PRISMA_AUTO_MIGRATE=false   # si true, corre 'prisma migrate deploy' al arrancar
PRISMA_RUN_SEED=false       # si true, corre 'prisma db seed' al arrancar
```

Modo actual del proyecto: `false` / `false` -> inicializacion **manual**
desde pgAdmin (cargando los `.sql` de `database/`).

---

## 3. Conexion del backend (NestJS + Prisma)

El backend ya esta cableado, no hay que tocar codigo para que se conecte.
Las piezas:

```5:9:backend/prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

```1:15:backend/src/prisma/prisma.service.ts
import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
```

Flujo en runtime:

1. Compose inyecta `DATABASE_URL` al contenedor `api`.
2. `PrismaService` extiende `PrismaClient` y llama `$connect()` en
   `onModuleInit`. Eso abre el pool contra `db:5432`.
3. Si el `db` no esta listo todavia, `compose` espera al healthcheck
   (`pg_isready`) gracias a `depends_on: db: { condition: service_healthy }`.

Por eso, en el flujo normal, levantar el stack con `scripts\start-stack.ps1`
es suficiente: la API espera a la base y se conecta sola.

### Cambiar credenciales

1. Edita `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`).
2. Recrea solo los servicios afectados:

   ```powershell
   docker compose --env-file .env up -d db api
   ```

> Si la base ya existia con el usuario/contraseña anteriores y los cambias,
> Postgres NO los actualiza solo. Tendrias que entrar al contenedor y
> hacerlo con SQL, o borrar el volumen (`scripts\stop-all.ps1 -RemoveVolumes`)
> y arrancar limpio.

---

## 4. Conexion desde pgAdmin

pgAdmin vive **dentro** de la red Docker, asi que se conecta a `db:5432`,
no a `127.0.0.1:5433`.

1. Abrir `http://127.0.0.1:5051`.
2. Login: `admin@plantilla.com` / `admin` (o lo que tengas en `.env`).
3. Click derecho `Servers` -> `Register` -> `Server...`.

| Pestana | Campo | Valor | Por que |
|---|---|---|---|
| General | Name | `Plantilla Local` | Nombre libre |
| Connection | Host name/address | `db` | Nombre del servicio Docker |
| Connection | Port | `5432` | Puerto **interno** del contenedor |
| Connection | Maintenance database | `postgres` | La default que crea Postgres |
| Connection | Username | `plantilla` | `POSTGRES_USER` del `.env` |
| Connection | Password | `plantilla` | `POSTGRES_PASSWORD` del `.env` |
| Connection | Save password? | activar | Para no reescribirlo cada vez |

> Si pones `127.0.0.1` o `localhost` en host, pgAdmin se intentara conectar
> a si mismo (al contenedor de pgAdmin) y vas a ver `connection refused`.
> Tiene que ser `db`.

### Inicializar la base via pgAdmin (modo manual)

Modo actual del proyecto. Una sola vez, despues del primer `up`:

1. Click derecho sobre `plantilla_inicio` -> `Query Tool`.
2. Carga `database/01-schema.sql`, F5.
3. Carga `database/02-seed-security.sql`, F5.
4. Verifica con la consulta de [verificacion en 60 segundos](#6-verificacion-en-60-segundos).

---

## 5. Conexion desde un cliente externo (DBeaver / DataGrip / psql)

Si quieres conectarte desde una herramienta instalada en tu maquina (no en
Docker), usas el **puerto del host** (`DB_PORT`, por defecto `5433`).

| Campo | Valor |
|---|---|
| Host | `127.0.0.1` |
| Port | `5433` (lo que diga `DB_PORT` en `.env`) |
| Database | `plantilla_inicio` |
| User | `plantilla` |
| Password | `plantilla` |
| SSL | disabled (en local) |

### DBeaver / DataGrip

Crear nueva conexion PostgreSQL y pegar los valores de la tabla. Probar la
conexion (`Test Connection`). Si pide instalar el driver, aceptar.

### psql desde Windows

Si tienes el cliente `psql` instalado en el host:

```powershell
psql -h 127.0.0.1 -p 5433 -U plantilla -d plantilla_inicio
```

### psql desde dentro del contenedor (sin instalar nada en el host)

Util para diagnosticar rapido sin clientes externos:

```powershell
docker compose exec db psql -U plantilla -d plantilla_inicio
```

---

## 6. Verificacion en 60 segundos

Tres comandos para confirmar end-to-end que la conexion vive:

```powershell
# 1. Postgres acepta conexiones?
docker compose exec db pg_isready -U plantilla -d plantilla_inicio

# 2. La API se conecto y monto Prisma?
Invoke-WebRequest http://127.0.0.1:3001/docs -UseBasicParsing | Select-Object StatusCode

# 3. Los datos de seguridad estan cargados?
docker compose exec db psql -U plantilla -d plantilla_inicio -c "SELECT (SELECT COUNT(*) FROM \"Rol\") AS roles, (SELECT COUNT(*) FROM \"Permiso\") AS permisos, (SELECT COUNT(*) FROM \"Usuario\") AS usuarios;"
```

Resultado esperado:

```
1) /var/run/postgresql:5432 - accepting connections
2) StatusCode = 200
3) roles=2, permisos=15, usuarios=1
```

Atajo de todo lo anterior + chequeos de puerto:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1
```

---

## 7. Troubleshooting de conexion

### `P2021: The table ... does not exist in the current database`

La base existe pero no tiene tablas. Pasa cuando se levanto la `api` con
`PRISMA_AUTO_MIGRATE=false` y nadie cargo los `.sql` desde pgAdmin. Soluciones:

- **Modo manual**: ir a pgAdmin y ejecutar `01-schema.sql` y luego
  `02-seed-security.sql`. Reintentar la operacion.
- **Modo automatico** (recomendado para dev recurrente): poner
  `PRISMA_AUTO_MIGRATE=true` y `PRISMA_RUN_SEED=true` en `.env`,
  reiniciar `api`:

  ```powershell
  docker compose --env-file .env up -d api
  ```

### `password authentication failed for user "plantilla"`

Cambiaste `POSTGRES_PASSWORD` en `.env` pero el volumen ya existia con la
clave vieja. Postgres NO recrea usuarios al arrancar si el directorio de
datos ya existe. Opciones:

- Cambiar la clave dentro de la base con SQL (`ALTER USER plantilla WITH PASSWORD 'nueva';`).
- O resetear:

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\reset-stack.ps1 -HardReset
  ```

  (borra el volumen, perderas los datos).

### `connection refused` desde pgAdmin

Estas usando `127.0.0.1` o `localhost` como host. pgAdmin esta dentro de
Docker; debe usar **`db`** como host.

### `connection refused` desde DBeaver/DataGrip

Estas usando `db` como host (eso es interno). Desde el host debe ser
`127.0.0.1` y el puerto `DB_PORT` del `.env` (por defecto `5433`). Si el
puerto esta libre pero igual rechaza, corre:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\fix-ports.ps1
```

para descartar que otro Postgres local este escuchando.

### La API arranca y muere ciclando ("Restarting (1)")

Generalmente la base no resolvio bien el host o las credenciales. Mira los
logs:

```powershell
docker compose logs api -f
```

Si ves `Can't reach database server at 'db:5432'`, la red Docker se
ensucio. Reset suave:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\reset-stack.ps1
```

---

## 8. Propuesta de mejoras

Prioridad alta -> baja. No hay que hacerlas todas, pero asi quedaria una
plantilla mas robusta para sumar modulos de negocio sin sustos.

### P1 - Migrar a inicializacion automatica con Prisma para dev

**Estado actual**: `PRISMA_AUTO_MIGRATE=false` y la inicializacion se hace
a mano desde pgAdmin. Funciona, pero un dev nuevo siempre se equivoca de
orden o se olvida de cargar el seed.

**Propuesta**: en `.env` para entornos de dev pasar a:

```ini
PRISMA_AUTO_MIGRATE=true
PRISMA_RUN_SEED=true   # solo la primera vez; despues volver a false
```

El `docker-entrypoint.sh` ya respeta esos flags (`migrate deploy` + `db seed`).
Mantener los `.sql` de `database/` solo como referencia historica para DBA
que prefiere SQL puro. En produccion, `PRISMA_AUTO_MIGRATE=true` y
`PRISMA_RUN_SEED=false` siempre.

**Beneficio**: nuevo dev clona, `start-stack.ps1`, listo.

### P2 - Healthcheck del backend

**Estado actual**: `compose` espera al `db` por healthcheck, pero la `api`
no expone un endpoint de health propio. Si la `api` se queda colgada
internamente, `docker compose ps` la sigue viendo `Up`.

**Propuesta**:

1. Anadir endpoint `GET /health` en NestJS que haga `SELECT 1` via Prisma.
2. Anadir `healthcheck` en `docker-compose.yml`:

   ```yaml
   healthcheck:
     test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/health"]
     interval: 10s
     timeout: 3s
     retries: 6
     start_period: 20s
   ```

3. Cambiar `web.depends_on.api` a `condition: service_healthy`.

**Beneficio**: el frontend solo arranca cuando la API ya conecto a la
base. `doctor.ps1` puede consumir el `/health` real.

### P3 - Pool de conexiones explicito

**Estado actual**: `PrismaClient` usa el pool default de Prisma. Para una
plantilla esta bien, pero conviene fijar tamanos para evitar sorpresas en
prod.

**Propuesta**: parametrizar la URL en `docker-compose.yml`:

```yaml
DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}?schema=public&connection_limit=10&pool_timeout=10
```

Y exponer `connection_limit` y `pool_timeout` en `.env`.

**Beneficio**: control de saturacion bajo carga.

### P4 - Separar credenciales: app vs migraciones

**Estado actual**: el mismo usuario `plantilla` ejecuta DDL (migraciones) y
DML (queries de la app). En produccion eso es un riesgo.

**Propuesta**:

- Crear `plantilla_migrator` con permiso de DDL y `plantilla_app` con solo
  DML sobre el schema `public`.
- `DATABASE_URL` (runtime de la app) usa `plantilla_app`.
- `DATABASE_MIGRATION_URL` (entrypoint para `migrate deploy`) usa
  `plantilla_migrator`.
- El `docker-entrypoint.sh` setea `DATABASE_URL=$DATABASE_MIGRATION_URL`
  durante `migrate deploy` y la restaura antes de `node dist/main.js`.

**Beneficio**: si hay una vulnerabilidad de inyeccion en la app, no se
puede `DROP TABLE`.

### P5 - Backups automaticos del volumen `postgres_data` en dev

**Estado actual**: si haces `stop-all.ps1 -RemoveVolumes` por error,
perdiste todo.

**Propuesta**: anadir `scripts\backup-db.ps1` que haga
`docker compose exec db pg_dump ... > backups/<timestamp>.sql` y un
`restore-db.ps1` que haga el inverso. Anadir `backups/` al `.gitignore`.

**Beneficio**: red de seguridad para datos de prueba que ya tienen valor
(p.ej. cargas de datos reales de QA).

### P6 - SSL en produccion

**Estado actual**: la URL es `postgresql://...` sin `sslmode`. Para local
es lo correcto, pero en produccion conviene `sslmode=require` y configurar
el cert.

**Propuesta**: en `deploy/`, sobreescribir `DATABASE_URL` con `sslmode=require`
y montar el cert via secret de Compose.

**Beneficio**: encripta el trafico app-base aunque vivan en la misma VPC.

---

## Apendice: cheat sheet

```powershell
# Diagnostico rapido
powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1

# Ver puertos del stack
powershell -ExecutionPolicy Bypass -File .\scripts\fix-ports.ps1

# Reset del stack (conserva datos)
powershell -ExecutionPolicy Bypass -File .\scripts\reset-stack.ps1

# Reset duro (borra volumenes -> pierde datos)
powershell -ExecutionPolicy Bypass -File .\scripts\reset-stack.ps1 -HardReset

# Postgres responde?
docker compose exec db pg_isready -U plantilla -d plantilla_inicio

# Entrar a la base con psql
docker compose exec db psql -U plantilla -d plantilla_inicio

# Logs de api / db
docker compose logs api -f
docker compose logs db -f

# Recrear api leyendo .env actual
docker compose --env-file .env up -d api
```

URLs:

| Servicio | URL | Credenciales |
|---|---|---|
| Frontend | http://127.0.0.1:4200 | `johanstian20@hotmail.com` / `rmmr` |
| API      | http://127.0.0.1:3001 | (JWT obtenido en `POST /auth/login`) |
| Swagger  | http://127.0.0.1:3001/docs | Click `Authorize` y pega el JWT |
| pgAdmin  | http://127.0.0.1:5051 | `admin@plantilla.com` / `admin` |
