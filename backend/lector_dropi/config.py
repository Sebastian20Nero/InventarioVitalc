"""Rutas, parametros y registro de sucesos de la aplicacion.

Todo lo que dependa del equipo donde corre vive aqui: la ubicacion de la base,
la carpeta de respaldos y el archivo de registro. Asi el resto de los modulos
no sabe nada del sistema de archivos.

Cuando la aplicacion corre empaquetada como .exe, los archivos del programa son
de solo lectura, asi que la base y los respaldos van a la carpeta de datos del
usuario, no junto al ejecutable.
"""

from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

APP_NOMBRE = "Control de Despachos"
APP_VERSION = "1.0.0"


def empaquetada() -> bool:
    """True cuando corre como .exe generado con PyInstaller."""
    return getattr(sys, "frozen", False)


def carpeta_programa() -> Path:
    """Donde estan los archivos del programa (solo lectura si es .exe)."""
    if empaquetada():
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent


def carpeta_datos() -> Path:
    """Donde se guarda lo que la aplicacion escribe.

    Al correr empaquetada se usa la carpeta del usuario, porque el .exe puede
    estar en una ruta sin permiso de escritura.
    """
    if empaquetada():
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "ControlDespachos"
    else:
        base = carpeta_programa() / "datos"
    base.mkdir(parents=True, exist_ok=True)
    return base


RUTA_BASE_DATOS = carpeta_datos() / "despachos.db"
CARPETA_RESPALDOS = carpeta_datos() / "respaldos"
CARPETA_EXPORTES = carpeta_datos() / "exportes"
RUTA_REGISTRO = carpeta_datos() / "registro.log"

for _carpeta in (CARPETA_RESPALDOS, CARPETA_EXPORTES):
    _carpeta.mkdir(parents=True, exist_ok=True)

# Valores iniciales de la tabla parametro. Se escriben una sola vez, al crear
# la base; despues se cambian desde la pantalla de configuracion.
PARAMETROS_INICIALES = {
    "cortes_por_dia": "3",
    "dias_retencion_respaldos": "30",
    "carpeta_respaldos": str(CARPETA_RESPALDOS),
    "sonido_escaneo": "1",
}

# Transportadoras con las que arranca el sistema. El nombre que escribe DROPI
# en el PDF no siempre coincide con el de uso diario, por eso van aparte.
# Agregar una nueva es insertar una fila, no tocar codigo.
TRANSPORTADORAS_INICIALES = [
    # (nombre, nombre_dropi, alias separados por ;)
    ("ENVIA", "ENVIA", "ENVÍA"),
    ("DERROCHA", "DERROCHA", "DEROCHA;DE ROCHA"),
    ("INTERRAPIDISIMO", "INTERRAPIDISIMO", "INTER;INTERRAPIDÍSIMO;INTER RAPIDISIMO"),
    ("JAM DRIVE", "JAM DRIVE", "JAMV DRIVE;JAMDRIVE"),
    ("TCC", "TCC", ""),
    ("DOMINA", "DOMINA", ""),
    ("99 MINUTOS", "99 MINUTOS", "99MINUTOS;99 MIN"),
    ("VELOCES", "VELOCES", ""),
    ("COORDINADORA", "COORDINADORA", ""),
]

MOTIVOS_REPRESADO = [
    "Sin stock",
    "Novedad de dirección",
    "Dañado",
    "Otro",
]

ROLES = ["Administrador", "Alistador", "Despachador"]

# Nombres que DROPI reporta como producto pero no se alistan en bodega.
# Se marcan con es_fisico = 0 y quedan fuera de la hoja de alistamiento.
NO_FISICOS = ["ENVIO EXPRESS", "ENVÍO EXPRESS", "ASEGURADO", "FLETE"]


def configurar_registro(nivel: int = logging.INFO) -> logging.Logger:
    """Deja el registro en un archivo que rota, para que no crezca sin control."""
    log = logging.getLogger("despachos")
    if log.handlers:
        return log
    log.setLevel(nivel)
    formato = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    archivo = RotatingFileHandler(
        RUTA_REGISTRO, maxBytes=2_000_000, backupCount=5, encoding="utf-8"
    )
    archivo.setFormatter(formato)
    log.addHandler(archivo)
    if not empaquetada():
        consola = logging.StreamHandler()
        consola.setFormatter(formato)
        log.addHandler(consola)
    return log


registro = configurar_registro()
