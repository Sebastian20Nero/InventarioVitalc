# Control de Salidas de Bodega — requerimiento

**Para:** el equipo de desarrollo
**De:** Coordinación Administrativa · Vitalcom Group Commerce SAS

Especifica qué debe construirse para reemplazar el control manual de salidas de
bodega que hoy se lleva en Excel.

No es un documento abierto. Varias decisiones ya están tomadas, y la sección 13
explica **por qué** cada una: son las que suelen deshacerse por desconocer el
motivo. Lo que sigue sin definir está en la sección 14.

---

## 1. El problema

Todos los días la bodega hace tres cortes de despacho. Por cada corte y
transportadora, la plataforma de e-commerce genera un PDF con las guías
impresas, y hoy **ese PDF se pasa a mano a un Excel**.

| Problema actual | Consecuencia |
|---|---|
| Transcripción manual | Lento y con errores de digitación |
| Nadie firma lo que hace | No se sabe quién alistó una guía que salió mal |
| El Excel se daña | Aparecen errores de referencia y se pierde información |
| Represados sin registro | Lo que no salió se olvida y no se reprograma |
| Salidas sin precio sin control | Garantías y contenido salen sin rastro |

---

## 2. Qué debe hacer la herramienta

Aplicación de escritorio para Windows, empaquetada como **un solo `.exe`** que
no exija instalar nada en el equipo de bodega.

### Requisitos funcionales

| # | Requisito |
|---|---|
| R1 | Leer el manifiesto de la plataforma y extraer guías, productos y cantidades |
| R2 | Validar antes de guardar: que las guías cuadren con los rótulos y los productos con el resumen |
| R3 | Rechazar un PDF ya cargado; avisar si una guía aparece en otro corte |
| R4 | Traducir las referencias de la plataforma al maestro interno de productos |
| R5 | Generar la lista de alistamiento del corte, imprimible |
| R6 | Asignar cada corte a una o varias personas de bodega |
| R7 | Registrar las tres etapas del alistamiento con su responsable |
| R8 | Verificar las guías con lector de código de barras |
| R9 | Cerrar el corte, registrar represados con motivo y los datos de entrega |
| R10 | Reasignar una guía represada a un corte posterior |
| R11 | Exportar al mismo formato del Excel actual, **sin fórmulas** |
| R12 | Tablero del día, buscador por guía y reportes por rango |
| R13 | Usuarios con perfil, y permisos por acción |
| R14 | Bitácora de toda acción relevante, inalterable |
| R15 | Respaldo automático diario de la base |

### Requisitos técnicos

| | |
|---|---|
| Lenguaje | Python 3.11 o superior |
| Interfaz | CustomTkinter o PySide6 · en español · botones grandes, usable en bodega |
| Lectura de PDF | pdfplumber o PyMuPDF |
| Base de datos | SQLite local en un archivo, **diseñada para poder migrar a base en red** |
| Excel | openpyxl |
| Empaquetado | PyInstaller, un `.exe` con ícono |
| Errores | Mensajes en español, nunca cerrar la aplicación de golpe, archivo de registro |

---

## 3. Lo que ya está construido

Existe un **núcleo funcional en Python, probado contra los archivos reales**. No
hay que rehacerlo: la interfaz y las fases siguientes se montan encima.

| Módulo | Qué resuelve | Estado |
|---|---|---|
| `config.py` | Rutas, parámetros, catálogo de transportadoras, registro | listo |
| `parser_dropi.py` | Lee el manifiesto de DROPI | **probado con el PDF real de 238 páginas** |
| `db.py` | 14 tablas, bitácora encadenada, respaldos | listo |
| `servicios.py` | Cargar, homologar, asignar, alistar por etapas | listo |
| `reportes.py` | Importa el maestro y exporta al formato del Excel | **probado con el Excel real** |
| `pruebas_parser.py` | 28 pruebas del lector | en verde |

**Falta:** la interfaz de usuario y el empaquetado a `.exe`.

