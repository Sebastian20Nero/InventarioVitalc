import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogosService } from '../../core/services/catalogos.service';
import { ProductosService } from '../../core/services/productos.service';
import {
  InventarioService,
  MovimientoInventario,
  TIPOS_MOVIMIENTO,
} from '../../core/services/inventario.service';
import { Bodega, Producto } from '../../core/models/inventario.models';

@Component({
  selector: 'app-historial-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page">
      <!-- FILTROS -->
      <div class="card">
        <h2>Historial de movimientos</h2>
        <div class="filter-row">
          <select [(ngModel)]="filtroProducto" name="fp">
            <option value="">Todos los productos</option>
            <option *ngFor="let p of productos()" [value]="p.idProducto">
              [{{ p.codigoInterno }}] {{ p.nombre }}
            </option>
          </select>
          <select [(ngModel)]="filtroBodega" name="fb">
            <option value="">Todas las bodegas</option>
            <option *ngFor="let b of bodegas()" [value]="b.idBodega">{{ b.nombre }}</option>
          </select>
          <select [(ngModel)]="filtroTipo" name="ft">
            <option value="">Todos los tipos</option>
            <option *ngFor="let t of tipos" [value]="t.value">{{ t.label }}</option>
          </select>
          <select [(ngModel)]="filtroEstado" name="fe">
            <option value="">Todos los estados</option>
            <option value="ACTIVO">Activos</option>
            <option value="ANULADO">Anulados</option>
          </select>
          <select [(ngModel)]="filtroEmpalme" name="fem">
            <option value="">Todos (empalme)</option>
            <option value="PENDIENTE_REVISION">Pendiente revisión</option>
            <option value="OBSERVADO">Observado</option>
            <option value="LISTO_DSNUBE">Listo DsNube</option>
            <option value="CARGADO_DSNUBE">Cargado DsNube</option>
          </select>
          <input [(ngModel)]="filtroConsecutivo" name="fc" placeholder="Buscar consecutivo…" class="filter-input-sm" />
        </div>
        <div class="filter-summary muted">
          Mostrando {{ movimientosFiltrados().length }} de {{ movimientos().length }} movimientos
        </div>
      </div>

      <!-- TABLA -->
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Consecutivo</th>
              <th>Producto</th>
              <th>Bodega</th>
              <th>Tipo</th>
              <th>Cantidad</th>
              <th>Stock ant.</th>
              <th>Stock nuevo</th>
              <th>Estado</th>
              <th>Empalme</th>
              <th>Registrado por</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let m of movimientosFiltrados()" [class.row-anulado]="m.estadoMovimiento === 'ANULADO'">
              <td><code>{{ m.consecutivo }}</code></td>
              <td>
                <div>{{ m.producto.nombre }}</div>
                <div class="muted codigo">{{ m.producto.codigoInterno }}</div>
              </td>
              <td>{{ m.bodega.nombre }}</td>
              <td>
                <span [class]="classTipo(m.tipoMovimiento)">{{ labelTipo(m.tipoMovimiento) }}</span>
              </td>
              <td class="num">{{ m.cantidad }}</td>
              <td class="num muted">{{ m.stockAnterior }}</td>
              <td class="num"><strong>{{ m.stockNuevo }}</strong></td>
              <td>
                <span [class]="m.estadoMovimiento === 'ANULADO' ? 'badge-inactivo' : 'badge-activo'">
                  {{ m.estadoMovimiento }}
                </span>
              </td>
              <td>
                <span [class]="badgeEmpalme(m.estadoEmpalme)">{{ labelEmpalme(m.estadoEmpalme) }}</span>
              </td>
              <td class="muted">{{ m.creador.nombres }} {{ m.creador.apellidos }}</td>
              <td class="muted">{{ m.createdAt | date:'dd/MM/yy HH:mm' }}</td>
              <td class="table-actions">
                <button
                  class="danger"
                  type="button"
                  *ngIf="m.estadoMovimiento === 'ACTIVO'"
                  (click)="abrirAnulacion(m)"
                >
                  Anular
                </button>
                <span class="muted" *ngIf="m.estadoMovimiento === 'ANULADO'" title="{{ m.motivoAnulacion }}">
                  Anulado
                </span>
              </td>
            </tr>
            <tr *ngIf="movimientosFiltrados().length === 0">
              <td colspan="12" class="empty">No se encontraron movimientos.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- MODAL ANULACIÓN -->
      <div class="modal-overlay" *ngIf="movimientoAAnular()">
        <div class="modal-card">
          <h3>Anular movimiento</h3>
          <p>
            ¿Estás seguro de anular el movimiento
            <strong>{{ movimientoAAnular()!.consecutivo }}</strong>?
          </p>
          <p class="muted">
            Esta acción revertirá el stock automáticamente.
          </p>
          <label>
            Motivo de anulación <span class="req">*</span>
            <textarea [(ngModel)]="motivoAnulacion" name="motivo" rows="3" placeholder="Describe el motivo…"></textarea>
          </label>
          <p class="error" *ngIf="errorAnulacion()">{{ errorAnulacion() }}</p>
          <div class="actions">
            <button class="danger" type="button" [disabled]="anulando()" (click)="confirmarAnulacion()">
              {{ anulando() ? 'Anulando…' : 'Confirmar anulación' }}
            </button>
            <button class="ghost" type="button" (click)="cerrarAnulacion()">Cancelar</button>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .filter-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; }
    .filter-input-sm { min-width: 180px; }
    .filter-summary { font-size: 0.85rem; margin-top: 0.5rem; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .codigo { font-family: monospace; font-size: 0.75rem; }
    .row-anulado { opacity: 0.55; }
    .tipo-suma { color: #15803d; font-weight: 600; font-size: 0.82rem; }
    .tipo-resta { color: #b91c1c; font-weight: 600; font-size: 0.82rem; }
    .empty { text-align: center; color: #6b7280; padding: 2rem !important; }
    .badge-empalme-pendiente { background: #fef3c7; color: #92400e; display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .badge-empalme-observado { background: #fee2e2; color: #b91c1c; display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .badge-empalme-listo { background: #dcfce7; color: #15803d; display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .badge-empalme-cargado { background: #ede9fe; color: #6d28d9; display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      display: grid; place-items: center; z-index: 100;
    }
    .modal-card {
      background: white; border-radius: 16px; padding: 2rem;
      width: min(100%, 480px); display: grid; gap: 1rem;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    }
    .modal-card h3 { margin: 0; }
    .modal-card p { margin: 0; }
    .req { color: #b91c1c; }
    textarea { width: 100%; border: 1px solid #d1d5db; border-radius: 10px; padding: 0.75rem; font: inherit; resize: vertical; }
  `],
})
export class HistorialPageComponent implements OnInit {
  private readonly svc = inject(InventarioService);
  private readonly productosSvc = inject(ProductosService);
  private readonly catalogosSvc = inject(CatalogosService);

  readonly tipos = TIPOS_MOVIMIENTO;
  readonly movimientos = signal<MovimientoInventario[]>([]);
  readonly productos = signal<Producto[]>([]);
  readonly bodegas = signal<Bodega[]>([]);
  readonly movimientoAAnular = signal<MovimientoInventario | null>(null);
  readonly anulando = signal(false);
  readonly errorAnulacion = signal('');

  filtroProducto = '';
  filtroBodega = '';
  filtroTipo = '';
  filtroEstado = '';
  filtroEmpalme = '';
  filtroConsecutivo = '';
  motivoAnulacion = '';

  movimientosFiltrados(): MovimientoInventario[] {
    let lista = this.movimientos();
    if (this.filtroProducto) lista = lista.filter((m) => m.productoId === this.filtroProducto);
    if (this.filtroBodega) lista = lista.filter((m) => m.bodegaId === this.filtroBodega);
    if (this.filtroTipo) lista = lista.filter((m) => m.tipoMovimiento === this.filtroTipo);
    if (this.filtroEstado) lista = lista.filter((m) => m.estadoMovimiento === this.filtroEstado);
    if (this.filtroEmpalme) lista = lista.filter((m) => m.estadoEmpalme === this.filtroEmpalme);
    if (this.filtroConsecutivo.trim()) {
      const q = this.filtroConsecutivo.trim().toLowerCase();
      lista = lista.filter((m) => m.consecutivo.toLowerCase().includes(q));
    }
    return lista;
  }

  ngOnInit() {
    this.cargar();
    this.productosSvc.listar().subscribe((data) => this.productos.set(data));
    this.catalogosSvc.listarBodegas().subscribe((data) => this.bodegas.set(data));
  }

  cargar() {
    this.svc.listarMovimientos().subscribe((data) => this.movimientos.set(data));
  }

  labelTipo(tipo: string): string {
    return this.tipos.find((t) => t.value === tipo)?.label ?? tipo;
  }

  classTipo(tipo: string): string {
    const t = this.tipos.find((x) => x.value === tipo);
    return t?.signo === '+' ? 'tipo-suma' : 'tipo-resta';
  }

  labelEmpalme(estado: string): string {
    const map: Record<string, string> = {
      PENDIENTE_REVISION: 'Pendiente',
      OBSERVADO: 'Observado',
      LISTO_DSNUBE: 'Listo DsNube',
      CARGADO_DSNUBE: 'Cargado',
    };
    return map[estado] ?? estado;
  }

  badgeEmpalme(estado: string): string {
    const map: Record<string, string> = {
      PENDIENTE_REVISION: 'badge-empalme-pendiente',
      OBSERVADO: 'badge-empalme-observado',
      LISTO_DSNUBE: 'badge-empalme-listo',
      CARGADO_DSNUBE: 'badge-empalme-cargado',
    };
    return map[estado] ?? '';
  }

  abrirAnulacion(m: MovimientoInventario) {
    this.movimientoAAnular.set(m);
    this.motivoAnulacion = '';
    this.errorAnulacion.set('');
  }

  cerrarAnulacion() {
    this.movimientoAAnular.set(null);
    this.motivoAnulacion = '';
    this.errorAnulacion.set('');
  }

  confirmarAnulacion() {
    if (!this.motivoAnulacion.trim()) {
      this.errorAnulacion.set('El motivo de anulación es obligatorio.');
      return;
    }
    const mov = this.movimientoAAnular();
    if (!mov) return;

    this.anulando.set(true);
    this.svc.anularMovimiento(mov.idMovimiento, this.motivoAnulacion.trim()).subscribe({
      next: () => {
        this.anulando.set(false);
        this.cerrarAnulacion();
        this.cargar();
      },
      error: (e) => {
        this.anulando.set(false);
        this.errorAnulacion.set(e?.error?.message ?? 'Error al anular el movimiento.');
      },
    });
  }
}
