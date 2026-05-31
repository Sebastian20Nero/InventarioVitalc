import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ConfiguracionDsnube,
  EmpalmeService,
  MovimientoEmpalme,
  ReporteEmpalme,
} from '../../core/services/empalme.service';
import { TIPOS_MOVIMIENTO } from '../../core/services/inventario.service';

type Tab = 'movimientos' | 'reporte' | 'importar' | 'configuracion';

@Component({
  selector: 'app-empalme-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page">
      <!-- HEADER TABS -->
      <div class="card">
        <h2>Empalme DsNube</h2>
        <div class="tabs">
          <button [class.active]="tab() === 'movimientos'" type="button" (click)="tab.set('movimientos')">
            Movimientos
          </button>
          <button [class.active]="tab() === 'reporte'" type="button" (click)="cambiarTab('reporte')">
            Reporte
          </button>
          <button [class.active]="tab() === 'importar'" type="button" (click)="tab.set('importar')">
            Importar
          </button>
          <button [class.active]="tab() === 'configuracion'" type="button" (click)="cambiarTab('configuracion')">
            Configuración DsNube
          </button>
        </div>
      </div>

      <!-- TAB: MOVIMIENTOS -->
      @if (tab() === 'movimientos') {
        <div class="card">
          <div class="filter-row">
            <select [(ngModel)]="filtroEmpalme" name="fe">
              <option value="">Todos los estados de empalme</option>
              <option value="PENDIENTE_REVISION">Pendiente revisión</option>
              <option value="OBSERVADO">Observado</option>
              <option value="LISTO_DSNUBE">Listo DsNube</option>
              <option value="CARGADO_DSNUBE">Cargado DsNube</option>
            </select>
            <select [(ngModel)]="filtroTipo" name="ft">
              <option value="">Todos los tipos</option>
              <option *ngFor="let t of tipos" [value]="t.value">{{ t.label }}</option>
            </select>
            <input [(ngModel)]="filtroTexto" name="fq" placeholder="Buscar consecutivo o producto…" class="filter-input" />
            <button class="ghost" type="button" (click)="cargarMovimientos()">↺ Actualizar</button>
          </div>
          <div class="muted" style="font-size:0.85rem;margin-top:0.5rem">
            {{ movimientosFiltrados().length }} de {{ movimientos().length }} movimientos
          </div>
        </div>

        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Consecutivo</th>
                <th>Producto</th>
                <th>Bodega</th>
                <th>Tipo</th>
                <th>Cantidad</th>
                <th>Estado op.</th>
                <th>Estado empalme</th>
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr
                *ngFor="let m of movimientosFiltrados()"
                [class.row-anulado]="m.estadoMovimiento === 'ANULADO'"
              >
                <td><code>{{ m.consecutivo }}</code></td>
                <td>
                  <div>{{ m.producto.nombre }}</div>
                  <div class="muted" style="font-size:0.78rem;font-family:monospace">{{ m.producto.codigoInterno }}</div>
                </td>
                <td>{{ m.bodega.nombre }}</td>
                <td><span [class]="classTipo(m.tipoMovimiento)">{{ labelTipo(m.tipoMovimiento) }}</span></td>
                <td style="text-align:right">{{ m.cantidad }}</td>
                <td>
                  <span [class]="m.estadoMovimiento === 'ANULADO' ? 'badge-inactivo' : 'badge-activo'">
                    {{ m.estadoMovimiento }}
                  </span>
                </td>
                <td><span [class]="badgeEmpalme(m.estadoEmpalme)">{{ labelEmpalme(m.estadoEmpalme) }}</span></td>
                <td class="muted" style="font-size:0.82rem">{{ m.createdAt | date:'dd/MM/yy HH:mm' }}</td>
                <td>
                  <div class="accion-row" *ngIf="m.estadoMovimiento !== 'ANULADO'">
                    <button
                      class="ghost btn-sm"
                      type="button"
                      *ngIf="m.estadoEmpalme === 'PENDIENTE_REVISION'"
                      (click)="abrirAccion(m, 'revisar')"
                    >Revisar</button>
                    <button
                      class="btn-observar btn-sm"
                      type="button"
                      *ngIf="['PENDIENTE_REVISION', 'OBSERVADO'].includes(m.estadoEmpalme)"
                      (click)="abrirAccion(m, 'observar')"
                    >Observar</button>
                    <button
                      class="btn-listo btn-sm"
                      type="button"
                      *ngIf="m.estadoEmpalme === 'PENDIENTE_REVISION'"
                      (click)="abrirAccion(m, 'marcar-listo')"
                    >Listo</button>
                    <button
                      class="btn-cargado btn-sm"
                      type="button"
                      *ngIf="m.estadoEmpalme === 'LISTO_DSNUBE'"
                      (click)="abrirAccion(m, 'marcar-cargado')"
                    >Cargado</button>
                    <span class="muted" style="font-size:0.8rem" *ngIf="m.estadoEmpalme === 'CARGADO_DSNUBE'">
                      ✓ Cargado
                    </span>
                  </div>
                </td>
              </tr>
              <tr *ngIf="movimientosFiltrados().length === 0">
                <td colspan="9" class="empty">No hay movimientos que coincidan.</td>
              </tr>
            </tbody>
          </table>
        </div>
      }

      <!-- TAB: REPORTE -->
      @if (tab() === 'reporte') {
        <div class="grid two" *ngIf="reporte()">
          <div class="card">
            <h3>Resumen de empalme</h3>
            <div class="stats-grid-4">
              <div class="stat-item">
                <div class="stat-number">{{ reporte()!.resumen.total }}</div>
                <div class="stat-label">Total</div>
              </div>
              <div class="stat-item stat-warn">
                <div class="stat-number">{{ reporte()!.resumen.pendientes }}</div>
                <div class="stat-label">Pendientes</div>
              </div>
              <div class="stat-item stat-danger">
                <div class="stat-number">{{ reporte()!.resumen.observados }}</div>
                <div class="stat-label">Observados</div>
              </div>
              <div class="stat-item stat-ok">
                <div class="stat-number">{{ reporte()!.resumen.listos }}</div>
                <div class="stat-label">Listos DsNube</div>
              </div>
              <div class="stat-item stat-purple">
                <div class="stat-number">{{ reporte()!.resumen.cargados }}</div>
                <div class="stat-label">Cargados</div>
              </div>
            </div>
          </div>

          <div class="card">
            <h3>Exportar reporte</h3>
            <p class="muted">Descarga el reporte de movimientos listos para DsNube.</p>
            <div class="actions" style="margin-top:1rem">
              <button type="button" (click)="exportar('excel')" [disabled]="exportando()">
                {{ exportando() === 'excel' ? 'Descargando…' : '⬇ Excel' }}
              </button>
              <button class="ghost" type="button" (click)="exportar('pdf')" [disabled]="exportando()">
                {{ exportando() === 'pdf' ? 'Descargando…' : '⬇ PDF' }}
              </button>
            </div>
            <p class="error" *ngIf="errorExport()">{{ errorExport() }}</p>
          </div>
        </div>
        <div class="card" *ngIf="!reporte()">
          <p class="muted">Cargando reporte…</p>
        </div>
      }

      <!-- TAB: IMPORTAR -->
      @if (tab() === 'importar') {
        <div class="grid two">
          <!-- Importar por Excel -->
          <div class="card">
            <h3>Importar desde Excel</h3>
            <p class="muted">
              Sube un archivo Excel con la columna <strong>consecutivo</strong> para marcar
              movimientos como cargados en DsNube de forma masiva.
            </p>
            <div class="actions" style="margin-bottom:0.75rem">
              <button class="ghost" type="button" (click)="descargarPlantilla()">
                ⬇ Descargar plantilla
              </button>
            </div>
            <label>
              Archivo Excel
              <input type="file" accept=".xlsx,.xls" (change)="onFileChange($event)" />
            </label>
            <button
              type="button"
              [disabled]="!archivoSeleccionado() || importando()"
              (click)="importarExcel()"
              style="margin-top:0.5rem"
            >
              {{ importando() ? 'Importando…' : 'Importar archivo' }}
            </button>
            <div class="import-result" *ngIf="resultadoImport()">
              <p class="success">✓ {{ resultadoImport()!.procesados }} movimientos marcados como cargados.</p>
              <ul *ngIf="resultadoImport()!.errores.length > 0">
                <li *ngFor="let e of resultadoImport()!.errores" class="error">{{ e }}</li>
              </ul>
            </div>
            <p class="error" *ngIf="errorImport()">{{ errorImport() }}</p>
          </div>

          <!-- Importar por consecutivos -->
          <div class="card">
            <h3>Marcar por consecutivos</h3>
            <p class="muted">
              Ingresa los consecutivos (uno por línea) de los movimientos que ya fueron cargados en DsNube.
            </p>
            <label>
              Consecutivos
              <textarea
                [(ngModel)]="textConsecutivos"
                name="cons"
                rows="8"
                placeholder="MOV-2026-000001&#10;MOV-2026-000002&#10;MOV-2026-000003"
              ></textarea>
            </label>
            <button
              type="button"
              [disabled]="!textConsecutivos.trim() || importandoCons()"
              (click)="importarConsecutivos()"
              style="margin-top:0.5rem"
            >
              {{ importandoCons() ? 'Procesando…' : 'Marcar como cargados' }}
            </button>
            <div class="import-result" *ngIf="resultadoCons()">
              <p class="success">✓ {{ resultadoCons()!.procesados }} movimientos procesados.</p>
              <ul *ngIf="resultadoCons()!.errores.length > 0">
                <li *ngFor="let e of resultadoCons()!.errores" class="error">{{ e }}</li>
              </ul>
            </div>
            <p class="error" *ngIf="errorCons()">{{ errorCons() }}</p>
          </div>
        </div>
      }

      <!-- TAB: CONFIGURACIÓN -->
      @if (tab() === 'configuracion') {
        <div class="card config-card">
          <h3>Configuración de conexión DsNube</h3>
          <p class="muted">
            Estos datos se usan para identificar el entorno DsNube al que pertenece la información.
          </p>
          <form (ngSubmit)="guardarConfiguracion()" style="display:grid;gap:1rem;margin-top:1rem">
            <label>
              URL de DsNube
              <input [(ngModel)]="configForm.url" name="url" placeholder="https://empresa.dsnube.co" required />
            </label>
            <div class="grid two">
              <label>
                Usuario
                <input [(ngModel)]="configForm.usuario" name="usuario" required />
              </label>
              <label>
                Contraseña
                <input [(ngModel)]="configForm.password" name="password" type="password" placeholder="Dejar vacío para no cambiar" />
              </label>
            </div>
            <p class="error" *ngIf="errorConfig()">{{ errorConfig() }}</p>
            <p class="success" *ngIf="exitoConfig()">{{ exitoConfig() }}</p>
            <div class="actions">
              <button type="submit" [disabled]="guardandoConfig()">
                {{ guardandoConfig() ? 'Guardando…' : 'Guardar configuración' }}
              </button>
            </div>
          </form>
        </div>
      }
    </section>

    <!-- MODAL ACCIÓN EMPALME -->
    <div class="modal-overlay" *ngIf="accionActual()">
      <div class="modal-card">
        <h3>{{ labelAccion(accionActual()!.accion) }}</h3>
        <p>
          Movimiento <strong>{{ accionActual()!.movimiento.consecutivo }}</strong> —
          {{ accionActual()!.movimiento.producto.nombre }}
        </p>
        <label style="margin-top:0.5rem">
          Observación <span class="muted">(opcional)</span>
          <input [(ngModel)]="observacionAccion" name="obs" placeholder="Comentario de la revisión…" />
        </label>
        <p class="error" *ngIf="errorAccion()">{{ errorAccion() }}</p>
        <div class="actions" style="margin-top:0.5rem">
          <button type="button" [disabled]="ejecutando()" (click)="ejecutarAccion()">
            {{ ejecutando() ? 'Procesando…' : 'Confirmar' }}
          </button>
          <button class="ghost" type="button" (click)="cerrarAccion()">Cancelar</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .accion-row { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .btn-sm { padding: 0.3rem 0.7rem; font-size: 0.8rem; border-radius: 6px; }
    .btn-observar { background: #fef3c7; color: #92400e; }
    .btn-listo { background: #dcfce7; color: #15803d; }
    .btn-cargado { background: #ede9fe; color: #6d28d9; }
    .tipo-suma { color: #15803d; font-weight: 600; font-size: 0.82rem; }
    .tipo-resta { color: #b91c1c; font-weight: 600; font-size: 0.82rem; }
    .badge-empalme-pendiente { background: #fef3c7; color: #92400e; display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .badge-empalme-observado { background: #fee2e2; color: #b91c1c; display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .badge-empalme-listo { background: #dcfce7; color: #15803d; display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .badge-empalme-cargado { background: #ede9fe; color: #6d28d9; display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .row-anulado { opacity: 0.5; }
    .empty { text-align: center; color: #6b7280; padding: 2rem !important; }
    .filter-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .filter-input { flex: 1; min-width: 200px; }
    .stats-grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 0.75rem; margin-top:0.75rem; }
    .stat-item { background: #f4f4f5; border-radius: 8px; padding: 0.75rem; text-align: center; }
    .stat-number { font-size: 1.75rem; font-weight: 700; color: #2563eb; }
    .stat-label { font-size: 0.75rem; color: #6b7280; margin-top: 0.2rem; }
    .stat-warn .stat-number { color: #d97706; }
    .stat-danger .stat-number { color: #b91c1c; }
    .stat-ok .stat-number { color: #15803d; }
    .stat-purple .stat-number { color: #6d28d9; }
    .config-card { max-width: 640px; }
    .success { color: #15803d; font-weight: 600; margin: 0; }
    .import-result { margin-top: 0.75rem; padding: 0.75rem; background: #f0fdf4; border-radius: 8px; }
    .import-result ul { margin: 0.5rem 0 0; padding-left: 1.25rem; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: grid; place-items: center; z-index: 100; }
    .modal-card { background: white; border-radius: 16px; padding: 2rem; width: min(100%, 480px); display: grid; gap: 1rem; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
    .modal-card h3, .modal-card p { margin: 0; }
  `],
})
export class EmpalmePageComponent implements OnInit {
  private readonly svc = inject(EmpalmeService);

  readonly tipos = TIPOS_MOVIMIENTO;
  readonly tab = signal<Tab>('movimientos');
  readonly movimientos = signal<MovimientoEmpalme[]>([]);
  readonly reporte = signal<ReporteEmpalme | null>(null);

  filtroEmpalme = '';
  filtroTipo = '';
  filtroTexto = '';

  readonly accionActual = signal<{ movimiento: MovimientoEmpalme; accion: string } | null>(null);
  observacionAccion = '';
  readonly ejecutando = signal(false);
  readonly errorAccion = signal('');

  readonly exportando = signal<'excel' | 'pdf' | null>(null);
  readonly errorExport = signal('');

  readonly archivoSeleccionado = signal<File | null>(null);
  readonly importando = signal(false);
  readonly resultadoImport = signal<{ procesados: number; errores: string[] } | null>(null);
  readonly errorImport = signal('');

  textConsecutivos = '';
  readonly importandoCons = signal(false);
  readonly resultadoCons = signal<{ procesados: number; errores: string[] } | null>(null);
  readonly errorCons = signal('');

  readonly guardandoConfig = signal(false);
  readonly errorConfig = signal('');
  readonly exitoConfig = signal('');
  configForm = { url: '', usuario: '', password: '' };

  ngOnInit() {
    this.cargarMovimientos();
  }

  cargarMovimientos() {
    this.svc.listarMovimientos().subscribe((data) => this.movimientos.set(data));
  }

  cambiarTab(t: Tab) {
    this.tab.set(t);
    if (t === 'reporte') this.cargarReporte();
    if (t === 'configuracion') this.cargarConfiguracion();
  }

  cargarReporte() {
    this.reporte.set(null);
    this.svc.obtenerReporte().subscribe((data) => this.reporte.set(data));
  }

  cargarConfiguracion() {
    this.svc.obtenerConfiguracion().subscribe((data) => {
      if (data) {
        this.configForm.url = data.url;
        this.configForm.usuario = data.usuario;
        this.configForm.password = '';
      }
    });
  }

  movimientosFiltrados(): MovimientoEmpalme[] {
    let lista = this.movimientos();
    if (this.filtroEmpalme) lista = lista.filter((m) => m.estadoEmpalme === this.filtroEmpalme);
    if (this.filtroTipo) lista = lista.filter((m) => m.tipoMovimiento === this.filtroTipo);
    const q = this.filtroTexto.toLowerCase().trim();
    if (q) {
      lista = lista.filter(
        (m) =>
          m.consecutivo.toLowerCase().includes(q) ||
          m.producto.nombre.toLowerCase().includes(q) ||
          m.producto.codigoInterno.toLowerCase().includes(q),
      );
    }
    return lista;
  }

  abrirAccion(m: MovimientoEmpalme, accion: string) {
    this.accionActual.set({ movimiento: m, accion });
    this.observacionAccion = '';
    this.errorAccion.set('');
  }

  cerrarAccion() {
    this.accionActual.set(null);
    this.observacionAccion = '';
  }

  ejecutarAccion() {
    const current = this.accionActual();
    if (!current) return;
    const { movimiento, accion } = current;
    const obs = this.observacionAccion || undefined;

    const request$ = {
      revisar: () => this.svc.revisar(movimiento.idMovimiento, obs),
      observar: () => this.svc.observar(movimiento.idMovimiento, obs),
      'marcar-listo': () => this.svc.marcarListo(movimiento.idMovimiento, obs),
      'marcar-cargado': () => this.svc.marcarCargado(movimiento.idMovimiento, obs),
    }[accion];

    if (!request$) return;

    this.ejecutando.set(true);
    request$().subscribe({
      next: () => {
        this.ejecutando.set(false);
        this.cerrarAccion();
        this.cargarMovimientos();
      },
      error: (e: { error?: { message?: string } }) => {
        this.ejecutando.set(false);
        this.errorAccion.set(e?.error?.message ?? 'Error al ejecutar la acción.');
      },
    });
  }

  exportar(formato: 'excel' | 'pdf') {
    this.exportando.set(formato);
    this.errorExport.set('');
    this.svc.exportarReporte(formato).subscribe({
      next: (resp) => {
        this.exportando.set(null);
        const blob = resp.body!;
        const ext = formato === 'excel' ? 'xlsx' : 'pdf';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reporte-empalme.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.exportando.set(null);
        this.errorExport.set('Error al descargar el reporte.');
      },
    });
  }

  descargarPlantilla() {
    this.svc.descargarPlantilla().subscribe({
      next: (resp) => {
        const blob = resp.body!;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'plantilla-importacion.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      },
    });
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.archivoSeleccionado.set(input.files?.[0] ?? null);
    this.resultadoImport.set(null);
    this.errorImport.set('');
  }

  importarExcel() {
    const file = this.archivoSeleccionado();
    if (!file) return;
    this.importando.set(true);
    this.resultadoImport.set(null);
    this.errorImport.set('');
    this.svc.importarExcel(file).subscribe({
      next: (data) => {
        this.importando.set(false);
        this.resultadoImport.set(data);
        this.cargarMovimientos();
      },
      error: (e: { error?: { message?: string } }) => {
        this.importando.set(false);
        this.errorImport.set(e?.error?.message ?? 'Error al importar el archivo.');
      },
    });
  }

  importarConsecutivos() {
    const lista = this.textConsecutivos
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lista.length) return;
    this.importandoCons.set(true);
    this.resultadoCons.set(null);
    this.errorCons.set('');
    this.svc.importarConsecutivos(lista).subscribe({
      next: (data) => {
        this.importandoCons.set(false);
        this.resultadoCons.set(data);
        this.textConsecutivos = '';
        this.cargarMovimientos();
      },
      error: (e: { error?: { message?: string } }) => {
        this.importandoCons.set(false);
        this.errorCons.set(e?.error?.message ?? 'Error al procesar los consecutivos.');
      },
    });
  }

  guardarConfiguracion() {
    this.errorConfig.set('');
    this.exitoConfig.set('');
    if (!this.configForm.url.trim() || !this.configForm.usuario.trim()) {
      this.errorConfig.set('URL y usuario son obligatorios.');
      return;
    }
    this.guardandoConfig.set(true);
    this.svc
      .guardarConfiguracion({
        url: this.configForm.url.trim(),
        usuario: this.configForm.usuario.trim(),
        password: this.configForm.password || undefined,
      })
      .subscribe({
        next: () => {
          this.guardandoConfig.set(false);
          this.exitoConfig.set('Configuración guardada correctamente.');
          this.configForm.password = '';
        },
        error: (e: { error?: { message?: string } }) => {
          this.guardandoConfig.set(false);
          this.errorConfig.set(e?.error?.message ?? 'Error al guardar la configuración.');
        },
      });
  }

  labelTipo(tipo: string): string {
    return this.tipos.find((t) => t.value === tipo)?.label ?? tipo;
  }

  classTipo(tipo: string): string {
    return this.tipos.find((t) => t.value === tipo)?.signo === '+' ? 'tipo-suma' : 'tipo-resta';
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

  labelAccion(accion: string): string {
    const map: Record<string, string> = {
      revisar: 'Marcar como revisado',
      observar: 'Dejar observación',
      'marcar-listo': 'Marcar listo para DsNube',
      'marcar-cargado': 'Marcar como cargado en DsNube',
    };
    return map[accion] ?? accion;
  }
}