### Prueba contra el manifiesto real

`documento-30-09-2026_0744.pdf` · 238 páginas · 17 MB · se lee en 33 segundos

| | Esperado | Obtenido |
|---|---|---|
| Transportadora | INTERRAPIDISIMO | correcto |
| Fecha de manifiesto | 30-09-2026 | correcto |
| Guías | 217 | **217**, consecutivos 1–217 sin faltantes |
| Productos distintos | 30 | **30** |
| AGUAJE.PV julio | 68 | correcto |
| SUPERFULL.CM | 60 | correcto |
| LYMPHATIC DRAINAGE CON CAJA | 60 | correcto |

Las cuatro validaciones pasan, incluida la suma de productos: 382 unidades en
los rótulos contra 382 en el resumen.

---

## 4. Cómo se genera el manifiesto en DROPI

El PDF no aparece solo: es el resultado de un procedimiento que hace la
coordinación en el portal de DROPI, **antes** de que la herramienta entre a
trabajar. Entenderlo explica por qué existe un manifiesto por corte y
transportadora, y qué debe coincidir con lo que se cargue.

### El procedimiento, paso a paso

| # | Paso en el portal |
|---|---|
| 1 | Filtrar las órdenes por estatus **PENDIENTE** |
| 2 | Filtrar por **transportadora** |
| 3 | Seleccionar las órdenes de esa transportadora |
| 4 | **Generar guía** |
| 5 | Las órdenes pasan a estatus **GUÍA GENERADA** |
| 6 | Volver a filtrar por esa transportadora |
| 7 | **Imprimir seleccionadas** → se descarga el PDF del manifiesto |

Se repite una vez por cada transportadora del corte. **De ahí sale un PDF por
corte y transportadora**, que es exactamente lo que la herramienta espera.

### Lo que esto implica para la herramienta

**El corte es una decisión de la coordinación, no un dato del PDF.**
DROPI no sabe qué es un corte: la coordinación decide qué órdenes entran a cada
uno al seleccionarlas. Por eso el número de corte se sugiere pero debe quedar
editable, y por eso un mismo día puede tener tres manifiestos de la misma
transportadora.

**El manifiesto refleja un momento exacto.**
Si entre la generación de la guía y la impresión entran órdenes nuevas, el PDF
ya no las incluye. La herramienta trabaja sobre lo impreso, que es lo que
físicamente sale de la bodega.

**Una orden solo debe generar guía una vez.**
Si se repite el paso 4 sobre órdenes que ya pasaron a GUÍA GENERADA, aparecen
guías duplicadas. Por eso la validación de guía repetida en otro corte **avisa
pero no bloquea**: hay que distinguir el duplicado por error del represado que
reaparece legítimamente.

### Datos que el portal expone y conviene aprovechar

El listado de DROPI trae, por orden: ID, nombre del producto, fecha, cliente,
**estatus**, **transportadora**, **bodega**, **tipo de envío** (con o sin
recaudo), si está impresa, y etiqueta.

Los filtros incluyen además varios que corresponden a procesos de la bodega:

| Filtro del portal | Para qué sirve aquí |
|---|---|
| **Órdenes de garantía** | DROPI ya marca las garantías: no hay que deducirlas |
| **Órdenes indemnizadas** | Caso aparte, hoy sin tratamiento definido |
| Impresas / no impresas | Permite ver qué quedó sin imprimir de un corte |
| Bodega | Hoy siempre VITALCOM; el filtro existe si mañana hay más |
| Fecha de creado / de despachado | Dos fechas distintas que no deben confundirse |

> **El filtro «Órdenes de garantía» del portal confirma que las garantías son un
> flujo propio también en origen**, no una interpretación de la bodega. Cuando
> se construya ese proceso (Fase 4), conviene revisar si el manifiesto de esas
> órdenes se puede descargar por separado.

---

## 5. Cómo leer el PDF de la plataforma

Esta sección existe porque lo que describía el requerimiento **no es lo que
entrega el PDF**, y la diferencia cambió el diseño del lector.

