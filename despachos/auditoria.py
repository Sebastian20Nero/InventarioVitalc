"""Bitácora encadenada. El cambio y su fila se escriben en la misma transacción."""

from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime


def registrar(conn: sqlite3.Connection, usuario_id: int | None, accion: str, detalle: str) -> str:
    anterior = conn.execute("SELECT huella FROM auditoria ORDER BY id DESC LIMIT 1").fetchone()
    previa = anterior["huella"] if anterior else "0" * 64
    fecha = datetime.now().isoformat(timespec="seconds")
    material = f"{previa}|{fecha}|{usuario_id}|{accion}|{detalle}"
    huella = hashlib.sha256(material.encode("utf-8")).hexdigest()
    conn.execute(
        """
        INSERT INTO auditoria (fecha, usuario_id, accion, detalle, huella_anterior, huella)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (fecha, usuario_id, accion, detalle, previa, huella),
    )
    return huella


def verificar_cadena(conn: sqlite3.Connection) -> tuple[bool, str]:
    filas = conn.execute(
        "SELECT id, fecha, usuario_id, accion, detalle, huella_anterior, huella FROM auditoria ORDER BY id"
    ).fetchall()
    previa = "0" * 64
    for fila in filas:
        if fila["huella_anterior"] != previa:
            return False, f"La cadena se rompe en la fila {fila['id']}."
        material = f"{previa}|{fila['fecha']}|{fila['usuario_id']}|{fila['accion']}|{fila['detalle']}"
        esperada = hashlib.sha256(material.encode("utf-8")).hexdigest()
        if fila["huella"] != esperada:
            return False, f"La cadena se rompe en la fila {fila['id']}."
        previa = fila["huella"]
    if not filas:
        return True, "La bitácora todavía no tiene eventos."
    return True, f"Cadena íntegra. {len(filas)} eventos."
