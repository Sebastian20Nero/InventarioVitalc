"""Escaneo, represados y cierre. El prefijo de la pistola se configura, no se adivina."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from despachos.db import BaseDatos
from despachos.parser_dropi import GuiaLeida, ResumenLeido, Revision
from despachos.servicios import (
    ReglaError,
    aplicar_equivalencias,
    asociar_producto,
    cerrar_corte,
    definir_prefijo,
    escanear,
    guardar_corte,
    marcar_represada,
    normalizar_codigo,
    reprogramar,
)


class Fase2Pruebas(unittest.TestCase):
    def setUp(self) -> None:
        self.temporal = tempfile.TemporaryDirectory()
        self.base = BaseDatos(Path(self.temporal.name) / "despachos.db")
        self.despachador = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'despachador'").fetchone()["id"]
        self.coordinacion = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'coordinacion'").fetchone()["id"]
        self.corte_id = self._corte("a" * 64, "240062419605")
        self.otro_id = self._corte("b" * 64, "240062419606", numero=2)

    def tearDown(self) -> None:
        self.base.cerrar()
        self.temporal.cleanup()

    def _corte(self, huella: str, guia: str, numero: int = 1) -> int:
        revision = Revision(
            transportadora="INTERRAPIDISIMO",
            fecha="2026-09-30",
            guias=[GuiaLeida(numero, guia, "TIERRALTA", "100.00", "RECAUDO")],
            resumen=[ResumenLeido("13MAG154", "13MAG154", "AGUAJE", 1)],
            huella=huella,
            nombre_archivo=f"{huella[:6]}.pdf",
            lector_verificado=True,
        )
        producto = self.base.conn.execute("SELECT id FROM producto WHERE codigo_interno = 'AGJ'").fetchone()
        if producto is None:
            producto_id = self.base.conn.execute(
                "INSERT INTO producto (codigo_interno, nombre) VALUES ('AGJ', 'AGUAJE')"
            ).lastrowid
            self.base.conn.commit()
            asociar_producto(self.base, self.coordinacion, "13MAG154", "13MAG154", "AGUAJE", int(producto_id))
        aplicar_equivalencias(self.base, revision)
        return guardar_corte(self.base, revision, numero, self.coordinacion, True)

    def test_el_prefijo_se_retira_y_el_escaneo_repetido_no_suma(self) -> None:
        self.assertEqual(normalizar_codigo("INT240062419605", "INT"), "240062419605")
        transportadora = self.base.conn.execute("SELECT id FROM transportadora WHERE nombre = 'INTER'").fetchone()["id"]
        definir_prefijo(self.base, transportadora, "INT", self.despachador)
        primero = escanear(self.base, self.corte_id, "INT240062419605", self.despachador)
        self.assertEqual(primero["resultado"], "verificada")
        self.assertEqual(primero["verificadas"], 1)
        segundo = escanear(self.base, self.corte_id, "240062419605", self.despachador)
        self.assertEqual(segundo["resultado"], "repetido")
        self.assertEqual(segundo["verificadas"], 1)
        intentos = self.base.conn.execute("SELECT COUNT(*) AS n FROM escaneo").fetchone()["n"]
        self.assertEqual(intentos, 2)

    def test_guia_de_otro_corte_avisa_y_el_cierre_exige_motivo_si_falta_alistar(self) -> None:
        resultado = escanear(self.base, self.corte_id, "240062419606", self.despachador)
        self.assertEqual(resultado["resultado"], "otro_corte")
        self.assertIn("corte 2", resultado["mensaje"])
        escanear(self.base, self.corte_id, "240062419605", self.despachador)
        with self.assertRaises(ReglaError) as contexto:
            cerrar_corte(self.base, self.corte_id, self.despachador, "Ana", "ABC123", "18:00", "")
        self.assertIn("alistamiento", str(contexto.exception))
        cerrar_corte(self.base, self.corte_id, self.despachador, "Ana", "ABC123", "18:00", "Se entregó sin embolsar")
        estado = self.base.conn.execute("SELECT estado, auxiliar FROM corte WHERE id = ?", (self.corte_id,)).fetchone()
        self.assertEqual(estado["estado"], "cerrado")
        self.assertEqual(estado["auxiliar"], "Ana")

    def test_represar_y_reprogramar_conserva_el_vinculo(self) -> None:
        guia_id = self.base.conn.execute("SELECT id FROM guia WHERE corte_id = ?", (self.corte_id,)).fetchone()["id"]
        marcar_represada(self.base, guia_id, "No cupo en el vehículo", self.despachador)
        reprogramar(self.base, guia_id, self.otro_id, self.despachador)
        vinculo = self.base.conn.execute(
            "SELECT corte_reasignacion_id FROM represado WHERE guia_id = ?",
            (guia_id,),
        ).fetchone()
        self.assertEqual(vinculo["corte_reasignacion_id"], self.otro_id)
        with self.assertRaises(ReglaError):
            escanear(self.base, self.corte_id, "240062419605", self.coordinacion)
