"""Capa de datos: SQLite, bitacora encadenada y respaldos.

Dos reglas que atraviesan todo el modulo:

1. **Nada se borra.** Los registros se anulan o se desactivan, con motivo y
   responsable. Es la unica forma de que la bitacora sirva para auditar.

2. **Cada cambio deja rastro.** El cambio y su registro en la bitacora se
   guardan en la misma transaccion. Si algo falla, no queda nada a medias.

La bitacora va encadenada por huella: cada fila incluye la huella de la
anterior. Si alguien edita o borra una fila directamente en el archivo .db, la
cadena se rompe y `verificar_bitacora()` lo detecta.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

import config

ESQUEMA_VERSION = 2

# Las etapas del alistamiento, en orden. Una no se puede marcar si la anterior
# no esta hecha: no se empaca lo que no se embolso.
ETAPAS = ("revisado", "embolsado", "empacado")
ETIQUETA_ETAPA = {"revisado": "Revisado", "embolsado": "En bolsas", "empacado": "Empacado"}


# ── Conexion ─────────────────────────────────────────────────────────────────

_conexion: sqlite3.Connection | None = None


def conectar(ruta: str | Path | None = None) -> sqlite3.Connection:
    """Abre la base y la deja lista. Reutiliza la conexion si ya existe."""
    global _conexion
    if _conexion is not None:
        return _conexion
    destino = Path(ruta or config.RUTA_BASE_DATOS)
    destino.parent.mkdir(parents=True, exist_ok=True)
    _conexion = sqlite3.connect(str(destino), check_same_thread=False)
    _conexion.row_factory = sqlite3.Row
    _conexion.execute("PRAGMA foreign_keys = ON")
    # WAL permite leer mientras se escribe; hace falta cuando la pantalla de
    # escaneo consulta al mismo tiempo que se graba.
    _conexion.execute("PRAGMA journal_mode = WAL")
    crear_esquema(_conexion)
    return _conexion


def cerrar() -> None:
    global _conexion
    if _conexion is not None:
        _conexion.close()
        _conexion = None


@contextmanager
def transaccion(cx: sqlite3.Connection | None = None):
    """Agrupa varias escrituras. Si algo falla, no se guarda nada."""
    cx = cx or conectar()
    try:
        yield cx
        cx.commit()
    except Exception:
        cx.rollback()
        raise


# ── Esquema ──────────────────────────────────────────────────────────────────

_TABLAS = """
CREATE TABLE IF NOT EXISTS usuario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  rol TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transportadora (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  nombre_dropi TEXT NOT NULL,
  alias TEXT NOT NULL DEFAULT '',
  activa INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS producto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_interno TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  es_fisico INTEGER NOT NULL DEFAULT 1,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equivalencia_dropi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_dropi TEXT NOT NULL DEFAULT '',
  id_dropi TEXT NOT NULL DEFAULT '',
  nombre_dropi TEXT NOT NULL DEFAULT '',
  producto_id INTEGER NOT NULL REFERENCES producto(id),
  creado_por INTEGER REFERENCES usuario(id),
  creado_en TEXT NOT NULL,
  UNIQUE (sku_dropi, id_dropi)
);

CREATE TABLE IF NOT EXISTS corte (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  transportadora_id INTEGER NOT NULL REFERENCES transportadora(id),
  numero INTEGER NOT NULL,
  fecha_manifiesto TEXT,
  estado TEXT NOT NULL DEFAULT 'abierto',
  creado_por INTEGER REFERENCES usuario(id),
  creado_en TEXT NOT NULL,
  cerrado_por INTEGER REFERENCES usuario(id),
  cerrado_en TEXT,
  auxiliar_nombre TEXT DEFAULT '',
  vehiculo_placa TEXT DEFAULT '',
  hora_entrega TEXT DEFAULT '',
  entregado_por INTEGER REFERENCES usuario(id),
  UNIQUE (fecha, transportadora_id, numero)
);

