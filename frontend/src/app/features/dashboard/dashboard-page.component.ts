import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { InventarioService, MovimientoInventario, StockProductoBodega } from '../../core/services/inventario.service';
import { ProductosService } from '../../core/services/productos.service';
import { EmpalmeService } from '../../core/services/empalme.service';
import { Producto } from '../../core/models/inventario.models';

interface StockBajo {
  producto: Producto;
  stockTotal: number;
  stockMinimo: number;
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="page">
      <!-- Saludo -->
      <div class="card bienvenida">
        <div>
          <h2>Hola, {{ auth.currentUser()?.nombres }} 👋</h2>
          <p class="muted">Control de inventario — {{ fechaHoy }}</p>
        </div>
        <div class="permisos-badges">
          <span class="badge-perm" *ngFor="let p of auth.currentUser()?.permisos?.slice(0, 4)">{{ p }}</span>
          <span class="badge-perm badge-more" *ngIf="(auth.currentUser()?.permisos?.length ?? 0) > 4">
            +{{ (auth.currentUser()?.permisos?.length ?? 0) - 4 }} más
          </span>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="kpi-grid">
        <div class="card kpi-card">
          <div class="kpi-icon kpi-blue">📦</div>
          <div class="kpi-body">
            <div class="kpi-number">{{ totalProductos() }}</div>
            <div class="kpi-label">Productos activos</div>
          </div>
          <a routerLink="/app/productos" class="kpi-link">Ver →</a>
        </div>

        <div class="card kpi-card">
          <div class="kpi-icon kpi-green">📋</div>
          <div class="kpi-body">
            <div class="kpi-number">{{ totalMovimientos() }}</div>
            <div class="kpi-label">Movimientos registrados</div>
          </div>
          <a routerLink="/app/inventario/historial" class="kpi-link">Ver →</a>
        </div>

        <div class="card kpi-card" [class.kpi-alerta]="movimientosPendientes() > 0">
          <div class="kpi-icon kpi-yellow">⏳</div>
          <div class="kpi-body">
            <div class="kpi-number">{{ movimientosPendientes() }}</div>
            <div class="kpi-label">Pendientes de empalme</div>
          </div>
          <a routerLink="/app/empalme" class="kpi-link">Revisar →</a>
        </div>

        <div class="card kpi-card" [class.kpi-alerta]="stockBajo().length > 0">
          <div class="kpi-icon kpi-red">⚠️</div>
          <div class="kpi-body">
            <div class="kpi-number">{{ stockBajo().length }}</div>
            <div class="kpi-label">Productos stock bajo</div>
          </div>
          <a routerLink="/app/stock" class="kpi-link">Ver →</a>
        </div>

        <div class="card kpi-card">
          <div class="kpi-icon kpi-purple">✅</div>
          <div class="kpi-body">
            <div class="kpi-number">{{ movimientosListos() }}</div>
            <div class="kpi-label">Listos para DsNube</div>
          </div>
          <a routerLink="/app/empalme" class="kpi-link">Ver →</a>
        </div>

        <div class="card kpi-card">
          <div class="kpi-icon kpi-gray">🏪</div>
          <div class="kpi-body">
            <div class="kpi-number">{{ totalBodegas() }}</div>
            <div class="kpi-label">Bodegas con stock</div>
          </div>
          <a routerLink="/app/stock" class="kpi-link">Ver →</a>
        </div>
      </div>