### El manifiesto es una tabla, no líneas de texto

**Lo que decía el requerimiento:**

```
Nro: 1 | Guia: 240062419605 | Ciudad Destino: TIERRALTA | Valor de Recaudo: 249000.00 | ...
```

**Lo que entrega el PDF al extraer el texto:**

```
Guia:          Valor de Recaudo:  Tipo de logistica: CON
Nro: 1         Ciudad Destino: TIERRALTA
240062419605   249000.00          RECAUDO
```

Y con **tres variantes dentro del mismo archivo**:

| Variante | Dónde | Qué cambia |
|---|---|---|
| A | páginas 1–8 | `Nro:` y su número en la misma fila |
| B | páginas 9+ | el número cae en la fila de valores |
| C | guía 92 | la ciudad larga se parte entre la primera fila y la última |

Un lector por expresiones regulares capturaba **98 de 217 guías en silencio**.

**La solución: leer por coordenadas.** Las columnas sí están en posición
estable, y por ahí se lee:

| Columna | Posición (puntos) |
|---|---|
| Nro | ~35 |
| Guía | ~75 |
| Ciudad | ~171 |
| Valor | ~490 |
| Tipo | ~612 |

Cada guía se delimita anclando en la **fila de valores**, que es la última del
bloque y la única con posición fiable. El bloque va desde donde terminó el
anterior, con un alto máximo para no absorber el encabezado.

### El resumen de productos sí coincide

Esta sección se lee bien con expresiones. Trae las tres rarezas anunciadas, y
las tres se resuelven:

- **SKU vacío** → se identifica por el ID
- **Nombre partido con la cantidad en medio** → `ENVIO EXPRESS` / `30` /
  `ASEGURADO` se reconstruye entero
- **Un SKU con varios ID** → `13MAG154`, `12CUT349` y `22DEL091` salen como
  productos distintos, con su nombre y cantidad propios

> El corte entre el resumen y los rótulos se decide **por página, no por
> línea**. La primera página de rótulos empieza con el horario y la ruta de la
> transportadora, y solo más abajo aparece `GUIA:`. Cortando por línea, esas
> primeras líneas se pegaban al último producto y le cambiaban la cantidad de
> 1 a 71.

### Los nombres del rótulo no cruzan con los del resumen

| En el rótulo | En el resumen |
|---|---|
| `MULTI COLAGENO` | `MULTI COLAGENO PRV NICOLAS` · `MULTI COLAGENO.CM` |
| `TE CHINO` | `TE CHINO.CM` |

El nombre del rótulo es ambiguo entre dos productos reales. **Por eso la
homologación y el alistamiento salen del resumen**, que es la única sección con
SKU. El detalle del rótulo se guarda como texto, para saber qué iba en cada
guía cuando se represa.

---

---

## 6. Cómo leer y escribir el Excel de control

Archivo `CORTE B1 ACTUALIZADO.xlsx` · 12 hojas · 133 productos

### Estructura confirmada

```
hojas por transportadora   ENVIA · DERROCHA · INTER · JAM DRIVE · TCC
                           DOMINA · 99 MINUTOS · VELOCES · COORDINADORA
  Código | PRODUCTO | CORTE 1..6 | TOTAL | PRODUCTO REPRESADO | GUIAS REPRESADAS

hoja CORTE        Código | PRODUCTO | una columna por transportadora | TOTAL | TOTAL CORTE 1..5
hoja RESPRESADO   Código | PRODUCTO | dos columnas por transportadora: P y G
```

### Problemas que ya traía el archivo

| Problema | Detalle | Qué hace la herramienta |
|---|---|---|
| **Códigos de barras dañados** | 11 códigos quedaron en notación científica: `1,77086E+13` | Se reconstruye el número entero al importar |
| **Encabezados dispares** | DERROCHA dice `CoRTE 2`; VELOCES dice `Columna 4` | La exportación los genera uniformes |
| **Hojas de distinto tamaño** | DOMINA tiene 1.004 filas; las demás 134 | Todas salen con el mismo maestro |
| **Fórmulas que se rompen** | de ahí los `#REF!` | **Se exportan valores, nunca fórmulas** |

