"""Rutas y catálogos fijos de la bodega."""

from __future__ import annotations

import logging
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
DATOS = RAIZ / "datos"
RESPALDOS = DATOS / "respaldos"
NUCLEO = RAIZ / "nucleo"
BASE = DATOS / "despachos.db"
REGISTRO = DATOS / "registro.log"

# Centros de columna medidos en el PDF real, en puntos.
COLUMNAS_PDF = {
    "nro": 35,
    "guia": 75,
    "ciudad": 171,
    "valor": 490,
    "tipo": 612,
}

TOLERANCIA_COLUMNA = 45
ALTO_MAXIMO_BLOQUE = 80

# Hoja de Excel -> nombre que escribe DROPI.
TRANSPORTADORAS = (
    ("ENVIA", "ENVIA", "ENVIA", 1),
    ("DERROCHA", "DERROCHA", "DERROCHA", 2),
    ("INTER", "INTERRAPIDISIMO", "INTER", 3),
    ("JAM DRIVE", "JAM DRIVE", "JAM DRIVE", 4),
    ("TCC", "TCC", "TCC", 5),
    ("DOMINA", "DOMINA", "DOMINA", 6),
    ("99 MINUTOS", "99 MINUTOS", "99MINUTOS", 7),
    ("VELOCES", "VELOCES", "VELOCES", 8),
    ("COORDINADORA", "COORDINADORA", "COORDINADORA", 9),
)

ROLES_FASE_1 = {
    "ADMINISTRADOR",
    "COORDINACION",
    "SALIDAS_ECOMMERCE",
    "ALISTADOR",
    "DESPACHADOR",
    "CONSULTA",
}

ROLES_SIN_PANTALLA: set[str] = set()


def preparar_carpetas() -> None:
    DATOS.mkdir(parents=True, exist_ok=True)
    RESPALDOS.mkdir(parents=True, exist_ok=True)
    NUCLEO.mkdir(parents=True, exist_ok=True)


def configurar_registro() -> logging.Logger:
    preparar_carpetas()
    registro = logging.getLogger("despachos")
    if not registro.handlers:
        registro.setLevel(logging.INFO)
        archivo = logging.FileHandler(REGISTRO, encoding="utf-8")
        archivo.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        registro.addHandler(archivo)
    return registro
