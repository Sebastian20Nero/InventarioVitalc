import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/services/auth.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <h1>VitalInventario</h1>
          <p>Control de inventario DsNube</p>
        </div>

        <nav class="nav">
          <a routerLink="/app/dashboard" routerLinkActive="active">Dashboard</a>

          <ng-container *ngIf="perm('USUARIO_ADMINISTRAR')">
            <div class="nav-section">Administración</div>
            <a routerLink="/app/users" routerLinkActive="active">Usuarios</a>
            <a routerLink="/app/roles" routerLinkActive="active">Roles</a>
            <a routerLink="/app/permisos" routerLinkActive="active">Permisos</a>
          </ng-container>

          <ng-container *ngIf="perm('PRODUCTO_CONSULTAR') || perm('STOCK_CONSULTAR') || perm('MOVIMIENTO_CONSULTAR')">
            <div class="nav-section">Inventario</div>
            <a routerLink="/app/catalogos" routerLinkActive="active" *ngIf="perm('PRODUCTO_CONSULTAR')">Catálogos</a>
            <a routerLink="/app/productos" routerLinkActive="active" *ngIf="perm('PRODUCTO_CONSULTAR')">Productos</a>
            <a routerLink="/app/stock" routerLinkActive="active" *ngIf="perm('STOCK_CONSULTAR')">Stock actual</a>
            <a routerLink="/app/inventario/movimientos" routerLinkActive="active" *ngIf="perm('MOVIMIENTO_CREAR')">Registrar movimiento</a>
            <a routerLink="/app/inventario/historial" routerLinkActive="active" *ngIf="perm('MOVIMIENTO_CONSULTAR')">Historial</a>
          </ng-container>

          <ng-container *ngIf="perm('EMPALME_REVISAR')">
            <div class="nav-section">Empalme DsNube</div>
            <a routerLink="/app/empalme" routerLinkActive="active">Empalme</a>
          </ng-container>
        </nav>
      </aside>

      <main class="content">
        <header class="topbar">
          <div>
            <strong>{{ authService.currentUser()?.nombres }} {{ authService.currentUser()?.apellidos }}</strong>
            <div class="muted">{{ authService.currentUser()?.correo }}</div>
          </div>

          <button class="danger" type="button" (click)="logout()">Cerrar sesión</button>
        </header>

        <router-outlet />
      </main>
    </div>
  `,
})
export class AppShellComponent {
  readonly authService = inject(AuthService);

  perm(p: string): boolean {
    return this.authService.hasPermission(p);
  }

  logout() {
    this.authService.logout();
  }
}
