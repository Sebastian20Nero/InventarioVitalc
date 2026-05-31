import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogosRepository } from './catalogos.repository';
import { CreateBodegaDto } from './dto/create-bodega.dto';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { CreateUnidadDto } from './dto/create-unidad.dto';
import { UpdateBodegaDto } from './dto/update-bodega.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { UpdateUnidadDto } from './dto/update-unidad.dto';

@Injectable()
export class CatalogosService {
  constructor(private readonly catalogosRepository: CatalogosRepository) {}

  private toBigInt(value: string, fieldName: string) {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${fieldName} invalido`);
    }
    return BigInt(value);
  }

  private serializeCategoria(categoria: {
    idCategoria: string;
    nombre: string;
    descripcion: string | null;
    activo: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      idCategoria: categoria.idCategoria.toString(),
      nombre: categoria.nombre,
      descripcion: categoria.descripcion,
      activo: categoria.activo,
      createdAt: categoria.createdAt,
      updatedAt: categoria.updatedAt,
    };
  }

  private serializeUnidad(unidad: {
    idUnidad: string;
    nombre: string;
    abreviatura: string;
    activo: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      idUnidad: unidad.idUnidad.toString(),
      nombre: unidad.nombre,
      abreviatura: unidad.abreviatura,
      activo: unidad.activo,
      createdAt: unidad.createdAt,
      updatedAt: unidad.updatedAt,
    };
  }

  private serializeBodega(bodega: {
    idBodega: string;
    nombre: string;
    descripcion: string | null;
    activo: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      idBodega: bodega.idBodega.toString(),
      nombre: bodega.nombre,
      descripcion: bodega.descripcion,
      activo: bodega.activo,
      createdAt: bodega.createdAt,
      updatedAt: bodega.updatedAt,
    };
  }

  async listarCategorias() {
    const categorias = await this.catalogosRepository.listarCategorias();
    return { data: categorias.map((categoria) => this.serializeCategoria(categoria)) };
  }

  async crearCategoria(dto: CreateCategoriaDto) {
    await this.validarNombreCategoriaDisponible(dto.nombre);
    const categoria = await this.catalogosRepository.crearCategoria(dto);
    return {
      data: this.serializeCategoria(categoria),
      message: 'Categoria creada correctamente',
    };
  }

  async actualizarCategoria(id: string, dto: UpdateCategoriaDto) {
    const idCategoria = this.toBigInt(id, 'idCategoria');
    const categoria = await this.catalogosRepository.buscarCategoriaPorId(idCategoria);
    if (!categoria) {
      throw new NotFoundException('Categoria no encontrada');
    }

    if (dto.nombre !== undefined && dto.nombre.trim() !== categoria.nombre) {
      await this.validarNombreCategoriaDisponible(dto.nombre);
    }

    const updated = await this.catalogosRepository.actualizarCategoria(idCategoria, dto);
    return {
      data: this.serializeCategoria(updated),
      message: 'Categoria actualizada correctamente',
    };
  }

  async listarUnidades() {
    const unidades = await this.catalogosRepository.listarUnidades();
    return { data: unidades.map((unidad) => this.serializeUnidad(unidad)) };
  }

  async crearUnidad(dto: CreateUnidadDto) {
    await this.validarAbreviaturaUnidadDisponible(dto.abreviatura);
    const unidad = await this.catalogosRepository.crearUnidad(dto);
    return {
      data: this.serializeUnidad(unidad),
      message: 'Unidad de medida creada correctamente',
    };
  }

  async actualizarUnidad(id: string, dto: UpdateUnidadDto) {
    const idUnidad = this.toBigInt(id, 'idUnidad');
    const unidad = await this.catalogosRepository.buscarUnidadPorId(idUnidad);
    if (!unidad) {
      throw new NotFoundException('Unidad de medida no encontrada');
    }

    const abreviatura = dto.abreviatura?.trim().toUpperCase();
    if (abreviatura !== undefined && abreviatura !== unidad.abreviatura) {
      await this.validarAbreviaturaUnidadDisponible(abreviatura);
    }

    const updated = await this.catalogosRepository.actualizarUnidad(idUnidad, dto);
    return {
      data: this.serializeUnidad(updated),
      message: 'Unidad de medida actualizada correctamente',
    };
  }

  async listarBodegas() {
    const bodegas = await this.catalogosRepository.listarBodegas();
    return { data: bodegas.map((bodega) => this.serializeBodega(bodega)) };
  }

  async crearBodega(dto: CreateBodegaDto) {
    await this.validarNombreBodegaDisponible(dto.nombre);
    const bodega = await this.catalogosRepository.crearBodega(dto);
    return {
      data: this.serializeBodega(bodega),
      message: 'Bodega creada correctamente',
    };
  }

  async actualizarBodega(id: string, dto: UpdateBodegaDto) {
    const idBodega = this.toBigInt(id, 'idBodega');
    const bodega = await this.catalogosRepository.buscarBodegaPorId(idBodega);
    if (!bodega) {
      throw new NotFoundException('Bodega no encontrada');
    }

    if (dto.nombre !== undefined && dto.nombre.trim() !== bodega.nombre) {
      await this.validarNombreBodegaDisponible(dto.nombre);
    }

    const updated = await this.catalogosRepository.actualizarBodega(idBodega, dto);
    return {
      data: this.serializeBodega(updated),
      message: 'Bodega actualizada correctamente',
    };
  }

  private async validarNombreCategoriaDisponible(nombre: string) {
    const existing = await this.catalogosRepository.buscarCategoriaPorNombre(nombre.trim());
    if (existing) {
      throw new BadRequestException('Ya existe una categoria con ese nombre');
    }
  }

  private async validarAbreviaturaUnidadDisponible(abreviatura: string) {
    const existing = await this.catalogosRepository.buscarUnidadPorAbreviatura(
      abreviatura.trim().toUpperCase(),
    );
    if (existing) {
      throw new BadRequestException('Ya existe una unidad con esa abreviatura');
    }
  }

  private async validarNombreBodegaDisponible(nombre: string) {
    const existing = await this.catalogosRepository.buscarBodegaPorNombre(nombre.trim());
    if (existing) {
      throw new BadRequestException('Ya existe una bodega con ese nombre');
    }
  }
}
