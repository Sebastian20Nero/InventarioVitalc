"""Lector del manifiesto DROPI.

La lectura de guías es por coordenadas, con los centros medidos en el PDF real.
Este módulo local no está corrido contra las 238 páginas: la revisión lo dice
en un aviso y la pantalla exige confirmar los totales antes de guardar.

Si aparece despachos/nucleo/parser_dropi.py, se usa ese en su lugar.
"""

from __future__ import annotations

import hashlib
import importlib.util
import re
from dataclasses import dataclass, field
from pathlib import Path

from despachos.config import ALTO_MAXIMO_BLOQUE, COLUMNAS_PDF, NUCLEO, TOLERANCIA_COLUMNA, TRANSPORTADORAS

ETIQUETAS = {
    "GUIA",
    "NRO",
    "CIUDAD",
    "DESTINO",
    "VALOR",
    "DE",
    "RECAUDO",
    "TIPO",
    "LOGISTICA",
    "TIPO DE LOGISTICA",
}


@dataclass
class GuiaLeida:
    consecutivo: int | None
    numero: str
    ciudad: str
    recaudo: str
    tipo: str
    texto_rotulo: str = ""
    relacion_despacho: str = ""
    estado_origen: str = ""


@dataclass
class ResumenLeido:
    sku: str
    id_dropi: str
    nombre: str
    cantidad: int
    producto_id: int | None = None


@dataclass
class Revision:
    transportadora: str
    fecha: str
    guias: list[GuiaLeida]
    resumen: list[ResumenLeido]
    avisos: list[str] = field(default_factory=list)
    bloqueos: list[str] = field(default_factory=list)
    huella: str = ""
    nombre_archivo: str = ""
    lector_verificado: bool = False
    unidades_rotulos: int | None = None
    unidades_resumen: int = 0
    plataforma: str = "DROPI"


class LectorPendiente(Exception):
    """No hay forma de leer el PDF en este equipo."""


def revisar_manifiesto(ruta: str | Path, avance=None) -> Revision:
    externo = _lector_externo()
    if externo is not None:
        resultado = externo.revisar_manifiesto(str(ruta), avance) if _acepta_avance(externo) else externo.revisar_manifiesto(str(ruta))
        revision = resultado if isinstance(resultado, Revision) else _desde_dict(resultado)
        revision.lector_verificado = bool(getattr(externo, "LECTOR_VERIFICADO", revision.lector_verificado))
        revision.nombre_archivo = revision.nombre_archivo or Path(ruta).name
        if not revision.huella:
            revision.huella = hashlib.sha256(Path(ruta).read_bytes()).hexdigest()
        return revision
    return _leer_local(Path(ruta), avance)


def _acepta_avance(modulo) -> bool:
    codigo = getattr(modulo.revisar_manifiesto, "__code__", None)
    return bool(codigo and "avance" in codigo.co_varnames)


def _lector_externo():
    ruta = NUCLEO / "parser_dropi.py"
    if not ruta.exists():
        return None
    spec = importlib.util.spec_from_file_location("nucleo_parser_dropi", ruta)
    if spec is None or spec.loader is None:
        return None
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    if not hasattr(modulo, "revisar_manifiesto"):
        return None
    return modulo


def _desde_dict(datos: dict) -> Revision:
    guias = [GuiaLeida(**item) if isinstance(item, dict) else item for item in datos.get("guias", [])]
    resumen = [ResumenLeido(**item) if isinstance(item, dict) else item for item in datos.get("resumen", [])]
    return Revision(
        transportadora=datos.get("transportadora", ""),
        fecha=datos.get("fecha", ""),
        guias=guias,
        resumen=resumen,
        avisos=list(datos.get("avisos", [])),
        bloqueos=list(datos.get("bloqueos", [])),
        huella=datos.get("huella", ""),
        nombre_archivo=datos.get("nombre_archivo", ""),
        lector_verificado=bool(datos.get("lector_verificado", False)),
        unidades_rotulos=datos.get("unidades_rotulos"),
        unidades_resumen=int(datos.get("unidades_resumen") or sum(item.cantidad for item in resumen)),
    )


