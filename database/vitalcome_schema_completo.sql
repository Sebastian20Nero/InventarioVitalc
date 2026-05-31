-- =============================================================
-- vitalcome_schema_completo.sql
-- Script consolidado: tablas + seeds
-- Aplicación intermediaria de inventario - DsNube
-- Fecha: 2026-05-30
--
-- INSTRUCCIONES:
--   1. Conectarse a la base de datos destino.
--   2. Ejecutar este archivo completo en orden.
--   3. Es idempotente: se puede correr más de una vez sin romper datos.
-- =============================================================


-- =============================================================
-- BLOQUE 1: SEGURIDAD (Usuarios, Roles, Permisos)
-- =============================================================

-- -------------------------------------------------------------
-- Tabla: Persona
-- Datos personales separados del acceso al sistema
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Persona" (
  "idPersona"      BIGSERIAL PRIMARY KEY,
  "nombres"        TEXT        NOT NULL,
  "apellidos"      TEXT        NOT NULL,
  "correo"         TEXT        NOT NULL,
  "celular"        TEXT,
  "activo"         BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- Tabla: Usuario
-- Credenciales de acceso vinculadas a una Persona
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Usuario" (
  "idUsuario"      BIGSERIAL PRIMARY KEY,
  "personaId"      BIGINT      NOT NULL,
  "passwordHash"   TEXT        NOT NULL,
  "activo"         BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- Tabla: Rol
-- Roles del sistema (ADMIN, GESTOR_INVENTARIO, etc.)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Rol" (
  "idRol"          BIGSERIAL PRIMARY KEY,
  "nombre"         TEXT        NOT NULL,
  "descripcion"    TEXT,
  "activo"         BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- Tabla: Permiso
-- Permisos granulares por acción (PRODUCTO_CREAR, etc.)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Permiso" (
  "idPermiso"      BIGSERIAL PRIMARY KEY,
  "key"            TEXT        NOT NULL,
  "descripcion"    TEXT,
  "activo"         BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- Tabla: UsuarioRol
-- Relación N:M entre Usuario y Rol
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "UsuarioRol" (
  "usuarioId"      BIGINT NOT NULL,
  "rolId"          BIGINT NOT NULL,
  CONSTRAINT "UsuarioRol_pkey" PRIMARY KEY ("usuarioId", "rolId")
);

-- -------------------------------------------------------------
-- Tabla: RolPermiso
-- Relación N:M entre Rol y Permiso
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "RolPermiso" (
  "rolId"          BIGINT NOT NULL,
  "permisoId"      BIGINT NOT NULL,
  CONSTRAINT "RolPermiso_pkey" PRIMARY KEY ("rolId", "permisoId")
);


-- =============================================================
-- BLOQUE 2: CATÁLOGOS DE INVENTARIO
-- =============================================================

-- -------------------------------------------------------------
-- Tabla: CategoriaProducto
-- Clasificación de productos (Papelería, Aseo, Tecnología, etc.)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CategoriaProducto" (
  "idCategoria"    BIGSERIAL PRIMARY KEY,
  "nombre"         TEXT        NOT NULL,
  "descripcion"    TEXT,
  "activo"         BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- Tabla: UnidadMedida
