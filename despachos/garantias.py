"""Salidas sin precio: garantía a un cliente o contenido para redes.

Quien solicita no puede autorizar la misma salida.
"""

from __future__ import annotations

from datetime import datetime

from despachos.auditoria import registrar
from despachos.db import BaseDatos
from despachos.servicios import ReglaError

TIPOS = {"GARANTIA": "Garantía", "CONTENIDO": "Contenido para redes"}
ROLES = {"GARANTIAS", "ADMINISTRADOR"}


def solicitar(
    base: BaseDatos,
    usuario_id: int,
    tipo: str,
    motivo: str,
    destinatario: str,
    producto_id: int,
    cantidad: int,
) -> int:
    motivo = motivo.strip()
    destinatario = destinatario.strip()
    if tipo not in TIPOS:
        raise ReglaError("El tipo es garantía o contenido para redes.")
    if not motivo or not destinatario:
        raise ReglaError("La salida necesita motivo y destinatario.")
    if cantidad < 1:
        raise ReglaError("La cantidad tiene que ser mayor que cero.")
    with base.transaccion() as conn:
        _exigir_rol(conn, usuario_id)
        producto = conn.execute("SELECT id, activo FROM producto WHERE id = ?", (producto_id,)).fetchone()
        if producto is None or not producto["activo"]:
            raise ReglaError("Elige un producto activo del maestro.")
        cursor = conn.execute(
            """
            INSERT INTO salida_sin_costo (
                tipo, motivo, destinatario, producto_id, cantidad, estado, solicitado_por, solicitado_en
            ) VALUES (?, ?, ?, ?, ?, 'solicitada', ?, ?)
            """,
            (tipo, motivo, destinatario, producto_id, cantidad, usuario_id, _ahora()),
        )
        registrar(conn, usuario_id, "garantia.solicitar", f"{tipo}|{destinatario}|producto {producto_id}|{cantidad}")
        return int(cursor.lastrowid)


def autorizar(base: BaseDatos, salida_id: int, usuario_id: int) -> None:
    with base.transaccion() as conn:
        salida = _pendiente(conn, salida_id, usuario_id)
        conn.execute(
            """
            UPDATE salida_sin_costo
            SET estado = 'autorizada', autorizado_por = ?, autorizado_en = ?
            WHERE id = ?
            """,
            (usuario_id, _ahora(), salida["id"]),
        )
        registrar(conn, usuario_id, "garantia.autorizar", f"salida {salida_id}")


def rechazar(base: BaseDatos, salida_id: int, usuario_id: int, motivo: str) -> None:
    motivo = motivo.strip()
    if not motivo:
        raise ReglaError("El rechazo necesita un motivo.")
    with base.transaccion() as conn:
        _pendiente(conn, salida_id, usuario_id)
        conn.execute(
            """
            UPDATE salida_sin_costo
            SET estado = 'rechazada', autorizado_por = ?, autorizado_en = ?, motivo_rechazo = ?
            WHERE id = ?
            """,
            (usuario_id, _ahora(), motivo, salida_id),
        )
        registrar(conn, usuario_id, "garantia.rechazar", f"salida {salida_id}|{motivo}")


def entregar(base: BaseDatos, salida_id: int, usuario_id: int) -> None:
    with base.transaccion() as conn:
        _exigir_rol(conn, usuario_id)
        salida = conn.execute("SELECT * FROM salida_sin_costo WHERE id = ?", (salida_id,)).fetchone()
        if salida is None or salida["estado"] != "autorizada":
            raise ReglaError("Solo se entrega una salida autorizada.")
        conn.execute(
            """
            UPDATE salida_sin_costo
            SET estado = 'entregada', entregado_por = ?, entregado_en = ?
            WHERE id = ?
            """,
            (usuario_id, _ahora(), salida_id),
        )
        registrar(conn, usuario_id, "garantia.entregar", f"salida {salida_id}")


def anular(base: BaseDatos, salida_id: int, usuario_id: int, motivo: str) -> None:
    motivo = motivo.strip()
    if not motivo:
        raise ReglaError("La anulación necesita un motivo.")
    with base.transaccion() as conn:
        rol = conn.execute("SELECT rol FROM usuario WHERE id = ?", (usuario_id,)).fetchone()
        if rol is None or rol["rol"] != "ADMINISTRADOR":
            raise ReglaError("Solo el administrador anula una salida sin costo.")
        salida = conn.execute("SELECT estado FROM salida_sin_costo WHERE id = ?", (salida_id,)).fetchone()
        if salida is None or salida["estado"] in {"anulada", "entregada"}:
            raise ReglaError("Esa salida ya no se puede anular.")
        conn.execute(
            """
            UPDATE salida_sin_costo
            SET estado = 'anulada', anulado = 1, motivo_anulacion = ?, anulado_por = ?
            WHERE id = ?
            """,
            (motivo, usuario_id, salida_id),
        )
        registrar(conn, usuario_id, "garantia.anular", f"salida {salida_id}|{motivo}")


def listar(base: BaseDatos):
    return base.conn.execute(
        """
        SELECT s.id, s.tipo, s.motivo, s.destinatario, s.cantidad, s.estado,
               p.nombre AS producto, u.nombre AS solicito,
               COALESCE(a.nombre, '') AS autorizo
        FROM salida_sin_costo s
        JOIN producto p ON p.id = s.producto_id
        JOIN usuario u ON u.id = s.solicitado_por
        LEFT JOIN usuario a ON a.id = s.autorizado_por
        ORDER BY s.id DESC
        """
    ).fetchall()


def _pendiente(conn, salida_id: int, usuario_id: int):
    _exigir_rol(conn, usuario_id)
    salida = conn.execute("SELECT * FROM salida_sin_costo WHERE id = ?", (salida_id,)).fetchone()
    if salida is None or salida["estado"] != "solicitada":
        raise ReglaError("Esa salida ya no está pendiente de autorización.")
    if salida["solicitado_por"] == usuario_id:
        raise ReglaError("Quien solicita la salida no puede autorizarla.")
    return salida


def _exigir_rol(conn, usuario_id: int) -> None:
    rol = conn.execute("SELECT rol FROM usuario WHERE id = ?", (usuario_id,)).fetchone()
    if rol is None or rol["rol"] not in ROLES:
        raise ReglaError("Solo Garantías puede registrar esta salida.")


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")
