import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { createPdf } from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { AccionEmpalmeDto } from './dto/accion-empalme.dto';
import { ConfiguracionDsnubeDto } from './dto/configuracion-dsnube.dto';
import { ImportarDsnubeDto } from './dto/importar-dsnube.dto';
import { EmpalmeRepository } from './empalme.repository';

type MovimientoEmpalme = NonNullable<Awaited<ReturnType<EmpalmeRepository['buscarMovimiento']>>>;
type ConfiguracionDsnube = NonNullable<Awaited<ReturnType<EmpalmeRepository['obtenerConfiguracion']>>>;

@Injectable()
export class EmpalmeService {
  constructor(private readonly empalmeRepository: EmpalmeRepository) {}

  private toBigInt(value: string, fieldName: string) {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${fieldName} invalido`);
    }
    return BigInt(value);
  }

  async listarMovimientos() {
    const movimientos = await this.empalmeRepository.listarMovimientos();
    return { data: movimientos.map((movimiento) => this.serializeMovimiento(movimiento)) };
  }

  revisar(id: string, dto: AccionEmpalmeDto, userId: string) {
    return this.ejecutarAccion(id, userId, 'REVISADO', 'PENDIENTE_REVISION', dto.observacion);
  }

  observar(id: string, dto: AccionEmpalmeDto, userId: string) {
    return this.ejecutarAccion(id, userId, 'OBSERVADO', 'OBSERVADO', dto.observacion);
  }

  marcarListo(id: string, dto: AccionEmpalmeDto, userId: string) {
    return this.ejecutarAccion(id, userId, 'LISTO_DSNUBE', 'LISTO_DSNUBE', dto.observacion, {
      bloquearSiObservado: true,
    });
  }

  marcarCargado(id: string, dto: AccionEmpalmeDto, userId: string) {
    return this.ejecutarAccion(id, userId, 'CARGADO_DSNUBE', 'CARGADO_DSNUBE', dto.observacion);
  }

  async obtenerReporte() {
    const movimientos = await this.empalmeRepository.listarMovimientos();
    return {
      data: movimientos.map((movimiento) => this.serializeMovimiento(movimiento)),
      meta: {
        total: movimientos.length,
      },
    };
  }

  async exportarReporte(formato: string) {
    const movimientos = await this.empalmeRepository.listarMovimientos();
    if (formato === 'xlsx') {
      return {
        filename: 'reporte-empalme.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: await this.generarExcel(movimientos),
      };
    }

    if (formato === 'pdf') {
      return {
        filename: 'reporte-empalme.pdf',
        contentType: 'application/pdf',
        buffer: await this.generarPdf(movimientos),
      };
    }

    throw new BadRequestException('Formato no soportado');
  }

  async descargarPlantillaImportacion() {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Plantilla');
    worksheet.columns = [
      { header: 'consecutivo', key: 'consecutivo', width: 24 },
      { header: 'observacion', key: 'observacion', width: 40 },
    ];
    worksheet.addRow({ consecutivo: 'MOV-2026-000001', observacion: 'Ejemplo' });

    return {
      filename: 'plantilla-importacion-dsnube.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }

  async importarDesdeExcel(file: Express.Multer.File, userId: string) {
    if (!file?.buffer) {
      throw new BadRequestException('Archivo Excel requerido');
    }
    // Validar tipo MIME del archivo
    const allowedMime = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    if (!allowedMime.includes(file.mimetype)) {
      throw new BadRequestException('Tipo de archivo no soportado. Por favor suba un archivo .xlsx o .xls');
    }

    const workbook = new Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException('El archivo no contiene hojas');
    }

    const headers = worksheet.getRow(1).values as unknown[];
    const consecutivoColumn = headers.findIndex((value) => String(value).trim() === 'consecutivo');
    if (consecutivoColumn <= 0) {
      throw new BadRequestException('La columna consecutivo es requerida');
    }

    const consecutivos = new Set<string>();
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const value = row.getCell(consecutivoColumn).value;
      if (value) {
        consecutivos.add(String(value).trim());
      }
    });

    return this.marcarCargadosPorConsecutivo({ consecutivos: Array.from(consecutivos) }, userId);
  }

  async marcarCargadosPorConsecutivo(dto: ImportarDsnubeDto, userId: string) {
    const consecutivos = dto.consecutivos.map((item) => item.trim()).filter(Boolean);
    if (!consecutivos.length) {
      throw new BadRequestException('Debe enviar al menos un consecutivo');
    }

    const movimientos = await this.empalmeRepository.marcarCargadoEnLote(
      consecutivos,
      this.toBigInt(userId, 'usuarioId'),
    );

    return {
      data: movimientos.map((movimiento) => this.serializeMovimiento(movimiento)),
      meta: {
        solicitados: consecutivos.length,
        encontrados: movimientos.length,
      },
      message: 'Movimientos marcados como cargados en DsNube',
    };
  }

  async obtenerConfiguracion() {
    const configuracion = await this.empalmeRepository.obtenerConfiguracion();
    return { data: configuracion ? this.serializeConfiguracion(configuracion) : null };
  }

  async guardarConfiguracion(dto: ConfiguracionDsnubeDto) {
    const configuracion = await this.empalmeRepository.guardarConfiguracion({
      url: dto.url.trim(),
      usuario: dto.usuario.trim(),
      password: dto.password?.trim() || null,
      activo: dto.activo ?? true,
    });

    return {
      data: this.serializeConfiguracion(configuracion),
      message: 'Configuracion DsNube guardada correctamente',
    };
  }

  private async ejecutarAccion(
    id: string,
    userId: string,
    accion: string,
    estadoEmpalme: string,
    observacion?: string,
    options?: { bloquearSiObservado?: boolean },
  ) {
    const idMovimiento = this.toBigInt(id, 'idMovimiento');
    const usuarioId = this.toBigInt(userId, 'usuarioId');

    const movimiento = await this.empalmeRepository.ejecutarAccion(
      idMovimiento,
      async (_tx, movimientoActual) => {
        if (movimientoActual.estadoOperativo === 'ANULADO') {
          throw new BadRequestException('No se permiten acciones sobre movimientos anulados');
        }

        if (options?.bloquearSiObservado && movimientoActual.estadoEmpalme === 'OBSERVADO') {
          throw new BadRequestException('No se puede marcar listo un movimiento observado');
        }

        return {
          usuarioId,
          accion,
          estadoEmpalme,
          observacion: observacion?.trim() || null,
        };
      },
    );

    if (!movimiento) {
      throw new NotFoundException('Movimiento no encontrado');
    }

    return {
      data: this.serializeMovimiento(movimiento),
      message: 'Accion de empalme registrada correctamente',
    };
  }

  private serializeMovimiento(movimiento: MovimientoEmpalme) {
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
      fechaRegistro: movimiento.fechaRegistro,
      producto: {
        idProducto: movimiento.producto.idProducto.toString(),
        codigoInterno: movimiento.producto.codigoInterno,
        nombre: movimiento.producto.nombre,
        categoria: movimiento.producto.categoria.nombre,
        unidad: movimiento.producto.unidad.abreviatura,
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
      revisiones: movimiento.revisiones.map((revision) => ({
        idRevision: revision.idRevision.toString(),
        accion: revision.accion,
        observacion: revision.observacion,
        fechaRevision: revision.fechaRevision,
        usuario: {
          idUsuario: revision.usuario.idUsuario.toString(),
          nombres: revision.usuario.persona.nombres,
          apellidos: revision.usuario.persona.apellidos,
          correo: revision.usuario.persona.correo,
        },
      })),
    };
  }

  private serializeConfiguracion(configuracion: ConfiguracionDsnube) {
    return {
      idConfiguracion: configuracion.idConfiguracion.toString(),
      url: configuracion.url,
      usuario: configuracion.usuario,
      tienePassword: Boolean(configuracion.password),
      activo: configuracion.activo,
      createdAt: configuracion.createdAt,
      updatedAt: configuracion.updatedAt,
    };
  }

  private async generarExcel(movimientos: MovimientoEmpalme[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Empalme');
    worksheet.columns = [
      { header: 'Consecutivo', key: 'consecutivo', width: 22 },
      { header: 'Producto', key: 'producto', width: 30 },
      { header: 'Bodega', key: 'bodega', width: 24 },
      { header: 'Tipo', key: 'tipoMovimiento', width: 18 },
      { header: 'Cantidad', key: 'cantidad', width: 14 },
      { header: 'Stock anterior', key: 'stockAnterior', width: 16 },
      { header: 'Stock nuevo', key: 'stockNuevo', width: 16 },
      { header: 'Estado empalme', key: 'estadoEmpalme', width: 24 },
      { header: 'Fecha registro', key: 'fechaRegistro', width: 24 },
    ];

    for (const movimiento of movimientos) {
      worksheet.addRow({
        consecutivo: movimiento.consecutivo,
        producto: movimiento.producto.nombre,
        bodega: movimiento.bodega.nombre,
        tipoMovimiento: movimiento.tipoMovimiento,
        cantidad: movimiento.cantidad.toString(),
        stockAnterior: movimiento.stockAnterior.toString(),
        stockNuevo: movimiento.stockNuevo.toString(),
        estadoEmpalme: movimiento.estadoEmpalme,
        fechaRegistro: movimiento.fechaRegistro.toISOString(),
      });
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private async generarPdf(movimientos: MovimientoEmpalme[]) {
    const body = [
      ['Consecutivo', 'Producto', 'Bodega', 'Tipo', 'Cantidad', 'Estado'],
      ...movimientos.map((movimiento) => [
        movimiento.consecutivo,
        movimiento.producto.nombre,
        movimiento.bodega.nombre,
        movimiento.tipoMovimiento,
        movimiento.cantidad.toString(),
        movimiento.estadoEmpalme,
      ]),
    ];

    const definition: TDocumentDefinitions = {
      content: [
        { text: 'Reporte de Empalme DsNube', style: 'header' },
        { text: `Generado: ${new Date().toLocaleString()}`, margin: [0, 0, 0, 12] },
        {
          table: {
            headerRows: 1,
            widths: ['auto', '*', '*', 'auto', 'auto', 'auto'],
            body,
          },
        },
      ],
      styles: {
        header: {
          fontSize: 16,
          bold: true,
          margin: [0, 0, 0, 8],
        },
      },
      defaultStyle: {
        fontSize: 8,
      },
    };

    return createPdf(definition).getBuffer();
  }
}
