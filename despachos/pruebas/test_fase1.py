"""Reglas de la Fase 1 que no dependen del PDF real ni de la interfaz."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook

from despachos.auditoria import verificar_cadena
from despachos.db import BaseDatos
from despachos.parser_dropi import (
    GuiaLeida,
    ResumenLeido,
    Revision,
    leer_guias_desde_palabras,
    leer_resumen,
    partir_resumen_y_rotulos,
    reconstruir_codigo,
)
from despachos.reportes import exportar_excel
from despachos.servicios import ReglaError, aplicar_equivalencias, asignar, asociar_producto, guardar_corte, marcar_etapa


def _palabra(texto: str, x: float, y: float) -> dict:
    return {"text": texto, "x0": x, "top": y}


class ParserPruebas(unittest.TestCase):
    def test_variante_a_numero_en_su_fila(self) -> None:
        palabras = [
            _palabra("Nro:", 35, 115),
            _palabra("1", 55, 115),
            _palabra("Ciudad", 171, 115),
            _palabra("Destino:", 220, 115),
            _palabra("TIERRALTA", 260, 115),
            _palabra("240062419605", 75, 130),
            _palabra("249000.00", 490, 130),
            _palabra("RECAUDO", 612, 130),
        ]
        guias = leer_guias_desde_palabras(palabras)
        self.assertEqual(len(guias), 1)
        self.assertEqual(guias[0].numero, "240062419605")
        self.assertEqual(guias[0].consecutivo, 1)
        self.assertEqual(guias[0].ciudad, "TIERRALTA")
        self.assertEqual(guias[0].recaudo, "249000.00")

    def test_variante_b_numero_en_fila_de_valores(self) -> None:
        palabras = [
            _palabra("Nro:", 35, 100),
            _palabra("Ciudad", 171, 100),
            _palabra("MEDELLIN", 230, 100),
            _palabra("1", 35, 120),
            _palabra("240062419606", 75, 120),
            _palabra("1000.00", 490, 120),
            _palabra("RECAUDO", 612, 120),
        ]
        guias = leer_guias_desde_palabras(palabras)
        self.assertEqual(guias[0].consecutivo, 1)
        self.assertEqual(guias[0].numero, "240062419606")

    def test_variante_c_ciudad_partida(self) -> None:
        palabras = [
            _palabra("SAN", 171, 100),
            _palabra("JOSE", 200, 100),
            _palabra("2", 55, 110),
            _palabra("240062419607", 75, 130),
            _palabra("DEL", 171, 130),
            _palabra("GUAVIARE", 210, 130),
            _palabra("500.00", 490, 130),
        ]
        guias = leer_guias_desde_palabras(palabras)
        self.assertEqual(guias[0].ciudad, "SAN JOSE DEL GUAVIARE")

    def test_nombre_partido_y_sku_con_varios_id(self) -> None:
        texto = "\n".join(
            [
                "ENVIO EXPRESS",
                "30",
                "ASEGURADO",
                "13MAG154 13MAG154 MULTI COLAGENO 68",
                "13MAG154 12CUT349 TE CHINO 60",
                "22DEL091 LYMPHATIC DRAINAGE 60",
            ]
        )
        resumen = leer_resumen(texto)
        nombres = {item.nombre: item.cantidad for item in resumen}
        self.assertEqual(nombres["ENVIO EXPRESS ASEGURADO"], 30)
        ids = {item.id_dropi for item in resumen}
        self.assertIn("13MAG154", ids)
        self.assertIn("12CUT349", ids)
        self.assertIn("22DEL091", ids)

    def test_el_corte_del_resumen_es_por_pagina(self) -> None:
        paginas = [
            "SKU ID NOMBRE CANTIDAD\n13MAG154 13MAG154 AGUAJE 68",
            "HORARIO 8:00 RUTA NORTE\nGUIA: 240062419605\nTIERRALTA",
        ]
        resumen, rotulos = partir_resumen_y_rotulos(paginas)
        self.assertIn("AGUAJE", resumen)
        self.assertNotIn("TIERRALTA", resumen)
        self.assertIn("240062419605", rotulos)

    def test_reconstruye_notacion_cientifica(self) -> None:
        self.assertEqual(reconstruir_codigo("1,77086E+13"), "17708600000000")
        self.assertEqual(reconstruir_codigo(17708600000000), "17708600000000")


class ReglasPruebas(unittest.TestCase):
    def setUp(self) -> None:
        self.temporal = tempfile.TemporaryDirectory()
        self.base = BaseDatos(Path(self.temporal.name) / "despachos.db")
        self.coordinacion = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'coordinacion'").fetchone()["id"]
        self.admin = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'admin'").fetchone()["id"]
        self.alistador1 = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'alistador1'").fetchone()["id"]
        self.alistador2 = self.base.conn.execute("SELECT id FROM usuario WHERE usuario = 'alistador2'").fetchone()["id"]

    def tearDown(self) -> None:
        self.base.cerrar()
        self.temporal.cleanup()

    def _revision(self, huella: str = "a" * 64, guia: str = "240062419605") -> Revision:
        return Revision(
            transportadora="INTERRAPIDISIMO",
            fecha="2026-09-30",
            guias=[GuiaLeida(1, guia, "TIERRALTA", "249000.00", "RECAUDO", "ROTULO")],
            resumen=[ResumenLeido("13MAG154", "13MAG154", "AGUAJE", 68)],
            huella=huella,
            nombre_archivo="manifiesto.pdf",
            lector_verificado=True,
        )

    def _asociar(self, revision: Revision) -> None:
        producto = self.base.conn.execute("INSERT INTO producto (codigo_interno, nombre) VALUES ('AGJ', 'AGUAJE')").lastrowid
        self.base.conn.commit()
        asociar_producto(self.base, self.coordinacion, "13MAG154", "13MAG154", "AGUAJE", int(producto))
        aplicar_equivalencias(self.base, revision)

    def test_pdf_repetido_bloquea_y_guia_de_otro_corte_solo_avisa(self) -> None:
        primera = self._revision()
        self._asociar(primera)
        guardar_corte(self.base, primera, 1, self.coordinacion, True)
        repetida = self._revision()
        aplicar_equivalencias(self.base, repetida)
        self.assertTrue(any(mensaje.startswith("Este manifiesto ya fue cargado") for mensaje in repetida.bloqueos))
        otra = self._revision(huella="b" * 64)
        aplicar_equivalencias(self.base, otra)
        self.assertFalse(otra.bloqueos)
        self.assertTrue(any("Puedes continuar" in mensaje for mensaje in otra.avisos))

    def test_quien_carga_no_se_asigna_salvo_administrador(self) -> None:
        revision = self._revision()
        self._asociar(revision)
        corte_id = guardar_corte(self.base, revision, 1, self.alistador1, True)
        with self.assertRaises(ReglaError) as contexto:
            asignar(self.base, corte_id, [self.alistador1], self.coordinacion)
        self.assertIn("no puede alistarlo", str(contexto.exception))
        asignar(self.base, corte_id, [self.alistador1], self.admin)
        asignar(self.base, corte_id, [self.alistador2], self.coordinacion)
        filas = self.base.conn.execute("SELECT usuario_id FROM asignacion WHERE corte_id = ?", (corte_id,)).fetchall()
        self.assertEqual({fila["usuario_id"] for fila in filas}, {self.alistador1, self.alistador2})

    def test_etapas_en_orden_y_la_cadena_detecta_un_cambio(self) -> None:
        revision = self._revision()
        self._asociar(revision)
        corte_id = guardar_corte(self.base, revision, 1, self.coordinacion, True)
        asignar(self.base, corte_id, [self.alistador1], self.coordinacion)
        alistamiento_id = self.base.conn.execute("SELECT id FROM alistamiento WHERE corte_id = ?", (corte_id,)).fetchone()["id"]
        with self.assertRaises(ReglaError) as contexto:
            marcar_etapa(self.base, alistamiento_id, "empacado", self.alistador1, True)
        self.assertIn("etapa anterior", str(contexto.exception))
        marcar_etapa(self.base, alistamiento_id, "revisado", self.alistador1, True)
        marcar_etapa(self.base, alistamiento_id, "embolsado", self.alistador1, True)
        marcar_etapa(self.base, alistamiento_id, "revisado", self.alistador1, False)
        fila = self.base.conn.execute("SELECT revisado, embolsado FROM alistamiento WHERE id = ?", (alistamiento_id,)).fetchone()
        self.assertEqual((fila["revisado"], fila["embolsado"]), (0, 0))
        integra, _mensaje = verificar_cadena(self.base.conn)
        self.assertTrue(integra)
        self.base.conn.execute("UPDATE auditoria SET detalle = 'alterado' WHERE id = (SELECT MIN(id) FROM auditoria)")
        self.base.conn.commit()
        integra, mensaje = verificar_cadena(self.base.conn)
        self.assertFalse(integra)
        self.assertIn("fila", mensaje)

    def test_excel_no_lleva_formulas(self) -> None:
        revision = self._revision()
        self._asociar(revision)
        guardar_corte(self.base, revision, 1, self.coordinacion, True)
        destino = Path(self.temporal.name) / "corte.xlsx"
        exportar_excel(self.base, "2026-09-30", destino, self.coordinacion)
        libro = load_workbook(destino)
        self.assertIn("INTER", libro.sheetnames)
        self.assertIn("RESPRESADO", libro.sheetnames)
        for hoja in libro.worksheets:
            for fila in hoja.iter_rows():
                for celda in fila:
                    if celda.value is None:
                        continue
                    self.assertNotEqual(celda.data_type, "f")
                    self.assertFalse(str(celda.value).startswith("="))


if __name__ == "__main__":
    unittest.main()
