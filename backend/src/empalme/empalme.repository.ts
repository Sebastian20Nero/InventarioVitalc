import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService, Queryable } from '../database/database.service';

export type Tx = PoolClient;

interface MovimientoRaw {
  idMovimiento: string;
  estadoOperativo: string;
  estadoEmpalme: string;
}

export interface RevisionConUsuario {
  idRevision: string;
  accion: string;
  observacion: string | null;
  fechaRevision: Date;
  usuario: { idUsuario: string; persona: { nombres: string; apellidos: string; correo: string } };
}

export interface MovimientoEmpalme {
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
  fechaRegistro: Date;
  producto: {
    idProducto: string;
    codigoInterno: string;
    nombre: string;
    categoria: { nombre: string };
    unidad: { abreviatura: string };
  };
  bodega: { idBodega: string; nombre: string };
  registrador: { idUsuario: string; persona: { nombres: string; apellidos: string; correo: string } };
  revisiones: RevisionConUsuario[];
}

export interface ConfiguracionRow {
  idConfiguracion: string;
  url: string;
  usuario: string;
  password: string | null;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT_MOVIMIENTO = `
  SELECT
    m."idMovimiento", m."consecutivo", m."productoId", m."bodegaId", m."tipoMovimiento",
    m."cantidad", m."stockAnterior", m."stockNuevo", m."observacion", m."estadoOperativo",
    m."estadoEmpalme", m."fechaRegistro",
    pr."idProducto" AS "pr_id", pr."codigoInterno" AS "pr_codigo", pr."nombre" AS "pr_nombre",
    c."nombre" AS "cat_nombre", u."abreviatura" AS "uni_abrev",
    b."idBodega" AS "b_id", b."nombre" AS "b_nombre",
    rg."idUsuario" AS "rg_id", rgp."nombres" AS "rg_nombres", rgp."apellidos" AS "rg_apellidos", rgp."correo" AS "rg_correo"
  FROM "MovimientoInventario" m
  JOIN "Producto" pr ON pr."idProducto" = m."productoId"
  JOIN "CategoriaProducto" c ON c."idCategoria" = pr."categoriaId"
  JOIN "UnidadMedida" u ON u."idUnidad" = pr."unidadId"
  JOIN "Bodega" b ON b."idBodega" = m."bodegaId"
  JOIN "Usuario" rg ON rg."idUsuario" = m."registradoPor"
  JOIN "Persona" rgp ON rgp."idPersona" = rg."personaId"
`;

@Injectable()
export class EmpalmeRepository {
  constructor(private readonly db: DatabaseService) {}

  async listarMovimientos(): Promise<MovimientoEmpalme[]> {
    const rows = await this.db.query<any>(`${SELECT_MOVIMIENTO} ORDER BY m."fechaRegistro" DESC`);
    return this.adjuntarRevisiones(rows.map((row) => this.mapMovimiento(row)));
  }

  async buscarMovimiento(idMovimiento: bigint): Promise<MovimientoEmpalme | null> {
    return this.buscarMovimientoCompleto(idMovimiento);
  }

  async buscarMovimientosPorConsecutivos(consecutivos: string[]): Promise<MovimientoEmpalme[]> {
    const rows = await this.db.query<any>(`${SELECT_MOVIMIENTO} WHERE m."consecutivo" = ANY($1::text[])`, [
      consecutivos,
    ]);
    return this.adjuntarRevisiones(rows.map((row) => this.mapMovimiento(row)));
  }

  ejecutarAccion(
    idMovimiento: bigint,
    dataFactory: (
      tx: Tx,
      movimiento: MovimientoRaw,
    ) => Promise<{ usuarioId: bigint; accion: string; estadoEmpalme: string; observacion: string | null }>,
  ) {
    return this.db.transaction(async (client) => {
      const movimiento = await this.db.one<MovimientoRaw>(
        'SELECT "idMovimiento", "estadoOperativo", "estadoEmpalme" FROM "MovimientoInventario" WHERE "idMovimiento" = $1',
        [idMovimiento.toString()],
        client,
      );

      if (!movimiento) {
        return null;
      }

      const accion = await dataFactory(client, movimiento);

      await this.db.query(
        `INSERT INTO "RevisionEmpalme" ("movimientoId", "usuarioId", "accion", "observacion")
         VALUES ($1, $2, $3, $4)`,
        [idMovimiento.toString(), accion.usuarioId.toString(), accion.accion, accion.observacion],
        client,
      );

      await this.db.query(
        `UPDATE "MovimientoInventario" SET "estadoEmpalme" = $2, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "idMovimiento" = $1`,
        [idMovimiento.toString(), accion.estadoEmpalme],
        client,
      );

      return (await this.buscarMovimientoCompleto(idMovimiento, client))!;
    });
  }