> Los nombres de hoja son abreviados (`INTER`, no `INTERRAPIDISIMO`). La tabla
> `transportadora` guarda el nombre de uso, el que escribe DROPI y los alias,
> así que agregar WILLOG u otra es insertar una fila, sin tocar código.

---

---

## 7. DROPI frente a las demás plataformas

La bodega no despacha solo por DROPI. Esta sección recoge **en qué se diferencia
DROPI de las otras**, porque la herramienta se construyó alrededor de su
manifiesto y ampliarla a las demás no es repetir el mismo código.

Todo lo que sigue está comprobado contra los archivos del equipo, no supuesto.

### Peso real de cada plataforma

Medido sobre los despachos de febrero a octubre de 2026:

| Plataforma | Unidades | Participación |
|---|---|---|
| **DROPI** | 327.052 | **89 %** |
| EFFI | 38.703 | 10,5 % |
| Mercado Libre | 2.588 | 0,7 % |
| MasterShop | 895 | 0,2 % |
| Vitalcom (directo) | 43 | — |
| Otras: HOKO, SEVENTY, DROPLATAM | 10 | — |

> Por eso la Fase 1 cubre DROPI: es nueve de cada diez unidades que salen.

### En qué se diferencian

| | **DROPI** | **EFFI** | **MasterShop** | **Mercado Libre** |
|---|---|---|---|---|
| Documento de origen | **PDF** «Relación de guías impresas» | Excel «Reporte de Guías de transporte» | Excel «Historial de pedidos» | Excel de ventas |
| Columnas del archivo | — (es PDF) | **90** | 30 | variable |
| Un archivo por | **corte y transportadora** | todas las transportadoras juntas | todos los pedidos | todas las ventas |
| Agrupación propia | **el corte lo pone la bodega** | trae «Relación de despacho» (número propio) | no agrupa | no agrupa |
| Detalle de producto por guía | **sí**, una página de rótulo por guía | «Contenido» en texto libre: `1 * COMBO ADVANCE.` | columnas `Producto` y `Cantidad` | no expone SKU |
| Resumen de productos del día | **sí**, bloque propio con SKU e ID | no | no | no |
| Identificador de la guía | `Guia` | `Guía transportadora` **más** un `ID guía` interno | `N° de Guía` | número de envío |
| Transportadora | campo propio, un valor | **mezclada con el servicio**: `COORDINADORA EFFI \| CON RECAUDO \| FLETE CRÉDITO` | campo propio | la define Mercado Libre |
| Estado de la guía | no viene en el manifiesto | **sí**: `ENTREGADA`, etc. | sí | sí |

### Las cuatro diferencias que cambian el diseño

**1. DROPI entrega PDF; las demás, Excel.**
El lector de DROPI resuelve un problema que las otras no tienen: extraer datos
de una tabla aplanada en un PDF de 238 páginas. Para EFFI, MasterShop y Mercado
Libre no hace falta nada de eso — se leen con `openpyxl` como el maestro de
productos.

**2. Solo DROPI trae resumen de productos con SKU.**
Es lo que permite armar el alistamiento y homologar contra el maestro interno.
EFFI entrega el contenido como texto libre (`1 * COMBO ADVANCE.`), que **no se
puede homologar sin intervención**: no hay SKU ni ID, solo una frase. MasterShop
sí trae `Producto` y `Cantidad` en columnas, así que es la más fácil de sumar
después de DROPI.

**3. El corte es un concepto de DROPI, no de las demás.**
En DROPI la bodega decide cuántos cortes hace al día y cada PDF es uno. EFFI
trae su propio número de «Relación de despacho», que **no es lo mismo**: lo
asigna la plataforma, no la bodega. MasterShop y Mercado Libre no agrupan nada:
son listas de pedidos.

