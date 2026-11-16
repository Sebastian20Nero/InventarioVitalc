"""Excel de control: valores, nunca fórmulas. Mismo maestro en todas las hojas."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from openpyxl import Workbook, load_workbook

from despachos.auditoria import registrar
from despachos.db import BaseDatos
from despachos.parser_dropi import reconstruir_codigo
from despachos.servicios import ReglaError

HOJAS = ("ENVIA", "DERROCHA", "INTER", "JAM DRIVE", "TCC", "DOMINA", "99 MINUTOS", "VELOCES", "COORDINADORA")
CORTES = tuple(range(1, 7))


def exportar_excel(base: BaseDatos, fecha: str, destino: Path, usuario_id: int) -> Path:
    destino = Path(destino)
    with base.transaccion() as conn:
        productos = conn.execute(
            "SELECT id, codigo_interno, nombre FROM producto WHERE activo = 1 ORDER BY nombre"
        ).fetchall()
        cantidades = _cantidades(conn, fecha)
        represados = _represados(conn, fecha)
        libro = Workbook()
        hoja_inicial = libro.active
        libro.remove(hoja_inicial)
        for nombre in HOJAS:
            _hoja_transportadora(libro.create_sheet(nombre), productos, cantidades.get(nombre, {}), represados.get(nombre, []))
        _hoja_corte(libro.create_sheet("CORTE"), productos, cantidades)
        _hoja_represado(libro.create_sheet("RESPRESADO"), productos, represados)
        libro.save(destino)
        registrar(conn, usuario_id, "exportar.excel", f"{fecha}|{destino.name}")
    return destino


def _cantidades(conn: sqlite3.Connection, fecha: str) -> dict[str, dict[int, dict[int, int]]]:
    filas = conn.execute(
        """
        SELECT t.nombre AS transportadora, c.numero, a.producto_id, a.cantidad
        FROM alistamiento a
        JOIN corte c ON c.id = a.corte_id
        JOIN transportadora t ON t.id = c.transportadora_id
        WHERE c.fecha = ? AND c.anulado = 0
        """,
        (fecha,),
    ).fetchall()
    salida: dict[str, dict[int, dict[int, int]]] = {}
    for fila in filas:
        por_corte = salida.setdefault(fila["transportadora"], {}).setdefault(fila["numero"], {})
        por_corte[fila["producto_id"]] = por_corte.get(fila["producto_id"], 0) + fila["cantidad"]
    return salida


def _represados(conn: sqlite3.Connection, fecha: str) -> dict[str, list[str]]:
    filas = conn.execute(
        """
        SELECT t.nombre AS transportadora, g.numero
        FROM represado r
        JOIN guia g ON g.id = r.guia_id
        JOIN corte c ON c.id = g.corte_id
        JOIN transportadora t ON t.id = c.transportadora_id
        WHERE c.fecha = ? AND c.anulado = 0 AND r.anulado = 0
        ORDER BY g.numero
        """,
        (fecha,),
    ).fetchall()
    salida: dict[str, list[str]] = {}
    for fila in filas:
        salida.setdefault(fila["transportadora"], []).append(fila["numero"])
    return salida


def _hoja_transportadora(hoja, productos, por_corte: dict[int, dict[int, int]], guias_represadas: list[str]) -> None:
    hoja.append(
        ["Código", "PRODUCTO", *[f"CORTE {numero}" for numero in CORTES], "TOTAL", "PRODUCTO REPRESADO", "GUIAS REPRESADAS"]
    )
    guias = ", ".join(guias_represadas)
    for indice, producto in enumerate(productos):
        valores = [por_corte.get(numero, {}).get(producto["id"], 0) for numero in CORTES]
        hoja.append(
            [
                producto["codigo_interno"],
                producto["nombre"],
                *valores,
                sum(valores),
                len(guias_represadas) if indice == 0 and guias_represadas else None,
                guias if indice == 0 else None,
            ]
        )


def _hoja_corte(hoja, productos, cantidades: dict[str, dict[int, dict[int, int]]]) -> None:
    hoja.append(["Código", "PRODUCTO", *HOJAS, "TOTAL", *[f"TOTAL CORTE {numero}" for numero in range(1, 6)]])
    for producto in productos:
        por_transportadora = []
        for nombre in HOJAS:
            total = sum(cantidades.get(nombre, {}).get(numero, {}).get(producto["id"], 0) for numero in CORTES)
            por_transportadora.append(total)
        por_corte = []
        for numero in range(1, 6):
            por_corte.append(
                sum(cantidades.get(nombre, {}).get(numero, {}).get(producto["id"], 0) for nombre in HOJAS)
            )
        hoja.append([producto["codigo_interno"], producto["nombre"], *por_transportadora, sum(por_transportadora), *por_corte])


def _hoja_represado(hoja, productos, represados: dict[str, list[str]]) -> None:
    encabezado = ["Código", "PRODUCTO"]
    for nombre in HOJAS:
        encabezado.extend([f"{nombre} P", f"{nombre} G"])
    hoja.append(encabezado)
    for indice, producto in enumerate(productos):
        celdas = []
        for nombre in HOJAS:
            guias = represados.get(nombre, [])
            if indice == 0 and guias:
                celdas.extend([len(guias), ", ".join(guias)])
            else:
                celdas.extend([None, None])
        hoja.append([producto["codigo_interno"], producto["nombre"], *celdas])


def importar_maestro(base: BaseDatos, ruta: Path, usuario_id: int) -> int:
    libro = load_workbook(ruta, data_only=True)
    vistos: set[str] = set()
    creados = 0
    with base.transaccion() as conn:
        for hoja in libro.worksheets:
            encabezados = [str(celda.value).strip().upper() if celda.value else "" for celda in next(hoja.iter_rows(max_row=1))]
            if "PRODUCTO" not in encabezados:
                continue
            columna_codigo = _columna(encabezados, "CÓDIGO", "CODIGO")
            if columna_codigo is None:
                continue
            columna_nombre = encabezados.index("PRODUCTO")
            for fila in hoja.iter_rows(min_row=2, values_only=True):
                codigo = reconstruir_codigo(fila[columna_codigo] if columna_codigo is not None else "")
                nombre = str(fila[columna_nombre]).strip() if fila[columna_nombre] else ""
                if not codigo or not nombre or codigo in vistos or nombre.upper() == "NONE":
                    continue
                vistos.add(codigo)
                existente = conn.execute("SELECT id FROM producto WHERE codigo_interno = ?", (codigo,)).fetchone()
                if existente:
                    conn.execute("UPDATE producto SET nombre = ?, activo = 1 WHERE id = ?", (nombre, existente["id"]))
                else:
                    conn.execute(
                        "INSERT INTO producto (codigo_interno, nombre, es_fisico, activo) VALUES (?, ?, 1, 1)",
                        (codigo, nombre),
                    )
                    creados += 1
        registrar(conn, usuario_id, "maestro.importar", f"{ruta.name}|{len(vistos)} productos")
    return len(vistos)


def _columna(encabezados: list[str], *opciones: str) -> int | None:
    for opcion in opciones:
        if opcion in encabezados:
            return encabezados.index(opcion)
    return None


def consultar_movimiento(base: BaseDatos, desde: str, hasta: str) -> dict[str, list]:
    if desde > hasta:
        raise ReglaError("La fecha inicial no puede ser posterior a la final.")
    conn = base.conn
    return {
        "cortes": conn.execute(
            """
            SELECT c.fecha, c.numero, c.plataforma, c.estado, t.nombre AS transportadora,
                (SELECT COUNT(*) FROM guia g WHERE g.corte_id = c.id) AS guias,
                (SELECT COALESCE(SUM(cantidad), 0) FROM alistamiento a WHERE a.corte_id = c.id) AS unidades
            FROM corte c
            JOIN transportadora t ON t.id = c.transportadora_id
            WHERE c.fecha BETWEEN ? AND ? AND c.anulado = 0
            ORDER BY c.fecha, t.orden, c.numero
            """,
            (desde, hasta),
        ).fetchall(),
        "garantias": conn.execute(
            """
            SELECT substr(s.solicitado_en, 1, 10) AS fecha, s.tipo, s.destinatario, s.cantidad,
                s.estado, s.anulado, p.nombre AS producto, u.nombre AS solicito
            FROM salida_sin_costo s
            JOIN producto p ON p.id = s.producto_id
            JOIN usuario u ON u.id = s.solicitado_por
            WHERE substr(s.solicitado_en, 1, 10) BETWEEN ? AND ?
            ORDER BY s.id
            """,
            (desde, hasta),
        ).fetchall(),
        "devoluciones": conn.execute(
            """
            SELECT substr(d.recibido_en, 1, 10) AS fecha, d.guia_origen, d.anulado, u.nombre AS recibio,
                COALESCE(SUM(l.cantidad), 0) AS cantidad,
                GROUP_CONCAT(p.nombre || ' x ' || l.cantidad, '; ') AS lineas
            FROM devolucion d
            JOIN usuario u ON u.id = d.recibido_por
            JOIN devolucion_linea l ON l.devolucion_id = d.id
            JOIN producto p ON p.id = l.producto_id
            WHERE substr(d.recibido_en, 1, 10) BETWEEN ? AND ?
            GROUP BY d.id
            ORDER BY d.id
            """,
            (desde, hasta),
        ).fetchall(),
        "muestras": conn.execute(
            """
            SELECT substr(s.solicitado_en, 1, 10) AS fecha, s.tipo, s.pedido, s.destinatario,
                s.factura_numero, s.anulado, s.despachado_en, s.validado_en,
                COALESCE(SUM(l.cantidad), 0) AS cantidad
            FROM salida_muestra s
            JOIN salida_muestra_linea l ON l.salida_id = s.id
            WHERE substr(s.solicitado_en, 1, 10) BETWEEN ? AND ?
            GROUP BY s.id
            ORDER BY s.id
            """,
            (desde, hasta),
        ).fetchall(),
        "mercado": conn.execute(
            """
            SELECT substr(cargado_en, 1, 10) AS fecha, nombre_archivo, ventas, unidades, anulado
            FROM lote_mercado
            WHERE substr(cargado_en, 1, 10) BETWEEN ? AND ?
            ORDER BY id
            """,
            (desde, hasta),
        ).fetchall(),
    }


def filas_del_dia(base: BaseDatos, fecha: str) -> list[list[str]]:
    datos = consultar_movimiento(base, fecha, fecha)
    filas: list[list[str]] = []
    for fila in datos["garantias"]:
        filas.append(["Garantía", fila["destinatario"], fila["producto"], str(fila["cantidad"]), _estado_garantia(fila)])
    for fila in datos["devoluciones"]:
        filas.append(["Devolución", fila["guia_origen"] or "Sin guía", fila["lineas"] or "", str(fila["cantidad"]), "Anulada" if fila["anulado"] else "Registrada"])
    for fila in datos["muestras"]:
        filas.append(["Muestra", fila["pedido"], fila["destinatario"], str(fila["cantidad"]), _estado_muestra(fila)])
    for fila in datos["mercado"]:
        filas.append(["Mercado Libre", fila["nombre_archivo"], "", str(fila["unidades"]), "Anulado" if fila["anulado"] else "Cargado"])
    return filas


def exportar_rango(base: BaseDatos, desde: str, hasta: str, destino: Path, usuario_id: int) -> Path:
    destino = Path(destino)
    datos = consultar_movimiento(base, desde, hasta)
    libro = Workbook()
    resumen = libro.active
    resumen.title = "RESUMEN"
    resumen.append(["Proceso", "Registros", "Unidades"])
    resumen.append(["Cortes", len(datos["cortes"]), sum(fila["unidades"] for fila in datos["cortes"])])
    resumen.append(["Garantías", len(datos["garantias"]), sum(fila["cantidad"] for fila in datos["garantias"])])
    resumen.append(["Devoluciones", len(datos["devoluciones"]), sum(fila["cantidad"] for fila in datos["devoluciones"])])
    resumen.append(["Muestras", len(datos["muestras"]), sum(fila["cantidad"] for fila in datos["muestras"])])
    resumen.append(["Mercado Libre", len(datos["mercado"]), sum(fila["unidades"] for fila in datos["mercado"])])
    cortes = libro.create_sheet("CORTES")
    cortes.append(["Fecha", "Corte", "Plataforma", "Transportadora", "Estado", "Guías", "Unidades"])
    for fila in datos["cortes"]:
        cortes.append([fila["fecha"], fila["numero"], fila["plataforma"], fila["transportadora"], fila["estado"], fila["guias"], fila["unidades"]])
    garantias = libro.create_sheet("GARANTIAS")
    garantias.append(["Fecha", "Tipo", "Destinatario", "Producto", "Cantidad", "Estado", "Solicitó"])
    for fila in datos["garantias"]:
        garantias.append([fila["fecha"], fila["tipo"], fila["destinatario"], fila["producto"], fila["cantidad"], _estado_garantia(fila), fila["solicito"]])
    devoluciones = libro.create_sheet("DEVOLUCIONES")
    devoluciones.append(["Fecha", "Guía", "Recibió", "Productos", "Cantidad", "Estado"])
    for fila in datos["devoluciones"]:
        devoluciones.append([fila["fecha"], fila["guia_origen"] or "Sin guía", fila["recibio"], fila["lineas"] or "", fila["cantidad"], "Anulada" if fila["anulado"] else "Registrada"])
    muestras = libro.create_sheet("MUESTRAS")
    muestras.append(["Fecha", "Tipo", "Pedido", "Destinatario", "Cantidad", "Factura", "Estado"])
    for fila in datos["muestras"]:
        muestras.append([fila["fecha"], fila["tipo"], fila["pedido"], fila["destinatario"], fila["cantidad"], fila["factura_numero"] or "", _estado_muestra(fila)])
    mercado = libro.create_sheet("MERCADO LIBRE")
    mercado.append(["Fecha de carga", "Archivo", "Ventas", "Unidades", "Estado"])
    for fila in datos["mercado"]:
        mercado.append([fila["fecha"], fila["nombre_archivo"], fila["ventas"], fila["unidades"], "Anulado" if fila["anulado"] else "Cargado"])
    with base.transaccion() as conn:
        libro.save(destino)
        registrar(conn, usuario_id, "exportar.rango", f"{desde}|{hasta}|{destino.name}")
    return destino


def _estado_garantia(fila) -> str:
    if fila["anulado"]:
        return "Anulada"
    return {"solicitada": "Solicitada", "autorizada": "Autorizada", "rechazada": "Rechazada", "entregada": "Entregada"}.get(fila["estado"], fila["estado"])


def _estado_muestra(fila) -> str:
    if fila["anulado"]:
        return "Anulado"
    if fila["despachado_en"]:
        return "Despachado"
    if fila["factura_numero"]:
        return "Factura validada"
    return "Sin factura"
