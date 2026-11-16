# Pendientes del control de despachos

La entrega es la aplicación web de VitalcomeBase (Angular, NestJS y PostgreSQL). No se empaqueta un `.exe`. La bodega entra por el navegador. Python queda en el servidor solo para leer el PDF de DROPI.

El lector verificado está en `backend/lector_dropi/` (`parser_dropi.py`, `db.py`, `servicios.py`, `reportes.py`, `config.py`, `pruebas_parser.py`, más `REQUERIMIENTO.md` y `DISEÑO.md`). Es copia fiel del paquete; no se reescribe. NestJS llama a `parser_dropi.py` para leer el manifiesto y guarda el corte en PostgreSQL. `docs` ya no hace falta para leer el PDF.

La carpeta `despachos/` de este repositorio es el prototipo de escritorio que se armó antes de tener ese paquete. No es el producto y no se empaqueta.

## Para arrancar la web

Desde `backend` y `frontend`, con PostgreSQL, como el resto de VitalcomeBase. La pantalla está en Despachos. El administrador del seed tiene `DESPACHO_CARGAR`, `DESPACHO_ALISTAR`, `DESPACHO_CONSULTAR` y `DESPACHO_DESPACHAR`. El gestor de inventario también.

El prototipo de escritorio, si hace falta mirarlo, sigue abriéndose así:

```powershell
pip install -r despachos/requirements.txt
python -m despachos
```

## Lo que sigue faltando del paquete

El código verificado ya no depende de `docs`: está en `backend/lector_dropi/`. La plantilla real del corte está en `referencia/CORTE B1 ACTUALIZADO.xlsx`. El catálogo de productos está en `referencia/MAESTRO.xlsx`.

Sigue faltando un manifiesto DROPI completo. El archivo de referencia es `documento-30-09-2026_0744.pdf` (217 guías, 382 unidades, INTERRAPIDISIMO, 30-09-2026). Sirve cualquier PDF que DROPI baje con Imprimir seleccionadas para una sola transportadora y un solo corte: tabla de guías, resumen de productos (ID, SKU, nombre, cantidad) y páginas de rótulos con `GUIA:`. No hace falta que sea esa fecha ni esa transportadora. No sirven la foto de WhatsApp del resumen, una factura de venta ni una orden de laboratorio.

Sin ese PDF no se puede repetir la prueba de 217 guías. Las pruebas de `pruebas_parser.py` no lo necesitan: usan texto de ejemplo.

El 12 de noviembre de 2026 se corrió `python pruebas_parser.py` en `docs/Zoho WorkDrive/Control_Despachos_Bodega`. Las 29 comprobaciones quedaron en verde (el requerimiento las resume como 28 pruebas). No se volvió a leer el PDF de 238 páginas porque ese archivo no está en el repositorio.

## Supuestos de esta construcción

- El alistamiento no se parte por persona. Quienes quedan asignados al corte ven la misma lista, y cada etapa guarda quién la marcó.
- Las hojas de Excel cubren los cortes 1 a 6, como la plantilla. Un corte 7 o mayor no entra en esas columnas.
- La notación científica del maestro se expande tal como quedó escrita. Si Excel ya perdió dígitos del código de barras, no se pueden recuperar.
- El patrón exacto del bloque de resumen del PDF se armó con las tres rarezas documentadas (SKU vacío, nombre partido por la cantidad, un SKU con varios ID). Hay que contrastarlo con el PDF real.
- Quien carga el corte puede ser cualquier usuario con acceso a esa pantalla. La prohibición de autoasignarse se aplica al asignar, salvo el Administrador.

## Fase 2, ya en la web

En Despachos → DROPI, al elegir un corte, quien tiene `DESPACHO_DESPACHAR` escanea, represa, reprograma y cierra. La pistola se usa como teclado: el código cae en el campo y Enter lo registra. El prefijo de cada transportadora sigue vacío hasta tener etiquetas reales.

El prototipo de escritorio hacía lo mismo con el usuario `despachador`.

- El primer escaneo de una guía del corte la marca verificada.
- Un escaneo repetido queda en la bitácora y no vuelve a sumar.
- Una guía de otro corte avisa y no cuenta.
- Represar pide motivo. Reprogramar la vincula a otro corte abierto del mismo día.
- Cerrar exige que cada guía esté verificada o represada, el auxiliar que recibe, y un motivo si el alistamiento no terminó.
- El administrador guarda el prefijo de cada transportadora. Sin etiquetas reales, esos prefijos siguen vacíos.
- En el Excel, el conteo y los números de guía represados salen en la primera fila del producto. Todavía no se puede partir esa cantidad por producto, porque el rótulo no trae una cantidad confiable.

## Fase 3, ya en Cargar corte

En la pantalla de carga se elige la plataforma.

- EFFI y MasterShop leen Excel. Si el archivo trae varias transportadoras, sale un corte por cada una. El número de corte lo sigue poniendo Coordinación.
- La relación de despacho de EFFI queda en la guía. No reemplaza el número de corte.
- El contenido `1 * COMBO ADVANCE.` se parte en cantidad y nombre, y hay que asociarlo a mano. No se cruza por parecido.
- Vendela sigue sin lector: la pantalla explica que falta el archivo de ejemplo.
- Estos lectores no están contrastados con los Excel reales del equipo. Si faltan columnas, el archivo no se guarda y se muestran los encabezados que sí trae.

## Fase 4, ya en Garantías

