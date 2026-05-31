CREATE TABLE IF NOT EXISTS "Persona" (
  "idPersona" BIGSERIAL PRIMARY KEY,
  "nombres" TEXT NOT NULL,
  "apellidos" TEXT NOT NULL,
  "correo" TEXT NOT NULL,
  "celular" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Usuario" (
  "idUsuario" BIGSERIAL PRIMARY KEY,
  "personaId" BIGINT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Rol" (
  "idRol" BIGSERIAL PRIMARY KEY,
  "nombre" TEXT NOT NULL,
  "descripcion" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Permiso" (
  "idPermiso" BIGSERIAL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "descripcion" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "UsuarioRol" (
  "usuarioId" BIGINT NOT NULL,
  "rolId" BIGINT NOT NULL,
  CONSTRAINT "UsuarioRol_pkey" PRIMARY KEY ("usuarioId", "rolId")
);

CREATE TABLE IF NOT EXISTS "RolPermiso" (
  "rolId" BIGINT NOT NULL,
  "permisoId" BIGINT NOT NULL,
  CONSTRAINT "RolPermiso_pkey" PRIMARY KEY ("rolId", "permisoId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Persona_correo_key" ON "Persona"("correo");
CREATE UNIQUE INDEX IF NOT EXISTS "Usuario_personaId_key" ON "Usuario"("personaId");
CREATE UNIQUE INDEX IF NOT EXISTS "Rol_nombre_key" ON "Rol"("nombre");
CREATE UNIQUE INDEX IF NOT EXISTS "Permiso_key_key" ON "Permiso"("key");

CREATE INDEX IF NOT EXISTS "Usuario_activo_idx" ON "Usuario"("activo");
CREATE INDEX IF NOT EXISTS "Rol_activo_idx" ON "Rol"("activo");
CREATE INDEX IF NOT EXISTS "Permiso_activo_idx" ON "Permiso"("activo");
CREATE INDEX IF NOT EXISTS "UsuarioRol_rolId_idx" ON "UsuarioRol"("rolId");
CREATE INDEX IF NOT EXISTS "RolPermiso_permisoId_idx" ON "RolPermiso"("permisoId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Usuario_personaId_fkey'
  ) THEN
    ALTER TABLE "Usuario"
      ADD CONSTRAINT "Usuario_personaId_fkey"
      FOREIGN KEY ("personaId")
      REFERENCES "Persona"("idPersona")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'UsuarioRol_usuarioId_fkey'
  ) THEN
    ALTER TABLE "UsuarioRol"
      ADD CONSTRAINT "UsuarioRol_usuarioId_fkey"
      FOREIGN KEY ("usuarioId")
      REFERENCES "Usuario"("idUsuario")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'UsuarioRol_rolId_fkey'
  ) THEN
    ALTER TABLE "UsuarioRol"
      ADD CONSTRAINT "UsuarioRol_rolId_fkey"
      FOREIGN KEY ("rolId")
      REFERENCES "Rol"("idRol")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'RolPermiso_rolId_fkey'
  ) THEN
    ALTER TABLE "RolPermiso"
      ADD CONSTRAINT "RolPermiso_rolId_fkey"
      FOREIGN KEY ("rolId")
      REFERENCES "Rol"("idRol")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'RolPermiso_permisoId_fkey'
  ) THEN
    ALTER TABLE "RolPermiso"
      ADD CONSTRAINT "RolPermiso_permisoId_fkey"
      FOREIGN KEY ("permisoId")
      REFERENCES "Permiso"("idPermiso")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