def _leer_local(ruta: Path, avance) -> Revision:
    try:
        import pdfplumber
    except ImportError as exc:
        raise LectorPendiente(
            "Falta instalar pdfplumber, o colocar el parser original en despachos/nucleo."
        ) from exc
    if not ruta.exists():
        raise LectorPendiente(f"No se encontró el archivo {ruta.name}.")

    huella = hashlib.sha256(ruta.read_bytes()).hexdigest()
    paginas_texto: list[str] = []
    palabras_todas: list[dict] = []
    with pdfplumber.open(ruta) as pdf:
        total = len(pdf.pages)
        for indice, pagina in enumerate(pdf.pages, start=1):
            if avance:
                avance(indice, total)
            texto = pagina.extract_text() or ""
            paginas_texto.append(texto)
            for palabra in pagina.extract_words() or []:
                palabras_todas.append(
                    {
                        "text": palabra.get("text", ""),
                        "x0": float(palabra.get("x0", 0)),
                        "top": float(palabra.get("top", 0)) + (indice * 10000),
                        "pagina": indice,
                    }
                )

    texto_completo = "\n".join(paginas_texto)
    resumen_texto, rotulos = partir_resumen_y_rotulos(paginas_texto)
    guias = leer_guias_desde_palabras(palabras_todas)
    _pegar_rotulos(guias, rotulos)
    resumen = leer_resumen(resumen_texto)
    avisos, bloqueos = _validar(guias, resumen, rotulos)
    avisos.insert(
        0,
        "Este lector local no está verificado contra el manifiesto de 238 páginas. Revisa los totales antes de guardar.",
    )
    return Revision(
        transportadora=_transportadora(texto_completo),
        fecha=_fecha(texto_completo),
        guias=guias,
        resumen=resumen,
        avisos=avisos,
        bloqueos=bloqueos,
        huella=huella,
        nombre_archivo=ruta.name,
        lector_verificado=False,
        unidades_rotulos=_unidades_rotulos(rotulos),
        unidades_resumen=sum(item.cantidad for item in resumen),
    )


def partir_resumen_y_rotulos(paginas: list[str]) -> tuple[str, dict[str, str]]:
    """El corte es por página. La primera de rótulos trae horario y, más abajo, GUIA:."""
    resumen: list[str] = []
    rotulos: dict[str, str] = {}
    en_rotulos = False
    for pagina in paginas:
        if _es_pagina_rotulo(pagina):
            en_rotulos = True
        if not en_rotulos:
            resumen.append(pagina)
            continue
        for numero in re.findall(r"GUIA:\s*(\d{6,})", pagina, flags=re.IGNORECASE):
            rotulos[numero] = pagina
    return "\n".join(resumen), rotulos


def _es_pagina_rotulo(pagina: str) -> bool:
    return bool(re.search(r"GUIA:\s*\d{6,}", pagina, flags=re.IGNORECASE))


def leer_guias_desde_palabras(palabras: list[dict]) -> list[GuiaLeida]:
    lineas = _agrupar_lineas(palabras)
    indices_valor = [i for i, linea in enumerate(lineas) if _es_fila_valores(linea)]
    guias: list[GuiaLeida] = []
    for orden, indice in enumerate(indices_valor):
        anterior = indices_valor[orden - 1] if orden else None
        bloque = _bloque(lineas, indice, anterior)
        guia = _guia_desde_bloque(bloque)
        if guia is not None:
            guias.append(guia)
    return guias


def _agrupar_lineas(palabras: list[dict]) -> list[list[dict]]:
    if not palabras:
        return []
    ordenadas = sorted(palabras, key=lambda item: (item["top"], item["x0"]))
    lineas: list[list[dict]] = [[ordenadas[0]]]
    for palabra in ordenadas[1:]:
        if abs(palabra["top"] - lineas[-1][0]["top"]) <= 3:
            lineas[-1].append(palabra)
        else:
            lineas.append([palabra])
    return lineas


def _es_fila_valores(linea: list[dict]) -> bool:
    guia = _token_en_columna(linea, "guia")
    valor = _token_en_columna(linea, "valor")
    return bool(guia and re.fullmatch(r"\d{8,}", guia)) and bool(valor and re.search(r"\d", valor))


