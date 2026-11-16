"""La devolución es una entrada. Se vincula a la guía cuando existe y se guarda igual si no."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from despachos.db import BaseDatos
from despachos.devoluciones import anular, buscar_guia, registrar
from despachos.parser_dropi import GuiaLeida, ResumenLeido, Revision
from despachos.servicios import ReglaError, aplicar_equivalencias, asociar_producto, crear_producto, guardar_corte


class Fase5Pruebas(unittest.TestCase):
    def setUp(self) -> None:
        self.temporal = tempfile.TemporaryDirectory()
        self.base = BaseDatos(Path(self.temporal.name) / "despachos.db")
        self.devoluciones = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'devoluciones'").fetchone()["id"]
        self.admin = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'admin'").fetchone()["id"]
        self.coordinacion = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'coordinacion'").fetchone()["id"]
        self.producto = crear_producto(self.base, self.admin, "DEV", "Producto devuelto")

    def tearDown(self) -> None:
        self.base.cerrar()
        self.temporal.cleanup()

    def _corte(self) -> None:
        revision = Revision(
            transportadora="INTERRAPIDISIMO",
            fecha="2026-09-30",
            guias=[GuiaLeida(1, "240062419605", "TIERRALTA", "100.00", "RECAUDO")],
            resumen=[ResumenLeido("", "dev", "Producto devuelto", 1)],
            huella="d" * 64,
            nombre_archivo="dev.pdf",
            lector_verificado=True,
        )
        asociar_producto(self.base, self.coordinacion, "", "dev", "Producto devuelto", self.producto, "DROPI")
        aplicar_equivalencias(self.base, revision)
        # La clave DROPI es la pareja sku + id. Esta revisión usa id "dev" y sku vacío.
        revision.resumen[0].producto_id = self.producto
        revision.bloqueos = [mensaje for mensaje in revision.bloqueos if not mensaje.startswith("Faltan")]
        guardar_corte(self.base, revision, 1, self.coordinacion, True)

    def test_vincula_la_guia_conocida_y_acepta_una_sin_corte(self) -> None:
        self._corte()
        hallada = buscar_guia(self.base, "240062419605")
        self.assertEqual(hallada["corte"], 1)
        con_guia = registrar(
            self.base,
            self.devoluciones,
            "240062419605",
            "Volvió completa",
            [{"producto_id": self.producto, "cantidad": 1, "estado_producto": "bueno", "disposicion": "Reingresar", "evidencia": "Foto 1"}],
        )
        guia_id = self.base.conn.execute("SELECT guia_id FROM devolucion WHERE id = ?", (con_guia,)).fetchone()["guia_id"]
        self.assertIsNotNone(guia_id)
        sin_guia = registrar(
            self.base,
            self.devoluciones,
            "",
            "Llegó sin remisión",
            [{"producto_id": self.producto, "cantidad": 2, "estado_producto": "novedad", "disposicion": "Separar", "evidencia": "Caja rota"}],
        )
        fila = self.base.conn.execute("SELECT guia_id, estado_producto FROM devolucion d JOIN devolucion_linea l ON l.devolucion_id = d.id WHERE d.id = ?", (sin_guia,)).fetchone()
        self.assertIsNone(fila["guia_id"])
        self.assertEqual(fila["estado_producto"], "novedad")

    def test_anular_conserva_la_fila_y_otro_rol_no_registra(self) -> None:
        devolucion_id = registrar(
            self.base,
            self.devoluciones,
            "999",
            "Parcial",
            [{"producto_id": self.producto, "cantidad": 1, "estado_producto": "bueno", "disposicion": "Revisar", "evidencia": ""}],
        )
        with self.assertRaises(ReglaError):
            registrar(self.base, self.coordinacion, "", "", [{"producto_id": self.producto, "cantidad": 1, "estado_producto": "bueno", "disposicion": "Revisar", "evidencia": ""}])
        anular(self.base, devolucion_id, self.devoluciones, "Se registró dos veces")
        fila = self.base.conn.execute("SELECT anulado, motivo_anulacion FROM devolucion WHERE id = ?", (devolucion_id,)).fetchone()
        self.assertEqual(fila["anulado"], 1)
        self.assertEqual(fila["motivo_anulacion"], "Se registró dos veces")
        self.assertEqual(self.base.conn.execute("SELECT COUNT(*) AS n FROM devolucion").fetchone()["n"], 1)
