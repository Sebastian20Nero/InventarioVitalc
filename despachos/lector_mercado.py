"""Export de ventas de Mercado Libre.

La clave es el título de la publicación. El archivo no trae un SKU usable,
y si la columna aparece no se usa para asociar. Este lector no está
contrastado con el export real del equipo.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

from openpyxl import load_workbook

from despachos.lectores_excel import _buscar, _celda, _entero, _normalizar
from despachos.parser_dropi import ResumenLeido

PLATAFORMA = "MercadoLibre"

ALIASES = {
    "venta": ("numero de venta", "n. de venta", "n de venta", "de venta", "id de venta", "venta"),
    "titulo": ("titulo de la publicacion", "titulo de publicacion", "titulo", "publicacion", "producto"),
    "cantidad": ("unidades", "cantidad"),
    "comprador": ("comprador", "cliente"),
    "estado": ("estado",),
    "seguimiento": ("numero de seguimiento", "seguimiento", "guia"),
    "fecha": ("fecha de venta", "fecha"),
}


@dataclass
class VentaLeida:
    numero: str
    titulo: str
    referencia: str
    cantidad: int
    comprador: str = ""
    estado: str = ""
    seguimiento: str = ""
    fecha: str = ""
    producto_id: int | None = None


@dataclass
class LecturaMercado:
    ventas: list[VentaLeida] = field(default_factory=list)
    resumen: list[ResumenLeido] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)
    bloqueos: list[str] = field(default_factory=list)
    huella: str = ""
    nombre_archivo: str = ""
    fecha: str = ""
    unidades: int = 0
    lector_verificado: bool = False
    plataforma: str = PLATAFORMA


def revisar_ventas(ruta: str | Path) -> LecturaMercado:
    path = Path(ruta)
    huella = hashlib.sha256(path.read_bytes()).hexdigest()
    lectura = LecturaMercado(huella=huella, nombre_archivo=path.name)
    lectura.avisos.append(
        "Lector de Mercado Libre pendiente de contraste con el export real. "
        "La asociación usa el título de la publicación, no un SKU."
    )
    libro = load_workbook(path, data_only=True)
    hoja = libro.active
    filas = list(hoja.iter_rows(values_only=True))
    if not filas:
        lectura.bloqueos.append("El Excel no tiene filas.")
        return lectura
    encabezados = [_normalizar(valor) for valor in filas[0]]
    columnas = {clave: _buscar(encabezados, alias) for clave, alias in ALIASES.items()}
    faltan = [nombre for nombre in ("venta", "titulo", "cantidad") if columnas[nombre] is None]
    if faltan:
        encontradas = ", ".join(str(valor) for valor in filas[0] if valor) or "ninguna"
        lectura.bloqueos.append(f"Faltan columnas: {', '.join(faltan)}. El archivo trae: {encontradas}.")
        return lectura
    if "sku" in encabezados:
        lectura.avisos.append("El archivo trae una columna SKU. No se usa como clave.")
    acumulado: dict[str, ResumenLeido] = {}
    vistos: set[tuple[str, str]] = set()
    for indice, cruda in enumerate(filas[1:], start=2):
        if not any(cruda):
            continue
        numero = _celda(cruda, columnas["venta"])
        titulo = _celda(cruda, columnas["titulo"])
        cantidad = _entero(_celda(cruda, columnas["cantidad"]))
        if not numero and not titulo:
            continue
        if not numero:
            lectura.bloqueos.append(f"La fila {indice} no trae número de venta.")
            continue
        if not titulo:
            lectura.bloqueos.append(f"La venta {numero} no trae título de la publicación.")
            continue
        if cantidad < 1:
            lectura.bloqueos.append(f"La venta {numero} tiene cantidad en cero.")
            continue
        referencia = _normalizar(titulo)
        clave = (numero, referencia)
        if clave in vistos:
            lectura.avisos.append(f"La venta {numero} repite el título y se sumó la cantidad.")
            for venta in lectura.ventas:
                if venta.numero == numero and venta.referencia == referencia:
                    venta.cantidad += cantidad
                    break
        else:
            vistos.add(clave)
            lectura.ventas.append(
                VentaLeida(
                    numero=numero,
                    titulo=titulo,
                    referencia=referencia,
                    cantidad=cantidad,
                    comprador=_celda(cruda, columnas["comprador"]),
                    estado=_celda(cruda, columnas["estado"]),
                    seguimiento=_celda(cruda, columnas["seguimiento"]),
                    fecha=_celda(cruda, columnas["fecha"]),
                )
            )
        if referencia in acumulado:
            acumulado[referencia].cantidad += cantidad
        else:
            acumulado[referencia] = ResumenLeido(sku="", id_dropi=referencia, nombre=titulo, cantidad=cantidad)
    lectura.resumen = list(acumulado.values())
    lectura.unidades = sum(item.cantidad for item in lectura.resumen)
    fechas = sorted({venta.fecha for venta in lectura.ventas if venta.fecha})
    lectura.fecha = fechas[0] if fechas else ""
    if len(fechas) > 1:
        lectura.avisos.append("El archivo trae varias fechas. Se usó la primera.")
    if not lectura.ventas and not lectura.bloqueos:
        lectura.bloqueos.append("El Excel no tiene ventas.")
    return lectura
