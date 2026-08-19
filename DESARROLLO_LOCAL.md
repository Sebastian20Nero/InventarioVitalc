# 🛠️ Guía de Desarrollo Local — VitalcomeBase

## ¿Por qué esta guía?
Para evitar perder tiempo reconfigurando el entorno cada vez que se necesita probar cambios.
El modo de desarrollo local corre **solo la DB en Docker** y el backend + frontend directamente en la máquina.

---

## Arquitectura del proyecto

| Servicio   | En producción (Docker) | En desarrollo local |
|------------|----------------------|---------------------|
| Base datos | Docker `db` → puerto `5433` | Docker `db` → puerto `5433` |
| Backend    | Docker `api` → puerto `3001` | Local → puerto `3001` |
| Frontend   | Docker `web` → puerto `4200` | Local → puerto `4200` |

---

## Configuración crítica

### `backend/.env` — Variables obligatorias
```env
DATABASE_URL="postgresql://plantilla:plantilla@localhost:5433/plantilla_inicio"

PORT=3001                   # ⚠️ Debe ser PORT (no API_PORT), NestJS usa process.env.PORT
NODE_ENV=development
JWT_SECRET=47dc88b6ea9f301b80b82a5d890372b917f23f6c31de791793ebccb5b85f104b
CORS_ORIGINS=http://localhost:4200,http://127.0.0.1:4200
SWAGGER_ENABLED=true
DB_AUTO_INIT=true
DB_RUN_SEED=true

ADMIN_EMAIL=johanstian20@hotmail.com
ADMIN_PASSWORD=rmmr
ADMIN_NOMBRES=Johan Sebastian
ADMIN_APELLIDOS=Admin
ADMIN_CELULAR=3000000000
```

### `frontend/src/environments/environment.ts` — URL del API
```typescript
export const environment = {
  production: false,
  apiBaseUrl: 'http://127.0.0.1:3001',  // Apunta al backend local
};
```

---

## 🚀 Cómo levantar el entorno de desarrollo

### Paso 1 — Solo la DB en Docker
```powershell
# Desde E:\Propuestas desarrollo\VitalcomeBase
docker compose down        # Baja todo si había algo corriendo
docker compose up -d db    # Solo levanta la base de datos (puerto 5433)
```

### Paso 2 — Backend local (Terminal 1)
```powershell
cd backend
npm install        # Solo la primera vez o cuando cambien dependencias
npm run start:dev  # Hot-reload: se reinicia solo al guardar cambios
```
✅ Backend disponible en: `http://localhost:3001`  
📖 Swagger (docs): `http://localhost:3001/docs`

### Paso 3 — Frontend local (Terminal 2)
```powershell
cd frontend
npm install        # Solo la primera vez o cuando cambien dependencias
npm run start      # Hot-reload: se actualiza en el navegador al guardar
```
✅ Frontend disponible en: `http://localhost:4200`

---

## 🔄 Cómo actualizar al hacer cambios

### Si cambié código del **backend**:
- Con `npm run start:dev` el servidor **se reinicia automáticamente**. No hay que hacer nada.

### Si cambié código del **frontend**:
- Con `npm run start` el navegador **se actualiza automáticamente**. No hay que hacer nada.

### Si cambié el archivo `.env` del backend:
```powershell
# Detener el backend (Ctrl+C) y volver a correr:
npm run start:dev
```

### Si cambié el esquema de base de datos (Prisma):
```powershell
cd backend
npx prisma migrate dev      # Aplica migración
npx prisma generate         # Regenera el cliente
```

---

## 🐳 Cómo volver a producción (todo en Docker)

```powershell
# Desde E:\Propuestas desarrollo\VitalcomeBase

# 1. Compilar el frontend
cd frontend
npm run build
cd ..

# 2. Reconstruir y levantar todos los contenedores
docker compose build web api
docker compose up -d
```
✅ App disponible en: `http://localhost:4200`

---

## ❗ Errores frecuentes

| Error | Causa | Solución |
|-------|-------|----------|
| "No fue posible iniciar sesión" | Backend no corre o puerto incorrecto | Verificar que `PORT=3001` en `.env` y que `npm run start:dev` esté corriendo |
| `ECONNREFUSED 5433` | DB no está corriendo | `docker compose up -d db` |
| Frontend no encuentra el API | `apiBaseUrl` apunta a puerto incorrecto | Verificar `frontend/src/environments/environment.ts` → debe ser `http://127.0.0.1:3001` |
| `&&` no funciona en PowerShell | PowerShell usa `;` no `&&` | Usar `;` o correr comandos separados |
| Backend arranca en puerto 3000 en vez de 3001 | Variable mal nombrada en `.env` | Usar `PORT=3001`, **no** `API_PORT=3001` |
