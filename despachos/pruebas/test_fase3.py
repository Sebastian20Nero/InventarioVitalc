"""EFFI y MasterShop entran por Excel. La relación de despacho no es el corte."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

from despachos.db import BaseDatos
from despachos.lectores_excel import partir_contenido, revisar_excel, resolver_transportadora
from despachos.servicios import aplicar_equivalencias, asociar_producto, crear_producto, guardar_corte


def _libro(ruta: Path, encabezados: list[str], filas: list[list]) -> None:
    libro = Workbook()
    hoja = libro.active
    hoja.append(encabezados)
    for fila in filas:
        hoja.append(fila)
    libro.save(ruta)


class Fase3Pruebas(unittest.TestCase):
    def test_parte_el_contenido_libre_y_la_transportadora_mezclada(self) -> None:
        self.assertEqual(partir_contenido("1 * COMBO ADVANCE."), (1, "COMBO ADVANCE"))
        self.assertEqual(resolver_transportadora("COORDINADORA EFFI | CON RECAUDO | FLETE CRÉDITO"), "COORDINADORA")
        self.assertEqual(resolver_transportadora("INTERRAPIDISIMO"), "INTERRAPIDISIMO")

    def test_effi_separa_transportadoras_y_no_usa_la_relacion_como_corte(self) -> None:
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = Path(carpeta) / "effi.xlsx"
            _libro(
                ruta,
                ["Guía transportadora", "ID guía", "Transportadora", "Relación de despacho", "Contenido", "Ciudad", "Estado"],
                [
                    ["1001", "55", "COORDINADORA EFFI | CON RECAUDO | FLETE CRÉDITO", "REL-9", "1 * COMBO ADVANCE.", "BOGOTA", "ENTREGADA"],
                    ["1002", "56", "INTERRAPIDISIMO", "REL-9", "2 * TE CHINO", "MEDELLIN", "GUIA GENERADA"],
                ],
            )
            revisiones = revisar_excel(ruta, "EFFI", "2026-09-30")
        self.assertEqual(len(revisiones), 2)
        por_transportadora = {revision.transportadora: revision for revision in revisiones}
        self.assertEqual(por_transportadora["COORDINADORA"].guias[0].relacion_despacho, "REL-9")
        self.assertEqual(por_transportadora["COORDINADORA"].guias[0].numero, "1001")
        self.assertEqual(por_transportadora["COORDINADORA"].resumen[0].cantidad, 1)
        self.assertEqual(por_transportadora["COORDINADORA"].resumen[0].nombre, "COMBO ADVANCE")
        self.assertTrue(any("no el número de corte" in aviso for aviso in por_transportadora["INTERRAPIDISIMO"].avisos))

    def test_mastershop_homologa_por_producto_y_se_puede_guardar(self) -> None:
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = Path(carpeta) / "master.xlsx"
            _libro(
                ruta,
                ["N° de Guía", "Producto", "Cantidad", "Transportadora", "Ciudad"],
                [["9001", "COLAGENO", 3, "COORDINADORA", "CALI"]],
            )
            revision = revisar_excel(ruta, "MasterShop", "2026-09-30")[0]
            base = BaseDatos(Path(carpeta) / "despachos.db")
            try:
                producto_id = crear_producto(base, 1, "COL", "COLAGENO")
                aplicar_equivalencias(base, revision)
                self.assertTrue(revision.bloqueos)
                asociar_producto(base, 1, "", revision.resumen[0].id_dropi, "COLAGENO", producto_id, "MasterShop")
                aplicar_equivalencias(base, revision)
                self.assertFalse(any(item.startswith("Faltan") for item in revision.bloqueos))
                corte_id = guardar_corte(base, revision, 1, 1, True)
                guardado = base.conn.execute("SELECT plataforma FROM corte WHERE id = ?", (corte_id,)).fetchone()
                self.assertEqual(guardado["plataforma"], "MasterShop")
            finally:
                base.cerrar()

    def test_sin_columnas_conocidas_no_guarda_nada(self) -> None:
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = Path(carpeta) / "otro.xlsx"
            _libro(ruta, ["Foo", "Bar"], [["a", "b"]])
            revision = revisar_excel(ruta, "EFFI")[0]
        self.assertTrue(revision.bloqueos)
        self.assertIn("Faltan columnas", revision.bloqueos[0])
        self.assertEqual(revision.guias, [])
