import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin-api.service';
import { Role, UserProfile } from '../../core/models/security.models';

@Component({
  selector: 'app-users-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page">
      <div class="grid two">
        <form class="card" (ngSubmit)="createUser()">
          <h2>Crear usuario</h2>
          <div class="grid two">
            <label>
              Nombres
              <input [(ngModel)]="form.nombres" name="nombres" required />
            </label>

            <label>
              Apellidos
              <input [(ngModel)]="form.apellidos" name="apellidos" required />
            </label>
          </div>

          <div class="grid two">
            <label>
              Correo
              <input [(ngModel)]="form.correo" name="correo" type="email" required />
            </label>

            <label>
              Celular
              <input [(ngModel)]="form.celular" name="celular" />
            </label>
          </div>

          <label>
            Contraseña
            <input [(ngModel)]="form.password" name="password" type="password" required />
          </label>

          <label>
            Roles iniciales
            <select [(ngModel)]="form.roleIds" name="roleIds" multiple>
              <option *ngFor="let role of roles()" [ngValue]="role.idRol">{{ role.nombre }}</option>
            </select>
          </label>

          <button type="submit">Crear usuario</button>
          <p class="error" *ngIf="error()">{{ error() }}</p>
        </form>

        <form class="card" *ngIf="selectedUser()" (ngSubmit)="updateUser()">
          <h2>Editar usuario</h2>
          <div class="grid two">
            <label>
              Nombres
              <input [(ngModel)]="editForm.nombres" name="editNombres" required />
            </label>

            <label>
              Apellidos
              <input [(ngModel)]="editForm.apellidos" name="editApellidos" required />
            </label>
          </div>

          <div class="grid two">
            <label>
              Correo
              <input [(ngModel)]="editForm.correo" name="editCorreo" type="email" required />
            </label>

            <label>
              Celular
              <input [(ngModel)]="editForm.celular" name="editCelular" />
            </label>
          </div>

          <label>
            Nueva contraseña
            <input [(ngModel)]="editForm.password" name="editPassword" type="password" />
          </label>

          <label>
            Roles
            <select [(ngModel)]="editForm.roleIds" name="editRoleIds" multiple>
              <option *ngFor="let role of roles()" [ngValue]="role.idRol">{{ role.nombre }}</option>
            </select>
          </label>

          <label class="checkbox">
            <input [(ngModel)]="editForm.activo" name="editActivo" type="checkbox" />
            Usuario activo
          </label>

          <div class="actions">
            <button type="submit">Guardar cambios</button>
            <button class="ghost" type="button" (click)="clearSelection()">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Usuarios</h2>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Roles</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let user of users()">
              <td>{{ user.nombres }} {{ user.apellidos }}</td>
              <td>{{ user.correo }}</td>
              <td>{{ user.roles.map(r => r.nombre).join(', ') || 'Sin roles' }}</td>
              <td>{{ user.activo ? 'Activo' : 'Inactivo' }}</td>
              <td class="table-actions">
                <button class="ghost" type="button" (click)="selectUser(user)">Editar</button>
                <button class="danger" type="button" (click)="deleteUser(user.idUsuario)">Desactivar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class UsersPageComponent implements OnInit {
  private readonly adminApi = inject(AdminApiService);

  readonly users = signal<UserProfile[]>([]);
  readonly roles = signal<Role[]>([]);
  readonly selectedUser = signal<UserProfile | null>(null);
  readonly error = signal('');

  form = {
    nombres: '',
    apellidos: '',
    correo: '',
    celular: '',
    password: 'rmmr',
    roleIds: [] as string[],
  };

  editForm = {
    nombres: '',
    apellidos: '',
    correo: '',
    celular: '',
    password: '',
    activo: true,
    roleIds: [] as string[],
  };

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.adminApi.listUsers().subscribe((users) => this.users.set(users));
    this.adminApi.listRoles().subscribe((roles) => this.roles.set(roles));
  }

  createUser() {
    this.error.set('');
    this.adminApi.createUser(this.form).subscribe({
      next: () => {
        this.form = {
          nombres: '',
          apellidos: '',
          correo: '',
          celular: '',
          password: 'rmmr',
          roleIds: [],
        };
        this.loadData();
      },
      error: (error) => this.error.set(error?.error?.message ?? 'No fue posible crear el usuario.'),
    });
  }

  selectUser(user: UserProfile) {
    this.selectedUser.set(user);
    this.editForm = {
      nombres: user.nombres,
      apellidos: user.apellidos,
      correo: user.correo,
      celular: user.celular || '',
      password: '',
      activo: user.activo,
      roleIds: user.roles.map((role) => role.idRol),
    };
  }

  updateUser() {
    const selected = this.selectedUser();
    if (!selected) return;

    this.adminApi.updateUser(selected.idUsuario, this.editForm).subscribe({
      next: () => {
        this.clearSelection();
        this.loadData();
      },
      error: (error) => this.error.set(error?.error?.message ?? 'No fue posible actualizar el usuario.'),
    });
  }

  deleteUser(id: string) {
    this.adminApi.deleteUser(id).subscribe(() => this.loadData());
  }

  clearSelection() {
    this.selectedUser.set(null);
  }
}
