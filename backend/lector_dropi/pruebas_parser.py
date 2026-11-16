"""Pruebas del lector de manifiestos DROPI.

Se prueba `parsear_texto`, que recibe el texto ya extraido. Asi las pruebas
corren sin necesitar un PDF y comprueban exactamente lo dificil: las rarezas
del formato.

Las rarezas que se verifican, todas tomadas del caso real:
  - SKU vacio: «(SKU: )»
  - nombre partido en dos lineas con la cantidad en medio
  - un mismo SKU con dos ID y dos nombres distintos
  - espacios variables entre campos
  - una guia con rotulo que no figura en el manifiesto

Ejecutar:
    python pruebas_parser.py
"""

from __future__ import annotations

import sys
from datetime import date

from parser_dropi import parsear_texto

# ── Manifiesto de ejemplo ────────────────────────────────────────────────────

PAGINA_MANIFIESTO = """TRANSPORTADORA: INTERRAPIDISIMO
RELACION DE GUÍAS IMPRESAS – FECHA MANIFIESTO (DD/MM/YYYY): 30-09-2026

Nro: 1 | Guia: 240062419605 | Ciudad Destino: TIERRALTA | Valor de Recaudo: 249000.00 | Tipo de logistica: CON RECAUDO
Nro: 2 | Guia: 240062417872 | Ciudad Destino: MEDELLIN | Valor de Recaudo: 0.00 | Tipo de logistica: SIN RECAUDO
Nro:3|Guia:240062411111|Ciudad Destino: BOGOTA D.C.|Valor de Recaudo:135.500,00|Tipo de logistica: CON RECAUDO

NOMBRE DE AUXILIAR
PLACA DEL VEHICULO
FIRMA DE AUXILIAR
"""

PAGINA_RESUMEN = """PRODUCTOS FECHA MANIFIESTO
Nombre Cantidad
(ID: 1924139) - (SKU: 23AGU007) - AGUAJE.PV julio    68
(ID: 1924140) - (SKU: 13MAG154) - MAGNESIO 12 IN 1 COMPLEX RNLD 25
(ID: 1988001) - (SKU: 13MAG154) - MAGNESIUM 12 IN 1 COMPLEX.CM 11
(ID: 1930222) - (SKU: ) - SUPERFULL.CM 60
(ID: 1930333) - (SKU: 44LYM001) - LYMPHATIC DRAINAGE CON CAJA 60
(ID: 1930444) - (SKU: 55ENV001) - ENVIO EXPRESS
3
ASEGURADO
"""

PAGINA_ROTULO_1 = """GUIA: 240062419605
Fecha de creación del pre-envío: 30/09/2026
Remitente: TIENDA VITALCOM
Destinatario: JUAN PEREZ
Ciudad: TIERRALTA
Valor a cobrar: 249000.00
# PRODUCTO CANT
1 AGUAJE.PV julio 40
2 SUPERFULL.CM 20
"""

PAGINA_ROTULO_2 = """GUIA: 240062417872
Fecha de creación del pre-envío: 30/09/2026
Remitente: TIENDA VITALCOM
Destinatario: MARIA GOMEZ
Ciudad: MEDELLIN
Valor a cobrar: 0.00
# PRODUCTO CANT
1 AGUAJE.PV julio 28
2 MAGNESIO 12 IN 1 COMPLEX RNLD 25
3 LYMPHATIC DRAINAGE CON CAJA 60
"""

PAGINA_ROTULO_3 = """GUIA: 240062411111
Fecha de creación del pre-envío: 30/09/2026
Remitente: TIENDA VITALCOM
Destinatario: PEDRO RUIZ
Ciudad: BOGOTA D.C.
Valor a cobrar: 135.500,00
# PRODUCTO CANT
1 SUPERFULL.CM 40
2 MAGNESIUM 12 IN 1 COMPLEX.CM 11
3 ENVIO EXPRESS ASEGURADO 3
"""

PAGINAS = [PAGINA_MANIFIESTO, PAGINA_RESUMEN,
           PAGINA_ROTULO_1, PAGINA_ROTULO_2, PAGINA_ROTULO_3]


# ── Soporte ──────────────────────────────────────────────────────────────────

_fallos: list[str] = []


