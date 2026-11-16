"""Lectura de la «Relación de guías impresas» que genera DROPI.

El PDF trae tres secciones y el orden de paginas no es fijo, asi que las
secciones se reconocen por su texto, nunca por numero de pagina:

  1. Manifiesto      una fila por guia, con ciudad, recaudo y tipo de logistica
  2. Resumen         bloque que empieza en «PRODUCTOS FECHA MANIFIESTO»
  3. Rotulos         una pagina por guia, con el detalle de productos

La extraccion del texto y su interpretacion estan separadas a proposito:
`parsear_texto` recibe el texto ya extraido, asi que se puede probar sin tener
un PDF a la mano y sin depender de la libreria de lectura.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

# ── Expresiones ──────────────────────────────────────────────────────────────
# Todas toleran espacios variables y saltos de linea, porque la extraccion de
# texto de un PDF no respeta el espaciado original.

_RE_TRANSPORTADORA = re.compile(r"TRANSPORTADORA\s*:?\s*([A-ZÁÉÍÓÚÑ0-9 .\-]+?)\s*(?:\n|$)", re.I)

_RE_FECHA_MANIFIESTO = re.compile(
    r"FECHA\s+MANIFIESTO[^:]*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4})", re.I
)

# Nro: 1 | Guia: 240062419605 | Ciudad Destino: TIERRALTA | Valor de Recaudo: 249000.00 | Tipo de logistica: CON RECAUDO
_RE_FILA_GUIA = re.compile(
    r"Nro\s*:?\s*(\d+)\s*\|?\s*"
    r"Guia\s*:?\s*([0-9A-Za-z\-]+)\s*\|?\s*"
    r"Ciudad\s+Destino\s*:?\s*(.*?)\s*\|?\s*"
    r"Valor\s+de\s+Recaudo\s*:?\s*([\d.,]+)\s*\|?\s*"
    r"Tipo\s+de\s+logistica\s*:?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]+)",
    re.I,
)

# (ID: 1924139) - (SKU: 23AGU007) - AGUAJE.PV julio    68
# El SKU puede venir vacio y el nombre puede partirse en dos lineas, con la
# cantidad quedando en medio; por eso la cantidad se busca aparte.
_RE_LINEA_RESUMEN = re.compile(
    r"\(\s*ID\s*:\s*([^)]*?)\s*\)\s*-\s*\(\s*SKU\s*:\s*([^)]*?)\s*\)\s*-\s*(.*)",
    re.I,
)

_RE_INICIO_RESUMEN = re.compile(r"PRODUCTOS\s+FECHA\s+MANIFIESTO", re.I)
_RE_GUIA_ROTULO = re.compile(r"\bGUIA\s*:?\s*([0-9A-Za-z\-]+)", re.I)
_RE_CANTIDAD_FINAL = re.compile(r"(.*?)\s+(\d+)\s*$")

# Encabezados y pies que no son datos y deben descartarse al leer tablas.
_RUIDO = {
    "", "NOMBRE", "CANTIDAD", "PRODUCTO", "PRODUCTOS", "TOTAL", "TOTALES",
    "NOMBRE DE AUXILIAR", "PLACA DEL VEHICULO", "FIRMA DE AUXILIAR", "#",
}


def _normalizar(texto: str) -> str:
    """Mayusculas sin tildes, para comparar nombres de transportadora."""
    t = unicodedata.normalize("NFD", str(texto or ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t).strip().upper()


def _a_numero(valor: str) -> float:
    """Convierte '249000.00' o '249.000,00' a numero. Devuelve 0 si no puede."""
    t = re.sub(r"[^\d.,-]", "", str(valor or ""))
    if not t:
        return 0.0
    # Si tiene ambos separadores, el ultimo manda como decimal.
    if "," in t and "." in t:
        t = t.replace(".", "").replace(",", ".") if t.rfind(",") > t.rfind(".") else t.replace(",", "")
    elif "," in t:
        # Una coma con dos decimales es decimal; si no, es separador de miles.
        t = t.replace(",", ".") if re.search(r",\d{1,2}$", t) else t.replace(",", "")
    try:
        return float(t)
    except ValueError:
        return 0.0


# ── Estructuras ──────────────────────────────────────────────────────────────

@dataclass
class ProductoLeido:
    """Un producto tal como lo escribe DROPI, sin interpretar."""
    id_dropi: str
    sku_dropi: str
    nombre_dropi: str
    cantidad: int

    @property
    def clave(self) -> tuple[str, str]:
        """La identidad es la pareja ID + SKU: un mismo SKU trae varios ID."""
        return (self.sku_dropi, self.id_dropi)


@dataclass
class GuiaLeida:
    numero: str
    consecutivo: int | None = None
    ciudad_destino: str = ""
    valor_recaudo: float = 0.0
    tipo_logistica: str = ""
    productos: list[ProductoLeido] = field(default_factory=list)

    @property
    def unidades(self) -> int:
        return sum(p.cantidad for p in self.productos)


@dataclass
class Manifiesto:
    """Lo que trae un PDF de DROPI, ya interpretado pero sin traducir."""
    transportadora: str = ""
    fecha_manifiesto: date | None = None
    guias: list[GuiaLeida] = field(default_factory=list)
    resumen: list[ProductoLeido] = field(default_factory=list)
    paginas: int = 0
    archivo: str = ""
    hash_archivo: str = ""
    avisos: list[str] = field(default_factory=list)

    @property
    def total_guias(self) -> int:
        return len(self.guias)

    @property
    def unidades_resumen(self) -> int:
        return sum(p.cantidad for p in self.resumen)

    @property
    def unidades_rotulos(self) -> int:
        return sum(g.unidades for g in self.guias)

    def validar(self) -> list[dict]:
        """Comprobaciones que se muestran antes de guardar nada.

        Devuelve una lista de {clave, titulo, ok, detalle}. Ninguna lanza
        excepcion: el usuario debe poder ver todo lo que esta mal de una vez.
        """
        pruebas = []

        con_detalle = sum(1 for g in self.guias if g.productos)
        pruebas.append({
            "clave": "guias_vs_rotulos",
            "titulo": "Guías del manifiesto con su página de rótulo",
            "ok": con_detalle == self.total_guias and self.total_guias > 0,
            "detalle": f"{con_detalle} de {self.total_guias} guías tienen detalle de productos",
        })

        dif = self.unidades_rotulos - self.unidades_resumen
        pruebas.append({
            "clave": "productos",
            "titulo": "Suma de productos por guía contra el resumen",
            "ok": dif == 0,
            "detalle": (f"{self.unidades_rotulos:,} en rótulos contra "
                        f"{self.unidades_resumen:,} en el resumen"
                        + ("" if dif == 0 else f" · diferencia de {dif:+,}")).replace(",", "."),
        })

        numeros = [g.numero for g in self.guias]
        repetidas = sorted({n for n in numeros if numeros.count(n) > 1})
        pruebas.append({
            "clave": "duplicadas_internas",
            "titulo": "Guías repetidas dentro del mismo PDF",
            "ok": not repetidas,
            "detalle": "Ninguna repetida" if not repetidas
                       else f"{len(repetidas)} repetidas: {', '.join(repetidas[:5])}",
        })

        pruebas.append({
            "clave": "cabecera",
            "titulo": "Transportadora y fecha de manifiesto",
            "ok": bool(self.transportadora) and self.fecha_manifiesto is not None,
            "detalle": f"{self.transportadora or 'sin transportadora'} · "
                       f"{self.fecha_manifiesto.strftime('%d/%m/%Y') if self.fecha_manifiesto else 'sin fecha'}",
        })
        return pruebas


# ── Lectura ──────────────────────────────────────────────────────────────────

def extraer_paginas(ruta: str | Path) -> list[str]:
    """Texto de cada pagina del PDF. Requiere pdfplumber."""
    return extraer_documento(ruta)[0]


def extraer_documento(ruta: str | Path) -> tuple[list[str], list[list[dict]]]:
    """Texto y palabras con coordenadas de cada pagina.

    Las palabras hacen falta para leer el manifiesto, que es una tabla y no
    sobrevive al aplanado a texto.
    """
    import pdfplumber

    textos: list[str] = []
    palabras: list[list[dict]] = []
    with pdfplumber.open(str(ruta)) as pdf:
        for pagina in pdf.pages:
            textos.append(pagina.extract_text() or "")
            palabras.append(pagina.extract_words() or [])
    return textos, palabras


def hash_archivo(ruta: str | Path) -> str:
    """Huella del archivo, para detectar que un PDF ya se cargo."""
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1024 * 1024), b""):
            h.update(bloque)
    return h.hexdigest()


def _parsear_fecha(texto: str) -> date | None:
    for formato in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(texto.strip(), formato).date()
        except ValueError:
            continue
    return None


def _parsear_resumen(lineas: list[str]) -> list[ProductoLeido]:
    """Interpreta el bloque de resumen de productos.

    Un producto queda abierto hasta que empieza el siguiente o se acaba el
    bloque. Hace falta porque el nombre puede partirse en dos lineas con la
    cantidad en medio: «ENVIO EXPRESS» / «3» / «ASEGURADO». Cerrarlo al ver la
    cantidad perderia la segunda parte del nombre.
    """
    productos: list[ProductoLeido] = []
    abierto: ProductoLeido | None = None

    def cerrar():
        nonlocal abierto
        if abierto is not None:
            abierto.nombre_dropi = re.sub(r"\s+", " ", abierto.nombre_dropi).strip()
            productos.append(abierto)
            abierto = None

    for cruda in lineas:
        linea = cruda.strip()
        if not linea or _normalizar(linea) in _RUIDO:
            continue

        m = _RE_LINEA_RESUMEN.match(linea)
        if m:
            cerrar()
            resto = m.group(3).strip()
            abierto = ProductoLeido(m.group(1).strip(), m.group(2).strip(), resto, 0)
            mc = _RE_CANTIDAD_FINAL.match(resto)
            if mc:
                abierto.nombre_dropi = mc.group(1).strip()
                abierto.cantidad = int(mc.group(2))
            continue

        if abierto is None:
            continue

        if linea.isdigit():                 # la cantidad vino en su propia linea
            abierto.cantidad = int(linea)
            continue

        mc = _RE_CANTIDAD_FINAL.match(linea)
        if mc:                              # resto del nombre y la cantidad juntos
            abierto.nombre_dropi += " " + mc.group(1).strip()
            abierto.cantidad = int(mc.group(2))
        else:                               # solo el resto del nombre
            abierto.nombre_dropi += " " + linea

    cerrar()
    return productos


def _es_pagina_rotulo(texto: str) -> bool:
    """Una pagina de rotulo trae el numero de guia en su propia linea."""
    if re.search(r"^\s*GUIA\s*:", texto, re.I | re.M):
        return True
    return bool(re.search(r"#\s*PRODUCTO\s*CANT", texto, re.I))


def _parsear_rotulo(texto: str) -> tuple[str, list[ProductoLeido]]:
    """Numero de guia y detalle de productos de una pagina de rotulo."""
    m = _RE_GUIA_ROTULO.search(texto)
    if not m:
        return "", []
    numero = m.group(1).strip()

    productos: list[ProductoLeido] = []
    en_tabla = False
    for cruda in texto.splitlines():
        linea = cruda.strip()
        norm = _normalizar(linea)
        if not en_tabla:
            # La tabla empieza en la cabecera «# PRODUCTO CANT».
            if "PRODUCTO" in norm and ("CANT" in norm or "CANTIDAD" in norm):
                en_tabla = True
            continue
        if not linea or norm in _RUIDO:
            continue
        mc = _RE_CANTIDAD_FINAL.match(linea)
        if not mc:
            continue
        nombre = re.sub(r"^\d+\s+", "", mc.group(1).strip())   # quita el «#» de la fila
        if not nombre or _normalizar(nombre) in _RUIDO:
            continue
        productos.append(ProductoLeido("", "", nombre, int(mc.group(2))))
    return numero, productos


# ── Manifiesto por coordenadas ───────────────────────────────────────────────
# El manifiesto es una tabla. Al extraer el texto plano, el orden de las
# columnas cambia de una pagina a otra y las ciudades largas se parten, asi que
# leerlo por lineas pierde guias sin avisar. Las columnas, en cambio, estan
# siempre en la misma posicion horizontal, y por ahi se lee.
#
# Posicion de cada columna, medida sobre el PDF real (en puntos):
#     Nro ~35 · Guia ~75 · Ciudad ~171 · Valor ~490 · Tipo ~612
# Se guardan como limites, no como posiciones exactas, para tolerar que el
# documento cambie de margen.
_COLUMNAS = (
    ("nro", 0, 70),
    ("guia", 70, 160),
    ("ciudad", 160, 480),
    ("valor", 480, 600),
    ("tipo", 600, 10_000),
)

# Cada guia ocupa tres filas y el reparto cambia de una pagina a otra: en unas
# «Nro:» y su numero van juntos, en otras el numero cae en la fila de valores,
# y una ciudad larga se parte entre la primera fila y la ultima. Lo unico
# estable es que la fila de valores —la que trae el numero de guia— es la
# ultima del bloque. Por eso se ancla ahi y el bloque se toma desde donde
# termino el anterior.
_MARGEN_ABAJO = 6

# Alto maximo de un bloque de guia. Acota el bloque por arriba para que no
# absorba el encabezado de la pagina ni el bloque anterior.
_ALTO_MAXIMO = 34

# Se quitan las etiquetas completas, no palabra por palabra: «de» suelto
# aparece dentro de nombres de ciudad como SAN PEDRO DE LOS MILAGROS y
# borrarlo mutilaria el dato.
# Se quitan las etiquetas completas, no palabra por palabra: la palabra
# «de» aparece dentro de nombres de ciudad como SAN PEDRO DE LOS MILAGROS,
# y borrarla suelta mutilaria el dato.
_ETIQUETAS = re.compile(
    r"Nro\s*:|Guia\s*:|"
    r"Ciudad\s+Destino\s*:|"
    r"Valor\s+de\s+Recaudo\s*:|"
    r"Tipo\s+de\s+log[ií]stica\s*:", re.I)


def _columna(x: float) -> str:
    for nombre, desde, hasta in _COLUMNAS:
        if desde <= x < hasta:
            return nombre
    return "tipo"


def _limpiar_celda(texto: str) -> str:
    """Quita las etiquetas de la tabla y deja solo el valor."""
    t = _ETIQUETAS.sub(" ", texto)
    return re.sub(r"\s+", " ", t).strip(" :")


def parsear_manifiesto_palabras(paginas_palabras: list[list[dict]]) -> list[GuiaLeida]:
    """Lee las filas del manifiesto usando la posicion de cada palabra.

    `paginas_palabras` es lo que devuelve `page.extract_words()` de pdfplumber:
    cada palabra con su texto y sus coordenadas.
    """
    guias: list[GuiaLeida] = []
    for palabras in paginas_palabras:
        # Solo las paginas del manifiesto. Las de rotulos no traen la etiqueta
        # «Nro:», y ahi los telefonos y codigos de rastreo caen en la misma
        # columna que el numero de guia: sin este filtro se colarian.
        if not any(re.fullmatch(r"Nro\s*:?", str(w.get("text", "")).strip(), re.I)
                   for w in palabras):
            continue

        # La fila de valores es la ultima del bloque y trae el numero de guia
        # en la columna «guia». Es el unico elemento con posicion estable.
        anclas = sorted(
            (w for w in palabras
             if 70 <= float(w["x0"]) < 160
             and re.fullmatch(r"\d{8,}", str(w.get("text", "")).strip())),
            key=lambda w: float("%s" % w["top"]))
        anterior = -float("inf")
        for ancla in anclas:
            abajo = float(ancla["top"]) + _MARGEN_ABAJO
            arriba = max(anterior, abajo - _ALTO_MAXIMO)
            banda = [w for w in palabras if arriba <= float(w["top"]) < abajo]
            anterior = abajo
            celdas: dict[str, list[tuple[float, float, str]]] = {}
            for w in banda:
                celdas.setdefault(_columna(float(w["x0"])), []).append(
                    (float(w["top"]), float(w["x0"]), str(w.get("text", ""))))

            def texto_de(col: str) -> str:
                partes = sorted(celdas.get(col, []))
                return _limpiar_celda(" ".join(p[2] for p in partes))

            crudo_nro = texto_de("nro")
            m = re.search(r"(\d+)", crudo_nro)
            if not m:
                continue
            crudo_guia = texto_de("guia")
            mg = re.search(r"([0-9A-Za-z\-]{5,})", crudo_guia)
            if not mg:
                continue
            guias.append(GuiaLeida(
                numero=mg.group(1),
                consecutivo=int(m.group(1)),
                ciudad_destino=texto_de("ciudad"),
                valor_recaudo=_a_numero(texto_de("valor")),
                tipo_logistica=texto_de("tipo"),
            ))
    return guias


def parsear_texto(paginas: list[str], archivo: str = "",
                  paginas_palabras: list[list[dict]] | None = None) -> Manifiesto:
    """Interpreta un manifiesto ya extraido del PDF.

    Con `paginas_palabras` lee las filas por coordenadas, que es lo que exige
    el PDF real. Sin ellas recurre a las expresiones sobre el texto, que
    sirven cuando cada guia viene en una sola linea.
    """
    manifiesto = Manifiesto(paginas=len(paginas), archivo=archivo)
    completo = "\n".join(paginas)

    m = _RE_TRANSPORTADORA.search(completo)
    if m:
        manifiesto.transportadora = _normalizar(m.group(1))
    m = _RE_FECHA_MANIFIESTO.search(completo)
    if m:
        manifiesto.fecha_manifiesto = _parsear_fecha(m.group(1))

    # 1 ── Manifiesto: una fila por guia
    guias: dict[str, GuiaLeida] = {}
    orden: list[str] = []
    leidas = (parsear_manifiesto_palabras(paginas_palabras) if paginas_palabras
              else [GuiaLeida(numero=g.group(2).strip(), consecutivo=int(g.group(1)),
                              ciudad_destino=g.group(3).strip(),
                              valor_recaudo=_a_numero(g.group(4)),
                              tipo_logistica=g.group(5).strip())
                    for g in _RE_FILA_GUIA.finditer(completo)])
    for g in leidas:
        if g.numero in guias:
            continue
        guias[g.numero] = g
        orden.append(g.numero)

    # 2 ── Resumen de productos
    # El corte se decide por pagina, no por linea: la primera pagina de
    # rotulos empieza con el horario y la ruta de la transportadora, y solo
    # mas abajo aparece «GUIA:». Cortando por linea, esas primeras lineas se
    # pegaban al ultimo producto del resumen y le cambiaban la cantidad.
    lineas_resumen: list[str] = []
    recogiendo = False
    for pagina in paginas:
        if recogiendo and _es_pagina_rotulo(pagina):
            break
        for linea in pagina.splitlines():
            if _RE_INICIO_RESUMEN.search(linea):
                recogiendo = True
                continue
            if recogiendo:
                lineas_resumen.append(linea)
    manifiesto.resumen = _parsear_resumen(lineas_resumen)

    # 3 ── Rotulos: el detalle por guia
    for pagina in paginas:
        numero, productos = _parsear_rotulo(pagina)
        if not numero or not productos:
            continue
        if numero not in guias:
            guias[numero] = GuiaLeida(numero=numero)
            orden.append(numero)
            manifiesto.avisos.append(
                f"La guía {numero} tiene rótulo pero no aparece en el manifiesto."
            )
        guias[numero].productos.extend(productos)

    manifiesto.guias = [guias[n] for n in orden]
    return manifiesto


def leer_pdf(ruta: str | Path) -> Manifiesto:
    """Lee un PDF de DROPI completo: texto, interpretacion y huella."""
    ruta = Path(ruta)
    textos, palabras = extraer_documento(ruta)
    manifiesto = parsear_texto(textos, archivo=ruta.name, paginas_palabras=palabras)
    manifiesto.hash_archivo = hash_archivo(ruta)
    return manifiesto
