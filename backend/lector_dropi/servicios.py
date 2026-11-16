"""Reglas de negocio: cargar un corte, homologar productos y alistar.

Aqui vive lo que no es ni lectura de PDF ni acceso a datos: el orden en que
pasan las cosas y lo que esta permitido. La interfaz solo llama a estas
funciones; no arma consultas por su cuenta.

El flujo de una carga tiene dos tiempos a proposito:

    revisar_manifiesto()   no escribe nada, devuelve que se encontro y que
                           falta homologar
    guardar_corte()        escribe, y solo si ya no falta ninguna equivalencia

Asi el usuario ve todo lo que esta mal antes de que se guarde la primera fila.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

import config
import db
from parser_dropi import Manifiesto, ProductoLeido, leer_pdf


class ErrorDeUso(Exception):
    """Problema que el usuario puede entender y corregir."""


# ── Revision previa ──────────────────────────────────────────────────────────

@dataclass
class PendienteHomologar:
    """Un producto de DROPI que todavia no tiene equivalente interno."""
    sku_dropi: str
    id_dropi: str
    nombre_dropi: str
    unidades: int

    @property
    def etiqueta(self) -> str:
        sku = self.sku_dropi or "(sin SKU)"
        return f"{self.nombre_dropi} · SKU {sku} · ID {self.id_dropi}"


@dataclass
class Revision:
    """Resultado de mirar un PDF sin guardar nada."""
    manifiesto: Manifiesto
    ruta: Path
    transportadora: sqlite3.Row | None = None
    numero_sugerido: int = 1
    validaciones: list[dict] = field(default_factory=list)
    pendientes: list[PendienteHomologar] = field(default_factory=list)
    duplicadas: list[sqlite3.Row] = field(default_factory=list)
    pdf_repetido: sqlite3.Row | None = None

    @property
    def puede_guardar(self) -> bool:
        """Se puede guardar cuando no falta homologar nada y el PDF es nuevo."""
        return not self.pendientes and self.pdf_repetido is None and self.transportadora is not None

    @property
    def motivos_bloqueo(self) -> list[str]:
        motivos = []
        if self.transportadora is None:
            motivos.append(
                f"La transportadora «{self.manifiesto.transportadora or 'sin nombre'}» no está "
                "registrada. Agréguela en Configuración o añada el nombre como alias.")
        if self.pdf_repetido is not None:
            p = self.pdf_repetido
            motivos.append(
                f"Este PDF ya se cargó el {p['cargado_en'][:10]} en el corte {p['corte']} "
                f"de {p['transportadora']} ({p['fecha']}).")
        if self.pendientes:
            motivos.append(
                f"Faltan {len(self.pendientes)} producto(s) por asociar al maestro interno.")
        return motivos


def _productos_del_manifiesto(m: Manifiesto) -> dict[tuple[str, str], ProductoLeido]:
    """Los productos distintos del PDF, tomados del resumen.

    Solo cuenta el resumen, que es la unica seccion con SKU e ID. El detalle
    del rotulo trae el nombre abreviado —«MULTI COLAGENO» frente a «MULTI
    COLAGENO PRV NICOLAS» y «MULTI COLAGENO.CM» del resumen— y cruzarlo por
    parecido seria adivinar. Ese detalle se conserva como texto, que es para
    lo que sirve: saber que iba en cada guia cuando se represa.
    """
    productos: dict[tuple[str, str], ProductoLeido] = {}
    for p in m.resumen:
        clave = p.clave
        if clave in productos:
            productos[clave].cantidad += p.cantidad
        else:
            productos[clave] = ProductoLeido(p.id_dropi, p.sku_dropi, p.nombre_dropi, p.cantidad)
    return productos


def revisar_manifiesto(ruta: str | Path, numero_corte: int | None = None) -> Revision:
    """Lee un PDF y dice que pasaria si se guardara. No escribe nada."""
    ruta = Path(ruta)
    if not ruta.exists():
        raise ErrorDeUso(f"No se encontró el archivo:\n{ruta}")

    manifiesto = leer_pdf(ruta)
    rev = Revision(manifiesto=manifiesto, ruta=ruta)
    rev.validaciones = manifiesto.validar()
    rev.transportadora = db.buscar_transportadora(manifiesto.transportadora)
    rev.pdf_repetido = db.pdf_ya_cargado(manifiesto.hash_archivo)

    fecha = (manifiesto.fecha_manifiesto or date.today()).isoformat()
    if rev.transportadora is not None:
        rev.numero_sugerido = (numero_corte
                               or db.siguiente_numero_corte(fecha, rev.transportadora["id"]))

    rev.duplicadas = db.guias_en_otros_cortes([g.numero for g in manifiesto.guias])

    # Nada se asocia por parecido de nombre: si no hay equivalencia exacta
    # por la pareja SKU + ID, el producto queda pendiente.
    for p in _productos_del_manifiesto(manifiesto).values():
        if db.equivalencia(p.sku_dropi, p.id_dropi) is None:
            rev.pendientes.append(
                PendienteHomologar(p.sku_dropi, p.id_dropi, p.nombre_dropi, p.cantidad))
    rev.pendientes.sort(key=lambda x: -x.unidades)
    return rev


# ── Homologacion ─────────────────────────────────────────────────────────────

def homologar(pendiente: PendienteHomologar, producto_id: int | None = None,
              codigo_nuevo: str = "", nombre_nuevo: str = "",
              usuario: dict | None = None) -> int:
    """Asocia un producto de DROPI al maestro interno.

    Con `producto_id` se usa un producto existente. Con `codigo_nuevo` se crea
    uno y se asocia. Queda guardado para las proximas cargas.
    """
    if producto_id is None:
        codigo = (codigo_nuevo or "").strip()
        nombre = (nombre_nuevo or pendiente.nombre_dropi).strip()
        if not codigo:
            raise ErrorDeUso("Indique el código interno del producto.")
        existente = db.conectar().execute(
            "SELECT id FROM producto WHERE codigo_interno = ?", (codigo,)).fetchone()
        if existente:
            producto_id = int(existente["id"])
        else:
            es_fisico = not any(t in nombre.upper() for t in config.NO_FISICOS)
            producto_id = db.crear_producto(codigo, nombre, es_fisico, usuario)
    db.crear_equivalencia(pendiente.sku_dropi, pendiente.id_dropi,
                          pendiente.nombre_dropi, producto_id, usuario)
    return producto_id


# ── Guardado del corte ───────────────────────────────────────────────────────

def guardar_corte(rev: Revision, numero_corte: int | None = None,
                  usuario: dict | None = None) -> int:
    """Guarda el corte completo. Todo o nada: una sola transaccion."""
    if not rev.puede_guardar:
        raise ErrorDeUso("No se puede guardar todavía:\n\n· " + "\n· ".join(rev.motivos_bloqueo))

    m = rev.manifiesto
    fecha = (m.fecha_manifiesto or date.today()).isoformat()
    numero = int(numero_corte or rev.numero_sugerido)
    ahora = datetime.now().isoformat(timespec="seconds")
    uid = (usuario or {}).get("id")

    with db.transaccion() as cx:
        ya = cx.execute(
            "SELECT id FROM corte WHERE fecha = ? AND transportadora_id = ? AND numero = ?",
            (fecha, rev.transportadora["id"], numero)).fetchone()
        if ya:
            raise ErrorDeUso(
                f"Ya existe el corte {numero} de {rev.transportadora['nombre']} "
                f"para el {fecha}. Use otro número de corte.")

        cur = cx.execute(
            "INSERT INTO corte (fecha, transportadora_id, numero, fecha_manifiesto, estado,"
            " creado_por, creado_en) VALUES (?,?,?,?,'abierto',?,?)",
            (fecha, rev.transportadora["id"], numero, fecha, uid, ahora))
        corte_id = int(cur.lastrowid)

        cx.execute(
            "INSERT INTO archivo_pdf (corte_id, nombre_archivo, hash_sha256, paginas,"
            " guias_detectadas, cargado_por, cargado_en) VALUES (?,?,?,?,?,?,?)",
            (corte_id, rev.ruta.name, m.hash_archivo, m.paginas, m.total_guias, uid, ahora))

        # Resumen del PDF, ya traducido donde se pudo
        for p in m.resumen:
            eq = db.equivalencia(p.sku_dropi, p.id_dropi)
            cx.execute(
                "INSERT INTO resumen_producto (corte_id, sku_dropi, id_dropi, nombre_dropi,"
                " producto_id, cantidad) VALUES (?,?,?,?,?,?)",
                (corte_id, p.sku_dropi, p.id_dropi, p.nombre_dropi,
                 eq["producto_id"] if eq else None, p.cantidad))

        # Guias y su detalle. Se guarda el dato crudo de DROPI ademas de la
        # traduccion, para poder rehacerla si una equivalencia queda mal.
        por_nombre = {p.nombre_dropi.strip().upper(): p for p in m.resumen}
        for g in m.guias:
            cur = cx.execute(
                "INSERT INTO guia (corte_id, numero, consecutivo, ciudad_destino,"
                " valor_recaudo, tipo_logistica, estado) VALUES (?,?,?,?,?,?,'pendiente')",
                (corte_id, g.numero, g.consecutivo, g.ciudad_destino,
                 g.valor_recaudo, g.tipo_logistica))
            guia_id = int(cur.lastrowid)
            for d in g.productos:
                ref = por_nombre.get(d.nombre_dropi.strip().upper())
                sku = ref.sku_dropi if ref else ""
                idd = ref.id_dropi if ref else ""
                eq = db.equivalencia(sku, idd)
                cx.execute(
                    "INSERT INTO guia_producto (guia_id, sku_dropi, id_dropi, nombre_dropi,"
                    " producto_id, cantidad) VALUES (?,?,?,?,?,?)",
                    (guia_id, sku, idd, d.nombre_dropi,
                     eq["producto_id"] if eq else None, d.cantidad))

        _generar_alistamiento(cx, corte_id)

        db.registrar(cx, usuario, "corte.cargar", "corte", corte_id, {
            "archivo": rev.ruta.name,
            "transportadora": rev.transportadora["nombre"],
            "fecha": fecha, "numero": numero,
            "guias": m.total_guias, "unidades": m.unidades_resumen,
        })
    config.registro.info("Corte %s guardado: %s guías", corte_id, m.total_guias)
    return corte_id


def _generar_alistamiento(cx: sqlite3.Connection, corte_id: int) -> None:
    """Arma la lista de alistamiento sumando el resumen por producto interno.

    Los no fisicos (envio asegurado y similares) se guardan aparte marcados,
    para que no estorben en bodega pero sigan visibles.
    """
    cx.execute("DELETE FROM alistamiento WHERE corte_id = ?", (corte_id,))
    filas = cx.execute(
        "SELECT r.producto_id, COALESCE(p.nombre, r.nombre_dropi) AS nombre,"
        " COALESCE(p.es_fisico, 1) AS es_fisico, SUM(r.cantidad) AS cant"
        " FROM resumen_producto r LEFT JOIN producto p ON p.id = r.producto_id"
        " WHERE r.corte_id = ? GROUP BY r.producto_id, nombre"
        " ORDER BY es_fisico DESC, cant DESC", (corte_id,)).fetchall()
    for f in filas:
        cx.execute(
            "INSERT INTO alistamiento (corte_id, producto_id, nombre_mostrado, cantidad)"
            " VALUES (?,?,?,?)",
            (corte_id, f["producto_id"], f["nombre"], int(f["cant"] or 0)))


# ── Consultas de la interfaz ─────────────────────────────────────────────────

def lista_alistamiento(corte_id: int) -> list[sqlite3.Row]:
    """La lista del corte, con quien hizo cada etapa de cada producto."""
    return db.conectar().execute(
        "SELECT a.*, p.codigo_interno, COALESCE(p.es_fisico, 1) AS es_fisico,"
        " ur.nombre AS revisado_por_nombre,"
        " ue.nombre AS embolsado_por_nombre,"
        " up.nombre AS empacado_por_nombre"
        " FROM alistamiento a LEFT JOIN producto p ON p.id = a.producto_id"
        " LEFT JOIN usuario ur ON ur.id = a.revisado_por"
        " LEFT JOIN usuario ue ON ue.id = a.embolsado_por"
        " LEFT JOIN usuario up ON up.id = a.empacado_por"
        " WHERE a.corte_id = ? ORDER BY es_fisico DESC, a.cantidad DESC", (corte_id,)).fetchall()


def marcar_etapa(alistamiento_id: int, etapa: str, hecho: bool,
                 usuario: dict | None = None) -> None:
    """Marca una etapa del alistamiento: revisado, embolsado o empacado.

    Las etapas van en orden. No se puede marcar una si la anterior no esta
    hecha, ni desmarcar una si la siguiente ya lo esta: de lo contrario
    quedaria un producto «empacado» que nadie reviso.
    """
    if etapa not in db.ETAPAS:
        raise ErrorDeUso(f"Etapa desconocida: {etapa}")
    cx = db.conectar()
    fila = cx.execute("SELECT * FROM alistamiento WHERE id = ?", (alistamiento_id,)).fetchone()
    if fila is None:
        raise ErrorDeUso("No existe ese renglón de alistamiento.")

    i = db.ETAPAS.index(etapa)
    if hecho and i > 0:
        previa = db.ETAPAS[i - 1]
        if not fila[previa]:
            raise ErrorDeUso(
                f"Primero hay que marcar «{db.ETIQUETA_ETAPA[previa]}» "
                f"en {fila['nombre_mostrado']}.")
    if not hecho and i < len(db.ETAPAS) - 1:
        siguiente = db.ETAPAS[i + 1]
        if fila[siguiente]:
            raise ErrorDeUso(
                f"No se puede desmarcar: {fila['nombre_mostrado']} ya figura como "
                f"«{db.ETIQUETA_ETAPA[siguiente]}».")

    ahora = datetime.now().isoformat(timespec="seconds")
    with db.transaccion() as cx:
        cx.execute(
            f"UPDATE alistamiento SET {etapa} = ?, {etapa}_por = ?, {etapa}_en = ? WHERE id = ?",
            (1 if hecho else 0, (usuario or {}).get("id") if hecho else None,
             ahora if hecho else None, alistamiento_id))
        db.registrar(cx, usuario, f"alistamiento.{etapa}", "alistamiento", alistamiento_id,
                     {"producto": fila["nombre_mostrado"], "hecho": bool(hecho)})


# ── Asignacion del trabajo ───────────────────────────────────────────────────

def asignar(corte_id: int, usuarios_ids: list[int], usuario: dict | None = None) -> None:
    """Reparte un corte entre una o varias personas.

    Todas trabajan sobre la misma lista; lo que distingue es quien marca cada
    renglon. Quien carga el corte no se asigna a si mismo, salvo el
    Administrador: separa a quien decide de quien ejecuta.
    """
    corte = detalle_corte(corte_id)
    if corte is None:
        raise ErrorDeUso("No existe ese corte.")
    quien = (usuario or {})
    if (quien.get("rol") != "Administrador" and quien.get("id")
            and quien["id"] in usuarios_ids and corte["creado_por"] == quien["id"]):
        raise ErrorDeUso(
            "Quien carga el corte no puede asignárselo a sí mismo. "
            "Pida a otra persona que lo asigne, o hágalo con el perfil Administrador.")

    ahora = datetime.now().isoformat(timespec="seconds")
    with db.transaccion() as cx:
        for uid in usuarios_ids:
            cx.execute(
                "INSERT OR IGNORE INTO asignacion (corte_id, usuario_id, asignado_por,"
                " asignado_en) VALUES (?,?,?,?)", (corte_id, uid, quien.get("id"), ahora))
        db.registrar(cx, usuario, "corte.asignar", "corte", corte_id,
                     {"usuarios": usuarios_ids})


def quitar_asignacion(corte_id: int, usuario_id: int, usuario: dict | None = None) -> None:
    with db.transaccion() as cx:
        cx.execute("DELETE FROM asignacion WHERE corte_id = ? AND usuario_id = ?",
                   (corte_id, usuario_id))
        db.registrar(cx, usuario, "corte.desasignar", "corte", corte_id,
                     {"usuario_id": usuario_id})


def asignados(corte_id: int) -> list[sqlite3.Row]:
    return db.conectar().execute(
        "SELECT a.*, u.nombre, u.usuario FROM asignacion a"
        " JOIN usuario u ON u.id = a.usuario_id"
        " WHERE a.corte_id = ? ORDER BY u.nombre", (corte_id,)).fetchall()


def mis_cortes(usuario_id: int, fecha: str | None = None) -> list[sqlite3.Row]:
    """Los cortes asignados a una persona. Un alistador solo ve lo suyo."""
    fecha = fecha or date.today().isoformat()
    return db.conectar().execute(
        "SELECT c.id, c.numero, c.fecha, c.estado, t.nombre AS transportadora,"
        " a.estado AS estado_asignacion,"
        " (SELECT COUNT(*) FROM alistamiento al WHERE al.corte_id = c.id) AS renglones,"
        " (SELECT COUNT(*) FROM alistamiento al WHERE al.corte_id = c.id AND al.empacado = 1) AS listos"
        " FROM asignacion a JOIN corte c ON c.id = a.corte_id"
        " JOIN transportadora t ON t.id = c.transportadora_id"
        " WHERE a.usuario_id = ? AND c.fecha = ? ORDER BY t.orden, c.numero",
        (usuario_id, fecha)).fetchall()


def avance_alistamiento(corte_id: int) -> dict:
    """Cuanto lleva cada etapa, para la barra de avance del tablero."""
    f = db.conectar().execute(
        "SELECT COUNT(*) AS total, SUM(revisado) AS revisado,"
        " SUM(embolsado) AS embolsado, SUM(empacado) AS empacado"
        " FROM alistamiento WHERE corte_id = ?", (corte_id,)).fetchone()
    total = int(f["total"] or 0)
    return {"total": total,
            "revisado": int(f["revisado"] or 0),
            "embolsado": int(f["embolsado"] or 0),
            "empacado": int(f["empacado"] or 0),
            "completo": total > 0 and int(f["empacado"] or 0) == total}


def cortes_del_dia(fecha: str | None = None) -> list[sqlite3.Row]:
    fecha = fecha or date.today().isoformat()
    return db.conectar().execute(
        "SELECT c.*, t.nombre AS transportadora,"
        " (SELECT COUNT(*) FROM guia g WHERE g.corte_id = c.id) AS guias,"
        " (SELECT COUNT(*) FROM guia g WHERE g.corte_id = c.id AND g.estado = 'escaneada') AS escaneadas,"
        " (SELECT COALESCE(SUM(cantidad),0) FROM resumen_producto r WHERE r.corte_id = c.id) AS unidades"
        " FROM corte c JOIN transportadora t ON t.id = c.transportadora_id"
        " WHERE c.fecha = ? ORDER BY t.orden, c.numero", (fecha,)).fetchall()


def detalle_corte(corte_id: int) -> sqlite3.Row | None:
    return db.conectar().execute(
        "SELECT c.*, t.nombre AS transportadora FROM corte c"
        " JOIN transportadora t ON t.id = c.transportadora_id WHERE c.id = ?", (corte_id,)).fetchone()


def buscar_guia(numero: str) -> list[sqlite3.Row]:
    """Todo lo que se sabe de una guia, en los cortes donde aparezca."""
    return db.conectar().execute(
        "SELECT g.*, c.fecha, c.numero AS corte, c.estado AS corte_estado,"
        " t.nombre AS transportadora, u.nombre AS escaneada_por_nombre"
        " FROM guia g JOIN corte c ON c.id = g.corte_id"
        " JOIN transportadora t ON t.id = c.transportadora_id"
        " LEFT JOIN usuario u ON u.id = g.escaneada_por"
        " WHERE g.numero = ? ORDER BY c.fecha DESC, c.numero DESC",
        ((numero or "").strip(),)).fetchall()


def productos_de_guia(guia_id: int) -> list[sqlite3.Row]:
    return db.conectar().execute(
        "SELECT gp.*, p.codigo_interno, p.nombre AS producto_nombre"
        " FROM guia_producto gp LEFT JOIN producto p ON p.id = gp.producto_id"
        " WHERE gp.guia_id = ? ORDER BY gp.cantidad DESC", (guia_id,)).fetchall()
