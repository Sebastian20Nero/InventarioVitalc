import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';

interface PermisoRow {
  idPermiso: string;
  key: string;
  descripcion: string | null;
  activo: boolean;
}

interface RolConPermisos {
  idRol: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  permisos: { permiso: PermisoRow }[];
}

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
  ) {}

  private toBigInt(value: string, fieldName: string) {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${fieldName} invalido`);
    }
    return BigInt(value);
  }

  private serializeRole(role: RolConPermisos) {
    return {
      idRol: role.idRol.toString(),
      nombre: role.nombre,
      descripcion: role.descripcion,
      activo: role.activo,
      permisos:
        role.permisos?.map((item) => ({
          idPermiso: item.permiso.idPermiso.toString(),
          key: item.permiso.key,
          descripcion: item.permiso.descripcion,
          activo: item.permiso.activo,
        })) ?? [],
    };
  }

  private serializePermission(permission: PermisoRow) {
    return {
      idPermiso: permission.idPermiso.toString(),
      key: permission.key,
      descripcion: permission.descripcion,
      activo: permission.activo,
    };
  }

  async listUsers() {
    const users = await this.usersService.listarTodos();
    return users.map((user) => this.usersService.serializeUser(user));
  }

  async createUser(dto: CreateUserDto) {
    const correo = dto.correo.trim().toLowerCase();
    const existingPerson = await this.db.one('SELECT 1 FROM "Persona" WHERE "correo" = $1', [correo]);
    if (existingPerson) {
      throw new BadRequestException('El correo ya existe');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const roleIds = dto.roleIds?.map((roleId) => this.toBigInt(roleId, 'roleId')) ?? [];

    const idUsuario = await this.db.transaction(async (client) => {
      const persona = await this.db.one<{ idPersona: string }>(
        `INSERT INTO "Persona" ("nombres", "apellidos", "correo", "celular", "activo")
         VALUES ($1, $2, $3, $4, true) RETURNING "idPersona"`,
        [dto.nombres.trim(), dto.apellidos.trim(), correo, dto.celular?.trim() || null],
        client,
      );

      const usuario = await this.db.one<{ idUsuario: string }>(
        `INSERT INTO "Usuario" ("personaId", "passwordHash", "activo")
         VALUES ($1, $2, true) RETURNING "idUsuario"`,
        [persona!.idPersona, passwordHash],
        client,
      );

      for (const rolId of roleIds) {
        await this.db.query(
          `INSERT INTO "UsuarioRol" ("usuarioId", "rolId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [usuario!.idUsuario, rolId.toString()],
          client,
        );
      }

      return usuario!.idUsuario;
    });

    return this.usersService.serializeUser(await this.usersService.findById(idUsuario));
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    const idUsuario = this.toBigInt(id, 'idUsuario');
    const existing = await this.db.one<{ idUsuario: string; personaId: string; correo: string }>(
      `SELECT u."idUsuario", u."personaId", p."correo"
       FROM "Usuario" u JOIN "Persona" p ON p."idPersona" = u."personaId"
       WHERE u."idUsuario" = $1`,
      [idUsuario.toString()],
    );

    if (!existing) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const correo = dto.correo?.trim().toLowerCase();
    if (correo && correo !== existing.correo) {
      const duplicate = await this.db.one('SELECT 1 FROM "Persona" WHERE "correo" = $1', [correo]);
      if (duplicate) {
        throw new BadRequestException('El correo ya existe');
      }
    }

    const roleIds = dto.roleIds?.map((roleId) => this.toBigInt(roleId, 'roleId'));

    await this.db.transaction(async (client) => {
      const personaSets: string[] = [];
      const personaParams: unknown[] = [existing.personaId];
      let pi = 2;
      if (dto.nombres !== undefined) {
        personaSets.push(`"nombres" = $${pi++}`);
        personaParams.push(dto.nombres.trim());
      }
      if (dto.apellidos !== undefined) {
        personaSets.push(`"apellidos" = $${pi++}`);
        personaParams.push(dto.apellidos.trim());
      }
      if (correo !== undefined) {
        personaSets.push(`"correo" = $${pi++}`);
        personaParams.push(correo);
      }
      if (dto.celular !== undefined) {
        personaSets.push(`"celular" = $${pi++}`);
        personaParams.push(dto.celular.trim() || null);
      }
      if (personaSets.length) {
        personaSets.push('"updatedAt" = CURRENT_TIMESTAMP');
        await this.db.query(
          `UPDATE "Persona" SET ${personaSets.join(', ')} WHERE "idPersona" = $1`,
          personaParams,
          client,
        );
      }

      const usuarioSets: string[] = [];
      const usuarioParams: unknown[] = [idUsuario.toString()];
      let ui = 2;
      if (dto.password) {
        usuarioSets.push(`"passwordHash" = $${ui++}`);
        usuarioParams.push(await bcrypt.hash(dto.password, 10));
      }
      if (dto.activo !== undefined) {
        usuarioSets.push(`"activo" = $${ui++}`);
        usuarioParams.push(dto.activo);
      }
      if (usuarioSets.length) {
        usuarioSets.push('"updatedAt" = CURRENT_TIMESTAMP');
        await this.db.query(
          `UPDATE "Usuario" SET ${usuarioSets.join(', ')} WHERE "idUsuario" = $1`,
          usuarioParams,
          client,
        );
      }

      if (roleIds) {
        await this.db.query('DELETE FROM "UsuarioRol" WHERE "usuarioId" = $1', [idUsuario.toString()], client);
        for (const rolId of roleIds) {
          await this.db.query(
            `INSERT INTO "UsuarioRol" ("usuarioId", "rolId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [idUsuario.toString(), rolId.toString()],
            client,
          );
        }
      }
    });

    return this.usersService.serializeUser(await this.usersService.findById(idUsuario.toString()));
  }

  async deleteUser(id: string) {
    const idUsuario = this.toBigInt(id, 'idUsuario');
    const user = await this.db.one('SELECT 1 FROM "Usuario" WHERE "idUsuario" = $1', [
      idUsuario.toString(),
    ]);

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    await this.db.query(
      'UPDATE "Usuario" SET "activo" = false, "updatedAt" = CURRENT_TIMESTAMP WHERE "idUsuario" = $1',
      [idUsuario.toString()],
    );

    return { ok: true };
  }

  async setUserRoles(id: string, roleIds: string[]) {
    return this.updateUser(id, { roleIds });
  }

  async listRoles() {
    const roles = await this.cargarRoles();
    return roles.map((role) => this.serializeRole(role));
  }

  async createRole(dto: CreateRoleDto) {
    const inserted = await this.db.one<{ idRol: string }>(
      `INSERT INTO "Rol" ("nombre", "descripcion", "activo")
       VALUES ($1, $2, true) RETURNING "idRol"`,
      [dto.nombre.trim().toUpperCase(), dto.descripcion?.trim() || null],
    );
    return this.serializeRole((await this.cargarRol(BigInt(inserted!.idRol)))!);
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const idRol = this.toBigInt(id, 'idRol');
    const role = await this.db.one('SELECT 1 FROM "Rol" WHERE "idRol" = $1', [idRol.toString()]);

    if (!role) {
      throw new NotFoundException('Rol no encontrado');
    }

    await this.db.one(
      `UPDATE "Rol" SET
         "nombre" = COALESCE($2, "nombre"),
         "descripcion" = CASE WHEN $3::boolean THEN $4 ELSE "descripcion" END,
         "activo" = COALESCE($5, "activo"),
         "updatedAt" = CURRENT_TIMESTAMP
       WHERE "idRol" = $1`,
      [
        idRol.toString(),
        dto.nombre !== undefined ? dto.nombre.trim().toUpperCase() : null,
        dto.descripcion !== undefined,
        dto.descripcion !== undefined ? dto.descripcion.trim() || null : null,
        dto.activo !== undefined ? dto.activo : null,
      ],
    );

    return this.serializeRole((await this.cargarRol(idRol))!);
  }

  async deleteRole(id: string) {
    return this.updateRole(id, { activo: false });
  }

  async setRolePermissions(id: string, permissionIds: string[]) {
    const idRol = this.toBigInt(id, 'idRol');
    const role = await this.db.one('SELECT 1 FROM "Rol" WHERE "idRol" = $1', [idRol.toString()]);
    if (!role) {
      throw new NotFoundException('Rol no encontrado');
    }

    const permisoIds = permissionIds.map((permissionId) => this.toBigInt(permissionId, 'permissionId'));

    await this.db.transaction(async (client) => {
      await this.db.query('DELETE FROM "RolPermiso" WHERE "rolId" = $1', [idRol.toString()], client);
      for (const permisoId of permisoIds) {
        await this.db.query(
          `INSERT INTO "RolPermiso" ("rolId", "permisoId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [idRol.toString(), permisoId.toString()],
          client,
        );
      }
    });

    return this.serializeRole((await this.cargarRol(idRol))!);
  }

  async listPermissions() {
    const permissions = await this.db.query<PermisoRow>(
      'SELECT "idPermiso", "key", "descripcion", "activo" FROM "Permiso" ORDER BY "key" ASC',
    );
    return permissions.map((permission) => this.serializePermission(permission));
  }

  async createPermission(dto: CreatePermissionDto) {
    const permission = await this.db.one<PermisoRow>(
      `INSERT INTO "Permiso" ("key", "descripcion", "activo")
       VALUES ($1, $2, true)
       RETURNING "idPermiso", "key", "descripcion", "activo"`,
      [dto.key.trim().toUpperCase(), dto.descripcion?.trim() || null],
    );
    return this.serializePermission(permission!);
  }

  async updatePermission(id: string, dto: UpdatePermissionDto) {
    const idPermiso = this.toBigInt(id, 'idPermiso');
    const permission = await this.db.one('SELECT 1 FROM "Permiso" WHERE "idPermiso" = $1', [
      idPermiso.toString(),
    ]);

    if (!permission) {
      throw new NotFoundException('Permiso no encontrado');
    }

    const updated = await this.db.one<PermisoRow>(
      `UPDATE "Permiso" SET
         "key" = COALESCE($2, "key"),
         "descripcion" = CASE WHEN $3::boolean THEN $4 ELSE "descripcion" END,
         "activo" = COALESCE($5, "activo"),
         "updatedAt" = CURRENT_TIMESTAMP
       WHERE "idPermiso" = $1
       RETURNING "idPermiso", "key", "descripcion", "activo"`,
      [
        idPermiso.toString(),
        dto.key !== undefined ? dto.key.trim().toUpperCase() : null,
        dto.descripcion !== undefined,
        dto.descripcion !== undefined ? dto.descripcion.trim() || null : null,
        dto.activo !== undefined ? dto.activo : null,
      ],
    );

    return this.serializePermission(updated!);
  }

  async deletePermission(id: string) {
    return this.updatePermission(id, { activo: false });
  }

  private async cargarRol(idRol: bigint): Promise<RolConPermisos | null> {
    const role = await this.db.one<Omit<RolConPermisos, 'permisos'>>(
      'SELECT "idRol", "nombre", "descripcion", "activo" FROM "Rol" WHERE "idRol" = $1',
      [idRol.toString()],
    );
    if (!role) {
      return null;
    }
    const permisos = await this.cargarPermisosDeRoles([role.idRol]);
    return { ...role, permisos: permisos.get(role.idRol) ?? [] };
  }

  private async cargarRoles(): Promise<RolConPermisos[]> {
    const roles = await this.db.query<Omit<RolConPermisos, 'permisos'>>(
      'SELECT "idRol", "nombre", "descripcion", "activo" FROM "Rol" ORDER BY "nombre" ASC',
    );
    if (!roles.length) {
      return [];
    }
    const permisos = await this.cargarPermisosDeRoles(roles.map((r) => r.idRol));
    return roles.map((role) => ({ ...role, permisos: permisos.get(role.idRol) ?? [] }));
  }

  private async cargarPermisosDeRoles(
    rolIds: string[],
  ): Promise<Map<string, { permiso: PermisoRow }[]>> {
    const map = new Map<string, { permiso: PermisoRow }[]>();
    if (!rolIds.length) {
      return map;
    }
    const rows = await this.db.query<PermisoRow & { rolId: string }>(
      `SELECT rp."rolId", pm."idPermiso", pm."key", pm."descripcion", pm."activo"
       FROM "RolPermiso" rp
       JOIN "Permiso" pm ON pm."idPermiso" = rp."permisoId"
       WHERE rp."rolId" = ANY($1::bigint[])`,
      [rolIds],
    );
    for (const row of rows) {
      const lista = map.get(row.rolId) ?? [];
      lista.push({
        permiso: {
          idPermiso: row.idPermiso,
          key: row.key,
          descripcion: row.descripcion,
          activo: row.activo,
        },
      });
      map.set(row.rolId, lista);
    }
    return map;
  }
}
