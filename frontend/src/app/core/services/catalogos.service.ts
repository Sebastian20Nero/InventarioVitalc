import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Bodega, Categoria, Unidad } from '../models/inventario.models';

@Injectable({ providedIn: 'root' })
export class CatalogosService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  listarCategorias() {
    return this.http
      .get<{ data: Categoria[] }>(`${this.base}/catalogos/categorias`)
      .pipe(map((r) => r.data));
  }

  crearCategoria(body: { nombre: string; descripcion?: string }) {
    return this.http
      .post<{ data: Categoria; message: string }>(`${this.base}/catalogos/categorias`, body)
      .pipe(map((r) => r.data));
  }

  actualizarCategoria(id: string, body: { nombre?: string; descripcion?: string; activo?: boolean }) {
    return this.http
      .put<{ data: Categoria; message: string }>(`${this.base}/catalogos/categorias/${id}`, body)
      .pipe(map((r) => r.data));
  }

  listarUnidades() {
    return this.http
      .get<{ data: Unidad[] }>(`${this.base}/catalogos/unidades`)
      .pipe(map((r) => r.data));
  }

  crearUnidad(body: { nombre: string; abreviatura: string }) {
    return this.http
      .post<{ data: Unidad; message: string }>(`${this.base}/catalogos/unidades`, body)
      .pipe(map((r) => r.data));
  }

  actualizarUnidad(id: string, body: { nombre?: string; abreviatura?: string; activo?: boolean }) {
    return this.http
      .put<{ data: Unidad; message: string }>(`${this.base}/catalogos/unidades/${id}`, body)
      .pipe(map((r) => r.data));
  }

  listarBodegas() {
    return this.http
      .get<{ data: Bodega[] }>(`${this.base}/catalogos/bodegas`)
      .pipe(map((r) => r.data));
  }

  crearBodega(body: { nombre: string; descripcion?: string }) {
    return this.http
      .post<{ data: Bodega; message: string }>(`${this.base}/catalogos/bodegas`, body)
      .pipe(map((r) => r.data));
  }

  actualizarBodega(id: string, body: { nombre?: string; descripcion?: string; activo?: boolean }) {
    return this.http
      .put<{ data: Bodega; message: string }>(`${this.base}/catalogos/bodegas/${id}`, body)
      .pipe(map((r) => r.data));
  }
}