> Al ampliar la herramienta habrá que decidir si la «Relación de despacho» de
> EFFI se trata como un corte o como un dato más de la guía. No son
> equivalentes y asumirlo mezclaría dos numeraciones distintas.

**4. En EFFI la transportadora viene mezclada con el servicio.**
El campo `Transportadora` trae `COORDINADORA EFFI | CON RECAUDO | FLETE CRÉDITO`
en una sola cadena. Hay que partirla para saber la transportadora, mientras que
en DROPI el valor viene limpio. La tabla `transportadora` ya tiene columna de
alias, que es donde debería resolverse.

### Lo que sí comparten

- Todas identifican la guía por un número que la transportadora reconoce, así
  que **el escaneo con pistola sirve igual** para las cuatro.
- Ninguna usa los códigos internos del maestro: todas traen su propia
  referencia, así que **la tabla de equivalencias hace falta para cada una**.
- Las cuatro informan ciudad de destino y valor de recaudo, con nombres de
  campo distintos.

### Vendela

**No hay ningún archivo de Vendela en el equipo**, ni aparece como plataforma en
los despachos de febrero a octubre de 2026. No se puede documentar su formato
sin ver un archivo suyo.

Para incorporarla hacen falta tres cosas: un export de ejemplo, saber si entrega
detalle de producto por guía, y si agrupa los despachos de alguna forma propia.

---

---

## 8. Los cinco procesos de la bodega

La bodega no tiene un solo flujo de salida. Tiene cinco, y cada uno llega por un
documento distinto, lo revisa un perfil distinto y exige una comprobación
distinta. Meterlos todos en el mismo formulario es lo que hoy obliga a llevarlo
en Excel aparte.

| # | Proceso | Perfil | Documento de entrada | Qué hay que comprobar |
|---|---|---|---|---|
| 1 | **Salidas de e-commerce** | Salidas e-commerce | Manifiesto por plataforma | Guías, productos y cantidades |
| 2 | **Mercado Libre** | Mercado Libre | Export propio de ML | Proceso aparte, no usa manifiesto de transportadora |
| 3 | **Muestras y mayoristas** | Muestras y mayoristas | Pedido o solicitud | Cantidades, productos **y que esté facturado** |
| 4 | **Devoluciones** | Devoluciones | Lo que llega físicamente | Productos y cantidades devueltas |
| 5 | **Garantías y costo cero** | Garantías | Autorización | Que haya motivo y responsable: sale sin precio |

### 1 · Salidas de e-commerce

Cuatro plataformas, cada una con sus transportadoras:

| Plataforma | Transportadoras | Manifiesto |
|---|---|---|
| **DROPI** | varias, una por corte | PDF «Relación de guías impresas» |
| **EFFI** | varias, mezcladas en un solo reporte | Excel «Reporte de Guías de transporte» |
| **MasterShop** | propia | Excel «Historial de pedidos» |
| **Vendela** | por confirmar | **sin ejemplo todavía** |

De cada plataforma se descarga el manifiesto con **guías, productos y
cantidades**, y de ahí sale el alistamiento. Es el único proceso donde el
documento ya trae todo lo necesario.

### 2 · Mercado Libre

No usa manifiesto de transportadora: Mercado Libre define el envío y entrega su
propio export de ventas. **El proceso es distinto y necesita su propia pantalla**,
no una variante de la de e-commerce.

### 3 · Muestras y mayoristas

Además de verificar cantidades y productos solicitados, este perfil tiene una
comprobación que ningún otro tiene: **validar que esté facturado**.

> Es el único proceso donde la bodega no despacha hasta que exista la factura.
> El modelo necesita, por tanto, un estado de facturación por salida, con quién
> lo validó y cuándo.

### 4 · Devoluciones

**Es el único movimiento de entrada, no de salida.** Lo que llega se verifica y
se deja registro de productos y cantidades devueltas.

