import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { AppShellComponent } from './layout/app-shell.component';
import { LoginPageComponent } from './features/login/login-page.component';
import { DashboardPageComponent } from './features/dashboard/dashboard-page.component';
import { UsersPageComponent } from './features/users/users-page.component';
import { RolesPageComponent } from './features/roles/roles-page.component';
import { PermissionsPageComponent } from './features/permissions/permissions-page.component';

export const routes: Routes = [
  { path: '', redirectTo: 'auth/signin', pathMatch: 'full' },
  {
    path: 'auth/signin',
    component: LoginPageComponent,
    title: 'Iniciar sesión | VitalInventario',
  },
  {
    path: 'app',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: DashboardPageComponent, title: 'Dashboard | VitalInventario' },
      { path: 'users', component: UsersPageComponent, title: 'Usuarios | VitalInventario' },
      { path: 'roles', component: RolesPageComponent, title: 'Roles | VitalInventario' },
      {
        path: 'permisos',
        component: PermissionsPageComponent,
        title: 'Permisos | VitalInventario',
      },
      {
        path: 'catalogos',
        loadComponent: () =>
          import('./features/catalogos/catalogos-page.component').then(
            (m) => m.CatalogosPageComponent,
          ),
        title: 'Catálogos | Inventario',
      },
      {
        path: 'productos',
        loadComponent: () =>
          import('./features/productos/productos-page.component').then(
            (m) => m.ProductosPageComponent,
          ),
        title: 'Productos | Inventario',
      },
      {
        path: 'inventario/movimientos',
        loadComponent: () =>
          import('./features/inventario/movimientos-page.component').then(
            (m) => m.MovimientosPageComponent,
          ),
        title: 'Movimientos | Inventario',
      },
      {
        path: 'inventario/historial',
        loadComponent: () =>
          import('./features/inventario/historial-page.component').then(
            (m) => m.HistorialPageComponent,
          ),
        title: 'Historial | Inventario',
      },
      {
        path: 'empalme',
        loadComponent: () =>
          import('./features/empalme/empalme-page.component').then(
            (m) => m.EmpalmePageComponent,
          ),
        title: 'Empalme DsNube',
      },
      {
        path: 'despachos',
        loadComponent: () =>
          import('./features/despachos/despachos-page.component').then(
            (m) => m.DespachosPageComponent,
          ),
        title: 'Despachos DROPI',
      },
      {
        path: 'stock',
        loadComponent: () =>
          import('./features/stock/stock-page.component').then(
            (m) => m.StockPageComponent,
          ),
        title: 'Stock actual | Inventario',
      },
    ],
  },
  { path: '**', redirectTo: 'auth/signin' },
];
