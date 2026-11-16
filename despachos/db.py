"""SQLite local. Nada de la operación se borra: se anula, con motivo y responsable."""

from __future__ import annotations

import hashlib
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from despachos.config import BASE, TRANSPORTADORAS, preparar_carpetas

ESQUEMA = """
CREATE TABLE IF NOT EXISTS usuario (
    id INTEGER PRIMARY KEY,
    usuario TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    rol TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1,
    intentos_fallidos INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta TEXT
);

CREATE TABLE IF NOT EXISTS transportadora (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE,
    nombre_dropi TEXT NOT NULL,
    alias TEXT NOT NULL,
    activa INTEGER NOT NULL DEFAULT 1,
    orden INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS producto (
    id INTEGER PRIMARY KEY,
    codigo_interno TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    es_fisico INTEGER NOT NULL DEFAULT 1,
    activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS equivalencia_dropi (
    id INTEGER PRIMARY KEY,
    sku_dropi TEXT NOT NULL DEFAULT '',
    id_dropi TEXT NOT NULL,
    nombre_dropi TEXT NOT NULL DEFAULT '',
    producto_id INTEGER NOT NULL REFERENCES producto(id),
    UNIQUE (sku_dropi, id_dropi)
);

CREATE TABLE IF NOT EXISTS corte (
    id INTEGER PRIMARY KEY,
    fecha TEXT NOT NULL,
    transportadora_id INTEGER NOT NULL REFERENCES transportadora(id),
    numero INTEGER NOT NULL,
    estado TEXT NOT NULL,
    cargado_por INTEGER REFERENCES usuario(id),
    creado_en TEXT NOT NULL,
    anulado INTEGER NOT NULL DEFAULT 0,
    motivo_anulacion TEXT,
    anulado_por INTEGER REFERENCES usuario(id),
    auxiliar TEXT,
    placa TEXT,
    hora_entrega TEXT,
    motivo_cierre TEXT,
    plataforma TEXT NOT NULL DEFAULT 'DROPI',
    UNIQUE (fecha, transportadora_id, numero)
);

CREATE TABLE IF NOT EXISTS archivo_pdf (
    id INTEGER PRIMARY KEY,
    corte_id INTEGER NOT NULL REFERENCES corte(id),
    nombre TEXT NOT NULL,
    huella TEXT NOT NULL UNIQUE,
    ruta TEXT
);

CREATE TABLE IF NOT EXISTS guia (
    id INTEGER PRIMARY KEY,
    corte_id INTEGER NOT NULL REFERENCES corte(id),
    numero TEXT NOT NULL,
    consecutivo INTEGER,
    ciudad TEXT,
    recaudo TEXT,
    tipo TEXT,
    estado TEXT NOT NULL DEFAULT 'cargada',
    relacion_despacho TEXT,
    estado_origen TEXT,
    anulado INTEGER NOT NULL DEFAULT 0,
    UNIQUE (corte_id, numero)
);

CREATE TABLE IF NOT EXISTS guia_producto (
    id INTEGER PRIMARY KEY,
    guia_id INTEGER NOT NULL REFERENCES guia(id),
    texto_crudo TEXT NOT NULL,
    texto_traducido TEXT
);

CREATE TABLE IF NOT EXISTS resumen_producto (
    id INTEGER PRIMARY KEY,
    corte_id INTEGER NOT NULL REFERENCES corte(id),
    sku_dropi TEXT NOT NULL DEFAULT '',
    id_dropi TEXT NOT NULL,
    nombre_dropi TEXT NOT NULL DEFAULT '',
    cantidad INTEGER NOT NULL,
    producto_id INTEGER REFERENCES producto(id)
);

CREATE TABLE IF NOT EXISTS alistamiento (
    id INTEGER PRIMARY KEY,
    corte_id INTEGER NOT NULL REFERENCES corte(id),
    producto_id INTEGER NOT NULL REFERENCES producto(id),
    cantidad INTEGER NOT NULL,
    revisado INTEGER NOT NULL DEFAULT 0,
    revisado_por INTEGER REFERENCES usuario(id),
    revisado_en TEXT,
    embolsado INTEGER NOT NULL DEFAULT 0,
    embolsado_por INTEGER REFERENCES usuario(id),
    embolsado_en TEXT,
    empacado INTEGER NOT NULL DEFAULT 0,
    empacado_por INTEGER REFERENCES usuario(id),
    empacado_en TEXT,
    UNIQUE (corte_id, producto_id)
);

CREATE TABLE IF NOT EXISTS asignacion (
    id INTEGER PRIMARY KEY,
    corte_id INTEGER NOT NULL REFERENCES corte(id),
    usuario_id INTEGER NOT NULL REFERENCES usuario(id),
    asignado_por INTEGER NOT NULL REFERENCES usuario(id),
    asignado_en TEXT NOT NULL,
    estado TEXT NOT NULL,
    terminada_en TEXT,
    UNIQUE (corte_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS escaneo (
    id INTEGER PRIMARY KEY,
    guia_id INTEGER REFERENCES guia(id),
    codigo_leido TEXT NOT NULL,
    codigo_normalizado TEXT,
    resultado TEXT NOT NULL,
    usuario_id INTEGER REFERENCES usuario(id),
    fecha TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS represado (
    id INTEGER PRIMARY KEY,
    guia_id INTEGER NOT NULL REFERENCES guia(id),
    motivo TEXT NOT NULL,
    responsable_id INTEGER REFERENCES usuario(id),
    corte_reasignacion_id INTEGER REFERENCES corte(id),
    creado_en TEXT NOT NULL,
    anulado INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY,
    fecha TEXT NOT NULL,
    usuario_id INTEGER,
    accion TEXT NOT NULL,
    detalle TEXT NOT NULL,
    huella_anterior TEXT NOT NULL,
    huella TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equivalencia_plataforma (
    id INTEGER PRIMARY KEY,
    plataforma TEXT NOT NULL,
    referencia TEXT NOT NULL,
    nombre_origen TEXT NOT NULL DEFAULT '',
    producto_id INTEGER NOT NULL REFERENCES producto(id),
    UNIQUE (plataforma, referencia)
);

CREATE TABLE IF NOT EXISTS salida_sin_costo (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL,
    motivo TEXT NOT NULL,
    destinatario TEXT NOT NULL,
    producto_id INTEGER NOT NULL REFERENCES producto(id),
    cantidad INTEGER NOT NULL,
    estado TEXT NOT NULL,
    solicitado_por INTEGER NOT NULL REFERENCES usuario(id),
    solicitado_en TEXT NOT NULL,
    autorizado_por INTEGER REFERENCES usuario(id),
    autorizado_en TEXT,
    motivo_rechazo TEXT,
    entregado_por INTEGER REFERENCES usuario(id),
    entregado_en TEXT,
    anulado INTEGER NOT NULL DEFAULT 0,
    motivo_anulacion TEXT,
    anulado_por INTEGER REFERENCES usuario(id)
);

CREATE TABLE IF NOT EXISTS devolucion (
    id INTEGER PRIMARY KEY,
    guia_origen TEXT,
    guia_id INTEGER REFERENCES guia(id),
    observacion TEXT,
    recibido_por INTEGER NOT NULL REFERENCES usuario(id),
    recibido_en TEXT NOT NULL,
    anulado INTEGER NOT NULL DEFAULT 0,
    motivo_anulacion TEXT,
    anulado_por INTEGER REFERENCES usuario(id)
);

CREATE TABLE IF NOT EXISTS devolucion_linea (
    id INTEGER PRIMARY KEY,
    devolucion_id INTEGER NOT NULL REFERENCES devolucion(id),
    producto_id INTEGER NOT NULL REFERENCES producto(id),
    cantidad INTEGER NOT NULL,
    estado_producto TEXT NOT NULL,
    disposicion TEXT NOT NULL,
    evidencia TEXT
);

CREATE TABLE IF NOT EXISTS salida_muestra (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL,
    pedido TEXT NOT NULL,
    destinatario TEXT NOT NULL,
    observacion TEXT,
    solicitado_por INTEGER NOT NULL REFERENCES usuario(id),
    solicitado_en TEXT NOT NULL,
    factura_numero TEXT,
    validado_por INTEGER REFERENCES usuario(id),
    validado_en TEXT,
    despachado_por INTEGER REFERENCES usuario(id),
    despachado_en TEXT,
    anulado INTEGER NOT NULL DEFAULT 0,
    motivo_anulacion TEXT,
    anulado_por INTEGER REFERENCES usuario(id)
);

CREATE TABLE IF NOT EXISTS salida_muestra_linea (
    id INTEGER PRIMARY KEY,
    salida_id INTEGER NOT NULL REFERENCES salida_muestra(id),
    producto_id INTEGER NOT NULL REFERENCES producto(id),
    cantidad INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lote_mercado (
    id INTEGER PRIMARY KEY,
    fecha TEXT NOT NULL,
    nombre_archivo TEXT NOT NULL,
    huella TEXT NOT NULL UNIQUE,
    ventas INTEGER NOT NULL,
    unidades INTEGER NOT NULL,
    cargado_por INTEGER NOT NULL REFERENCES usuario(id),
    cargado_en TEXT NOT NULL,
    anulado INTEGER NOT NULL DEFAULT 0,
    motivo_anulacion TEXT,
    anulado_por INTEGER REFERENCES usuario(id)
);

CREATE TABLE IF NOT EXISTS venta_mercado (
    id INTEGER PRIMARY KEY,
    lote_id INTEGER NOT NULL REFERENCES lote_mercado(id),
    numero TEXT NOT NULL,
    titulo TEXT NOT NULL,
    referencia TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    comprador TEXT,
    estado_origen TEXT,
    seguimiento TEXT,
    fecha_venta TEXT,
    producto_id INTEGER NOT NULL REFERENCES producto(id)
);

CREATE TABLE IF NOT EXISTS prefijo_transportadora (
    transportadora_id INTEGER PRIMARY KEY REFERENCES transportadora(id),
    prefijo TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS parametro (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);
"""


