import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogosService } from '../../core/services/catalogos.service';
import { Bodega, Categoria, Unidad } from '../../core/models/inventario.models';

type Tab = 'categorias' | 'unidades' | 'bodegas';

@Component({
  selector: 'app-catalogos-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page">
      <div class="card">
        <h2>Catálogos</h2>
        <div class="tabs">
          <button [class.active]="tab() === 'categorias'" type="button" (click)="tab.set('categorias')">Categorías</button>
          <button [class.active]="tab() === 'unidades'" type="button" (click)="tab.set('unidades')">Unidades de medida</button>
          <button [class.active]="tab() === 'bodegas'" type="button" (click)="tab.set('bodegas')">Bodegas</button>
        </div>
      </div>

      <!-- CATEGORÍAS -->
      @if (tab() === 'categorias') {
        <div class="grid two">
          <form class="card" (ngSubmit)="guardarCategoria()">
            <h3>{{ editandoCategoria() ? 'Editar categoría' : 'Nueva categoría' }}</h3>
            <label>Nombre <input [(ngModel)]="formCategoria.nombre" name="catNombre" required /></label>
            <label>Descripción <input [(ngModel)]="formCategoria.descripcion" name="catDesc" /></label>
            @if (editandoCategoria()) {
              <label class="checkbox">
                <input [(ngModel)]="formCategoria.activo" name="catActivo" type="checkbox" />
                Activo
              </label>
            }
            <p class="error" *ngIf="error()">{{ error() }}</p>
            <div class="actions">
              <button type="submit">{{ editandoCategoria() ? 'Guardar' : 'Crear' }}</button>
              @if (editandoCategoria()) {
                <button class="ghost" type="button" (click)="cancelarCategoria()">Cancelar</button>
              }
            </div>
          </form>

          <div class="card">
            <h3>Categorías ({{ categorias().length }})</h3>
            <table>
              <thead><tr><th>Nombre</th><th>Descripción</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let item of categorias()">
                  <td>{{ item.nombre }}</td>
                  <td>{{ item.descripcion || '—' }}</td>
                  <td><span [class]="item.activo ? 'badge-activo' : 'badge-inactivo'">{{ item.activo ? 'Activo' : 'Inactivo' }}</span></td>
                  <td class="table-actions">
                    <button class="ghost" type="button" (click)="editarCategoria(item)">Editar</button>
                    <button class="danger" type="button" (click)="toggleCategoria(item)">{{ item.activo ? 'Inactivar' : 'Activar' }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- UNIDADES -->
      @if (tab() === 'unidades') {
        <div class="grid two">
          <form class="card" (ngSubmit)="guardarUnidad()">
            <h3>{{ editandoUnidad() ? 'Editar unidad' : 'Nueva unidad' }}</h3>
            <label>Nombre <input [(ngModel)]="formUnidad.nombre" name="uNombre" required /></label>
            <label>Abreviatura <input [(ngModel)]="formUnidad.abreviatura" name="uAbr" required /></label>
            @if (editandoUnidad()) {
              <label class="checkbox">
                <input [(ngModel)]="formUnidad.activo" name="uActivo" type="checkbox" />
                Activo
              </label>
            }
            <p class="error" *ngIf="error()">{{ error() }}</p>
            <div class="actions">
              <button type="submit">{{ editandoUnidad() ? 'Guardar' : 'Crear' }}</button>
              @if (editandoUnidad()) {
                <button class="ghost" type="button" (click)="cancelarUnidad()">Cancelar</button>
              }
            </div>
          </form>

          <div class="card">
            <h3>Unidades ({{ unidades().length }})</h3>
            <table>
              <thead><tr><th>Nombre</th><th>Abreviatura</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let item of unidades()">
                  <td>{{ item.nombre }}</td>
                  <td>{{ item.abreviatura }}</td>
                  <td><span [class]="item.activo ? 'badge-activo' : 'badge-inactivo'">{{ item.activo ? 'Activo' : 'Inactivo' }}</span></td>
                  <td class="table-actions">
                    <button class="ghost" type="button" (click)="editarUnidad(item)">Editar</button>
                    <button class="danger" type="button" (click)="toggleUnidad(item)">{{ item.activo ? 'Inactivar' : 'Activar' }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- BODEGAS -->
      @if (tab() === 'bodegas') {
        <div class="grid two">
          <form class="card" (ngSubmit)="guardarBodega()">
            <h3>{{ editandoBodega() ? 'Editar bodega' : 'Nueva bodega' }}</h3>
            <label>Nombre <input [(ngModel)]="formBodega.nombre" name="bNombre" required /></label>
            <label>Descripción <input [(ngModel)]="formBodega.descripcion" name="bDesc" /></label>
            @if (editandoBodega()) {
              <label class="checkbox">
                <input [(ngModel)]="formBodega.activo" name="bActivo" type="checkbox" />
                Activo
              </label>
            }
            <p class="error" *ngIf="error()">{{ error() }}</p>
            <div class="actions">
              <button type="submit">{{ editandoBodega() ? 'Guardar' : 'Crear' }}</button>
              @if (editandoBodega()) {
                <button class="ghost" type="button" (click)="cancelarBodega()">Cancelar</button>
              }
            </div>
          </form>

          <div class="card">
            <h3>Bodegas ({{ bodegas().length }})</h3>
            <table>
              <thead><tr><th>Nombre</th><th>Descripción</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let item of bodegas()">
                  <td>{{ item.nombre }}</td>
                  <td>{{ item.descripcion || '—' }}</td>
                  <td><span [class]="item.activo ? 'badge-activo' : 'badge-inactivo'">{{ item.activo ? 'Activo' : 'Inactivo' }}</span></td>
                  <td class="table-actions">
                    <button class="ghost" type="button" (click)="editarBodega(item)">Editar</button>
                    <button class="danger" type="button" (click)="toggleBodega(item)">{{ item.activo ? 'Inactivar' : 'Activar' }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      }
    </section>
  `,
})
export class CatalogosPageComponent implements OnInit {
  private readonly svc = inject(CatalogosService);

  readonly tab = signal<Tab>('categorias');
  readonly categorias = signal<Categoria[]>([]);
  readonly unidades = signal<Unidad[]>([]);
  readonly bodegas = signal<Bodega[]>([]);
  readonly error = signal('');

  readonly editandoCategoria = signal<Categoria | null>(null);
  readonly editandoUnidad = signal<Unidad | null>(null);
  readonly editandoBodega = signal<Bodega | null>(null);

  formCategoria = { nombre: '', descripcion: '', activo: true };
  formUnidad = { nombre: '', abreviatura: '', activo: true };
  formBodega = { nombre: '', descripcion: '', activo: true };

  ngOnInit() {
    this.cargarCategorias();
    this.cargarUnidades();
    this.cargarBodegas();
  }

  cargarCategorias() {
    this.svc.listarCategorias().subscribe((data) => this.categorias.set(data));
  }

  cargarUnidades() {
    this.svc.listarUnidades().subscribe((data) => this.unidades.set(data));
  }

  cargarBodegas() {
    this.svc.listarBodegas().subscribe((data) => this.bodegas.set(data));
  }

  guardarCategoria() {
    this.error.set('');
    const editando = this.editandoCategoria();
    const obs = editando
      ? this.svc.actualizarCategoria(editando.idCategoria, this.formCategoria)
      : this.svc.crearCategoria(this.formCategoria);

    obs.subscribe({
      next: () => { this.cancelarCategoria(); this.cargarCategorias(); },
      error: (e) => this.error.set(e?.error?.message ?? 'Error al guardar categoría'),
    });
  }

  editarCategoria(item: Categoria) {
    this.editandoCategoria.set(item);
    this.formCategoria = { nombre: item.nombre, descripcion: item.descripcion ?? '', activo: item.activo };
  }

  cancelarCategoria() {
    this.editandoCategoria.set(null);
    this.formCategoria = { nombre: '', descripcion: '', activo: true };
  }

  toggleCategoria(item: Categoria) {
    this.svc.actualizarCategoria(item.idCategoria, { activo: !item.activo }).subscribe(() => this.cargarCategorias());
  }

  guardarUnidad() {
    this.error.set('');
    const editando = this.editandoUnidad();
    const obs = editando
      ? this.svc.actualizarUnidad(editando.idUnidad, this.formUnidad)
      : this.svc.crearUnidad(this.formUnidad);

    obs.subscribe({
      next: () => { this.cancelarUnidad(); this.cargarUnidades(); },
      error: (e) => this.error.set(e?.error?.message ?? 'Error al guardar unidad'),
    });
  }

  editarUnidad(item: Unidad) {
    this.editandoUnidad.set(item);
    this.formUnidad = { nombre: item.nombre, abreviatura: item.abreviatura, activo: item.activo };
  }

  cancelarUnidad() {
    this.editandoUnidad.set(null);
    this.formUnidad = { nombre: '', abreviatura: '', activo: true };
  }

  toggleUnidad(item: Unidad) {
    this.svc.actualizarUnidad(item.idUnidad, { activo: !item.activo }).subscribe(() => this.cargarUnidades());
  }

  guardarBodega() {
    this.error.set('');
    const editando = this.editandoBodega();
    const obs = editando
      ? this.svc.actualizarBodega(editando.idBodega, this.formBodega)
      : this.svc.crearBodega(this.formBodega);

    obs.subscribe({
      next: () => { this.cancelarBodega(); this.cargarBodegas(); },
      error: (e) => this.error.set(e?.error?.message ?? 'Error al guardar bodega'),
    });
  }

  editarBodega(item: Bodega) {
    this.editandoBodega.set(item);
    this.formBodega = { nombre: item.nombre, descripcion: item.descripcion ?? '', activo: item.activo };
  }

  cancelarBodega() {
    this.editandoBodega.set(null);
    this.formBodega = { nombre: '', descripcion: '', activo: true };
  }

  toggleBodega(item: Bodega) {
    this.svc.actualizarBodega(item.idBodega, { activo: !item.activo }).subscribe(() => this.cargarBodegas());
  }
}
