"""Lectores de EFFI y MasterShop.

La relación de despacho de EFFI se guarda en la guía. No se usa como número de corte.
El contenido libre de EFFI no se homologa solo: queda como referencia para asociarla a mano.
Vendela no tiene lector: no hay un archivo de ejemplo.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook

from despachos.config import TRANSPORTADORAS
from despachos.parser_dropi import GuiaLeida, ResumenLeido, Revision

PALABRAS_PLATAFORMA = ("effi", "mastershop", "dropi", "vendela", "vitalcom")

ALIASES = {
    "guia": ("guia transportadora", "n de guia", "numero de guia", "numero de envio", "guia"),
    "id_guia": ("id guia", "id de guia"),
    "transportadora": ("transportadora",),
    "relacion": ("relacion de despacho",),
    "contenido": ("contenido",),
    "producto": ("producto", "nombre del producto"),
    "cantidad": ("cantidad",),
    "ciudad": ("ciudad destino", "ciudad de destino", "ciudad"),
    "recaudo": ("valor de recaudo", "valor recaudo", "recaudo"),
    "estado": ("estado de la guia", "estado guia", "estado"),
    "fecha": ("fecha de creacion", "fecha creacion", "fecha"),
}


def revisar_excel(ruta: str | Path, plataforma: str, fecha_corte: str = "") -> list[Revision]:
    if plataforma == "Vendela":
        raise ValueError("Vendela no tiene archivo de ejemplo. No se puede leer todavía.")
    if plataforma not in {"EFFI", "MasterShop"}:
        raise ValueError("Plataforma de Excel no reconocida.")
    path = Path(ruta)
    huella = hashlib.sha256(path.read_bytes()).hexdigest()
    libro = load_workbook(path, data_only=True)
    hoja = libro.active
    filas = list(hoja.iter_rows(values_only=True))
    if not filas:
        return [_vacia(plataforma, path.name, huella, "El Excel no tiene filas.")]
    encabezados = [_normalizar(valor) for valor in filas[0]]
    columnas = {clave: _buscar(encabezados, alias) for clave, alias in ALIASES.items()}
    faltan = _faltantes(plataforma, columnas)
    if faltan:
        encontradas = ", ".join(str(valor) for valor in filas[0] if valor) or "ninguna"
        return [
            _vacia(
                plataforma,
                path.name,
                huella,
                f"Faltan columnas: {', '.join(faltan)}. El archivo trae: {encontradas}.",
            )
        ]
    grupos: dict[str, list[dict]] = defaultdict(list)
    for cruda in filas[1:]:
        if not any(cruda):
            continue
        registro = {clave: _celda(cruda, indice) for clave, indice in columnas.items()}
        grupos[_normalizar(registro["transportadora"])].append(registro)
    if not grupos:
        return [_vacia(plataforma, path.name, huella, "El Excel no tiene guías.")]
    return [
        _revision_grupo(plataforma, path.name, huella, clave, registros, fecha_corte)
        for clave, registros in grupos.items()
    ]


def partir_contenido(texto: str) -> tuple[int, str]:
    coincidencia = re.fullmatch(r"\s*(\d+)\s*[*xX]\s*(.+?)\s*\.?\s*", texto.strip())
    if not coincidencia:
        return 1, texto.strip()
    return int(coincidencia.group(1)), coincidencia.group(2).strip(" .")


def resolver_transportadora(texto: str) -> str:
    cabeza = _normalizar(str(texto).split("|")[0])
    for palabra in PALABRAS_PLATAFORMA:
        cabeza = cabeza.replace(palabra, " ")
    cabeza = " ".join(cabeza.split())
    for nombre, dropi, alias, _orden in TRANSPORTADORAS:
        candidatos = {_normalizar(nombre), _normalizar(dropi), _normalizar(alias)}
        candidatos.discard("")
        if cabeza in candidatos:
            return dropi or nombre
    return ""


def _revision_grupo(plataforma, nombre_archivo, huella, clave, registros, fecha_corte) -> Revision:
    reconocida = resolver_transportadora(clave)
    avisos = [
        f"Lector de {plataforma} pendiente de contraste con el Excel real del equipo. Revisa los totales antes de guardar."
    ]
    bloqueos = []
    if not reconocida:
        bloqueos.append(f"Transportadora no reconocida: {clave or 'vacía'}.")
    guias: list[GuiaLeida] = []
    acumulado: dict[str, ResumenLeido] = {}
    fechas: list[str] = []
    vistas: set[str] = set()
    for indice, registro in enumerate(registros, start=1):
        numero = registro["guia"]
        if not numero:
            avisos.append(f"La fila {indice + 1} no trae número de guía y se omitió.")
            continue
        if numero in vistas:
            avisos.append(f"La guía {numero} viene repetida en el archivo.")
        vistas.add(numero)
        if registro["fecha"]:
            fechas.append(registro["fecha"])
        guias.append(
            GuiaLeida(
                consecutivo=indice,
                numero=numero,
                ciudad=registro["ciudad"],
                recaudo=registro["recaudo"],
                tipo=registro["transportadora"],
                texto_rotulo=registro["contenido"] or registro["producto"],
                relacion_despacho=registro["relacion"],
                estado_origen=registro["estado"],
            )
        )
        _sumar_producto(plataforma, registro, acumulado)
    relaciones = sorted({guia.relacion_despacho for guia in guias if guia.relacion_despacho})
    if relaciones:
        avisos.append(
            "Relación de despacho "
            + ", ".join(relaciones)
            + ". Es un dato de la guía, no el número de corte."
        )
    fecha = fechas[0] if fechas else fecha_corte
    if len(set(fechas)) > 1:
        avisos.append("El archivo trae varias fechas. Se usó la primera.")
    resumen = list(acumulado.values())
    return Revision(
        transportadora=reconocida,
        fecha=fecha,
        guias=guias,
        resumen=resumen,
        avisos=avisos,
        bloqueos=bloqueos,
        huella=f"{huella}|{reconocida or clave}",
        nombre_archivo=nombre_archivo,
        lector_verificado=False,
        unidades_resumen=sum(item.cantidad for item in resumen),
        plataforma=plataforma,
    )


def _sumar_producto(plataforma: str, registro: dict, acumulado: dict[str, ResumenLeido]) -> None:
    if plataforma == "EFFI":
        cantidad, nombre = partir_contenido(registro["contenido"])
        clave = _normalizar(nombre)
    else:
        nombre = registro["producto"]
        cantidad = _entero(registro["cantidad"])
        clave = _normalizar(nombre)
    if not clave:
        return
    if clave in acumulado:
        acumulado[clave].cantidad += cantidad
        return
    acumulado[clave] = ResumenLeido(sku="", id_dropi=clave, nombre=nombre, cantidad=cantidad)


def _faltantes(plataforma: str, columnas: dict[str, int | None]) -> list[str]:
    if plataforma == "EFFI":
        requeridas = ("guia", "transportadora", "contenido")
    else:
        requeridas = ("guia", "transportadora", "producto", "cantidad")
    return [nombre for nombre in requeridas if columnas[nombre] is None]


def _vacia(plataforma: str, nombre: str, huella: str, bloqueo: str) -> Revision:
    return Revision(
        transportadora="",
        fecha="",
        guias=[],
        resumen=[],
        bloqueos=[bloqueo],
        huella=huella,
        nombre_archivo=nombre,
        lector_verificado=False,
        plataforma=plataforma,
    )


def _buscar(encabezados: list[str], aliases: tuple[str, ...]) -> int | None:
    for alias in aliases:
        if alias in encabezados:
            return encabezados.index(alias)
    return None


def _celda(fila: tuple, indice: int | None) -> str:
    if indice is None or indice >= len(fila) or fila[indice] is None:
        return ""
    valor = fila[indice]
    if isinstance(valor, datetime):
        return valor.date().isoformat()
    if isinstance(valor, date):
        return valor.isoformat()
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()


def _entero(valor: str) -> int:
    try:
        return int(float(valor))
    except ValueError:
        return 0


def _normalizar(valor) -> str:
    texto = str(valor or "").replace("°", " ").replace("º", " ").replace("#", " ")
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(caracter for caracter in texto if unicodedata.category(caracter) != "Mn")
    return " ".join(texto.lower().split())
