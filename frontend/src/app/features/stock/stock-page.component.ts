import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { InventarioService, StockProductoBodega } from '../../core/services/inventario.service';
import { ProductosService } from '../../core/services/productos.service';
import { CatalogosService } from '../../core/services/catalogos.service';
import { Bodega, Producto } from '../../core/models/inventario.models';

interface FilaStock {
  producto: Producto;
  bodegas: { bodega: Bodega; stock: StockProductoBodega | null }[];
  stockTotal: number;
  stockMinimo: number;
  bajominimo: boolean;
  sinStock: boolean;
}

@Component({
  selector: 'app-stock-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page">
      <!-- Filtros y resumen -->
      <div class="card">
        <h2>Stock actual</h2>
        <div class="filter-row">
          <input [(ngModel)]="filtroTexto" name="q" placeholder="Buscar producto o código…" class="filter-input" />
          <select [(ngModel)]="filtroBodega" name="fb">
            <option value="">Todas las bodegas</option>
            <option *ngFor="let b of bodegas()" [value]="b.idBodega">{{ b.nombre }}</option>
          </select>
          <select [(ngModel)]="filtroAlerta" name="fa">
            <option value="">Todos</option>
            <option value="bajo">Stock bajo mínimo</option>
            <option value="sin">Sin stock</option>
            <option value="ok">Stock suficiente</option>
          </select>
          <button class="ghost" type="button" (click)="cargar()">↺ Actualizar</button>
        </div>
        <div class="resumen-row">
          <div class="resumen-item">
            <span class="resumen-num">{{ filas().length }}</span>
            <span class="muted">Productos totales</span>
          </div>
          <div class="resumen-item resumen-danger">
            <span class="resumen-num">{{ filasBajominimo() }}</span>
            <span class="muted">Stock bajo mínimo</span>
          </div>
          <div class="resumen-item resumen-warn">
            <span class="resumen-num">{{ filasSinStock() }}</span>
            <span class="muted">Sin stock</span>
          </div>
          <div class="resumen-item resumen-ok">
            <span class="resumen-num">{{ filasOk() }}</span>
            <span class="muted">Stock suficiente</span>
          </div>
        </div>
      </div>

      <!-- Tabla -->
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Unidad</th>
              <th *ngFor="let b of bodegas()">{{ b.nombre }}</th>
              <th>Total</th>
              <th>Mínimo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr
              *ngFor="let f of filasFiltradas()"
              [class.row-bajo]="f.bajominimo && !f.sinStock"
              [class.row-sin-stock]="f.sinStock"
            >
              <td><code>{{ f.producto.codigoInterno }}</code></td>
              <td>{{ f.producto.nombre }}</td>
              <td>{{ f.producto.categoria.nombre }}</td>
              <td>{{ f.producto.unidad.abreviatura }}</td>
              <ng-container *ngFor="let b of bodegas()">
                <td class="num">
                  <ng-container *ngIf="getStock(f, b.idBodega) as s; else sinMovimiento">
                    {{ s.stockActual }}
                  </ng-container>
                  <ng-template #sinMovimiento>
                    <span class="muted">—</span>
                  </ng-template>
                </td>
              </ng-container>
              <td class="num total-col">
                <strong [class.text-danger]="f.bajominimo">{{ f.stockTotal }}</strong>
              </td>
              <td class="num muted">{{ f.stockMinimo > 0 ? f.stockMinimo : '—' }}</td>
              <td>
                <span *ngIf="f.sinStock" class="badge-sin-stock">Sin stock</span>
                <span *ngIf="!f.sinStock && f.bajominimo" class="badge-bajo">Bajo mínimo</span>
                <span *ngIf="!f.sinStock && !f.bajominimo" class="badge-activo">OK</span>
              </td>
            </tr>
            <tr *ngIf="filasFiltradas().length === 0">
              <td [attr.colspan]="4 + bodegas().length + 3" class="empty">
                No se encontraron productos.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: [`
    .filter-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; }
    .filter-input { flex: 1; min-width: 200px; }
    .resumen-row { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #f3f4f6; }
    .resumen-item { display: flex; align-items: center; gap: 0.5rem; }
    .resumen-num { font-size: 1.5rem; font-weight: 700; color: #111827; }
    .resumen-danger .resumen-num { color: #b91c1c; }
    .resumen-warn .resumen-num { color: #d97706; }
    .resumen-ok .resumen-num { color: #15803d; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .total-col { font-size: 1rem; }
    .text-danger { color: #b91c1c; }
    .row-bajo { background: #fffbeb; }
    .row-sin-stock { background: #fef2f2; }
    .badge-sin-stock { background: #fee2e2; color: #b91c1c; display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .badge-bajo { background: #fef3c7; color: #92400e; display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .empty { text-align: center; color: #6b7280; padding: 2rem !important; }
    code { background: #f4f4f5; padding: 2px 6px; border-radius: 4px; font-size: 0.82em; }
  `],
})
export class StockPageComponent implements OnInit {
  private readonly inventarioSvc = inject(InventarioService);
  private readonly productosSvc = inject(ProductosService);
  private readonly catalogosSvc = inject(CatalogosService);