Entra con `garantias` y el PIN `1234`. El administrador autoriza.

- La salida es garantía a un cliente o contenido para redes. Lleva motivo, destinatario, producto y cantidad.
- Quien la solicita no puede autorizarla ni rechazarla.
- Solo se entrega después de la autorización.
- Rechazar y anular dejan el motivo. La fila no se borra. Anular lo hace el administrador, y una salida ya entregada no se anula.

## Fase 5, ya en Devoluciones

Entra con `devoluciones` y el PIN `1234`.

- Es una entrada. No crea un corte ni un alistamiento.
- Si la guía existe en un corte, la recepción queda vinculada. Si no existe, se registra igual.
- Cada producto lleva cantidad recibida, estado bueno o con novedad, qué se hace con él y una evidencia en texto.
- Anular pide motivo y conserva la fila.

## Fase 6, ya en Muestras

Entra con `muestras` y el PIN `1234`.

- El pedido es una muestra o una venta mayorista. Lleva referencia, destinatario y productos.
- No se despacha hasta que alguien escribe el número de la factura. Quedan guardados el número, la persona y la hora.
- El mismo número de factura no se repite en otro pedido vigente.
- Anular pide motivo y conserva la fila. Un pedido ya despachado no se anula.

## Fase 7, ya en Mercado Libre

Entra con `mercadolibre` y el PIN `1234`.

- Tiene pantalla propia. El export no crea un corte ni un alistamiento.
- La asociación usa el título de la publicación. Si el archivo trae SKU, esa columna no se usa como clave.
- Una misma venta puede traer varios títulos. Cada uno queda en su fila.
- El mismo archivo no se vuelve a guardar. Anular pide motivo y conserva las ventas.
- Este lector no está contrastado con el export real. Si faltan columnas, no se guarda y se muestran los encabezados que sí trae.

## Movimiento del día

En el tablero, debajo de los cortes, se ven las garantías, devoluciones, muestras y lotes de Mercado Libre de esa fecha.

En Consultar, Desde y Hasta exportan un Excel del rango. Trae una hoja de resumen y una por proceso. Las celdas llevan valores, sin fórmulas. La fecha de Mercado Libre es la de la carga, no la de la venta.

## Fuera de esta entrega

- El producto es la web. El `.exe` no se construye. El criterio de aceptación pasa a ser entrar por el navegador, sin instalar Python en el puesto de bodega.
- La Fase 1 DROPI (cargar, homologar, asignar, tres etapas y Excel sin fórmulas) y la Fase 2 (escanear, represar, reprogramar y cerrar) viven en NestJS y Angular. Las fases 3 a 7 del prototipo de escritorio no se trasladan todavía.
- Vendela sigue sin lector: falta el archivo de ejemplo.
- Órdenes de producción y maquilas: en espera de la respuesta del jefe. El manual quedó en `referencia/Manual_Control_de_Maquilas_Vitalcom.md`. La aplicación local y su respaldo del 27 de octubre de 2026 siguen solo en `docs` y en el equipo donde se usa (`Documents\Mayo 2026\Control de Maquilas Vitalcom`).

## Revisión de docs, 12 de noviembre de 2026

Se revisó la carpeta antes de borrarla. No apareció `documento-30-09-2026_0744.pdf` ni ningún otro manifiesto impreso de DROPI.

Lo que sí se conservó fuera de `docs`:

- El paquete de despachos, en `backend/lector_dropi/`. `Zoho WorkDrive` y `Zoho WorkDrive2` traían el mismo `parser_dropi.py`.
- El modelo comercial del 18 de septiembre de 2026, en `referencia/vitalcom_modelo_er.sql`. Es un diseño de dashboard (precios, compras, inventario, ventas, logística, billeteras). No es el esquema de esta aplicación. La guía ahí es única por transportadora, y un traslado de bodega no cuenta como venta.
- El manual de maquilas y la plantilla del corte, en `referencia/`.

Se puede borrar el resto de `docs`:

- `Zoho WorkDrive.zip` (699 MB) es el archivo completo de las dos aplicaciones. No contiene el PDF de guías.
- `Sin confirmar 146493.crdownload` (499 MB) es una descarga de zip a medias, no un PDF.
- `Zoho WorkDrive2` repite `Zoho WorkDrive`. El perfil de Edge dentro de maquilas no es documentación.
- `vitalcom_app (1)` es la app de precios, fuera de este alcance.
- `CONSOLIDAR_DESPACHOS.py` e `INFORME_DESPACHOS_TRIMESTRE.py` leen carpetas `Despachos Vitalcom` y `Despachos Biobell` que no vinieron. El dashboard de ventas apunta a `C:\Users\Analista Datos\Documents\Mayo 2026`.
- `_crear_taller_resuelto.py` es un taller de minería de datos, no de bodega.
- `CONEXION-BD.md` describe otra plantilla Docker (`plantilla-inicio`), no esta API.
- `GUIAS DROPI 1 - 7 JUNIO.xlsx` es un export de pedidos de DROPI (guía, transportadora, SKU, cantidad, estatus). No es el PDF de imprimir seleccionadas. Trae datos de pedidos; no se copió al repositorio.
- La foto de WhatsApp, la factura FV 8619 y la orden HER000012 no reemplazan el manifiesto.
- El inventario de VitalcomeBase no se mueve al guardar un corte. El stock oficial sigue en DsNube.
- No hay API de WhatsApp.