> Al ir en sentido contrario, no encaja en la tabla de cortes ni en el
> alistamiento. Necesita su propio registro, aunque comparta el maestro de
> productos.

### 5 · Garantías y formatos sin costo

Productos que salen de la bodega **sin precio**, por dos motivos distintos:

- **Garantía** a un cliente
- **Contenido** para redes sociales

> Al no tener precio, no hay factura que los respalde, y son justamente los que
> se pierden del control. Cada salida necesita **motivo, destinatario y quién la
> autorizó**, o la bodega descuadra sin que nadie pueda explicar por qué.

---

---

## 9. Modelo de datos

SQLite en un archivo. Nombres en español para poder leer la base con cualquier
visor.

### Catálogos

**`usuario`** — usuario, nombre, `pin_hash`, rol, activo
**`transportadora`** — nombre, `nombre_dropi`, alias, activa, orden
**`producto`** — `codigo_interno`, nombre, `es_fisico`, activo
**`equivalencia_dropi`** — `sku_dropi`, `id_dropi`, `nombre_dropi`, `producto_id`

> **La clave es la pareja `(sku_dropi, id_dropi)`.** Un mismo SKU trae varios
> ID con nombres distintos; indexar por SKU solo perdería esa diferencia, y los
> SKU vacíos quedarían sin clave.

### Operación

| Tabla | Para qué |
|---|---|
| `corte` | fecha, transportadora, número, estado, datos de entrega |
| `archivo_pdf` | huella SHA-256 del PDF, para no cargarlo dos veces |
| `guia` | número, consecutivo, ciudad, recaudo, tipo, estado |
| `guia_producto` | el detalle del rótulo, crudo y traducido |
| `resumen_producto` | el bloque de productos del PDF, para validar |
| `alistamiento` | producto, cantidad, alistado, responsable |
| `escaneo` | todos los intentos, también los fallidos |
| `represado` | guía, motivo, responsable, corte de reasignación |
| `auditoria` | encadenada por huella |
| `parametro` | clave/valor |

### Tres reglas que atraviesan el modelo

**Nada se borra.** Los registros se anulan o se desactivan, con motivo y
responsable. Es la única forma de que la bitácora sirva para auditar.

**Cada cambio deja rastro.** El cambio y su registro en la bitácora se guardan
en la misma transacción: no puede existir uno sin el otro.

**La bitácora va encadenada.** Cada fila incluye la huella de la anterior. Si
alguien edita o borra una fila directamente en el archivo `.db`, la cadena se
rompe y el sistema señala exactamente dónde. *Probado: se alteró una fila a
mano y la detectó.*

---

---

## 10. Asignación y etapas del alistamiento

El alistamiento no es una lista suelta que alguien marca: es **trabajo
asignado**. Coordinación libera el despacho y reparte cada transportadora entre
una o varias personas, que revisan, embolsan y empacan.

```
COORDINACIÓN                    ALISTADORES                     DESPACHADOR
     │                               │                               │
 carga el PDF                        │                               │
 homologa lo nuevo                   │                               │
 asigna la transportadora ──────────▶│                               │
 a una o más personas                │                               │
                                1 revisar productos                  │
                                2 alistar en bolsas                  │
                                3 empacar                            │
                                     └──────────────────────────────▶│
                                                              verifica guías
                                                              cierra el corte
                                                              entrega al auxiliar
```

### Quién hace qué

| Rol | Puede |
|---|---|
| **Coordinación** | Cargar el PDF, homologar productos, **asignar transportadoras a personas**, reasignar, ver todo |
| **Alistador** | Ver **solo lo que le asignaron**, marcar avance de revisión, embolsado y empaque |
| **Despachador** | Escanear guías, cerrar el corte, registrar represados y la entrega a la transportadora |
| **Administrador** | Todo, más configuración y usuarios |
| **Consulta** | Solo ver y exportar |

> Un alistador no debe ver el tablero completo del día: solo sus asignaciones.
> Si ve todo, la pantalla de bodega se vuelve ilegible y se pierde el sentido de
> «esto es mío».