  readonly bodegas = signal<Bodega[]>([]);
  readonly filas = signal<FilaStock[]>([]);

  filtroTexto = '';
  filtroBodega = '';
  filtroAlerta = '';

  filasBajominimo(): number {
    return this.filas().filter((f) => f.bajominimo && !f.sinStock).length;
  }

  filasSinStock(): number {
    return this.filas().filter((f) => f.sinStock).length;
  }

  filasOk(): number {
    return this.filas().filter((f) => !f.bajominimo && !f.sinStock).length;
  }

  filasFiltradas(): FilaStock[] {
    let lista = this.filas();

    const q = this.filtroTexto.toLowerCase().trim();
    if (q) {
      lista = lista.filter(
        (f) =>
          f.producto.nombre.toLowerCase().includes(q) ||
          f.producto.codigoInterno.toLowerCase().includes(q),
      );
    }

    if (this.filtroBodega) {
      lista = lista.filter((f) =>
        f.bodegas.some((b) => b.bodega.idBodega === this.filtroBodega && b.stock !== null),
      );
    }

    if (this.filtroAlerta === 'bajo') lista = lista.filter((f) => f.bajominimo && !f.sinStock);
    if (this.filtroAlerta === 'sin') lista = lista.filter((f) => f.sinStock);
    if (this.filtroAlerta === 'ok') lista = lista.filter((f) => !f.bajominimo && !f.sinStock);

    return lista;
  }

  getStock(fila: FilaStock, bodegaId: string): StockProductoBodega | null {
    return fila.bodegas.find((b) => b.bodega.idBodega === bodegaId)?.stock ?? null;
  }

  ngOnInit() {
    this.cargar();
  }

  cargar() {
    forkJoin({
      productos: this.productosSvc.listar(),
      stock: this.inventarioSvc.listarStock(),
      bodegas: this.catalogosSvc.listarBodegas(),
    }).subscribe(({ productos, stock, bodegas }) => {
      const bodegasActivas = bodegas.filter((b) => b.activo);
      this.bodegas.set(bodegasActivas);

      const activos = productos.filter((p) => p.activo);

      const filas: FilaStock[] = activos.map((prod) => {
        const stockProd = stock.filter((s) => s.productoId === prod.idProducto);
        const stockTotal = stockProd.reduce((sum, s) => sum + parseFloat(s.stockActual), 0);
        const stockMinimo = parseFloat(prod.stockMinimo) || 0;

        const filaBodegas = bodegasActivas.map((bod) => ({
          bodega: bod,
          stock: stockProd.find((s) => s.bodegaId === bod.idBodega) ?? null,
        }));

        return {
          producto: prod,
          bodegas: filaBodegas,
          stockTotal,
          stockMinimo,
          bajominimo: stockMinimo > 0 && stockTotal < stockMinimo,
          sinStock: stockTotal === 0,
        };
      });

      filas.sort((a, b) => {
        if (a.sinStock !== b.sinStock) return a.sinStock ? -1 : 1;
        if (a.bajominimo !== b.bajominimo) return a.bajominimo ? -1 : 1;
        return a.producto.nombre.localeCompare(b.producto.nombre);
      });

      this.filas.set(filas);
    });
  }
}
