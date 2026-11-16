"""La muestra o el mayorista no sale hasta que la factura se escribe a mano."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from despachos.db import BaseDatos
from despachos.muestras import anular, despachar, registrar, validar_factura
from despachos.servicios import ReglaError, crear_producto


class Fase6Pruebas(unittest.TestCase):
    def setUp(self) -> None:
        self.temporal = tempfile.TemporaryDirectory()
        self.base = BaseDatos(Path(self.temporal.name) / "despachos.db")
        self.muestras = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'muestras'").fetchone()["id"]
        self.admin = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'admin'").fetchone()["id"]
        self.coordinacion = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'coordinacion'").fetchone()["id"]
        self.producto = crear_producto(self.base, self.admin, "MUE", "Muestra de prueba")

    def tearDown(self) -> None:
        self.base.cerrar()
        self.temporal.cleanup()

    def _pedido(self) -> int:
        return registrar(
            self.base,
            self.muestras,
            "MUESTRA",
            "PED-1",
            "Cliente de prueba",
            "",
            [{"producto_id": self.producto, "cantidad": 2}],
        )

    def test_no_sale_sin_factura_y_queda_quien_la_valido(self) -> None:
        salida_id = self._pedido()
        with self.assertRaises(ReglaError) as bloqueo:
            despachar(self.base, salida_id, self.muestras)
        self.assertIn("factura", str(bloqueo.exception).lower())
        validar_factura(self.base, salida_id, self.muestras, "FV-100")
        fila = self.base.conn.execute(
            "SELECT factura_numero, validado_por, validado_en FROM salida_muestra WHERE id = ?",
            (salida_id,),
        ).fetchone()
        self.assertEqual(fila["factura_numero"], "FV-100")
        self.assertEqual(fila["validado_por"], self.muestras)
        self.assertTrue(fila["validado_en"])
        despachar(self.base, salida_id, self.muestras)
        salida = self.base.conn.execute("SELECT despachado_en FROM salida_muestra WHERE id = ?", (salida_id,)).fetchone()
        self.assertTrue(salida["despachado_en"])

    def test_factura_repetida_otro_rol_y_anulacion(self) -> None:
        primera = self._pedido()
        validar_factura(self.base, primera, self.muestras, "FV-200")
        segunda = registrar(
            self.base,
            self.admin,
            "MAYORISTA",
            "PED-2",
            "Mayorista",
            "",
            [{"producto_id": self.producto, "cantidad": 1}],
        )
        with self.assertRaises(ReglaError):
            validar_factura(self.base, segunda, self.admin, "FV-200")
        with self.assertRaises(ReglaError):
            registrar(
                self.base,
                self.coordinacion,
                "MUESTRA",
                "PED-3",
                "Nadie",
                "",
                [{"producto_id": self.producto, "cantidad": 1}],
            )
        anular(self.base, segunda, self.muestras, "El pedido se canceló")
        fila = self.base.conn.execute("SELECT anulado FROM salida_muestra WHERE id = ?", (segunda,)).fetchone()
        self.assertEqual(fila["anulado"], 1)
        self.assertEqual(self.base.conn.execute("SELECT COUNT(*) AS n FROM salida_muestra").fetchone()["n"], 2)
        despachar(self.base, primera, self.muestras)
        with self.assertRaises(ReglaError):
            anular(self.base, primera, self.muestras, "Ya salió")