### Lo que esto agrega al modelo

**`asignacion`** — reparte el trabajo de un corte entre personas

| Campo | Para qué |
|---|---|
| id, corte_id | el corte que se reparte |
| usuario_id | la persona asignada |
| asignado_por, asignado_en | quién repartió y cuándo |
| estado | asignada · en proceso · terminada |
| terminada_en | cuándo dio por terminado su trabajo |

Varias filas por corte: **una transportadora puede ir a dos o más personas**.

**`alistamiento`** gana las etapas y el responsable de cada una:

| Campo nuevo | Para qué |
|---|---|
| revisado, revisado_por, revisado_en | el producto se verificó contra la lista |
| embolsado, embolsado_por, embolsado_en | cada unidad quedó en su bolsa |
| empacado, empacado_por, empacado_en | quedó listo para entregar |

> Se guarda **quién hizo cada etapa**, no solo que se hizo. Es lo que permite
> responder «quién alistó esto» cuando una guía sale mal, que es el problema que
> hoy no se puede resolver.

### Reglas de control

- **Quien carga el corte no se asigna a sí mismo el alistamiento**, salvo el
  Administrador. Separa quien decide de quien ejecuta.
- Una etapa no se puede marcar si la anterior no está hecha: no se empaca lo que
  no se embolsó.
- El corte no se puede cerrar con alistamiento sin terminar, salvo que el
  Despachador deje constancia del motivo.
- Marcar y desmarcar queda en la bitácora, con usuario y hora.

---

## 11. Permisos por acción

| Perfil | Alcance |
|---|---|
| Administrador | Acceso total y configuración |
| Solicitante | Crea y modifica borradores, registra seguimientos |
| Autorizador | Aprueba o rechaza |
| Tesorería | Registra y verifica abonos |
| Logística | Registra recepciones |
| Consulta | Solo visualiza y exporta |

Los permisos son **por acción, no por pantalla**: `corte.cargar`,
`alistamiento.marcar`, `escaneo.registrar`, `corte.cerrar`, `represado.crear`,
`maestros.editar`, `config`, `respaldo.restaurar`, `exportar`.

---

---

## 12. Flujo de pantallas

```
┌─ Ingreso (usuario + PIN) ─────────────────────────────┐
└───────────────────────┬────────────────────────────────┘
                        ▼
┌─ Tablero del día ──────────────────────────────────────┐
│  Guías y unidades por transportadora y corte           │
│  Avance de escaneo · Represados · Alertas              │
└───┬──────────────┬──────────────┬──────────────┬───────┘
    ▼              ▼              ▼              ▼
Cargar corte   Alistamiento   Escaneo       Consultas
    │              │              │              │
 1 Arrastrar   Lista por     Pistola USB   Buscar guía
 2 Validar     producto      Contador      Reportes
 3 Homologar   Marcar        Pendientes    Exportar Excel
 4 Nº de corte Imprimir           │
 5 Confirmar                      ▼
                            Cerrar corte
                            · Represados + motivo
                            · Auxiliar, placa, hora
```

### Cargar corte: dos tiempos, a propósito

`revisar_manifiesto()` **no escribe nada** y devuelve todo lo que está mal.
`guardar_corte()` escribe, y solo si ya no falta homologar ninguna equivalencia.
Así el usuario ve los problemas completos antes de que se guarde la primera
fila.

| Comprobación | Comportamiento |
|---|---|
| Guías vs. rótulos | aviso |
| Suma de productos vs. resumen | aviso |
| Guías repetidas en el PDF | aviso |
| **PDF ya cargado** (huella) | **bloquea** |
| **Productos sin homologar** | **bloquea** |
| Guía ya vista en otro corte | **aviso, no bloquea** — una represada reaparece legítimamente |

Si aparece un SKU sin equivalencia, se detiene y pide asociarlo. **Nada se
relaciona por parecido de nombre.** Lo que se resuelva queda guardado.

---

---

## 13. Plan por fases

