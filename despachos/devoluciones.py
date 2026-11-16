"""Recepción de devoluciones. Es una entrada, no un corte ni un alistamiento."""

from __future__ import annotations

from datetime import datetime

from despachos.auditoria import registrar as registrar_evento
from despachos.db import BaseDatos
from despachos.servicios import ReglaError

ESTADOS = {"bueno": "Bueno", "novedad": "Con novedad"}
ROLES = {"DEVOLUCIONES", "ADMINISTRADOR"}


def buscar_guia(base: BaseDatos, numero: str) -> dict | None:
    numero = numero.strip()
    if not numero:
        return None
    fila = base.conn.execute(
        """
        SELECT g.id, g.numero, c.numero AS corte, c.fecha, t.nombre AS transportadora
        FROM guia g
        JOIN corte c ON c.id = g.corte_id
        JOIN transportadora t ON t.id = c.transportadora_id
        WHERE g.numero = ? AND c.anulado = 0 AND g.anulado = 0
        ORDER BY c.id DESC
        LIMIT 1
        """,
        (numero,),
    ).fetchone()
    if fila is None:
        return None
    return {
        "guia_id": fila["id"],
        "numero": fila["numero"],
        "corte": fila["corte"],
        "fecha": fila["fecha"],
        "transportadora": fila["transportadora"],
    }


def registrar(base: BaseDatos, usuario_id: int, guia_origen: str, observacion: str, lineas: list[dict]) -> int:
    if not lineas:
        raise ReglaError("Agrega al menos un producto recibido.")
    guia_origen = guia_origen.strip()
    with base.transaccion() as conn:
        _exigir_rol(conn, usuario_id)
        encontrada = None
        if guia_origen:
            encontrada = conn.execute(
                """
                SELECT g.id FROM guia g
                JOIN corte c ON c.id = g.corte_id
                WHERE g.numero = ? AND c.anulado = 0 AND g.anulado = 0
                ORDER BY c.id DESC LIMIT 1
                """,
                (guia_origen,),
            ).fetchone()
        cursor = conn.execute(
            """
            INSERT INTO devolucion (guia_origen, guia_id, observacion, recibido_por, recibido_en)
            VALUES (?, ?, ?, ?, ?)
            """,
            (guia_origen, encontrada["id"] if encontrada else None, observacion.strip(), usuario_id, _ahora()),
        )
        devolucion_id = int(cursor.lastrowid)
        for linea in lineas:
            _insertar_linea(conn, devolucion_id, linea)
        registrar_evento(
            conn,
            usuario_id,
            "devolucion.registrar",
            f"{guia_origen or 'sin guia'}|{len(lineas)} lineas",
        )
        return devolucion_id


def anular(base: BaseDatos, devolucion_id: int, usuario_id: int, motivo: str) -> None:
    motivo = motivo.strip()
    if not motivo:
        raise ReglaError("La anulación necesita un motivo.")
    with base.transaccion() as conn:
        _exigir_rol(conn, usuario_id)
        fila = conn.execute("SELECT anulado FROM devolucion WHERE id = ?", (devolucion_id,)).fetchone()
        if fila is None or fila["anulado"]:
            raise ReglaError("Esa devolución ya no se puede anular.")
        conn.execute(
            """
            UPDATE devolucion
            SET anulado = 1, motivo_anulacion = ?, anulado_por = ?
            WHERE id = ?
            """,
            (motivo, usuario_id, devolucion_id),
        )
        registrar_evento(conn, usuario_id, "devolucion.anular", f"{devolucion_id}|{motivo}")


def listar(base: BaseDatos):
    return base.conn.execute(
        """
        SELECT d.id, d.guia_origen, d.observacion, d.recibido_en, d.anulado,
               u.nombre AS recibio,
               GROUP_CONCAT(p.nombre || ' x ' || l.cantidad || ' (' || l.estado_producto || ')', '; ') AS lineas
        FROM devolucion d
        JOIN usuario u ON u.id = d.recibido_por
        JOIN devolucion_linea l ON l.devolucion_id = d.id
        JOIN producto p ON p.id = l.producto_id
        GROUP BY d.id
        ORDER BY d.id DESC
        """
    ).fetchall()


def _insertar_linea(conn, devolucion_id: int, linea: dict) -> None:
    estado = linea.get("estado_producto", "")
    disposicion = str(linea.get("disposicion", "")).strip()
    cantidad = int(linea.get("cantidad") or 0)
    if estado not in ESTADOS:
        raise ReglaError("El estado del producto es bueno o con novedad.")
    if cantidad < 1:
        raise ReglaError("La cantidad recibida tiene que ser mayor que cero.")
    if not disposicion:
        raise ReglaError("Indica qué se hace con el producto recibido.")
    producto = conn.execute("SELECT id, activo FROM producto WHERE id = ?", (linea["producto_id"],)).fetchone()
    if producto is None or not producto["activo"]:
        raise ReglaError("Elige un producto activo del maestro.")
    conn.execute(
        """
        INSERT INTO devolucion_linea (devolucion_id, producto_id, cantidad, estado_producto, disposicion, evidencia)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (devolucion_id, linea["producto_id"], cantidad, estado, disposicion, str(linea.get("evidencia", "")).strip()),
    )


def _exigir_rol(conn, usuario_id: int) -> None:
    rol = conn.execute("SELECT rol FROM usuario WHERE id = ?", (usuario_id,)).fetchone()
    if rol is None or rol["rol"] not in ROLES:
        raise ReglaError("Solo Devoluciones registra lo que vuelve a la bodega.")


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")
