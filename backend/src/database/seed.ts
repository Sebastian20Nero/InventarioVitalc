import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { DatabaseService } from './database.service';

const logger = new Logger('Seed');

const ROLES = [
  { nombre: 'ADMIN', descripcion: 'Acceso completo al sistema' },
  { nombre: 'GESTOR', descripcion: 'Rol operativo con acceso de lectura y administracion limitada' },
  {
    nombre: 'GESTOR_INVENTARIO',
    descripcion: 'Registra productos, existencias iniciales, entradas, abastecimientos y salidas',
  },
  {
    nombre: 'EMPALME_DSNUBE',
    descripcion: 'Revisa movimientos, da visto bueno y marca informacion lista para DsNube',
  },
  { nombre: 'CONSULTA', descripcion: 'Solo lectura: consulta stock, movimientos y reportes' },
];

const PERMISSIONS = [
  { key: 'ADMIN_ACCESS', descripcion: 'Acceso total de administrador' },
  { key: 'USER_READ', descripcion: 'Consultar usuarios' },
  { key: 'USER_CREATE', descripcion: 'Crear usuarios' },
  { key: 'USER_UPDATE', descripcion: 'Editar usuarios' },
  { key: 'USER_DELETE', descripcion: 'Eliminar/inactivar usuarios' },
  { key: 'ROLE_READ', descripcion: 'Consultar roles' },
  { key: 'ROLE_CREATE', descripcion: 'Crear roles' },
  { key: 'ROLE_UPDATE', descripcion: 'Editar roles' },
  { key: 'ROLE_DELETE', descripcion: 'Eliminar roles' },
  { key: 'ROLE_ASSIGN', descripcion: 'Asignar roles a usuarios' },
  { key: 'PERMISSION_READ', descripcion: 'Consultar permisos' },
  { key: 'PERMISSION_CREATE', descripcion: 'Crear permisos' },
  { key: 'PERMISSION_UPDATE', descripcion: 'Editar permisos' },
  { key: 'PERMISSION_DELETE', descripcion: 'Eliminar permisos' },
  { key: 'PERMISSION_ASSIGN', descripcion: 'Asignar permisos a roles' },
  { key: 'USUARIO_ADMINISTRAR', descripcion: 'Gestion general de usuarios del sistema' },
  { key: 'PRODUCTO_CREAR', descripcion: 'Crear nuevos productos' },
  { key: 'PRODUCTO_EDITAR', descripcion: 'Editar informacion de productos existentes' },
  { key: 'PRODUCTO_CONSULTAR', descripcion: 'Consultar listado y detalle de productos' },
  { key: 'MOVIMIENTO_CREAR', descripcion: 'Registrar movimientos (entradas, salidas, etc.)' },
  { key: 'MOVIMIENTO_CONSULTAR', descripcion: 'Consultar historial de movimientos' },
  { key: 'MOVIMIENTO_ANULAR', descripcion: 'Anular un movimiento registrado' },
  { key: 'STOCK_CONSULTAR', descripcion: 'Consultar stock actual por producto y bodega' },
  { key: 'EMPALME_REVISAR', descripcion: 'Revisar movimientos pendientes de validacion' },
  { key: 'EMPALME_OBSERVAR', descripcion: 'Dejar observacion sobre un movimiento' },
  { key: 'EMPALME_MARCAR_LISTO', descripcion: 'Marcar movimiento como listo para DsNube' },
  { key: 'EMPALME_MARCAR_CARGADO', descripcion: 'Marcar movimiento como cargado/empalmado en DsNube' },
  { key: 'REPORTE_CONSULTAR', descripcion: 'Generar y consultar reportes de inventario' },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  GESTOR_INVENTARIO: [
    'PRODUCTO_CREAR',
    'PRODUCTO_EDITAR',
    'PRODUCTO_CONSULTAR',
    'MOVIMIENTO_CREAR',
    'MOVIMIENTO_CONSULTAR',
    'STOCK_CONSULTAR',
    'REPORTE_CONSULTAR',
  ],
  EMPALME_DSNUBE: [
    'PRODUCTO_CONSULTAR',
    'MOVIMIENTO_CONSULTAR',
    'STOCK_CONSULTAR',
    'EMPALME_REVISAR',
    'EMPALME_OBSERVAR',
    'EMPALME_MARCAR_LISTO',
    'EMPALME_MARCAR_CARGADO',
    'REPORTE_CONSULTAR',
  ],
  CONSULTA: ['PRODUCTO_CONSULTAR', 'MOVIMIENTO_CONSULTAR', 'STOCK_CONSULTAR', 'REPORTE_CONSULTAR'],
};

const CATEGORIAS = [
  { nombre: 'Papeleria', descripcion: 'Elementos de papeleria y oficina' },
  { nombre: 'Elementos de aseo', descripcion: 'Productos de limpieza e higiene' },
  { nombre: 'Tecnologia', descripcion: 'Equipos y accesorios tecnologicos' },
  { nombre: 'Elementos de proteccion', descripcion: 'EPP y elementos de seguridad' },
  { nombre: 'Insumos generales', descripcion: 'Insumos y materiales de uso general' },
];

