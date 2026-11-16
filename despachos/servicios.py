"""Reglas de la Fase 1. revisar no escribe el corte. guardar escribe solo si ya no hay bloqueos."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from despachos.auditoria import registrar
from despachos.db import BaseDatos, verifica_pin
from despachos.parser_dropi import Revision

ETAPAS = ("revisado", "embolsado", "empacado")


class ReglaError(Exception):
    """La operación no cumple una regla de bodega. El mensaje va a la pantalla."""


def autenticar(base: BaseDatos, usuario: str, pin: str) -> sqlite3.Row:
    mensaje = None
    usuario_id = None
    with base.transaccion() as conn:
        fila = conn.execute("SELECT * FROM usuario WHERE usuario = ?", (usuario.strip(),)).fetchone()
        if fila is not None and fila["bloqueado_hasta"] and datetime.now() < datetime.fromisoformat(fila["bloqueado_hasta"]):
            mensaje = "Demasiados intentos. Espera 30 segundos."
        elif fila is None or not verifica_pin(pin, fila["pin_hash"]):
            if fila is not None:
                intentos = int(fila["intentos_fallidos"]) + 1
                bloqueo = None
                if intentos >= 3:
                    bloqueo = (datetime.now() + timedelta(seconds=30)).isoformat(timespec="seconds")
                    intentos = 0
                conn.execute(
                    "UPDATE usuario SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?",
                    (intentos, bloqueo, fila["id"]),
                )
                registrar(conn, fila["id"], "ingreso.fallido", usuario.strip())
            mensaje = "Usuario o PIN incorrecto."
        elif not fila["activo"]:
            mensaje = "Este usuario está inactivo. Pide a Coordinación que lo habilite."
        else:
            conn.execute(
                "UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?",
                (fila["id"],),
            )
            registrar(conn, fila["id"], "ingreso.ok", fila["usuario"])
            usuario_id = fila["id"]
    if mensaje:
        raise ReglaError(mensaje)
    return base.conn.execute("SELECT * FROM usuario WHERE id = ?", (usuario_id,)).fetchone()


def aplicar_equivalencias(base: BaseDatos, revision: Revision) -> Revision:
    with base.transaccion() as conn:
        for item in revision.resumen:
            if revision.plataforma == "DROPI":
                fila = conn.execute(
                    """
                    SELECT producto_id FROM equivalencia_dropi
                    WHERE sku_dropi = ? AND id_dropi = ?
                    """,
                    (item.sku, item.id_dropi),
                ).fetchone()
            else:
                referencia = item.id_dropi or item.nombre
                fila = conn.execute(
                    """
                    SELECT producto_id FROM equivalencia_plataforma
                    WHERE plataforma = ? AND referencia = ?
                    """,
                    (revision.plataforma, referencia),
                ).fetchone()
            item.producto_id = fila["producto_id"] if fila else None
        faltan = [item for item in revision.resumen if item.producto_id is None and (item.id_dropi or item.sku or item.nombre)]
        revision.bloqueos = [mensaje for mensaje in revision.bloqueos if not mensaje.startswith("Faltan ")]
        if faltan:
            revision.bloqueos.append(f"Faltan {len(faltan)} productos por asociar. El corte no se guarda hasta terminar la lista.")
        repetida = conn.execute("SELECT corte_id FROM archivo_pdf WHERE huella = ?", (revision.huella,)).fetchone()
        revision.bloqueos = [mensaje for mensaje in revision.bloqueos if not mensaje.startswith("Este manifiesto ya")]
        if repetida:
            corte = conn.execute(
                """
                SELECT c.numero, c.fecha, t.nombre
                FROM corte c JOIN transportadora t ON t.id = c.transportadora_id
                WHERE c.id = ?
                """,
                (repetida["corte_id"],),
            ).fetchone()
            revision.bloqueos.append(
                f"Este manifiesto ya fue cargado el {corte['fecha']} en el corte {corte['numero']} de {corte['nombre']}."
            )
        revision.avisos = [mensaje for mensaje in revision.avisos if not mensaje.startswith("La guía ")]
        for guia in revision.guias:
            previa = conn.execute(
                """
                SELECT c.numero, c.fecha FROM guia g
                JOIN corte c ON c.id = g.corte_id
                WHERE g.numero = ? AND c.anulado = 0
                ORDER BY c.id DESC LIMIT 1
                """,
                (guia.numero,),
            ).fetchone()
            if previa:
                revision.avisos.append(
                    f"La guía {guia.numero} ya está en el corte {previa['numero']} del {previa['fecha']}. Puedes continuar."
                )
    return revision


def asociar_producto(
    base: BaseDatos,
    usuario_id: int,
    sku: str,
    id_dropi: str,
    nombre_dropi: str,
    producto_id: int,
    plataforma: str = "DROPI",
) -> None:
    with base.transaccion() as conn:
        if plataforma == "DROPI":
            if not id_dropi and not sku:
                raise ReglaError("La equivalencia necesita el ID o el SKU de DROPI.")
            conn.execute(
                """
                INSERT INTO equivalencia_dropi (sku_dropi, id_dropi, nombre_dropi, producto_id)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(sku_dropi, id_dropi) DO UPDATE SET
                    producto_id = excluded.producto_id,
                    nombre_dropi = excluded.nombre_dropi
                """,
                (sku, id_dropi, nombre_dropi, producto_id),
            )
        else:
            referencia = id_dropi or nombre_dropi
            if not referencia:
                raise ReglaError("La equivalencia necesita la referencia de la plataforma.")
            conn.execute(
                """
                INSERT INTO equivalencia_plataforma (plataforma, referencia, nombre_origen, producto_id)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(plataforma, referencia) DO UPDATE SET
                    producto_id = excluded.producto_id,
                    nombre_origen = excluded.nombre_origen
                """,
                (plataforma, referencia, nombre_dropi, producto_id),
            )
        registrar(conn, usuario_id, "equivalencia.asociar", f"{plataforma}|{sku}|{id_dropi}|producto {producto_id}")


def crear_producto(base: BaseDatos, usuario_id: int, codigo: str, nombre: str) -> int:
    codigo = codigo.strip()
    nombre = nombre.strip()
    if not codigo or not nombre:
        raise ReglaError("El producto necesita código y nombre.")
    with base.transaccion() as conn:
        try:
            cursor = conn.execute(
                "INSERT INTO producto (codigo_interno, nombre, es_fisico, activo) VALUES (?, ?, 1, 1)",
                (codigo, nombre),
            )
        except sqlite3.IntegrityError as exc:
            raise ReglaError("Ese código interno ya existe.") from exc
        registrar(conn, usuario_id, "producto.crear", f"{codigo}|{nombre}")
        return int(cursor.lastrowid)


def sugerir_numero(base: BaseDatos, fecha: str, transportadora_id: int) -> int:
    fila = base.conn.execute(
        """
        SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente
        FROM corte WHERE fecha = ? AND transportadora_id = ? AND anulado = 0
        """,
        (fecha, transportadora_id),
    ).fetchone()
    return int(fila["siguiente"])


def guardar_corte(base: BaseDatos, revision: Revision, numero: int, usuario_id: int, confirmo_totales: bool) -> int:
    if numero < 1:
        raise ReglaError("El número de corte tiene que ser mayor que cero.")
    if revision.bloqueos:
        raise ReglaError(revision.bloqueos[0])
    if not revision.lector_verificado and not confirmo_totales:
        raise ReglaError("Confirma que revisaste transportadora, guías y unidades.")
    if not revision.transportadora:
        raise ReglaError("El PDF no trae una transportadora reconocida.")
    if not revision.fecha:
        raise ReglaError("El PDF no trae la fecha del manifiesto.")
    if not revision.resumen:
        raise ReglaError("El PDF no trae resumen de productos.")
    with base.transaccion() as conn:
        if conn.execute("SELECT 1 FROM archivo_pdf WHERE huella = ?", (revision.huella,)).fetchone():
            raise ReglaError("Este manifiesto ya fue cargado.")
        transportadora = conn.execute(
            "SELECT id, nombre FROM transportadora WHERE nombre_dropi = ? OR nombre = ?",
            (revision.transportadora, revision.transportadora),
        ).fetchone()
        if transportadora is None:
            raise ReglaError(f"La transportadora {revision.transportadora} no está en el catálogo.")
        ocupado = conn.execute(
            """
            SELECT 1 FROM corte
            WHERE fecha = ? AND transportadora_id = ? AND numero = ? AND anulado = 0
            """,
            (revision.fecha, transportadora["id"], numero),
        ).fetchone()
        if ocupado:
            raise ReglaError("Ese número de corte ya existe para esa transportadora en la fecha.")
        cursor = conn.execute(
            """
            INSERT INTO corte (fecha, transportadora_id, numero, estado, cargado_por, creado_en, plataforma)
            VALUES (?, ?, ?, 'guardado', ?, ?, ?)
            """,
            (revision.fecha, transportadora["id"], numero, usuario_id, _ahora(), revision.plataforma),
        )
        corte_id = int(cursor.lastrowid)
        conn.execute(
            "INSERT INTO archivo_pdf (corte_id, nombre, huella, ruta) VALUES (?, ?, ?, ?)",
            (corte_id, revision.nombre_archivo, revision.huella, ""),
        )
        for guia in revision.guias:
            guia_id = conn.execute(
                """
                INSERT INTO guia (corte_id, numero, consecutivo, ciudad, recaudo, tipo, relacion_despacho, estado_origen)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    corte_id,
                    guia.numero,
                    guia.consecutivo,
                    guia.ciudad,
                    guia.recaudo,
                    guia.tipo,
                    guia.relacion_despacho,
                    guia.estado_origen,
                ),
            ).lastrowid
            if guia.texto_rotulo:
                conn.execute(
                    "INSERT INTO guia_producto (guia_id, texto_crudo) VALUES (?, ?)",
                    (guia_id, guia.texto_rotulo),
                )
        totales: dict[int, int] = {}
        for item in revision.resumen:
            if item.producto_id is None:
                raise ReglaError("Faltan productos por asociar.")
            conn.execute(
                """
                INSERT INTO resumen_producto
                    (corte_id, sku_dropi, id_dropi, nombre_dropi, cantidad, producto_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (corte_id, item.sku, item.id_dropi, item.nombre, item.cantidad, item.producto_id),
            )
            totales[item.producto_id] = totales.get(item.producto_id, 0) + item.cantidad
        for producto_id, cantidad in totales.items():
            conn.execute(
                "INSERT INTO alistamiento (corte_id, producto_id, cantidad) VALUES (?, ?, ?)",
                (corte_id, producto_id, cantidad),
            )
        registrar(
            conn,
            usuario_id,
            "corte.guardar",
            f"corte {numero}|{transportadora['nombre']}|{len(revision.guias)} guias",
        )
        return corte_id


def asignar(base: BaseDatos, corte_id: int, usuario_ids: list[int], asignado_por: int) -> None:
    if not usuario_ids:
        raise ReglaError("Elige al menos una persona.")
    with base.transaccion() as conn:
        corte = conn.execute("SELECT * FROM corte WHERE id = ? AND anulado = 0", (corte_id,)).fetchone()
        if corte is None:
            raise ReglaError("Ese corte no está disponible.")
        quien_asigna = conn.execute("SELECT rol FROM usuario WHERE id = ?", (asignado_por,)).fetchone()
        for usuario_id in usuario_ids:
            persona = conn.execute(
                "SELECT id, rol, nombre, activo FROM usuario WHERE id = ?",
                (usuario_id,),
            ).fetchone()
            if persona is None or not persona["activo"] or persona["rol"] != "ALISTADOR":
                raise ReglaError("Solo se asigna a alistadores activos.")
            if usuario_id == corte["cargado_por"] and quien_asigna["rol"] != "ADMINISTRADOR":
                raise ReglaError("Quien cargó el corte no puede alistarlo. Elige a otra persona.")
            conn.execute(
                """
                INSERT INTO asignacion (corte_id, usuario_id, asignado_por, asignado_en, estado)
                VALUES (?, ?, ?, ?, 'asignada')
                ON CONFLICT(corte_id, usuario_id) DO UPDATE SET
                    asignado_por = excluded.asignado_por,
                    asignado_en = excluded.asignado_en,
                    estado = 'asignada',
                    terminada_en = NULL
                """,
                (corte_id, usuario_id, asignado_por, _ahora()),
            )
        conn.execute("UPDATE corte SET estado = 'asignado' WHERE id = ?", (corte_id,))
        if quien_asigna["rol"] == "ADMINISTRADOR" and asignado_por == corte["cargado_por"] and asignado_por in usuario_ids:
            registrar(conn, asignado_por, "asignacion.excepcion_admin", f"corte {corte_id}")
        registrar(conn, asignado_por, "corte.asignar", f"corte {corte_id}|{','.join(str(item) for item in usuario_ids)}")


def marcar_etapa(base: BaseDatos, alistamiento_id: int, etapa: str, usuario_id: int, marcar: bool) -> None:
    if etapa not in ETAPAS:
        raise ReglaError("Etapa desconocida.")
    with base.transaccion() as conn:
        fila = conn.execute("SELECT * FROM alistamiento WHERE id = ?", (alistamiento_id,)).fetchone()
        if fila is None:
            raise ReglaError("No se encontró el producto del alistamiento.")
        if not _esta_asignado(conn, fila["corte_id"], usuario_id):
            raise ReglaError("Este corte no está en tus asignaciones.")
        indice = ETAPAS.index(etapa)
        if marcar:
            for previa in ETAPAS[:indice]:
                if not fila[previa]:
                    raise ReglaError("Primero marca la etapa anterior.")
            conn.execute(
                f"UPDATE alistamiento SET {etapa} = 1, {etapa}_por = ?, {etapa}_en = ? WHERE id = ?",
                (usuario_id, _ahora(), alistamiento_id),
            )
        else:
            posteriores = ETAPAS[indice:]
            asignaciones = ", ".join(f"{nombre} = 0, {nombre}_por = NULL, {nombre}_en = NULL" for nombre in posteriores)
            conn.execute(f"UPDATE alistamiento SET {asignaciones} WHERE id = ?", (alistamiento_id,))
        registrar(conn, usuario_id, "alistamiento.marcar" if marcar else "alistamiento.desmarcar", f"{alistamiento_id}|{etapa}")
        _actualizar_estado_corte(conn, fila["corte_id"])


def terminar_parte(base: BaseDatos, asignacion_id: int, usuario_id: int) -> None:
    with base.transaccion() as conn:
        asignacion = conn.execute("SELECT * FROM asignacion WHERE id = ?", (asignacion_id,)).fetchone()
        if asignacion is None or asignacion["usuario_id"] != usuario_id:
            raise ReglaError("Esta asignación no es tuya.")
        pendiente = conn.execute(
            "SELECT 1 FROM alistamiento WHERE corte_id = ? AND empacado = 0",
            (asignacion["corte_id"],),
        ).fetchone()
        if pendiente:
            raise ReglaError("Todavía hay productos sin empacar.")
        conn.execute(
            "UPDATE asignacion SET estado = 'terminada', terminada_en = ? WHERE id = ?",
            (_ahora(), asignacion_id),
        )
        registrar(conn, usuario_id, "asignacion.terminar", f"asignacion {asignacion_id}")


def _esta_asignado(conn: sqlite3.Connection, corte_id: int, usuario_id: int) -> bool:
    rol = conn.execute("SELECT rol FROM usuario WHERE id = ?", (usuario_id,)).fetchone()
    if rol and rol["rol"] == "ADMINISTRADOR":
        return True
    return (
        conn.execute(
            "SELECT 1 FROM asignacion WHERE corte_id = ? AND usuario_id = ?",
            (corte_id, usuario_id),
        ).fetchone()
        is not None
    )


def _actualizar_estado_corte(conn: sqlite3.Connection, corte_id: int) -> None:
    total = conn.execute("SELECT COUNT(*) AS n FROM alistamiento WHERE corte_id = ?", (corte_id,)).fetchone()["n"]
    empacados = conn.execute(
        "SELECT COUNT(*) AS n FROM alistamiento WHERE corte_id = ? AND empacado = 1",
        (corte_id,),
    ).fetchone()["n"]
    estado = "alistamiento_terminado" if total and empacados == total else "en_alistamiento"
    conn.execute("UPDATE corte SET estado = ? WHERE id = ?", (estado, corte_id))


def crear_usuario(base: BaseDatos, actor_id: int, usuario: str, nombre: str, pin: str, rol: str) -> None:
    from despachos.db import hash_pin

    if len(pin) < 4:
        raise ReglaError("El PIN tiene al menos 4 dígitos.")
    with base.transaccion() as conn:
        try:
            conn.execute(
                "INSERT INTO usuario (usuario, nombre, pin_hash, rol, activo) VALUES (?, ?, ?, ?, 1)",
                (usuario.strip(), nombre.strip(), hash_pin(pin), rol),
            )
        except sqlite3.IntegrityError as exc:
            raise ReglaError("Ese usuario ya existe.") from exc
        registrar(conn, actor_id, "usuario.crear", f"{usuario}|{rol}")


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def normalizar_codigo(codigo: str, prefijo: str = "") -> str:
    """Quita espacios y, si la transportadora tiene prefijo, lo retira del inicio."""
    limpio = "".join(str(codigo).split()).upper()
    prefijo_limpio = "".join(str(prefijo).split()).upper()
    if prefijo_limpio and limpio.startswith(prefijo_limpio):
        return limpio[len(prefijo_limpio) :]
    return limpio


def definir_prefijo(base: BaseDatos, transportadora_id: int, prefijo: str, usuario_id: int) -> None:
    with base.transaccion() as conn:
        conn.execute(
            """
            INSERT INTO prefijo_transportadora (transportadora_id, prefijo)
            VALUES (?, ?)
            ON CONFLICT(transportadora_id) DO UPDATE SET prefijo = excluded.prefijo
            """,
            (transportadora_id, "".join(prefijo.split()).upper()),
        )
        registrar(conn, usuario_id, "prefijo.definir", f"{transportadora_id}|{prefijo}")


def escanear(base: BaseDatos, corte_id: int, codigo: str, usuario_id: int) -> dict:
    if not str(codigo).strip():
        raise ReglaError("El lector no envió un código.")
    with base.transaccion() as conn:
        corte = _corte_abierto(conn, corte_id)
        _exigir_despacho(conn, usuario_id)
        prefijo = conn.execute(
            "SELECT prefijo FROM prefijo_transportadora WHERE transportadora_id = ?",
            (corte["transportadora_id"],),
        ).fetchone()
        normalizado = normalizar_codigo(codigo, prefijo["prefijo"] if prefijo else "")
        guia = conn.execute(
            "SELECT * FROM guia WHERE corte_id = ? AND numero = ? AND anulado = 0",
            (corte_id, normalizado),
        ).fetchone()
        if guia is not None and guia["estado"] == "verificada":
            _insertar_escaneo(conn, guia["id"], codigo, normalizado, "repetido", usuario_id)
            registrar(conn, usuario_id, "escaneo.repetido", normalizado)
            mensaje = "Esta guía ya fue verificada. El conteo no cambia."
            resultado = "repetido"
        elif guia is not None and guia["estado"] == "represada":
            _insertar_escaneo(conn, guia["id"], codigo, normalizado, "represada", usuario_id)
            registrar(conn, usuario_id, "escaneo.represada", normalizado)
            mensaje = "Esta guía está represada. El conteo no cambia."
            resultado = "represada"
        elif guia is not None:
            conn.execute("UPDATE guia SET estado = 'verificada' WHERE id = ?", (guia["id"],))
            _insertar_escaneo(conn, guia["id"], codigo, normalizado, "verificada", usuario_id)
            registrar(conn, usuario_id, "escaneo.verificar", normalizado)
            mensaje = f"Guía {normalizado} verificada."
            resultado = "verificada"
        else:
            otra = conn.execute(
                """
                SELECT c.numero, c.fecha FROM guia g
                JOIN corte c ON c.id = g.corte_id
                WHERE g.numero = ? AND c.id != ? AND c.anulado = 0
                ORDER BY c.id DESC LIMIT 1
                """,
                (normalizado, corte_id),
            ).fetchone()
            if otra:
                resultado = "otro_corte"
                mensaje = f"La guía {normalizado} está en el corte {otra['numero']} del {otra['fecha']}."
            else:
                resultado = "no_encontrada"
                mensaje = f"La guía {normalizado} no está en este corte."
            _insertar_escaneo(conn, None, codigo, normalizado, resultado, usuario_id)
            registrar(conn, usuario_id, f"escaneo.{resultado}", normalizado)
        conteo = _conteo_guias(conn, corte_id)
    return {"resultado": resultado, "mensaje": mensaje, "numero": normalizado, **conteo}


def marcar_represada(base: BaseDatos, guia_id: int, motivo: str, usuario_id: int) -> None:
    motivo = motivo.strip()
    if not motivo:
        raise ReglaError("El represado necesita un motivo.")
    with base.transaccion() as conn:
        guia = conn.execute("SELECT * FROM guia WHERE id = ? AND anulado = 0", (guia_id,)).fetchone()
        if guia is None:
            raise ReglaError("Esa guía no está disponible.")
        _corte_abierto(conn, guia["corte_id"])
        _exigir_despacho(conn, usuario_id)
        conn.execute("UPDATE guia SET estado = 'represada' WHERE id = ?", (guia_id,))
        vigente = conn.execute(
            "SELECT id FROM represado WHERE guia_id = ? AND anulado = 0",
            (guia_id,),
        ).fetchone()
        if vigente:
            conn.execute("UPDATE represado SET motivo = ?, responsable_id = ? WHERE id = ?", (motivo, usuario_id, vigente["id"]))
        else:
            conn.execute(
                """
                INSERT INTO represado (guia_id, motivo, responsable_id, creado_en)
                VALUES (?, ?, ?, ?)
                """,
                (guia_id, motivo, usuario_id, _ahora()),
            )
        registrar(conn, usuario_id, "represado.crear", f"{guia['numero']}|{motivo}")


def reprogramar(base: BaseDatos, guia_id: int, corte_destino_id: int, usuario_id: int) -> None:
    with base.transaccion() as conn:
        guia = conn.execute("SELECT * FROM guia WHERE id = ? AND estado = 'represada'", (guia_id,)).fetchone()
        if guia is None:
            raise ReglaError("Solo se reprograma una guía represada.")
        if corte_destino_id == guia["corte_id"]:
            raise ReglaError("Elige un corte distinto del actual.")
        destino = conn.execute("SELECT * FROM corte WHERE id = ? AND anulado = 0", (corte_destino_id,)).fetchone()
        if destino is None or destino["estado"] == "cerrado":
            raise ReglaError("El corte de destino no está abierto.")
        _exigir_despacho(conn, usuario_id)
        conn.execute(
            """
            UPDATE represado SET corte_reasignacion_id = ?
            WHERE guia_id = ? AND anulado = 0
            """,
            (corte_destino_id, guia_id),
        )
        registrar(conn, usuario_id, "represado.reprogramar", f"{guia['numero']}|corte {corte_destino_id}")


def cerrar_corte(base: BaseDatos, corte_id: int, usuario_id: int, auxiliar: str, placa: str, hora: str, motivo_cierre: str) -> None:
    auxiliar = auxiliar.strip()
    if not auxiliar:
        raise ReglaError("Indica el auxiliar que recibe la entrega.")
    with base.transaccion() as conn:
        corte = _corte_abierto(conn, corte_id)
        _exigir_despacho(conn, usuario_id)
        pendientes = conn.execute(
            "SELECT COUNT(*) AS n FROM guia WHERE corte_id = ? AND anulado = 0 AND estado = 'cargada'",
            (corte_id,),
        ).fetchone()["n"]
        if pendientes:
            raise ReglaError(f"Quedan {pendientes} guías sin verificar ni represar.")
        sin_empacar = conn.execute(
            "SELECT COUNT(*) AS n FROM alistamiento WHERE corte_id = ? AND empacado = 0",
            (corte_id,),
        ).fetchone()["n"]
        if sin_empacar and not motivo_cierre.strip():
            raise ReglaError("El alistamiento no está terminado. Deja el motivo para cerrar igual.")
        conn.execute(
            """
            UPDATE corte
            SET estado = 'cerrado', auxiliar = ?, placa = ?, hora_entrega = ?, motivo_cierre = ?
            WHERE id = ?
            """,
            (auxiliar, placa.strip(), hora.strip(), motivo_cierre.strip(), corte_id),
        )
        registrar(conn, usuario_id, "corte.cerrar", f"corte {corte['numero']}|{auxiliar}")


def _corte_abierto(conn: sqlite3.Connection, corte_id: int) -> sqlite3.Row:
    corte = conn.execute("SELECT * FROM corte WHERE id = ? AND anulado = 0", (corte_id,)).fetchone()
    if corte is None:
        raise ReglaError("Ese corte no está disponible.")
    if corte["estado"] == "cerrado":
        raise ReglaError("Este corte ya está cerrado.")
    return corte


def _exigir_despacho(conn: sqlite3.Connection, usuario_id: int) -> None:
    rol = conn.execute("SELECT rol FROM usuario WHERE id = ?", (usuario_id,)).fetchone()
    if rol is None or rol["rol"] not in {"DESPACHADOR", "ADMINISTRADOR"}:
        raise ReglaError("Solo Despachos puede escanear, represar y cerrar.")


def _insertar_escaneo(conn, guia_id, codigo, normalizado, resultado, usuario_id) -> None:
    conn.execute(
        """
        INSERT INTO escaneo (guia_id, codigo_leido, codigo_normalizado, resultado, usuario_id, fecha)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (guia_id, str(codigo).strip(), normalizado, resultado, usuario_id, _ahora()),
    )


def _conteo_guias(conn: sqlite3.Connection, corte_id: int) -> dict:
    fila = conn.execute(
        """
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN estado = 'verificada' THEN 1 ELSE 0 END) AS verificadas,
            SUM(CASE WHEN estado = 'represada' THEN 1 ELSE 0 END) AS represadas
        FROM guia WHERE corte_id = ? AND anulado = 0
        """,
        (corte_id,),
    ).fetchone()
    return {
        "total": int(fila["total"] or 0),
        "verificadas": int(fila["verificadas"] or 0),
        "represadas": int(fila["represadas"] or 0),
    }
