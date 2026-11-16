"""Interfaz de bodega para la Fase 1. Botones grandes, mensajes en español."""

from __future__ import annotations

import sys
import traceback
from datetime import date
from pathlib import Path

from PySide6.QtCore import Qt, QThread, Signal
from PySide6.QtGui import QTextDocument
from PySide6.QtPrintSupport import QPrintDialog
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QDateEdit,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QSpinBox,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from despachos.config import ROLES_SIN_PANTALLA, configurar_registro
from despachos.db import BaseDatos
from despachos.devoluciones import ESTADOS
from despachos.devoluciones import anular as anular_devolucion
from despachos.devoluciones import buscar_guia
from despachos.devoluciones import listar as listar_devoluciones
from despachos.devoluciones import registrar as registrar_devolucion
from despachos.garantias import TIPOS, anular, autorizar, entregar, listar, rechazar, solicitar
from despachos.muestras import TIPOS as TIPOS_MUESTRA
from despachos.muestras import anular as anular_muestra
from despachos.muestras import despachar as despachar_muestra
from despachos.muestras import listar as listar_muestras
from despachos.muestras import registrar as registrar_muestra
from despachos.muestras import validar_factura
from despachos.lector_mercado import LecturaMercado, revisar_ventas
from despachos.lectores_excel import revisar_excel
from despachos.mercado import anular as anular_mercado
from despachos.mercado import guardar as guardar_mercado
from despachos.mercado import listar as listar_mercado
from despachos.mercado import preparar as preparar_mercado
from despachos.parser_dropi import LectorPendiente, Revision, revisar_manifiesto
from despachos.reportes import exportar_excel, exportar_rango, filas_del_dia, importar_maestro
from despachos.servicios import (
    ReglaError,
    aplicar_equivalencias,
    asignar,
    asociar_producto,
    autenticar,
    cerrar_corte,
    crear_producto,
    crear_usuario,
    definir_prefijo,
    escanear,
    guardar_corte,
    marcar_etapa,
    marcar_represada,
    reprogramar,
    sugerir_numero,
    terminar_parte,
)
from despachos.auditoria import verificar_cadena

ESTILO = """
QWidget { font-size: 15px; }
QPushButton { min-height: 46px; font-size: 16px; padding: 8px 18px; }
QLineEdit, QComboBox, QSpinBox, QDateEdit { min-height: 40px; font-size: 16px; }
QHeaderView::section { font-size: 14px; padding: 6px; }
"""


class HiloLectura(QThread):
    terminado = Signal(object)
    fallo = Signal(str)
    progreso = Signal(int, int)

    def __init__(self, ruta: str, plataforma: str, fecha: str) -> None:
        super().__init__()
        self.ruta = ruta
        self.plataforma = plataforma
        self.fecha = fecha

    def run(self) -> None:
        try:
            if self.plataforma == "DROPI":
                revision = revisar_manifiesto(self.ruta, avance=lambda actual, total: self.progreso.emit(actual, total))
                self.terminado.emit(revision)
            elif self.plataforma == "Vendela":
                self.fallo.emit("No hay un export de Vendela. Hacen falta el archivo, el detalle por guía y si agrupa los despachos.")
            else:
                self.terminado.emit(revisar_excel(self.ruta, self.plataforma, self.fecha))
        except LectorPendiente as exc:
            self.fallo.emit(str(exc))
        except Exception as exc:
            configurar_registro().exception("Fallo al leer el manifiesto")
            self.fallo.emit(str(exc) or "No se pudo leer el PDF. El detalle quedó en el registro.")


class ZonaPdf(QLabel):
    archivo = Signal(str)

    def __init__(self) -> None:
        super().__init__("Suelta aquí el PDF del manifiesto\no pulsa Elegir archivo")
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setAcceptDrops(True)
        self.setMinimumHeight(120)
        self.setStyleSheet("border: 2px dashed #888; border-radius: 8px; padding: 16px;")

    def dragEnterEvent(self, evento) -> None:
        if evento.mimeData().hasUrls():
            evento.acceptProposedAction()

    def dropEvent(self, evento) -> None:
        for url in evento.mimeData().urls():
            ruta = url.toLocalFile()
            if ruta.lower().endswith((".pdf", ".xlsx")):
                self.archivo.emit(ruta)
                return
        QMessageBox.warning(self, "Archivo", "Suelta un PDF de DROPI o un Excel de EFFI o MasterShop.")


