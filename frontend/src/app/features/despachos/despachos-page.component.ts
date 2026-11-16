import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Producto } from '../../core/models/inventario.models';
import { DespachosService, LecturaDropi } from '../../core/services/despachos.service';
import { ProductosService } from '../../core/services/productos.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-despachos-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page">
      <div class="card">
        <h2>Cargar manifiesto DROPI</h2>
        <p>La lectura no guarda el corte. Si falta asociar un producto, el corte no se guarda.</p>
        <label>PDF</label>
        <input type="file" accept="application/pdf,.pdf" (change)="elegir($event)" />
        <p *ngIf="mensaje()">{{ mensaje() }}</p>
        <ul *ngIf="lectura()">
          <li>{{ lectura()!.transportadora || 'Sin transportadora' }} · {{ lectura()!.fecha || 'sin fecha' }}</li>
          <li>{{ lectura()!.guias.length }} guías · {{ lectura()!.unidadesResumen }} unidades en el resumen · {{ lectura()!.unidadesRotulos }} en rótulos</li>
        </ul>
        <p *ngFor="let aviso of lectura()?.avisos">{{ aviso }}</p>
        <p *ngFor="let bloqueo of lectura()?.bloqueos"><strong>{{ bloqueo }}</strong></p>
        <p *ngFor="let prueba of lectura()?.validaciones">{{ prueba.ok ? 'Cuadra' : 'Revisar' }}: {{ prueba.titulo }}. {{ prueba.detalle }}</p>

        <div *ngFor="let item of pendientes()">
          <div>{{ item.nombre }} · {{ item.sku || 'sin SKU' }} / {{ item.idDropi }} · {{ item.cantidad }}</div>
          <select [(ngModel)]="productoElegido[clave(item)]" [name]="clave(item)">
            <option value="">Producto del maestro</option>
            <option *ngFor="let producto of productos()" [value]="producto.idProducto">{{ producto.codigoInterno }} · {{ producto.nombre }}</option>
          </select>
          <button type="button" (click)="asociar(item)">Asociar</button>
        </div>

        <label>Número de corte</label>
        <input type="number" min="1" [(ngModel)]="numero" name="numero" />
        <button type="button" (click)="guardar()" [disabled]="!lectura() || !!lectura()!.bloqueos.length">Guardar corte</button>
      </div>

      <div class="card">
        <h2>Día</h2>
        <input type="date" [(ngModel)]="fecha" name="fecha" />
        <button type="button" (click)="cargarDia()">Ver día</button>
        <button type="button" (click)="descargar()">Exportar Excel</button>
        <table *ngIf="cortes().length">
          <tr>
            <th>Corte</th><th>Transportadora</th><th>Guías</th><th>Unidades</th><th>Revisados</th><th>Embolsados</th><th>Empacados</th>
          </tr>
          <tr *ngFor="let corte of cortes()" (click)="elegirCorte(corte)" [class.selected]="corteId === corte['idCorte']">
            <td>{{ corte['numero'] }}</td>
            <td>{{ corte['transportadora'] }}</td>
            <td>{{ corte['guias'] }}</td>
            <td>{{ corte['unidades'] }}</td>
            <td>{{ corte['revisados'] }}/{{ corte['productos'] }}</td>
            <td>{{ corte['embolsados'] }}/{{ corte['productos'] }}</td>
            <td>{{ corte['empacados'] }}/{{ corte['productos'] }}</td>
          </tr>
        </table>
        <p *ngIf="!cortes().length">Ese día no hay cortes cargados.</p>
      </div>

      <div class="card" *ngIf="corteId && puedeCargar">
        <h2>Asignar</h2>
        <label *ngFor="let persona of personas()">
          <input type="checkbox" [checked]="asignados.has(persona.idUsuario)" (change)="alternar(persona.idUsuario)" />
          {{ persona.nombres }} {{ persona.apellidos }}
        </label>
        <button type="button" (click)="asignar()">Guardar asignación</button>
      </div>

      <div class="card" *ngIf="corteId && puedeDespachar">
        <h2>Escanear y cerrar</h2>
        <p>{{ conteo() }}</p>
        <input [(ngModel)]="codigo" name="codigo" placeholder="Código de la pistola" (keyup.enter)="escanear()" />
        <button type="button" (click)="escanear()">Registrar</button>
        <table *ngIf="guias().length">
          <tr><th>Guía</th><th>Ciudad</th><th>Estado</th><th></th></tr>
          <tr *ngFor="let guia of guias()">
            <td>{{ guia.numero }}</td>
            <td>{{ guia.ciudad }}</td>
            <td>{{ guia.estado }}</td>
            <td>
              <button type="button" (click)="represar(guia.idGuia)" *ngIf="guia.estado !== 'represada'">Represar</button>
              <button type="button" (click)="reprogramar(guia.idGuia)" *ngIf="guia.estado === 'represada'">Reprogramar</button>
            </td>
          </tr>
        </table>
        <label>Auxiliar que recibe</label>
        <input [(ngModel)]="auxiliar" name="auxiliar" />
        <label>Placa</label>
        <input [(ngModel)]="placa" name="placa" />
        <label>Hora</label>
        <input [(ngModel)]="hora" name="hora" />
        <label>Motivo si el alistamiento no terminó</label>
        <input [(ngModel)]="motivoCierre" name="motivoCierre" />
        <button type="button" (click)="cerrar()">Cerrar corte</button>
      </div>

      <div class="card" *ngIf="corteId">
        <h2>Alistamiento</h2>
        <table>
          <tr>
            <th>Código</th><th>Producto</th><th>Cantidad</th><th>Revisado</th><th>Embolsado</th><th>Empacado</th>
          </tr>
          <tr *ngFor="let fila of lista()">
            <td>{{ fila['codigoInterno'] }}</td>
            <td>{{ fila['nombre'] }}</td>
            <td>{{ fila['cantidad'] }}</td>
            <td><button type="button" (click)="marcar(fila, 'revisado', !fila['revisado'])">{{ fila['revisado'] ? 'Sí' : 'No' }}</button></td>
            <td><button type="button" (click)="marcar(fila, 'embolsado', !fila['embolsado'])">{{ fila['embolsado'] ? 'Sí' : 'No' }}</button></td>
            <td><button type="button" (click)="marcar(fila, 'empacado', !fila['empacado'])">{{ fila['empacado'] ? 'Sí' : 'No' }}</button></td>
          </tr>
        </table>
      </div>
    </section>
  `,
})
export class DespachosPageComponent implements OnInit {
  private readonly despachos = inject(DespachosService);
  private readonly productosApi = inject(ProductosService);
  private readonly auth = inject(AuthService);

  readonly lectura = signal<LecturaDropi | null>(null);
  readonly mensaje = signal('');
  readonly productos = signal<Producto[]>([]);
  readonly cortes = signal<Record<string, string | number>[]>([]);
  readonly personas = signal<{ idUsuario: string; nombres: string; apellidos: string }[]>([]);
  readonly lista = signal<Record<string, string | number | boolean>[]>([]);
  readonly guias = signal<{ idGuia: string; numero: string; ciudad: string; estado: string }[]>([]);
  readonly conteo = signal('Elige un corte.');

  fecha = new Date().toISOString().slice(0, 10);
  numero = 1;
  corteId = '';
  codigo = '';
  auxiliar = '';
  placa = '';
  hora = '';
  motivoCierre = '';
  productoElegido: Record<string, string> = {};
  asignados = new Set<string>();
  puedeCargar = false;
  puedeDespachar = false;

  ngOnInit() {
    this.puedeCargar = this.auth.hasPermission('DESPACHO_CARGAR');
    this.puedeDespachar = this.auth.hasPermission('DESPACHO_DESPACHAR');
    if (this.auth.hasPermission('PRODUCTO_CONSULTAR')) {
      this.productosApi.listar().subscribe((filas) => this.productos.set(filas));
    }
    if (this.puedeCargar) {
      this.despachos.usuarios().subscribe((respuesta) => this.personas.set(respuesta.data));
    }
    this.cargarDia();
  }

  pendientes() {
    return (this.lectura()?.resumen ?? []).filter((item) => !item.productoId);
  }

  clave(item: { sku: string; idDropi: string }) {
    return `${item.sku}|${item.idDropi}`;
  }

  elegir(evento: Event) {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    if (!archivo) return;
    this.mensaje.set('Leyendo el manifiesto…');
    this.despachos.revisar(archivo).subscribe({
      next: (respuesta) => {
        this.lectura.set(respuesta.data);
        this.mensaje.set(`${respuesta.data.nombreArchivo} leído. Todavía no está guardado.`);
      },
      error: (error) => this.mensaje.set(error?.error?.message || 'No se pudo leer el PDF.'),
    });
  }

  asociar(item: LecturaDropi['resumen'][number]) {
    const productoId = this.productoElegido[this.clave(item)];
    if (!productoId) {
      this.mensaje.set('Elige un producto del maestro.');
      return;
    }
    this.despachos.asociar({ sku: item.sku, idDropi: item.idDropi, nombre: item.nombre, productoId }).subscribe({
      next: () => {
        const actual = this.lectura();
        if (!actual) return;
        actual.resumen = actual.resumen.map((fila) =>
          fila.sku === item.sku && fila.idDropi === item.idDropi ? { ...fila, productoId } : fila,
        );
        actual.bloqueos = actual.bloqueos.filter((texto) => !texto.startsWith('Faltan '));
        const faltan = actual.resumen.filter((fila) => !fila.productoId).length;
        if (faltan) {
          actual.bloqueos.push(`Faltan ${faltan} productos por asociar. El corte no se guarda hasta terminar la lista.`);
        }
        this.lectura.set({ ...actual });
      },
      error: (error) => this.mensaje.set(error?.error?.message || 'No se pudo asociar.'),
    });
  }

  guardar() {
    const actual = this.lectura();
    if (!actual) return;
    this.despachos.guardar(actual, this.numero).subscribe({
      next: () => {
        this.mensaje.set('Corte guardado.');
        this.lectura.set(null);
        this.cargarDia();
      },
      error: (error) => this.mensaje.set(error?.error?.message || 'No se pudo guardar.'),
    });
  }

  cargarDia() {
    this.despachos.tablero(this.fecha).subscribe((respuesta) => this.cortes.set(respuesta.data));
  }

  elegirCorte(corte: Record<string, string | number>) {
    this.corteId = String(corte['idCorte']);
    this.despachos.alistamiento(this.corteId).subscribe((respuesta) => this.lista.set(respuesta.data));
    this.cargarGuias();
  }

  cargarGuias() {
    if (!this.corteId) return;
    this.despachos.guias(this.corteId).subscribe((respuesta) => {
      this.guias.set(respuesta.data.guias);
      this.conteo.set(`${respuesta.data.verificadas} verificadas · ${respuesta.data.represadas} represadas · ${respuesta.data.total} guías`);
    });
  }

  escanear() {
    const codigo = this.codigo.trim();
    if (!codigo) return;
    this.despachos.escanear(this.corteId, codigo).subscribe({
      next: (respuesta) => {
        this.mensaje.set(respuesta.data.mensaje);
        this.codigo = '';
        this.conteo.set(`${respuesta.data.verificadas} verificadas · ${respuesta.data.represadas} represadas · ${respuesta.data.total} guías`);
        this.cargarGuias();
      },
      error: (error) => this.mensaje.set(error?.error?.message || 'No se pudo registrar el escaneo.'),
    });
  }

  represar(guiaId: string) {
    const motivo = window.prompt('Motivo del represado') ?? '';
    if (!motivo.trim()) return;
    this.despachos.represar(guiaId, motivo).subscribe({
      next: () => this.cargarGuias(),
      error: (error) => this.mensaje.set(error?.error?.message || 'No se pudo represar.'),
    });
  }

  reprogramar(guiaId: string) {
    this.despachos.cortesAbiertos(this.corteId).subscribe((respuesta) => {
      const texto = respuesta.data.map((corte) => `${corte.idCorte}: corte ${corte.numero} ${corte.transportadora} ${corte.fecha}`).join('\n');
      const destino = window.prompt(`Corte de destino. Abiertos:\n${texto || 'No hay otro corte abierto.'}`) ?? '';
      if (!destino.trim()) return;
      this.despachos.reprogramar(guiaId, destino.trim()).subscribe({
        next: () => {
          this.mensaje.set('La guía queda represada y vinculada al otro corte.');
          this.cargarGuias();
        },
        error: (error) => this.mensaje.set(error?.error?.message || 'No se pudo reprogramar.'),
      });
    });
  }

  cerrar() {
    this.despachos.cerrar(this.corteId, {
      auxiliar: this.auxiliar,
      placa: this.placa,
      hora: this.hora,
      motivoCierre: this.motivoCierre,
    }).subscribe({
      next: () => {
        this.mensaje.set('Corte cerrado.');
        this.cargarDia();
      },
      error: (error) => this.mensaje.set(error?.error?.message || 'No se pudo cerrar el corte.'),
    });
  }

  alternar(id: string) {
    if (this.asignados.has(id)) this.asignados.delete(id);
    else this.asignados.add(id);
  }

  asignar() {
    this.despachos.asignar(this.corteId, [...this.asignados]).subscribe({
      next: () => this.mensaje.set('Asignación guardada.'),
      error: (error) => this.mensaje.set(error?.error?.message || 'No se pudo asignar.'),
    });
  }

  marcar(fila: Record<string, string | number | boolean>, etapa: string, hecho: boolean) {
    this.despachos.marcar(String(fila['idAlistamiento']), etapa, hecho).subscribe({
      next: () => this.elegirCorte({ idCorte: this.corteId }),
      error: (error) => this.mensaje.set(error?.error?.message || 'No se pudo marcar la etapa.'),
    });
  }

  descargar() {
    this.despachos.excel(this.fecha).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = `corte-${this.fecha}.xlsx`;
      enlace.click();
      URL.revokeObjectURL(url);
    });
  }
}
