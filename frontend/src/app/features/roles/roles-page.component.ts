import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin-api.service';
import { Permission, Role } from '../../core/models/security.models';

@Component({
  selector: 'app-roles-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page">
      <div class="grid two">
        <form class="card" (ngSubmit)="createRole()">
          <h2>Crear rol</h2>
          <label>
            Nombre
            <input [(ngModel)]="form.nombre" name="nombre" required />
          </label>

          <label>
            Descripción
            <input [(ngModel)]="form.descripcion" name="descripcion" />
          </label>

          <button type="submit">Crear rol</button>
        </form>

        <form class="card" *ngIf="selectedRole()" (ngSubmit)="updateRole()">
          <h2>Editar rol</h2>
          <label>
            Nombre
            <input [(ngModel)]="editForm.nombre" name="editNombre" required />
          </label>

          <label>
            Descripción
            <input [(ngModel)]="editForm.descripcion" name="editDescripcion" />
          </label>

          <label class="checkbox">
            <input [(ngModel)]="editForm.activo" name="editActivo" type="checkbox" />
            Rol activo
          </label>

          <label>
            Permisos asociados
            <select [(ngModel)]="editPermissionIds" name="editPermissionIds" multiple>
              <option *ngFor="let permission of permissions()" [ngValue]="permission.idPermiso">
                {{ permission.key }}
              </option>
            </select>
          </label>

          <div class="actions">
            <button type="submit">Guardar rol</button>
            <button class="ghost" type="button" (click)="clearSelection()">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Roles</h2>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Descripción</th>
              <th>Permisos</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let role of roles()">
              <td>{{ role.nombre }}</td>
              <td>{{ role.descripcion || '-' }}</td>
              <td>{{ role.permisos.map(p => p.key).join(', ') || 'Sin permisos' }}</td>
              <td>{{ role.activo ? 'Activo' : 'Inactivo' }}</td>
              <td class="table-actions">
                <button class="ghost" type="button" (click)="selectRole(role)">Editar</button>
                <button class="danger" type="button" (click)="deleteRole(role.idRol)">Desactivar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class RolesPageComponent implements OnInit {
  private readonly adminApi = inject(AdminApiService);

  readonly roles = signal<Role[]>([]);
  readonly permissions = signal<Permission[]>([]);
  readonly selectedRole = signal<Role | null>(null);
  editPermissionIds: string[] = [];

  form = {
    nombre: '',
    descripcion: '',
  };

  editForm = {
    nombre: '',
    descripcion: '',
    activo: true,
  };

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.adminApi.listRoles().subscribe((roles) => this.roles.set(roles));
    this.adminApi.listPermissions().subscribe((permissions) => this.permissions.set(permissions));
  }

  createRole() {
    this.adminApi.createRole(this.form).subscribe(() => {
      this.form = { nombre: '', descripcion: '' };
      this.loadData();
    });
  }

  selectRole(role: Role) {
    this.selectedRole.set(role);
    this.editForm = {
      nombre: role.nombre,
      descripcion: role.descripcion || '',
      activo: role.activo,
    };
    this.editPermissionIds = role.permisos.map((permission) => permission.idPermiso);
  }

  updateRole() {
    const role = this.selectedRole();
    if (!role) return;

    this.adminApi.updateRole(role.idRol, this.editForm).subscribe({
      next: () => {
        this.adminApi.setRolePermissions(role.idRol, this.editPermissionIds).subscribe(() => {
          this.clearSelection();
          this.loadData();
        });
      },
    });
  }

  deleteRole(id: string) {
    this.adminApi.deleteRole(id).subscribe(() => this.loadData());
  }

  clearSelection() {
    this.selectedRole.set(null);
    this.editPermissionIds = [];
  }
}