  obtenerConfiguracion() {
    return this.db.one<ConfiguracionRow>(
      'SELECT * FROM "ConfiguracionDsnube" ORDER BY "idConfiguracion" DESC LIMIT 1',
    );
  }

  async guardarConfiguracion(data: {
    url: string;
    usuario: string;
    password: string | null;
    activo: boolean;
  }): Promise<ConfiguracionRow> {
    const row = await this.db.one<ConfiguracionRow>(
      `INSERT INTO "ConfiguracionDsnube" ("url", "usuario", "password", "activo")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.url, data.usuario, data.password, data.activo],
    );
    return row!;
  }

  marcarCargadoEnLote(consecutivos: string[], usuarioId: bigint) {
    return this.db.transaction(async (client) => {
      const movimientos = await this.db.query<{ idMovimiento: string; estadoOperativo: string }>(
        'SELECT "idMovimiento", "estadoOperativo" FROM "MovimientoInventario" WHERE "consecutivo" = ANY($1::text[])',
        [consecutivos],
        client,
      );

      for (const movimiento of movimientos) {
        if (movimiento.estadoOperativo === 'ANULADO') {
          continue;
        }

        await this.db.query(
          `INSERT INTO "RevisionEmpalme" ("movimientoId", "usuarioId", "accion", "observacion")
           VALUES ($1, $2, 'CARGADO_DSNUBE', 'Importacion masiva desde Excel')`,
          [movimiento.idMovimiento, usuarioId.toString()],
          client,
        );

        await this.db.query(
          `UPDATE "MovimientoInventario" SET "estadoEmpalme" = 'CARGADO_DSNUBE', "updatedAt" = CURRENT_TIMESTAMP
           WHERE "idMovimiento" = $1`,
          [movimiento.idMovimiento],
          client,
        );
      }

      const rows = await this.db.query<any>(
        `${SELECT_MOVIMIENTO} WHERE m."consecutivo" = ANY($1::text[])`,
        [consecutivos],
        client,
      );
      return this.adjuntarRevisiones(rows.map((row) => this.mapMovimiento(row)), client);
    });
  }

  private async buscarMovimientoCompleto(
    idMovimiento: bigint,
    client?: Queryable,
  ): Promise<MovimientoEmpalme | null> {
    const row = await this.db.one<any>(`${SELECT_MOVIMIENTO} WHERE m."idMovimiento" = $1`, [
      idMovimiento.toString(),
    ], client);
    if (!row) {
      return null;
    }
    const [movimiento] = await this.adjuntarRevisiones([this.mapMovimiento(row)], client);
    return movimiento;
  }

  private async adjuntarRevisiones(
    movimientos: MovimientoEmpalme[],
    client?: Queryable,
  ): Promise<MovimientoEmpalme[]> {
    if (!movimientos.length) {
      return movimientos;
    }

    const ids = movimientos.map((m) => m.idMovimiento);
    const revisiones = await this.db.query<any>(
      `SELECT
         r."idRevision", r."movimientoId", r."accion", r."observacion", r."fechaRevision",
         us."idUsuario" AS "us_id", usp."nombres" AS "us_nombres", usp."apellidos" AS "us_apellidos", usp."correo" AS "us_correo"
       FROM "RevisionEmpalme" r
       JOIN "Usuario" us ON us."idUsuario" = r."usuarioId"
       JOIN "Persona" usp ON usp."idPersona" = us."personaId"
       WHERE r."movimientoId" = ANY($1::bigint[])
       ORDER BY r."fechaRevision" DESC`,
      [ids],
      client,
    );

    const porMovimiento = new Map<string, RevisionConUsuario[]>();
    for (const rev of revisiones) {
      const lista = porMovimiento.get(rev.movimientoId) ?? [];
      lista.push({
        idRevision: rev.idRevision,
        accion: rev.accion,
        observacion: rev.observacion,
        fechaRevision: rev.fechaRevision,
        usuario: {
          idUsuario: rev.us_id,
          persona: { nombres: rev.us_nombres, apellidos: rev.us_apellidos, correo: rev.us_correo },
        },
      });
      porMovimiento.set(rev.movimientoId, lista);
    }

    for (const movimiento of movimientos) {
      movimiento.revisiones = porMovimiento.get(movimiento.idMovimiento) ?? [];
    }

    return movimientos;
  }

  private mapMovimiento(row: any): MovimientoEmpalme {
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
      fechaRegistro: row.fechaRegistro,
      producto: {
        idProducto: row.pr_id,
        codigoInterno: row.pr_codigo,
        nombre: row.pr_nombre,
        categoria: { nombre: row.cat_nombre },
        unidad: { abreviatura: row.uni_abrev },
      },
      bodega: { idBodega: row.b_id, nombre: row.b_nombre },
      registrador: {
        idUsuario: row.rg_id,
        persona: { nombres: row.rg_nombres, apellidos: row.rg_apellidos, correo: row.rg_correo },
      },
      revisiones: [],
    };
  }
}
