import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Workbook } from 'exceljs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PoolClient } from 'pg';
import { spawn } from 'child_process';
import { DatabaseService } from '../database/database.service';
import { AsignarDto } from './dto/asignar.dto';
import { CerrarCorteDto, PrefijoDto } from './dto/cierre.dto';
import { EquivalenciaDto } from './dto/equivalencia.dto';
import { EtapaDto } from './dto/etapa.dto';
import { GuardarCorteDto, GuiaLecturaDto, ResumenLecturaDto } from './dto/guardar-corte.dto';

const HOJAS = ['ENVIA', 'DERROCHA', 'INTER', 'JAM DRIVE', 'TCC', 'DOMINA', '99 MINUTOS', 'VELOCES', 'COORDINADORA'] as const;
const ETAPAS = ['revisado', 'embolsado', 'empacado'] as const;

type Lectura = {
  transportadora: string;
  fecha: string;
  nombreArchivo: string;
  huella: string;
  paginas: number;
  avisos?: string[];
  validaciones?: { clave: string; titulo: string; ok: boolean; detalle: string }[];
  unidadesRotulos?: number;
  unidadesResumen?: number;
  guias: GuiaLecturaDto[];
  resumen: ResumenLecturaDto[];
};

type ResumenListo = ResumenLecturaDto & { productoId: string | null };

@Injectable()
export class DespachosService {
  constructor(private readonly db: DatabaseService) {}

  async revisar(archivo: Express.Multer.File) {
    if (!archivo?.buffer?.length) {
      throw new BadRequestException('Selecciona el PDF del manifiesto.');
    }
    if (!archivo.originalname.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('DROPI se carga con el PDF del manifiesto.');
    }
    const lectura = await this.leerPdf(archivo);
    return { data: await this.preparar(lectura) };
  }