-- Unidades en que se miden los productos (UND, CJ, RES, etc.)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "UnidadMedida" (
  "idUnidad"       BIGSERIAL PRIMARY KEY,
  "nombre"         TEXT        NOT NULL,
  "abreviatura"    TEXT        NOT NULL,
  "activo"         BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- Tabla: Bodega
-- Ubicaciones físicas del inventario
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Bodega" (
  "idBodega"       BIGSERIAL PRIMARY KEY,
  "nombre"         TEXT        NOT NULL,
  "descripcion"    TEXT,
  "activo"         BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =============================================================
-- BLOQUE 3: PRODUCTOS Y STOCK
-- =============================================================

-- -------------------------------------------------------------
-- Tabla: Producto
-- Catálogo principal de productos
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Producto" (
  "idProducto"     BIGSERIAL PRIMARY KEY,
  "codigoInterno"  TEXT        NOT NULL,
  "nombre"         TEXT        NOT NULL,
  "descripcion"    TEXT,
  "categoriaId"    BIGINT      NOT NULL,
  "unidadId"       BIGINT      NOT NULL,
  "stockMinimo"    NUMERIC(14,4) NOT NULL DEFAULT 0,
  "activo"         BOOLEAN     NOT NULL DEFAULT true,
  "creadoPor"      BIGINT      NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- Tabla: StockProductoBodega
-- Stock actual por producto y bodega (se actualiza con cada movimiento)
-- REGLA: un producto solo tiene UN registro de stock por bodega
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "StockProductoBodega" (
  "idStock"           BIGSERIAL PRIMARY KEY,
  "productoId"        BIGINT        NOT NULL,
  "bodegaId"          BIGINT        NOT NULL,
  "stockActual"       NUMERIC(14,4) NOT NULL DEFAULT 0,
  "fechaActualizacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockProductoBodega_producto_bodega_key" UNIQUE ("productoId", "bodegaId")
);


-- =============================================================
-- BLOQUE 4: MOVIMIENTOS E HISTORIAL
-- =============================================================

-- -------------------------------------------------------------
-- Tabla: MovimientoInventario
-- Tabla central: registra TODA operación de inventario
--
-- tipo_movimiento:   SALDO_INICIAL | ENTRADA | ABASTECIMIENTO |
--                    SALIDA | AJUSTE_POSITIVO | AJUSTE_NEGATIVO
--
-- estadoOperativo:   ACTIVO | ANULADO
--
-- estadoEmpalme:     PENDIENTE_REVISION | OBSERVADO |
--                    LISTO_DSNUBE | CARGADO_DSNUBE
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "MovimientoInventario" (
  "idMovimiento"      BIGSERIAL PRIMARY KEY,
  "consecutivo"       TEXT          NOT NULL,
  "productoId"        BIGINT        NOT NULL,
  "bodegaId"          BIGINT        NOT NULL,
  "tipoMovimiento"    TEXT          NOT NULL,
  "cantidad"          NUMERIC(14,4) NOT NULL,
  "stockAnterior"     NUMERIC(14,4) NOT NULL,
  "stockNuevo"        NUMERIC(14,4) NOT NULL,
  "observacion"       TEXT,
  "estadoOperativo"   TEXT          NOT NULL DEFAULT 'ACTIVO',
  "estadoEmpalme"     TEXT          NOT NULL DEFAULT 'PENDIENTE_REVISION',
  "registradoPor"     BIGINT        NOT NULL,
  "fechaRegistro"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "anuladoPor"        BIGINT,
  "fechaAnulacion"    TIMESTAMP(3),
  "motivoAnulacion"   TEXT,
  "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- Tabla: RevisionEmpalme
-- Historial de revisiones realizadas por el rol EMPALME_DSNUBE
--
-- accion:   REVISADO | OBSERVADO | LISTO_DSNUBE | CARGADO_DSNUBE
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "RevisionEmpalme" (
  "idRevision"        BIGSERIAL PRIMARY KEY,
  "movimientoId"      BIGINT        NOT NULL,
  "usuarioId"         BIGINT        NOT NULL,
  "accion"            TEXT          NOT NULL,
  "observacion"       TEXT,
  "fechaRevision"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- Tabla: SoporteMovimiento  (opcional, para adjuntar evidencias)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SoporteMovimiento" (
  "idSoporte"         BIGSERIAL PRIMARY KEY,
  "movimientoId"      BIGINT        NOT NULL,
  "nombreArchivo"     TEXT          NOT NULL,
  "rutaArchivo"       TEXT          NOT NULL,
  "tipoArchivo"       TEXT,
  "cargadoPor"        BIGINT        NOT NULL,
  "fechaCargue"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- Tabla: ConfiguracionDsnube
-- Parametros de conexion con DsNube
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ConfiguracionDsnube" (
  "idConfiguracion" BIGSERIAL PRIMARY KEY,
  "url"             TEXT         NOT NULL,
  "usuario"         TEXT         NOT NULL,
  "password"        TEXT,
  "activo"          BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =============================================================
-- BLOQUE 5: ÍNDICES
-- =============================================================

-- Seguridad
CREATE UNIQUE INDEX IF NOT EXISTS "Persona_correo_key"      ON "Persona"("correo");
CREATE UNIQUE INDEX IF NOT EXISTS "Usuario_personaId_key"   ON "Usuario"("personaId");
CREATE UNIQUE INDEX IF NOT EXISTS "Rol_nombre_key"          ON "Rol"("nombre");
CREATE UNIQUE INDEX IF NOT EXISTS "Permiso_key_key"         ON "Permiso"("key");

CREATE INDEX IF NOT EXISTS "Usuario_activo_idx"             ON "Usuario"("activo");
CREATE INDEX IF NOT EXISTS "Rol_activo_idx"                 ON "Rol"("activo");
CREATE INDEX IF NOT EXISTS "Permiso_activo_idx"             ON "Permiso"("activo");
CREATE INDEX IF NOT EXISTS "UsuarioRol_rolId_idx"           ON "UsuarioRol"("rolId");
CREATE INDEX IF NOT EXISTS "RolPermiso_permisoId_idx"       ON "RolPermiso"("permisoId");

-- Catálogos
CREATE UNIQUE INDEX IF NOT EXISTS "CategoriaProducto_nombre_key" ON "CategoriaProducto"("nombre");
CREATE UNIQUE INDEX IF NOT EXISTS "UnidadMedida_abreviatura_key" ON "UnidadMedida"("abreviatura");
CREATE UNIQUE INDEX IF NOT EXISTS "Bodega_nombre_key"            ON "Bodega"("nombre");

-- Producto
CREATE UNIQUE INDEX IF NOT EXISTS "Producto_codigoInterno_key"   ON "Producto"("codigoInterno");
CREATE INDEX IF NOT EXISTS "Producto_categoriaId_idx"            ON "Producto"("categoriaId");
CREATE INDEX IF NOT EXISTS "Producto_unidadId_idx"               ON "Producto"("unidadId");
CREATE INDEX IF NOT EXISTS "Producto_activo_idx"                 ON "Producto"("activo");

-- Movimientos
CREATE INDEX IF NOT EXISTS "MovimientoInventario_productoId_idx"      ON "MovimientoInventario"("productoId");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_bodegaId_idx"        ON "MovimientoInventario"("bodegaId");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_registradoPor_idx"   ON "MovimientoInventario"("registradoPor");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_estadoEmpalme_idx"   ON "MovimientoInventario"("estadoEmpalme");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_estadoOperativo_idx" ON "MovimientoInventario"("estadoOperativo");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_fechaRegistro_idx"   ON "MovimientoInventario"("fechaRegistro");

-- Revisión
CREATE INDEX IF NOT EXISTS "RevisionEmpalme_movimientoId_idx"  ON "RevisionEmpalme"("movimientoId");
CREATE INDEX IF NOT EXISTS "RevisionEmpalme_usuarioId_idx"     ON "RevisionEmpalme"("usuarioId");


-- =============================================================
-- BLOQUE 6: LLAVES FORÁNEAS
-- =============================================================

DO $$
BEGIN

  -- Usuario → Persona
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Usuario_personaId_fkey') THEN
    ALTER TABLE "Usuario"
      ADD CONSTRAINT "Usuario_personaId_fkey"
      FOREIGN KEY ("personaId") REFERENCES "Persona"("idPersona")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- UsuarioRol → Usuario
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UsuarioRol_usuarioId_fkey') THEN
    ALTER TABLE "UsuarioRol"
      ADD CONSTRAINT "UsuarioRol_usuarioId_fkey"
      FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("idUsuario")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- UsuarioRol → Rol
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UsuarioRol_rolId_fkey') THEN
    ALTER TABLE "UsuarioRol"
      ADD CONSTRAINT "UsuarioRol_rolId_fkey"
      FOREIGN KEY ("rolId") REFERENCES "Rol"("idRol")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- RolPermiso → Rol
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RolPermiso_rolId_fkey') THEN
    ALTER TABLE "RolPermiso"
      ADD CONSTRAINT "RolPermiso_rolId_fkey"
      FOREIGN KEY ("rolId") REFERENCES "Rol"("idRol")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- RolPermiso → Permiso
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RolPermiso_permisoId_fkey') THEN
    ALTER TABLE "RolPermiso"
      ADD CONSTRAINT "RolPermiso_permisoId_fkey"
      FOREIGN KEY ("permisoId") REFERENCES "Permiso"("idPermiso")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Producto → CategoriaProducto
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Producto_categoriaId_fkey') THEN
    ALTER TABLE "Producto"
      ADD CONSTRAINT "Producto_categoriaId_fkey"
      FOREIGN KEY ("categoriaId") REFERENCES "CategoriaProducto"("idCategoria")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- Producto → UnidadMedida
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Producto_unidadId_fkey') THEN
    ALTER TABLE "Producto"
      ADD CONSTRAINT "Producto_unidadId_fkey"
      FOREIGN KEY ("unidadId") REFERENCES "UnidadMedida"("idUnidad")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- Producto → Usuario (creador)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Producto_creadoPor_fkey') THEN
    ALTER TABLE "Producto"
      ADD CONSTRAINT "Producto_creadoPor_fkey"
      FOREIGN KEY ("creadoPor") REFERENCES "Usuario"("idUsuario")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- StockProductoBodega → Producto
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockProductoBodega_productoId_fkey') THEN
    ALTER TABLE "StockProductoBodega"
      ADD CONSTRAINT "StockProductoBodega_productoId_fkey"
      FOREIGN KEY ("productoId") REFERENCES "Producto"("idProducto")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- StockProductoBodega → Bodega
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockProductoBodega_bodegaId_fkey') THEN
    ALTER TABLE "StockProductoBodega"
      ADD CONSTRAINT "StockProductoBodega_bodegaId_fkey"
      FOREIGN KEY ("bodegaId") REFERENCES "Bodega"("idBodega")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- MovimientoInventario → Producto
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MovimientoInventario_productoId_fkey') THEN
    ALTER TABLE "MovimientoInventario"
      ADD CONSTRAINT "MovimientoInventario_productoId_fkey"
      FOREIGN KEY ("productoId") REFERENCES "Producto"("idProducto")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- MovimientoInventario → Bodega
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MovimientoInventario_bodegaId_fkey') THEN
    ALTER TABLE "MovimientoInventario"
      ADD CONSTRAINT "MovimientoInventario_bodegaId_fkey"
      FOREIGN KEY ("bodegaId") REFERENCES "Bodega"("idBodega")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- MovimientoInventario → Usuario (registrador)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MovimientoInventario_registradoPor_fkey') THEN
    ALTER TABLE "MovimientoInventario"
      ADD CONSTRAINT "MovimientoInventario_registradoPor_fkey"
      FOREIGN KEY ("registradoPor") REFERENCES "Usuario"("idUsuario")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- MovimientoInventario → Usuario (anulador, nullable)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MovimientoInventario_anuladoPor_fkey') THEN
    ALTER TABLE "MovimientoInventario"
      ADD CONSTRAINT "MovimientoInventario_anuladoPor_fkey"
      FOREIGN KEY ("anuladoPor") REFERENCES "Usuario"("idUsuario")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- RevisionEmpalme → MovimientoInventario
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RevisionEmpalme_movimientoId_fkey') THEN
    ALTER TABLE "RevisionEmpalme"
      ADD CONSTRAINT "RevisionEmpalme_movimientoId_fkey"
      FOREIGN KEY ("movimientoId") REFERENCES "MovimientoInventario"("idMovimiento")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- RevisionEmpalme → Usuario
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RevisionEmpalme_usuarioId_fkey') THEN
    ALTER TABLE "RevisionEmpalme"
      ADD CONSTRAINT "RevisionEmpalme_usuarioId_fkey"
      FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("idUsuario")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- SoporteMovimiento → MovimientoInventario
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SoporteMovimiento_movimientoId_fkey') THEN
    ALTER TABLE "SoporteMovimiento"
      ADD CONSTRAINT "SoporteMovimiento_movimientoId_fkey"
      FOREIGN KEY ("movimientoId") REFERENCES "MovimientoInventario"("idMovimiento")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- SoporteMovimiento → Usuario
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SoporteMovimiento_cargadoPor_fkey') THEN
    ALTER TABLE "SoporteMovimiento"
      ADD CONSTRAINT "SoporteMovimiento_cargadoPor_fkey"
      FOREIGN KEY ("cargadoPor") REFERENCES "Usuario"("idUsuario")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

END $$;


-- =============================================================
-- BLOQUE 7: SEED - ROLES
-- =============================================================

INSERT INTO "Rol" ("nombre", "descripcion", "activo", "createdAt", "updatedAt")
VALUES
  ('ADMIN',              'Acceso completo al sistema',                                                              true, NOW(), NOW()),
  ('GESTOR_INVENTARIO',  'Registra productos, existencias iniciales, entradas, abastecimientos y salidas',         true, NOW(), NOW()),
  ('EMPALME_DSNUBE',     'Revisa movimientos, da visto bueno y marca información lista para DsNube',               true, NOW(), NOW()),
  ('CONSULTA',           'Solo lectura: consulta stock, movimientos y reportes',                                   true, NOW(), NOW())
ON CONFLICT ("nombre")
DO UPDATE SET
  "descripcion" = EXCLUDED."descripcion",
  "activo"      = true,
  "updatedAt"   = NOW();


-- =============================================================
-- BLOQUE 8: SEED - PERMISOS
-- =============================================================

INSERT INTO "Permiso" ("key", "descripcion", "activo", "createdAt", "updatedAt")
VALUES
  -- Administración de usuarios
  ('ADMIN_ACCESS',              'Acceso total de administrador',                       true, NOW(), NOW()),
  ('USER_READ',                 'Consultar usuarios',                                  true, NOW(), NOW()),
  ('USER_CREATE',               'Crear usuarios',                                      true, NOW(), NOW()),
  ('USER_UPDATE',               'Editar usuarios',                                     true, NOW(), NOW()),
  ('USER_DELETE',               'Eliminar/inactivar usuarios',                         true, NOW(), NOW()),
  ('ROLE_READ',                 'Consultar roles',                                     true, NOW(), NOW()),
  ('ROLE_CREATE',               'Crear roles',                                         true, NOW(), NOW()),
  ('ROLE_UPDATE',               'Editar roles',                                        true, NOW(), NOW()),
  ('ROLE_DELETE',               'Eliminar roles',                                      true, NOW(), NOW()),
  ('ROLE_ASSIGN',               'Asignar roles a usuarios',                            true, NOW(), NOW()),
  ('PERMISSION_READ',           'Consultar permisos',                                  true, NOW(), NOW()),
  ('PERMISSION_CREATE',         'Crear permisos',                                      true, NOW(), NOW()),
  ('PERMISSION_UPDATE',         'Editar permisos',                                     true, NOW(), NOW()),
  ('PERMISSION_DELETE',         'Eliminar permisos',                                   true, NOW(), NOW()),
  ('PERMISSION_ASSIGN',         'Asignar permisos a roles',                            true, NOW(), NOW()),
  ('USUARIO_ADMINISTRAR',       'Gestión general de usuarios del sistema',             true, NOW(), NOW()),

  -- Productos
  ('PRODUCTO_CREAR',            'Crear nuevos productos',                              true, NOW(), NOW()),
  ('PRODUCTO_EDITAR',           'Editar información de productos existentes',          true, NOW(), NOW()),
  ('PRODUCTO_CONSULTAR',        'Consultar listado y detalle de productos',            true, NOW(), NOW()),

  -- Movimientos
  ('MOVIMIENTO_CREAR',          'Registrar movimientos (entradas, salidas, etc.)',     true, NOW(), NOW()),
  ('MOVIMIENTO_CONSULTAR',      'Consultar historial de movimientos',                  true, NOW(), NOW()),
  ('MOVIMIENTO_ANULAR',         'Anular un movimiento registrado',                     true, NOW(), NOW()),

  -- Stock
  ('STOCK_CONSULTAR',           'Consultar stock actual por producto y bodega',        true, NOW(), NOW()),

  -- Empalme
  ('EMPALME_REVISAR',           'Revisar movimientos pendientes de validación',        true, NOW(), NOW()),
  ('EMPALME_OBSERVAR',          'Dejar observación sobre un movimiento',               true, NOW(), NOW()),
  ('EMPALME_MARCAR_LISTO',      'Marcar movimiento como listo para DsNube',            true, NOW(), NOW()),
  ('EMPALME_MARCAR_CARGADO',    'Marcar movimiento como cargado/empalmado en DsNube', true, NOW(), NOW()),

  -- Reportes
  ('REPORTE_CONSULTAR',         'Generar y consultar reportes de inventario',          true, NOW(), NOW())

ON CONFLICT ("key")
DO UPDATE SET
  "descripcion" = EXCLUDED."descripcion",
  "activo"      = true,
  "updatedAt"   = NOW();


-- =============================================================
-- BLOQUE 9: SEED - ASIGNACIÓN PERMISOS POR ROL
-- =============================================================

-- ADMIN: todos los permisos
INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT r."idRol", p."idPermiso"
FROM "Rol" r
CROSS JOIN "Permiso" p
WHERE r."nombre" = 'ADMIN'
ON CONFLICT ("rolId", "permisoId") DO NOTHING;

-- GESTOR_INVENTARIO: opera inventario, sin empalme ni administración
INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT r."idRol", p."idPermiso"
FROM "Rol" r
JOIN "Permiso" p ON p."key" IN (
  'PRODUCTO_CREAR',
  'PRODUCTO_EDITAR',
  'PRODUCTO_CONSULTAR',
  'MOVIMIENTO_CREAR',
  'MOVIMIENTO_CONSULTAR',
  'STOCK_CONSULTAR',
  'REPORTE_CONSULTAR'
)
WHERE r."nombre" = 'GESTOR_INVENTARIO'
ON CONFLICT ("rolId", "permisoId") DO NOTHING;

-- EMPALME_DSNUBE: revisa y valida, no crea ni edita productos
INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT r."idRol", p."idPermiso"
FROM "Rol" r
JOIN "Permiso" p ON p."key" IN (
  'PRODUCTO_CONSULTAR',
  'MOVIMIENTO_CONSULTAR',
  'STOCK_CONSULTAR',
  'EMPALME_REVISAR',
  'EMPALME_OBSERVAR',
  'EMPALME_MARCAR_LISTO',
  'EMPALME_MARCAR_CARGADO',
  'REPORTE_CONSULTAR'
)
WHERE r."nombre" = 'EMPALME_DSNUBE'
ON CONFLICT ("rolId", "permisoId") DO NOTHING;

-- CONSULTA: solo lectura, sin escritura ni empalme
INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT r."idRol", p."idPermiso"
FROM "Rol" r
JOIN "Permiso" p ON p."key" IN (
  'PRODUCTO_CONSULTAR',
  'MOVIMIENTO_CONSULTAR',
  'STOCK_CONSULTAR',
  'REPORTE_CONSULTAR'
)
WHERE r."nombre" = 'CONSULTA'
ON CONFLICT ("rolId", "permisoId") DO NOTHING;


-- =============================================================
-- BLOQUE 10: SEED - CATÁLOGOS DE INVENTARIO
-- =============================================================

-- Categorías de producto
INSERT INTO "CategoriaProducto" ("nombre", "descripcion", "activo", "createdAt", "updatedAt")
VALUES
  ('Papelería',                 'Elementos de papelería y oficina',            true, NOW(), NOW()),
  ('Elementos de aseo',         'Productos de limpieza e higiene',             true, NOW(), NOW()),
  ('Tecnología',                'Equipos y accesorios tecnológicos',           true, NOW(), NOW()),
  ('Elementos de protección',   'EPP y elementos de seguridad',               true, NOW(), NOW()),
  ('Insumos generales',         'Insumos y materiales de uso general',        true, NOW(), NOW())
ON CONFLICT ("nombre") DO NOTHING;

-- Unidades de medida
INSERT INTO "UnidadMedida" ("nombre", "abreviatura", "activo", "createdAt", "updatedAt")
VALUES
  ('Unidad',       'UND',  true, NOW(), NOW()),
  ('Caja',         'CJ',   true, NOW(), NOW()),
  ('Resma',        'RES',  true, NOW(), NOW()),
  ('Litro',        'L',    true, NOW(), NOW()),
  ('Kilogramo',    'KG',   true, NOW(), NOW()),
  ('Paquete',      'PAQ',  true, NOW(), NOW()),
  ('Metro',        'MT',   true, NOW(), NOW()),
  ('Galón',        'GL',   true, NOW(), NOW())
ON CONFLICT ("abreviatura") DO NOTHING;

-- Bodegas
INSERT INTO "Bodega" ("nombre", "descripcion", "activo", "createdAt", "updatedAt")
VALUES
  ('Bodega principal',      'Bodega central de almacenamiento',         true, NOW(), NOW()),
  ('Bodega administrativa', 'Bodega para el área administrativa',       true, NOW(), NOW()),
  ('Bodega de eventos',     'Bodega para elementos de eventos',         true, NOW(), NOW()),
  ('Bodega de respaldo',    'Almacenamiento secundario de reserva',     true, NOW(), NOW())
ON CONFLICT ("nombre") DO NOTHING;


-- =============================================================
-- BLOQUE 11: SEED - USUARIO ADMINISTRADOR INICIAL
-- =============================================================

-- Persona del admin
INSERT INTO "Persona" ("nombres", "apellidos", "correo", "celular", "activo", "createdAt", "updatedAt")
VALUES
  ('Johan Sebastian', 'Admin', 'johanstian20@hotmail.com', '3000000000', true, NOW(), NOW())
ON CONFLICT ("correo")
DO UPDATE SET
  "nombres"    = EXCLUDED."nombres",
  "apellidos"  = EXCLUDED."apellidos",
  "celular"    = EXCLUDED."celular",
  "activo"     = true,
  "updatedAt"  = NOW();

-- Usuario del admin (password: se reemplaza por el hash real en producción)
INSERT INTO "Usuario" ("personaId", "passwordHash", "activo", "createdAt", "updatedAt")
SELECT
  p."idPersona",
  '$2b$10$ZHzOXXVMTn8DzeC5BjPFZOzOh9LHB/3WWux8EbO3eXiZlIkebDcLy',
  true,
  NOW(),
  NOW()
FROM "Persona" p
WHERE p."correo" = 'johanstian20@hotmail.com'
ON CONFLICT ("personaId")
DO UPDATE SET
  "passwordHash" = EXCLUDED."passwordHash",
  "activo"       = true,
  "updatedAt"    = NOW();

-- Asignar rol ADMIN al usuario inicial
INSERT INTO "UsuarioRol" ("usuarioId", "rolId")
SELECT u."idUsuario", r."idRol"
FROM "Usuario" u
JOIN "Persona" p ON p."idPersona" = u."personaId"
JOIN "Rol" r     ON r."nombre"    = 'ADMIN'
WHERE p."correo" = 'johanstian20@hotmail.com'
ON CONFLICT ("usuarioId", "rolId") DO NOTHING;