      <div class="grid two">
        <!-- Últimos movimientos -->
        <div class="card">
          <div class="section-header">
            <h3>Últimos movimientos</h3>
            <a routerLink="/app/inventario/historial" class="link-ver">Ver todos</a>
          </div>
          <div class="empty" *ngIf="ultimosMovimientos().length === 0">Sin movimientos registrados.</div>
          <div class="mov-mini-list" *ngIf="ultimosMovimientos().length > 0">
            <div class="mov-mini" *ngFor="let m of ultimosMovimientos()">
              <div class="mov-mini-left">
                <code>{{ m.consecutivo }}</code>
                <span class="muted">{{ m.producto.nombre }}</span>
              </div>
              <div class="mov-mini-right">
                <span [class]="tipoClass(m.tipoMovimiento)">{{ labelTipo(m.tipoMovimiento) }}</span>
                <span class="muted mov-fecha">{{ m.createdAt | date:'dd/MM HH:mm' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Alertas stock bajo -->
        <div class="card">
          <div class="section-header">
            <h3>Alertas de stock bajo</h3>
            <a routerLink="/app/stock" class="link-ver">Ver stock</a>
          </div>
          <div class="empty" *ngIf="stockBajo().length === 0">
            ✓ Todos los productos tienen stock suficiente.
          </div>
          <div class="alerta-list" *ngIf="stockBajo().length > 0">
            <div class="alerta-item" *ngFor="let a of stockBajo().slice(0, 8)">
              <div class="alerta-nombre">
                <code>{{ a.producto.codigoInterno }}</code>
                <span>{{ a.producto.nombre }}</span>
              </div>
              <div class="alerta-stock">
                <span class="stock-actual" [class.stock-cero]="a.stockTotal === 0">
                  {{ a.stockTotal }} {{ a.producto.unidad.abreviatura }}
                </span>
                <span class="muted alerta-min">mín: {{ a.stockMinimo }}</span>
              </div>
            </div>
            <p class="muted" *ngIf="stockBajo().length > 8" style="margin:0.5rem 0 0;font-size:0.85rem">
              ... y {{ stockBajo().length - 8 }} más
            </p>
          </div>
        </div>
      </div>

      <!-- Accesos rápidos -->
      <div class="card">
        <h3>Accesos rápidos</h3>
        <div class="accesos-grid">
          <a routerLink="/app/inventario/movimientos" class="acceso-card">
            <span class="acceso-icon">➕</span>
            <span>Registrar movimiento</span>
          </a>
          <a routerLink="/app/inventario/historial" class="acceso-card">
            <span class="acceso-icon">📄</span>
            <span>Historial</span>
          </a>
          <a routerLink="/app/stock" class="acceso-card">
            <span class="acceso-icon">📦</span>
            <span>Stock actual</span>
          </a>
          <a routerLink="/app/empalme" class="acceso-card">
            <span class="acceso-icon">🔗</span>
            <span>Empalme DsNube</span>
          </a>
          <a routerLink="/app/productos" class="acceso-card">
            <span class="acceso-icon">🏷️</span>
            <span>Productos</span>
          </a>
          <a routerLink="/app/catalogos" class="acceso-card">
            <span class="acceso-icon">🗂️</span>
            <span>Catálogos</span>
          </a>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .bienvenida { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; }
    .bienvenida h2 { margin: 0; }
    .bienvenida p { margin: 0.25rem 0 0; }
    .permisos-badges { display: flex; gap: 0.35rem; flex-wrap: wrap; }
    .badge-perm { background: #eff6ff; color: #1d4ed8; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 600; }
    .badge-more { background: #f3f4f6; color: #6b7280; }

    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; }
    .kpi-card { display: flex; align-items: center; gap: 1rem; padding: 1.25rem; position: relative; }
    .kpi-icon { font-size: 2rem; width: 52px; height: 52px; display: grid; place-items: center; border-radius: 12px; flex-shrink: 0; }
    .kpi-blue { background: #eff6ff; }
    .kpi-green { background: #f0fdf4; }
    .kpi-yellow { background: #fffbeb; }
    .kpi-red { background: #fef2f2; }
    .kpi-purple { background: #faf5ff; }
    .kpi-gray { background: #f9fafb; }
    .kpi-body { flex: 1; }
    .kpi-number { font-size: 1.8rem; font-weight: 700; line-height: 1; color: #111827; }
    .kpi-label { font-size: 0.8rem; color: #6b7280; margin-top: 0.2rem; }
    .kpi-link { position: absolute; bottom: 0.75rem; right: 1rem; font-size: 0.8rem; color: #2563eb; text-decoration: none; }
    .kpi-link:hover { text-decoration: underline; }
    .kpi-alerta { border-left: 3px solid #f59e0b; }

    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
    .section-header h3 { margin: 0; }
    .link-ver { font-size: 0.85rem; color: #2563eb; text-decoration: none; }
    .link-ver:hover { text-decoration: underline; }

    .mov-mini-list { display: grid; gap: 0.5rem; }
    .mov-mini { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #f3f4f6; flex-wrap: wrap; gap: 0.25rem; }
    .mov-mini:last-child { border-bottom: none; }
    .mov-mini-left { display: flex; flex-direction: column; gap: 0.1rem; }
    .mov-mini-right { display: flex; gap: 0.75rem; align-items: center; }
    .mov-fecha { font-size: 0.78rem; }
    .tipo-suma { color: #15803d; font-weight: 600; font-size: 0.8rem; }
    .tipo-resta { color: #b91c1c; font-weight: 600; font-size: 0.8rem; }

    .alerta-list { display: grid; gap: 0.5rem; }
    .alerta-item { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0.6rem; background: #fef2f2; border-radius: 8px; }
    .alerta-nombre { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .alerta-stock { display: flex; gap: 0.5rem; align-items: center; }
    .stock-actual { font-weight: 700; color: #b91c1c; }
    .stock-cero { color: #7f1d1d; }
    .alerta-min { font-size: 0.78rem; }

    .accesos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 0.75rem; margin-top: 0.75rem; }
    .acceso-card {
      display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
      padding: 1rem; background: #f9fafb; border-radius: 12px;
      text-decoration: none; color: #111827; font-size: 0.88rem; text-align: center;
      transition: background 0.15s;
    }
    .acceso-card:hover { background: #eff6ff; color: #2563eb; }
    .acceso-icon { font-size: 1.5rem; }
    .empty { color: #6b7280; padding: 1rem 0; font-size: 0.9rem; }
  `],
})
export class DashboardPageComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly inventarioSvc = inject(InventarioService);
  private readonly productosSvc = inject(ProductosService);
  private readonly empalmeSvc = inject(EmpalmeService);

  readonly fechaHoy = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  readonly totalProductos = signal(0);
  readonly totalMovimientos = signal(0);
  readonly movimientosPendientes = signal(0);
  readonly movimientosListos = signal(0);
  readonly totalBodegas = signal(0);
  readonly stockBajo = signal<StockBajo[]>([]);
  readonly ultimosMovimientos = signal<MovimientoInventario[]>([]);

  private readonly TIPOS = [
    { value: 'SALDO_INICIAL', label: 'Saldo inicial', signo: '+' },
    { value: 'ENTRADA', label: 'Entrada', signo: '+' },
    { value: 'ABASTECIMIENTO', label: 'Abastecimiento', signo: '+' },
    { value: 'SALIDA', label: 'Salida', signo: '-' },
    { value: 'AJUSTE_POSITIVO', label: 'Ajuste +', signo: '+' },
    { value: 'AJUSTE_NEGATIVO', label: 'Ajuste −', signo: '-' },
  ];

  ngOnInit() {
    forkJoin({
      productos: this.productosSvc.listar(),
      movimientos: this.inventarioSvc.listarMovimientos(),
      stock: this.inventarioSvc.listarStock(),
      reporte: this.empalmeSvc.obtenerReporte(),
    }).subscribe({
      next: ({ productos, movimientos, stock, reporte }) => {
        const activos = productos.filter((p) => p.activo);
        this.totalProductos.set(activos.length);
        this.totalMovimientos.set(movimientos.filter((m) => m.estadoMovimiento === 'ACTIVO').length);
        this.ultimosMovimientos.set(movimientos.slice(0, 6));

        this.movimientosPendientes.set(reporte.resumen.pendientes);
        this.movimientosListos.set(reporte.resumen.listos);

        const bodegasUnicas = new Set(stock.map((s) => s.bodegaId));
        this.totalBodegas.set(bodegasUnicas.size);

        const stockMap = this.buildStockMap(stock);
        const bajos: StockBajo[] = [];
        for (const prod of activos) {
          const total = stockMap.get(prod.idProducto) ?? 0;
          const minimo = parseFloat(prod.stockMinimo) || 0;
          if (minimo > 0 && total < minimo) {
            bajos.push({ producto: prod, stockTotal: total, stockMinimo: minimo });
          }
        }
        bajos.sort((a, b) => a.stockTotal - b.stockTotal);
        this.stockBajo.set(bajos);
      },
    });
  }

  private buildStockMap(stock: StockProductoBodega[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const s of stock) {
      const prev = map.get(s.productoId) ?? 0;
      map.set(s.productoId, prev + parseFloat(s.stockActual));
    }
    return map;
  }

  labelTipo(tipo: string): string {
    return this.TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
  }

  tipoClass(tipo: string): string {
    return this.TIPOS.find((t) => t.value === tipo)?.signo === '+' ? 'tipo-suma' : 'tipo-resta';
  }
}