CREATE TABLE IF NOT EXISTS archivo_pdf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corte_id INTEGER NOT NULL REFERENCES corte(id),
  nombre_archivo TEXT NOT NULL,
  hash_sha256 TEXT NOT NULL UNIQUE,
  paginas INTEGER NOT NULL DEFAULT 0,
  guias_detectadas INTEGER NOT NULL DEFAULT 0,
  cargado_por INTEGER REFERENCES usuario(id),
  cargado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corte_id INTEGER NOT NULL REFERENCES corte(id),
  numero TEXT NOT NULL,
  consecutivo INTEGER,
  ciudad_destino TEXT DEFAULT '',
  valor_recaudo REAL DEFAULT 0,
  tipo_logistica TEXT DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'pendiente',
  escaneada_por INTEGER REFERENCES usuario(id),
  escaneada_en TEXT,
  UNIQUE (corte_id, numero)
);

CREATE TABLE IF NOT EXISTS guia_producto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guia_id INTEGER NOT NULL REFERENCES guia(id),
  sku_dropi TEXT DEFAULT '',
  id_dropi TEXT DEFAULT '',
  nombre_dropi TEXT DEFAULT '',
  producto_id INTEGER REFERENCES producto(id),
  cantidad INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS resumen_producto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corte_id INTEGER NOT NULL REFERENCES corte(id),
  sku_dropi TEXT DEFAULT '',
  id_dropi TEXT DEFAULT '',
  nombre_dropi TEXT DEFAULT '',
  producto_id INTEGER REFERENCES producto(id),
  cantidad INTEGER NOT NULL DEFAULT 0
);

-- Reparte el trabajo de un corte. Varias filas por corte: una
-- transportadora puede ir a dos o mas personas, y todas trabajan sobre la
-- misma lista.
CREATE TABLE IF NOT EXISTS asignacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corte_id INTEGER NOT NULL REFERENCES corte(id),
  usuario_id INTEGER NOT NULL REFERENCES usuario(id),
  estado TEXT NOT NULL DEFAULT 'asignada',
  asignado_por INTEGER REFERENCES usuario(id),
  asignado_en TEXT NOT NULL,
  terminada_en TEXT,
  UNIQUE (corte_id, usuario_id)
);

-- Las tres etapas se registran por separado, cada una con quien la hizo:
-- es lo que permite responder «quien alisto esto» cuando una guia sale mal.
CREATE TABLE IF NOT EXISTS alistamiento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corte_id INTEGER NOT NULL REFERENCES corte(id),
  producto_id INTEGER REFERENCES producto(id),
  nombre_mostrado TEXT NOT NULL DEFAULT '',
  cantidad INTEGER NOT NULL DEFAULT 0,
  revisado INTEGER NOT NULL DEFAULT 0,
  revisado_por INTEGER REFERENCES usuario(id),
  revisado_en TEXT,
  embolsado INTEGER NOT NULL DEFAULT 0,
  embolsado_por INTEGER REFERENCES usuario(id),
  embolsado_en TEXT,
  empacado INTEGER NOT NULL DEFAULT 0,
  empacado_por INTEGER REFERENCES usuario(id),
  empacado_en TEXT
);

