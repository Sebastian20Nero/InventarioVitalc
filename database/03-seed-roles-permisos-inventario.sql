-- =============================================================
-- 03-seed-roles-permisos-inventario.sql
-- Complemento de roles y permisos para el módulo de inventario
-- Basado en: documento_logica_inventario_intermediario_dsnube_v2.txt
-- Ejecutar DESPUÉS de: 01-schema.sql y 02-seed-security.sql
-- =============================================================


-- -------------------------------------------------------------
-- 1. ROLES DEL SISTEMA
-- (ADMIN ya existe desde 02-seed-security.sql, se agregan los nuevos)
-- -------------------------------------------------------------

INSERT INTO "Rol" ("nombre", "descripcion", "activo", "createdAt", "updatedAt")
VALUES
  ('GESTOR_INVENTARIO',  'Registra productos, existencias iniciales, entradas, abastecimientos y salidas', true, NOW(), NOW()),
  ('EMPALME_DSNUBE',     'Revisa movimientos, da visto bueno y marca información lista para DsNube',        true, NOW(), NOW()),
  ('CONSULTA',           'Solo lectura: consulta stock, movimientos y reportes',                            true, NOW(), NOW())
ON CONFLICT ("nombre")
DO UPDATE SET
  "descripcion" = EXCLUDED."descripcion",
  "activo"      = true,
  "updatedAt"   = NOW();


-- -------------------------------------------------------------
-- 2. PERMISOS DEL MÓDULO DE INVENTARIO
-- -------------------------------------------------------------

INSERT INTO "Permiso" ("key", "descripcion", "activo", "createdAt", "updatedAt")
VALUES
  -- Productos
  ('PRODUCTO_CREAR',            'Crear nuevos productos',                              true, NOW(), NOW()),
  ('PRODUCTO_EDITAR',           'Editar información de productos existentes',          true, NOW(), NOW()),
  ('PRODUCTO_CONSULTAR',        'Consultar listado y detalle de productos',            true, NOW(), NOW()),

  -- Movimientos de inventario
  ('MOVIMIENTO_CREAR',          'Registrar movimientos (entradas, salidas, etc.)',     true, NOW(), NOW()),
  ('MOVIMIENTO_CONSULTAR',      'Consultar historial de movimientos',                  true, NOW(), NOW()),
  ('MOVIMIENTO_ANULAR',         'Anular un movimiento registrado',                     true, NOW(), NOW()),

  -- Stock
  ('STOCK_CONSULTAR',           'Consultar stock actual por producto y bodega',        true, NOW(), NOW()),

  -- Empalme con DsNube
  ('EMPALME_REVISAR',           'Revisar movimientos pendientes de validación',        true, NOW(), NOW()),
  ('EMPALME_OBSERVAR',          'Dejar observación sobre un movimiento',               true, NOW(), NOW()),
  ('EMPALME_MARCAR_LISTO',      'Marcar movimiento como listo para DsNube',            true, NOW(), NOW()),
  ('EMPALME_MARCAR_CARGADO',    'Marcar movimiento como cargado/empalmado en DsNube', true, NOW(), NOW()),

  -- Reportes
  ('REPORTE_CONSULTAR',         'Generar y consultar reportes de inventario',          true, NOW(), NOW()),

  -- Administración de usuarios (ya existen en 02, se agregan por si acaso)
  ('USUARIO_ADMINISTRAR',       'Crear, editar y activar/inactivar usuarios',         true, NOW(), NOW())

ON CONFLICT ("key")
DO UPDATE SET
  "descripcion" = EXCLUDED."descripcion",
  "activo"      = true,
  "updatedAt"   = NOW();


-- -------------------------------------------------------------
-- 3. ASIGNACIÓN DE PERMISOS POR ROL
-- -------------------------------------------------------------

-- ADMIN: todos los permisos (incluidos los de inventario nuevos)
INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT r."idRol", p."idPermiso"
FROM "Rol" r
CROSS JOIN "Permiso" p
WHERE r."nombre" = 'ADMIN'
ON CONFLICT ("rolId", "permisoId") DO NOTHING;


-- GESTOR_INVENTARIO: opera el inventario, sin capacidad de empalme ni administración
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


-- EMPALME_DSNUBE: solo revisa y valida, no crea ni edita productos
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


-- CONSULTA: solo lectura, sin ninguna acción de escritura o empalme
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
