export interface Categoria {
  idCategoria: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Unidad {
  idUnidad: string;
  nombre: string;
  abreviatura: string;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Bodega {
  idBodega: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Producto {
  idProducto: string;
  codigoInterno: string;
  nombre: string;
  descripcion: string | null;
  categoriaId: string;
  unidadId: string;
  stockMinimo: string;
  activo: boolean;
  creadoPor: string;
  createdAt: string;
  updatedAt: string;
  categoria: { idCategoria: string; nombre: string; descripcion: string | null; activo: boolean };
  unidad: { idUnidad: string; nombre: string; abreviatura: string; activo: boolean };
  creador: { idUsuario: string; nombres: string; apellidos: string; correo: string };
}
