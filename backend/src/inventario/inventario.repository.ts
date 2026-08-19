import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PoolClient } from 'pg';
import { DatabaseService, Queryable } from '../database/database.service';

export type Tx = PoolClient;

export interface MovimientoRaw {
  idMovimiento: string;
  consecutivo: string;
  productoId: string;
  bodegaId: string;
  tipoMovimiento: string;
  cantidad: string;
  stockAnterior: string;
  stockNuevo: string;
  observacion: string | null;
  estadoOperativo: string;
  estadoEmpalme: string;
  registradoPor: string;
  fechaRegistro: Date;
  anuladoPor: string | null;
  fechaAnulacion: Date | null;
  motivoAnulacion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MovimientoCreateData {
  consecutivo: string;
  productoId: bigint;
  bodegaId: bigint;
  tipoMovimiento: string;
  cantidad: Decimal;
  stockAnterior: Decimal;
  stockNuevo: Decimal;
  observacion: string | null;
  estadoOperativo: string;
  estadoEmpalme: string;
  registradoPor: bigint;
}

export interface StockConRelaciones {
  idStock: string;
  productoId: string;
  bodegaId: string;
  stockActual: string;
  fechaActualizacion: Date;
  producto: {
    idProducto: string;
    codigoInterno: string;
    nombre: string;
    stockMinimo: string;
    categoria: { idCategoria: string; nombre: string };
    unidad: { idUnidad: string; nombre: string; abreviatura: string };
  };
  bodega: { idBodega: string; nombre: string };
}

export interface MovimientoConRelaciones extends MovimientoRaw {
  producto: { idProducto: string; codigoInterno: string; nombre: string };
  bodega: { idBodega: string; nombre: string };
  registrador: { idUsuario: string; persona: { nombres: string; apellidos: string; correo: string } };
  anulador: { idUsuario: string; persona: { nombres: string; apellidos: string; correo: string } } | null;
}

const SELECT_STOCK = `
  SELECT
    s.*,
    pr."idProducto" AS "pr_id", pr."codigoInterno" AS "pr_codigo", pr."nombre" AS "pr_nombre", pr."stockMinimo" AS "pr_stockmin",
    c."idCategoria" AS "cat_id", c."nombre" AS "cat_nombre",
    u."idUnidad" AS "uni_id", u."nombre" AS "uni_nombre", u."abreviatura" AS "uni_abrev",
    b."idBodega" AS "b_id", b."nombre" AS "b_nombre"
  FROM "StockProductoBodega" s
  JOIN "Producto" pr ON pr."idProducto" = s."productoId"
  JOIN "CategoriaProducto" c ON c."idCategoria" = pr."categoriaId"
  JOIN "UnidadMedida" u ON u."idUnidad" = pr."unidadId"
  JOIN "Bodega" b ON b."idBodega" = s."bodegaId"
`;

const SELECT_MOVIMIENTO = `
  SELECT
    m.*,
    pr."idProducto" AS "pr_id", pr."codigoInterno" AS "pr_codigo", pr."nombre" AS "pr_nombre",
    b."idBodega" AS "b_id", b."nombre" AS "b_nombre",
    rg."idUsuario" AS "rg_id", rgp."nombres" AS "rg_nombres", rgp."apellidos" AS "rg_apellidos", rgp."correo" AS "rg_correo",
    an."idUsuario" AS "an_id", anp."nombres" AS "an_nombres", anp."apellidos" AS "an_apellidos", anp."correo" AS "an_correo"
  FROM "MovimientoInventario" m
  JOIN "Producto" pr ON pr."idProducto" = m."productoId"
  JOIN "Bodega" b ON b."idBodega" = m."bodegaId"
  JOIN "Usuario" rg ON rg."idUsuario" = m."registradoPor"
  JOIN "Persona" rgp ON rgp."idPersona" = rg."personaId"
  LEFT JOIN "Usuario" an ON an."idUsuario" = m."anuladoPor"
  LEFT JOIN "Persona" anp ON anp."idPersona" = an."personaId"
`;

@Injectable()
export class InventarioRepository {
  constructor(private readonly db: DatabaseService) {}

  async listarStock(): Promise<StockConRelaciones[]> {
    const rows = await this.db.query<any>(
      `${SELECT_STOCK} ORDER BY pr."nombre" ASC, b."nombre" ASC`,
    );
    return rows.map((row) => this.mapStock(row));
  }

  async buscarStock(productoId: bigint, bodegaId: bigint): Promise<StockConRelaciones | null> {
    const row = await this.db.one<any>(
      `${SELECT_STOCK} WHERE s."productoId" = $1 AND s."bodegaId" = $2`,
      [productoId.toString(), bodegaId.toString()],
    );
    return row ? this.mapStock(row) : null;
  }

