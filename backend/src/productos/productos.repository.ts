import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { DatabaseService } from '../database/database.service';

export interface ProductoCreateInput {
  codigoInterno: string;
  nombre: string;
  descripcion: string | null;
  categoriaId: bigint;
  unidadId: bigint;
  stockMinimo: Decimal;
  activo: boolean;
  creadoPor: bigint;
}

export interface ProductoUpdateInput {
  codigoInterno?: string;
  nombre?: string;
  descripcion?: string | null;
  categoriaId?: bigint;
  unidadId?: bigint;
  stockMinimo?: Decimal;
  activo?: boolean;
}

export interface ProductoConRelaciones {
  idProducto: string;
  codigoInterno: string;
  nombre: string;
  descripcion: string | null;
  categoriaId: string;
  unidadId: string;
  stockMinimo: string;
  activo: boolean;
  creadoPor: string;
  createdAt: Date;
  updatedAt: Date;
  categoria: { idCategoria: string; nombre: string; descripcion: string | null; activo: boolean };
  unidad: { idUnidad: string; nombre: string; abreviatura: string; activo: boolean };
  creador: { idUsuario: string; persona: { nombres: string; apellidos: string; correo: string } };
}

interface ProductoBase {
  idProducto: string;
  codigoInterno: string;
  nombre: string;
  descripcion: string | null;
  categoriaId: string;
  unidadId: string;
  stockMinimo: string;
  activo: boolean;
  creadoPor: string;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT_COMPLETO = `
  SELECT
    p.*,
    c."idCategoria" AS "cat_id", c."nombre" AS "cat_nombre", c."descripcion" AS "cat_desc", c."activo" AS "cat_activo",
    u."idUnidad" AS "uni_id", u."nombre" AS "uni_nombre", u."abreviatura" AS "uni_abrev", u."activo" AS "uni_activo",
    cu."idUsuario" AS "cre_id", per."nombres" AS "cre_nombres", per."apellidos" AS "cre_apellidos", per."correo" AS "cre_correo"
  FROM "Producto" p
  JOIN "CategoriaProducto" c ON c."idCategoria" = p."categoriaId"
  JOIN "UnidadMedida" u ON u."idUnidad" = p."unidadId"
  JOIN "Usuario" cu ON cu."idUsuario" = p."creadoPor"
  JOIN "Persona" per ON per."idPersona" = cu."personaId"
`;

@Injectable()
export class ProductosRepository {
  constructor(private readonly db: DatabaseService) {}

  async listar(): Promise<ProductoConRelaciones[]> {
    const rows = await this.db.query<any>(`${SELECT_COMPLETO} ORDER BY p."createdAt" DESC`);
    return rows.map((row) => this.mapProducto(row));
  }

  async buscarPorId(idProducto: bigint): Promise<ProductoConRelaciones | null> {
    const row = await this.db.one<any>(`${SELECT_COMPLETO} WHERE p."idProducto" = $1`, [
      idProducto.toString(),
    ]);
    return row ? this.mapProducto(row) : null;
  }

  buscarPorCodigoInterno(codigoInterno: string) {
    return this.db.one<ProductoBase>('SELECT * FROM "Producto" WHERE "codigoInterno" = $1', [
      codigoInterno,
    ]);
  }

  buscarCategoriaPorId(idCategoria: bigint) {
    return this.db.one<{ idCategoria: string; activo: boolean }>(
      'SELECT "idCategoria", "activo" FROM "CategoriaProducto" WHERE "idCategoria" = $1',
      [idCategoria.toString()],
    );
  }

  buscarUnidadPorId(idUnidad: bigint) {
    return this.db.one<{ idUnidad: string; activo: boolean }>(
      'SELECT "idUnidad", "activo" FROM "UnidadMedida" WHERE "idUnidad" = $1',
      [idUnidad.toString()],
    );
  }

  async crear(data: ProductoCreateInput): Promise<ProductoConRelaciones> {
    const inserted = await this.db.one<{ idProducto: string }>(
      `INSERT INTO "Producto"
         ("codigoInterno", "nombre", "descripcion", "categoriaId", "unidadId", "stockMinimo", "activo", "creadoPor")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING "idProducto"`,
      [
        data.codigoInterno,
        data.nombre,
        data.descripcion,
        data.categoriaId.toString(),
        data.unidadId.toString(),
        data.stockMinimo.toString(),
        data.activo,
        data.creadoPor.toString(),
      ],
    );
    return (await this.buscarPorId(BigInt(inserted!.idProducto)))!;
  }

  async actualizar(idProducto: bigint, data: ProductoUpdateInput): Promise<ProductoConRelaciones> {
    const sets: string[] = [];
    const params: unknown[] = [idProducto.toString()];
    let i = 2;

    const push = (column: string, value: unknown) => {
      sets.push(`"${column}" = $${i++}`);
      params.push(value);
    };

    if (data.codigoInterno !== undefined) push('codigoInterno', data.codigoInterno);
    if (data.nombre !== undefined) push('nombre', data.nombre);
    if (data.descripcion !== undefined) push('descripcion', data.descripcion);
    if (data.categoriaId !== undefined) push('categoriaId', data.categoriaId.toString());
    if (data.unidadId !== undefined) push('unidadId', data.unidadId.toString());
    if (data.stockMinimo !== undefined) push('stockMinimo', data.stockMinimo.toString());
    if (data.activo !== undefined) push('activo', data.activo);

    if (sets.length) {
      sets.push('"updatedAt" = CURRENT_TIMESTAMP');
      await this.db.query(
        `UPDATE "Producto" SET ${sets.join(', ')} WHERE "idProducto" = $1`,
        params,
      );
    }

    return (await this.buscarPorId(idProducto))!;
  }

  private mapProducto(row: any): ProductoConRelaciones {
    return {
      idProducto: row.idProducto,
      codigoInterno: row.codigoInterno,
      nombre: row.nombre,
      descripcion: row.descripcion,
      categoriaId: row.categoriaId,
      unidadId: row.unidadId,
      stockMinimo: row.stockMinimo,
      activo: row.activo,
      creadoPor: row.creadoPor,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      categoria: {
        idCategoria: row.cat_id,
        nombre: row.cat_nombre,
        descripcion: row.cat_desc,
        activo: row.cat_activo,
      },
      unidad: {
        idUnidad: row.uni_id,
        nombre: row.uni_nombre,
        abreviatura: row.uni_abrev,
        activo: row.uni_activo,
      },
      creador: {
        idUsuario: row.cre_id,
        persona: { nombres: row.cre_nombres, apellidos: row.cre_apellidos, correo: row.cre_correo },
      },
    };
  }
}
