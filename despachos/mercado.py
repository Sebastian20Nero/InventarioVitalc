"""Lote de Mercado Libre. No es un corte de transportadora ni un alistamiento."""

from __future__ import annotations

from datetime import datetime

from despachos.auditoria import registrar as registrar_evento
from despachos.db import BaseDatos
from despachos.lector_mercado import LecturaMercado
from despachos.servicios import ReglaError

ROLES = {"MERCADO_LIBRE", "ADMINISTRADOR"}
PLATAFORMA = "MercadoLibre"


def preparar(base: BaseDatos, lectura: LecturaMercado) -> LecturaMercado:
    lectura.avisos = [aviso for aviso in lectura.avisos if not aviso.startswith("Estas ventas ya están")]
    lectura.bloqueos = [
        bloqueo
        for bloqueo in lectura.bloqueos
        if not bloqueo.startswith("Faltan ") and not bloqueo.startswith("Este export ya")
    ]
    for item in lectura.resumen:
        fila = base.conn.execute(
            """
            SELECT producto_id FROM equivalencia_plataforma
            WHERE plataforma = ? AND referencia = ?
            """,
            (PLATAFORMA, item.id_dropi),
        ).fetchone()
        item.producto_id = fila["producto_id"] if fila else None
    por_referencia = {item.id_dropi: item.producto_id for item in lectura.resumen}
    for venta in lectura.ventas:
        venta.producto_id = por_referencia.get(venta.referencia)
    faltan = [item for item in lectura.resumen if item.producto_id is None]
    if faltan:
        lectura.bloqueos.append(
            f"Faltan {len(faltan)} títulos por asociar. El lote no se guarda hasta terminar la lista."
        )
    repetida = base.conn.execute("SELECT id FROM lote_mercado WHERE huella = ?", (lectura.huella,)).fetchone()
    if repetida:
        lectura.bloqueos.append("Este export ya está cargado. No se vuelve a guardar.")
    ya_vistas = []
    for numero in sorted({venta.numero for venta in lectura.ventas}):
        previa = base.conn.execute(
            """
            SELECT l.id FROM venta_mercado v
            JOIN lote_mercado l ON l.id = v.lote_id
            WHERE v.numero = ? AND l.anulado = 0
            LIMIT 1
            """,
            (numero,),
        ).fetchone()
        if previa:
            ya_vistas.append(numero)
    if ya_vistas:
        lectura.avisos.append(
            "Estas ventas ya están en otro lote: " + ", ".join(ya_vistas) + ". Puedes continuar."
        )
    return lectura


def guardar(base: BaseDatos, lectura: LecturaMercado, usuario_id: int, confirmo: bool, fecha: str) -> int:
    preparar(base, lectura)
    if lectura.bloqueos:
        raise ReglaError(lectura.bloqueos[0])
    if not lectura.lector_verificado and not confirmo:
        raise ReglaError("Confirma que revisaste ventas, títulos y unidades.")
    if not lectura.ventas:
        raise ReglaError("El export no tiene ventas.")
    fecha = lectura.fecha or fecha.strip()
    if not fecha:
        raise ReglaError("El export no trae la fecha de venta.")
    with base.transaccion() as conn:
        _exigir_rol(conn, usuario_id)
        if conn.execute("SELECT id FROM lote_mercado WHERE huella = ?", (lectura.huella,)).fetchone():
            raise ReglaError("Este export ya está cargado. No se vuelve a guardar.")
        cursor = conn.execute(
            """
            INSERT INTO lote_mercado (fecha, nombre_archivo, huella, ventas, unidades, cargado_por, cargado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                fecha,
                lectura.nombre_archivo,
                lectura.huella,
                len(lectura.ventas),
                lectura.unidades,
                usuario_id,
                _ahora(),
            ),
        )
        lote_id = int(cursor.lastrowid)
        for venta in lectura.ventas:
            if not venta.producto_id:
                raise ReglaError("Falta asociar un título. El lote no se guarda.")
            conn.execute(
                """
                INSERT INTO venta_mercado (
                    lote_id, numero, titulo, referencia, cantidad, comprador,
                    estado_origen, seguimiento, fecha_venta, producto_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    lote_id,
                    venta.numero,
                    venta.titulo,
                    venta.referencia,
                    venta.cantidad,
                    venta.comprador,
                    venta.estado,
                    venta.seguimiento,
                    venta.fecha,
                    venta.producto_id,
                ),
            )
        registrar_evento(conn, usuario_id, "mercado.guardar", f"{lectura.nombre_archivo}|{len(lectura.ventas)} ventas")
        return lote_id


def anular(base: BaseDatos, lote_id: int, usuario_id: int, motivo: str) -> None:
    motivo = motivo.strip()
    if not motivo:
        raise ReglaError("La anulación necesita un motivo.")
    with base.transaccion() as conn:
        _exigir_rol(conn, usuario_id)
        fila = conn.execute("SELECT anulado FROM lote_mercado WHERE id = ?", (lote_id,)).fetchone()
        if fila is None or fila["anulado"]:
            raise ReglaError("Ese lote ya no se puede anular.")
        conn.execute(
            """
            UPDATE lote_mercado
            SET anulado = 1, motivo_anulacion = ?, anulado_por = ?
            WHERE id = ?
            """,
            (motivo, usuario_id, lote_id),
        )
        registrar_evento(conn, usuario_id, "mercado.anular", f"{lote_id}|{motivo}")


def listar(base: BaseDatos):
    return base.conn.execute(
        """
        SELECT l.id, l.fecha, l.nombre_archivo, l.ventas, l.unidades, l.cargado_en, l.anulado,
               u.nombre AS cargo
        FROM lote_mercado l
        JOIN usuario u ON u.id = l.cargado_por
        ORDER BY l.id DESC
        """
    ).fetchall()


def _exigir_rol(conn, usuario_id: int) -> None:
    rol = conn.execute("SELECT rol FROM usuario WHERE id = ?", (usuario_id,)).fetchone()
    if rol is None or rol["rol"] not in ROLES:
        raise ReglaError("Solo Mercado Libre carga este export.")


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")
