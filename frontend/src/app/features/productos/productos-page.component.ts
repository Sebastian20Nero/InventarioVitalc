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
      <form class="card horizontal-form-card" (ngSubmit)="guardarProducto()">
        <div class="form-header">
          <div class="form-title-group">
            <h2>{{ editando() ? 'Editar producto' : 'Nuevo producto' }}</h2>
            <span class="badge-editing" *ngIf="editando()">Código: {{ editando()?.codigoInterno }}</span>
          </div>
          <div class="quick-stats" *ngIf="!editando()">
            <span class="stat-chip"><strong>{{ productos().length }}</strong> Total</span>
            <span class="stat-chip"><strong>{{ productosActivos() }}</strong> Activos</span>
            <span class="stat-chip"><strong>{{ categorias().length }}</strong> Categorías</span>
            <span class="stat-chip"><strong>{{ unidades().length }}</strong> Unidades</span>
          </div>
        </div>

        <div class="horizontal-fields">
          <div class="field col-code">
            <label>Código *</label>
            <input [(ngModel)]="form.codigoInterno" name="codigo" required [disabled]="!!editando()" placeholder="CÓDIGO" />
          </div>

          <div class="field col-name">
            <label>Nombre *</label>
            <input [(ngModel)]="form.nombre" name="nombre" required placeholder="Nombre del producto" />
          </div>

          <div class="field col-desc">
            <label>Descripción</label>
            <input [(ngModel)]="form.descripcion" name="descripcion" placeholder="Descripción breve" />
          </div>

          <div class="field col-cat">
            <label>Categoría *</label>
            <select [(ngModel)]="form.categoriaId" name="categoria" required>
              <option value="">— Categoría —</option>
              <option *ngFor="let c of categorias()" [value]="c.idCategoria">{{ c.nombre }}</option>
            </select>
          </div>

          <div class="field col-unit">
            <label>Unidad *</label>
            <select [(ngModel)]="form.unidadId" name="unidad" required>
              <option value="">— Unidad —</option>
              <option *ngFor="let u of unidades()" [value]="u.idUnidad">{{ u.nombre }} ({{ u.abreviatura }})</option>
            </select>
          </div>

          <div class="field col-stock">
            <label>Stock mín.</label>
            <input [(ngModel)]="form.stockMinimo" name="stockMinimo" type="number" min="0" step="0.0001" placeholder="0" />
          </div>

          <div class="field col-active" *ngIf="editando()">
            <label>Estado</label>
            <label class="checkbox-inline">
              <input [(ngModel)]="form.activo" name="activo" type="checkbox" /> Activo
            </label>
          </div>

          <div class="field col-actions">
            <label class="action-label">&nbsp;</label>
            <div class="form-actions">
              <button type="submit" class="btn-submit">{{ editando() ? 'Guardar' : 'Crear' }}</button>
              <button class="ghost" type="button" *ngIf="editando()" (click)="cancelar()">Cancelar</button>
            </div>
          </div>
        </div>

        <p class="error" *ngIf="error()">{{ error() }}</p>

        <div class="stock-inline-info" *ngIf="editando() && stockProducto().length > 0">
          <span class="stock-title">Stock por bodega:</span>
          <div class="stock-badges">
            <span class="stock-badge" *ngFor="let s of stockProducto()">
              <strong>{{ s.bodega.nombre }}:</strong> {{ s.stockActual }} {{ editando()!.unidad.abreviatura }}
            </span>
          </div>
        </div>
      </form>

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
    .horizontal-form-card { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 1.25rem; }
    .form-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
    .form-title-group { display: flex; align-items: center; gap: 0.75rem; }
    .form-header h2 { margin: 0; font-size: 1.15rem; }
    .badge-editing { background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; }
    .quick-stats { display: flex; gap: 0.75rem; flex-wrap: wrap; }
    .stat-chip { background: #f3f4f6; border-radius: 6px; padding: 4px 10px; font-size: 0.8rem; color: #4b5563; }
    .stat-chip strong { color: #2563eb; font-weight: 700; }
    
    .horizontal-fields { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; }
    .field { display: flex; flex-direction: column; gap: 0.25rem; }
    .field label { font-size: 0.8rem; font-weight: 600; color: #374151; }
    .field input, .field select { padding: 0.5rem 0.65rem; font-size: 0.9rem; height: 38px; border-radius: 8px; }

    .col-code { flex: 1; min-width: 110px; max-width: 140px; }
    .col-name { flex: 2; min-width: 160px; }
    .col-desc { flex: 2; min-width: 160px; }
    .col-cat { flex: 1.5; min-width: 140px; }
    .col-unit { flex: 1.2; min-width: 120px; }
    .col-stock { flex: 1; min-width: 90px; max-width: 110px; }
    .col-active { display: flex; flex-direction: column; justify-content: center; min-width: 90px; }
    .checkbox-inline { display: flex; align-items: center; gap: 0.4rem; height: 38px; font-weight: normal; cursor: pointer; font-size: 0.85rem; }
    .checkbox-inline input { width: auto; height: auto; cursor: pointer; }
    .col-actions { display: flex; flex-direction: column; }
    .action-label { user-select: none; }
    .form-actions { display: flex; gap: 0.5rem; }
    .form-actions button { height: 38px; padding: 0 1rem; font-size: 0.85rem; border-radius: 8px; white-space: nowrap; }

    .stock-inline-info { display: flex; align-items: center; gap: 0.75rem; background: #f8fafc; padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 0.85rem; flex-wrap: wrap; margin-top: 0.25rem; }
    .stock-title { font-weight: 600; color: #475569; }
    .stock-badges { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .stock-badge { background: #ffffff; border: 1px solid #cbd5e1; padding: 2px 8px; border-radius: 6px; font-size: 0.8rem; }

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
