import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin-api.service';
import { Permission } from '../../core/models/security.models';

@Component({
  selector: 'app-permissions-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page">
      <div class="grid two">
        <form class="card" (ngSubmit)="createPermission()">
          <h2>Crear permiso</h2>
          <label>
            Key
            <input [(ngModel)]="form.key" name="key" required />
          </label>

          <label>
            Descripción
            <input [(ngModel)]="form.descripcion" name="descripcion" />
          </label>

          <button type="submit">Crear permiso</button>
        </form>

        <form class="card" *ngIf="selectedPermission()" (ngSubmit)="updatePermission()">
          <h2>Editar permiso</h2>
          <label>
            Key
            <input [(ngModel)]="editForm.key" name="editKey" required />
          </label>

          <label>
            Descripción
            <input [(ngModel)]="editForm.descripcion" name="editDescripcion" />
          </label>

          <label class="checkbox">
            <input [(ngModel)]="editForm.activo" name="editActivo" type="checkbox" />
            Permiso activo
          </label>

          <div class="actions">
            <button type="submit">Guardar permiso</button>
            <button class="ghost" type="button" (click)="clearSelection()">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Permisos</h2>
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Descripción</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let permission of permissions()">
              <td>{{ permission.key }}</td>
              <td>{{ permission.descripcion || '-' }}</td>
              <td>{{ permission.activo ? 'Activo' : 'Inactivo' }}</td>
              <td class="table-actions">
                <button class="ghost" type="button" (click)="selectPermission(permission)">Editar</button>
                <button class="danger" type="button" (click)="deletePermission(permission.idPermiso)">Desactivar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class PermissionsPageComponent implements OnInit {
  private readonly adminApi = inject(AdminApiService);

  readonly permissions = signal<Permission[]>([]);
  readonly selectedPermission = signal<Permission | null>(null);

  form = {
    key: '',
    descripcion: '',
  };

  editForm = {
    key: '',
    descripcion: '',
    activo: true,
  };

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.adminApi.listPermissions().subscribe((permissions) => this.permissions.set(permissions));
  }

  createPermission() {
    this.adminApi.createPermission(this.form).subscribe(() => {
      this.form = { key: '', descripcion: '' };
      this.loadData();
    });
  }

  selectPermission(permission: Permission) {
    this.selectedPermission.set(permission);
    this.editForm = {
      key: permission.key,
      descripcion: permission.descripcion || '',
      activo: permission.activo,
    };
  }

  updatePermission() {
    const permission = this.selectedPermission();
    if (!permission) return;

    this.adminApi.updatePermission(permission.idPermiso, this.editForm).subscribe(() => {
      this.clearSelection();
      this.loadData();
    });
  }

  deletePermission(id: string) {
    this.adminApi.deletePermission(id).subscribe(() => this.loadData());
  }

  clearSelection() {
    this.selectedPermission.set(null);
  }
}