const UNIDADES = [
  { nombre: 'Unidad', abreviatura: 'UND' },
  { nombre: 'Caja', abreviatura: 'CJ' },
  { nombre: 'Resma', abreviatura: 'RES' },
  { nombre: 'Litro', abreviatura: 'L' },
  { nombre: 'Kilogramo', abreviatura: 'KG' },
  { nombre: 'Paquete', abreviatura: 'PAQ' },
  { nombre: 'Metro', abreviatura: 'MT' },
  { nombre: 'Galon', abreviatura: 'GL' },
];

const BODEGAS = [
  { nombre: 'Bodega principal', descripcion: 'Bodega central de almacenamiento' },
  { nombre: 'Bodega administrativa', descripcion: 'Bodega para el area administrativa' },
  { nombre: 'Bodega de eventos', descripcion: 'Bodega para elementos de eventos' },
  { nombre: 'Bodega de respaldo', descripcion: 'Almacenamiento secundario de reserva' },
];

export async function runSeed(db: DatabaseService) {
  await seedSeguridad(db);
  await seedCatalogos(db);
  logger.log('Seed lista.');
}

async function seedSeguridad(db: DatabaseService) {
  for (const rol of ROLES) {
    await db.query(
      `INSERT INTO "Rol" ("nombre", "descripcion", "activo")
       VALUES ($1, $2, true)
       ON CONFLICT ("nombre") DO UPDATE SET "descripcion" = EXCLUDED."descripcion", "activo" = true`,
      [rol.nombre, rol.descripcion],
    );
  }

  for (const permiso of PERMISSIONS) {
    await db.query(
      `INSERT INTO "Permiso" ("key", "descripcion", "activo")
       VALUES ($1, $2, true)
       ON CONFLICT ("key") DO UPDATE SET "descripcion" = EXCLUDED."descripcion", "activo" = true`,
      [permiso.key, permiso.descripcion],
    );
  }

  // ADMIN recibe todos los permisos activos.
  await db.query(
    `INSERT INTO "RolPermiso" ("rolId", "permisoId")
     SELECT r."idRol", p."idPermiso"
     FROM "Rol" r CROSS JOIN "Permiso" p
     WHERE r."nombre" = 'ADMIN' AND p."activo" = true
     ON CONFLICT DO NOTHING`,
  );

  for (const [rolNombre, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    await db.query(
      `INSERT INTO "RolPermiso" ("rolId", "permisoId")
       SELECT r."idRol", p."idPermiso"
       FROM "Rol" r CROSS JOIN "Permiso" p
       WHERE r."nombre" = $1 AND p."key" = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [rolNombre, permissions],
    );
  }

  const email = (process.env.ADMIN_EMAIL || 'johanstian20@hotmail.com').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'rmmr';
  const nombres = process.env.ADMIN_NOMBRES || 'Johan Sebastian';
  const apellidos = process.env.ADMIN_APELLIDOS || 'Admin';
  const celular = process.env.ADMIN_CELULAR || '3000000000';

  const persona = await db.one<{ idPersona: string }>(
    `INSERT INTO "Persona" ("nombres", "apellidos", "correo", "celular", "activo")
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT ("correo") DO UPDATE SET
       "nombres" = EXCLUDED."nombres",
       "apellidos" = EXCLUDED."apellidos",
       "celular" = EXCLUDED."celular",
       "activo" = true
     RETURNING "idPersona"`,
    [nombres, apellidos, email, celular],
  );

  const passwordHash = await bcrypt.hash(password, 10);
  const usuario = await db.one<{ idUsuario: string }>(
    `INSERT INTO "Usuario" ("personaId", "passwordHash", "activo")
     VALUES ($1, $2, true)
     ON CONFLICT ("personaId") DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "activo" = true
     RETURNING "idUsuario"`,
    [persona!.idPersona, passwordHash],
  );

  await db.query(
    `INSERT INTO "UsuarioRol" ("usuarioId", "rolId")
     SELECT $1, r."idRol" FROM "Rol" r WHERE r."nombre" = 'ADMIN'
     ON CONFLICT DO NOTHING`,
    [usuario!.idUsuario],
  );

  logger.log(`Seed seguridad lista. Usuario admin: ${email}`);
}

async function seedCatalogos(db: DatabaseService) {
  for (const categoria of CATEGORIAS) {
    await db.query(
      `INSERT INTO "CategoriaProducto" ("nombre", "descripcion", "activo")
       VALUES ($1, $2, true)
       ON CONFLICT ("nombre") DO UPDATE SET "descripcion" = EXCLUDED."descripcion", "activo" = true`,
      [categoria.nombre, categoria.descripcion],
    );
  }

  for (const unidad of UNIDADES) {
    await db.query(
      `INSERT INTO "UnidadMedida" ("nombre", "abreviatura", "activo")
       VALUES ($1, $2, true)
       ON CONFLICT ("abreviatura") DO UPDATE SET "nombre" = EXCLUDED."nombre", "activo" = true`,
      [unidad.nombre, unidad.abreviatura],
    );
  }

  for (const bodega of BODEGAS) {
    await db.query(
      `INSERT INTO "Bodega" ("nombre", "descripcion", "activo")
       VALUES ($1, $2, true)
       ON CONFLICT ("nombre") DO UPDATE SET "descripcion" = EXCLUDED."descripcion", "activo" = true`,
      [bodega.nombre, bodega.descripcion],
    );
  }

  logger.log('Seed catalogos lista.');
}
