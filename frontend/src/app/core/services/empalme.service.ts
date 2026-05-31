import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MovimientoInventario } from './inventario.service';

export interface RevisionEmpalme {
  idRevision: string;
  movimientoId: string;
  usuarioId: string;
  accion: string;
  observacion: string | null;
  createdAt: string;
  usuario: { nombres: string; apellidos: string };
}

export interface MovimientoEmpalme extends MovimientoInventario {
  revisiones: RevisionEmpalme[];
}

export interface ConfiguracionDsnube {
  idConfiguracion: string;
  url: string;
  usuario: string;
  password?: string;
  activo: boolean;
}

export interface ReporteEmpalme {
  resumen: {
    total: number;
    pendientes: number;
    observados: number;
    listos: number;
    cargados: number;
  };
  movimientos: MovimientoEmpalme[];
}

@Injectable({ providedIn: 'root' })
export class EmpalmeService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/empalme`;

  listarMovimientos() {
    return this.http
      .get<{ data: MovimientoEmpalme[] }>(`${this.base}/movimientos`)
      .pipe(map((r) => r.data));
  }

  revisar(id: string, observacion?: string) {
    return this.http
      .post<{ data: MovimientoEmpalme; message: string }>(
        `${this.base}/movimientos/${id}/revisar`,
        { observacion },
      )
      .pipe(map((r) => r.data));
  }

  observar(id: string, observacion?: string) {
    return this.http
      .post<{ data: MovimientoEmpalme; message: string }>(
        `${this.base}/movimientos/${id}/observar`,
        { observacion },
      )
      .pipe(map((r) => r.data));
  }

  marcarListo(id: string, observacion?: string) {
    return this.http
      .post<{ data: MovimientoEmpalme; message: string }>(
        `${this.base}/movimientos/${id}/marcar-listo`,
        { observacion },
      )
      .pipe(map((r) => r.data));
  }

  marcarCargado(id: string, observacion?: string) {
    return this.http
      .post<{ data: MovimientoEmpalme; message: string }>(
        `${this.base}/movimientos/${id}/marcar-cargado`,
        { observacion },
      )
      .pipe(map((r) => r.data));
  }

  obtenerReporte() {
    return this.http
      .get<{ data: ReporteEmpalme }>(`${this.base}/reporte`)
      .pipe(map((r) => r.data));
  }

  exportarReporte(formato: 'excel' | 'pdf') {
    return this.http.get(`${this.base}/reporte/exportar?formato=${formato}`, {
      responseType: 'blob',
      observe: 'response',
    });
  }

  descargarPlantilla() {
    return this.http.get(`${this.base}/importar/plantilla`, {
      responseType: 'blob',
      observe: 'response',
    });
  }

  importarExcel(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return this.http
      .post<{ data: { procesados: number; errores: string[] }; message: string }>(
        `${this.base}/importar`,
        fd,
      )
      .pipe(map((r) => r.data));
  }

  importarConsecutivos(consecutivos: string[]) {
    return this.http
      .post<{ data: { procesados: number; errores: string[] }; message: string }>(
        `${this.base}/importar/consecutivos`,
        { consecutivos },
      )
      .pipe(map((r) => r.data));
  }

  obtenerConfiguracion() {
    return this.http
      .get<{ data: ConfiguracionDsnube | null }>(`${this.base}/configuracion-dsnube`)
      .pipe(map((r) => r.data));
  }

  guardarConfiguracion(body: { url: string; usuario: string; password?: string }) {
    return this.http
      .post<{ data: ConfiguracionDsnube; message: string }>(
        `${this.base}/configuracion-dsnube`,
        body,
      )
      .pipe(map((r) => r.data));
  }
}
