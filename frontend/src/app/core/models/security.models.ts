export interface Permission {
  idPermiso: string;
  key: string;
  descripcion: string | null;
  activo: boolean;
}

export interface Role {
  idRol: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  permisos: Permission[];
}

export interface UserProfile {
  idUsuario: string;
  correo: string;
  nombres: string;
  apellidos: string;
  celular: string | null;
  activo: boolean;
  roles: Role[];
  permisos: string[];
}

export interface LoginResponse {
  token: string;
  user: UserProfile;
}