  async listarMovimientos(): Promise<MovimientoConRelaciones[]> {
    const rows = await this.db.query<any>(
      `${SELECT_MOVIMIENTO} ORDER BY m."fechaRegistro" DESC`,
    );
    return rows.map((row) => this.mapMovimiento(row));
  }

  buscarMovimientoPorId(idMovimiento: bigint) {
    return this.buscarMovimientoCompleto(idMovimiento);
  }

  buscarProductoPorId(idProducto: bigint) {
    return this.db.one<{ idProducto: string; activo: boolean }>(
      'SELECT "idProducto", "activo" FROM "Producto" WHERE "idProducto" = $1',
      [idProducto.toString()],
    );
  }

  buscarProductoPorCodigo(codigoInterno: string) {
    return this.db.one<{ idProducto: string; codigoInterno: string; nombre: string; activo: boolean }>(
      'SELECT "idProducto", "codigoInterno", "nombre", "activo" FROM "Producto" WHERE LOWER("codigoInterno") = LOWER($1)',
      [codigoInterno.trim()],
    );
  }

  buscarBodegaPorId(idBodega: bigint) {
    return this.db.one<{ idBodega: string; activo: boolean }>(
      'SELECT "idBodega", "activo" FROM "Bodega" WHERE "idBodega" = $1',
      [idBodega.toString()],
    );
  }

  buscarBodegaPorNombre(nombre: string) {
    return this.db.one<{ idBodega: string; nombre: string; activo: boolean }>(
      'SELECT "idBodega", "nombre", "activo" FROM "Bodega" WHERE LOWER("nombre") = LOWER($1)',
      [nombre.trim()],
    );
  }

  registrarMovimientoTransaccional(
    productoId: bigint,
    bodegaId: bigint,
    dataFactory: (
      tx: Tx,
      stockActual: Decimal,
    ) => Promise<{ movimientoData: MovimientoCreateData; stockNuevo: Decimal }>,
  ) {
    return this.db.transaction(async (client) => {
      const stock = await this.db.one<{ idStock: string; stockActual: string }>(
        `INSERT INTO "StockProductoBodega" ("productoId", "bodegaId", "stockActual")
         VALUES ($1, $2, 0)
         ON CONFLICT ("productoId", "bodegaId")
         DO UPDATE SET "stockActual" = "StockProductoBodega"."stockActual"
         RETURNING "idStock", "stockActual"`,
        [productoId.toString(), bodegaId.toString()],
        client,
      );

      const { movimientoData, stockNuevo } = await dataFactory(client, new Decimal(stock!.stockActual));

      const movimiento = await this.db.one<{ idMovimiento: string }>(
        `INSERT INTO "MovimientoInventario"
           ("consecutivo", "productoId", "bodegaId", "tipoMovimiento", "cantidad", "stockAnterior",
            "stockNuevo", "observacion", "estadoOperativo", "estadoEmpalme", "registradoPor")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING "idMovimiento"`,
        [
          movimientoData.consecutivo,
          movimientoData.productoId.toString(),
          movimientoData.bodegaId.toString(),
          movimientoData.tipoMovimiento,
          movimientoData.cantidad.toString(),
          movimientoData.stockAnterior.toString(),
          movimientoData.stockNuevo.toString(),
          movimientoData.observacion,
          movimientoData.estadoOperativo,
          movimientoData.estadoEmpalme,
          movimientoData.registradoPor.toString(),
        ],
        client,
      );

      await this.db.query(
        `UPDATE "StockProductoBodega" SET "stockActual" = $1, "fechaActualizacion" = CURRENT_TIMESTAMP
         WHERE "idStock" = $2`,
        [stockNuevo.toString(), stock!.idStock],
        client,
      );

      return (await this.buscarMovimientoCompleto(BigInt(movimiento!.idMovimiento), client))!;
    });
  }