  async asociar(dto: EquivalenciaDto, usuarioId: string) {
    if (!dto.idDropi.trim() && !dto.sku.trim()) {
      throw new BadRequestException('La equivalencia necesita el ID o el SKU de DROPI.');
    }
    const producto = await this.db.one<{ idProducto: string }>(
      `SELECT "idProducto" FROM "Producto" WHERE "idProducto" = $1 AND "activo" = true`,
      [dto.productoId],
    );
    if (!producto) {
      throw new BadRequestException('Elige un producto activo del maestro.');
    }
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO "EquivalenciaDropi" ("skuDropi", "idDropi", "nombreDropi", "productoId")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("skuDropi", "idDropi") DO UPDATE SET
           "productoId" = EXCLUDED."productoId",
           "nombreDropi" = EXCLUDED."nombreDropi"`,
        [dto.sku, dto.idDropi, dto.nombre, dto.productoId],
      );
      await this.registrar(client, usuarioId, 'equivalencia.asociar', `${dto.sku}|${dto.idDropi}|producto ${dto.productoId}`);
    });
    return { data: { productoId: dto.productoId } };
  }

  async guardar(dto: GuardarCorteDto, usuarioId: string) {
    this.verificarFirma(dto);
    const preparado = await this.preparar(dto);
    if (preparado.bloqueos.length) {
      throw new BadRequestException(preparado.bloqueos[0]);
    }
    const transportadora = preparado.transportadoraId;
    const corteId = await this.db.transaction(async (client) => {
      const repetido = await client.query(`SELECT 1 FROM "ArchivoDespacho" WHERE "huella" = $1`, [dto.huella]);
      if (repetido.rowCount) {
        throw new BadRequestException('Este PDF ya se cargó. No se vuelve a guardar.');
      }
      const ocupado = await client.query(
        `SELECT 1 FROM "CorteDespacho"
         WHERE "fecha" = $1 AND "transportadoraId" = $2 AND "numero" = $3 AND "anulado" = false`,
        [dto.fecha, transportadora, dto.numero],
      );
      if (ocupado.rowCount) {
        throw new BadRequestException(`Ya existe el corte ${dto.numero} de esa transportadora para el ${dto.fecha}.`);
      }
      const corte = await client.query<{ idCorte: string }>(
        `INSERT INTO "CorteDespacho" ("fecha", "transportadoraId", "numero", "cargadoPor", "plataforma")
         VALUES ($1, $2, $3, $4, 'DROPI')
         RETURNING "idCorte"`,
        [dto.fecha, transportadora, dto.numero, usuarioId],
      );
      const id = corte.rows[0].idCorte;
      await client.query(
        `INSERT INTO "ArchivoDespacho" ("corteId", "nombre", "huella", "paginas", "cargadoPor")
         VALUES ($1, $2, $3, $4, $5)`,
        [id, dto.nombreArchivo, dto.huella, dto.paginas, usuarioId],
      );
      for (const guia of dto.guias) {
        await client.query(
          `INSERT INTO "GuiaDespacho" ("corteId", "numero", "consecutivo", "ciudad", "recaudo", "tipo", "textoRotulo")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, guia.numero, guia.consecutivo ?? null, guia.ciudad, guia.recaudo, guia.tipo, guia.textoRotulo],
        );
      }
      const porProducto = new Map<string, number>();
      for (const item of preparado.resumen) {
        if (!item.productoId) {
          throw new BadRequestException('Falta asociar un producto. El corte no se guarda.');
        }
        porProducto.set(item.productoId, (porProducto.get(item.productoId) ?? 0) + item.cantidad);
      }
      for (const [productoId, cantidad] of porProducto) {
        await client.query(
          `INSERT INTO "AlistamientoDespacho" ("corteId", "productoId", "cantidad") VALUES ($1, $2, $3)`,
          [id, productoId, cantidad],
        );
      }
      await this.registrar(client, usuarioId, 'corte.guardar', `${dto.fecha}|${dto.numero}|${dto.huella}`);
      return id;
    });
    return { data: { idCorte: corteId } };
  }

  async tablero(fecha: string) {
    const filas = await this.db.query(
      `SELECT c."idCorte", c."numero", c."estado", t."nombre" AS transportadora,
              (SELECT COUNT(*) FROM "GuiaDespacho" g WHERE g."corteId" = c."idCorte") AS guias,
              (SELECT COALESCE(SUM("cantidad"), 0) FROM "AlistamientoDespacho" a WHERE a."corteId" = c."idCorte") AS unidades,
              (SELECT COUNT(*) FROM "AlistamientoDespacho" a WHERE a."corteId" = c."idCorte" AND a."revisado") AS revisados,
              (SELECT COUNT(*) FROM "AlistamientoDespacho" a WHERE a."corteId" = c."idCorte" AND a."embolsado") AS embolsados,
              (SELECT COUNT(*) FROM "AlistamientoDespacho" a WHERE a."corteId" = c."idCorte" AND a."empacado") AS empacados,
              (SELECT COUNT(*) FROM "AlistamientoDespacho" a WHERE a."corteId" = c."idCorte") AS productos
       FROM "CorteDespacho" c
       JOIN "TransportadoraDespacho" t ON t."idTransportadora" = c."transportadoraId"
       WHERE c."fecha" = $1 AND c."anulado" = false
       ORDER BY t."orden", c."numero"`,
      [fecha],
    );
    return { data: filas };
  }

  async usuarios() {
    const filas = await this.db.query(
      `SELECT u."idUsuario", p."nombres", p."apellidos"
       FROM "Usuario" u
       JOIN "Persona" p ON p."idPersona" = u."personaId"
       WHERE u."activo" = true
       ORDER BY p."nombres", p."apellidos"`,
    );
    return { data: filas };
  }

  async asignar(corteId: string, dto: AsignarDto, usuarioId: string) {
    const corte = await this.db.one<{ cargadoPor: string }>(
      `SELECT "cargadoPor" FROM "CorteDespacho" WHERE "idCorte" = $1 AND "anulado" = false`,
      [corteId],
    );
    if (!corte) {
      throw new NotFoundException('Ese corte no está.');
    }
    const admin = await this.esAdmin(usuarioId);
    if (dto.usuarioIds.includes(String(corte.cargadoPor)) && !admin) {
      throw new BadRequestException('Quien cargó el corte no puede alistarlo, salvo el administrador.');
    }
    await this.db.transaction(async (client) => {
      await client.query(`UPDATE "AsignacionDespacho" SET "anulado" = true WHERE "corteId" = $1`, [corteId]);
      for (const id of dto.usuarioIds) {
        const persona = await client.query(`SELECT 1 FROM "Usuario" WHERE "idUsuario" = $1 AND "activo" = true`, [id]);
        if (!persona.rowCount) {
          throw new BadRequestException('Hay una persona que no está activa.');
        }
        await client.query(
          `INSERT INTO "AsignacionDespacho" ("corteId", "usuarioId", "anulado") VALUES ($1, $2, false)
           ON CONFLICT ("corteId", "usuarioId") DO UPDATE SET "anulado" = false`,
          [corteId, id],
        );
      }
      await this.registrar(client, usuarioId, 'corte.asignar', `${corteId}|${dto.usuarioIds.join(',')}`);
    });
    return { data: { corteId } };
  }

  async alistamiento(corteId: string) {
    const filas = await this.db.query(
      `SELECT a."idAlistamiento", a."cantidad", a."revisado", a."embolsado", a."empacado",
              p."codigoInterno", p."nombre"
       FROM "AlistamientoDespacho" a
       JOIN "Producto" p ON p."idProducto" = a."productoId"
       WHERE a."corteId" = $1
       ORDER BY p."nombre"`,
      [corteId],
    );
    return { data: filas };
  }

  async marcar(alistamientoId: string, dto: EtapaDto, usuarioId: string) {
    await this.db.transaction(async (client) => {
      const fila = await client.query<{
        corteId: string;
        revisado: boolean;
        embolsado: boolean;
        empacado: boolean;
      }>(
        `SELECT "corteId", "revisado", "embolsado", "empacado"
         FROM "AlistamientoDespacho" WHERE "idAlistamiento" = $1`,
        [alistamientoId],
      );
      const actual = fila.rows[0];
      if (!actual) {
        throw new NotFoundException('Ese producto no está en el alistamiento.');
      }
      const admin = await this.esAdmin(usuarioId);
      const asignado = await client.query(
        `SELECT 1 FROM "AsignacionDespacho" WHERE "corteId" = $1 AND "usuarioId" = $2 AND "anulado" = false`,
        [actual.corteId, usuarioId],
      );
      if (!admin && !asignado.rowCount) {
        throw new BadRequestException('Solo quien está asignado al corte marca las etapas.');
      }
      const estado = { revisado: actual.revisado, embolsado: actual.embolsado, empacado: actual.empacado };
      if (dto.hecho) {
        const indice = ETAPAS.indexOf(dto.etapa);
        if (indice > 0 && !estado[ETAPAS[indice - 1]]) {
          throw new BadRequestException('Primero hay que completar la etapa anterior.');
        }
        estado[dto.etapa] = true;
      } else {
        const indice = ETAPAS.indexOf(dto.etapa);
        for (const etapa of ETAPAS.slice(indice)) {
          estado[etapa] = false;
        }
      }
      await client.query(
        `UPDATE "AlistamientoDespacho"
         SET "revisado" = $2, "embolsado" = $3, "empacado" = $4,
             "revisadoPor" = CASE WHEN $2 THEN $5 ELSE NULL END,
             "embolsadoPor" = CASE WHEN $3 THEN $5 ELSE NULL END,
             "empacadoPor" = CASE WHEN $4 THEN $5 ELSE NULL END
         WHERE "idAlistamiento" = $1`,
        [alistamientoId, estado.revisado, estado.embolsado, estado.empacado, usuarioId],
      );
      await this.registrar(client, usuarioId, 'alistamiento.marcar', `${alistamientoId}|${dto.etapa}|${dto.hecho}`);
    });
    return { data: { idAlistamiento: alistamientoId } };
  }

  async excel(fecha: string) {
    const filas = await this.db.query<{ alias: string; numero: number; codigo: string; nombre: string; cantidad: number }>(
      `SELECT t."nombre" AS alias, c."numero", p."codigoInterno" AS codigo, p."nombre", a."cantidad"
       FROM "AlistamientoDespacho" a
       JOIN "CorteDespacho" c ON c."idCorte" = a."corteId"
       JOIN "TransportadoraDespacho" t ON t."idTransportadora" = c."transportadoraId"
       JOIN "Producto" p ON p."idProducto" = a."productoId"
       WHERE c."fecha" = $1 AND c."anulado" = false`,
      [fecha],
    );
    const libro = new Workbook();
    const productos = new Map<string, { codigo: string; nombre: string }>();
    const cantidades = new Map<string, number>();
    for (const fila of filas) {
      productos.set(fila.codigo, { codigo: fila.codigo, nombre: fila.nombre });
      const numero = fila.numero >= 1 && fila.numero <= 6 ? fila.numero : 0;
      if (numero) {
        const clave = `${fila.alias}|${fila.codigo}|${numero}`;
        cantidades.set(clave, (cantidades.get(clave) ?? 0) + Number(fila.cantidad));
      }
    }
    for (const hojaNombre of HOJAS) {
      const hoja = libro.addWorksheet(hojaNombre);
      hoja.addRow(['Código', 'PRODUCTO', 'CORTE 1', 'CORTE 2', 'CORTE 3', 'CORTE 4', 'CORTE 5', 'CORTE 6', 'TOTAL']);
      for (const producto of productos.values()) {
        const valores = [1, 2, 3, 4, 5, 6].map((numero) => cantidades.get(`${hojaNombre}|${producto.codigo}|${numero}`) ?? 0);
        const total = valores.reduce((suma, valor) => suma + valor, 0);
        hoja.addRow([producto.codigo, producto.nombre, ...valores, total]);
      }
    }
    return {
      filename: `corte-${fecha}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await libro.xlsx.writeBuffer()),
    };
  }

  async guias(corteId: string) {
    const filas = await this.db.query(
      `SELECT g."idGuia", g."numero", g."ciudad", g."estado",
              r."motivo", r."corteReasignacionId"
       FROM "GuiaDespacho" g
       LEFT JOIN "RepresadoDespacho" r ON r."guiaId" = g."idGuia" AND r."anulado" = false
       WHERE g."corteId" = $1 AND g."anulado" = false
       ORDER BY g."consecutivo", g."numero"`,
      [corteId],
    );
    const conteo = await this.conteoGuias(corteId);
    return { data: { guias: filas, ...conteo } };
  }

  async escanear(corteId: string, codigo: string, usuarioId: string) {
    if (!codigo.trim()) {
      throw new BadRequestException('El lector no envió un código.');
    }
    return this.db.transaction(async (client) => {
      const corte = await this.corteAbierto(client, corteId);
      const transportadora = await client.query<{ prefijo: string }>(
        `SELECT "prefijo" FROM "TransportadoraDespacho" WHERE "idTransportadora" = $1`,
        [corte.transportadoraId],
      );
      const normalizado = this.normalizarCodigo(codigo, transportadora.rows[0]?.prefijo ?? '');
      const guia = await client.query<{ idGuia: string; estado: string }>(
        `SELECT "idGuia", "estado" FROM "GuiaDespacho"
         WHERE "corteId" = $1 AND "numero" = $2 AND "anulado" = false`,
        [corteId, normalizado],
      );
      const hallada = guia.rows[0];
      let resultado: string;
      let mensaje: string;
      if (hallada?.estado === 'verificada') {
        await this.insertarEscaneo(client, hallada.idGuia, corteId, codigo, normalizado, 'repetido', usuarioId);
        await this.registrar(client, usuarioId, 'escaneo.repetido', normalizado);
        resultado = 'repetido';
        mensaje = 'Esta guía ya fue verificada. El conteo no cambia.';
      } else if (hallada?.estado === 'represada') {
        await this.insertarEscaneo(client, hallada.idGuia, corteId, codigo, normalizado, 'represada', usuarioId);
        await this.registrar(client, usuarioId, 'escaneo.represada', normalizado);
        resultado = 'represada';
        mensaje = 'Esta guía está represada. El conteo no cambia.';
      } else if (hallada) {
        await client.query(`UPDATE "GuiaDespacho" SET "estado" = 'verificada' WHERE "idGuia" = $1`, [hallada.idGuia]);
        await this.insertarEscaneo(client, hallada.idGuia, corteId, codigo, normalizado, 'verificada', usuarioId);
        await this.registrar(client, usuarioId, 'escaneo.verificar', normalizado);
        resultado = 'verificada';
        mensaje = `Guía ${normalizado} verificada.`;
      } else {
        const otra = await client.query<{ numero: number; fecha: string }>(
          `SELECT c."numero", c."fecha"::text AS fecha
           FROM "GuiaDespacho" g
           JOIN "CorteDespacho" c ON c."idCorte" = g."corteId"
           WHERE g."numero" = $1 AND c."idCorte" <> $2 AND c."anulado" = false AND g."anulado" = false
           ORDER BY c."idCorte" DESC LIMIT 1`,
          [normalizado, corteId],
        );
        if (otra.rows[0]) {
          resultado = 'otro_corte';
          mensaje = `La guía ${normalizado} está en el corte ${otra.rows[0].numero} del ${String(otra.rows[0].fecha).slice(0, 10)}.`;
        } else {
          resultado = 'no_encontrada';
          mensaje = `La guía ${normalizado} no está en este corte.`;
        }
        await this.insertarEscaneo(client, null, corteId, codigo, normalizado, resultado, usuarioId);
        await this.registrar(client, usuarioId, `escaneo.${resultado}`, normalizado);
      }
      const conteo = await this.conteoGuias(corteId, client);
      return { data: { resultado, mensaje, numero: normalizado, ...conteo } };
    });
  }

  async represar(guiaId: string, motivo: string, usuarioId: string) {
    const texto = motivo.trim();
    if (!texto) {
      throw new BadRequestException('El represado necesita un motivo.');
    }
    await this.db.transaction(async (client) => {
      const guia = await client.query<{ idGuia: string; corteId: string; numero: string }>(
        `SELECT "idGuia", "corteId", "numero" FROM "GuiaDespacho" WHERE "idGuia" = $1 AND "anulado" = false`,
        [guiaId],
      );
      const fila = guia.rows[0];
      if (!fila) {
        throw new BadRequestException('Esa guía no está disponible.');
      }
      await this.corteAbierto(client, fila.corteId);
      await client.query(`UPDATE "GuiaDespacho" SET "estado" = 'represada' WHERE "idGuia" = $1`, [guiaId]);
      const vigente = await client.query<{ idRepresado: string }>(
        `SELECT "idRepresado" FROM "RepresadoDespacho" WHERE "guiaId" = $1 AND "anulado" = false`,
        [guiaId],
      );
      if (vigente.rows[0]) {
        await client.query(
          `UPDATE "RepresadoDespacho" SET "motivo" = $2, "responsableId" = $3 WHERE "idRepresado" = $1`,
          [vigente.rows[0].idRepresado, texto, usuarioId],
        );
      } else {
        await client.query(
          `INSERT INTO "RepresadoDespacho" ("guiaId", "motivo", "responsableId") VALUES ($1, $2, $3)`,
          [guiaId, texto, usuarioId],
        );
      }
      await this.registrar(client, usuarioId, 'represado.crear', `${fila.numero}|${texto}`);
    });
    return { data: { guiaId } };
  }

  async reprogramar(guiaId: string, corteDestinoId: string, usuarioId: string) {
    await this.db.transaction(async (client) => {
      const guia = await client.query<{ numero: string; corteId: string }>(
        `SELECT "numero", "corteId" FROM "GuiaDespacho" WHERE "idGuia" = $1 AND "estado" = 'represada' AND "anulado" = false`,
        [guiaId],
      );
      const fila = guia.rows[0];
      if (!fila) {
        throw new BadRequestException('Solo se reprograma una guía represada.');
      }
      if (corteDestinoId === String(fila.corteId)) {
        throw new BadRequestException('Elige un corte distinto del actual.');
      }
      const destino = await client.query<{ estado: string }>(
        `SELECT "estado" FROM "CorteDespacho" WHERE "idCorte" = $1 AND "anulado" = false`,
        [corteDestinoId],
      );
      if (!destino.rows[0] || destino.rows[0].estado === 'cerrado') {
        throw new BadRequestException('El corte de destino no está abierto.');
      }
      await client.query(
        `UPDATE "RepresadoDespacho" SET "corteReasignacionId" = $2 WHERE "guiaId" = $1 AND "anulado" = false`,
        [guiaId, corteDestinoId],
      );
      await this.registrar(client, usuarioId, 'represado.reprogramar', `${fila.numero}|corte ${corteDestinoId}`);
    });
    return { data: { guiaId } };
  }

  async cerrar(corteId: string, dto: CerrarCorteDto, usuarioId: string) {
    const auxiliar = dto.auxiliar.trim();
    if (!auxiliar) {
      throw new BadRequestException('Indica el auxiliar que recibe la entrega.');
    }
    await this.db.transaction(async (client) => {
      const corte = await this.corteAbierto(client, corteId);
      const pendientes = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "GuiaDespacho"
         WHERE "corteId" = $1 AND "anulado" = false AND "estado" = 'pendiente'`,
        [corteId],
      );
      if (Number(pendientes.rows[0].n) > 0) {
        throw new BadRequestException(`Quedan ${pendientes.rows[0].n} guías sin verificar ni represar.`);
      }
      const sinEmpacar = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "AlistamientoDespacho" WHERE "corteId" = $1 AND "empacado" = false`,
        [corteId],
      );
      if (Number(sinEmpacar.rows[0].n) > 0 && !dto.motivoCierre?.trim()) {
        throw new BadRequestException('El alistamiento no está terminado. Deja el motivo para cerrar igual.');
      }
      await client.query(
        `UPDATE "CorteDespacho"
         SET "estado" = 'cerrado', "auxiliar" = $2, "placa" = $3, "horaEntrega" = $4, "motivoCierre" = $5
         WHERE "idCorte" = $1`,
        [corteId, auxiliar, dto.placa?.trim() ?? '', dto.hora?.trim() ?? '', dto.motivoCierre?.trim() ?? ''],
      );
      await this.registrar(client, usuarioId, 'corte.cerrar', `corte ${corte.numero}|${auxiliar}`);
    });
    return { data: { corteId } };
  }

  async definirPrefijo(dto: PrefijoDto, usuarioId: string) {
    const prefijo = dto.prefijo.replace(/\s+/g, '').toUpperCase();
    await this.db.transaction(async (client) => {
      const existe = await client.query(`SELECT 1 FROM "TransportadoraDespacho" WHERE "idTransportadora" = $1`, [
        dto.transportadoraId,
      ]);
      if (!existe.rowCount) {
        throw new BadRequestException('Esa transportadora no está registrada.');
      }
      await client.query(`UPDATE "TransportadoraDespacho" SET "prefijo" = $2 WHERE "idTransportadora" = $1`, [
        dto.transportadoraId,
        prefijo,
      ]);
      await this.registrar(client, usuarioId, 'prefijo.definir', `${dto.transportadoraId}|${prefijo}`);
    });
    return { data: { prefijo } };
  }

  async transportadoras() {
    const filas = await this.db.query(
      `SELECT "idTransportadora", "nombre", "nombreDropi", "prefijo"
       FROM "TransportadoraDespacho" WHERE "activa" = true ORDER BY "orden"`,
    );
    return { data: filas };
  }

  async cortesAbiertos(exceptoId: string) {
    const filas = await this.db.query(
      `SELECT c."idCorte", c."numero", c."fecha"::text AS fecha, t."nombre" AS transportadora
       FROM "CorteDespacho" c
       JOIN "TransportadoraDespacho" t ON t."idTransportadora" = c."transportadoraId"
       WHERE c."anulado" = false AND c."estado" = 'abierto' AND c."idCorte" <> $1
       ORDER BY c."fecha" DESC, c."numero"`,
      [exceptoId],
    );
    return { data: filas };
  }

  private async preparar(lectura: Lectura) {
    const resumen = await this.aplicarEquivalencias(lectura.resumen);
    const bloqueos: string[] = [];
    const avisos = [...(lectura.avisos ?? [])];
    const transportadora = await this.resolverTransportadora(lectura.transportadora);
    if (!transportadora) {
      bloqueos.push(`La transportadora «${lectura.transportadora || 'sin nombre'}» no está registrada.`);
    }
    if (!lectura.fecha) {
      bloqueos.push('El PDF no trae la fecha del manifiesto.');
    }
    if (!lectura.guias.length) {
      bloqueos.push('El PDF no trae guías.');
    }
    if (!lectura.resumen.length) {
      bloqueos.push('El PDF no trae el resumen de productos.');
    }
    const faltan = resumen.filter((item) => !item.productoId && (item.idDropi || item.sku || item.nombre));
    if (faltan.length) {
      bloqueos.push(`Faltan ${faltan.length} productos por asociar. El corte no se guarda hasta terminar la lista.`);
    }
    const repetido = await this.db.one(
      `SELECT c."numero", c."fecha", t."nombre" AS transportadora
       FROM "ArchivoDespacho" a
       JOIN "CorteDespacho" c ON c."idCorte" = a."corteId"
       JOIN "TransportadoraDespacho" t ON t."idTransportadora" = c."transportadoraId"
       WHERE a."huella" = $1`,
      [lectura.huella],
    );
    if (repetido) {
      bloqueos.push(`Este PDF ya se cargó en el corte ${repetido.numero} de ${repetido.transportadora} del ${String(repetido.fecha).slice(0, 10)}.`);
    }
    if (lectura.guias.length) {
      const numeros = lectura.guias.map((guia) => guia.numero);
      const previas = await this.db.query<{ numero: string; corte: number; fecha: string }>(
        `SELECT g."numero", c."numero" AS corte, c."fecha"
         FROM "GuiaDespacho" g
         JOIN "CorteDespacho" c ON c."idCorte" = g."corteId"
         WHERE g."numero" = ANY($1::text[]) AND c."anulado" = false AND g."anulado" = false`,
        [numeros],
      );
      for (const previa of previas) {
        avisos.push(`La guía ${previa.numero} ya está en el corte ${previa.corte} del ${String(previa.fecha).slice(0, 10)}. Puedes continuar.`);
      }
    }
    const firmable = this.canonico(lectura);
    return {
      ...lectura,
      resumen,
      avisos,
      bloqueos,
      transportadoraId: transportadora?.idTransportadora ?? null,
      firma: this.firmar(firmable),
    };
  }

  private async aplicarEquivalencias(resumen: ResumenLecturaDto[]): Promise<ResumenListo[]> {
    const salida: ResumenListo[] = [];
    for (const item of resumen) {
      const fila = await this.db.one<{ productoId: string }>(
        `SELECT "productoId" FROM "EquivalenciaDropi" WHERE "skuDropi" = $1 AND "idDropi" = $2`,
        [item.sku, item.idDropi],
      );
      salida.push({ ...item, productoId: fila?.productoId ?? null });
    }
    return salida;
  }

  private async resolverTransportadora(texto: string) {
    const buscado = this.normalizar(texto);
    const filas = await this.db.query<{ idTransportadora: string; nombre: string; nombreDropi: string; alias: string }>(
      `SELECT "idTransportadora", "nombre", "nombreDropi", "alias" FROM "TransportadoraDespacho" WHERE "activa" = true`,
    );
    return (
      filas.find((fila) =>
        [fila.nombre, fila.nombreDropi, fila.alias].some((candidato) => this.normalizar(candidato) === buscado),
      ) ?? null
    );
  }

  private async leerPdf(archivo: Express.Multer.File): Promise<Lectura> {
    const carpeta = await mkdtemp(join(tmpdir(), 'dropi-'));
    const ruta = join(carpeta, 'manifiesto.pdf');
    await writeFile(ruta, archivo.buffer);
    try {
      const script = join(process.cwd(), 'scripts', 'leer_dropi.py');
      const python = process.env.PYTHON || 'python';
      const salida = await new Promise<string>((resolve, reject) => {
        const proceso = spawn(python, [script, ruta], { windowsHide: true });
        let stdout = '';
        let stderr = '';
        proceso.stdout.on('data', (dato) => {
          stdout += dato.toString();
        });
        proceso.stderr.on('data', (dato) => {
          stderr += dato.toString();
        });
        proceso.on('error', reject);
        proceso.on('close', (codigo) => {
          if (codigo !== 0) {
            reject(new BadRequestException(stderr.trim() || 'No se pudo leer el PDF.'));
            return;
          }
          resolve(stdout);
        });
      });
      return JSON.parse(salida) as Lectura;
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }

  private canonico(lectura: Lectura) {
    return JSON.stringify({
      fecha: lectura.fecha,
      guias: lectura.guias,
      huella: lectura.huella,
      nombreArchivo: lectura.nombreArchivo,
      paginas: lectura.paginas,
      resumen: lectura.resumen.map((item) => ({
        cantidad: item.cantidad,
        idDropi: item.idDropi,
        nombre: item.nombre,
        sku: item.sku,
      })),
      transportadora: lectura.transportadora,
    });
  }

  private firmar(material: string) {
    return createHmac('sha256', process.env.JWT_SECRET || 'change_me').update(material).digest('hex');
  }

  private verificarFirma(dto: GuardarCorteDto) {
    const material = this.canonico(dto);
    const esperada = this.firmar(material);
    const recibida = Buffer.from(dto.firma);
    const firma = Buffer.from(esperada);
    if (recibida.length !== firma.length || !timingSafeEqual(recibida, firma)) {
      throw new BadRequestException('La lectura del PDF no coincide. Vuelve a cargar el manifiesto.');
    }
  }

  private async esAdmin(usuarioId: string) {
    const fila = await this.db.one(
      `SELECT 1 AS ok
       FROM "UsuarioRol" ur
       JOIN "Rol" r ON r."idRol" = ur."rolId"
       WHERE ur."usuarioId" = $1 AND r."nombre" = 'ADMIN'`,
      [usuarioId],
    );
    return Boolean(fila);
  }

  private async corteAbierto(client: PoolClient, corteId: string) {
    const corte = await client.query<{ idCorte: string; numero: number; estado: string; transportadoraId: string }>(
      `SELECT "idCorte", "numero", "estado", "transportadoraId"
       FROM "CorteDespacho" WHERE "idCorte" = $1 AND "anulado" = false`,
      [corteId],
    );
    const fila = corte.rows[0];
    if (!fila) {
      throw new BadRequestException('Ese corte no está disponible.');
    }
    if (fila.estado === 'cerrado') {
      throw new BadRequestException('Este corte ya está cerrado.');
    }
    return fila;
  }

  private async conteoGuias(corteId: string, client?: PoolClient) {
    const consulta = client ?? this.db.pool;
    const fila = await consulta.query<{ total: string; verificadas: string; represadas: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE "estado" = 'verificada')::text AS verificadas,
              COUNT(*) FILTER (WHERE "estado" = 'represada')::text AS represadas
       FROM "GuiaDespacho"
       WHERE "corteId" = $1 AND "anulado" = false`,
      [corteId],
    );
    const conteo = fila.rows[0];
    return {
      total: Number(conteo?.total ?? 0),
      verificadas: Number(conteo?.verificadas ?? 0),
      represadas: Number(conteo?.represadas ?? 0),
    };
  }

  private async insertarEscaneo(
    client: PoolClient,
    guiaId: string | null,
    corteId: string,
    codigo: string,
    normalizado: string,
    resultado: string,
    usuarioId: string,
  ) {
    await client.query(
      `INSERT INTO "EscaneoDespacho"
        ("guiaId", "corteId", "codigoLeido", "codigoNormalizado", "resultado", "usuarioId")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [guiaId, corteId, codigo.trim(), normalizado, resultado, usuarioId],
    );
  }

  private normalizarCodigo(codigo: string, prefijo: string) {
    const limpio = codigo.replace(/\s+/g, '').toUpperCase();
    const prefijoLimpio = prefijo.replace(/\s+/g, '').toUpperCase();
    if (prefijoLimpio && limpio.startsWith(prefijoLimpio)) {
      return limpio.slice(prefijoLimpio.length);
    }
    return limpio;
  }

  private async registrar(client: PoolClient, usuarioId: string, accion: string, detalle: string) {
    const anterior = await client.query<{ huella: string }>(
      `SELECT "huella" FROM "AuditoriaDespacho" ORDER BY "idAuditoria" DESC LIMIT 1`,
    );
    const previa = anterior.rows[0]?.huella ?? '0'.repeat(64);
    const fecha = new Date().toISOString();
    const huella = createHash('sha256').update(`${previa}|${fecha}|${usuarioId}|${accion}|${detalle}`).digest('hex');
    await client.query(
      `INSERT INTO "AuditoriaDespacho" ("fecha", "usuarioId", "accion", "detalle", "huellaAnterior", "huella")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [fecha, usuarioId, accion, detalle, previa, huella],
    );
  }

  private normalizar(texto: string) {
    return texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