def _bloque(lineas: list[list[dict]], indice_valores: int, indice_anterior: int | None) -> list[dict]:
    fila = lineas[indice_valores]
    tope = fila[0]["top"]
    piso = tope - ALTO_MAXIMO_BLOQUE
    if indice_anterior is not None:
        piso = max(piso, lineas[indice_anterior][0]["top"] + 4)
    palabras: list[dict] = []
    for linea in lineas[: indice_valores + 1]:
        if piso <= linea[0]["top"] <= tope + 3:
            palabras.extend(linea)
    return palabras


def _guia_desde_bloque(palabras: list[dict]) -> GuiaLeida | None:
    lineas = _agrupar_lineas(palabras)
    fila_valores = next((linea for linea in lineas if _es_fila_valores(linea)), None)
    if fila_valores is None:
        return None
    numero = _token_en_columna(fila_valores, "guia") or ""
    recaudo = _token_en_columna(fila_valores, "valor") or ""
    tipo = " ".join(_textos_en_columna(fila_valores, "tipo"))
    nro = _consecutivo(lineas, fila_valores)
    ciudad = " ".join(
        token
        for linea in lineas
        for token in _textos_en_columna(linea, "ciudad")
        if token.upper().rstrip(":") not in ETIQUETAS and not token.endswith(":")
    )
    return GuiaLeida(consecutivo=nro, numero=numero, ciudad=ciudad.strip(), recaudo=recaudo, tipo=tipo.strip())


def _consecutivo(lineas: list[list[dict]], fila_valores: list[dict]) -> int | None:
    en_valores = _token_en_columna(fila_valores, "nro")
    if en_valores and re.fullmatch(r"\d{1,4}", en_valores):
        return int(en_valores)
    for linea in lineas:
        if linea is fila_valores:
            continue
        token = _token_en_columna(linea, "nro")
        if token and re.fullmatch(r"\d{1,4}", token):
            return int(token)
    return None


def _token_en_columna(linea: list[dict], columna: str) -> str | None:
    textos = _textos_en_columna(linea, columna)
    return textos[0] if textos else None


def _textos_en_columna(linea: list[dict], columna: str) -> list[str]:
    if columna == "ciudad":
        minimo = COLUMNAS_PDF["ciudad"] - 10
        maximo = COLUMNAS_PDF["valor"] - 40
        cercanos = [palabra for palabra in linea if minimo <= palabra["x0"] < maximo]
        cercanos.sort(key=lambda palabra: palabra["x0"])
    else:
        centro = COLUMNAS_PDF[columna]
        cercanos = [
            palabra
            for palabra in linea
            if abs(palabra["x0"] - centro) <= TOLERANCIA_COLUMNA
        ]
        cercanos.sort(key=lambda palabra: abs(palabra["x0"] - centro))
    return [
        str(palabra["text"])
        for palabra in cercanos
        if not str(palabra["text"]).endswith(":") and str(palabra["text"]).upper() not in ETIQUETAS
    ]


def leer_resumen(texto: str) -> list[ResumenLeido]:
    """Reconstruye las tres rarezas conocidas. El patrón fino del bloque queda por verificar con el PDF real."""
    lineas = [linea.strip() for linea in texto.splitlines() if linea.strip()]
    productos: list[ResumenLeido] = []
    indice = 0
    while indice < len(lineas):
        partido = _nombre_partido(lineas, indice)
        if partido is not None:
            nombre, cantidad, salto = partido
            productos.append(ResumenLeido(sku="", id_dropi="", nombre=nombre, cantidad=cantidad))
            indice += salto
            continue
        identificado = _linea_producto(lineas[indice])
        if identificado is not None:
            productos.append(identificado)
        indice += 1
    return [item for item in productos if item.cantidad > 0 and (item.id_dropi or item.sku or item.nombre)]


def _nombre_partido(lineas: list[str], indice: int) -> tuple[str, int, int] | None:
    if indice + 2 >= len(lineas):
        return None
    if re.fullmatch(r"\d+", lineas[indice + 1]) and not re.fullmatch(r"\d+", lineas[indice]):
        if re.search(r"[A-Za-z]", lineas[indice + 2]):
            cantidad = int(lineas[indice + 1])
            nombre = f"{lineas[indice]} {lineas[indice + 2]}".strip()
            return nombre, cantidad, 3
    return None


