import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateBodegaDto } from './dto/create-bodega.dto';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { CreateUnidadDto } from './dto/create-unidad.dto';
import { UpdateBodegaDto } from './dto/update-bodega.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { UpdateUnidadDto } from './dto/update-unidad.dto';

export interface CategoriaRow {
  idCategoria: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnidadRow {
  idUnidad: string;
  nombre: string;
  abreviatura: string;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BodegaRow {
  idBodega: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CatalogosRepository {
  constructor(private readonly db: DatabaseService) {}

  listarCategorias() {
    return this.db.query<CategoriaRow>('SELECT * FROM "CategoriaProducto" ORDER BY "nombre" ASC');
  }

  buscarCategoriaPorId(idCategoria: bigint) {
    return this.db.one<CategoriaRow>(
      'SELECT * FROM "CategoriaProducto" WHERE "idCategoria" = $1',
      [idCategoria.toString()],
    );
  }

  buscarCategoriaPorNombre(nombre: string) {
    return this.db.one<CategoriaRow>('SELECT * FROM "CategoriaProducto" WHERE "nombre" = $1', [
      nombre,
    ]);
  }

  async crearCategoria(dto: CreateCategoriaDto): Promise<CategoriaRow> {
    const row = await this.db.one<CategoriaRow>(
      `INSERT INTO "CategoriaProducto" ("nombre", "descripcion", "activo")
       VALUES ($1, $2, true) RETURNING *`,
      [dto.nombre.trim(), dto.descripcion?.trim() || null],
    );
    return row!;
  }

  async actualizarCategoria(idCategoria: bigint, dto: UpdateCategoriaDto): Promise<CategoriaRow> {
    const row = await this.db.one<CategoriaRow>(
      `UPDATE "CategoriaProducto" SET
         "nombre" = COALESCE($2, "nombre"),
         "descripcion" = CASE WHEN $3::boolean THEN $4 ELSE "descripcion" END,
         "activo" = COALESCE($5, "activo"),
         "updatedAt" = CURRENT_TIMESTAMP
       WHERE "idCategoria" = $1 RETURNING *`,
      [
        idCategoria.toString(),
        dto.nombre !== undefined ? dto.nombre.trim() : null,
        dto.descripcion !== undefined,
        dto.descripcion !== undefined ? dto.descripcion.trim() || null : null,
        dto.activo !== undefined ? dto.activo : null,
      ],
    );
    return row!;
  }

  listarUnidades() {
    return this.db.query<UnidadRow>('SELECT * FROM "UnidadMedida" ORDER BY "nombre" ASC');
  }

  buscarUnidadPorId(idUnidad: bigint) {
    return this.db.one<UnidadRow>('SELECT * FROM "UnidadMedida" WHERE "idUnidad" = $1', [
      idUnidad.toString(),
    ]);
  }

  buscarUnidadPorAbreviatura(abreviatura: string) {
    return this.db.one<UnidadRow>('SELECT * FROM "UnidadMedida" WHERE "abreviatura" = $1', [
      abreviatura,
    ]);
  }

  async crearUnidad(dto: CreateUnidadDto): Promise<UnidadRow> {
    const row = await this.db.one<UnidadRow>(
      `INSERT INTO "UnidadMedida" ("nombre", "abreviatura", "activo")
       VALUES ($1, $2, true) RETURNING *`,
      [dto.nombre.trim(), dto.abreviatura.trim().toUpperCase()],
    );
    return row!;
  }

  async actualizarUnidad(idUnidad: bigint, dto: UpdateUnidadDto): Promise<UnidadRow> {
    const row = await this.db.one<UnidadRow>(
      `UPDATE "UnidadMedida" SET
         "nombre" = COALESCE($2, "nombre"),
         "abreviatura" = COALESCE($3, "abreviatura"),
         "activo" = COALESCE($4, "activo"),
         "updatedAt" = CURRENT_TIMESTAMP
       WHERE "idUnidad" = $1 RETURNING *`,
      [
        idUnidad.toString(),
        dto.nombre !== undefined ? dto.nombre.trim() : null,
        dto.abreviatura !== undefined ? dto.abreviatura.trim().toUpperCase() : null,
        dto.activo !== undefined ? dto.activo : null,
      ],
    );
    return row!;
  }

  listarBodegas() {
    return this.db.query<BodegaRow>('SELECT * FROM "Bodega" ORDER BY "nombre" ASC');
  }

  buscarBodegaPorId(idBodega: bigint) {
    return this.db.one<BodegaRow>('SELECT * FROM "Bodega" WHERE "idBodega" = $1', [
      idBodega.toString(),
    ]);
  }

  buscarBodegaPorNombre(nombre: string) {
    return this.db.one<BodegaRow>('SELECT * FROM "Bodega" WHERE "nombre" = $1', [nombre]);
  }

  async crearBodega(dto: CreateBodegaDto): Promise<BodegaRow> {
    const row = await this.db.one<BodegaRow>(
      `INSERT INTO "Bodega" ("nombre", "descripcion", "activo")
       VALUES ($1, $2, true) RETURNING *`,
      [dto.nombre.trim(), dto.descripcion?.trim() || null],
    );
    return row!;
  }

  async actualizarBodega(idBodega: bigint, dto: UpdateBodegaDto): Promise<BodegaRow> {
    const row = await this.db.one<BodegaRow>(
      `UPDATE "Bodega" SET
         "nombre" = COALESCE($2, "nombre"),
         "descripcion" = CASE WHEN $3::boolean THEN $4 ELSE "descripcion" END,
         "activo" = COALESCE($5, "activo"),
         "updatedAt" = CURRENT_TIMESTAMP
       WHERE "idBodega" = $1 RETURNING *`,
      [
        idBodega.toString(),
        dto.nombre !== undefined ? dto.nombre.trim() : null,
        dto.descripcion !== undefined,
        dto.descripcion !== undefined ? dto.descripcion.trim() || null : null,
        dto.activo !== undefined ? dto.activo : null,
      ],
    );
    return row!;
  }
}
