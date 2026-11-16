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
  codigoBarras: string | null;
  sku: string | null;
  estadoComercial: string | null;
  presentacion: string | null;
  contenido: string | null;
  sabor: string | null;
  registro: string | null;
  laboratorio: string | null;
  perfilProducto: string | null;
  familia: string | null;
  lista1: string | null;
  referencia: string | null;
  ultCosto: string | null;
  costoIva: string | null;
  precioMaquila: string | null;
  precioContado: string | null;
  precioCredito: string | null;
  precioComunidad: string | null;
  precioPrivado: string | null;
  precioPublico: string | null;
  observacion: string | null;
  creadoPor: string;
  createdAt: string;
  updatedAt: string;
  categoria: { idCategoria: string; nombre: string; descripcion: string | null; activo: boolean };
  unidad: { idUnidad: string; nombre: string; abreviatura: string; activo: boolean };
  creador: { idUsuario: string; nombres: string; apellidos: string; correo: string };
}