CREATE TABLE IF NOT EXISTS escaneo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corte_id INTEGER REFERENCES corte(id),
  guia_id INTEGER REFERENCES guia(id),
  numero_escaneado TEXT NOT NULL,
  resultado TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuario(id),
  momento TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS represado (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guia_id INTEGER NOT NULL REFERENCES guia(id),
  corte_origen_id INTEGER NOT NULL REFERENCES corte(id),
  motivo TEXT NOT NULL,
  nota TEXT DEFAULT '',
  registrado_por INTEGER REFERENCES usuario(id),
  registrado_en TEXT NOT NULL,
  corte_destino_id INTEGER REFERENCES corte(id),
  reasignado_por INTEGER REFERENCES usuario(id),
  reasignado_en TEXT
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  momento TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuario(id),
  usuario_nombre TEXT DEFAULT '',
  accion TEXT NOT NULL,
  entidad TEXT DEFAULT '',
  entidad_id INTEGER,
  detalle TEXT DEFAULT '',
  hash_anterior TEXT NOT NULL DEFAULT '0',
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parametro (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_guia_numero ON guia(numero);
CREATE INDEX IF NOT EXISTS ix_guia_corte ON guia(corte_id);
CREATE INDEX IF NOT EXISTS ix_gp_guia ON guia_producto(guia_id);
CREATE INDEX IF NOT EXISTS ix_corte_fecha ON corte(fecha);
CREATE INDEX IF NOT EXISTS ix_escaneo_corte ON escaneo(corte_id);
CREATE INDEX IF NOT EXISTS ix_equiv ON equivalencia_dropi(sku_dropi, id_dropi);
CREATE INDEX IF NOT EXISTS ix_asig_corte ON asignacion(corte_id);
CREATE INDEX IF NOT EXISTS ix_asig_usuario ON asignacion(usuario_id);
"""


def crear_esquema(cx: sqlite3.Connection) -> None:
    """Crea las tablas y los datos iniciales. Se puede llamar siempre."""
    cx.executescript(_TABLAS)
    cx.execute("INSERT OR IGNORE INTO parametro (clave, valor) VALUES ('esquema_version', ?)",
               (str(ESQUEMA_VERSION),))
    for clave, valor in config.PARAMETROS_INICIALES.items():
        cx.execute("INSERT OR IGNORE INTO parametro (clave, valor) VALUES (?, ?)", (clave, valor))
    for orden, (nombre, dropi, alias) in enumerate(config.TRANSPORTADORAS_INICIALES):
        cx.execute(
            "INSERT OR IGNORE INTO transportadora (nombre, nombre_dropi, alias, orden) VALUES (?,?,?,?)",
            (nombre, dropi, alias, orden),
        )
    # Usuario inicial para poder entrar la primera vez. El PIN se cambia desde
    # la pantalla de configuracion.
    if not cx.execute("SELECT 1 FROM usuario LIMIT 1").fetchone():
        cx.execute(
            "INSERT INTO usuario (usuario, nombre, pin_hash, rol, creado_en) VALUES (?,?,?,?,?)",
            ("admin", "Administrador", cifrar_pin("1234"), "Administrador", _ahora()),
        )
    cx.commit()


# ── Utilidades ───────────────────────────────────────────────────────────────

def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def cifrar_pin(pin: str) -> str:
    """El PIN nunca se guarda en claro."""
    return hashlib.sha256(f"despachos::{pin}".encode("utf-8")).hexdigest()


def verificar_pin(pin: str, guardado: str) -> bool:
    return cifrar_pin(pin) == guardado


def _huella(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()[:32]


# ── Bitacora ─────────────────────────────────────────────────────────────────

def registrar(cx: sqlite3.Connection, usuario: dict | None, accion: str,
              entidad: str = "", entidad_id: int | None = None,
              detalle: dict | None = None) -> None:
    """Agrega una entrada a la bitacora, encadenada con la anterior.

    Se llama dentro de la misma transaccion que el cambio que describe, para
    que no pueda existir uno sin el otro.
    """
    fila = cx.execute("SELECT hash FROM auditoria ORDER BY id DESC LIMIT 1").fetchone()
    anterior = fila["hash"] if fila else "0"
    momento = _ahora()
    cuerpo = json.dumps(detalle or {}, ensure_ascii=False, sort_keys=True)
    usuario_id = (usuario or {}).get("id")
    usuario_nombre = (usuario or {}).get("nombre", "Sistema")
    actual = _huella(f"{anterior}|{momento}|{usuario_id}|{accion}|{entidad}|{entidad_id}|{cuerpo}")
    cx.execute(
        "INSERT INTO auditoria (momento, usuario_id, usuario_nombre, accion, entidad,"
        " entidad_id, detalle, hash_anterior, hash) VALUES (?,?,?,?,?,?,?,?,?)",
        (momento, usuario_id, usuario_nombre, accion, entidad, entidad_id,
         cuerpo, anterior, actual),
    )


def verificar_bitacora(cx: sqlite3.Connection | None = None) -> dict:
    """Recorre la cadena y avisa si fue alterada.

    Devuelve {ok, total, rota_en}. `rota_en` es el id de la primera fila cuya
    huella no corresponde, o None si la cadena esta intacta.
    """
    cx = cx or conectar()
    anterior = "0"
    total = 0
    for f in cx.execute("SELECT * FROM auditoria ORDER BY id"):
        total += 1
        esperado = _huella(
            f"{anterior}|{f['momento']}|{f['usuario_id']}|{f['accion']}|"
            f"{f['entidad']}|{f['entidad_id']}|{f['detalle']}"
        )
        if f["hash_anterior"] != anterior or f["hash"] != esperado:
            return {"ok": False, "total": total, "rota_en": f["id"]}
        anterior = f["hash"]
    return {"ok": True, "total": total, "rota_en": None}


# ── Parametros ───────────────────────────────────────────────────────────────

def parametro(clave: str, por_defecto: str = "") -> str:
    f = conectar().execute("SELECT valor FROM parametro WHERE clave = ?", (clave,)).fetchone()
    return f["valor"] if f else por_defecto


def guardar_parametro(clave: str, valor: str, usuario: dict | None = None) -> None:
    with transaccion() as cx:
        cx.execute("INSERT INTO parametro (clave, valor) VALUES (?,?) "
                   "ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", (clave, str(valor)))
        registrar(cx, usuario, "parametro.cambiar", "parametro", None,
                  {"clave": clave, "valor": str(valor)})


# ── Consultas de apoyo ───────────────────────────────────────────────────────

def transportadoras(solo_activas: bool = True) -> list[sqlite3.Row]:
    sql = "SELECT * FROM transportadora"
    if solo_activas:
        sql += " WHERE activa = 1"
    return conectar().execute(sql + " ORDER BY orden, nombre").fetchall()


def buscar_transportadora(nombre_dropi: str) -> sqlite3.Row | None:
    """Ubica la transportadora por su nombre, el de DROPI o sus alias."""
    objetivo = (nombre_dropi or "").strip().upper()
    if not objetivo:
        return None
    for t in conectar().execute("SELECT * FROM transportadora"):
        candidatos = {t["nombre"].upper(), (t["nombre_dropi"] or "").upper()}
        candidatos |= {a.strip().upper() for a in (t["alias"] or "").split(";") if a.strip()}
        if objetivo in candidatos:
            return t
    return None


def siguiente_numero_corte(fecha: str, transportadora_id: int) -> int:
    """El siguiente corte del dia para esa transportadora. El usuario puede cambiarlo."""
    f = conectar().execute(
        "SELECT MAX(numero) AS n FROM corte WHERE fecha = ? AND transportadora_id = ?",
        (fecha, transportadora_id),
    ).fetchone()
    return int((f["n"] or 0)) + 1


def pdf_ya_cargado(hash_sha256: str) -> sqlite3.Row | None:
    return conectar().execute(
        "SELECT a.*, c.fecha, c.numero AS corte, t.nombre AS transportadora"
        " FROM archivo_pdf a JOIN corte c ON c.id = a.corte_id"
        " JOIN transportadora t ON t.id = c.transportadora_id"
        " WHERE a.hash_sha256 = ?", (hash_sha256,)).fetchone()


def guias_en_otros_cortes(numeros: list[str]) -> list[sqlite3.Row]:
    """Guias que ya existen en otro corte. Se usa para avisar de duplicados."""
    if not numeros:
        return []
    marcas = ",".join("?" * len(numeros))
    return conectar().execute(
        f"SELECT g.numero, g.estado, c.fecha, c.numero AS corte, t.nombre AS transportadora"
        f" FROM guia g JOIN corte c ON c.id = g.corte_id"
        f" JOIN transportadora t ON t.id = c.transportadora_id"
        f" WHERE g.numero IN ({marcas})", numeros).fetchall()


def equivalencia(sku_dropi: str, id_dropi: str) -> sqlite3.Row | None:
    """La identidad es la pareja SKU + ID: un mismo SKU trae varios ID."""
    return conectar().execute(
        "SELECT e.*, p.codigo_interno, p.nombre AS producto_nombre, p.es_fisico"
        " FROM equivalencia_dropi e JOIN producto p ON p.id = e.producto_id"
        " WHERE e.sku_dropi = ? AND e.id_dropi = ?",
        (sku_dropi or "", id_dropi or "")).fetchone()


def crear_producto(codigo: str, nombre: str, es_fisico: bool = True,
                   usuario: dict | None = None) -> int:
    with transaccion() as cx:
        cur = cx.execute(
            "INSERT INTO producto (codigo_interno, nombre, es_fisico, creado_en) VALUES (?,?,?,?)",
            (codigo.strip(), nombre.strip(), 1 if es_fisico else 0, _ahora()))
        pid = int(cur.lastrowid)
        registrar(cx, usuario, "producto.crear", "producto", pid,
                  {"codigo": codigo, "nombre": nombre})
        return pid


def crear_equivalencia(sku_dropi: str, id_dropi: str, nombre_dropi: str,
                       producto_id: int, usuario: dict | None = None) -> int:
    with transaccion() as cx:
        cur = cx.execute(
            "INSERT INTO equivalencia_dropi (sku_dropi, id_dropi, nombre_dropi, producto_id,"
            " creado_por, creado_en) VALUES (?,?,?,?,?,?)",
            (sku_dropi or "", id_dropi or "", nombre_dropi or "", producto_id,
             (usuario or {}).get("id"), _ahora()))
        eid = int(cur.lastrowid)
        registrar(cx, usuario, "equivalencia.crear", "equivalencia_dropi", eid,
                  {"sku": sku_dropi, "id_dropi": id_dropi, "producto_id": producto_id})
        return eid


# ── Respaldo ─────────────────────────────────────────────────────────────────

def respaldar(carpeta: str | Path | None = None) -> Path:
    """Copia la base a la carpeta de respaldos. Usa el metodo propio de SQLite,
    que es seguro aunque la base este en uso."""
    destino_dir = Path(carpeta or parametro("carpeta_respaldos", str(config.CARPETA_RESPALDOS)))
    destino_dir.mkdir(parents=True, exist_ok=True)
    destino = destino_dir / f"despachos_{datetime.now():%Y-%m-%d_%H%M%S}.db"
    cx = conectar()
    copia = sqlite3.connect(str(destino))
    with copia:
        cx.backup(copia)
    copia.close()
    return destino


def limpiar_respaldos(dias: int | None = None) -> int:
    """Borra respaldos mas viejos que el limite. Devuelve cuantos quito."""
    limite = int(dias if dias is not None else parametro("dias_retencion_respaldos", "30"))
    carpeta = Path(parametro("carpeta_respaldos", str(config.CARPETA_RESPALDOS)))
    if not carpeta.exists():
        return 0
    corte = datetime.now().timestamp() - limite * 86400
    quitados = 0
    for archivo in carpeta.glob("despachos_*.db"):
        if archivo.stat().st_mtime < corte:
            archivo.unlink()
            quitados += 1
    return quitados


def respaldo_diario() -> Path | None:
    """Respalda una vez al dia, al abrir la aplicacion."""
    hoy = date.today().isoformat()
    if parametro("ultimo_respaldo") == hoy:
        return None
    destino = respaldar()
    guardar_parametro("ultimo_respaldo", hoy)
    limpiar_respaldos()
    config.registro.info("Respaldo diario en %s", destino)
    return destino
