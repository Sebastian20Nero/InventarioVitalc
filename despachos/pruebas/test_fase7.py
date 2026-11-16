"""Mercado Libre entra por su export. La clave es el título, no el SKU."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

from despachos.db import BaseDatos
from despachos.lector_mercado import revisar_ventas
from despachos.mercado import anular, guardar, preparar
from despachos.servicios import ReglaError, asociar_producto, crear_producto


def _libro(ruta: Path, encabezados: list[str], filas: list[list]) -> None:
    libro = Workbook()
    hoja = libro.active
    hoja.append(encabezados)
    for fila in filas:
        hoja.append(fila)
    libro.save(ruta)


class Fase7Pruebas(unittest.TestCase):
    def setUp(self) -> None:
        self.temporal = tempfile.TemporaryDirectory()
        self.base = BaseDatos(Path(self.temporal.name) / "despachos.db")
        self.mercado = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'mercadolibre'").fetchone()["id"]
        self.admin = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'admin'").fetchone()["id"]
        self.coordinacion = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'coordinacion'").fetchone()["id"]
        self.producto = crear_producto(self.base, self.admin, "ML1", "Colágeno")

    def tearDown(self) -> None:
        self.base.cerrar()
        self.temporal.cleanup()

    def test_sin_sku_asocia_el_titulo_y_no_repite_el_archivo(self) -> None:
        ruta = Path(self.temporal.name) / "ventas.xlsx"
        _libro(
            ruta,
            ["# de venta", "Título de la publicación", "Unidades", "SKU", "Comprador", "Fecha de venta"],
            [
                [2001, "COLAGENO", 2, "OTRO-SKU", "Ana", "2026-10-01"],
                [2001, "TE CHINO", 1, "TAMPOCO", "Ana", "2026-10-01"],
            ],
        )
        lectura = revisar_ventas(ruta)
        self.assertEqual(len(lectura.ventas), 2)
        self.assertEqual(lectura.unidades, 3)
        self.assertEqual(lectura.resumen[0].sku, "")
        self.assertNotIn("otro-sku", {item.id_dropi for item in lectura.resumen})
        self.assertTrue(any("SKU" in aviso for aviso in lectura.avisos))
        lectura = preparar(self.base, lectura)
        self.assertTrue(lectura.bloqueos)
        asociar_producto(self.base, self.mercado, "", "colageno", "COLAGENO", self.producto, "MercadoLibre")
        te = crear_producto(self.base, self.admin, "ML2", "Té")
        asociar_producto(self.base, self.mercado, "", "te chino", "TE CHINO", te, "MercadoLibre")
        lectura = preparar(self.base, lectura)
        self.assertFalse([bloqueo for bloqueo in lectura.bloqueos if bloqueo.startswith("Faltan")])
        with self.assertRaises(ReglaError):
            guardar(self.base, lectura, self.mercado, False, "2026-10-01")
        with self.assertRaises(ReglaError) as rol:
            guardar(self.base, lectura, self.coordinacion, True, "2026-10-01")
        self.assertIn("Mercado Libre", str(rol.exception))
        lote_id = guardar(self.base, lectura, self.mercado, True, "2026-10-01")
        guardadas = self.base.conn.execute("SELECT numero, cantidad FROM venta_mercado WHERE lote_id = ? ORDER BY id", (lote_id,)).fetchall()
        self.assertEqual([fila["numero"] for fila in guardadas], ["2001", "2001"])
        self.assertEqual(sum(fila["cantidad"] for fila in guardadas), 3)
        with self.assertRaises(ReglaError):
            guardar(self.base, revisar_ventas(ruta), self.mercado, True, "2026-10-01")
        anular(self.base, lote_id, self.mercado, "Se cargó el archivo equivocado")
        fila = self.base.conn.execute("SELECT anulado FROM lote_mercado WHERE id = ?", (lote_id,)).fetchone()
        self.assertEqual(fila["anulado"], 1)
        self.assertEqual(self.base.conn.execute("SELECT COUNT(*) AS n FROM venta_mercado").fetchone()["n"], 2)

    def test_columnas_que_faltan_no_dejan_guardar(self) -> None:
        ruta = Path(self.temporal.name) / "incompleto.xlsx"
        _libro(ruta, ["Comprador", "Estado"], [["Ana", "Entregado"]])
        lectura = revisar_ventas(ruta)
        self.assertTrue(lectura.bloqueos)
        self.assertIn("Comprador", lectura.bloqueos[0])
        with self.assertRaises(ReglaError):
            guardar(self.base, lectura, self.mercado, True, "2026-10-01")
