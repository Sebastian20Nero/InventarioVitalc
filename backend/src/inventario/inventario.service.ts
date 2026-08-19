import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Decimal } from 'decimal.js';
import { PoolClient } from 'pg';
import { AnularMovimientoDto } from './dto/anular-movimiento.dto';
import { CreateMovimientoDto, TipoMovimiento, TIPOS_MOVIMIENTO } from './dto/create-movimiento.dto';
import { InventarioRepository } from './inventario.repository';

type StockConRelaciones = Awaited<ReturnType<InventarioRepository['listarStock']>>[number];
type MovimientoConRelaciones = NonNullable<
  Awaited<ReturnType<InventarioRepository['buscarMovimientoPorId']>>
>;

const TIPOS_INCREMENTAN: TipoMovimiento[] = ['SALDO_INICIAL', 'ENTRADA', 'ABASTECIMIENTO', 'AJUSTE_POSITIVO'];
const TIPOS_DISMINUYEN: TipoMovimiento[] = ['SALIDA', 'AJUSTE_NEGATIVO'];

@Injectable()
export class InventarioService {
  constructor(private readonly inventarioRepository: InventarioRepository) {}

  private toBigInt(value: string, fieldName: string) {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${fieldName} invalido`);
    }
    return BigInt(value);
  }

  private toPositiveDecimal(value: string, fieldName: string) {
    const decimal = new Decimal(value);
    if (decimal.lte(0)) {
      throw new BadRequestException(`${fieldName} debe ser mayor a cero`);
    }
    return decimal;
  }

  async importarStockDesdeExcel(buffer: Buffer, userId: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer.buffer as ArrayBuffer);
    const sheet = workbook.worksheets[0];

    if (!sheet) {
      throw new BadRequestException('El archivo Excel no tiene hojas de cálculo.');
    }

    const TIPOS_PERMITIDOS: TipoMovimiento[] = ['SALDO_INICIAL', 'ENTRADA', 'ABASTECIMIENTO', 'AJUSTE_POSITIVO'];
    const procesados: string[] = [];
    const errores: string[] = [];

    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      const codigoProducto = String(row.getCell(1).value ?? '').trim();
      const nombreBodega  = String(row.getCell(2).value ?? '').trim();
      const cantidadRaw   = String(row.getCell(3).value ?? '').trim();
      const tipoRaw       = String(row.getCell(4).value ?? 'SALDO_INICIAL').trim().toUpperCase() as TipoMovimiento;
      const observacion   = String(row.getCell(5).value ?? '').trim() || undefined;

      if (!codigoProducto && !nombreBodega && !cantidadRaw) continue; // fila vacía

      const fila = `Fila ${i}`;

      if (!codigoProducto) { errores.push(`${fila}: falta codigoProducto`); continue; }
      if (!nombreBodega)  { errores.push(`${fila}: falta codigoBodega`);   continue; }
      if (!cantidadRaw || isNaN(Number(cantidadRaw)) || Number(cantidadRaw) <= 0) {
        errores.push(`${fila}: cantidad inválida ("${cantidadRaw}")`);
        continue;
      }
      if (!TIPOS_PERMITIDOS.includes(tipoRaw)) {
        errores.push(`${fila}: tipo "${tipoRaw}" no permitido. Use: ${TIPOS_PERMITIDOS.join(', ')}`);
        continue;
      }

      try {
        const [producto, bodega] = await Promise.all([
          this.inventarioRepository.buscarProductoPorCodigo(codigoProducto),
          this.inventarioRepository.buscarBodegaPorNombre(nombreBodega),
        ]);

        if (!producto || !producto.activo) {
          errores.push(`${fila}: producto "${codigoProducto}" no encontrado o inactivo`);
          continue;
        }
        if (!bodega || !bodega.activo) {
          errores.push(`${fila}: bodega "${nombreBodega}" no encontrada o inactiva`);
          continue;
        }

        await this.registrarMovimiento(
          {
            productoId: producto.idProducto,
            bodegaId:   bodega.idBodega,
            tipoMovimiento: tipoRaw,
            cantidad: cantidadRaw,
            observacion,
          },
          userId,
        );
        procesados.push(codigoProducto);
      } catch (err: any) {
        errores.push(`${fila}: ${err?.message ?? 'Error desconocido'}`);
      }
    }

    return { procesados: procesados.length, errores };
  }

  async generarPlantillaStock(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Cargue masivo stock');

    sheet.columns = [
      { header: 'codigoProducto', key: 'codigoProducto', width: 20 },
      { header: 'codigoBodega',   key: 'codigoBodega',   width: 25 },
      { header: 'cantidad',       key: 'cantidad',       width: 12 },
      { header: 'tipo',           key: 'tipo',           width: 20 },
      { header: 'observacion',    key: 'observacion',    width: 35 },
    ];

    // Estilo encabezados
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    headerRow.alignment = { horizontal: 'center' };

    // Fila de ejemplo
    sheet.addRow({
      codigoProducto: 'PG-86',
      codigoBodega:   'Bodega principal',
      cantidad:       '50',
      tipo:           'SALDO_INICIAL',
      observacion:    'Saldo inicial agosto 2026',
    });
    sheet.addRow({
      codigoProducto: 'PG-88',
      codigoBodega:   'Bodega principal',
      cantidad:       '30',
      tipo:           'ENTRADA',
      observacion:    '',
    });

    // Nota de tipos válidos en la columna D
    const nota = sheet.getCell('G1');
    nota.value = `Tipos válidos: ${['SALDO_INICIAL', 'ENTRADA', 'ABASTECIMIENTO', 'AJUSTE_POSITIVO'].join(' | ')}`;
    nota.font = { italic: true, color: { argb: 'FF6B7280' } };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  async listarStock() {
    const stock = await this.inventarioRepository.listarStock();
    return { data: stock.map((item) => this.serializeStock(item)) };
  }

  async obtenerStock(productoIdParam: string, bodegaIdParam: string) {
    const productoId = this.toBigInt(productoIdParam, 'productoId');
    const bodegaId = this.toBigInt(bodegaIdParam, 'bodegaId');
    const stock = await this.inventarioRepository.buscarStock(productoId, bodegaId);
    if (!stock) {
      throw new NotFoundException('Stock no encontrado para el producto y bodega');
    }

    return { data: this.serializeStock(stock) };
  }

  async listarMovimientos() {
    const movimientos = await this.inventarioRepository.listarMovimientos();
    return { data: movimientos.map((movimiento) => this.serializeMovimiento(movimiento)) };
  }

  async obtenerMovimiento(id: string) {
    const idMovimiento = this.toBigInt(id, 'idMovimiento');
    const movimiento = await this.inventarioRepository.buscarMovimientoPorId(idMovimiento);
    if (!movimiento) {
      throw new NotFoundException('Movimiento no encontrado');
    }

    return { data: this.serializeMovimiento(movimiento) };
  }

  async registrarMovimiento(dto: CreateMovimientoDto, userId: string) {
    const productoId = this.toBigInt(dto.productoId, 'productoId');
    const bodegaId = this.toBigInt(dto.bodegaId, 'bodegaId');
    const cantidad = this.toPositiveDecimal(dto.cantidad, 'cantidad');
    const registradoPor = this.toBigInt(userId, 'registradoPor');

    await this.validarProductoBodega(productoId, bodegaId);

    const movimiento = await this.inventarioRepository.registrarMovimientoTransaccional(
      productoId,
      bodegaId,
      async (tx, stockActual) => {
        const stockNuevo = this.calcularStockNuevo(stockActual, cantidad, dto.tipoMovimiento);
        if (stockNuevo.isNegative()) {
          throw new BadRequestException('Stock insuficiente para registrar la salida');
        }

        return {
          stockNuevo,
          movimientoData: {
            consecutivo: await this.generarConsecutivo(tx),
            productoId,
            bodegaId,
            tipoMovimiento: dto.tipoMovimiento,
            cantidad,
            stockAnterior: stockActual,
            stockNuevo,
            observacion: dto.observacion?.trim() || null,
            estadoOperativo: 'ACTIVO',
            estadoEmpalme: 'PENDIENTE_REVISION',
            registradoPor,
          },
        };
      },
    );

    return {
      data: this.serializeMovimiento(movimiento),
      message: 'Movimiento registrado correctamente',
    };
  }

  async anularMovimiento(id: string, dto: AnularMovimientoDto, userId: string) {
    const idMovimiento = this.toBigInt(id, 'idMovimiento');
    const anuladoPor = this.toBigInt(userId, 'anuladoPor');

    const movimiento = await this.inventarioRepository.anularMovimientoTransaccional(
      idMovimiento,
      async (_tx, movimientoActual, stockActual) => {
        if (movimientoActual.estadoOperativo === 'ANULADO') {
          throw new BadRequestException('El movimiento ya se encuentra anulado');
        }

        const stockNuevo = this.calcularStockReversado(
          stockActual,
          new Decimal(movimientoActual.cantidad),
          movimientoActual.tipoMovimiento as TipoMovimiento,
        );

        if (stockNuevo.isNegative()) {
          throw new BadRequestException('No hay stock suficiente para reversar este movimiento');
        }

        return {
          stockNuevo,
          anuladoPor,
          motivoAnulacion: dto.motivo.trim(),
        };
      },
    );

    if (!movimiento) {
      throw new NotFoundException('Movimiento no encontrado');
    }

    return {
      data: this.serializeMovimiento(movimiento),
      message: 'Movimiento anulado correctamente',
    };
  }

  private calcularStockNuevo(
    stockActual: Decimal,
    cantidad: Decimal,
    tipoMovimiento: TipoMovimiento,
  ) {
    if (TIPOS_INCREMENTAN.includes(tipoMovimiento)) {
      return stockActual.plus(cantidad);
    }

    if (TIPOS_DISMINUYEN.includes(tipoMovimiento)) {
      return stockActual.minus(cantidad);
    }

    throw new BadRequestException('Tipo de movimiento invalido');
  }

  private calcularStockReversado(
    stockActual: Decimal,
    cantidad: Decimal,
    tipoMovimiento: TipoMovimiento,
  ) {
    if (TIPOS_INCREMENTAN.includes(tipoMovimiento)) {
      return stockActual.minus(cantidad);
    }

    if (TIPOS_DISMINUYEN.includes(tipoMovimiento)) {
      return stockActual.plus(cantidad);
    }

    throw new BadRequestException('Tipo de movimiento invalido');
  }

  private async generarConsecutivo(tx: PoolClient) {
    const year = new Date().getFullYear();
    const count = await this.inventarioRepository.contarMovimientosDelAnio(tx, year);
    return `MOV-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  private async validarProductoBodega(productoId: bigint, bodegaId: bigint) {
    const [producto, bodega] = await Promise.all([
      this.inventarioRepository.buscarProductoPorId(productoId),
      this.inventarioRepository.buscarBodegaPorId(bodegaId),
    ]);

    if (!producto || !producto.activo) {
      throw new BadRequestException('El producto no existe o esta inactivo');
    }

    if (!bodega || !bodega.activo) {
      throw new BadRequestException('La bodega no existe o esta inactiva');
    }
  }

  private serializeStock(stock: StockConRelaciones) {
    return {
      idStock: stock.idStock.toString(),
      productoId: stock.productoId.toString(),
      bodegaId: stock.bodegaId.toString(),
      stockActual: stock.stockActual.toString(),
      fechaActualizacion: stock.fechaActualizacion,
      producto: {
        idProducto: stock.producto.idProducto.toString(),
        codigoInterno: stock.producto.codigoInterno,
        nombre: stock.producto.nombre,
        stockMinimo: stock.producto.stockMinimo.toString(),
        categoria: {
          idCategoria: stock.producto.categoria.idCategoria.toString(),
          nombre: stock.producto.categoria.nombre,
        },
        unidad: {
          idUnidad: stock.producto.unidad.idUnidad.toString(),
          nombre: stock.producto.unidad.nombre,
          abreviatura: stock.producto.unidad.abreviatura,
        },
      },
      bodega: {
        idBodega: stock.bodega.idBodega.toString(),
        nombre: stock.bodega.nombre,
      },
    };
  }

  private serializeMovimiento(movimiento: MovimientoConRelaciones) {
    return {
      idMovimiento: movimiento.idMovimiento.toString(),
      consecutivo: movimiento.consecutivo,
      productoId: movimiento.productoId.toString(),
      bodegaId: movimiento.bodegaId.toString(),
      tipoMovimiento: movimiento.tipoMovimiento,
      cantidad: movimiento.cantidad.toString(),
      stockAnterior: movimiento.stockAnterior.toString(),
      stockNuevo: movimiento.stockNuevo.toString(),
      observacion: movimiento.observacion,
      estadoOperativo: movimiento.estadoOperativo,
      estadoEmpalme: movimiento.estadoEmpalme,
      registradoPor: movimiento.registradoPor.toString(),
      fechaRegistro: movimiento.fechaRegistro,
      anuladoPor: movimiento.anuladoPor?.toString() ?? null,
      fechaAnulacion: movimiento.fechaAnulacion,
      motivoAnulacion: movimiento.motivoAnulacion,
      createdAt: movimiento.createdAt,
      updatedAt: movimiento.updatedAt,
      producto: {
        idProducto: movimiento.producto.idProducto.toString(),
        codigoInterno: movimiento.producto.codigoInterno,
        nombre: movimiento.producto.nombre,
      },
      bodega: {
        idBodega: movimiento.bodega.idBodega.toString(),
        nombre: movimiento.bodega.nombre,
      },
      registrador: {
        idUsuario: movimiento.registrador.idUsuario.toString(),
        nombres: movimiento.registrador.persona.nombres,
        apellidos: movimiento.registrador.persona.apellidos,
        correo: movimiento.registrador.persona.correo,
      },
      anulador: movimiento.anulador
        ? {
            idUsuario: movimiento.anulador.idUsuario.toString(),
            nombres: movimiento.anulador.persona.nombres,
            apellidos: movimiento.anulador.persona.apellidos,
            correo: movimiento.anulador.persona.correo,
          }
        : null,
    };
  }
}
