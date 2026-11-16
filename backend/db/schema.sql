-- Esquema completo VitalInventario (PostgreSQL) - SQL crudo, sin Prisma.
-- Idempotente: CREATE TABLE IF NOT EXISTS. En una BD ya creada no hace nada.

CREATE TABLE IF NOT EXISTS "Persona" (
  "idPersona" BIGSERIAL PRIMARY KEY,
  "nombres" TEXT NOT NULL,
  "apellidos" TEXT NOT NULL,
  "correo" TEXT NOT NULL,
  "celular" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Persona_correo_key" UNIQUE ("correo")
);

CREATE TABLE IF NOT EXISTS "Usuario" (
  "idUsuario" BIGSERIAL PRIMARY KEY,
  "personaId" BIGINT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Usuario_personaId_key" UNIQUE ("personaId"),
  CONSTRAINT "Usuario_personaId_fkey" FOREIGN KEY ("personaId")
    REFERENCES "Persona"("idPersona") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Rol" (
  "idRol" BIGSERIAL PRIMARY KEY,
  "nombre" TEXT NOT NULL,
  "descripcion" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Rol_nombre_key" UNIQUE ("nombre")
);

CREATE TABLE IF NOT EXISTS "Permiso" (
  "idPermiso" BIGSERIAL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "descripcion" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Permiso_key_key" UNIQUE ("key")
);

