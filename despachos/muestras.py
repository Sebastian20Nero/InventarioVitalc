"""Pedidos de muestra y mayorista. No salen sin factura escrita a mano."""

from __future__ import annotations

from datetime import datetime

from despachos.auditoria import registrar as registrar_evento
from despachos.db import BaseDatos
from despachos.servicios import ReglaError

TIPOS = {"MUESTRA": "Muestra", "MAYORISTA": "Mayorista"}
ROLES = {"MUESTRAS", "ADMINISTRADOR"}


def registrar(
    base: BaseDatos,
    usuario_id: int,
    tipo: str,
    pedido: str,
    destinatario: str,
    observacion: str,
    lineas: list[dict],
) -> int:
    pedido = pedido.strip()
    destinatario = destinatario.strip()
    if tipo not in TIPOS:
        raise ReglaError("El pedido es una muestra o una venta mayorista.")
    if not pedido:
        raise ReglaError("Escribe la referencia del pedido.")
    if not destinatario:
        raise ReglaError("Escribe quién recibe el pedido.")
    if not lineas:
        raise ReglaError("Agrega al menos un producto.")
    with base.transaccion() as conn:
        _exigir_rol(conn, usuario_id)
        cursor = conn.execute(
            """
            INSERT INTO salida_muestra (tipo, pedido, destinatario, observacion, solicitado_por, solicitado_en)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (tipo, pedido, destinatario, observacion.strip(), usuario_id, _ahora()),
        )
        salida_id = int(cursor.lastrowid)
        for linea in lineas:
            _insertar_linea(conn, salida_id, linea)
        registrar_evento(conn, usuario_id, "muestra.registrar", f"{tipo}|{pedido}|{len(lineas)} lineas")
        return salida_id


def validar_factura(base: BaseDatos, salida_id: int, usuario_id: int, factura_numero: str) -> None:
    factura_numero = factura_numero.strip()
    if not factura_numero:
        raise ReglaError("Escribe el número de la factura.")
    with base.transaccion() as conn:
        _exigir_rol(conn, usuario_id)
        fila = _pendiente(conn, salida_id)
        if fila["factura_numero"]:
            raise ReglaError("Esa factura ya quedó validada.")
        repetida = conn.execute(
            """
            SELECT id FROM salida_muestra
            WHERE factura_numero = ? AND anulado = 0 AND id != ?
            """,
            (factura_numero, salida_id),
        ).fetchone()
        if repetida is not None:
            raise ReglaError("Ese número de factura ya está en otro pedido.")
        cuando = _ahora()
        conn.execute(
            """
            UPDATE salida_muestra
            SET factura_numero = ?, validado_por = ?, validado_en = ?
            WHERE id = ?
            """,
            (factura_numero, usuario_id, cuando, salida_id),
        )
        registrar_evento(conn, usuario_id, "muestra.validar", f"{salida_id}|{factura_numero}|{cuando}")


def despachar(base: BaseDatos, salida_id: int, usuario_id: int) -> None:
    with base.transaccion() as conn:
        _exigir_rol(conn, usuario_id)
        fila = _pendiente(conn, salida_id)
        if not fila["factura_numero"]:
            raise ReglaError("No se despacha sin la factura validada.")
        if fila["despachado_en"]:
            raise ReglaError("Ese pedido ya salió.")
        conn.execute(
            """
            UPDATE salida_muestra
            SET despachado_por = ?, despachado_en = ?
            WHERE id = ?
            """,
            (usuario_id, _ahora(), salida_id),
        )
        registrar_evento(conn, usuario_id, "muestra.despachar", f"{salida_id}|{fila['factura_numero']}")


def anular(base: BaseDatos, salida_id: int, usuario_id: int, motivo: str) -> None:
    motivo = motivo.strip()
    if not motivo:
        raise ReglaError("La anulación necesita un motivo.")
    with base.transaccion() as conn:
        _exigir_rol(conn, usuario_id)
        fila = conn.execute(
            "SELECT anulado, despachado_en FROM salida_muestra WHERE id = ?",
            (salida_id,),
        ).fetchone()
        if fila is None or fila["anulado"]:
            raise ReglaError("Ese pedido ya no se puede anular.")
        if fila["despachado_en"]:
            raise ReglaError("Un pedido ya despachado no se anula.")
        conn.execute(
            """
            UPDATE salida_muestra
            SET anulado = 1, motivo_anulacion = ?, anulado_por = ?
            WHERE id = ?
            """,
            (motivo, usuario_id, salida_id),
        )
        registrar_evento(conn, usuario_id, "muestra.anular", f"{salida_id}|{motivo}")


def listar(base: BaseDatos):
    return base.conn.execute(
        """
        SELECT s.id, s.tipo, s.pedido, s.destinatario, s.factura_numero, s.validado_en,
               s.despachado_en, s.anulado,
               uv.nombre AS valido,
               ud.nombre AS despacho,
               GROUP_CONCAT(p.nombre || ' x ' || l.cantidad, '; ') AS lineas
        FROM salida_muestra s
        LEFT JOIN usuario uv ON uv.id = s.validado_por
        LEFT JOIN usuario ud ON ud.id = s.despachado_por
        JOIN salida_muestra_linea l ON l.salida_id = s.id
        JOIN producto p ON p.id = l.producto_id
        GROUP BY s.id
        ORDER BY s.id DESC
        """
    ).fetchall()


def _insertar_linea(conn, salida_id: int, linea: dict) -> None:
    cantidad = int(linea.get("cantidad") or 0)
    if cantidad < 1:
        raise ReglaError("La cantidad tiene que ser mayor que cero.")
    producto = conn.execute("SELECT id, activo FROM producto WHERE id = ?", (linea["producto_id"],)).fetchone()
    if producto is None or not producto["activo"]:
        raise ReglaError("Elige un producto activo del maestro.")
    conn.execute(
        "INSERT INTO salida_muestra_linea (salida_id, producto_id, cantidad) VALUES (?, ?, ?)",
        (salida_id, linea["producto_id"], cantidad),
    )


def _pendiente(conn, salida_id: int):
    fila = conn.execute("SELECT * FROM salida_muestra WHERE id = ?", (salida_id,)).fetchone()
    if fila is None or fila["anulado"]:
        raise ReglaError("Ese pedido ya está anulado.")
    return fila


def _exigir_rol(conn, usuario_id: int) -> None:
    rol = conn.execute("SELECT rol FROM usuario WHERE id = ?", (usuario_id,)).fetchone()
    if rol is None or rol["rol"] not in ROLES:
        raise ReglaError("Solo Muestras y mayoristas registra estos pedidos.")


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")
