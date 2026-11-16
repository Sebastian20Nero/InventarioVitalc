"""La persona que pide una garantía no puede autorizarla."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from despachos.db import BaseDatos
from despachos.garantias import anular, autorizar, entregar, rechazar, solicitar
from despachos.servicios import ReglaError, crear_producto


class Fase4Pruebas(unittest.TestCase):
    def setUp(self) -> None:
        self.temporal = tempfile.TemporaryDirectory()
        self.base = BaseDatos(Path(self.temporal.name) / "despachos.db")
        self.garantias = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'garantias'").fetchone()["id"]
        self.admin = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'admin'").fetchone()["id"]
        self.producto = crear_producto(self.base, self.admin, "GAR", "Producto de garantía")

    def tearDown(self) -> None:
        self.base.cerrar()
        self.temporal.cleanup()

    def test_quien_solicita_no_autoriza_y_solo_se_entrega_despues(self) -> None:
        salida_id = solicitar(
            self.base, self.garantias, "GARANTIA", "Llegó dañado", "Cliente Pérez", self.producto, 1
        )
        with self.assertRaises(ReglaError) as contexto:
            autorizar(self.base, salida_id, self.garantias)
        self.assertIn("no puede autorizarla", str(contexto.exception))
        with self.assertRaises(ReglaError):
            entregar(self.base, salida_id, self.admin)
        autorizar(self.base, salida_id, self.admin)
        entregar(self.base, salida_id, self.garantias)
        estado = self.base.conn.execute("SELECT estado FROM salida_sin_costo WHERE id = ?", (salida_id,)).fetchone()
        self.assertEqual(estado["estado"], "entregada")

    def test_el_rechazo_deja_motivo_y_no_borra_la_salida(self) -> None:
        salida_id = solicitar(
            self.base, self.admin, "CONTENIDO", "Video de redes", "Community", self.producto, 2
        )
        with self.assertRaises(ReglaError):
            rechazar(self.base, salida_id, self.admin, "No corresponde")
        rechazar(self.base, salida_id, self.garantias, "No corresponde")
        fila = self.base.conn.execute("SELECT estado, motivo_rechazo, anulado FROM salida_sin_costo WHERE id = ?", (salida_id,)).fetchone()
        self.assertEqual(fila["estado"], "rechazada")
        self.assertEqual(fila["motivo_rechazo"], "No corresponde")
        self.assertEqual(fila["anulado"], 0)
        with self.assertRaises(ReglaError):
            anular(self.base, salida_id, self.garantias, "Ya no sale")
