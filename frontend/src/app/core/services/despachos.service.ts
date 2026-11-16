import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface ResumenDropi {
  sku: string;
  idDropi: string;
  nombre: string;
  cantidad: number;
  productoId: string | null;
}

export interface LecturaDropi {
  transportadora: string;
  fecha: string;
  nombreArchivo: string;
  huella: string;
  paginas: number;
  avisos: string[];
  validaciones: { titulo: string; ok: boolean; detalle: string }[];
  unidadesRotulos: number;
  unidadesResumen: number;
  guias: { numero: string; consecutivo: number | null; ciudad: string; recaudo: string; tipo: string; textoRotulo: string }[];
  resumen: ResumenDropi[];
  bloqueos: string[];
  firma: string;
}

@Injectable({ providedIn: 'root' })
export class DespachosService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/despachos`;

  revisar(archivo: File) {
    const datos = new FormData();
    datos.append('archivo', archivo);
    return this.http.post<{ data: LecturaDropi }>(`${this.base}/revisar`, datos);
  }

  asociar(body: { sku: string; idDropi: string; nombre: string; productoId: string }) {
    return this.http.post<{ data: { productoId: string } }>(`${this.base}/equivalencias`, body);
  }

  guardar(lectura: LecturaDropi, numero: number) {
    return this.http.post<{ data: { idCorte: string } }>(`${this.base}/cortes`, {
      numero,
      firma: lectura.firma,
      transportadora: lectura.transportadora,
      fecha: lectura.fecha,
      huella: lectura.huella,
      nombreArchivo: lectura.nombreArchivo,
      paginas: lectura.paginas,
      guias: lectura.guias,
      resumen: lectura.resumen.map((item) => ({
        sku: item.sku,
        idDropi: item.idDropi,
        nombre: item.nombre,
        cantidad: item.cantidad,
      })),
    });
  }

  tablero(fecha: string) {
    return this.http.get<{ data: Record<string, string | number>[] }>(`${this.base}/tablero`, { params: { fecha } });
  }

  usuarios() {
    return this.http.get<{ data: { idUsuario: string; nombres: string; apellidos: string }[] }>(`${this.base}/usuarios`);
  }

  asignar(corteId: string, usuarioIds: string[]) {
    return this.http.post(`${this.base}/cortes/${corteId}/asignar`, { usuarioIds });
  }

  alistamiento(corteId: string) {
    return this.http.get<{ data: Record<string, string | number | boolean>[] }>(`${this.base}/cortes/${corteId}/alistamiento`);
  }

  marcar(id: string, etapa: string, hecho: boolean) {
    return this.http.post(`${this.base}/alistamiento/${id}/etapa`, { etapa, hecho });
  }

  guias(corteId: string) {
    return this.http.get<{
      data: {
        total: number;
        verificadas: number;
        represadas: number;
        guias: { idGuia: string; numero: string; ciudad: string; estado: string; motivo: string | null; corteReasignacionId: string | null }[];
      };
    }>(`${this.base}/cortes/${corteId}/guias`);
  }

  escanear(corteId: string, codigo: string) {
    return this.http.post<{ data: { resultado: string; mensaje: string; total: number; verificadas: number; represadas: number } }>(
      `${this.base}/cortes/${corteId}/escanear`,
      { codigo },
    );
  }

  represar(guiaId: string, motivo: string) {
    return this.http.post(`${this.base}/guias/${guiaId}/represar`, { motivo });
  }

  reprogramar(guiaId: string, corteDestinoId: string) {
    return this.http.post(`${this.base}/guias/${guiaId}/reprogramar`, { corteDestinoId });
  }

  cerrar(corteId: string, body: { auxiliar: string; placa?: string; hora?: string; motivoCierre?: string }) {
    return this.http.post(`${this.base}/cortes/${corteId}/cerrar`, body);
  }

  cortesAbiertos(excepto: string) {
    return this.http.get<{ data: { idCorte: string; numero: number; fecha: string; transportadora: string }[] }>(
      `${this.base}/cortes-abiertos`,
      { params: { excepto } },
    );
  }

  excel(fecha: string) {
    return this.http.get(`${this.base}/excel`, { params: { fecha }, responseType: 'blob' });
  }
}