CREATE TABLE IF NOT EXISTS "UsuarioRol" (
  "usuarioId" BIGINT NOT NULL,
  "rolId" BIGINT NOT NULL,
  CONSTRAINT "UsuarioRol_pkey" PRIMARY KEY ("usuarioId", "rolId"),
  CONSTRAINT "UsuarioRol_usuarioId_fkey" FOREIGN KEY ("usuarioId")
    REFERENCES "Usuario"("idUsuario") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UsuarioRol_rolId_fkey" FOREIGN KEY ("rolId")
    REFERENCES "Rol"("idRol") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "RolPermiso" (
  "rolId" BIGINT NOT NULL,
  "permisoId" BIGINT NOT NULL,
  CONSTRAINT "RolPermiso_pkey" PRIMARY KEY ("rolId", "permisoId"),
  CONSTRAINT "RolPermiso_rolId_fkey" FOREIGN KEY ("rolId")
    REFERENCES "Rol"("idRol") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RolPermiso_permisoId_fkey" FOREIGN KEY ("permisoId")
    REFERENCES "Permiso"("idPermiso") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CategoriaProducto" (
  "idCategoria" BIGSERIAL PRIMARY KEY,
  "nombre" TEXT NOT NULL,
  "descripcion" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CategoriaProducto_nombre_key" UNIQUE ("nombre")
);

CREATE TABLE IF NOT EXISTS "UnidadMedida" (
  "idUnidad" BIGSERIAL PRIMARY KEY,
  "nombre" TEXT NOT NULL,
  "abreviatura" TEXT NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnidadMedida_abreviatura_key" UNIQUE ("abreviatura")
);

CREATE TABLE IF NOT EXISTS "Bodega" (
  "idBodega" BIGSERIAL PRIMARY KEY,
  "nombre" TEXT NOT NULL,
  "descripcion" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Bodega_nombre_key" UNIQUE ("nombre")
);

CREATE TABLE IF NOT EXISTS "Producto" (
  "idProducto" BIGSERIAL PRIMARY KEY,
  "codigoInterno" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "descripcion" TEXT,
  "categoriaId" BIGINT NOT NULL,
  "unidadId" BIGINT NOT NULL,
  "stockMinimo" NUMERIC(14, 4) NOT NULL DEFAULT 0,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creadoPor" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Producto_codigoInterno_key" UNIQUE ("codigoInterno"),
  CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId")
    REFERENCES "CategoriaProducto"("idCategoria") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Producto_unidadId_fkey" FOREIGN KEY ("unidadId")
    REFERENCES "UnidadMedida"("idUnidad") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Producto_creadoPor_fkey" FOREIGN KEY ("creadoPor")
    REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "StockProductoBodega" (
  "idStock" BIGSERIAL PRIMARY KEY,
  "productoId" BIGINT NOT NULL,
  "bodegaId" BIGINT NOT NULL,
  "stockActual" NUMERIC(14, 4) NOT NULL DEFAULT 0,
  "fechaActualizacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockProductoBodega_producto_bodega_key" UNIQUE ("productoId", "bodegaId"),
  CONSTRAINT "StockProductoBodega_productoId_fkey" FOREIGN KEY ("productoId")
    REFERENCES "Producto"("idProducto") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StockProductoBodega_bodegaId_fkey" FOREIGN KEY ("bodegaId")
    REFERENCES "Bodega"("idBodega") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "MovimientoInventario" (
  "idMovimiento" BIGSERIAL PRIMARY KEY,
  "consecutivo" TEXT NOT NULL,
  "productoId" BIGINT NOT NULL,
  "bodegaId" BIGINT NOT NULL,
  "tipoMovimiento" TEXT NOT NULL,
  "cantidad" NUMERIC(14, 4) NOT NULL,
  "stockAnterior" NUMERIC(14, 4) NOT NULL,
  "stockNuevo" NUMERIC(14, 4) NOT NULL,
  "observacion" TEXT,
  "estadoOperativo" TEXT NOT NULL DEFAULT 'ACTIVO',
  "estadoEmpalme" TEXT NOT NULL DEFAULT 'PENDIENTE_REVISION',
  "registradoPor" BIGINT NOT NULL,
  "fechaRegistro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "anuladoPor" BIGINT,
  "fechaAnulacion" TIMESTAMP(3),
  "motivoAnulacion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MovimientoInventario_productoId_fkey" FOREIGN KEY ("productoId")
    REFERENCES "Producto"("idProducto") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MovimientoInventario_bodegaId_fkey" FOREIGN KEY ("bodegaId")
    REFERENCES "Bodega"("idBodega") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MovimientoInventario_registradoPor_fkey" FOREIGN KEY ("registradoPor")
    REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MovimientoInventario_anuladoPor_fkey" FOREIGN KEY ("anuladoPor")
    REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "RevisionEmpalme" (
  "idRevision" BIGSERIAL PRIMARY KEY,
  "movimientoId" BIGINT NOT NULL,
  "usuarioId" BIGINT NOT NULL,
  "accion" TEXT NOT NULL,
  "observacion" TEXT,
  "fechaRevision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RevisionEmpalme_movimientoId_fkey" FOREIGN KEY ("movimientoId")
    REFERENCES "MovimientoInventario"("idMovimiento") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RevisionEmpalme_usuarioId_fkey" FOREIGN KEY ("usuarioId")
    REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "SoporteMovimiento" (
  "idSoporte" BIGSERIAL PRIMARY KEY,
  "movimientoId" BIGINT NOT NULL,
  "nombreArchivo" TEXT NOT NULL,
  "rutaArchivo" TEXT NOT NULL,
  "tipoArchivo" TEXT,
  "cargadoPor" BIGINT NOT NULL,
  "fechaCargue" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SoporteMovimiento_movimientoId_fkey" FOREIGN KEY ("movimientoId")
    REFERENCES "MovimientoInventario"("idMovimiento") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SoporteMovimiento_cargadoPor_fkey" FOREIGN KEY ("cargadoPor")
    REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ConfiguracionDsnube" (
  "idConfiguracion" BIGSERIAL PRIMARY KEY,
  "url" TEXT NOT NULL,
  "usuario" TEXT NOT NULL,
  "password" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Usuario_activo_idx" ON "Usuario"("activo");
CREATE INDEX IF NOT EXISTS "Rol_activo_idx" ON "Rol"("activo");
CREATE INDEX IF NOT EXISTS "Permiso_activo_idx" ON "Permiso"("activo");
CREATE INDEX IF NOT EXISTS "UsuarioRol_rolId_idx" ON "UsuarioRol"("rolId");
CREATE INDEX IF NOT EXISTS "RolPermiso_permisoId_idx" ON "RolPermiso"("permisoId");
CREATE INDEX IF NOT EXISTS "Producto_categoriaId_idx" ON "Producto"("categoriaId");
CREATE INDEX IF NOT EXISTS "Producto_unidadId_idx" ON "Producto"("unidadId");
CREATE INDEX IF NOT EXISTS "Producto_activo_idx" ON "Producto"("activo");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_productoId_idx" ON "MovimientoInventario"("productoId");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_bodegaId_idx" ON "MovimientoInventario"("bodegaId");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_registradoPor_idx" ON "MovimientoInventario"("registradoPor");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_estadoEmpalme_idx" ON "MovimientoInventario"("estadoEmpalme");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_estadoOperativo_idx" ON "MovimientoInventario"("estadoOperativo");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_fechaRegistro_idx" ON "MovimientoInventario"("fechaRegistro");
CREATE INDEX IF NOT EXISTS "RevisionEmpalme_movimientoId_idx" ON "RevisionEmpalme"("movimientoId");
CREATE INDEX IF NOT EXISTS "RevisionEmpalme_usuarioId_idx" ON "RevisionEmpalme"("usuarioId");

-- Compatibilidad con bases creadas antes por Prisma (que dejaba "updatedAt"
-- NOT NULL pero SIN default). Forzamos el default para que los INSERT que no
-- envian "updatedAt" no fallen. Es idempotente.
ALTER TABLE "Persona" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Usuario" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Rol" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Permiso" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CategoriaProducto" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "UnidadMedida" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Bodega" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Producto" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MovimientoInventario" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ConfiguracionDsnube" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Despacho DROPI. No mueve stock: el inventario oficial sigue en DsNube.
CREATE TABLE IF NOT EXISTS "TransportadoraDespacho" (
  "idTransportadora" BIGSERIAL PRIMARY KEY,
  "nombre" TEXT NOT NULL,
  "nombreDropi" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "orden" INTEGER NOT NULL,
  "prefijo" TEXT NOT NULL DEFAULT '',
  "activa" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "TransportadoraDespacho_nombre_key" UNIQUE ("nombre")
);

CREATE TABLE IF NOT EXISTS "CorteDespacho" (
  "idCorte" BIGSERIAL PRIMARY KEY,
  "fecha" DATE NOT NULL,
  "transportadoraId" BIGINT NOT NULL,
  "numero" INTEGER NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'abierto',
  "plataforma" TEXT NOT NULL DEFAULT 'DROPI',
  "auxiliar" TEXT,
  "placa" TEXT,
  "horaEntrega" TEXT,
  "motivoCierre" TEXT,
  "cargadoPor" BIGINT NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "anulado" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "CorteDespacho_unico" UNIQUE ("fecha", "transportadoraId", "numero"),
  CONSTRAINT "CorteDespacho_transportadora_fkey" FOREIGN KEY ("transportadoraId")
    REFERENCES "TransportadoraDespacho"("idTransportadora") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorteDespacho_cargadoPor_fkey" FOREIGN KEY ("cargadoPor")
    REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ArchivoDespacho" (
  "idArchivo" BIGSERIAL PRIMARY KEY,
  "corteId" BIGINT NOT NULL,
  "nombre" TEXT NOT NULL,
  "huella" TEXT NOT NULL,
  "paginas" INTEGER NOT NULL DEFAULT 0,
  "cargadoPor" BIGINT NOT NULL,
  "cargadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArchivoDespacho_huella_key" UNIQUE ("huella"),
  CONSTRAINT "ArchivoDespacho_corte_fkey" FOREIGN KEY ("corteId")
    REFERENCES "CorteDespacho"("idCorte") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ArchivoDespacho_cargadoPor_fkey" FOREIGN KEY ("cargadoPor")
    REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "GuiaDespacho" (
  "idGuia" BIGSERIAL PRIMARY KEY,
  "corteId" BIGINT NOT NULL,
  "numero" TEXT NOT NULL,
  "consecutivo" INTEGER,
  "ciudad" TEXT,
  "recaudo" TEXT,
  "tipo" TEXT,
  "textoRotulo" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'pendiente',
  "anulado" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "GuiaDespacho_corte_numero" UNIQUE ("corteId", "numero"),
  CONSTRAINT "GuiaDespacho_corte_fkey" FOREIGN KEY ("corteId")
    REFERENCES "CorteDespacho"("idCorte") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "EquivalenciaDropi" (
  "idEquivalencia" BIGSERIAL PRIMARY KEY,
  "skuDropi" TEXT NOT NULL,
  "idDropi" TEXT NOT NULL,
  "nombreDropi" TEXT NOT NULL,
  "productoId" BIGINT NOT NULL,
  CONSTRAINT "EquivalenciaDropi_clave" UNIQUE ("skuDropi", "idDropi"),
  CONSTRAINT "EquivalenciaDropi_producto_fkey" FOREIGN KEY ("productoId")
    REFERENCES "Producto"("idProducto") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AlistamientoDespacho" (
  "idAlistamiento" BIGSERIAL PRIMARY KEY,
  "corteId" BIGINT NOT NULL,
  "productoId" BIGINT NOT NULL,
  "cantidad" INTEGER NOT NULL,
  "revisado" BOOLEAN NOT NULL DEFAULT false,
  "embolsado" BOOLEAN NOT NULL DEFAULT false,
  "empacado" BOOLEAN NOT NULL DEFAULT false,
  "revisadoPor" BIGINT,
  "embolsadoPor" BIGINT,
  "empacadoPor" BIGINT,
  CONSTRAINT "AlistamientoDespacho_corte_producto" UNIQUE ("corteId", "productoId"),
  CONSTRAINT "AlistamientoDespacho_corte_fkey" FOREIGN KEY ("corteId")
    REFERENCES "CorteDespacho"("idCorte") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AlistamientoDespacho_producto_fkey" FOREIGN KEY ("productoId")
    REFERENCES "Producto"("idProducto") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AsignacionDespacho" (
  "corteId" BIGINT NOT NULL,
  "usuarioId" BIGINT NOT NULL,
  "anulado" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "AsignacionDespacho_pkey" PRIMARY KEY ("corteId", "usuarioId"),
  CONSTRAINT "AsignacionDespacho_corte_fkey" FOREIGN KEY ("corteId")
    REFERENCES "CorteDespacho"("idCorte") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AsignacionDespacho_usuario_fkey" FOREIGN KEY ("usuarioId")
    REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AuditoriaDespacho" (
  "idAuditoria" BIGSERIAL PRIMARY KEY,
  "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usuarioId" BIGINT,
  "accion" TEXT NOT NULL,
  "detalle" TEXT NOT NULL,
  "huellaAnterior" TEXT NOT NULL,
  "huella" TEXT NOT NULL,
  CONSTRAINT "AuditoriaDespacho_usuario_fkey" FOREIGN KEY ("usuarioId")
    REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "TransportadoraDespacho" ("nombre", "nombreDropi", "alias", "orden")
VALUES
  ('ENVIA', 'ENVIA', 'ENVIA', 1),
  ('DERROCHA', 'DERROCHA', 'DERROCHA', 2),
  ('INTER', 'INTERRAPIDISIMO', 'INTER', 3),
  ('JAM DRIVE', 'JAM DRIVE', 'JAM DRIVE', 4),
  ('TCC', 'TCC', 'TCC', 5),
  ('DOMINA', 'DOMINA', 'DOMINA', 6),
  ('99 MINUTOS', '99 MINUTOS', '99MINUTOS', 7),
  ('VELOCES', 'VELOCES', 'VELOCES', 8),
  ('COORDINADORA', 'COORDINADORA', 'COORDINADORA', 9)
ON CONFLICT ("nombre") DO NOTHING;

ALTER TABLE "CorteDespacho" ADD COLUMN IF NOT EXISTS "auxiliar" TEXT;
ALTER TABLE "CorteDespacho" ADD COLUMN IF NOT EXISTS "placa" TEXT;
ALTER TABLE "CorteDespacho" ADD COLUMN IF NOT EXISTS "horaEntrega" TEXT;
ALTER TABLE "CorteDespacho" ADD COLUMN IF NOT EXISTS "motivoCierre" TEXT;
ALTER TABLE "TransportadoraDespacho" ADD COLUMN IF NOT EXISTS "prefijo" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GuiaDespacho" ADD COLUMN IF NOT EXISTS "estado" TEXT NOT NULL DEFAULT 'pendiente';

CREATE TABLE IF NOT EXISTS "EscaneoDespacho" (
  "idEscaneo" BIGSERIAL PRIMARY KEY,
  "guiaId" BIGINT,
  "corteId" BIGINT NOT NULL,
  "codigoLeido" TEXT NOT NULL,
  "codigoNormalizado" TEXT NOT NULL,
  "resultado" TEXT NOT NULL,
  "usuarioId" BIGINT NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EscaneoDespacho_guia_fkey" FOREIGN KEY ("guiaId")
    REFERENCES "GuiaDespacho"("idGuia") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EscaneoDespacho_corte_fkey" FOREIGN KEY ("corteId")
    REFERENCES "CorteDespacho"("idCorte") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EscaneoDespacho_usuario_fkey" FOREIGN KEY ("usuarioId")
    REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "RepresadoDespacho" (
  "idRepresado" BIGSERIAL PRIMARY KEY,
  "guiaId" BIGINT NOT NULL,
  "motivo" TEXT NOT NULL,
  "responsableId" BIGINT NOT NULL,
  "corteReasignacionId" BIGINT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "anulado" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "RepresadoDespacho_guia_fkey" FOREIGN KEY ("guiaId")
    REFERENCES "GuiaDespacho"("idGuia") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RepresadoDespacho_responsable_fkey" FOREIGN KEY ("responsableId")
    REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RepresadoDespacho_destino_fkey" FOREIGN KEY ("corteReasignacionId")
    REFERENCES "CorteDespacho"("idCorte") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "codigoBarras" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "estadoComercial" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "presentacion" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "contenido" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "sabor" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "registro" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "laboratorio" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "perfilProducto" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "familia" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "lista1" NUMERIC(14, 4);
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "referencia" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "ultCosto" NUMERIC(14, 4);
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "costoIva" NUMERIC(14, 4);
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "precioMaquila" NUMERIC(14, 4);
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "precioContado" NUMERIC(14, 4);
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "precioCredito" NUMERIC(14, 4);
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "precioComunidad" NUMERIC(14, 4);
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "precioPrivado" NUMERIC(14, 4);
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "precioPublico" NUMERIC(14, 4);
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "observacion" TEXT;
