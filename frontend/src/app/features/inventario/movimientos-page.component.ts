import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogosService } from '../../core/services/catalogos.service';
import { ProductosService } from '../../core/services/productos.service';
import {
  InventarioService,
  MovimientoInventario,
  StockProductoBodega,
  TIPOS_MOVIMIENTO,
} from '../../core/services/inventario.service';
import { Bodega, Producto } from '../../core/models/inventario.models';

@Component({
  selector: 'app-movimientos-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page">
      <div class="grid two">
        <!-- FORMULARIO REGISTRO -->
        <form class="card" (ngSubmit)="registrar()">
          <h2>Registrar movimiento</h2>

          <label>
            Tipo de movimiento
            <select [(ngModel)]="form.tipoMovimiento" name="tipo" required (ngModelChange)="onTipoChange()">
              <option value="">— Seleccionar —</option>
              <option *ngFor="let t of tipos" [value]="t.value">{{ t.signo }} {{ t.label }}</option>
            </select>
          </label>

          <label>
            Producto
            <select [(ngModel)]="form.productoId" name="producto" required (ngModelChange)="onProductoChange($event)">
              <option value="">— Seleccionar —</option>
              <option *ngFor="let p of productos()" [value]="p.idProducto">
                [{{ p.codigoInterno }}] {{ p.nombre }}
              </option>
            </select>
          </label>

          <label>
            Bodega
            <select [(ngModel)]="form.bodegaId" name="bodega" required (ngModelChange)="onBodegaChange()">
              <option value="">— Seleccionar —</option>
              <option *ngFor="let b of bodegas()" [value]="b.idBodega">{{ b.nombre }}</option>
            </select>
          </label>

          <div class="stock-info" *ngIf="stockSeleccionado()">
            <span>Stock actual en bodega:</span>
            <strong>{{ stockSeleccionado()!.stockActual }} {{ unidadProducto() }}</strong>
          </div>
          <div class="stock-info stock-zero" *ngIf="form.productoId && form.bodegaId && !stockSeleccionado()">
            <span>Sin movimientos previos en esta bodega — stock: <strong>0</strong></span>
          </div>

          <label>
            Cantidad
            <input
              [(ngModel)]="form.cantidad"
              name="cantidad"
              type="number"
              min="0.0001"
              step="0.0001"
              required
            />
          </label>

          <label>
            Observación
            <input [(ngModel)]="form.observacion" name="observacion" placeholder="Opcional" />
          </label>

          <p class="error" *ngIf="error()">{{ error() }}</p>
          <p class="success" *ngIf="exito()">{{ exito() }}</p>

          <button type="submit" [disabled]="guardando()">
            {{ guardando() ? 'Registrando…' : 'Registrar movimiento' }}
          </button>
        </form>

        <!-- ÚLTIMOS MOVIMIENTOS -->
        <div class="card">
          <h3>Últimos movimientos registrados</h3>
          <div *ngIf="ultimos().length === 0" class="empty">No hay movimientos aún.</div>
          <div class="mov-list" *ngIf="ultimos().length > 0">
            <div class="mov-item" *ngFor="let m of ultimos()">
              <div class="mov-header">
                <span class="mov-consecutivo">{{ m.consecutivo }}</span>
                <span [class]="'tipo-' + m.tipoMovimiento.toLowerCase()">{{ labelTipo(m.tipoMovimiento) }}</span>
                <span [class]="m.estadoMovimiento === 'ANULADO' ? 'badge-inactivo' : 'badge-activo'">
                  {{ m.estadoMovimiento }}
                </span>
              </div>
              <div class="mov-body">
                <span>{{ m.producto.nombre }}</span>
                <span class="muted">{{ m.bodega.nombre }}</span>
              </div>
              <div class="mov-footer">
                <span>Cant: <strong>{{ m.cantidad }}</strong></span>
                <span>Stock nuevo: <strong>{{ m.stockNuevo }}</strong></span>
                <span class="muted">{{ m.createdAt | date:'dd/MM/yyyy HH:mm' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .stock-info {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 0.6rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.9rem;
    }
    .stock-zero { background: #f9fafb; border-color: #e5e7eb; }
    .success { color: #15803d; margin: 0; font-weight: 600; }
    .empty { color: #6b7280; padding: 1rem 0; text-align: center; }
    .mov-list { display: grid; gap: 0.75rem; max-height: 480px; overflow-y: auto; }
    .mov-item {
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 0.75rem;
      display: grid;
      gap: 0.25rem;
    }
    .mov-header { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .mov-body { font-size: 0.9rem; display: flex; gap: 0.75rem; }
    .mov-footer { font-size: 0.8rem; display: flex; gap: 1rem; flex-wrap: wrap; color: #374151; }
    .mov-consecutivo { font-weight: 700; font-family: monospace; }
    .tipo-entrada, .tipo-saldo_inicial, .tipo-abastecimiento, .tipo-ajuste_positivo {
      color: #15803d; font-weight: 600; font-size: 0.8rem;
    }
    .tipo-salida, .tipo-ajuste_negativo { color: #b91c1c; font-weight: 600; font-size: 0.8rem; }
  `],
})
export class MovimientosPageComponent implements OnInit {
  private readonly svc = inject(InventarioService);
  private readonly productosSvc = inject(ProductosService);
  private readonly catalogosSvc = inject(CatalogosService);

  readonly tipos = TIPOS_MOVIMIENTO;
  readonly productos = signal<Producto[]>([]);
  readonly bodegas = signal<Bodega[]>([]);
  readonly allStock = signal<StockProductoBodega[]>([]);
  readonly stockSeleccionado = signal<StockProductoBodega | null>(null);
  readonly unidadProducto = signal('');
  readonly ultimos = signal<MovimientoInventario[]>([]);
  readonly error = signal('');
  readonly exito = signal('');
  readonly guardando = signal(false);

  form = {
    tipoMovimiento: '',
    productoId: '',
    bodegaId: '',
    cantidad: '',
    observacion: '',
  };

  ngOnInit() {
    this.productosSvc
      .listar()
      .subscribe((data) => this.productos.set(data.filter((p) => p.activo)));
    this.catalogosSvc
      .listarBodegas()
      .subscribe((data) => this.bodegas.set(data.filter((b) => b.activo)));
    this.svc.listarStock().subscribe((data) => this.allStock.set(data));
    this.cargarUltimos();
  }

  cargarUltimos() {
    this.svc
      .listarMovimientos()
      .subscribe((data) => this.ultimos.set(data.slice(0, 10)));
  }

  onTipoChange() {
    this.error.set('');
    this.exito.set('');
  }

  onProductoChange(productoId: string) {
    this.error.set('');
    this.exito.set('');
    this.stockSeleccionado.set(null);
    const prod = this.productos().find((p) => p.idProducto === productoId);
    this.unidadProducto.set(prod?.unidad?.abreviatura ?? '');
    this.actualizarStock();
  }

  onBodegaChange() {
    this.error.set('');
    this.actualizarStock();
  }

  private actualizarStock() {
    if (!this.form.productoId || !this.form.bodegaId) {
      this.stockSeleccionado.set(null);
      return;
    }
    const match = this.allStock().find(
      (s) => s.productoId === this.form.productoId && s.bodegaId === this.form.bodegaId,
    );
    this.stockSeleccionado.set(match ?? null);
  }

  registrar() {
    this.error.set('');
    this.exito.set('');

    if (!this.form.tipoMovimiento || !this.form.productoId || !this.form.bodegaId || !this.form.cantidad) {
      this.error.set('Completa todos los campos obligatorios.');
      return;
    }

    this.guardando.set(true);
    this.svc
      .registrarMovimiento({
        tipoMovimiento: this.form.tipoMovimiento,
        productoId: this.form.productoId,
        bodegaId: this.form.bodegaId,
        cantidad: this.form.cantidad,
        observacion: this.form.observacion || undefined,
      })
      .subscribe({
        next: (mov) => {
          this.guardando.set(false);
          this.exito.set(`Movimiento ${mov.consecutivo} registrado correctamente.`);
          this.resetForm();
          this.svc.listarStock().subscribe((data) => this.allStock.set(data));
          this.cargarUltimos();
        },
        error: (e) => {
          this.guardando.set(false);
          this.error.set(e?.error?.message ?? 'Error al registrar movimiento.');
        },
      });
  }

  labelTipo(tipo: string): string {
    return this.tipos.find((t) => t.value === tipo)?.label ?? tipo;
  }

  private resetForm() {
    this.form = { tipoMovimiento: '', productoId: '', bodegaId: '', cantidad: '', observacion: '' };
    this.stockSeleccionado.set(null);
    this.unidadProducto.set('');
  }
}
