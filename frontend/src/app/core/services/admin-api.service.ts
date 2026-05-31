import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Permission, Role, UserProfile } from '../models/security.models';

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/admin`;

  listUsers() {
    return this.http.get<UserProfile[]>(`${this.baseUrl}/users`);
  }

  createUser(payload: {
    nombres: string;
    apellidos: string;
    correo: string;
    celular?: string;
    password: string;
    roleIds?: string[];
  }) {
    return this.http.post<UserProfile>(`${this.baseUrl}/users`, payload);
  }

  updateUser(id: string, payload: Partial<{
    nombres: string;
    apellidos: string;
    correo: string;
    celular: string;
    password: string;
    activo: boolean;
    roleIds: string[];
  }>) {
    return this.http.patch<UserProfile>(`${this.baseUrl}/users/${id}`, payload);
  }

  deleteUser(id: string) {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/users/${id}`);
  }

  setUserRoles(id: string, roleIds: string[]) {
    return this.http.put<UserProfile>(`${this.baseUrl}/users/${id}/roles`, { roleIds });
  }

  listRoles() {
    return this.http.get<Role[]>(`${this.baseUrl}/roles`);
  }

  createRole(payload: { nombre: string; descripcion?: string }) {
    return this.http.post<Role>(`${this.baseUrl}/roles`, payload);
  }

  updateRole(id: string, payload: Partial<{ nombre: string; descripcion: string; activo: boolean }>) {
    return this.http.patch<Role>(`${this.baseUrl}/roles/${id}`, payload);
  }

  deleteRole(id: string) {
    return this.http.delete<Role>(`${this.baseUrl}/roles/${id}`);
  }

  setRolePermissions(id: string, permissionIds: string[]) {
    return this.http.put<Role>(`${this.baseUrl}/roles/${id}/permisos`, { permissionIds });
  }

  listPermissions() {
    return this.http.get<Permission[]>(`${this.baseUrl}/permisos`);
  }

  createPermission(payload: { key: string; descripcion?: string }) {
    return this.http.post<Permission>(`${this.baseUrl}/permisos`, payload);
  }

  updatePermission(id: string, payload: Partial<{ key: string; descripcion: string; activo: boolean }>) {
    return this.http.patch<Permission>(`${this.baseUrl}/permisos/${id}`, payload);
  }

  deletePermission(id: string) {
    return this.http.delete<Permission>(`${this.baseUrl}/permisos/${id}`);
  }
}
