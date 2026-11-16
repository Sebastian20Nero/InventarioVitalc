# PlantillaInicio

Plantilla base para nuevos proyectos. Stack:

- `frontend` Angular
- `backend` NestJS + SQL crudo con `node-postgres` (`pg`), sin ORM
- `PostgreSQL` 16
- `pgAdmin` (UI web para administrar la base)
- todo orquestado con `Docker Compose`

Trae listo:

- login por correo + password con JWT
- CRUD de `usuarios`, `roles` y `permisos`
- swagger del backend
- script SQL para inicializar la base manualmente
- scripts de PowerShell para levantar / apagar el stack

---

## Tabla de contenido

- [Requisitos](#requisitos)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Como funciona el stack](#como-funciona-el-stack)
- [Levantar el proyecto la primera vez](#levantar-el-proyecto-la-primera-vez)
- [Inicializar la base desde pgAdmin](#inicializar-la-base-desde-pgadmin)
- [Operacion del dia a dia](#operacion-del-dia-a-dia)
- [URLs y credenciales](#urls-y-credenciales)
- [Variables de entorno](#variables-de-entorno)
- [Comandos utiles](#comandos-utiles)
- [Troubleshooting](#troubleshooting)
- [Despliegue en servidor](#despliegue-en-servidor)
- [Flujo de Git recomendado](#flujo-de-git-recomendado)
- [Crecimiento natural](#crecimiento-natural)

---

## Requisitos

- **Docker Desktop** encendido (Windows / Mac / Linux con WSL2 si aplica).
- **Git**.
- Opcional: Node 20+ y npm si vas a correr alguna parte fuera de Docker.

---

## Estructura del proyecto

```
Plantilla/
├── backend/               # API NestJS con SQL crudo (node-postgres)
│   ├── db/
│   │   └── schema.sql     # esquema completo (se aplica solo al arrancar)
│   ├── src/
│   │   ├── database/      # DatabaseService (pool pg), DatabaseModule y seed.ts
│   │   └── ...            # modulos NestJS (repositorios con SQL crudo)
│   ├── Dockerfile
│   └── docker-entrypoint.sh
├── frontend/              # App Angular
│   ├── src/
│   │   └── environments/
│   │       ├── environment.ts        # apunta a la API local
│   │       └── environment.prod.ts   # apunta a la API de produccion
│   ├── Dockerfile         # multi-stage: build Angular + sirve con Nginx
│   └── nginx.conf
├── database/              # Scripts SQL para inicializacion manual
│   ├── 00-create-role-and-db.sql  # opcional, no se usa en Docker
│   ├── 01-schema.sql              # tablas, indices, FKs
│   ├── 02-seed-security.sql       # roles, permisos, usuario admin
│   └── 03-run-all.psql            # wrapper para ejecutar todo desde psql
├── deploy/                # Compose y scripts de despliegue al servidor
├── scripts/               # Atajos PowerShell para uso local
│   ├── start-stack.ps1    # levanta el stack (todo, o solo db+pgadmin)
│   ├── start-backend.ps1  # alias retrocompatible de start-stack
│   ├── stop-all.ps1       # apaga el stack
│   ├── doctor.ps1         # diagnostica el estado del stack
│   ├── fix-ports.ps1      # detecta quien ocupa los puertos del host
│   └── reset-stack.ps1    # reset duro (limpia + rebuild + up)
├── docker-compose.yml     # stack de desarrollo
├── .env.example           # plantilla de variables de entorno
└── .env                   # variables reales (no se comitea)
```

---

## Como funciona el stack

`docker-compose.yml` define cuatro servicios. Todos viven en una red Docker
interna llamada `plantilla-inicio_default` y se ven entre si por el nombre
del servicio.

| Servicio | Imagen | Para que sirve | Puerto interno | Puerto del host |
|---|---|---|---|---|
| `db` | `postgres:16-alpine` | Base de datos del proyecto | 5432 | `5433` (configurable) |
| `pgadmin` | `dpage/pgadmin4:latest` | UI web para administrar Postgres | 80 | `5051` (configurable) |
| `api` | build de `backend/` | Backend NestJS | 3000 | `3001` (configurable) |
| `web` | build de `frontend/` | Frontend Angular en Nginx | 80 | `4200` (configurable) |

> Importante: la diferencia entre **puerto interno** (dentro del contenedor)
> y **puerto del host** (lo que tu navegador usa). Por convencion el interno
> queda fijo y solo el del host varia segun `.env`. Eso evita un bug clasico
> donde el host apunta a un puerto donde nadie escucha.

### Como se conectan entre si

- `api` se conecta a `db` por `db:5432` (nombre de servicio + puerto interno).
- `pgadmin` se conecta a `db` por `db:5432`.
- `web` (Nginx) sirve el bundle Angular y este, en el navegador del usuario,
  hace requests a la `api` por `http://127.0.0.1:3001` (el puerto del host).

### Inicializacion de la base

Ya **no se usa Prisma**. El backend inicializa la base con **SQL crudo** al
arrancar, desde el `DatabaseService` (pool de `node-postgres`). Controlado por
dos flags en `.env`:

1. `DB_AUTO_INIT=true` -> aplica `backend/db/schema.sql`
   (`CREATE TABLE IF NOT EXISTS ...` para todas las tablas, incluida
   `ConfiguracionDsnube`). Es idempotente: en una base ya creada no hace nada.
2. `DB_RUN_SEED=true` -> ejecuta el seed (`backend/src/database/seed.ts`):
   roles, permisos, mapeo rol-permiso, usuario admin y catalogos base. Usa
   `INSERT ... ON CONFLICT` asi que se puede re-ejecutar sin duplicar datos.

El `DatabaseService` reintenta la conexion a Postgres al arrancar
(`DB_CONNECT_RETRIES`, `DB_CONNECT_RETRY_MS`), evitando el clasico "el backend
cayo" cuando la base aun no termino de levantar.

> Si prefieres no tocar el esquema/seed automaticamente, pon `DB_AUTO_INIT=false`
> y `DB_RUN_SEED=false` en `.env`. El backend solo se conectara a la base.

---

## Levantar el proyecto la primera vez

> Resumen: con `DB_AUTO_INIT=true` y `DB_RUN_SEED=true` (default), basta con
> **levantar todo el stack**: la `api` crea el esquema y siembra los datos sola
> al arrancar. Ya **no** hace falta cargar SQL manualmente en pgAdmin (queda
> como opcion para DBA).
>
> ```powershell
> docker compose --env-file .env up -d --build
> docker compose ps
> docker compose logs api -f   # ver "Esquema aplicado" y "Seed lista."
> ```

### 1. Asegurate que Docker Desktop este encendido

Espera a que diga *Engine running*.

### 2. (Opcional) Copia tus variables

```powershell
Copy-Item .env.example .env
```

Si te saltas este paso, el script `start-stack.ps1` lo hace por ti la primera vez.

### 3. Levanta solo `db` y `pgadmin`

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-stack.ps1 -DbOnly
```

Esto construye y arranca solo los dos servicios necesarios para preparar la base.

### 4. Carga los scripts SQL desde pgAdmin

Sigue [Inicializar la base desde pgAdmin](#inicializar-la-base-desde-pgadmin).

### 5. Levanta el resto del stack

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-stack.ps1
```

(Sin `-DbOnly` levanta `db + pgadmin + api + web`. Como `db` y `pgadmin` ya estan
arriba, solo agrega `api` y `web`.)

### 6. Entra al frontend

http://127.0.0.1:4200 con `johanstian20@hotmail.com` / `rmmr`.

---

## Inicializar la base desde pgAdmin

### 1. Abre pgAdmin

http://127.0.0.1:5051

- Email: `admin@plantilla.com`
- Password: `admin`

### 2. Registra el servidor PostgreSQL

Click derecho sobre `Servers` -> `Register` -> `Server...`

**Pestaña General**

| Campo | Valor |
|---|---|
| Name | `Plantilla Local` |

**Pestaña Connection**

| Campo | Valor | Por que |
|---|---|---|
| Host name/address | `db` | Nombre de servicio en la red Docker. NO uses `127.0.0.1`. |
| Port | `5432` | Puerto interno, NO el `5433` del host. |
| Maintenance database | `postgres` | La default que crea Postgres. |
| Username | `plantilla` | De `.env` (`POSTGRES_USER`). |
| Password | `plantilla` | De `.env` (`POSTGRES_PASSWORD`). |
| Save password? | activar | |

Click `Save`. Veras `Servers > Plantilla Local > Databases > plantilla_inicio`.

### 3. Ejecuta los scripts en orden

Click derecho sobre `plantilla_inicio` -> `Query Tool`.

Usa el boton de carpeta (Open File) y carga primero:

1. `database/01-schema.sql` -> ejecutar con **F5**
2. `database/02-seed-security.sql` -> ejecutar con **F5**

> El archivo `00-create-role-and-db.sql` no es necesario: el rol `plantilla` y
> la base `plantilla_inicio` ya fueron creados por las env vars del contenedor
> de Postgres al primer arranque. El `03-run-all.psql` es un wrapper para `psql`
> en terminal; aqui usamos pgAdmin.

### 4. Verificacion rapida

En el Query Tool ejecuta:

```sql
SELECT
  (SELECT COUNT(*) FROM "Rol")        AS roles,
  (SELECT COUNT(*) FROM "Permiso")    AS permisos,
  (SELECT COUNT(*) FROM "Persona")    AS personas,
  (SELECT COUNT(*) FROM "Usuario")    AS usuarios,
  (SELECT COUNT(*) FROM "RolPermiso") AS rol_permisos,
  (SELECT COUNT(*) FROM "UsuarioRol") AS usuario_roles;
```

Resultado esperado: `2, 15, 1, 1, 15, 1`.

---

## Operacion del dia a dia

```powershell
# Levantar todo
powershell -ExecutionPolicy Bypass -File .\scripts\start-stack.ps1

# Levantar todo SIN reconstruir imagenes (mas rapido si no cambiaste codigo)
powershell -ExecutionPolicy Bypass -File .\scripts\start-stack.ps1 -NoBuild

# Levantar solo db + pgadmin (para inicializacion o trabajo de DBA)
powershell -ExecutionPolicy Bypass -File .\scripts\start-stack.ps1 -DbOnly

# Apagar (conserva datos)
powershell -ExecutionPolicy Bypass -File .\scripts\stop-all.ps1

# Apagar y borrar volumenes (base de datos y config de pgAdmin se pierden)
powershell -ExecutionPolicy Bypass -File .\scripts\stop-all.ps1 -RemoveVolumes

# Diagnosticar (Docker on?, .env?, puertos?, contenedores?, db?, api?)
powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1

# Ver quien pisa los puertos del stack
powershell -ExecutionPolicy Bypass -File .\scripts\fix-ports.ps1

# Reset duro (down + prune + rebuild --no-cache + up). Conserva datos.
powershell -ExecutionPolicy Bypass -File .\scripts\reset-stack.ps1
```

---

## URLs y credenciales

| Servicio | URL | Credenciales |
|---|---|---|
| Frontend | http://127.0.0.1:4200 | `johanstian20@hotmail.com` / `rmmr` |
| API | http://127.0.0.1:3001 | (token JWT obtenido en `POST /auth/login`) |
| Swagger | http://127.0.0.1:3001/docs | Click `Authorize` y pega el JWT |
| pgAdmin | http://127.0.0.1:5051 | `admin@plantilla.com` / `admin` |

> Los puertos del host vienen de `.env`. Si los cambias ahi, ajusta tambien
> `frontend/src/environments/environment.ts` para que el navegador apunte
> al puerto correcto del API.

---

## Variables de entorno

Todo vive en `.env` en la raiz del proyecto. Ejemplo basado en `.env.example`:

```ini
# --- Postgres ---
POSTGRES_USER=plantilla
POSTGRES_PASSWORD=plantilla
POSTGRES_DB=plantilla_inicio
DB_PORT=5433              # puerto del host hacia Postgres

# --- API ---
API_PORT=3001             # puerto del host hacia el backend
NODE_ENV=development
JWT_SECRET=change_me_with_a_long_secret
CORS_ORIGINS=http://localhost:4200,http://127.0.0.1:4200
SWAGGER_ENABLED=true
DB_AUTO_INIT=true         # si true, el api aplica db/schema.sql al arrancar
DB_RUN_SEED=true          # si true, el api corre el seed SQL al arrancar

# --- Web ---
WEB_PORT=4200             # puerto del host hacia el frontend

# --- pgAdmin ---
PGADMIN_EMAIL=admin@plantilla.com
PGADMIN_PASSWORD=admin
PGADMIN_PORT=5051         # puerto del host hacia pgAdmin

# --- Datos del admin que crea el seed automatico ---
ADMIN_EMAIL=johanstian20@hotmail.com
ADMIN_PASSWORD=rmmr
ADMIN_NOMBRES=Johan Sebastian
ADMIN_APELLIDOS=Admin
ADMIN_CELULAR=3000000000
```

> El `.env` no se comitea (esta en `.gitignore`). Cada desarrollador mantiene
> el suyo.

---

## Comandos utiles

### Bajar y subir todo el stack (recomendado tras cambios)

```powershell
# 1. Bajar todos los contenedores (conserva la base de datos)
docker compose --env-file .env down

# 2. Subir todo reconstruyendo las imagenes
#    La api aplica schema.sql + seed SQL automaticamente al arrancar
docker compose --env-file .env up -d --build

# 3. Ver que los 4 contenedores quedaron Up (api NO debe estar "Restarting")
docker compose ps

# 4. Ver el arranque de la api: debe decir "Conexion a PostgreSQL establecida",
#    "Esquema aplicado" y "Seed lista."
docker compose logs api --tail 40
```

> **Importante si vienes de la version con Prisma:** la base vieja tiene las
> tablas creadas por Prisma (con `updatedAt` sin default) y puede chocar con el
> seed. Para empezar **100% limpio borrando la base**, usa `-v`:
>
> ```powershell
> docker compose --env-file .env down -v
> docker compose --env-file .env up -d --build
> ```
>
> Como el seed es automatico, al volver a subir la base se recrea y se siembra
> sola con el usuario admin.

### Verificar que el backend responde

```powershell
# Health directo del API (debe dar 200)
curl.exe -i http://localhost:3001/health

# Health a traves del proxy del frontend (debe dar 200)
curl.exe -i http://localhost:4200/api/health
```

Luego abre `http://localhost:4200` e inicia sesion con
`johanstian20@hotmail.com` / `rmmr`.

### Otros comandos

```powershell
# Ver el estado de los contenedores
docker compose ps

# Ver logs de un servicio (api, web, db, pgadmin)
docker compose logs api -f

# Reiniciar un solo servicio
docker compose --env-file .env restart api

# Recrear un servicio (re-aplicando .env actual)
docker compose --env-file .env up -d api

# Forzar rebuild de un servicio
docker compose --env-file .env up -d --build api

# Entrar al shell del contenedor
docker compose exec api sh
docker compose exec db sh

# Conectar a Postgres desde el contenedor
docker compose exec db psql -U plantilla -d plantilla_inicio
```

---

## Troubleshooting

> Atajos: si algo en Docker esta raro, en este orden:
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1       # diagnostica
> powershell -ExecutionPolicy Bypass -File .\scripts\fix-ports.ps1    # detecta quien pisa puertos
> powershell -ExecutionPolicy Bypass -File .\scripts\reset-stack.ps1  # reset duro (rebuild limpio)
> ```

### "port is already allocated"

Algun puerto del host (5433, 3001, 4200 o 5051) esta ocupado por otra app
local (Postgres instalado, otra API en 3000, etc). Cambialo en `.env` y
reinicia con `start-stack.ps1`.

Para identificar quien lo tiene de forma automatica:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\fix-ports.ps1
```

Esto lista cada puerto del stack, dice quien lo ocupa (PID + nombre del
proceso) y aclara si es Docker mismo o una app extranjera. Si quieres que
ofrezca matar el proceso intruso:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\fix-ports.ps1 -Kill
```

Alternativa manual:

```powershell
netstat -ano | Select-String ":5433"
```

### Docker Desktop apagado o no responde

`start-stack.ps1` lo detecta y aborta con un mensaje claro. Solucion:

1. Abre Docker Desktop y espera a que diga *Engine running*.
2. Vuelve a correr `scripts\doctor.ps1` para confirmar.

### Contenedor en loop "Restarting" o build con cache podrido

Cuando cambias el `Dockerfile` o `package.json` y el contenedor se queda
con la version vieja, o un servicio entra en `Restarting (1)` sin razon
clara, lo mas rapido es reset duro (conserva los datos):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\reset-stack.ps1
```

Esto baja todo, borra las imagenes propias del proyecto, hace
`docker system prune -f`, rebuild `--no-cache` y vuelve a levantar.

Si quieres ademas borrar la base (perder datos) y empezar 100% de cero:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\reset-stack.ps1 -HardReset
```

Despues hay que [reinicializar la base desde pgAdmin](#inicializar-la-base-desde-pgadmin).

### El `api` queda en "Restarting" y el frontend da "502 Bad Gateway"

El backend crashea durante el arranque (dentro de `onModuleInit`) y NestJS nunca
llega a escuchar, asi que Nginx no tiene a quien enrutar `/api` y responde `502`.

Diagnostica siempre con los logs:

```powershell
docker compose logs api --tail 60
```

Causas tipicas:

- **`null value in column "updatedAt" ... violates not-null constraint`**: la
  base tiene tablas viejas creadas por Prisma (sin default en `updatedAt`). El
  `schema.sql` ya fuerza el default con `ALTER TABLE` al arrancar, pero si tu
  imagen/codigo esta desactualizado, reconstruye (`up -d --build`) o empieza
  limpio con `down -v`.
- **`Cannot find module '/app/dist/.../main.js'`**: el `docker-entrypoint.sh`
  apunta a una ruta vieja. El entrypoint actual **busca** `main.js` dentro de
  `dist/`, asi que basta reconstruir la imagen del `api`.
- **`PostgreSQL no disponible (intento x/15)`**: la base tardo en levantar. El
  `api` reintenta solo; espera unos segundos.

Tras el fix, el seed ya **no tumba** el arranque: si algo falla en el seed, el
API arranca igual y veras `El seed fallo, el API arranca igualmente.` en logs.

### El frontend no conecta a la API

El bundle de produccion usa `environment.prod.ts` con `apiBaseUrl: '/api'`, y
Nginx (`frontend/nginx.conf`) hace proxy de `/api/` hacia `api:3000` dentro de
la red Docker. No depende del puerto del host.

1. Asegurate que `api` y `web` esten `Up` en `docker compose ps`.
2. Revisa los logs del web: `docker compose logs web --tail 30`.
3. Prueba el proxy directo:

   ```powershell
   curl.exe -s -o NUL -w "%{http_code}" http://localhost:4200/
   ```

   Si responde `000`, el contenedor `web` no esta arriba: rebuild con
   `docker compose --env-file .env up -d --build web` (o baja/sube todo).

### pgAdmin rechaza el email al loguearse

La validacion nueva de pgAdmin no acepta dominios reservados como `.local`.
Usa un dominio "real" (`.com`, `.dev`, etc.) en `PGADMIN_EMAIL` del `.env`.

### Quiero empezar todo de cero

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-all.ps1 -RemoveVolumes
powershell -ExecutionPolicy Bypass -File .\scripts\start-stack.ps1 -DbOnly
# vuelves a cargar los SQL y luego:
powershell -ExecutionPolicy Bypass -File .\scripts\start-stack.ps1
```

---

## Despliegue en servidor

Hay un compose y un script independientes en `deploy/`.

1. Copia `.env.example` a `.env` en el servidor y ajusta valores reales.
2. Da permisos al script:

   ```bash
   chmod +x deploy/update-main.sh
   ```

3. Despliega:

   ```bash
   ./deploy/update-main.sh
   ```

> En produccion puedes dejar `DB_AUTO_INIT=true` (es idempotente) y poner
> `DB_RUN_SEED=false` despues del primer arranque para no re-sembrar.

---

## Flujo de Git recomendado

`gitflow` ligero:

- `main`: produccion
- `develop`: integracion del equipo
- `feature/*`: nuevas funcionalidades
- `release/*`: preparacion de salida
- `hotfix/*`: ajustes urgentes

Flujo sugerido:

1. crear rama desde `develop`
2. abrir PR hacia `develop`
3. cuando el lote este listo, crear `release/*`
4. promover a `main`
5. desplegar con `./deploy/update-main.sh`

---

## Crecimiento natural

La plantilla queda preparada para sumar modulos de negocio sin rehacer la base:

- dashboard real
- auditoria
- inventario
- compras
- reportes
- trazabilidad operativa

Modulos ya incluidos:

- autenticacion
- perfil del usuario autenticado
- administracion de usuarios
- administracion de roles
- administracion de permisos
#   I n v e n T a r i o V i t a l 
 
 