  anularMovimientoTransaccional(
    idMovimiento: bigint,
    dataFactory: (
      tx: Tx,
      movimiento: MovimientoRaw,
      stockActual: Decimal,
    ) => Promise<{ stockNuevo: Decimal; anuladoPor: bigint; motivoAnulacion: string }>,
  ) {
    return this.db.transaction(async (client) => {
      const movimiento = await this.db.one<MovimientoRaw>(
        'SELECT * FROM "MovimientoInventario" WHERE "idMovimiento" = $1',
        [idMovimiento.toString()],
        client,
      );

      if (!movimiento) {
        return null;
      }

      const stock = await this.db.one<{ idStock: string; stockActual: string }>(
        'SELECT "idStock", "stockActual" FROM "StockProductoBodega" WHERE "productoId" = $1 AND "bodegaId" = $2',
        [movimiento.productoId, movimiento.bodegaId],
        client,
      );

      const { stockNuevo, anuladoPor, motivoAnulacion } = await dataFactory(
        client,
        movimiento,
        new Decimal(stock?.stockActual ?? 0),
      );

      if (stock) {
        await this.db.query(
          `UPDATE "StockProductoBodega" SET "stockActual" = $1, "fechaActualizacion" = CURRENT_TIMESTAMP
           WHERE "idStock" = $2`,
          [stockNuevo.toString(), stock.idStock],
          client,
        );
      } else {
        await this.db.query(
          `INSERT INTO "StockProductoBodega" ("productoId", "bodegaId", "stockActual")
           VALUES ($1, $2, $3)`,
          [movimiento.productoId, movimiento.bodegaId, stockNuevo.toString()],
          client,
        );
      }

      await this.db.query(
        `UPDATE "MovimientoInventario" SET
           "estadoOperativo" = 'ANULADO',
           "anuladoPor" = $2,
           "fechaAnulacion" = CURRENT_TIMESTAMP,
           "motivoAnulacion" = $3,
           "updatedAt" = CURRENT_TIMESTAMP
         WHERE "idMovimiento" = $1`,
        [idMovimiento.toString(), anuladoPor.toString(), motivoAnulacion],
        client,
      );

      return (await this.buscarMovimientoCompleto(idMovimiento, client))!;
    });
  }

  async contarMovimientosDelAnio(tx: Tx, year: number): Promise<number> {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const row = await this.db.one<{ total: string }>(
      'SELECT COUNT(*)::bigint AS total FROM "MovimientoInventario" WHERE "fechaRegistro" >= $1 AND "fechaRegistro" < $2',
      [start, end],
      tx,
    );
    return row ? Number(row.total) : 0;
  }

  private async buscarMovimientoCompleto(
    idMovimiento: bigint,
    client?: Queryable,
  ): Promise<MovimientoConRelaciones | null> {
    const row = await this.db.one<any>(
      `${SELECT_MOVIMIENTO} WHERE m."idMovimiento" = $1`,
      [idMovimiento.toString()],
      client,
    );
    return row ? this.mapMovimiento(row) : null;
  }

  private mapStock(row: any): StockConRelaciones {
    return {
      idStock: row.idStock,
      productoId: row.productoId,
      bodegaId: row.bodegaId,
      stockActual: row.stockActual,
      fechaActualizacion: row.fechaActualizacion,
      producto: {
        idProducto: row.pr_id,
        codigoInterno: row.pr_codigo,
        nombre: row.pr_nombre,
        stockMinimo: row.pr_stockmin,
        categoria: { idCategoria: row.cat_id, nombre: row.cat_nombre },
        unidad: { idUnidad: row.uni_id, nombre: row.uni_nombre, abreviatura: row.uni_abrev },
      },
      bodega: { idBodega: row.b_id, nombre: row.b_nombre },
    };
  }

  private mapMovimiento(row: any): MovimientoConRelaciones {
    return {
      idMovimiento: row.idMovimiento,
      consecutivo: row.consecutivo,
      productoId: row.productoId,
      bodegaId: row.bodegaId,
      tipoMovimiento: row.tipoMovimiento,
      cantidad: row.cantidad,
      stockAnterior: row.stockAnterior,
      stockNuevo: row.stockNuevo,
      observacion: row.observacion,
      estadoOperativo: row.estadoOperativo,
      estadoEmpalme: row.estadoEmpalme,
      registradoPor: row.registradoPor,
      fechaRegistro: row.fechaRegistro,
      anuladoPor: row.anuladoPor,
      fechaAnulacion: row.fechaAnulacion,
      motivoAnulacion: row.motivoAnulacion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      producto: { idProducto: row.pr_id, codigoInterno: row.pr_codigo, nombre: row.pr_nombre },
      bodega: { idBodega: row.b_id, nombre: row.b_nombre },
      registrador: {
        idUsuario: row.rg_id,
        persona: { nombres: row.rg_nombres, apellidos: row.rg_apellidos, correo: row.rg_correo },
      },
      anulador: row.an_id
        ? {
            idUsuario: row.an_id,
            persona: { nombres: row.an_nombres, apellidos: row.an_apellidos, correo: row.an_correo },
          }
        : null,
    };
  }
}