Se construye por proceso, no por funcionalidad: la bodega empieza a usar cada
uno en cuanto está listo, en vez de esperar a que todo exista.

| Fase | Alcance | Estado |
|---|---|---|
| **1** | **Salidas e-commerce · DROPI** — carga, asignación, alistamiento, exportar Excel | núcleo listo, **falta la interfaz** |
| **2** | DROPI: escaneo de guías, cierre de corte y represados | pendiente |
| **3** | EFFI, MasterShop y Vendela sobre el mismo proceso | pendiente |
| **4** | Garantías y costo cero | pendiente |
| **5** | Devoluciones | pendiente |
| **6** | Muestras y mayoristas | pendiente |
| **7** | Mercado Libre | pendiente |

> El orden lo decide el volumen: DROPI es el 89 % de lo que sale de la bodega.

---

## 14. Decisiones ya tomadas

No están a discusión. Se listan con su motivo porque son las que suelen
deshacerse por desconocerlo.

**La equivalencia se indexa por la pareja SKU + ID, no por SKU.**
El mismo SKU llega con dos ID y dos nombres distintos. Indexar por SKU perdería
esa diferencia, y los SKU vacíos quedarían sin clave.

**Se guarda el dato crudo de la plataforma junto a la traducción.**
Permite corregir una equivalencia mal hecha sin volver a cargar los PDF.

**El número de guía no es único en la base, solo dentro del corte.**
Una guía represada reaparece legítimamente en un corte posterior. Forzar
unicidad global impediría reprogramarla.

**Nada se relaciona por parecido de nombre.**
Un producto sin equivalencia detiene la carga y pide intervención. Es más lento
el primer día y confiable después.

**Los registros no se borran: se anulan, con motivo y responsable.**
Es la única forma de que la bitácora sirva para auditar.

**La bitácora va encadenada por huella.**
Si alguien edita el archivo de base por fuera, la cadena se rompe y el sistema
señala dónde. Ya está implementado y probado.

**Se exportan valores, nunca fórmulas.**
Es la causa de los errores de referencia del archivo actual.

**Quien carga el corte no se lo asigna a sí mismo**, salvo el Administrador.
Separa a quien decide de quien ejecuta.

**En garantías, quien registra la salida no la autoriza.**
Es mercancía que sale sin precio: necesita un segundo par de ojos.

**En muestras y mayoristas, la factura se valida a mano con su número.**
No debe depender de que la facturación esté cargada en otro sistema al momento
de despachar.

---

## 15. Decisiones abiertas

**El código de barras de la pistola.** No se sabe si trae exactamente el número
de guía o lleva prefijos según la transportadora. La comparación debe quedar
preparada para normalizar, y se ajusta en la Fase 2 con la pistola en la mano.

**Vendela.** No existe ningún archivo suyo todavía. Para incorporarla hacen
falta un export de ejemplo, saber si entrega detalle de producto por guía, y si
agrupa los despachos de alguna forma propia.

**El cruce entre el corte de DROPI y la «Relación de despacho» de EFFI.** No son
equivalentes: una la define la bodega y la otra la plataforma. Hay que decidir
si se tratan como lo mismo o como datos distintos.

---

## 16. Criterios de aceptación

La Fase 1 se considera terminada cuando:

1. Se carga un PDF real y el sistema extrae las guías y productos correctos.
2. Las validaciones avisan de los descuadres **antes** de guardar nada.
3. Un PDF ya cargado se rechaza; una guía repetida en otro corte avisa pero no bloquea.
4. Un producto sin equivalencia detiene la carga y pide asociarlo.
5. Coordinación asigna el corte a dos personas y ambas lo ven.
6. Las tres etapas se marcan en orden y queda registrado quién hizo cada una.
7. El Excel exportado abre sin errores y **no contiene ni una fórmula**.
8. Toda acción quedó en la bitácora, y la cadena verifica íntegra.
9. La aplicación corre como `.exe` en un equipo sin Python instalado.