class Ventana(QMainWindow):
    def __init__(self, base: BaseDatos) -> None:
        super().__init__()
        self.base = base
        self.usuario = None
        self.revision: Revision | None = None
        self.revisiones: list[Revision] = []
        self.lineas_devolucion: list[dict] = []
        self.lineas_muestra: list[dict] = []
        self.lectura_mercado: LecturaMercado | None = None
        self.hilo: HiloLectura | None = None
        self.setWindowTitle("Despachos de bodega")
        self.resize(1100, 720)
        self.pila = QStackedWidget()
        self.setCentralWidget(self.pila)
        self._armar_ingreso()
        self._armar_principal()
        self.pila.addWidget(self.ingreso)
        self.pila.addWidget(self.principal)

    def _armar_ingreso(self) -> None:
        self.ingreso = QWidget()
        layout = QVBoxLayout(self.ingreso)
        layout.addStretch()
        titulo = QLabel("Control de despachos")
        titulo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        titulo.setStyleSheet("font-size: 28px; font-weight: 600;")
        self.usuario_txt = QLineEdit()
        self.usuario_txt.setPlaceholderText("Usuario")
        self.pin_txt = QLineEdit()
        self.pin_txt.setPlaceholderText("PIN")
        self.pin_txt.setEchoMode(QLineEdit.EchoMode.Password)
        entrar = QPushButton("Entrar")
        entrar.clicked.connect(self._entrar)
        self.pin_txt.returnPressed.connect(self._entrar)
        caja = QVBoxLayout()
        caja.addWidget(titulo)
        caja.addWidget(self.usuario_txt)
        caja.addWidget(self.pin_txt)
        caja.addWidget(entrar)
        contenedor = QWidget()
        contenedor.setFixedWidth(360)
        contenedor.setLayout(caja)
        fila = QHBoxLayout()
        fila.addStretch()
        fila.addWidget(contenedor)
        fila.addStretch()
        layout.addLayout(fila)
        layout.addStretch()

    def _armar_principal(self) -> None:
        self.principal = QWidget()
        layout = QVBoxLayout(self.principal)
        self.aviso_lector = QLabel(
            "Lector pendiente de verificación contra el PDF real de 238 páginas. "
            "Los totales hay que confirmarlos antes de guardar."
        )
        self.aviso_lector.setWordWrap(True)
        self.aviso_lector.setStyleSheet("background: #f4e4c4; padding: 10px;")
        layout.addWidget(self.aviso_lector)
        self.saludo = QLabel()
        layout.addWidget(self.saludo)
        botones = QHBoxLayout()
        self.botones_nav = {}
        for clave, texto in (
            ("tablero", "Tablero"),
            ("cargar", "Cargar corte"),
            ("alistar", "Mis asignaciones"),
            ("despacho", "Escanear y cerrar"),
            ("garantias", "Garantías"),
            ("devoluciones", "Devoluciones"),
            ("muestras", "Muestras"),
            ("mercado", "Mercado Libre"),
            ("consulta", "Consultar"),
            ("admin", "Administración"),
        ):
            boton = QPushButton(texto)
            boton.clicked.connect(lambda _marcado=False, destino=clave: self._ir(destino))
            self.botones_nav[clave] = boton
            botones.addWidget(boton)
        salir = QPushButton("Salir")
        salir.clicked.connect(self._salir)
        botones.addWidget(salir)
        layout.addLayout(botones)
        self.paginas = QStackedWidget()
        layout.addWidget(self.paginas, 1)
        self._armar_tablero()
        self._armar_carga()
        self._armar_alistamiento()
        self._armar_despacho()
        self._armar_garantias()
        self._armar_devoluciones()
        self._armar_muestras()
        self._armar_mercado()
        self._armar_consulta()
        self._armar_admin()

    def _armar_tablero(self) -> None:
        pagina = QWidget()
        layout = QVBoxLayout(pagina)
        fila = QHBoxLayout()
        self.fecha_tablero = QDateEdit(date.today())
        self.fecha_tablero.setCalendarPopup(True)
        self.fecha_tablero.setDisplayFormat("yyyy-MM-dd")
        actualizar = QPushButton("Ver día")
        actualizar.clicked.connect(self._cargar_tablero)
        exportar = QPushButton("Exportar Excel")
        exportar.clicked.connect(self._exportar)
        fila.addWidget(QLabel("Fecha"))
        fila.addWidget(self.fecha_tablero)
        fila.addWidget(actualizar)
        fila.addWidget(exportar)
        fila.addStretch()
        layout.addLayout(fila)
        self.tabla_cortes = self._tabla(
            ["Corte", "Transportadora", "Estado", "Guías", "Unidades", "Revisados", "Embolsados", "Empacados", "Personas"]
        )
        self.tabla_cortes.itemSelectionChanged.connect(self._corte_seleccionado)
        layout.addWidget(self.tabla_cortes)
        self.boton_asignar = QPushButton("Asignar alistadores")
        self.boton_asignar.clicked.connect(self._asignar)
        layout.addWidget(self.boton_asignar)
        layout.addWidget(QLabel("Otros movimientos del día"))
        self.tabla_movimiento = self._tabla(["Proceso", "Referencia", "Detalle", "Cantidad", "Estado"])
        layout.addWidget(self.tabla_movimiento)
        self.paginas.addWidget(pagina)
        self.pagina_tablero = pagina

    def _armar_carga(self) -> None:
        pagina = QWidget()
        layout = QVBoxLayout(pagina)
        self.zona = ZonaPdf()
        self.zona.archivo.connect(self._leer_archivo)
        self.plataforma_carga = QComboBox()
        self.plataforma_carga.addItems(["DROPI", "EFFI", "MasterShop", "Vendela"])
        self.lote_combo = QComboBox()
        self.lote_combo.currentIndexChanged.connect(lambda *_: self._elegir_parte())
        elegir = QPushButton("Elegir archivo")
        elegir.clicked.connect(self._elegir_pdf)
        self.progreso = QProgressBar()
        self.resultado = QLabel("Todavía no hay un manifiesto en revisión.")
        self.resultado.setWordWrap(True)
        self.lista_pendientes = self._tabla(["Referencia", "Clave", "Nombre", "Cantidad"])
        self.producto_combo = QComboBox()
        self.codigo_nuevo = QLineEdit()
        self.codigo_nuevo.setPlaceholderText("Código interno, si hay que crear el producto")
        self.nombre_nuevo = QLineEdit()
        self.nombre_nuevo.setPlaceholderText("Nombre del producto nuevo")
        asociar = QPushButton("Asociar producto")
        asociar.clicked.connect(self._asociar)
        self.numero_corte = QSpinBox()
        self.numero_corte.setRange(1, 30)
        self.confirmo = QCheckBox("Revisé transportadora, guías y unidades antes de guardar.")
        guardar = QPushButton("Guardar corte")
        guardar.clicked.connect(self._guardar)
        layout.addWidget(QLabel("Plataforma"))
        layout.addWidget(self.plataforma_carga)
        layout.addWidget(self.zona)
        layout.addWidget(elegir)
        layout.addWidget(self.lote_combo)
        layout.addWidget(self.progreso)
        layout.addWidget(self.resultado)
        layout.addWidget(self.lista_pendientes)
        layout.addWidget(self.producto_combo)
        layout.addWidget(self.codigo_nuevo)
        layout.addWidget(self.nombre_nuevo)
        layout.addWidget(asociar)
        fila = QHBoxLayout()
        fila.addWidget(QLabel("Número de corte"))
        fila.addWidget(self.numero_corte)
        fila.addStretch()
        layout.addLayout(fila)
        layout.addWidget(self.confirmo)
        layout.addWidget(guardar)
        self.paginas.addWidget(pagina)

    def _armar_alistamiento(self) -> None:
        pagina = QWidget()
        layout = QVBoxLayout(pagina)
        self.lista_asignaciones = QListWidget()
        self.lista_asignaciones.currentItemChanged.connect(lambda *_: self._ver_productos())
        self.tabla_productos = self._tabla(["Código", "Producto", "Cantidad", "Revisado", "Embolsado", "Empacado"])
        revisar = QPushButton("Revisado")
        embolsar = QPushButton("Embolsado")
        empacar = QPushButton("Empacado")
        desmarcar = QPushButton("Desmarcar etapa")
        revisar.clicked.connect(lambda: self._marcar("revisado", True))
        embolsar.clicked.connect(lambda: self._marcar("embolsado", True))
        empacar.clicked.connect(lambda: self._marcar("empacado", True))
        desmarcar.clicked.connect(self._desmarcar)
        terminar = QPushButton("Terminar mi parte")
        terminar.clicked.connect(self._terminar)
        imprimir = QPushButton("Imprimir lista")
        imprimir.clicked.connect(self._imprimir)
        layout.addWidget(QLabel("Cortes asignados"))
        layout.addWidget(self.lista_asignaciones)
        layout.addWidget(self.tabla_productos)
        fila = QHBoxLayout()
        for boton in (revisar, embolsar, empacar, desmarcar, terminar, imprimir):
            fila.addWidget(boton)
        layout.addLayout(fila)
        self.paginas.addWidget(pagina)

    def _armar_despacho(self) -> None:
        pagina = QWidget()
        layout = QVBoxLayout(pagina)
        fila = QHBoxLayout()
        self.fecha_despacho = QDateEdit(date.today())
        self.fecha_despacho.setCalendarPopup(True)
        self.fecha_despacho.setDisplayFormat("yyyy-MM-dd")
        self.cortes_despacho = QComboBox()
        self.cortes_despacho.currentIndexChanged.connect(lambda *_: self._ver_guias_corte())
        fila.addWidget(QLabel("Fecha"))
        fila.addWidget(self.fecha_despacho)
        fila.addWidget(self.cortes_despacho, 1)
        layout.addLayout(fila)
        self.conteo_despacho = QLabel("Elige un corte.")
        self.conteo_despacho.setStyleSheet("font-size: 22px; font-weight: 600;")
        layout.addWidget(self.conteo_despacho)
        self.codigo_escaneo = QLineEdit()
        self.codigo_escaneo.setPlaceholderText("Aquí lee la pistola y presiona Enter")
        self.codigo_escaneo.returnPressed.connect(self._escanear)
        layout.addWidget(self.codigo_escaneo)
        self.aviso_escaneo = QLabel("")
        self.aviso_escaneo.setWordWrap(True)
        layout.addWidget(self.aviso_escaneo)
        self.tabla_guias_corte = self._tabla(["Guía", "Ciudad", "Estado"])
        layout.addWidget(self.tabla_guias_corte)
        self.motivo_represado = QLineEdit()
        self.motivo_represado.setPlaceholderText("Motivo del represado")
        represar = QPushButton("Represar guía seleccionada")
        represar.clicked.connect(self._represar)
        self.destino_reprogramar = QComboBox()
        reprogramar_btn = QPushButton("Reprogramar al corte elegido")
        reprogramar_btn.clicked.connect(self._reprogramar)
        layout.addWidget(self.motivo_represado)
        layout.addWidget(represar)
        fila_destino = QHBoxLayout()
        fila_destino.addWidget(QLabel("Corte destino"))
        fila_destino.addWidget(self.destino_reprogramar, 1)
        fila_destino.addWidget(reprogramar_btn)
        layout.addLayout(fila_destino)
        self.auxiliar = QLineEdit()
        self.auxiliar.setPlaceholderText("Auxiliar que recibe")
        self.placa = QLineEdit()
        self.placa.setPlaceholderText("Placa")
        self.hora_entrega = QLineEdit()
        self.hora_entrega.setPlaceholderText("Hora de entrega")
        self.motivo_cierre = QLineEdit()
        self.motivo_cierre.setPlaceholderText("Motivo si el alistamiento no está terminado")
        cerrar = QPushButton("Cerrar corte")
        cerrar.clicked.connect(self._cerrar_corte)
        for campo in (self.auxiliar, self.placa, self.hora_entrega, self.motivo_cierre, cerrar):
            layout.addWidget(campo)
        self.fecha_despacho.dateChanged.connect(lambda *_: self._cargar_cortes_despacho())
        self.paginas.addWidget(pagina)

    def _armar_garantias(self) -> None:
        pagina = QWidget()
        layout = QVBoxLayout(pagina)
        aviso = QLabel("Quien solicita la salida no puede autorizarla. Otra persona aprueba antes de entregar.")
        aviso.setWordWrap(True)
        layout.addWidget(aviso)
        self.tipo_garantia = QComboBox()
        for clave, texto in TIPOS.items():
            self.tipo_garantia.addItem(texto, clave)
        self.motivo_garantia = QLineEdit()
        self.motivo_garantia.setPlaceholderText("Motivo")
        self.destinatario_garantia = QLineEdit()
        self.destinatario_garantia.setPlaceholderText("Destinatario")
        self.producto_garantia = QComboBox()
        self.cantidad_garantia = QSpinBox()
        self.cantidad_garantia.setRange(1, 100000)
        solicitar_btn = QPushButton("Solicitar salida")
        solicitar_btn.clicked.connect(self._solicitar_garantia)
        for widget in (
            self.tipo_garantia,
            self.motivo_garantia,
            self.destinatario_garantia,
            self.producto_garantia,
            self.cantidad_garantia,
            solicitar_btn,
        ):
            layout.addWidget(widget)
        self.tabla_garantias = self._tabla(["Tipo", "Producto", "Cantidad", "Destinatario", "Estado", "Solicitó", "Autorizó"])
        layout.addWidget(self.tabla_garantias)
        self.motivo_decision = QLineEdit()
        self.motivo_decision.setPlaceholderText("Motivo del rechazo o de la anulación")
        fila = QHBoxLayout()
        autorizar_btn = QPushButton("Autorizar")
        rechazar_btn = QPushButton("Rechazar")
        entregar_btn = QPushButton("Entregar")
        self.anular_garantia_btn = QPushButton("Anular")
        autorizar_btn.clicked.connect(self._autorizar_garantia)
        rechazar_btn.clicked.connect(self._rechazar_garantia)
        entregar_btn.clicked.connect(self._entregar_garantia)
        self.anular_garantia_btn.clicked.connect(self._anular_garantia)
        for boton in (autorizar_btn, rechazar_btn, entregar_btn, self.anular_garantia_btn):
            fila.addWidget(boton)
        layout.addWidget(self.motivo_decision)
        layout.addLayout(fila)
        self.paginas.addWidget(pagina)

    def _armar_devoluciones(self) -> None:
        pagina = QWidget()
        layout = QVBoxLayout(pagina)
        aviso = QLabel("Lo que vuelve se registra aquí. No entra al corte ni al alistamiento.")
        aviso.setWordWrap(True)
        layout.addWidget(aviso)
        fila_guia = QHBoxLayout()
        self.guia_devolucion = QLineEdit()
        self.guia_devolucion.setPlaceholderText("Guía o remisión de origen, si se identifica")
        buscar = QPushButton("Buscar guía")
        buscar.clicked.connect(self._buscar_guia_devolucion)
        fila_guia.addWidget(self.guia_devolucion, 1)
        fila_guia.addWidget(buscar)
        layout.addLayout(fila_guia)
        self.aviso_guia_devolucion = QLabel("")
        self.aviso_guia_devolucion.setWordWrap(True)
        layout.addWidget(self.aviso_guia_devolucion)
        self.producto_devolucion = QComboBox()
        self.cantidad_devolucion = QSpinBox()
        self.cantidad_devolucion.setRange(1, 100000)
        self.estado_devolucion = QComboBox()
        for clave, texto in ESTADOS.items():
            self.estado_devolucion.addItem(texto, clave)
        self.disposicion_devolucion = QLineEdit()
        self.disposicion_devolucion.setPlaceholderText("Qué se hace con lo recibido")
        self.evidencia_devolucion = QLineEdit()
        self.evidencia_devolucion.setPlaceholderText("Evidencia: nota, foto o documento")
        agregar = QPushButton("Agregar producto")
        agregar.clicked.connect(self._agregar_linea_devolucion)
        self.lista_lineas_devolucion = QListWidget()
        quitar = QPushButton("Quitar producto seleccionado")
        quitar.clicked.connect(self._quitar_linea_devolucion)
        self.observacion_devolucion = QLineEdit()
        self.observacion_devolucion.setPlaceholderText("Observación de la recepción")
        registrar = QPushButton("Registrar recepción")
        registrar.clicked.connect(self._registrar_devolucion)
        for widget in (
            self.producto_devolucion,
            self.cantidad_devolucion,
            self.estado_devolucion,
            self.disposicion_devolucion,
            self.evidencia_devolucion,
            agregar,
            self.lista_lineas_devolucion,
            quitar,
            self.observacion_devolucion,
            registrar,
        ):
            layout.addWidget(widget)
        self.tabla_devoluciones = self._tabla(["Guía", "Recibido", "Quién", "Productos", "Estado"])
        layout.addWidget(self.tabla_devoluciones)
        self.motivo_anular_devolucion = QLineEdit()
        self.motivo_anular_devolucion.setPlaceholderText("Motivo de la anulación")
        anular_btn = QPushButton("Anular recepción")
        anular_btn.clicked.connect(self._anular_devolucion)
        layout.addWidget(self.motivo_anular_devolucion)
        layout.addWidget(anular_btn)
        self.paginas.addWidget(pagina)

    def _armar_muestras(self) -> None:
        pagina = QWidget()
        layout = QVBoxLayout(pagina)
        aviso = QLabel("El pedido queda aquí. No sale hasta que se escriba el número de la factura.")
        aviso.setWordWrap(True)
        layout.addWidget(aviso)
        self.tipo_muestra = QComboBox()
        for clave, texto in TIPOS_MUESTRA.items():
            self.tipo_muestra.addItem(texto, clave)
        self.pedido_muestra = QLineEdit()
        self.pedido_muestra.setPlaceholderText("Referencia del pedido")
        self.destinatario_muestra = QLineEdit()
        self.destinatario_muestra.setPlaceholderText("Quién recibe")
        self.producto_muestra = QComboBox()
        self.cantidad_muestra = QSpinBox()
        self.cantidad_muestra.setRange(1, 100000)
        agregar = QPushButton("Agregar producto")
        agregar.clicked.connect(self._agregar_linea_muestra)
        self.lista_lineas_muestra = QListWidget()
        quitar = QPushButton("Quitar producto seleccionado")
        quitar.clicked.connect(self._quitar_linea_muestra)
        self.observacion_muestra = QLineEdit()
        self.observacion_muestra.setPlaceholderText("Observación del pedido")
        registrar = QPushButton("Registrar pedido")
        registrar.clicked.connect(self._registrar_muestra)
        for widget in (
            self.tipo_muestra,
            self.pedido_muestra,
            self.destinatario_muestra,
            self.producto_muestra,
            self.cantidad_muestra,
            agregar,
            self.lista_lineas_muestra,
            quitar,
            self.observacion_muestra,
            registrar,
        ):
            layout.addWidget(widget)
        self.tabla_muestras = self._tabla(
            ["Tipo", "Pedido", "Destinatario", "Factura", "Validó", "Despachó", "Productos", "Estado"]
        )
        layout.addWidget(self.tabla_muestras)
        self.factura_muestra = QLineEdit()
        self.factura_muestra.setPlaceholderText("Número de factura, escrito a mano")
        validar = QPushButton("Validar factura")
        validar.clicked.connect(self._validar_factura_muestra)
        despachar = QPushButton("Despachar")
        despachar.clicked.connect(self._despachar_muestra)
        self.motivo_anular_muestra = QLineEdit()
        self.motivo_anular_muestra.setPlaceholderText("Motivo de la anulación")
        anular_btn = QPushButton("Anular pedido")
        anular_btn.clicked.connect(self._anular_muestra)
        for widget in (self.factura_muestra, validar, despachar, self.motivo_anular_muestra, anular_btn):
            layout.addWidget(widget)
        self.paginas.addWidget(pagina)

    def _armar_mercado(self) -> None:
        pagina = QWidget()
        layout = QVBoxLayout(pagina)
        aviso = QLabel(
            "Este export es de Mercado Libre y no entra al corte. "
            "Se asocia por el título de la publicación. El SKU, si viene, no se usa."
        )
        aviso.setWordWrap(True)
        layout.addWidget(aviso)
        elegir = QPushButton("Elegir export de ventas")
        elegir.clicked.connect(self._elegir_mercado)
        self.resultado_mercado = QLabel("Todavía no hay un export en revisión.")
        self.resultado_mercado.setWordWrap(True)
        self.lista_mercado = self._tabla(["Título", "Clave", "Cantidad", "Producto"])
        self.producto_mercado = QComboBox()
        self.codigo_mercado = QLineEdit()
        self.codigo_mercado.setPlaceholderText("Código interno, si hay que crear el producto")
        self.nombre_mercado = QLineEdit()
        self.nombre_mercado.setPlaceholderText("Nombre del producto nuevo")
        asociar = QPushButton("Asociar título")
        asociar.clicked.connect(self._asociar_mercado)
        self.confirmo_mercado = QCheckBox("Revisé ventas, títulos y unidades antes de guardar.")
        guardar = QPushButton("Guardar lote")
        guardar.clicked.connect(self._guardar_mercado)
        for widget in (
            elegir,
            self.resultado_mercado,
            self.lista_mercado,
            self.producto_mercado,
            self.codigo_mercado,
            self.nombre_mercado,
            asociar,
            self.confirmo_mercado,
            guardar,
        ):
            layout.addWidget(widget)
        self.tabla_lotes_mercado = self._tabla(["Archivo", "Fecha", "Ventas", "Unidades", "Quién", "Estado"])
        layout.addWidget(self.tabla_lotes_mercado)
        self.motivo_anular_mercado = QLineEdit()
        self.motivo_anular_mercado.setPlaceholderText("Motivo de la anulación")
        anular_btn = QPushButton("Anular lote")
        anular_btn.clicked.connect(self._anular_mercado)
        layout.addWidget(self.motivo_anular_mercado)
        layout.addWidget(anular_btn)
        self.paginas.addWidget(pagina)

    def _armar_consulta(self) -> None:
        pagina = QWidget()
        layout = QVBoxLayout(pagina)
        fila = QHBoxLayout()
        self.busca_guia = QLineEdit()
        self.busca_guia.setPlaceholderText("Número de guía")
        boton = QPushButton("Buscar")
        boton.clicked.connect(self._buscar_guia)
        fila.addWidget(self.busca_guia)
        fila.addWidget(boton)
        layout.addLayout(fila)
        self.tabla_guias = self._tabla(["Guía", "Fecha", "Corte", "Transportadora", "Ciudad", "Recaudo", "Rótulo"])
        layout.addWidget(self.tabla_guias)
        rango = QHBoxLayout()
        self.fecha_desde = QDateEdit(date.today())
        self.fecha_hasta = QDateEdit(date.today())
        for campo in (self.fecha_desde, self.fecha_hasta):
            campo.setCalendarPopup(True)
            campo.setDisplayFormat("yyyy-MM-dd")
        exportar_movimiento = QPushButton("Exportar movimiento del rango")
        exportar_movimiento.clicked.connect(self._exportar_rango)
        rango.addWidget(QLabel("Desde"))
        rango.addWidget(self.fecha_desde)
        rango.addWidget(QLabel("Hasta"))
        rango.addWidget(self.fecha_hasta)
        rango.addWidget(exportar_movimiento)
        rango.addStretch()
        layout.addLayout(rango)
        self.paginas.addWidget(pagina)

    def _armar_admin(self) -> None:
        pagina = QWidget()
        layout = QVBoxLayout(pagina)
        formulario = QFormLayout()
        self.nuevo_usuario = QLineEdit()
        self.nuevo_nombre = QLineEdit()
        self.nuevo_pin = QLineEdit()
        self.nuevo_pin.setEchoMode(QLineEdit.EchoMode.Password)
        self.nuevo_rol = QComboBox()
        self.nuevo_rol.addItems(
            [
                "ADMINISTRADOR",
                "COORDINACION",
                "SALIDAS_ECOMMERCE",
                "ALISTADOR",
                "DESPACHADOR",
                "CONSULTA",
                "MERCADO_LIBRE",
                "MUESTRAS",
                "DEVOLUCIONES",
                "GARANTIAS",
            ]
        )
        formulario.addRow("Usuario", self.nuevo_usuario)
        formulario.addRow("Nombre", self.nuevo_nombre)
        formulario.addRow("PIN", self.nuevo_pin)
        formulario.addRow("Rol", self.nuevo_rol)
        layout.addLayout(formulario)
        crear = QPushButton("Crear usuario")
        crear.clicked.connect(self._crear_usuario)
        layout.addWidget(crear)
        maestro = QPushButton("Importar maestro desde Excel")
        maestro.clicked.connect(self._importar_maestro)
        respaldo = QPushButton("Respaldar ahora")
        respaldo.clicked.connect(self._respaldar)
        cadena = QPushButton("Verificar cadena de la bitácora")
        cadena.clicked.connect(self._verificar)
        self.prefijo_transportadora = QComboBox()
        self.prefijo_valor = QLineEdit()
        self.prefijo_valor.setPlaceholderText("Prefijo de la pistola, si la etiqueta lo trae")
        guardar_prefijo = QPushButton("Guardar prefijo de la transportadora")
        guardar_prefijo.clicked.connect(self._guardar_prefijo)
        layout.addWidget(maestro)
        layout.addWidget(respaldo)
        layout.addWidget(cadena)
        layout.addWidget(QLabel("Prefijo por transportadora"))
        layout.addWidget(self.prefijo_transportadora)
        layout.addWidget(self.prefijo_valor)
        layout.addWidget(guardar_prefijo)
        layout.addStretch()
        self.paginas.addWidget(pagina)

    def _entrar(self) -> None:
        try:
            self.usuario = autenticar(self.base, self.usuario_txt.text(), self.pin_txt.text())
        except ReglaError as exc:
            QMessageBox.warning(self, "Ingreso", str(exc))
            return
        if self.usuario["rol"] in ROLES_SIN_PANTALLA:
            QMessageBox.information(
                self,
                "Proceso pendiente",
                "Tu proceso todavía no está habilitado.",
            )
            self.usuario = None
            return
        self.saludo.setText(f"{self.usuario['nombre']} · {self.usuario['rol']}")
        self.pin_txt.clear()
        self._aplicar_permisos()
        self.pila.setCurrentWidget(self.principal)
        self._recargar_productos()
        if self.usuario["rol"] == "ALISTADOR":
            self._ir("alistar")
        elif self.usuario["rol"] == "DESPACHADOR":
            self._ir("despacho")
        elif self.usuario["rol"] == "GARANTIAS":
            self._ir("garantias")
        elif self.usuario["rol"] == "DEVOLUCIONES":
            self._ir("devoluciones")
        elif self.usuario["rol"] == "MUESTRAS":
            self._ir("muestras")
        elif self.usuario["rol"] == "MERCADO_LIBRE":
            self._ir("mercado")
        else:
            self._ir("tablero")

    def _aplicar_permisos(self) -> None:
        rol = self.usuario["rol"]
        self.botones_nav["cargar"].setVisible(rol in {"ADMINISTRADOR", "COORDINACION", "SALIDAS_ECOMMERCE"})
        self.botones_nav["alistar"].setVisible(rol in {"ADMINISTRADOR", "ALISTADOR", "COORDINACION"})
        self.botones_nav["despacho"].setVisible(rol in {"ADMINISTRADOR", "DESPACHADOR", "COORDINACION"})
        self.botones_nav["garantias"].setVisible(rol in {"ADMINISTRADOR", "GARANTIAS", "COORDINACION", "CONSULTA"})
        self.botones_nav["devoluciones"].setVisible(rol in {"ADMINISTRADOR", "DEVOLUCIONES", "COORDINACION", "CONSULTA"})
        self.botones_nav["muestras"].setVisible(rol in {"ADMINISTRADOR", "MUESTRAS", "COORDINACION", "CONSULTA"})
        self.botones_nav["mercado"].setVisible(rol in {"ADMINISTRADOR", "MERCADO_LIBRE", "COORDINACION", "CONSULTA"})
        self.botones_nav["admin"].setVisible(rol == "ADMINISTRADOR")
        self.anular_garantia_btn.setVisible(rol == "ADMINISTRADOR")
        self.boton_asignar.setVisible(rol in {"ADMINISTRADOR", "COORDINACION", "SALIDAS_ECOMMERCE"})
        self.aviso_lector.setVisible(self._parametro("lector_verificado") != "si")

    def _salir(self) -> None:
        self.usuario = None
        self.pila.setCurrentWidget(self.ingreso)

    def _ir(self, destino: str) -> None:
        indice = {
            "tablero": 0,
            "cargar": 1,
            "alistar": 2,
            "despacho": 3,
            "garantias": 4,
            "devoluciones": 5,
            "muestras": 6,
            "mercado": 7,
            "consulta": 8,
            "admin": 9,
        }[destino]
        self.paginas.setCurrentIndex(indice)
        if destino == "tablero":
            self._cargar_tablero()
        elif destino == "alistar":
            self._cargar_asignaciones()
        elif destino == "despacho":
            self._cargar_cortes_despacho()
        elif destino == "garantias":
            self._cargar_garantias()
        elif destino == "devoluciones":
            self._pintar_lineas_devolucion()
            self._cargar_devoluciones()
        elif destino == "muestras":
            self._pintar_lineas_muestra()
            self._cargar_muestras()
        elif destino == "mercado":
            self._pintar_mercado()
            self._cargar_lotes_mercado()

    def _cargar_tablero(self) -> None:
        fecha = self.fecha_tablero.date().toString("yyyy-MM-dd")
        filas = self.base.conn.execute(
            """
            SELECT c.id, c.numero, c.estado, t.nombre AS transportadora,
                (SELECT COUNT(*) FROM guia g WHERE g.corte_id = c.id) AS guias,
                (SELECT COALESCE(SUM(cantidad), 0) FROM alistamiento a WHERE a.corte_id = c.id) AS unidades,
                (SELECT COUNT(*) FROM alistamiento a WHERE a.corte_id = c.id AND revisado = 1) AS revisados,
                (SELECT COUNT(*) FROM alistamiento a WHERE a.corte_id = c.id AND embolsado = 1) AS embolsados,
                (SELECT COUNT(*) FROM alistamiento a WHERE a.corte_id = c.id AND empacado = 1) AS empacados,
                (SELECT COUNT(*) FROM alistamiento a WHERE a.corte_id = c.id) AS productos,
                (SELECT GROUP_CONCAT(u.nombre, ', ')
                    FROM asignacion s JOIN usuario u ON u.id = s.usuario_id
                    WHERE s.corte_id = c.id) AS personas
            FROM corte c JOIN transportadora t ON t.id = c.transportadora_id
            WHERE c.fecha = ? AND c.anulado = 0
            ORDER BY t.orden, c.numero
            """,
            (fecha,),
        ).fetchall()
        self.tabla_cortes.setRowCount(len(filas))
        for fila_idx, fila in enumerate(filas):
            avance = lambda hecho: f"{hecho}/{fila['productos']}"
            valores = [
                str(fila["numero"]),
                fila["transportadora"],
                fila["estado"],
                str(fila["guias"]),
                str(fila["unidades"]),
                avance(fila["revisados"]),
                avance(fila["embolsados"]),
                avance(fila["empacados"]),
                fila["personas"] or "",
            ]
            for columna, valor in enumerate(valores):
                item = QTableWidgetItem(valor)
                item.setData(Qt.ItemDataRole.UserRole, fila["id"])
                self.tabla_cortes.setItem(fila_idx, columna, item)
        if not filas:
            self.tabla_cortes.setRowCount(1)
            self.tabla_cortes.setItem(0, 0, QTableWidgetItem("Hoy no hay cortes cargados."))
        otros = filas_del_dia(self.base, fecha)
        self.tabla_movimiento.clearContents()
        self.tabla_movimiento.setRowCount(len(otros) or 1)
        if not otros:
            self.tabla_movimiento.setItem(0, 0, QTableWidgetItem("Este día no tiene garantías, devoluciones, muestras ni Mercado Libre."))
            return
        for fila_idx, valores in enumerate(otros):
            for columna, valor in enumerate(valores):
                self.tabla_movimiento.setItem(fila_idx, columna, QTableWidgetItem(valor))

    def _corte_seleccionado(self) -> None:
        return

    def _elegir_pdf(self) -> None:
        plataforma = self.plataforma_carga.currentText()
        if plataforma == "Vendela":
            QMessageBox.information(
                self,
                "Vendela",
                "No hay un export de Vendela. Hacen falta el archivo, el detalle por guía y si agrupa los despachos.",
            )
            return
        filtro = "PDF (*.pdf)" if plataforma == "DROPI" else "Excel (*.xlsx)"
        ruta, _ = QFileDialog.getOpenFileName(self, f"Manifiesto {plataforma}", "", filtro)
        if ruta:
            self._leer_archivo(ruta)

    def _leer_archivo(self, ruta: str) -> None:
        plataforma = self.plataforma_carga.currentText()
        if plataforma == "DROPI" and not ruta.lower().endswith(".pdf"):
            QMessageBox.warning(self, "Archivo", "DROPI se carga con el PDF del manifiesto.")
            return
        if plataforma != "DROPI" and not ruta.lower().endswith(".xlsx"):
            QMessageBox.warning(self, "Archivo", "EFFI y MasterShop se cargan con Excel.")
            return
        if self.hilo and self.hilo.isRunning():
            return
        self.resultado.setText(f"Leyendo {Path(ruta).name}…")
        self.progreso.setRange(0, 0)
        fecha = self.fecha_tablero.date().toString("yyyy-MM-dd")
        self.hilo = HiloLectura(ruta, plataforma, fecha)
        self.hilo.progreso.connect(self._avanzar)
        self.hilo.terminado.connect(self._revision_lista)
        self.hilo.fallo.connect(self._lectura_fallo)
        self.hilo.start()

    def _avanzar(self, actual: int, total: int) -> None:
        self.progreso.setRange(0, total)
        self.progreso.setValue(actual)

    def _lectura_fallo(self, mensaje: str) -> None:
        self.progreso.setRange(0, 1)
        self.resultado.setText(mensaje)
        QMessageBox.warning(self, "Manifiesto", mensaje)

    def _revision_lista(self, resultado) -> None:
        self.progreso.setRange(0, 1)
        self.progreso.setValue(1)
        lote = resultado if isinstance(resultado, list) else [resultado]
        try:
            self.revisiones = [aplicar_equivalencias(self.base, revision) for revision in lote]
        except ReglaError as exc:
            QMessageBox.warning(self, "Manifiesto", str(exc))
            return
        self.lote_combo.blockSignals(True)
        self.lote_combo.clear()
        for revision in self.revisiones:
            self.lote_combo.addItem(f"{revision.plataforma} · {revision.transportadora or 'sin transportadora'} · {len(revision.guias)} guías")
        self.lote_combo.blockSignals(False)
        self.lote_combo.setVisible(len(self.revisiones) > 1)
        self._elegir_parte()

    def _pintar_revision(self) -> None:
        revision = self.revision
        if revision is None:
            return
        transportadora = self.base.conn.execute(
            "SELECT id, nombre FROM transportadora WHERE nombre_dropi = ? OR nombre = ?",
            (revision.transportadora, revision.transportadora),
        ).fetchone()
        if transportadora and revision.fecha:
            self.numero_corte.setValue(sugerir_numero(self.base, revision.fecha, transportadora["id"]))
        self.confirmo.setVisible(not revision.lector_verificado)
        lineas = [
            f"Transportadora: {revision.transportadora or 'no reconocida'}",
            f"Fecha: {revision.fecha or 'no reconocida'}",
            f"Guías: {len(revision.guias)}",
            f"Unidades del resumen: {revision.unidades_resumen}",
            f"Unidades de rótulos: {revision.unidades_rotulos if revision.unidades_rotulos is not None else 'sin dato'}",
        ]
        if revision.avisos:
            lineas.append("Avisos:")
            lineas.extend(f"• {aviso}" for aviso in revision.avisos)
        if revision.bloqueos:
            lineas.append("Para poder guardar:")
            lineas.extend(f"• {bloqueo}" for bloqueo in revision.bloqueos)
        self.resultado.setText("\n".join(lineas))
        pendientes = [item for item in revision.resumen if item.producto_id is None]
        self._llenar(self.lista_pendientes, pendientes, lambda item: [item.sku, item.id_dropi, item.nombre, str(item.cantidad)])

    def _asociar(self) -> None:
        if self.revision is None:
            return
        fila = self.lista_pendientes.currentRow()
        pendientes = [item for item in self.revision.resumen if item.producto_id is None]
        if fila < 0 or fila >= len(pendientes):
            QMessageBox.information(self, "Homologar", "Elige el producto de DROPI que vas a asociar.")
            return
        item = pendientes[fila]
        try:
            if self.codigo_nuevo.text().strip():
                producto_id = crear_producto(self.base, self.usuario["id"], self.codigo_nuevo.text(), self.nombre_nuevo.text())
            else:
                producto_id = self.producto_combo.currentData()
                if not producto_id:
                    raise ReglaError("Elige un producto del maestro o escribe el código para crear uno.")
            asociar_producto(
                self.base,
                self.usuario["id"],
                item.sku,
                item.id_dropi,
                item.nombre,
                int(producto_id),
                self.revision.plataforma,
            )
        except ReglaError as exc:
            QMessageBox.warning(self, "Homologar", str(exc))
            return
        self.codigo_nuevo.clear()
        self.nombre_nuevo.clear()
        self._recargar_productos()
        self.revision = aplicar_equivalencias(self.base, self.revision)
        if self.lote_combo.currentIndex() >= 0:
            self.revisiones[self.lote_combo.currentIndex()] = self.revision
        self._pintar_revision()

    def _elegir_parte(self) -> None:
        indice = self.lote_combo.currentIndex()
        if indice < 0 or indice >= len(self.revisiones):
            return
        self.revision = self.revisiones[indice]
        self._pintar_revision()

    def _guardar(self) -> None:
        if self.revision is None:
            QMessageBox.information(self, "Corte", "Primero carga un manifiesto.")
            return
        try:
            corte_id = guardar_corte(
                self.base,
                self.revision,
                self.numero_corte.value(),
                self.usuario["id"],
                self.confirmo.isChecked(),
            )
        except ReglaError as exc:
            QMessageBox.warning(self, "Corte", str(exc))
            return
        QMessageBox.information(self, "Corte", f"Corte guardado. Identificador interno {corte_id}.")
        self.revision = None
        self.resultado.setText("Corte guardado.")
        self.lista_pendientes.setRowCount(0)
        self._ir("tablero")

    def _asignar(self) -> None:
        corte_id = self._id_en(self.tabla_cortes)
        if corte_id is None:
            QMessageBox.information(self, "Asignar", "Elige un corte del tablero.")
            return
        personas = self.base.conn.execute(
            "SELECT id, nombre FROM usuario WHERE rol = 'ALISTADOR' AND activo = 1 ORDER BY nombre"
        ).fetchall()
        if not personas:
            QMessageBox.information(self, "Asignar", "No hay alistadores activos.")
            return
        from PySide6.QtWidgets import QDialog, QDialogButtonBox

        dialogo = QDialog(self)
        dialogo.setWindowTitle("Asignar alistadores")
        caja = QVBoxLayout(dialogo)
        lista = QListWidget()
        lista.setSelectionMode(QListWidget.SelectionMode.MultiSelection)
        for persona in personas:
            item = QListWidgetItem(persona["nombre"])
            item.setData(Qt.ItemDataRole.UserRole, persona["id"])
            lista.addItem(item)
        caja.addWidget(lista)
        botones = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        botones.accepted.connect(dialogo.accept)
        botones.rejected.connect(dialogo.reject)
        caja.addWidget(botones)
        if dialogo.exec() != QDialog.DialogCode.Accepted:
            return
        ids = [item.data(Qt.ItemDataRole.UserRole) for item in lista.selectedItems()]
        try:
            asignar(self.base, corte_id, ids, self.usuario["id"])
        except ReglaError as exc:
            QMessageBox.warning(self, "Asignar", str(exc))
            return
        self._cargar_tablero()

    def _cargar_asignaciones(self) -> None:
        self.lista_asignaciones.clear()
        if self.usuario["rol"] == "ALISTADOR":
            filas = self.base.conn.execute(
                """
                SELECT s.id, c.fecha, c.numero, t.nombre, s.estado
                FROM asignacion s
                JOIN corte c ON c.id = s.corte_id
                JOIN transportadora t ON t.id = c.transportadora_id
                WHERE s.usuario_id = ? AND c.anulado = 0
                ORDER BY c.fecha DESC, c.numero
                """,
                (self.usuario["id"],),
            ).fetchall()
        else:
            filas = self.base.conn.execute(
                """
                SELECT s.id, c.fecha, c.numero, t.nombre, s.estado, u.nombre AS persona
                FROM asignacion s
                JOIN corte c ON c.id = s.corte_id
                JOIN transportadora t ON t.id = c.transportadora_id
                JOIN usuario u ON u.id = s.usuario_id
                WHERE c.anulado = 0
                ORDER BY c.fecha DESC, c.numero
                """
            ).fetchall()
        for fila in filas:
            persona = f" · {fila['persona']}" if "persona" in fila.keys() else ""
            item = QListWidgetItem(f"{fila['fecha']} · corte {fila['numero']} · {fila['nombre']} · {fila['estado']}{persona}")
            item.setData(Qt.ItemDataRole.UserRole, fila["id"])
            self.lista_asignaciones.addItem(item)

    def _ver_productos(self) -> None:
        item = self.lista_asignaciones.currentItem()
        if item is None:
            self.tabla_productos.setRowCount(0)
            return
        asignacion_id = item.data(Qt.ItemDataRole.UserRole)
        filas = self.base.conn.execute(
            """
            SELECT a.id, p.codigo_interno, p.nombre, a.cantidad, a.revisado, a.embolsado, a.empacado
            FROM alistamiento a
            JOIN producto p ON p.id = a.producto_id
            JOIN asignacion s ON s.corte_id = a.corte_id
            WHERE s.id = ?
            ORDER BY p.nombre
            """,
            (asignacion_id,),
        ).fetchall()
        self._llenar(
            self.tabla_productos,
            filas,
            lambda fila: [
                fila["codigo_interno"],
                fila["nombre"],
                str(fila["cantidad"]),
                "sí" if fila["revisado"] else "no",
                "sí" if fila["embolsado"] else "no",
                "sí" if fila["empacado"] else "no",
            ],
            id_de=lambda fila: fila["id"],
        )

    def _marcar(self, etapa: str, marcar: bool) -> None:
        alistamiento_id = self._id_en(self.tabla_productos)
        if alistamiento_id is None:
            QMessageBox.information(self, "Alistamiento", "Elige un producto.")
            return
        try:
            marcar_etapa(self.base, alistamiento_id, etapa, self.usuario["id"], marcar)
        except ReglaError as exc:
            QMessageBox.warning(self, "Alistamiento", str(exc))
            return
        self._ver_productos()

    def _desmarcar(self) -> None:
        fila = self.tabla_productos.currentRow()
        if fila < 0:
            QMessageBox.information(self, "Alistamiento", "Elige un producto.")
            return
        revisado = self.tabla_productos.item(fila, 3).text() == "sí"
        embolsado = self.tabla_productos.item(fila, 4).text() == "sí"
        empacado = self.tabla_productos.item(fila, 5).text() == "sí"
        if empacado:
            self._marcar("empacado", False)
        elif embolsado:
            self._marcar("embolsado", False)
        elif revisado:
            self._marcar("revisado", False)

    def _terminar(self) -> None:
        item = self.lista_asignaciones.currentItem()
        if item is None:
            return
        try:
            terminar_parte(self.base, item.data(Qt.ItemDataRole.UserRole), self.usuario["id"])
        except ReglaError as exc:
            QMessageBox.warning(self, "Alistamiento", str(exc))
            return
        self._cargar_asignaciones()

    def _imprimir(self) -> None:
        item = self.lista_asignaciones.currentItem()
        if item is None:
            return
        filas = []
        for fila_idx in range(self.tabla_productos.rowCount()):
            celdas = [self.tabla_productos.item(fila_idx, columna).text() for columna in range(3)]
            filas.append("<tr><td>" + "</td><td>".join(celdas) + "</td></tr>")
        documento = QTextDocument()
        documento.setHtml(f"<h2>{item.text()}</h2><table border='1' cellspacing='0' cellpadding='6'>{''.join(filas)}</table>")
        dialogo = QPrintDialog(self)
        if dialogo.exec() == QPrintDialog.DialogCode.Accepted:
            documento.print_(dialogo.printer())

    def _cargar_cortes_despacho(self) -> None:
        if not hasattr(self, "cortes_despacho"):
            return
        fecha = self.fecha_despacho.date().toString("yyyy-MM-dd")
        filas = self.base.conn.execute(
            """
            SELECT c.id, c.numero, c.estado, t.nombre
            FROM corte c JOIN transportadora t ON t.id = c.transportadora_id
            WHERE c.fecha = ? AND c.anulado = 0
            ORDER BY t.orden, c.numero
            """,
            (fecha,),
        ).fetchall()
        self.cortes_despacho.blockSignals(True)
        self.cortes_despacho.clear()
        for fila in filas:
            self.cortes_despacho.addItem(f"Corte {fila['numero']} · {fila['nombre']} · {fila['estado']}", fila["id"])
        self.cortes_despacho.blockSignals(False)
        self._cargar_destinos(filas)
        self._ver_guias_corte()

    def _cargar_destinos(self, filas) -> None:
        self.destino_reprogramar.clear()
        for fila in filas:
            if fila["estado"] != "cerrado":
                self.destino_reprogramar.addItem(f"Corte {fila['numero']} · {fila['nombre']}", fila["id"])

    def _corte_despacho(self) -> int | None:
        valor = self.cortes_despacho.currentData()
        return int(valor) if valor else None

    def _ver_guias_corte(self) -> None:
        corte_id = self._corte_despacho()
        if corte_id is None:
            self.conteo_despacho.setText("Este día no tiene cortes.")
            self.tabla_guias_corte.setRowCount(0)
            return
        filas = self.base.conn.execute(
            "SELECT id, numero, ciudad, estado FROM guia WHERE corte_id = ? AND anulado = 0 ORDER BY consecutivo, numero",
            (corte_id,),
        ).fetchall()
        verificadas = sum(1 for fila in filas if fila["estado"] == "verificada")
        represadas = sum(1 for fila in filas if fila["estado"] == "represada")
        self.conteo_despacho.setText(f"Verificadas {verificadas} · Represadas {represadas} · Total {len(filas)}")
        self._llenar(
            self.tabla_guias_corte,
            filas,
            lambda fila: [fila["numero"], fila["ciudad"] or "", fila["estado"]],
            id_de=lambda fila: fila["id"],
        )

    def _escanear(self) -> None:
        corte_id = self._corte_despacho()
        if corte_id is None:
            return
        try:
            resultado = escanear(self.base, corte_id, self.codigo_escaneo.text(), self.usuario["id"])
        except ReglaError as exc:
            QMessageBox.warning(self, "Escaneo", str(exc))
            return
        self.aviso_escaneo.setText(resultado["mensaje"])
        self.codigo_escaneo.clear()
        self.codigo_escaneo.setFocus()
        self._ver_guias_corte()

    def _represar(self) -> None:
        guia_id = self._id_en(self.tabla_guias_corte)
        if guia_id is None:
            QMessageBox.information(self, "Represado", "Elige la guía.")
            return
        try:
            marcar_represada(self.base, guia_id, self.motivo_represado.text(), self.usuario["id"])
        except ReglaError as exc:
            QMessageBox.warning(self, "Represado", str(exc))
            return
        self.motivo_represado.clear()
        self._ver_guias_corte()

    def _reprogramar(self) -> None:
        guia_id = self._id_en(self.tabla_guias_corte)
        destino = self.destino_reprogramar.currentData()
        if guia_id is None or not destino:
            QMessageBox.information(self, "Reprogramar", "Elige la guía represada y el corte destino.")
            return
        try:
            reprogramar(self.base, guia_id, int(destino), self.usuario["id"])
        except ReglaError as exc:
            QMessageBox.warning(self, "Reprogramar", str(exc))
            return
        QMessageBox.information(self, "Reprogramar", "La guía quedó vinculada al corte destino.")

    def _cerrar_corte(self) -> None:
        corte_id = self._corte_despacho()
        if corte_id is None:
            return
        try:
            cerrar_corte(
                self.base,
                corte_id,
                self.usuario["id"],
                self.auxiliar.text(),
                self.placa.text(),
                self.hora_entrega.text(),
                self.motivo_cierre.text(),
            )
        except ReglaError as exc:
            QMessageBox.warning(self, "Cierre", str(exc))
            return
        QMessageBox.information(self, "Cierre", "Corte cerrado.")
        self._cargar_cortes_despacho()

    def _guardar_prefijo(self) -> None:
        transportadora_id = self.prefijo_transportadora.currentData()
        if not transportadora_id:
            return
        try:
            definir_prefijo(self.base, int(transportadora_id), self.prefijo_valor.text(), self.usuario["id"])
        except ReglaError as exc:
            QMessageBox.warning(self, "Prefijo", str(exc))
            return
        QMessageBox.information(self, "Prefijo", "Prefijo guardado. Se aplicará al siguiente escaneo.")

    def _cargar_garantias(self) -> None:
        filas = listar(self.base)
        self._llenar(
            self.tabla_garantias,
            filas,
            lambda fila: [
                TIPOS.get(fila["tipo"], fila["tipo"]),
                fila["producto"],
                str(fila["cantidad"]),
                fila["destinatario"],
                fila["estado"],
                fila["solicito"],
                fila["autorizo"],
            ],
            id_de=lambda fila: fila["id"],
        )

    def _solicitar_garantia(self) -> None:
        producto_id = self.producto_garantia.currentData()
        if not producto_id:
            QMessageBox.information(self, "Garantías", "Primero importa o crea un producto en el maestro.")
            return
        try:
            solicitar(
                self.base,
                self.usuario["id"],
                self.tipo_garantia.currentData(),
                self.motivo_garantia.text(),
                self.destinatario_garantia.text(),
                int(producto_id),
                self.cantidad_garantia.value(),
            )
        except ReglaError as exc:
            QMessageBox.warning(self, "Garantías", str(exc))
            return
        self.motivo_garantia.clear()
        self.destinatario_garantia.clear()
        self._cargar_garantias()

    def _autorizar_garantia(self) -> None:
        self._actuar_garantia(lambda salida_id: autorizar(self.base, salida_id, self.usuario["id"]))

    def _rechazar_garantia(self) -> None:
        self._actuar_garantia(lambda salida_id: rechazar(self.base, salida_id, self.usuario["id"], self.motivo_decision.text()))

    def _entregar_garantia(self) -> None:
        self._actuar_garantia(lambda salida_id: entregar(self.base, salida_id, self.usuario["id"]))

    def _anular_garantia(self) -> None:
        self._actuar_garantia(lambda salida_id: anular(self.base, salida_id, self.usuario["id"], self.motivo_decision.text()))

    def _actuar_garantia(self, accion) -> None:
        salida_id = self._id_en(self.tabla_garantias)
        if salida_id is None:
            QMessageBox.information(self, "Garantías", "Elige una salida.")
            return
        try:
            accion(salida_id)
        except ReglaError as exc:
            QMessageBox.warning(self, "Garantías", str(exc))
            return
        self.motivo_decision.clear()
        self._cargar_garantias()

    def _buscar_guia_devolucion(self) -> None:
        hallada = buscar_guia(self.base, self.guia_devolucion.text())
        if hallada is None:
            self.aviso_guia_devolucion.setText("Esa guía no está en un corte. Se puede registrar igual, como recepción sin vínculo.")
            return
        self.aviso_guia_devolucion.setText(
            f"Vinculada al corte {hallada['corte']} de {hallada['transportadora']} del {hallada['fecha']}."
        )

    def _agregar_linea_devolucion(self) -> None:
        producto_id = self.producto_devolucion.currentData()
        if not producto_id:
            QMessageBox.information(self, "Devoluciones", "Primero importa o crea un producto en el maestro.")
            return
        if not self.disposicion_devolucion.text().strip():
            QMessageBox.information(self, "Devoluciones", "Indica qué se hace con lo recibido.")
            return
        self.lineas_devolucion.append(
            {
                "producto_id": int(producto_id),
                "nombre": self.producto_devolucion.currentText(),
                "cantidad": self.cantidad_devolucion.value(),
                "estado_producto": self.estado_devolucion.currentData(),
                "disposicion": self.disposicion_devolucion.text().strip(),
                "evidencia": self.evidencia_devolucion.text().strip(),
            }
        )
        self.disposicion_devolucion.clear()
        self.evidencia_devolucion.clear()
        self._pintar_lineas_devolucion()

    def _quitar_linea_devolucion(self) -> None:
        fila = self.lista_lineas_devolucion.currentRow()
        if fila < 0:
            return
        del self.lineas_devolucion[fila]
        self._pintar_lineas_devolucion()

    def _pintar_lineas_devolucion(self) -> None:
        self.lista_lineas_devolucion.clear()
        for linea in self.lineas_devolucion:
            estado = ESTADOS.get(linea["estado_producto"], linea["estado_producto"])
            self.lista_lineas_devolucion.addItem(f"{linea['nombre']} x {linea['cantidad']} · {estado} · {linea['disposicion']}")

    def _registrar_devolucion(self) -> None:
        try:
            registrar_devolucion(
                self.base,
                self.usuario["id"],
                self.guia_devolucion.text(),
                self.observacion_devolucion.text(),
                self.lineas_devolucion,
            )
        except ReglaError as exc:
            QMessageBox.warning(self, "Devoluciones", str(exc))
            return
        self.lineas_devolucion.clear()
        self.observacion_devolucion.clear()
        self.guia_devolucion.clear()
        self.aviso_guia_devolucion.setText("Recepción registrada.")
        self._pintar_lineas_devolucion()
        self._cargar_devoluciones()

    def _cargar_devoluciones(self) -> None:
        filas = listar_devoluciones(self.base)
        self._llenar(
            self.tabla_devoluciones,
            filas,
            lambda fila: [
                fila["guia_origen"] or "Sin guía",
                fila["recibido_en"],
                fila["recibio"],
                fila["lineas"] or "",
                "Anulada" if fila["anulado"] else "Registrada",
            ],
            id_de=lambda fila: fila["id"],
        )

    def _anular_devolucion(self) -> None:
        devolucion_id = self._id_en(self.tabla_devoluciones)
        if devolucion_id is None:
            QMessageBox.information(self, "Devoluciones", "Elige una recepción.")
            return
        try:
            anular_devolucion(self.base, devolucion_id, self.usuario["id"], self.motivo_anular_devolucion.text())
        except ReglaError as exc:
            QMessageBox.warning(self, "Devoluciones", str(exc))
            return
        self.motivo_anular_devolucion.clear()
        self._cargar_devoluciones()

    def _agregar_linea_muestra(self) -> None:
        producto_id = self.producto_muestra.currentData()
        if not producto_id:
            QMessageBox.information(self, "Muestras", "Primero importa o crea un producto en el maestro.")
            return
        self.lineas_muestra.append(
            {
                "producto_id": int(producto_id),
                "nombre": self.producto_muestra.currentText(),
                "cantidad": self.cantidad_muestra.value(),
            }
        )
        self._pintar_lineas_muestra()

    def _quitar_linea_muestra(self) -> None:
        fila = self.lista_lineas_muestra.currentRow()
        if fila < 0:
            return
        del self.lineas_muestra[fila]
        self._pintar_lineas_muestra()

    def _pintar_lineas_muestra(self) -> None:
        self.lista_lineas_muestra.clear()
        for linea in self.lineas_muestra:
            self.lista_lineas_muestra.addItem(f"{linea['nombre']} x {linea['cantidad']}")

    def _registrar_muestra(self) -> None:
        try:
            registrar_muestra(
                self.base,
                self.usuario["id"],
                self.tipo_muestra.currentData(),
                self.pedido_muestra.text(),
                self.destinatario_muestra.text(),
                self.observacion_muestra.text(),
                self.lineas_muestra,
            )
        except ReglaError as exc:
            QMessageBox.warning(self, "Muestras", str(exc))
            return
        self.lineas_muestra.clear()
        self.pedido_muestra.clear()
        self.destinatario_muestra.clear()
        self.observacion_muestra.clear()
        self._pintar_lineas_muestra()
        self._cargar_muestras()

    def _cargar_muestras(self) -> None:
        filas = listar_muestras(self.base)
        self._llenar(
            self.tabla_muestras,
            filas,
            lambda fila: [
                TIPOS_MUESTRA.get(fila["tipo"], fila["tipo"]),
                fila["pedido"],
                fila["destinatario"],
                fila["factura_numero"] or "",
                fila["valido"] or "",
                fila["despacho"] or "",
                fila["lineas"] or "",
                _estado_muestra(fila),
            ],
            id_de=lambda fila: fila["id"],
        )

    def _validar_factura_muestra(self) -> None:
        salida_id = self._id_en(self.tabla_muestras)
        if salida_id is None:
            QMessageBox.information(self, "Muestras", "Elige un pedido.")
            return
        try:
            validar_factura(self.base, salida_id, self.usuario["id"], self.factura_muestra.text())
        except ReglaError as exc:
            QMessageBox.warning(self, "Muestras", str(exc))
            return
        self.factura_muestra.clear()
        self._cargar_muestras()

    def _despachar_muestra(self) -> None:
        salida_id = self._id_en(self.tabla_muestras)
        if salida_id is None:
            QMessageBox.information(self, "Muestras", "Elige un pedido.")
            return
        try:
            despachar_muestra(self.base, salida_id, self.usuario["id"])
        except ReglaError as exc:
            QMessageBox.warning(self, "Muestras", str(exc))
            return
        self._cargar_muestras()

    def _anular_muestra(self) -> None:
        salida_id = self._id_en(self.tabla_muestras)
        if salida_id is None:
            QMessageBox.information(self, "Muestras", "Elige un pedido.")
            return
        try:
            anular_muestra(self.base, salida_id, self.usuario["id"], self.motivo_anular_muestra.text())
        except ReglaError as exc:
            QMessageBox.warning(self, "Muestras", str(exc))
            return
        self.motivo_anular_muestra.clear()
        self._cargar_muestras()

    def _elegir_mercado(self) -> None:
        ruta, _ = QFileDialog.getOpenFileName(self, "Export de Mercado Libre", "", "Excel (*.xlsx)")
        if not ruta:
            return
        try:
            self.lectura_mercado = preparar_mercado(self.base, revisar_ventas(ruta))
        except Exception as exc:
            QMessageBox.warning(self, "Mercado Libre", str(exc) or "No se pudo leer el Excel.")
            return
        self.confirmo_mercado.setChecked(False)
        self._pintar_mercado()

    def _pintar_mercado(self) -> None:
        lectura = self.lectura_mercado
        if lectura is None:
            self.resultado_mercado.setText("Todavía no hay un export en revisión.")
            self.lista_mercado.setRowCount(0)
            return
        textos = [
            f"{lectura.nombre_archivo}: {len(lectura.ventas)} ventas, {lectura.unidades} unidades.",
            *lectura.avisos,
            *lectura.bloqueos,
        ]
        self.resultado_mercado.setText("\n".join(textos))
        self._llenar(
            self.lista_mercado,
            lectura.resumen,
            lambda item: [
                item.nombre,
                item.id_dropi,
                str(item.cantidad),
                "Asociado" if item.producto_id else "Sin asociar",
            ],
        )

    def _asociar_mercado(self) -> None:
        if self.lectura_mercado is None:
            return
        fila = self.lista_mercado.currentRow()
        if fila < 0 or fila >= len(self.lectura_mercado.resumen):
            QMessageBox.information(self, "Mercado Libre", "Elige el título que vas a asociar.")
            return
        item = self.lectura_mercado.resumen[fila]
        try:
            if self.codigo_mercado.text().strip():
                producto_id = crear_producto(self.base, self.usuario["id"], self.codigo_mercado.text(), self.nombre_mercado.text())
            else:
                producto_id = self.producto_mercado.currentData()
                if not producto_id:
                    raise ReglaError("Elige un producto del maestro o escribe el código para crear uno.")
            asociar_producto(self.base, self.usuario["id"], "", item.id_dropi, item.nombre, int(producto_id), "MercadoLibre")
        except ReglaError as exc:
            QMessageBox.warning(self, "Mercado Libre", str(exc))
            return
        self.codigo_mercado.clear()
        self.nombre_mercado.clear()
        self._recargar_productos()
        self.lectura_mercado = preparar_mercado(self.base, self.lectura_mercado)
        self._pintar_mercado()

    def _guardar_mercado(self) -> None:
        if self.lectura_mercado is None:
            QMessageBox.information(self, "Mercado Libre", "Primero elige el export.")
            return
        try:
            guardar_mercado(
                self.base,
                self.lectura_mercado,
                self.usuario["id"],
                self.confirmo_mercado.isChecked(),
                date.today().isoformat(),
            )
        except ReglaError as exc:
            QMessageBox.warning(self, "Mercado Libre", str(exc))
            return
        self.lectura_mercado = None
        self.confirmo_mercado.setChecked(False)
        self._pintar_mercado()
        self._cargar_lotes_mercado()

    def _cargar_lotes_mercado(self) -> None:
        filas = listar_mercado(self.base)
        self._llenar(
            self.tabla_lotes_mercado,
            filas,
            lambda fila: [
                fila["nombre_archivo"],
                fila["fecha"],
                str(fila["ventas"]),
                str(fila["unidades"]),
                fila["cargo"],
                "Anulado" if fila["anulado"] else "Cargado",
            ],
            id_de=lambda fila: fila["id"],
        )

    def _anular_mercado(self) -> None:
        lote_id = self._id_en(self.tabla_lotes_mercado)
        if lote_id is None:
            QMessageBox.information(self, "Mercado Libre", "Elige un lote.")
            return
        try:
            anular_mercado(self.base, lote_id, self.usuario["id"], self.motivo_anular_mercado.text())
        except ReglaError as exc:
            QMessageBox.warning(self, "Mercado Libre", str(exc))
            return
        self.motivo_anular_mercado.clear()
        self._cargar_lotes_mercado()

    def _buscar_guia(self) -> None:
        numero = self.busca_guia.text().strip()
        filas = self.base.conn.execute(
            """
            SELECT g.numero, c.fecha, c.numero AS corte, t.nombre, g.ciudad, g.recaudo,
                COALESCE(gp.texto_crudo, '') AS rotulo
            FROM guia g
            JOIN corte c ON c.id = g.corte_id
            JOIN transportadora t ON t.id = c.transportadora_id
            LEFT JOIN guia_producto gp ON gp.guia_id = g.id
            WHERE g.numero = ? AND c.anulado = 0
            ORDER BY c.fecha, c.numero
            """,
            (numero,),
        ).fetchall()
        self._llenar(
            self.tabla_guias,
            filas,
            lambda fila: [fila["numero"], fila["fecha"], str(fila["corte"]), fila["nombre"], fila["ciudad"] or "", fila["recaudo"] or "", fila["rotulo"][:80]],
        )
        if not filas:
            QMessageBox.information(self, "Consulta", "Esa guía no está en ningún corte.")

    def _exportar(self) -> None:
        if self.usuario["rol"] not in {"ADMINISTRADOR", "COORDINACION", "SALIDAS_ECOMMERCE", "DESPACHADOR", "CONSULTA"}:
            QMessageBox.warning(self, "Excel", "No tienes permiso para exportar.")
            return
        fecha = self.fecha_tablero.date().toString("yyyy-MM-dd")
        destino, _ = QFileDialog.getSaveFileName(self, "Exportar Excel", f"corte-{fecha}.xlsx", "Excel (*.xlsx)")
        if not destino:
            return
        try:
            exportar_excel(self.base, fecha, Path(destino), self.usuario["id"])
        except ReglaError as exc:
            QMessageBox.warning(self, "Excel", str(exc))
            return
        QMessageBox.information(self, "Excel", "Archivo listo. Las celdas llevan valores, sin fórmulas.")

    def _exportar_rango(self) -> None:
        if self.usuario["rol"] not in {"ADMINISTRADOR", "COORDINACION", "SALIDAS_ECOMMERCE", "DESPACHADOR", "CONSULTA"}:
            QMessageBox.warning(self, "Excel", "No tienes permiso para exportar.")
            return
        desde = self.fecha_desde.date().toString("yyyy-MM-dd")
        hasta = self.fecha_hasta.date().toString("yyyy-MM-dd")
        destino, _ = QFileDialog.getSaveFileName(self, "Movimiento del rango", f"movimiento-{desde}-{hasta}.xlsx", "Excel (*.xlsx)")
        if not destino:
            return
        try:
            exportar_rango(self.base, desde, hasta, Path(destino), self.usuario["id"])
        except ReglaError as exc:
            QMessageBox.warning(self, "Excel", str(exc))
            return
        QMessageBox.information(self, "Excel", "Archivo listo. Las celdas llevan valores, sin fórmulas.")

    def _crear_usuario(self) -> None:
        try:
            crear_usuario(
                self.base,
                self.usuario["id"],
                self.nuevo_usuario.text(),
                self.nuevo_nombre.text(),
                self.nuevo_pin.text(),
                self.nuevo_rol.currentText(),
            )
        except ReglaError as exc:
            QMessageBox.warning(self, "Usuario", str(exc))
            return
        self.nuevo_pin.clear()
        QMessageBox.information(self, "Usuario", "Usuario creado.")

    def _importar_maestro(self) -> None:
        ruta, _ = QFileDialog.getOpenFileName(self, "Maestro", "", "Excel (*.xlsx)")
        if not ruta:
            return
        try:
            total = importar_maestro(self.base, Path(ruta), self.usuario["id"])
        except Exception as exc:
            configurar_registro().exception("Fallo al importar el maestro")
            QMessageBox.warning(self, "Maestro", str(exc) or "No se pudo leer el Excel.")
            return
        self._recargar_productos()
        QMessageBox.information(self, "Maestro", f"Quedaron {total} productos del archivo.")

    def _respaldar(self) -> None:
        destino = self.base.respaldar()
        from despachos.auditoria import registrar

        with self.base.transaccion() as conn:
            registrar(conn, self.usuario["id"], "respaldo.crear", destino.name)
        QMessageBox.information(self, "Respaldo", f"Copia guardada en {destino}")

    def _verificar(self) -> None:
        _ok, mensaje = verificar_cadena(self.base.conn)
        QMessageBox.information(self, "Bitácora", mensaje)

    def _recargar_productos(self) -> None:
        self.producto_combo.clear()
        self.producto_garantia.clear()
        self.producto_devolucion.clear()
        self.producto_muestra.clear()
        self.producto_mercado.clear()
        filas = self.base.conn.execute(
            "SELECT id, codigo_interno, nombre FROM producto WHERE activo = 1 ORDER BY nombre"
        ).fetchall()
        for fila in filas:
            self.producto_combo.addItem(f"{fila['codigo_interno']} · {fila['nombre']}", fila["id"])
            self.producto_garantia.addItem(f"{fila['codigo_interno']} · {fila['nombre']}", fila["id"])
            self.producto_devolucion.addItem(f"{fila['codigo_interno']} · {fila['nombre']}", fila["id"])
            self.producto_muestra.addItem(f"{fila['codigo_interno']} · {fila['nombre']}", fila["id"])
            self.producto_mercado.addItem(f"{fila['codigo_interno']} · {fila['nombre']}", fila["id"])
        if hasattr(self, "prefijo_transportadora"):
            actual = self.prefijo_transportadora.currentData()
            self.prefijo_transportadora.clear()
            transportadoras = self.base.conn.execute(
                "SELECT id, nombre, nombre_dropi FROM transportadora WHERE activa = 1 ORDER BY orden"
            ).fetchall()
            for fila in transportadoras:
                self.prefijo_transportadora.addItem(f"{fila['nombre']} · {fila['nombre_dropi']}", fila["id"])
            if actual:
                indice = self.prefijo_transportadora.findData(actual)
                if indice >= 0:
                    self.prefijo_transportadora.setCurrentIndex(indice)

    def _parametro(self, clave: str) -> str:
        fila = self.base.conn.execute("SELECT valor FROM parametro WHERE clave = ?", (clave,)).fetchone()
        return fila["valor"] if fila else ""

    def _id_en(self, tabla: QTableWidget) -> int | None:
        fila = tabla.currentRow()
        if fila < 0:
            return None
        item = tabla.item(fila, 0)
        if item is None:
            return None
        valor = item.data(Qt.ItemDataRole.UserRole)
        return int(valor) if valor else None

    def _tabla(self, columnas: list[str]) -> QTableWidget:
        tabla = QTableWidget(0, len(columnas))
        tabla.setHorizontalHeaderLabels(columnas)
        tabla.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        tabla.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        tabla.horizontalHeader().setStretchLastSection(True)
        return tabla

    def _llenar(self, tabla: QTableWidget, filas, columnas, id_de=None) -> None:
        tabla.setRowCount(len(filas))
        for fila_idx, fila in enumerate(filas):
            for columna, valor in enumerate(columnas(fila)):
                item = QTableWidgetItem(valor)
                if id_de and columna == 0:
                    item.setData(Qt.ItemDataRole.UserRole, id_de(fila))
                tabla.setItem(fila_idx, columna, item)


def _estado_muestra(fila) -> str:
    if fila["anulado"]:
        return "Anulado"
    if fila["despachado_en"]:
        return "Despachado"
    if fila["factura_numero"]:
        return "Factura validada"
    return "Sin factura"


def _gancho(tipo, valor, traza) -> None:
    configurar_registro().error("".join(traceback.format_exception(tipo, valor, traza)))
    texto = str(valor) or "Ocurrió un error. El detalle quedó en el registro."
    if QApplication.instance() is not None:
        QMessageBox.critical(None, "Error", texto)


def main() -> None:
    sys.excepthook = _gancho
    configurar_registro()
    app = QApplication(sys.argv)
    app.setStyleSheet(ESTILO)
    base = BaseDatos()
    try:
        ultimo = base.ruta.parent / "respaldos"
        hoy = date.today().strftime("%Y%m%d")
        if not any(ultimo.glob(f"despachos-{hoy}-*.db")):
            base.respaldar()
    except Exception:
        configurar_registro().exception("No se pudo hacer el respaldo del día")
    ventana = Ventana(base)
    ventana.show()
    sys.exit(app.exec())
