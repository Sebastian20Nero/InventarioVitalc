import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Producto } from '../models/inventario.models';

@Injectable({ providedIn: 'root' })
export class ProductosService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  listar() {
    return this.http
      .get<{ data: Producto[] }>(`${this.base}/productos`)
      .pipe(map((r) => r.data));
  }

  obtenerPorId(id: string) {
    return this.http
      .get<{ data: Producto }>(`${this.base}/productos/${id}`)
      .pipe(map((r) => r.data));
  }

  crear(body: {
    codigoInterno: string;
    nombre: string;
    descripcion?: string;
    categoriaId: string;
    unidadId: string;
    stockMinimo?: string;
  }) {
    return this.http
      .post<{ data: Producto; message: string }>(`${this.base}/productos`, body)
      .pipe(map((r) => r.data));
  }

  actualizar(
    id: string,
    body: {
      codigoInterno?: string;
      nombre?: string;
      descripcion?: string;
      categoriaId?: string;
      unidadId?: string;
      stockMinimo?: string;
    },
  ) {
    return this.http
      .put<{ data: Producto; message: string }>(`${this.base}/productos/${id}`, body)
      .pipe(map((r) => r.data));
  }

  importarMaestro(archivo: File) {
    const datos = new FormData();
    datos.append('archivo', archivo);
    return this.http.post<{
      data: { creados: number; actualizados: number; omitidos: number; errores: { fila: number; codigo: string; mensaje: string }[] };
      message: string;
    }>(`${this.base}/productos/maestro`, datos);
  }

  actualizarEstado(id: string, activo: boolean) {
    return this.http
      .patch<{ data: Producto; message: string }>(`${this.base}/productos/${id}/estado`, { activo })
      .pipe(map((r) => r.data));
  }
}
