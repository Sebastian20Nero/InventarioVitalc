import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProductosService } from '../../core/services/productos.service';
import { CatalogosService } from '../../core/services/catalogos.service';
import { InventarioService, StockProductoBodega } from '../../core/services/inventario.service';
import { Categoria, Producto, Unidad } from '../../core/models/inventario.models';

@Component({
  selector: 'app-productos-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page">
      <div class="grid two">
        <form class="card" (ngSubmit)="guardarProducto()">
          <h2>{{ editando() ? 'Editar producto' : 'Nuevo producto' }}</h2>

          <div class="grid two">
            <label>
              Código interno
              <input [(ngModel)]="form.codigoInterno" name="codigo" required [disabled]="!!editando()" />
            </label>
            <label>
              Nombre
              <input [(ngModel)]="form.nombre" name="nombre" required />
            </label>
          </div>

          <label>
            Descripción
            <input [(ngModel)]="form.descripcion" name="descripcion" />
          </label>

          <div class="grid two">
            <label>
              Categoría
              <select [(ngModel)]="form.categoriaId" name="categoria" required>
                <option value="">— Seleccionar —</option>
                <option *ngFor="let c of categorias()" [value]="c.idCategoria">{{ c.nombre }}</option>
              </select>
            </label>
            <label>
              Unidad de medida
              <select [(ngModel)]="form.unidadId" name="unidad" required>
                <option value="">— Seleccionar —</option>
                <option *ngFor="let u of unidades()" [value]="u.idUnidad">{{ u.nombre }} ({{ u.abreviatura }})</option>
              </select>
            </label>
          </div>

          <label>
            Stock mínimo
            <input [(ngModel)]="form.stockMinimo" name="stockMinimo" type="number" min="0" step="0.0001" />
          </label>

          @if (editando()) {
            <label class="checkbox">
              <input [(ngModel)]="form.activo" name="activo" type="checkbox" />
              Producto activo
            </label>
          }

          <p class="error" *ngIf="error()">{{ error() }}</p>
          <div class="actions">
            <button type="submit">{{ editando() ? 'Guardar cambios' : 'Crear producto' }}</button>
            @if (editando()) {
              <button class="ghost" type="button" (click)="cancelar()">Cancelar</button>
            }
          </div>
        </form>

          <div class="card stats-card" *ngIf="!editando()">
          <h3>Resumen</h3>
          <div class="stats-grid">
            <div class="stat-item">
              <div class="stat-number">{{ productos().length }}</div>
              <div class="stat-label">Total productos</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">{{ productosActivos() }}</div>
              <div class="stat-label">Activos</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">{{ categorias().length }}</div>
              <div class="stat-label">Categorías</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">{{ unidades().length }}</div>
              <div class="stat-label">Unidades</div>
            </div>
          </div>
        </div>

        <div class="card stock-card" *ngIf="editando() && stockProducto().length > 0">
          <h3>Stock actual — {{ editando()!.nombre }}</h3>
          <table>
            <thead><tr><th>Bodega</th><th>Stock actual</th><th>Actualizado</th></tr></thead>
            <tbody>
              <tr *ngFor="let s of stockProducto()">
                <td>{{ s.bodega.nombre }}</td>
                <td><strong>{{ s.stockActual }}</strong> {{ editando()!.unidad.abreviatura }}</td>
                <td>{{ s.updatedAt | date:'dd/MM/yyyy HH:mm' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card stock-card" *ngIf="editando() && stockProducto().length === 0">
          <h3>Stock actual — {{ editando()!.nombre }}</h3>
          <p class="muted">Sin movimientos registrados en ninguna bodega.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Productos</h2>
          <div class="filter-row">
            <input [(ngModel)]="filtro" name="filtro" placeholder="Buscar por nombre o código..." class="filter-input" />
            <select [(ngModel)]="filtroCategoriaId" name="filtroCat">
              <option value="">Todas las categorías</option>
              <option *ngFor="let c of categorias()" [value]="c.idCategoria">{{ c.nombre }}</option>
            </select>
            <select [(ngModel)]="filtroEstado" name="filtroEstado">
              <option value="">Todos los estados</option>
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
            </select>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Unidad</th>
              <th>Stock mín.</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let p of productosFiltrados()">
              <td><code>{{ p.codigoInterno }}</code></td>
              <td>{{ p.nombre }}</td>
              <td>{{ p.categoria.nombre }}</td>
              <td>{{ p.unidad.abreviatura }}</td>
              <td>{{ p.stockMinimo }}</td>
              <td><span [class]="p.activo ? 'badge-activo' : 'badge-inactivo'">{{ p.activo ? 'Activo' : 'Inactivo' }}</span></td>
              <td class="table-actions">
                <button class="ghost" type="button" (click)="seleccionar(p)">Editar</button>
                <button class="danger" type="button" (click)="toggleEstado(p)">{{ p.activo ? 'Inactivar' : 'Activar' }}</button>
              </td>
            </tr>
            <tr *ngIf="productosFiltrados().length === 0">
              <td colspan="7" class="empty">No se encontraron productos</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: [`
    .stats-card { display: flex; flex-direction: column; gap: 1rem; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .stat-item { background: var(--surface-2, #f4f4f5); border-radius: 8px; padding: 1rem; text-align: center; }
    .stat-number { font-size: 2rem; font-weight: 700; color: var(--primary, #2563eb); }
    .stat-label { font-size: 0.8rem; color: var(--muted, #6b7280); margin-top: 0.25rem; }
    .stock-card { align-self: start; }
    .card-header { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem; }
    .filter-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .filter-input { flex: 1; min-width: 200px; }
    code { background: var(--surface-2, #f4f4f5); padding: 2px 6px; border-radius: 4px; font-size: 0.85em; }
    .empty { text-align: center; color: var(--muted, #6b7280); padding: 2rem !important; }
  `],
})
export class ProductosPageComponent implements OnInit {
  private readonly svc = inject(ProductosService);
  private readonly catalogosSvc = inject(CatalogosService);
  private readonly inventarioSvc = inject(InventarioService);

  readonly productos = signal<Producto[]>([]);
  readonly categorias = signal<Categoria[]>([]);
  readonly unidades = signal<Unidad[]>([]);
  readonly editando = signal<Producto | null>(null);
  readonly stockProducto = signal<StockProductoBodega[]>([]);
  readonly error = signal('');

  filtro = '';
  filtroCategoriaId = '';
  filtroEstado = '';

  form = {
    codigoInterno: '',
    nombre: '',
    descripcion: '',
    categoriaId: '',
    unidadId: '',
    stockMinimo: '0',
    activo: true,
  };

  productosActivos(): number {
    return this.productos().filter((p) => p.activo).length;
  }

  productosFiltrados(): Producto[] {
    let lista = this.productos();
    const q = this.filtro.toLowerCase().trim();
    if (q) {
      lista = lista.filter(
        (p) => p.nombre.toLowerCase().includes(q) || p.codigoInterno.toLowerCase().includes(q),
      );
    }
    if (this.filtroCategoriaId) {
      lista = lista.filter((p) => p.categoriaId === this.filtroCategoriaId);
    }
    if (this.filtroEstado !== '') {
      const activo = this.filtroEstado === 'true';
      lista = lista.filter((p) => p.activo === activo);
    }
    return lista;
  }

  ngOnInit() {
    this.cargar();
  }

  cargar() {
    this.svc.listar().subscribe((data) => this.productos.set(data));
    this.catalogosSvc.listarCategorias().subscribe((data) => this.categorias.set(data.filter((c) => c.activo)));
    this.catalogosSvc.listarUnidades().subscribe((data) => this.unidades.set(data.filter((u) => u.activo)));
  }

  guardarProducto() {
    this.error.set('');
    const editando = this.editando();

    if (editando) {
      const body: Record<string, unknown> = {
        nombre: this.form.nombre,
        descripcion: this.form.descripcion || undefined,
        categoriaId: this.form.categoriaId,
        unidadId: this.form.unidadId,
        stockMinimo: this.form.stockMinimo,
      };
      this.svc.actualizar(editando.idProducto, body).subscribe({
        next: () => { this.cancelar(); this.cargar(); },
        error: (e) => this.error.set(e?.error?.message ?? 'Error al actualizar'),
      });
    } else {
      this.svc.crear({
        codigoInterno: this.form.codigoInterno,
        nombre: this.form.nombre,
        descripcion: this.form.descripcion || undefined,
        categoriaId: this.form.categoriaId,
        unidadId: this.form.unidadId,
        stockMinimo: this.form.stockMinimo,
      }).subscribe({
        next: () => { this.resetForm(); this.cargar(); },
        error: (e) => this.error.set(e?.error?.message ?? 'Error al crear producto'),
      });
    }
  }

  seleccionar(p: Producto) {
    this.editando.set(p);
    this.form = {
      codigoInterno: p.codigoInterno,
      nombre: p.nombre,
      descripcion: p.descripcion ?? '',
      categoriaId: p.categoriaId,
      unidadId: p.unidadId,
      stockMinimo: p.stockMinimo,
      activo: p.activo,
    };
    this.inventarioSvc.stockPorProducto(p.idProducto).subscribe({
      next: (data) => this.stockProducto.set(data),
      error: () => this.stockProducto.set([]),
    });
  }

  cancelar() {
    this.editando.set(null);
    this.stockProducto.set([]);
    this.resetForm();
  }

  toggleEstado(p: Producto) {
    this.svc.actualizarEstado(p.idProducto, !p.activo).subscribe(() => this.cargar());
  }

  private resetForm() {
    this.form = { codigoInterno: '', nombre: '', descripcion: '', categoriaId: '', unidadId: '', stockMinimo: '0', activo: true };
  }
}