def revisar(titulo: str, obtenido, esperado) -> None:
    ok = obtenido == esperado
    marca = "OK  " if ok else "FALLA"
    print(f"  [{marca}] {titulo}")
    if not ok:
        print(f"           esperado: {esperado!r}")
        print(f"           obtenido: {obtenido!r}")
        _fallos.append(titulo)


def main() -> int:
    m = parsear_texto(PAGINAS, archivo="ejemplo.pdf")

    print("\n── Cabecera ──")
    revisar("Transportadora", m.transportadora, "INTERRAPIDISIMO")
    revisar("Fecha de manifiesto", m.fecha_manifiesto, date(2026, 9, 30))

    print("\n── Guías del manifiesto ──")
    revisar("Cantidad de guías", m.total_guias, 3)
    g1 = m.guias[0]
    revisar("Número de la primera", g1.numero, "240062419605")
    revisar("Consecutivo", g1.consecutivo, 1)
    revisar("Ciudad destino", g1.ciudad_destino, "TIERRALTA")
    revisar("Valor de recaudo", g1.valor_recaudo, 249000.0)
    revisar("Tipo de logística", g1.tipo_logistica, "CON RECAUDO")

    print("\n── Formatos difíciles ──")
    g3 = [g for g in m.guias if g.numero == "240062411111"][0]
    revisar("Fila sin espacios entre campos", g3.ciudad_destino, "BOGOTA D.C.")
    revisar("Recaudo con separador de miles", g3.valor_recaudo, 135500.0)

    print("\n── Resumen de productos ──")
    resumen = {(p.sku_dropi, p.id_dropi): p for p in m.resumen}
    revisar("Productos distintos en el resumen", len(m.resumen), 6)
    revisar("AGUAJE.PV julio", resumen[("23AGU007", "1924139")].cantidad, 68)
    revisar("SUPERFULL.CM con SKU vacío", resumen[("", "1930222")].cantidad, 60)
    revisar("LYMPHATIC DRAINAGE CON CAJA", resumen[("44LYM001", "1930333")].cantidad, 60)

    print("\n── Mismo SKU con dos ID ──")
    mismos = [p for p in m.resumen if p.sku_dropi == "13MAG154"]
    revisar("El SKU 13MAG154 aparece dos veces", len(mismos), 2)
    revisar("Son nombres distintos",
            sorted(p.nombre_dropi for p in mismos),
            ["MAGNESIO 12 IN 1 COMPLEX RNLD", "MAGNESIUM 12 IN 1 COMPLEX.CM"])
    revisar("Cada uno con su cantidad",
            sorted(p.cantidad for p in mismos), [11, 25])

    print("\n── Nombre partido con la cantidad en medio ──")
    envio = resumen[("55ENV001", "1930444")]
    revisar("Nombre reconstruido", envio.nombre_dropi, "ENVIO EXPRESS ASEGURADO")
    revisar("Cantidad recuperada", envio.cantidad, 3)

    print("\n── Detalle por guía ──")
    revisar("Productos de la guía 1", len(g1.productos), 2)
    revisar("Unidades de la guía 1", g1.unidades, 60)
    revisar("Unidades totales en rótulos", m.unidades_rotulos, 227)
    revisar("Unidades totales en el resumen", m.unidades_resumen, 227)

    print("\n── Validaciones ──")
    pruebas = {p["clave"]: p for p in m.validar()}
    revisar("Guías con su rótulo", pruebas["guias_vs_rotulos"]["ok"], True)
    revisar("Productos cuadran", pruebas["productos"]["ok"], True)
    revisar("Sin guías repetidas", pruebas["duplicadas_internas"]["ok"], True)
    revisar("Cabecera completa", pruebas["cabecera"]["ok"], True)

    print("\n── Rótulo sin fila en el manifiesto ──")
    m2 = parsear_texto(PAGINAS + ["""GUIA: 240062499999
# PRODUCTO CANT
1 AGUAJE.PV julio 5
"""])
    revisar("Se agrega la guía huérfana", m2.total_guias, 4)
    revisar("Se avisa del faltante", len(m2.avisos), 1)

    print("\n" + "=" * 62)
    if _fallos:
        print(f"  {len(_fallos)} prueba(s) con fallo:")
        for f in _fallos:
            print(f"    · {f}")
        return 1
    print("  Todas las pruebas pasaron.")
    print("=" * 62)
    return 0


if __name__ == "__main__":
    sys.exit(main())
