import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface StockProductoBodega {
  idStock: string;
  productoId: string;
  bodegaId: string;
  stockActual: string;
  updatedAt: string;
  producto: { idProducto: string; nombre: string; codigoInterno: string };
  bodega: { idBodega: string; nombre: string };
}

export interface MovimientoInventario {
  idMovimiento: string;
  consecutivo: string;
  productoId: string;
  bodegaId: string;
  tipoMovimiento: string;
  cantidad: string;
  stockAnterior: string;
  stockNuevo: string;
  observacion: string | null;
  estadoMovimiento: string;
  estadoEmpalme: string;
  creadoPor: string;
  createdAt: string;
  motivoAnulacion: string | null;
  producto: { nombre: string; codigoInterno: string };
  bodega: { nombre: string };
  creador: { nombres: string; apellidos: string };
}

export const TIPOS_MOVIMIENTO = [
  { value: 'SALDO_INICIAL', label: 'Saldo inicial', signo: '+' },
  { value: 'ENTRADA', label: 'Entrada', signo: '+' },
  { value: 'ABASTECIMIENTO', label: 'Abastecimiento', signo: '+' },
  { value: 'SALIDA', label: 'Salida', signo: '-' },
  { value: 'AJUSTE_POSITIVO', label: 'Ajuste positivo', signo: '+' },
  { value: 'AJUSTE_NEGATIVO', label: 'Ajuste negativo', signo: '-' },
] as const;

@Injectable({ providedIn: 'root' })
export class InventarioService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  listarStock() {
    return this.http
      .get<{ data: StockProductoBodega[] }>(`${this.base}/inventario/stock`)
      .pipe(map((r) => r.data));
  }

  obtenerStockProductoBodega(productoId: string, bodegaId: string) {
    return this.http
      .get<{ data: StockProductoBodega }>(`${this.base}/inventario/stock/${productoId}/${bodegaId}`)
      .pipe(map((r) => r.data));
  }

  stockPorProducto(productoId: string) {
    return this.listarStock().pipe(
      map((lista) => lista.filter((s) => s.productoId === productoId)),
    );
  }

  listarMovimientos() {
    return this.http
      .get<{ data: MovimientoInventario[] }>(`${this.base}/inventario/movimientos`)
      .pipe(map((r) => r.data));
  }

  obtenerMovimiento(id: string) {
    return this.http
      .get<{ data: MovimientoInventario }>(`${this.base}/inventario/movimientos/${id}`)
      .pipe(map((r) => r.data));
  }

  registrarMovimiento(body: {
    productoId: string;
    bodegaId: string;
    tipoMovimiento: string;
    cantidad: string;
    observacion?: string;
  }) {
    return this.http
      .post<{ data: MovimientoInventario; message: string }>(
        `${this.base}/inventario/movimientos`,
        body,
      )
      .pipe(map((r) => r.data));
  }

  anularMovimiento(id: string, motivoAnulacion: string) {
    return this.http
      .patch<{ data: MovimientoInventario; message: string }>(
        `${this.base}/inventario/movimientos/${id}/anular`,
        { motivoAnulacion },
      )
      .pipe(map((r) => r.data));
  }

  descargarPlantillaStock() {
    return this.http.get(`${this.base}/inventario/stock/plantilla-excel`, {
      responseType: 'blob',
      observe: 'response',
    });
  }

  importarStockExcel(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ procesados: number; errores: string[] }>(
      `${this.base}/inventario/stock/importar-excel`,
      fd,
    );
  }
}
