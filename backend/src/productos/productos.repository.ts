import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { FilaMaestro } from './maestro-excel';

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
  codigoBarras: string | null;
  sku: string | null;
  estadoComercial: string | null;
  presentacion: string | null;
  contenido: string | null;
  sabor: string | null;
  registro: string | null;
  laboratorio: string | null;
  perfilProducto: string | null;
  familia: string | null;
  lista1: string | null;
  referencia: string | null;
  ultCosto: string | null;
  costoIva: string | null;
  precioMaquila: string | null;
  precioContado: string | null;
  precioCredito: string | null;
  precioComunidad: string | null;
  precioPrivado: string | null;
  precioPublico: string | null;
  observacion: string | null;
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

  enTransaccion<T>(fn: (client: PoolClient) => Promise<T>) {
    return this.db.transaction(fn);
  }

  clasificacionMaestro() {
    return Promise.all([
      this.db.one<{ idCategoria: string }>(
        `SELECT "idCategoria" FROM "CategoriaProducto" WHERE "nombre" = 'Insumos generales' AND "activo" = true`,
      ),
      this.db.one<{ idUnidad: string }>(
        `SELECT "idUnidad" FROM "UnidadMedida" WHERE "abreviatura" = 'UND' AND "activo" = true`,
      ),
    ]);
  }

  async aplicarMaestro(
    client: PoolClient,
    fila: FilaMaestro,
    categoriaId: string,
    unidadId: string,
    creadoPor: string,
  ) {
    const existe = await this.db.one<{ idProducto: string }>(
      `SELECT "idProducto" FROM "Producto" WHERE "codigoInterno" = $1`,
      [fila.codigo],
      client,
    );
    const textos = fila.textos;
    const precios = fila.precios;
    const valores = [
      fila.nombre,
      textos.codigoBarras,
      textos.sku,
      textos.estadoComercial,
      textos.presentacion,
      textos.contenido,
      textos.sabor,
      textos.registro,
      textos.laboratorio,
      textos.perfilProducto,
      textos.familia,
      precios.lista1,
      textos.referencia,
      precios.ultCosto,
      precios.costoIva,
      precios.precioMaquila,
      precios.precioContado,
      precios.precioCredito,
      precios.precioComunidad,
      precios.precioPrivado,
      precios.precioPublico,
      textos.observacion,
    ];
    if (existe) {
      await this.db.query(
        `UPDATE "Producto" SET
           "nombre" = $2,
           "codigoBarras" = $3, "sku" = $4, "estadoComercial" = $5, "presentacion" = $6,
           "contenido" = $7, "sabor" = $8, "registro" = $9, "laboratorio" = $10,
           "perfilProducto" = $11, "familia" = $12, "lista1" = $13, "referencia" = $14,
           "ultCosto" = $15, "costoIva" = $16, "precioMaquila" = $17, "precioContado" = $18,
           "precioCredito" = $19, "precioComunidad" = $20, "precioPrivado" = $21,
           "precioPublico" = $22, "observacion" = $23,
           "activo" = COALESCE($24, "activo"),
           "updatedAt" = CURRENT_TIMESTAMP
         WHERE "idProducto" = $1`,
        [existe.idProducto, ...valores, fila.activo],
        client,
      );
      return 'actualizado' as const;
    }
    await this.db.query(
      `INSERT INTO "Producto" (
         "codigoInterno", "nombre", "categoriaId", "unidadId", "stockMinimo", "activo", "creadoPor",
         "codigoBarras", "sku", "estadoComercial", "presentacion", "contenido", "sabor", "registro",
         "laboratorio", "perfilProducto", "familia", "lista1", "referencia", "ultCosto", "costoIva",
         "precioMaquila", "precioContado", "precioCredito", "precioComunidad", "precioPrivado",
         "precioPublico", "observacion"
       ) VALUES (
         $1, $2, $3, $4, 0, COALESCE($5, true), $6,
         $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
         $21, $22, $23, $24, $25, $26, $27
       )`,
      [fila.codigo, fila.nombre, categoriaId, unidadId, fila.activo, creadoPor, ...valores.slice(1)],
      client,
    );
    return 'creado' as const;
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
      codigoBarras: row.codigoBarras ?? null,
      sku: row.sku ?? null,
      estadoComercial: row.estadoComercial ?? null,
      presentacion: row.presentacion ?? null,
      contenido: row.contenido ?? null,
      sabor: row.sabor ?? null,
      registro: row.registro ?? null,
      laboratorio: row.laboratorio ?? null,
      perfilProducto: row.perfilProducto ?? null,
      familia: row.familia ?? null,
      lista1: row.lista1 ?? null,
      referencia: row.referencia ?? null,
      ultCosto: row.ultCosto ?? null,
      costoIva: row.costoIva ?? null,
      precioMaquila: row.precioMaquila ?? null,
      precioContado: row.precioContado ?? null,
      precioCredito: row.precioCredito ?? null,
      precioComunidad: row.precioComunidad ?? null,
      precioPrivado: row.precioPrivado ?? null,
      precioPublico: row.precioPublico ?? null,
      observacion: row.observacion ?? null,
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