def _linea_producto(linea: str) -> ResumenLeido | None:
    coincidencia = re.fullmatch(
        r"(?P<sku>\S*)\s+(?P<id>\d{2}[A-Z]{3}\d{3})\s+(?P<nombre>.*?)\s+(?P<cant>\d+)\s*$",
        linea,
    )
    if coincidencia:
        return ResumenLeido(
            sku="" if coincidencia.group("sku") in {"-", "—"} else coincidencia.group("sku"),
            id_dropi=coincidencia.group("id"),
            nombre=coincidencia.group("nombre").strip(),
            cantidad=int(coincidencia.group("cant")),
        )
    solo_id = re.fullmatch(r"(?P<id>\d{2}[A-Z]{3}\d{3})\s+(?P<nombre>.*?)\s+(?P<cant>\d+)\s*$", linea)
    if solo_id:
        return ResumenLeido(
            sku="",
            id_dropi=solo_id.group("id"),
            nombre=solo_id.group("nombre").strip(),
            cantidad=int(solo_id.group("cant")),
        )
    return None


def reconstruir_codigo(valor) -> str:
    """Expande la notación científica que Excel dejó en el maestro. No recupera dígitos ya perdidos."""
    if valor is None:
        return ""
    if isinstance(valor, int) and not isinstance(valor, bool):
        return str(valor)
    if isinstance(valor, float):
        return str(int(round(valor)))
    texto = str(valor).strip().replace(" ", "")
    if re.fullmatch(r"\d+", texto):
        return texto
    coincidencia = re.fullmatch(r"(\d+)[,.](\d+)[eE]\+(\d+)", texto)
    if not coincidencia:
        return texto
    entero, fraccion, exponente = coincidencia.groups()
    digitos = entero + fraccion
    ceros = int(exponente) - len(fraccion)
    if ceros >= 0:
        return digitos + ("0" * ceros)
    return digitos[: len(digitos) + ceros]


def _validar(guias: list[GuiaLeida], resumen: list[ResumenLeido], rotulos: dict[str, str]) -> tuple[list[str], list[str]]:
    avisos: list[str] = []
    bloqueos: list[str] = []
    if not guias:
        bloqueos.append("No se reconocieron guías en el PDF.")
    numeros = [guia.numero for guia in guias]
    repetidas = sorted({numero for numero in numeros if numeros.count(numero) > 1})
    if repetidas:
        avisos.append("Guías repetidas dentro del PDF: " + ", ".join(repetidas))
    consecutivos = [guia.consecutivo for guia in guias if guia.consecutivo]
    if consecutivos:
        esperados = set(range(1, max(consecutivos) + 1))
        faltan = sorted(esperados - set(consecutivos))
        if faltan:
            avisos.append("Faltan consecutivos: " + ", ".join(str(item) for item in faltan))
    if rotulos and len(rotulos) != len(guias):
        avisos.append(f"Las guías leídas ({len(guias)}) no coinciden con los rótulos ({len(rotulos)}).")
    unidades_rotulos = _unidades_rotulos(rotulos)
    unidades_resumen = sum(item.cantidad for item in resumen)
    if resumen and unidades_rotulos is not None and unidades_rotulos != unidades_resumen:
        avisos.append(f"Los rótulos suman {unidades_rotulos} unidades y el resumen suma {unidades_resumen}.")
    return avisos, bloqueos


def _unidades_rotulos(rotulos: dict[str, str]) -> int | None:
    if not rotulos:
        return None
    total = 0
    encontro = False
    for texto in rotulos.values():
        for cantidad in re.findall(r"(?:CANT(?:IDAD)?|UND)\s*[:xX]?\s*(\d+)", texto, flags=re.IGNORECASE):
            total += int(cantidad)
            encontro = True
    return total if encontro else None


def _pegar_rotulos(guias: list[GuiaLeida], rotulos: dict[str, str]) -> None:
    for guia in guias:
        if guia.numero in rotulos:
            guia.texto_rotulo = rotulos[guia.numero]


def _transportadora(texto: str) -> str:
    mayusculas = texto.upper()
    for _nombre, dropi, _alias, _orden in TRANSPORTADORAS:
        if dropi.upper() in mayusculas:
            return dropi
    return ""


def _fecha(texto: str) -> str:
    coincidencia = re.search(r"(\d{2})[-/](\d{2})[-/](\d{4})", texto)
    if not coincidencia:
        return ""
    dia, mes, anio = coincidencia.groups()
    return f"{anio}-{mes}-{dia}"