def hash_pin(pin: str, sal: bytes | None = None) -> str:
    sal = sal or os.urandom(16)
    derivado = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), sal, 200_000)
    return sal.hex() + "$" + derivado.hex()


def verifica_pin(pin: str, guardado: str) -> bool:
    sal_hex, _, derivado = guardado.partition("$")
    if not derivado:
        return False
    sal = bytes.fromhex(sal_hex)
    return hash_pin(pin, sal) == guardado


class BaseDatos:
    def __init__(self, ruta: Path | None = None) -> None:
        self.ruta = Path(ruta) if ruta else BASE
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(self.ruta, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.inicializar()

    def inicializar(self) -> None:
        with self._lock:
            self.conn.executescript(ESQUEMA)
            self._migrar()
            self._sembrar()
            self.conn.commit()

    def _migrar(self) -> None:
        self._columna("corte", "auxiliar", "TEXT")
        self._columna("corte", "placa", "TEXT")
        self._columna("corte", "hora_entrega", "TEXT")
        self._columna("corte", "motivo_cierre", "TEXT")
        self._columna("escaneo", "codigo_normalizado", "TEXT")
        self._columna("corte", "plataforma", "TEXT DEFAULT 'DROPI'")
        self._columna("guia", "relacion_despacho", "TEXT")
        self._columna("guia", "estado_origen", "TEXT")

    def _columna(self, tabla: str, columna: str, definicion: str) -> None:
        existentes = {fila[1] for fila in self.conn.execute(f"PRAGMA table_info({tabla})")}
        if columna not in existentes:
            self.conn.execute(f"ALTER TABLE {tabla} ADD COLUMN {columna} {definicion}")

    def _sembrar(self) -> None:
        for nombre, dropi, alias, orden in TRANSPORTADORAS:
            self.conn.execute(
                """
                INSERT INTO transportadora (nombre, nombre_dropi, alias, activa, orden)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(nombre) DO UPDATE SET
                    nombre_dropi = excluded.nombre_dropi,
                    alias = excluded.alias,
                    orden = excluded.orden
                """,
                (nombre, dropi, alias, orden),
            )
            self.conn.execute(
                """
                INSERT INTO prefijo_transportadora (transportadora_id, prefijo)
                SELECT id, '' FROM transportadora WHERE nombre = ?
                ON CONFLICT(transportadora_id) DO NOTHING
                """,
                (nombre,),
            )
        if self.conn.execute("SELECT 1 FROM usuario LIMIT 1").fetchone() is None:
            ensayo = (
                ("admin", "Administrador", "ADMINISTRADOR"),
                ("coordinacion", "Coordinación de bodega", "COORDINACION"),
                ("alistador1", "Alistador 1", "ALISTADOR"),
                ("alistador2", "Alistador 2", "ALISTADOR"),
                ("despachador", "Despachador", "DESPACHADOR"),
                ("consulta", "Consulta", "CONSULTA"),
            )
            for usuario, nombre, rol in ensayo:
                self.conn.execute(
                    """
                    INSERT INTO usuario (usuario, nombre, pin_hash, rol, activo)
                    VALUES (?, ?, ?, ?, 1)
                    """,
                    (usuario, nombre, hash_pin("1234"), rol),
                )
        self.conn.execute(
            """
            INSERT INTO parametro (clave, valor) VALUES ('lector_verificado', 'no')
            ON CONFLICT(clave) DO NOTHING
            """
        )
        for usuario, nombre, rol in (
            ("garantias", "Garantías", "GARANTIAS"),
            ("devoluciones", "Devoluciones", "DEVOLUCIONES"),
            ("muestras", "Muestras y mayoristas", "MUESTRAS"),
            ("mercadolibre", "Mercado Libre", "MERCADO_LIBRE"),
        ):
            if self.conn.execute("SELECT 1 FROM usuario WHERE usuario = ?", (usuario,)).fetchone() is None:
                self.conn.execute(
                    """
                    INSERT INTO usuario (usuario, nombre, pin_hash, rol, activo)
                    VALUES (?, ?, ?, ?, 1)
                    """,
                    (usuario, nombre, hash_pin("1234"), rol),
                )

    @contextmanager
    def transaccion(self):
        with self._lock:
            try:
                yield self.conn
                self.conn.commit()
            except Exception:
                self.conn.rollback()
                raise

    def respaldar(self) -> Path:
        preparar_carpetas()
        destino = self.ruta.parent / "respaldos" / f"despachos-{datetime.now():%Y%m%d-%H%M%S}.db"
        destino.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            copia = sqlite3.connect(destino)
            try:
                self.conn.backup(copia)
            finally:
                copia.close()
        return destino

    def cerrar(self) -> None:
        self.conn.close()
