INSERT INTO "Rol" ("nombre", "descripcion", "activo", "createdAt", "updatedAt")
VALUES
  ('ADMIN', 'Acceso completo al sistema', true, NOW(), NOW()),
  ('GESTOR', 'Rol operativo con acceso de lectura y administracion limitada', true, NOW(), NOW())
ON CONFLICT ("nombre")
DO UPDATE SET
  "descripcion" = EXCLUDED."descripcion",
  "activo" = true,
  "updatedAt" = NOW();

INSERT INTO "Permiso" ("key", "descripcion", "activo", "createdAt", "updatedAt")
VALUES
  ('ADMIN_ACCESS', 'ADMIN_ACCESS', true, NOW(), NOW()),
  ('USER_READ', 'USER_READ', true, NOW(), NOW()),
  ('USER_CREATE', 'USER_CREATE', true, NOW(), NOW()),
  ('USER_UPDATE', 'USER_UPDATE', true, NOW(), NOW()),
  ('USER_DELETE', 'USER_DELETE', true, NOW(), NOW()),
  ('ROLE_READ', 'ROLE_READ', true, NOW(), NOW()),
  ('ROLE_CREATE', 'ROLE_CREATE', true, NOW(), NOW()),
  ('ROLE_UPDATE', 'ROLE_UPDATE', true, NOW(), NOW()),
  ('ROLE_DELETE', 'ROLE_DELETE', true, NOW(), NOW()),
  ('ROLE_ASSIGN', 'ROLE_ASSIGN', true, NOW(), NOW()),
  ('PERMISSION_READ', 'PERMISSION_READ', true, NOW(), NOW()),
  ('PERMISSION_CREATE', 'PERMISSION_CREATE', true, NOW(), NOW()),
  ('PERMISSION_UPDATE', 'PERMISSION_UPDATE', true, NOW(), NOW()),
  ('PERMISSION_DELETE', 'PERMISSION_DELETE', true, NOW(), NOW()),
  ('PERMISSION_ASSIGN', 'PERMISSION_ASSIGN', true, NOW(), NOW())
ON CONFLICT ("key")
DO UPDATE SET
  "descripcion" = EXCLUDED."descripcion",
  "activo" = true,
  "updatedAt" = NOW();

INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT r."idRol", p."idPermiso"
FROM "Rol" r
CROSS JOIN "Permiso" p
WHERE r."nombre" = 'ADMIN'
ON CONFLICT ("rolId", "permisoId") DO NOTHING;

INSERT INTO "Persona" ("nombres", "apellidos", "correo", "celular", "activo", "createdAt", "updatedAt")
VALUES
  ('Johan Sebastian', 'Admin', 'johanstian20@hotmail.com', '3000000000', true, NOW(), NOW())
ON CONFLICT ("correo")
DO UPDATE SET
  "nombres" = EXCLUDED."nombres",
  "apellidos" = EXCLUDED."apellidos",
  "celular" = EXCLUDED."celular",
  "activo" = true,
  "updatedAt" = NOW();

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
  "activo" = true,
  "updatedAt" = NOW();

INSERT INTO "UsuarioRol" ("usuarioId", "rolId")
SELECT u."idUsuario", r."idRol"
FROM "Usuario" u
JOIN "Persona" p ON p."idPersona" = u."personaId"
JOIN "Rol" r ON r."nombre" = 'ADMIN'
WHERE p."correo" = 'johanstian20@hotmail.com'
ON CONFLICT ("usuarioId", "rolId") DO NOTHING;
