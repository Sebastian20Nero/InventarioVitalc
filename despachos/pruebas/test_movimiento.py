"""El día y el rango reúnen cortes y los otros procesos. El Excel lleva valores."""

from __future__ import annotations

import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from openpyxl import load_workbook

from despachos.db import BaseDatos
from despachos.devoluciones import registrar as registrar_devolucion
from despachos.garantias import solicitar
from despachos.muestras import registrar as registrar_muestra
from despachos.reportes import consultar_movimiento, exportar_rango, filas_del_dia
from despachos.servicios import ReglaError, crear_producto


class MovimientoPruebas(unittest.TestCase):
    def setUp(self) -> None:
        self.temporal = tempfile.TemporaryDirectory()
        self.base = BaseDatos(Path(self.temporal.name) / "despachos.db")
        self.admin = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'admin'").fetchone()["id"]
        self.garantias = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'garantias'").fetchone()["id"]
        self.devoluciones = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'devoluciones'").fetchone()["id"]
        self.muestras = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'muestras'").fetchone()["id"]
        self.producto = crear_producto(self.base, self.admin, "MOV", "Producto del día")
        self.hoy = date.today().isoformat()
        self.ayer = (date.today() - timedelta(days=1)).isoformat()

    def tearDown(self) -> None:
        self.base.cerrar()
        self.temporal.cleanup()

    def test_el_dia_lista_los_otros_procesos_y_el_rango_no_usa_formulas(self) -> None:
        solicitar(self.base, self.garantias, "GARANTIA", "Caja rota", "Cliente", self.producto, 1)
        registrar_devolucion(
            self.base,
            self.devoluciones,
            "",
            "Volvió",
            [{"producto_id": self.producto, "cantidad": 2, "estado_producto": "bueno", "disposicion": "Reingresar", "evidencia": ""}],
        )
        muestra_id = registrar_muestra(
            self.base,
            self.muestras,
            "MUESTRA",
            "PED-9",
            "Farmacia",
            "",
            [{"producto_id": self.producto, "cantidad": 3}],
        )
        self.base.conn.execute(
            "UPDATE salida_muestra SET solicitado_en = ? WHERE id = ?",
            (f"{self.ayer}T08:00:00", muestra_id),
        )
        self.base.conn.commit()
        procesos = {fila[0] for fila in filas_del_dia(self.base, self.hoy)}
        self.assertEqual(procesos, {"Garantía", "Devolución"})
        self.assertEqual(filas_del_dia(self.base, self.ayer)[0][1], "PED-9")
        with self.assertRaises(ReglaError):
            consultar_movimiento(self.base, self.hoy, self.ayer)
        destino = Path(self.temporal.name) / "movimiento.xlsx"
        exportar_rango(self.base, self.ayer, self.hoy, destino, self.admin)
        libro = load_workbook(destino)
        self.assertEqual(libro.sheetnames, ["RESUMEN", "CORTES", "GARANTIAS", "DEVOLUCIONES", "MUESTRAS", "MERCADO LIBRE"])
        self.assertEqual(libro["RESUMEN"]["B3"].value, 1)
        self.assertEqual(libro["MUESTRAS"]["C2"].value, "PED-9")
        for hoja in libro.worksheets:
            for fila in hoja.iter_rows():
                for celda in fila:
                    self.assertFalse(isinstance(celda.value, str) and celda.value.startswith("="))
