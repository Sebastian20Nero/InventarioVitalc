import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface PermisoCompleto {
  idPermiso: string;
  key: string;
  descripcion: string | null;
  activo: boolean;
}

export interface RolCompleto {
  idRol: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  permisos: { permiso: PermisoCompleto }[];
}

export interface UsuarioCompleto {
  idUsuario: string;
  personaId: string;
  passwordHash: string;
  activo: boolean;
  persona: {
    idPersona: string;
    nombres: string;
    apellidos: string;
    correo: string;
    celular: string | null;
  };
  roles: { rol: RolCompleto }[];
}

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async findUsuarioByCorreo(correo: string): Promise<UsuarioCompleto | null> {
    const [usuario] = await this.cargarUsuarios({ correo });
    return usuario ?? null;
  }

  async getProfile(userId: string) {
    const user = await this.findById(userId);
    return this.serializeUser(user);
  }

  async getPermissions(userId: string) {
    const user = await this.findById(userId);
    const permissions = new Set<string>();

    for (const userRole of user.roles) {
      if (!userRole.rol.activo) continue;
      for (const rolePermission of userRole.rol.permisos) {
        if (rolePermission.permiso.activo) {
          permissions.add(rolePermission.permiso.key);
        }
      }
    }

    return Array.from(permissions).sort();
  }

  async findById(userId: string): Promise<UsuarioCompleto> {
    const [usuario] = await this.cargarUsuarios({ idUsuario: BigInt(userId) });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return usuario;
  }

  async listarTodos(): Promise<UsuarioCompleto[]> {
    return this.cargarUsuarios({});
  }

  serializeUser(user: UsuarioCompleto) {
    return {
      idUsuario: user.idUsuario.toString(),
      correo: user.persona.correo,
      nombres: user.persona.nombres,
      apellidos: user.persona.apellidos,
      celular: user.persona.celular,
      activo: user.activo,
      roles: user.roles
        .filter((item) => item.rol.activo)
        .map((item) => ({
          idRol: item.rol.idRol.toString(),
          nombre: item.rol.nombre,
          descripcion: item.rol.descripcion,
        })),
      permisos: Array.from(
        new Set(
          user.roles.flatMap((item) =>
            item.rol.activo
              ? item.rol.permisos.filter((rp) => rp.permiso.activo).map((rp) => rp.permiso.key)
              : [],
          ),
        ),
      ).sort(),
    };
  }

  private async cargarUsuarios(opts: {
    idUsuario?: bigint;
    correo?: string;
  }): Promise<UsuarioCompleto[]> {
    let where = '';
    const params: unknown[] = [];
    if (opts.idUsuario !== undefined) {
      where = 'WHERE u."idUsuario" = $1';
      params.push(opts.idUsuario.toString());
    } else if (opts.correo !== undefined) {
      where = 'WHERE p."correo" = $1';
      params.push(opts.correo);
    }

    const usuarios = await this.db.query<any>(
      `SELECT u."idUsuario", u."personaId", u."passwordHash", u."activo",
              p."idPersona" AS "p_id", p."nombres" AS "p_nombres", p."apellidos" AS "p_apellidos",
              p."correo" AS "p_correo", p."celular" AS "p_celular"
       FROM "Usuario" u
       JOIN "Persona" p ON p."idPersona" = u."personaId"
       ${where}
       ORDER BY u."createdAt" DESC`,
      params,
    );

    if (!usuarios.length) {
      return [];
    }

    const usuarioIds = usuarios.map((u) => u.idUsuario);

    const rolesRows = await this.db.query<any>(
      `SELECT ur."usuarioId", r."idRol", r."nombre", r."descripcion", r."activo"
       FROM "UsuarioRol" ur
       JOIN "Rol" r ON r."idRol" = ur."rolId"
       WHERE ur."usuarioId" = ANY($1::bigint[])`,
      [usuarioIds],
    );

    const rolIds = Array.from(new Set(rolesRows.map((r) => r.idRol)));
    const permisosRows = rolIds.length
      ? await this.db.query<any>(
          `SELECT rp."rolId", pm."idPermiso", pm."key", pm."descripcion", pm."activo"
           FROM "RolPermiso" rp
           JOIN "Permiso" pm ON pm."idPermiso" = rp."permisoId"
           WHERE rp."rolId" = ANY($1::bigint[])`,
          [rolIds],
        )
      : [];

    const permisosPorRol = new Map<string, { permiso: PermisoCompleto }[]>();
    for (const row of permisosRows) {
      const lista = permisosPorRol.get(row.rolId) ?? [];
      lista.push({
        permiso: {
          idPermiso: row.idPermiso,
          key: row.key,
          descripcion: row.descripcion,
          activo: row.activo,
        },
      });
      permisosPorRol.set(row.rolId, lista);
    }

    const rolesPorUsuario = new Map<string, { rol: RolCompleto }[]>();
    for (const row of rolesRows) {
      const lista = rolesPorUsuario.get(row.usuarioId) ?? [];
      lista.push({
        rol: {
          idRol: row.idRol,
          nombre: row.nombre,
          descripcion: row.descripcion,
          activo: row.activo,
          permisos: permisosPorRol.get(row.idRol) ?? [],
        },
      });
      rolesPorUsuario.set(row.usuarioId, lista);
    }

    return usuarios.map((u) => ({
      idUsuario: u.idUsuario,
      personaId: u.personaId,
      passwordHash: u.passwordHash,
      activo: u.activo,
      persona: {
        idPersona: u.p_id,
        nombres: u.p_nombres,
        apellidos: u.p_apellidos,
        correo: u.p_correo,
        celular: u.p_celular,
      },
      roles: rolesPorUsuario.get(u.idUsuario) ?? [],
    }));
  }
}
