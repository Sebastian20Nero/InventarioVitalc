import { Workbook } from 'exceljs';

const TEXTOS: Record<string, string> = {
  'codigo de barras': 'codigoBarras',
  sku: 'sku',
  estado: 'estadoComercial',
  presentacion: 'presentacion',
  contenido: 'contenido',
  sabor: 'sabor',
  registro: 'registro',
  laboratorio: 'laboratorio',
  'perfil producto': 'perfilProducto',
  familia: 'familia',
  referencia: 'referencia',
  observacion: 'observacion',
};

const PRECIOS: Record<string, string> = {
  'lista 1': 'lista1',
  'ult costo': 'ultCosto',
  'cost iva': 'costoIva',
  maquila: 'precioMaquila',
  'm contado': 'precioContado',
  'm credito': 'precioCredito',
  comunidad: 'precioComunidad',
  privado: 'precioPrivado',
  publico: 'precioPublico',
};

export interface FilaMaestro {
  fila: number;
  codigo: string;
  nombre: string;
  textos: Record<string, string | null>;
  precios: Record<string, string | null>;
  activo: boolean | null;
}

export interface ErrorFila {
  fila: number;
  codigo: string;
  mensaje: string;
}

export interface LecturaMaestro {
  filas: FilaMaestro[];
  errores: ErrorFila[];
  omitidos: number;
}

export async function leerMaestro(buffer: Buffer): Promise<LecturaMaestro> {
  const libro = new Workbook();
  await libro.xlsx.load(buffer as unknown as ArrayBuffer);
  const hoja = libro.getWorksheet('Maestro_Estandar') ?? libro.worksheets[0];
  if (!hoja) {
    throw new Error('El archivo no tiene hojas.');
  }

  let encabezados: Map<number, string> | null = null;
  let filaEncabezado = 0;
  hoja.eachRow({ includeEmpty: false }, (row, numero) => {
    if (encabezados || numero > 15) return;
    const mapa = new Map<number, string>();
    row.eachCell({ includeEmpty: false }, (celda, columna) => {
      mapa.set(columna, normalizar(texto(celda.value)));
    });
    const nombres = new Set(mapa.values());
    if (nombres.has('codigo') && (nombres.has('nombre producto') || nombres.has('nombre'))) {
      encabezados = mapa;
      filaEncabezado = numero;
    }
  });
  if (!encabezados || filaEncabezado === 0) {
    throw new Error('No encontré la fila de títulos. Hacen falta Código y Nombre producto.');
  }

  const filas: FilaMaestro[] = [];
  const errores: ErrorFila[] = [];
  let omitidos = 0;
  const vistos = new Map<string, number[]>();

  hoja.eachRow({ includeEmpty: false }, (row, numero) => {
    if (numero <= filaEncabezado) return;
    const crudo = new Map<string, unknown>();
    encabezados!.forEach((nombre, columna) => {
      crudo.set(nombre, row.getCell(columna).value);
    });
    const codigo = texto(crudo.get('codigo')).toUpperCase();
    if (!codigo) {
      omitidos += 1;
      return;
    }
    const nombre = texto(crudo.get('nombre producto') ?? crudo.get('nombre'));
    if (!nombre) {
      errores.push({ fila: numero, codigo, mensaje: 'La fila tiene código y no tiene nombre.' });
      return;
    }
    try {
      const textos: Record<string, string | null> = {};
      for (const [titulo, campo] of Object.entries(TEXTOS)) {
        const valor = texto(crudo.get(titulo));
        textos[campo] = valor || null;
      }
      const precios: Record<string, string | null> = {};
      for (const [titulo, campo] of Object.entries(PRECIOS)) {
        precios[campo] = precio(crudo.get(titulo), titulo);
      }
      filas.push({ fila: numero, codigo, nombre, textos, precios, activo: marcarActivo(crudo.get('activo')) });
      const previas = vistos.get(codigo) ?? [];
      previas.push(numero);
      vistos.set(codigo, previas);
    } catch (error) {
      errores.push({ fila: numero, codigo, mensaje: error instanceof Error ? error.message : 'No se pudo leer la fila.' });
    }
  });

  const repetidos = new Set<string>();
  for (const [codigo, numeros] of vistos) {
    if (numeros.length > 1) {
      repetidos.add(codigo);
      errores.push({
        fila: numeros[0],
        codigo,
        mensaje: `El código está repetido en las filas ${numeros.join(', ')}. No se cargó.`,
      });
    }
  }

  return {
    filas: filas.filter((fila) => !repetidos.has(fila.codigo)),
    errores,
    omitidos,
  };
}

function normalizar(valor: string) {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function texto(valor: unknown): string {
  if (valor == null) return '';
  if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor).trim();
  }
  if (valor instanceof Date) return '';
  if (typeof valor === 'object') {
    const dato = valor as { result?: unknown; text?: unknown; richText?: { text?: string }[] };
    if ('result' in dato) return texto(dato.result);
    if ('text' in dato) return texto(dato.text);
    if (Array.isArray(dato.richText)) return dato.richText.map((parte) => parte.text ?? '').join('').trim();
  }
  return '';
}

function precio(valor: unknown, titulo: string): string | null {
  const plano = valor && typeof valor === 'object' && 'result' in valor ? (valor as { result?: unknown }).result : valor;
  if (plano == null || plano === '') return null;
  const numero = typeof plano === 'number' ? plano : Number(texto(plano).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(numero)) {
    throw new Error(`El valor de ${titulo} no es un número.`);
  }
  if (numero < 0) {
    throw new Error(`El valor de ${titulo} no puede ser negativo.`);
  }
  return String(numero);
}

function marcarActivo(valor: unknown): boolean | null {
  const marca = normalizar(texto(valor));
  if (!marca) return null;
  if (['s', 'si', '1', 'true', 'activo'].includes(marca)) return true;
  if (['n', 'no', '0', 'false', 'inactivo'].includes(marca)) return false;
  throw new Error('Activo debe ser S o N.');
}
