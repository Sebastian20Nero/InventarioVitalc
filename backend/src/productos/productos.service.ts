import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoEstadoDto } from './dto/update-producto-estado.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ProductosRepository } from './productos.repository';

type ProductoConRelaciones = NonNullable<Awaited<ReturnType<ProductosRepository['buscarPorId']>>>;

@Injectable()
export class ProductosService {
  constructor(private readonly productosRepository: ProductosRepository) {}

  private toBigInt(value: string, fieldName: string) {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${fieldName} invalido`);
    }
    return BigInt(value);
  }

  private toDecimal(value: string | undefined, fieldName: string) {
    if (value === undefined || value.trim() === '') {
      return new Decimal(0);
    }

    const decimal = new Decimal(value);
    if (decimal.isNegative()) {
      throw new BadRequestException(`${fieldName} no puede ser negativo`);
    }
    return decimal;
  }

  private serializeProducto(producto: ProductoConRelaciones) {
    return {
      idProducto: producto.idProducto.toString(),
      codigoInterno: producto.codigoInterno,
      nombre: producto.nombre,
      descripcion: producto.descripcion,
      categoriaId: producto.categoriaId.toString(),
      unidadId: producto.unidadId.toString(),
      stockMinimo: producto.stockMinimo.toString(),
      activo: producto.activo,
      creadoPor: producto.creadoPor.toString(),
      createdAt: producto.createdAt,
      updatedAt: producto.updatedAt,
      categoria: {
        idCategoria: producto.categoria.idCategoria.toString(),
        nombre: producto.categoria.nombre,
        descripcion: producto.categoria.descripcion,
        activo: producto.categoria.activo,
      },
      unidad: {
        idUnidad: producto.unidad.idUnidad.toString(),
        nombre: producto.unidad.nombre,
        abreviatura: producto.unidad.abreviatura,
        activo: producto.unidad.activo,
      },
      creador: {
        idUsuario: producto.creador.idUsuario.toString(),
        nombres: producto.creador.persona.nombres,
        apellidos: producto.creador.persona.apellidos,
        correo: producto.creador.persona.correo,
      },
    };
  }

  async listar() {
    const productos = await this.productosRepository.listar();
    return { data: productos.map((producto) => this.serializeProducto(producto)) };
  }

  async obtenerPorId(id: string) {
    const idProducto = this.toBigInt(id, 'idProducto');
    const producto = await this.productosRepository.buscarPorId(idProducto);
    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    return { data: this.serializeProducto(producto) };
  }

  async crear(dto: CreateProductoDto, userId: string) {
    const codigoInterno = dto.codigoInterno.trim().toUpperCase();
    await this.validarCodigoDisponible(codigoInterno);

    const categoriaId = this.toBigInt(dto.categoriaId, 'categoriaId');
    const unidadId = this.toBigInt(dto.unidadId, 'unidadId');
    await this.validarCatalogos(categoriaId, unidadId);

    const producto = await this.productosRepository.crear({
      codigoInterno,
      nombre: dto.nombre.trim(),
      descripcion: dto.descripcion?.trim() || null,
      categoriaId,
      unidadId,
      stockMinimo: this.toDecimal(dto.stockMinimo, 'stockMinimo'),
      activo: true,
      creadoPor: this.toBigInt(userId, 'creadoPor'),
    });

    return {
      data: this.serializeProducto(producto),
      message: 'Producto creado correctamente',
    };
  }

  async actualizar(id: string, dto: UpdateProductoDto) {
    const idProducto = this.toBigInt(id, 'idProducto');
    const producto = await this.productosRepository.buscarPorId(idProducto);
    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    const codigoInterno = dto.codigoInterno?.trim().toUpperCase();
    if (codigoInterno !== undefined && codigoInterno !== producto.codigoInterno) {
      await this.validarCodigoDisponible(codigoInterno);
    }

    const categoriaId =
      dto.categoriaId !== undefined ? this.toBigInt(dto.categoriaId, 'categoriaId') : undefined;
    const unidadId = dto.unidadId !== undefined ? this.toBigInt(dto.unidadId, 'unidadId') : undefined;

    if (categoriaId !== undefined || unidadId !== undefined) {
      await this.validarCatalogos(
        categoriaId ?? BigInt(producto.categoriaId),
        unidadId ?? BigInt(producto.unidadId),
      );
    }

    const updated = await this.productosRepository.actualizar(idProducto, {
      ...(codigoInterno !== undefined ? { codigoInterno } : {}),
      ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
      ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion.trim() || null } : {}),
      ...(categoriaId !== undefined ? { categoriaId } : {}),
      ...(unidadId !== undefined ? { unidadId } : {}),
      ...(dto.stockMinimo !== undefined
        ? { stockMinimo: this.toDecimal(dto.stockMinimo, 'stockMinimo') }
        : {}),
    });

    return {
      data: this.serializeProducto(updated),
      message: 'Producto actualizado correctamente',
    };
  }

  async actualizarEstado(id: string, dto: UpdateProductoEstadoDto) {
    const idProducto = this.toBigInt(id, 'idProducto');
    const producto = await this.productosRepository.buscarPorId(idProducto);
    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    const updated = await this.productosRepository.actualizar(idProducto, {
      activo: dto.activo,
    });

    return {
      data: this.serializeProducto(updated),
      message: 'Estado del producto actualizado correctamente',
    };
  }

  private async validarCodigoDisponible(codigoInterno: string) {
    const existing = await this.productosRepository.buscarPorCodigoInterno(codigoInterno);
    if (existing) {
      throw new BadRequestException('Ya existe un producto con ese codigo interno');
    }
  }

  private async validarCatalogos(categoriaId: bigint, unidadId: bigint) {
    const [categoria, unidad] = await Promise.all([
      this.productosRepository.buscarCategoriaPorId(categoriaId),
      this.productosRepository.buscarUnidadPorId(unidadId),
    ]);

    if (!categoria || !categoria.activo) {
      throw new BadRequestException('La categoria no existe o esta inactiva');
    }

    if (!unidad || !unidad.activo) {
      throw new BadRequestException('La unidad de medida no existe o esta inactiva');
    }
  }
}
