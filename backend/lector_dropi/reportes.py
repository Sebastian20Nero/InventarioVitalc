"""Exportacion al formato del Excel de control y hoja de alistamiento.

El archivo que se genera respeta la estructura del que se usa hoy:

    una hoja por transportadora   Codigo | PRODUCTO | CORTE 1..N | TOTAL |
                                  PRODUCTO REPRESADO | GUIAS REPRESADAS
    hoja CORTE                    consolidado por producto, una columna por
                                  transportadora + TOTAL
    hoja REPRESADO                dos columnas por transportadora: P y G

Se escriben **valores, no formulas**. El archivo actual se dana y aparecen
errores #REF!; con valores eso no puede ocurrir. El total se calcula al
generar, no lo recalcula Excel.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

import config
import db

VERDE = "C6E0B4"
VERDE_CAB = "548235"
ROJO = "F8CBAD"
GRIS = "D9D9D9"
BORDE = Border(*[Side(style="thin", color="BFBFBF")] * 4)


# ── Importacion del maestro ──────────────────────────────────────────────────

def _codigo_legible(valor) -> str:
    """Devuelve el codigo tal como debe leerse.

    Excel convierte los codigos de barras largos a numero y los muestra como
    1,77086E+13. Al leerlos vuelven como float y hay que reconstruir el entero,
    porque el codigo real es ese numero completo, sin decimales ni exponente.
    """
    if valor is None:
        return ""
    if isinstance(valor, float):
        if valor.is_integer():
            return str(int(valor))
        return str(valor)
    texto = str(valor).strip()
    # Por si llega ya escrito en notacion cientifica.
    if re.fullmatch(r"\d+(?:[.,]\d+)?[Ee]\+?\d+", texto):
        try:
            return str(int(float(texto.replace(",", "."))))
        except ValueError:
            return texto
    return texto


def importar_maestro(ruta: str | Path, hoja: str | None = None,
                     usuario: dict | None = None) -> dict:
    """Carga Codigo y PRODUCTO del Excel de control al maestro interno.

    No pisa productos existentes: si el codigo ya esta, se deja como esta. Se
    devuelve un resumen para mostrarlo al usuario.
    """
    libro = openpyxl.load_workbook(str(ruta), data_only=True)
    nombre_hoja = hoja or next(
        (h for h in libro.sheetnames if h.strip().upper() not in
         {"CORTE", "REPRESADO", "RESPRESADO"} and not h.lower().startswith("hoja")),
        libro.sheetnames[0])
    ws = libro[nombre_hoja]

    creados, existentes, sin_codigo = 0, 0, 0
    for fila in ws.iter_rows(min_row=2, values_only=True):
        codigo = _codigo_legible(fila[0] if len(fila) > 0 else None)
        nombre = str(fila[1]).strip() if len(fila) > 1 and fila[1] is not None else ""
        if not nombre:
            continue
        if not codigo:
            sin_codigo += 1
            continue
        ya = db.conectar().execute(
            "SELECT id FROM producto WHERE codigo_interno = ?", (codigo,)).fetchone()
        if ya:
            existentes += 1
            continue
        es_fisico = not any(t in nombre.upper() for t in config.NO_FISICOS)
        db.crear_producto(codigo, nombre, es_fisico, usuario)
        creados += 1
    libro.close()

    resumen = {"hoja": nombre_hoja, "creados": creados,
               "existentes": existentes, "sin_codigo": sin_codigo}
    config.registro.info("Maestro importado desde %s: %s", Path(ruta).name, resumen)
    return resumen


# ── Exportacion ──────────────────────────────────────────────────────────────

def _cab(ws, fila: int, valores: list[str], ancho: dict[int, int] | None = None) -> None:
    for col, texto in enumerate(valores, 1):
        c = ws.cell(fila, col, texto)
        c.font = Font(bold=True, color="FFFFFF", size=10)
        c.fill = PatternFill("solid", fgColor=VERDE_CAB)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BORDE
    for col, w in (ancho or {}).items():
        ws.column_dimensions[get_column_letter(col)].width = w
    ws.freeze_panes = ws.cell(fila + 1, 3)


def _datos_del_dia(fecha: str) -> dict:
    """Trae de la base todo lo que necesita el archivo, en una sola pasada."""
    cx = db.conectar()
    cortes = cx.execute(
        "SELECT c.id, c.numero, t.nombre AS transportadora FROM corte c"
        " JOIN transportadora t ON t.id = c.transportadora_id"
        " WHERE c.fecha = ? ORDER BY t.orden, c.numero", (fecha,)).fetchall()

    # Unidades por transportadora, corte y producto
    movimiento: dict[tuple[str, int, str], int] = {}
    productos: dict[str, str] = {}      # codigo -> nombre
    for c in cortes:
        for f in cx.execute(
            "SELECT COALESCE(p.codigo_interno, '') AS codigo,"
            " COALESCE(p.nombre, r.nombre_dropi) AS nombre, SUM(r.cantidad) AS cant"
            " FROM resumen_producto r LEFT JOIN producto p ON p.id = r.producto_id"
            " WHERE r.corte_id = ? GROUP BY codigo, nombre", (c["id"],)):
            codigo = f["codigo"] or f["nombre"]
            productos.setdefault(codigo, f["nombre"])
            clave = (c["transportadora"], int(c["numero"]), codigo)
            movimiento[clave] = movimiento.get(clave, 0) + int(f["cant"] or 0)

    # Represados: unidades y numeros de guia, por transportadora y producto
    rep_unidades: dict[tuple[str, str], int] = {}
    rep_guias: dict[tuple[str, str], list[str]] = {}
    for f in cx.execute(
        "SELECT t.nombre AS transportadora, COALESCE(p.codigo_interno, gp.nombre_dropi) AS codigo,"
        " COALESCE(p.nombre, gp.nombre_dropi) AS nombre, gp.cantidad, g.numero"
        " FROM represado rp JOIN guia g ON g.id = rp.guia_id"
        " JOIN corte c ON c.id = rp.corte_origen_id"
        " JOIN transportadora t ON t.id = c.transportadora_id"
        " JOIN guia_producto gp ON gp.guia_id = g.id"
        " LEFT JOIN producto p ON p.id = gp.producto_id"
        " WHERE c.fecha = ?", (fecha,)):
        clave = (f["transportadora"], f["codigo"])
        productos.setdefault(f["codigo"], f["nombre"])
        rep_unidades[clave] = rep_unidades.get(clave, 0) + int(f["cantidad"] or 0)
        rep_guias.setdefault(clave, [])
        if f["numero"] not in rep_guias[clave]:
            rep_guias[clave].append(f["numero"])

    return {"cortes": cortes, "movimiento": movimiento, "productos": productos,
            "rep_unidades": rep_unidades, "rep_guias": rep_guias}


def exportar_excel(fecha: str | None = None, destino: str | Path | None = None,
                   incluir_sin_movimiento: bool = True) -> Path:
    """Genera el archivo del dia con el formato del Excel de control."""
    fecha = fecha or date.today().isoformat()
    datos = _datos_del_dia(fecha)
    cortes = datos["cortes"]
    if not cortes:
        raise ValueError(f"No hay cortes cargados para el {fecha}.")

    transportadoras = []
    for c in cortes:
        if c["transportadora"] not in transportadoras:
            transportadoras.append(c["transportadora"])
    max_corte = max(int(c["numero"]) for c in cortes)
    n_cortes = max(max_corte, int(db.parametro("cortes_por_dia", "3")))

    # El maestro manda el orden y asegura que esten todos los productos, se
    # hayan movido o no: asi el archivo se ve igual todos los dias.
    maestro = db.conectar().execute(
        "SELECT codigo_interno, nombre FROM producto WHERE activo = 1 ORDER BY nombre").fetchall()
    filas = [(m["codigo_interno"], m["nombre"]) for m in maestro]
    vistos = {f[0] for f in filas}
    for codigo, nombre in sorted(datos["productos"].items(), key=lambda x: x[1]):
        if codigo not in vistos:
            filas.append((codigo, nombre))
    if not incluir_sin_movimiento:
        con_mov = {k[2] for k in datos["movimiento"]} | {k[1] for k in datos["rep_unidades"]}
        filas = [f for f in filas if f[0] in con_mov]

    libro = openpyxl.Workbook()
    libro.remove(libro.active)

    # ── Una hoja por transportadora ──────────────────────────────────────
    for nombre_t in transportadoras:
        ws = libro.create_sheet(nombre_t[:31])
        cabecera = (["Código", "PRODUCTO"] + [f"CORTE {i}" for i in range(1, n_cortes + 1)]
                    + ["TOTAL", "PRODUCTO REPRESADO", "GUIAS REPRESADAS"])
        _cab(ws, 1, cabecera, {1: 16, 2: 44, len(cabecera) - 1: 20, len(cabecera): 34})
        for i, (codigo, nombre) in enumerate(filas, start=2):
            ws.cell(i, 1, codigo).border = BORDE
            ws.cell(i, 2, nombre).border = BORDE
            total = 0
            for n in range(1, n_cortes + 1):
                v = datos["movimiento"].get((nombre_t, n, codigo), 0)
                total += v
                c = ws.cell(i, 2 + n, v if v else None)
                c.border = BORDE
                c.alignment = Alignment(horizontal="center")
            col_total = 3 + n_cortes
            c = ws.cell(i, col_total, total)      # valor, nunca formula
            c.font = Font(bold=True)
            c.fill = PatternFill("solid", fgColor=VERDE)
            c.border = BORDE
            rep = datos["rep_unidades"].get((nombre_t, codigo), 0)
            guias = ", ".join(datos["rep_guias"].get((nombre_t, codigo), []))
            for off, valor in ((1, rep or None), (2, guias or None)):
                c = ws.cell(i, col_total + off, valor)
                c.fill = PatternFill("solid", fgColor=ROJO)
                c.border = BORDE

    # ── Hoja CORTE ───────────────────────────────────────────────────────
    ws = libro.create_sheet("CORTE")
    cabecera = (["Código", "PRODUCTO"] + transportadoras + ["TOTAL"]
                + [f"TOTAL CORTE {i}" for i in range(1, n_cortes + 1)])
    _cab(ws, 1, cabecera, {1: 16, 2: 44})
    for i, (codigo, nombre) in enumerate(filas, start=2):
        ws.cell(i, 1, codigo).border = BORDE
        ws.cell(i, 2, nombre).border = BORDE
        total = 0
        for j, t in enumerate(transportadoras, start=3):
            v = sum(datos["movimiento"].get((t, n, codigo), 0) for n in range(1, n_cortes + 1))
            total += v
            c = ws.cell(i, j, v)
            c.border = BORDE
            c.alignment = Alignment(horizontal="center")
        col = 3 + len(transportadoras)
        c = ws.cell(i, col, total)
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor=VERDE)
        c.border = BORDE
        for n in range(1, n_cortes + 1):
            v = sum(datos["movimiento"].get((t, n, codigo), 0) for t in transportadoras)
            c = ws.cell(i, col + n, v)
            c.border = BORDE
            c.alignment = Alignment(horizontal="center")

    # ── Hoja REPRESADO ───────────────────────────────────────────────────
    ws = libro.create_sheet("REPRESADO")
    cabecera = ["Código", "PRODUCTO"]
    for t in transportadoras:
        cabecera += [f"{t} P", f"{t} G"]
    _cab(ws, 1, cabecera, {1: 16, 2: 44})
    for i, (codigo, nombre) in enumerate(filas, start=2):
        ws.cell(i, 1, codigo).border = BORDE
        ws.cell(i, 2, nombre).border = BORDE
        for j, t in enumerate(transportadoras):
            u = datos["rep_unidades"].get((t, codigo), 0)
            g = ", ".join(datos["rep_guias"].get((t, codigo), []))
            for off, valor in ((0, u or None), (1, g or None)):
                c = ws.cell(i, 3 + j * 2 + off, valor)
                c.fill = PatternFill("solid", fgColor=ROJO)
                c.border = BORDE

    destino = Path(destino) if destino else (
        config.CARPETA_EXPORTES / f"CORTE_{fecha}_{datetime.now():%H%M}.xlsx")
    destino.parent.mkdir(parents=True, exist_ok=True)
    libro.save(destino)
    config.registro.info("Exportado %s", destino)
    return destino


# ── Hoja de alistamiento ─────────────────────────────────────────────────────

def exportar_alistamiento(corte_id: int, destino: str | Path | None = None) -> Path:
    """Hoja para imprimir y llevar a bodega."""
    import servicios

    corte = servicios.detalle_corte(corte_id)
    if corte is None:
        raise ValueError("No existe ese corte.")
    filas = servicios.lista_alistamiento(corte_id)

    libro = openpyxl.Workbook()
    ws = libro.active
    ws.title = "Alistamiento"

    ws["A1"] = f"ALISTAMIENTO · {corte['transportadora']} · CORTE {corte['numero']}"
    ws["A1"].font = Font(bold=True, size=14, color=VERDE_CAB)
    ws.merge_cells("A1:E1")
    ws["A2"] = f"Fecha del manifiesto: {corte['fecha']}"
    ws["A2"].font = Font(size=10, color="808080")
    ws.merge_cells("A2:E2")

    _cab(ws, 4, ["Código", "PRODUCTO", "CANTIDAD", "REVISADO", "EN BOLSAS",
                 "EMPACADO", "RESPONSABLE"],
         {1: 16, 2: 44, 3: 11, 4: 11, 5: 11, 6: 11, 7: 24})
    fila = 5
    for f in filas:
        if not f["es_fisico"]:
            continue              # el envio asegurado y similares no se alistan
        ws.cell(fila, 1, f["codigo_interno"] or "").border = BORDE
        ws.cell(fila, 2, f["nombre_mostrado"]).border = BORDE
        c = ws.cell(fila, 3, int(f["cantidad"]))
        c.font = Font(bold=True)
        c.alignment = Alignment(horizontal="center")
        c.border = BORDE
        for col, etapa in enumerate(("revisado", "embolsado", "empacado"), start=4):
            c = ws.cell(fila, col, "Sí" if f[etapa] else "")
            c.alignment = Alignment(horizontal="center")
            c.border = BORDE
        # Se muestra quien cerro la ultima etapa hecha: es el responsable
        # efectivo del renglon.
        responsable = (f["empacado_por_nombre"] or f["embolsado_por_nombre"]
                       or f["revisado_por_nombre"] or "")
        ws.cell(fila, 7, responsable).border = BORDE
        fila += 1

    no_fisicos = [f for f in filas if not f["es_fisico"]]
    if no_fisicos:
        fila += 1
        ws.cell(fila, 1, "No se alistan (no son producto físico):").font = Font(
            bold=True, size=9, color="808080")
        fila += 1
        for f in no_fisicos:
            ws.cell(fila, 2, f["nombre_mostrado"]).font = Font(size=9, color="808080")
            ws.cell(fila, 3, int(f["cantidad"])).font = Font(size=9, color="808080")
            fila += 1

    destino = Path(destino) if destino else (
        config.CARPETA_EXPORTES /
        f"Alistamiento_{corte['transportadora']}_C{corte['numero']}_{corte['fecha']}.xlsx")
    destino.parent.mkdir(parents=True, exist_ok=True)
    libro.save(destino)
    return destino
