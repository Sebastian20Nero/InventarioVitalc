-- =============================================================================
-- VITALCOM GROUP COMMERCE SAS
-- Modelo entidad-relacion del Dashboard Comercial
-- Motor: PostgreSQL 14+
-- Fecha: 2026-09-18
--
-- Modulos:
--   core        maestros (empresas, productos, precios, costos, canales)
--   compras     laboratorios, plantas, ordenes de produccion, recepciones
--   inventario  bodegas, movimientos, stock, parametros de reposicion
--   ventas      clientes, facturacion, ordenes de plataforma
--   logistica   guias, transportadoras, auditoria de archivos
--   finanzas    wallets, retiros, conciliacion, comunidades
--   analitica   vistas de rotacion, cobertura y saldos
--
-- Decisiones clave:
--   1. proveedor != planta. Un proveedor puede tener varios laboratorios
--      (caso Natural Health / H&H). Las ordenes cuelgan de la PLANTA.
--   2. Una orden se identifica por numero + fecha_solicitud, no solo numero:
--      los consecutivos se reutilizan entre meses.
--   3. Cada linea de recepcion apunta a una linea de orden -> trazabilidad FIFO.
--   4. inventario.movimiento distingue venta de TRASLADO entre bodegas:
--      un traslado no es demanda y no debe inflar la rotacion.
--   5. compras.producto_planta guarda precio y minimo de fabricacion por
--      laboratorio: permite comparar cotizaciones del mismo producto.
--   6. Precios y costos son historicos (vigente_desde / vigente_hasta).
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS compras;
CREATE SCHEMA IF NOT EXISTS inventario;
CREATE SCHEMA IF NOT EXISTS ventas;
CREATE SCHEMA IF NOT EXISTS logistica;
CREATE SCHEMA IF NOT EXISTS finanzas;
CREATE SCHEMA IF NOT EXISTS analitica;

COMMENT ON SCHEMA core       IS 'Maestros compartidos por todos los modulos';
COMMENT ON SCHEMA compras    IS 'Abastecimiento: laboratorios, ordenes de produccion y recepciones';
COMMENT ON SCHEMA inventario IS 'Bodegas, movimientos de existencias y parametros de reposicion';
COMMENT ON SCHEMA ventas     IS 'Facturacion y ordenes originadas en las plataformas';
COMMENT ON SCHEMA logistica  IS 'Despachos, guias y transportadoras';
COMMENT ON SCHEMA finanzas   IS 'Billeteras de plataforma, retiros, conciliacion y comunidades';
COMMENT ON SCHEMA analitica  IS 'Vistas derivadas: rotacion, cobertura y saldos';


-- =============================================================================
-- TIPOS ENUMERADOS
-- =============================================================================

CREATE TYPE core.etapa_ciclo AS ENUM
    ('introduccion', 'crecimiento', 'madurez', 'declive', 'liquidacion');

CREATE TYPE core.tipo_precio AS ENUM
    ('publico', 'mayorista', 'dropi', 'comunidad', 'tienda_propia', 'meli', 'maquila');

CREATE TYPE core.tipo_costo AS ENUM
    ('produccion', 'maquila', 'importacion', 'empaque', 'flete_entrada');

CREATE TYPE compras.tipo_orden AS ENUM
    ('produccion', 'maquila');

CREATE TYPE compras.estado_orden AS ENUM
    ('borrador', 'enviada', 'confirmada', 'parcial', 'completa', 'anulada');

CREATE TYPE inventario.tipo_movimiento AS ENUM
    ('entrada_produccion', 'entrada_compra', 'salida_venta', 'salida_muestra',
     'traslado', 'ajuste', 'devolucion');

CREATE TYPE inventario.semaforo AS ENUM
    ('agotado', 'urgente', 'producir', 'mantener', 'vigilar', 'liquidar');

CREATE TYPE ventas.tipo_cliente AS ENUM
    ('mayorista', 'dropshipper', 'comunidad', 'tienda_propia', 'consumidor', 'maquila');

CREATE TYPE logistica.estado_guia AS ENUM
    ('generada', 'en_transito', 'entregada', 'devuelta', 'novedad', 'anulada');

CREATE TYPE finanzas.tipo_movimiento_wallet AS ENUM
    ('recaudo', 'flete', 'costo_producto', 'devolucion', 'retiro', 'comision', 'ajuste');


-- =============================================================================
-- MODULO core
-- =============================================================================

CREATE TABLE core.empresa (
    empresa_id   smallserial PRIMARY KEY,
    nombre       text NOT NULL UNIQUE,
    nit          text UNIQUE,
    activa       boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE core.empresa IS 'Unidades de negocio: Vitalcom, Biobell.';

CREATE TABLE core.categoria (
    categoria_id smallserial PRIMARY KEY,
    nombre       text NOT NULL UNIQUE
);

CREATE TABLE core.canal (
    canal_id        smallserial PRIMARY KEY,
    codigo          text NOT NULL UNIQUE,
    nombre          text NOT NULL,
    prefijo_factura text UNIQUE
);
COMMENT ON TABLE  core.canal IS 'Canal comercial. Se deduce del prefijo de la factura.';
COMMENT ON COLUMN core.canal.prefijo_factura IS 'FV ecommerce, FML Mercado Libre, FMQ maquila, FM mayorista, FT tiendas propias, FC comunidad.';

CREATE TABLE core.plataforma (
    plataforma_id smallserial PRIMARY KEY,
    nombre        text NOT NULL UNIQUE,
    activa        boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE core.plataforma IS 'Origen operativo del pedido: Dropi, EFFI Proveeduria, EFFI Tiendas Propias, MasterShop, Mercado Libre.';

CREATE TABLE core.producto (
    producto_id    serial PRIMARY KEY,
    empresa_id     smallint NOT NULL REFERENCES core.empresa(empresa_id),
    sku            text NOT NULL,
    codigo_dsnube  text,
    nombre         text NOT NULL,
    marca          text,
    categoria_id   smallint REFERENCES core.categoria(categoria_id),
    presentacion   text,
    contenido      numeric(10,2),
    unidad_medida  text,
    etapa_ciclo    core.etapa_ciclo NOT NULL DEFAULT 'introduccion',
    es_tendencia   boolean NOT NULL DEFAULT false,
    es_privado     boolean NOT NULL DEFAULT false,
    activo         boolean NOT NULL DEFAULT true,
    creado_en      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT producto_sku_empresa_uk UNIQUE (empresa_id, sku),
    CONSTRAINT producto_contenido_chk  CHECK (contenido IS NULL OR contenido > 0)
);
COMMENT ON COLUMN core.producto.codigo_dsnube IS 'Codigo del sistema de bodega (DSNube), usado para cruzar las entradas EA.';
COMMENT ON COLUMN core.producto.contenido    IS 'Cantidad de la presentacion: 454 (g), 300 (g), 1000 (ml), 120 (capsulas).';
COMMENT ON COLUMN core.producto.es_tendencia IS 'Producto tendencia: prohibido el quiebre de stock, asignacion autorizada por gerencia.';

CREATE INDEX producto_nombre_idx ON core.producto (lower(nombre));
CREATE INDEX producto_dsnube_idx ON core.producto (codigo_dsnube) WHERE codigo_dsnube IS NOT NULL;

CREATE TABLE core.producto_precio (
    precio_id      serial PRIMARY KEY,
    producto_id    integer NOT NULL REFERENCES core.producto(producto_id) ON DELETE CASCADE,
    tipo_precio    core.tipo_precio NOT NULL,
    valor          numeric(14,2) NOT NULL CHECK (valor >= 0),
    vigente_desde  date NOT NULL,
    vigente_hasta  date,
    CONSTRAINT precio_vigencia_chk CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
    CONSTRAINT precio_unico_uk     UNIQUE (producto_id, tipo_precio, vigente_desde)
);
COMMENT ON TABLE core.producto_precio IS 'Lista de precios historica. Reemplaza la matriz PRECIO VS COSTO.xlsx.';

CREATE TABLE core.producto_costo (
    costo_id       serial PRIMARY KEY,
    producto_id    integer NOT NULL REFERENCES core.producto(producto_id) ON DELETE CASCADE,
    tipo_costo     core.tipo_costo NOT NULL,
    valor          numeric(14,2) NOT NULL CHECK (valor >= 0),
    moneda         char(3) NOT NULL DEFAULT 'COP',
    vigente_desde  date NOT NULL,
    vigente_hasta  date,
    CONSTRAINT costo_vigencia_chk CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
    CONSTRAINT costo_unico_uk     UNIQUE (producto_id, tipo_costo, vigente_desde)
);


-- =============================================================================
-- MODULO compras
-- =============================================================================

CREATE TABLE compras.proveedor (
    proveedor_id       serial PRIMARY KEY,
    nombre             text NOT NULL UNIQUE,
    nit                text UNIQUE,
    contacto           text,
    telefono           text,
    dias_credito       smallint NOT NULL DEFAULT 0 CHECK (dias_credito >= 0),
    activo             boolean NOT NULL DEFAULT true,
    notas              text
);
COMMENT ON TABLE compras.proveedor IS 'Entidad comercial con la que se negocia y a la que se le paga.';

CREATE TABLE compras.planta (
    planta_id     serial PRIMARY KEY,
    proveedor_id  integer NOT NULL REFERENCES compras.proveedor(proveedor_id),
    nombre        text NOT NULL,
    alias         text,
    ciudad        text,
    activa        boolean NOT NULL DEFAULT true,
    CONSTRAINT planta_nombre_uk UNIQUE (proveedor_id, nombre)
);
COMMENT ON TABLE  compras.planta IS 'Laboratorio o sede de produccion. Un proveedor puede tener varias (Natural Health opera dos).';
COMMENT ON COLUMN compras.planta.alias IS 'Nombre corto con que el equipo se refiere a la planta, p. ej. H&H.';

CREATE TABLE compras.producto_planta (
    producto_planta_id serial PRIMARY KEY,
    producto_id        integer NOT NULL REFERENCES core.producto(producto_id),
    planta_id          integer NOT NULL REFERENCES compras.planta(planta_id),
    precio_unitario    numeric(14,2) NOT NULL CHECK (precio_unitario >= 0),
    cantidad_minima    integer NOT NULL DEFAULT 1 CHECK (cantidad_minima > 0),
    lead_time_dias     smallint CHECK (lead_time_dias IS NULL OR lead_time_dias >= 0),
    vigente_desde      date NOT NULL,
    vigente_hasta      date,
    notas              text,
    CONSTRAINT prod_planta_vigencia_chk CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
    CONSTRAINT prod_planta_uk UNIQUE (producto_id, planta_id, vigente_desde)
);
COMMENT ON TABLE compras.producto_planta IS 'Cotizacion vigente por laboratorio: precio, minimo de fabricacion y lead time. Permite comparar el mismo producto entre plantas.';

CREATE TABLE compras.orden (
    orden_id        serial PRIMARY KEY,
    numero          text NOT NULL,
    fecha_solicitud date NOT NULL,
    planta_id       integer NOT NULL REFERENCES compras.planta(planta_id),
    tipo            compras.tipo_orden NOT NULL DEFAULT 'produccion',
    estado          compras.estado_orden NOT NULL DEFAULT 'borrador',
    fecha_prometida date,
    archivo_pdf     text,
    notas           text,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    actualizado_en  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orden_numero_fecha_uk UNIQUE (numero, fecha_solicitud),
    CONSTRAINT orden_prometida_chk   CHECK (fecha_prometida IS NULL OR fecha_prometida >= fecha_solicitud)
);
COMMENT ON TABLE  compras.orden IS 'Orden de produccion o maquila enviada a un laboratorio.';
COMMENT ON CONSTRAINT orden_numero_fecha_uk ON compras.orden IS 'Los consecutivos se reutilizan entre meses: la identidad es numero + fecha de solicitud.';

CREATE INDEX orden_planta_fecha_idx ON compras.orden (planta_id, fecha_solicitud DESC);
CREATE INDEX orden_estado_idx       ON compras.orden (estado) WHERE estado NOT IN ('completa', 'anulada');

CREATE TABLE compras.orden_item (
    orden_item_id   serial PRIMARY KEY,
    orden_id        integer NOT NULL REFERENCES compras.orden(orden_id) ON DELETE CASCADE,
    linea           smallint NOT NULL,
    producto_id     integer NOT NULL REFERENCES core.producto(producto_id),
    cantidad        integer NOT NULL CHECK (cantidad > 0),
    precio_unitario numeric(14,2) CHECK (precio_unitario IS NULL OR precio_unitario >= 0),
    CONSTRAINT orden_item_linea_uk UNIQUE (orden_id, linea)
);

CREATE TABLE compras.recepcion (
    recepcion_id     serial PRIMARY KEY,
    documento        text NOT NULL,
    fecha_recepcion  date NOT NULL,
    proveedor_id     integer NOT NULL REFERENCES compras.proveedor(proveedor_id),
    bodega_id        integer NOT NULL,
    total_factura    numeric(16,2),
    iva              numeric(16,2),
    retefuente       numeric(16,2),
    reteica          numeric(16,2),
    fecha_vence_pago date,
    novedad          text,
    creado_en        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recepcion_documento_uk UNIQUE (proveedor_id, documento)
);
COMMENT ON TABLE  compras.recepcion IS 'Entrada fisica a bodega: documento EA de DSNube o factura del laboratorio.';
COMMENT ON COLUMN compras.recepcion.documento IS 'EA-1979, NAPL 10891, etc.';

CREATE TABLE compras.recepcion_linea (
    recepcion_linea_id serial PRIMARY KEY,
    recepcion_id       integer NOT NULL REFERENCES compras.recepcion(recepcion_id) ON DELETE CASCADE,
    orden_item_id      integer REFERENCES compras.orden_item(orden_item_id),
    producto_id        integer NOT NULL REFERENCES core.producto(producto_id),
    cantidad           integer NOT NULL CHECK (cantidad > 0),
    costo_unitario     numeric(14,2) CHECK (costo_unitario IS NULL OR costo_unitario >= 0),
    lote               text,
    fecha_vencimiento  date
);
COMMENT ON TABLE  compras.recepcion_linea IS 'Distribucion FIFO de una recepcion entre las ordenes abiertas del mismo producto y laboratorio.';
COMMENT ON COLUMN compras.recepcion_linea.orden_item_id IS 'NULL cuando la entrada aun no se pudo asignar a una orden registrada.';

CREATE INDEX recepcion_linea_orden_idx ON compras.recepcion_linea (orden_item_id);

CREATE TABLE compras.abono (
    abono_id     serial PRIMARY KEY,
    orden_id     integer REFERENCES compras.orden(orden_id) ON DELETE SET NULL,
    proveedor_id integer NOT NULL REFERENCES compras.proveedor(proveedor_id),
    fecha        date NOT NULL,
    valor        numeric(16,2) NOT NULL CHECK (valor > 0),
    medio        text,
    nota         text
);
COMMENT ON TABLE compras.abono IS 'Anticipos y pagos parciales al laboratorio.';

CREATE TABLE compras.saldo_laboratorio (
    saldo_id            serial PRIMARY KEY,
    orden_item_id       integer NOT NULL REFERENCES compras.orden_item(orden_item_id) ON DELETE CASCADE,
    fecha_corte         date NOT NULL,
    cantidad_pendiente  integer NOT NULL CHECK (cantidad_pendiente >= 0),
    fuente              text,
    CONSTRAINT saldo_lab_uk UNIQUE (orden_item_id, fecha_corte)
);
COMMENT ON TABLE compras.saldo_laboratorio IS 'Pendiente que REPORTA el laboratorio. Se compara contra el pendiente calculado para detectar diferencias.';

CREATE TABLE compras.alerta (
    alerta_id   serial PRIMARY KEY,
    orden_id    integer REFERENCES compras.orden(orden_id) ON DELETE CASCADE,
    producto_id integer REFERENCES core.producto(producto_id),
    severidad   smallint NOT NULL DEFAULT 2 CHECK (severidad BETWEEN 1 AND 3),
    texto       text NOT NULL,
    resuelta    boolean NOT NULL DEFAULT false,
    creado_en   timestamptz NOT NULL DEFAULT now(),
    resuelto_en timestamptz
);
COMMENT ON COLUMN compras.alerta.severidad IS '1 informativa, 2 revisar, 3 critica.';


-- =============================================================================
-- MODULO inventario
-- =============================================================================

CREATE TABLE inventario.bodega (
    bodega_id  serial PRIMARY KEY,
    codigo     text NOT NULL UNIQUE,
    nombre     text NOT NULL,
    empresa_id smallint NOT NULL REFERENCES core.empresa(empresa_id),
    ciudad     text,
    es_propia  boolean NOT NULL DEFAULT true,
    activa     boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE inventario.bodega IS 'Bodegas propias y de aliados. El codigo corresponde al de DSNube (1, 10, ...).';

ALTER TABLE compras.recepcion
    ADD CONSTRAINT recepcion_bodega_fk FOREIGN KEY (bodega_id) REFERENCES inventario.bodega(bodega_id);

CREATE TABLE inventario.movimiento (
    movimiento_id      bigserial PRIMARY KEY,
    fecha              date NOT NULL,
    producto_id        integer NOT NULL REFERENCES core.producto(producto_id),
    tipo               inventario.tipo_movimiento NOT NULL,
    bodega_origen_id   integer REFERENCES inventario.bodega(bodega_id),
    bodega_destino_id  integer REFERENCES inventario.bodega(bodega_id),
    cantidad           integer NOT NULL CHECK (cantidad > 0),
    costo_unitario     numeric(14,2),
    documento          text,
    recepcion_linea_id integer REFERENCES compras.recepcion_linea(recepcion_linea_id),
    factura_linea_id   bigint,
    guia_id            bigint,
    nota               text,
    creado_en          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT movimiento_bodegas_chk CHECK (
        (tipo = 'traslado'  AND bodega_origen_id IS NOT NULL AND bodega_destino_id IS NOT NULL
                            AND bodega_origen_id <> bodega_destino_id)
     OR (tipo IN ('entrada_produccion','entrada_compra','devolucion') AND bodega_destino_id IS NOT NULL)
     OR (tipo IN ('salida_venta','salida_muestra')                    AND bodega_origen_id  IS NOT NULL)
     OR (tipo = 'ajuste' AND (bodega_origen_id IS NOT NULL OR bodega_destino_id IS NOT NULL))
    )
);
COMMENT ON TABLE inventario.movimiento IS 'Libro unico de existencias. El tipo traslado separa el movimiento entre bodegas de la venta real: un traslado NO es demanda.';

CREATE INDEX movimiento_producto_fecha_idx ON inventario.movimiento (producto_id, fecha DESC);
CREATE INDEX movimiento_tipo_fecha_idx     ON inventario.movimiento (tipo, fecha DESC);

CREATE TABLE inventario.stock_snapshot (
    snapshot_id        bigserial PRIMARY KEY,
    fecha              date NOT NULL,
    producto_id        integer NOT NULL REFERENCES core.producto(producto_id),
    bodega_id          integer NOT NULL REFERENCES inventario.bodega(bodega_id),
    cantidad_disponible integer NOT NULL,
    cantidad_reservada  integer NOT NULL DEFAULT 0,
    costo_promedio      numeric(14,2),
    CONSTRAINT stock_snapshot_uk UNIQUE (fecha, producto_id, bodega_id)
);
COMMENT ON TABLE inventario.stock_snapshot IS 'Foto de existencias por dia. Permite auditar el calculado contra el fisico reportado por logistica.';

CREATE TABLE inventario.parametro_reposicion (
    parametro_id            serial PRIMARY KEY,
    producto_id             integer NOT NULL REFERENCES core.producto(producto_id),
    bodega_id               integer REFERENCES inventario.bodega(bodega_id),
    lead_time_dias          smallint NOT NULL DEFAULT 30 CHECK (lead_time_dias >= 0),
    stock_seguridad_semanas numeric(5,2) NOT NULL DEFAULT 2 CHECK (stock_seguridad_semanas >= 0),
    ventana_semanas         smallint NOT NULL DEFAULT 8 CHECK (ventana_semanas > 0),
    activo                  boolean NOT NULL DEFAULT true,
    CONSTRAINT parametro_uk UNIQUE (producto_id, bodega_id)
);
COMMENT ON TABLE  inventario.parametro_reposicion IS 'Parametros del semaforo de cobertura por producto.';
COMMENT ON COLUMN inventario.parametro_reposicion.ventana_semanas IS 'Semanas hacia atras usadas para promediar la venta semanal.';


-- =============================================================================
-- MODULO ventas
-- =============================================================================

CREATE TABLE ventas.cliente (
    cliente_id serial PRIMARY KEY,
    tipo       ventas.tipo_cliente NOT NULL,
    nombre     text NOT NULL,
    documento  text,
    ciudad     text,
    departamento text,
    activo     boolean NOT NULL DEFAULT true,
    CONSTRAINT cliente_documento_uk UNIQUE (documento)
);

CREATE TABLE ventas.factura (
    factura_id    bigserial PRIMARY KEY,
    empresa_id    smallint NOT NULL REFERENCES core.empresa(empresa_id),
    prefijo       text NOT NULL,
    numero        text NOT NULL,
    fecha         date NOT NULL,
    canal_id      smallint NOT NULL REFERENCES core.canal(canal_id),
    plataforma_id smallint REFERENCES core.plataforma(plataforma_id),
    cliente_id    integer REFERENCES ventas.cliente(cliente_id),
    subtotal      numeric(16,2) NOT NULL DEFAULT 0,
    descuento     numeric(16,2) NOT NULL DEFAULT 0,
    iva           numeric(16,2) NOT NULL DEFAULT 0,
    total         numeric(16,2) NOT NULL DEFAULT 0,
    anulada       boolean NOT NULL DEFAULT false,
    CONSTRAINT factura_uk UNIQUE (prefijo, numero)
);
COMMENT ON COLUMN ventas.factura.canal_id IS 'Derivado del prefijo: FV, FML, FMQ, FM, FT, FC.';

CREATE INDEX factura_fecha_idx ON ventas.factura (fecha DESC);
CREATE INDEX factura_canal_idx ON ventas.factura (canal_id, fecha DESC);

CREATE TABLE ventas.factura_linea (
    factura_linea_id bigserial PRIMARY KEY,
    factura_id       bigint NOT NULL REFERENCES ventas.factura(factura_id) ON DELETE CASCADE,
    linea            smallint NOT NULL,
    producto_id      integer NOT NULL REFERENCES core.producto(producto_id),
    cantidad         numeric(12,2) NOT NULL CHECK (cantidad <> 0),
    precio_unitario  numeric(14,2) NOT NULL,
    descuento        numeric(14,2) NOT NULL DEFAULT 0,
    costo_unitario   numeric(14,2),
    total            numeric(16,2) NOT NULL,
    CONSTRAINT factura_linea_uk UNIQUE (factura_id, linea)
);
COMMENT ON COLUMN ventas.factura_linea.costo_unitario IS 'Costo congelado al momento de facturar, para calcular margen sin depender del costo actual.';

CREATE INDEX factura_linea_producto_idx ON ventas.factura_linea (producto_id);

ALTER TABLE inventario.movimiento
    ADD CONSTRAINT movimiento_factura_linea_fk
    FOREIGN KEY (factura_linea_id) REFERENCES ventas.factura_linea(factura_linea_id);

CREATE TABLE ventas.orden_plataforma (
    orden_plataforma_id bigserial PRIMARY KEY,
    plataforma_id       smallint NOT NULL REFERENCES core.plataforma(plataforma_id),
    id_externo          text NOT NULL,
    fecha               timestamptz NOT NULL,
    cliente_id          integer REFERENCES ventas.cliente(cliente_id),
    cliente_nombre      text,
    ciudad              text,
    departamento        text,
    estado              text,
    valor_total         numeric(16,2),
    factura_id          bigint REFERENCES ventas.factura(factura_id),
    CONSTRAINT orden_plataforma_uk UNIQUE (plataforma_id, id_externo)
);
COMMENT ON TABLE  ventas.orden_plataforma IS 'Pedido tal como lo entrega la plataforma. Se concilia contra la factura.';
COMMENT ON COLUMN ventas.orden_plataforma.id_externo IS 'ID de la plataforma. Llave de deduplicacion al reprocesar exportes.';

CREATE TABLE ventas.orden_plataforma_item (
    item_id             bigserial PRIMARY KEY,
    orden_plataforma_id bigint NOT NULL REFERENCES ventas.orden_plataforma(orden_plataforma_id) ON DELETE CASCADE,
    producto_id         integer REFERENCES core.producto(producto_id),
    descripcion_origen  text,
    cantidad            numeric(12,2) NOT NULL,
    precio_unitario     numeric(14,2)
);
COMMENT ON COLUMN ventas.orden_plataforma_item.descripcion_origen IS 'Texto del producto tal como viene de la plataforma, antes de mapear al SKU.';


-- =============================================================================
-- MODULO logistica
-- =============================================================================

CREATE TABLE logistica.transportadora (
    transportadora_id smallserial PRIMARY KEY,
    nombre            text NOT NULL UNIQUE
);

CREATE TABLE logistica.guia (
    guia_id             bigserial PRIMARY KEY,
    numero_guia         text NOT NULL,
    transportadora_id   smallint NOT NULL REFERENCES logistica.transportadora(transportadora_id),
    plataforma_id       smallint REFERENCES core.plataforma(plataforma_id),
    empresa_id          smallint NOT NULL REFERENCES core.empresa(empresa_id),
    bodega_id           integer REFERENCES inventario.bodega(bodega_id),
    orden_plataforma_id bigint REFERENCES ventas.orden_plataforma(orden_plataforma_id),
    fecha_despacho      date NOT NULL,
    fecha_entrega       date,
    estado              logistica.estado_guia NOT NULL DEFAULT 'generada',
    ciudad_destino      text,
    departamento        text,
    flete               numeric(14,2),
    valor_recaudo       numeric(16,2),
    CONSTRAINT guia_uk UNIQUE (transportadora_id, numero_guia),
    CONSTRAINT guia_fechas_chk CHECK (fecha_entrega IS NULL OR fecha_entrega >= fecha_despacho)
);

CREATE INDEX guia_fecha_idx  ON logistica.guia (fecha_despacho DESC);
CREATE INDEX guia_estado_idx ON logistica.guia (estado, fecha_despacho DESC);

ALTER TABLE inventario.movimiento
    ADD CONSTRAINT movimiento_guia_fk FOREIGN KEY (guia_id) REFERENCES logistica.guia(guia_id);

CREATE TABLE logistica.guia_item (
    guia_item_id bigserial PRIMARY KEY,
    guia_id      bigint NOT NULL REFERENCES logistica.guia(guia_id) ON DELETE CASCADE,
    producto_id  integer REFERENCES core.producto(producto_id),
    cantidad     numeric(12,2) NOT NULL CHECK (cantidad > 0)
);

CREATE TABLE logistica.archivo_procesado (
    archivo_id    bigserial PRIMARY KEY,
    nombre        text NOT NULL,
    hash_sha256   char(64) NOT NULL UNIQUE,
    origen        text,
    fecha_proceso timestamptz NOT NULL DEFAULT now(),
    registros     integer,
    estado        text,
    observacion   text
);
COMMENT ON TABLE logistica.archivo_procesado IS 'Auditoria de ingesta. El hash evita reprocesar el mismo export dos veces.';


-- =============================================================================
-- MODULO finanzas
-- =============================================================================

CREATE TABLE finanzas.wallet_movimiento (
    wallet_movimiento_id bigserial PRIMARY KEY,
    plataforma_id        smallint NOT NULL REFERENCES core.plataforma(plataforma_id),
    id_externo           text NOT NULL,
    fecha                timestamptz NOT NULL,
    tipo                 finanzas.tipo_movimiento_wallet NOT NULL,
    valor                numeric(16,2) NOT NULL,
    saldo                numeric(16,2),
    guia_id              bigint REFERENCES logistica.guia(guia_id),
    descripcion          text,
    archivo_id           bigint REFERENCES logistica.archivo_procesado(archivo_id),
    CONSTRAINT wallet_mov_uk UNIQUE (plataforma_id, id_externo)
);
COMMENT ON TABLE  finanzas.wallet_movimiento IS 'Movimientos de billetera de Dropi y EFFI. Se deduplica por ID externo conservando el archivo mas reciente.';
COMMENT ON COLUMN finanzas.wallet_movimiento.valor IS 'Positivo entrada, negativo salida.';

CREATE INDEX wallet_mov_fecha_idx ON finanzas.wallet_movimiento (plataforma_id, fecha DESC);

CREATE TABLE finanzas.retiro (
    retiro_id     bigserial PRIMARY KEY,
    plataforma_id smallint NOT NULL REFERENCES core.plataforma(plataforma_id),
    fecha         date NOT NULL,
    valor         numeric(16,2) NOT NULL CHECK (valor > 0),
    banco         text,
    referencia    text,
    conciliado    boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE finanzas.retiro IS 'Transferencias de la billetera a las cuentas bancarias de la compania.';

CREATE TABLE finanzas.conciliacion (
    conciliacion_id      bigserial PRIMARY KEY,
    fecha                date NOT NULL,
    wallet_movimiento_id bigint REFERENCES finanzas.wallet_movimiento(wallet_movimiento_id),
    retiro_id            bigint REFERENCES finanzas.retiro(retiro_id),
    factura_id           bigint REFERENCES ventas.factura(factura_id),
    guia_id              bigint REFERENCES logistica.guia(guia_id),
    diferencia           numeric(16,2) NOT NULL DEFAULT 0,
    estado               text NOT NULL DEFAULT 'pendiente',
    observacion          text
);
COMMENT ON TABLE finanzas.conciliacion IS 'Cruce entre lo facturado, lo recaudado en billetera y lo transferido al banco.';

CREATE TABLE finanzas.comunidad (
    comunidad_id    serial PRIMARY KEY,
    nombre          text NOT NULL UNIQUE,
    responsable     text,
    costo_por_guia  numeric(14,2) NOT NULL DEFAULT 2000 CHECK (costo_por_guia >= 0),
    activa          boolean NOT NULL DEFAULT true
);
COMMENT ON COLUMN finanzas.comunidad.costo_por_guia IS 'Costo general 2000. Ivan Caicedo 1500. Master Escala se consolida en Ivan Caicedo.';

CREATE TABLE finanzas.liquidacion_comunidad (
    liquidacion_id  bigserial PRIMARY KEY,
    comunidad_id    integer NOT NULL REFERENCES finanzas.comunidad(comunidad_id),
    periodo_inicio  date NOT NULL,
    periodo_fin     date NOT NULL,
    guias_generadas integer NOT NULL CHECK (guias_generadas >= 0),
    costo_unitario  numeric(14,2) NOT NULL,
    total_liquidar  numeric(16,2) GENERATED ALWAYS AS (guias_generadas * costo_unitario) STORED,
    pagada          boolean NOT NULL DEFAULT false,
    fecha_pago      date,
    CONSTRAINT liquidacion_periodo_chk CHECK (periodo_fin >= periodo_inicio),
    CONSTRAINT liquidacion_uk UNIQUE (comunidad_id, periodo_inicio, periodo_fin)
);
COMMENT ON TABLE finanzas.liquidacion_comunidad IS 'GUIAS_GENERADAS x COSTO_UNITARIO = TOTAL_A_LIQUIDAR. Se cuentan todas las guias, sin filtrar por estado.';


-- =============================================================================
-- VISTAS ANALITICAS
-- =============================================================================

-- Existencias actuales por producto y bodega, construidas desde el libro de movimientos.
CREATE OR REPLACE VIEW analitica.v_stock_actual AS
WITH flujo AS (
    SELECT producto_id, bodega_destino_id AS bodega_id,  cantidad AS delta
      FROM inventario.movimiento
     WHERE bodega_destino_id IS NOT NULL
    UNION ALL
    SELECT producto_id, bodega_origen_id  AS bodega_id, -cantidad AS delta
      FROM inventario.movimiento
     WHERE bodega_origen_id IS NOT NULL
)
SELECT f.producto_id,
       f.bodega_id,
       p.sku,
       p.nombre,
       b.nombre AS bodega,
       SUM(f.delta)::integer AS existencias
  FROM flujo f
  JOIN core.producto        p ON p.producto_id = f.producto_id
  JOIN inventario.bodega    b ON b.bodega_id   = f.bodega_id
 GROUP BY f.producto_id, f.bodega_id, p.sku, p.nombre, b.nombre;

-- Demanda real por mes: solo salidas de venta. Excluye traslados entre bodegas.
CREATE OR REPLACE VIEW analitica.v_demanda_mensual AS
SELECT m.producto_id,
       p.sku,
       p.nombre,
       date_trunc('month', m.fecha)::date AS mes,
       SUM(m.cantidad)::integer           AS unidades_vendidas
  FROM inventario.movimiento m
  JOIN core.producto p ON p.producto_id = m.producto_id
 WHERE m.tipo = 'salida_venta'
 GROUP BY m.producto_id, p.sku, p.nombre, date_trunc('month', m.fecha);

COMMENT ON VIEW analitica.v_demanda_mensual IS 'Demanda real. Un traslado a otra bodega no aparece aqui: ese fue el error del pico de inositol en agosto 2026.';

-- Pendiente por linea de orden: lo calculado contra lo que reporta el laboratorio.
CREATE OR REPLACE VIEW analitica.v_saldo_orden AS
SELECT o.orden_id,
       o.numero,
       o.fecha_solicitud,
       pl.alias        AS laboratorio,
       pr.nombre       AS proveedor,
       oi.orden_item_id,
       p.sku,
       p.nombre        AS producto,
       oi.cantidad                                   AS pedido,
       COALESCE(SUM(rl.cantidad), 0)::integer        AS recibido,
       (oi.cantidad - COALESCE(SUM(rl.cantidad), 0))::integer AS pendiente_calculado,
       sl.cantidad_pendiente                         AS pendiente_laboratorio,
       (sl.cantidad_pendiente - (oi.cantidad - COALESCE(SUM(rl.cantidad), 0)))::integer AS diferencia
  FROM compras.orden o
  JOIN compras.planta      pl ON pl.planta_id    = o.planta_id
  JOIN compras.proveedor   pr ON pr.proveedor_id = pl.proveedor_id
  JOIN compras.orden_item  oi ON oi.orden_id     = o.orden_id
  JOIN core.producto        p ON p.producto_id   = oi.producto_id
  LEFT JOIN compras.recepcion_linea rl ON rl.orden_item_id = oi.orden_item_id
  LEFT JOIN LATERAL (
        SELECT s.cantidad_pendiente
          FROM compras.saldo_laboratorio s
         WHERE s.orden_item_id = oi.orden_item_id
         ORDER BY s.fecha_corte DESC
         LIMIT 1
  ) sl ON true
 WHERE o.estado <> 'anulada'
 GROUP BY o.orden_id, o.numero, o.fecha_solicitud, pl.alias, pr.nombre,
          oi.orden_item_id, p.sku, p.nombre, oi.cantidad, sl.cantidad_pendiente;

-- Cobertura y punto de reorden por producto.
CREATE OR REPLACE VIEW analitica.v_cobertura AS
WITH stock AS (
    SELECT producto_id, SUM(existencias)::integer AS stock_total
      FROM analitica.v_stock_actual
     GROUP BY producto_id
), venta AS (
    SELECT m.producto_id,
           SUM(m.cantidad)::numeric
             / NULLIF(GREATEST(par.ventana_semanas, 1), 0) AS venta_semanal
      FROM inventario.movimiento m
      JOIN inventario.parametro_reposicion par
        ON par.producto_id = m.producto_id AND par.bodega_id IS NULL
     WHERE m.tipo = 'salida_venta'
       AND m.fecha >= CURRENT_DATE - (par.ventana_semanas * 7)
     GROUP BY m.producto_id, par.ventana_semanas
)
SELECT p.producto_id,
       p.sku,
       p.nombre,
       COALESCE(s.stock_total, 0)      AS stock_total,
       ROUND(COALESCE(v.venta_semanal, 0), 2) AS venta_semanal_promedio,
       ROUND(COALESCE(s.stock_total, 0) / NULLIF(v.venta_semanal, 0), 1) AS cobertura_semanas,
       ROUND(((par.lead_time_dias / 7.0) + par.stock_seguridad_semanas) * COALESCE(v.venta_semanal, 0), 0) AS punto_reorden,
       CASE
           WHEN COALESCE(s.stock_total, 0) <= 0 THEN 'agotado'::inventario.semaforo
           WHEN v.venta_semanal IS NULL OR v.venta_semanal = 0 THEN 'liquidar'::inventario.semaforo
           WHEN s.stock_total / v.venta_semanal < par.stock_seguridad_semanas THEN 'urgente'::inventario.semaforo
           WHEN s.stock_total / v.venta_semanal < (par.lead_time_dias / 7.0) + par.stock_seguridad_semanas THEN 'producir'::inventario.semaforo
           WHEN s.stock_total / v.venta_semanal > 26 THEN 'vigilar'::inventario.semaforo
           ELSE 'mantener'::inventario.semaforo
       END AS semaforo
  FROM core.producto p
  JOIN inventario.parametro_reposicion par
    ON par.producto_id = p.producto_id AND par.bodega_id IS NULL
  LEFT JOIN stock s ON s.producto_id = p.producto_id
  LEFT JOIN venta v ON v.producto_id = p.producto_id
 WHERE p.activo;

COMMENT ON VIEW analitica.v_cobertura IS 'Cobertura = stock / venta semanal promedio. Punto de reorden = (lead time + stock de seguridad) x venta semanal promedio.';

-- Comparativo de cotizaciones del mismo producto entre laboratorios.
CREATE OR REPLACE VIEW analitica.v_comparativo_laboratorios AS
SELECT p.producto_id,
       p.sku,
       p.nombre       AS producto,
       pr.nombre      AS proveedor,
       COALESCE(pl.alias, pl.nombre) AS laboratorio,
       pp.precio_unitario,
       pp.cantidad_minima,
       pp.lead_time_dias,
       pp.precio_unitario - MIN(pp.precio_unitario) OVER (PARTITION BY p.producto_id) AS sobrecosto_unitario
  FROM compras.producto_planta pp
  JOIN core.producto      p  ON p.producto_id  = pp.producto_id
  JOIN compras.planta     pl ON pl.planta_id   = pp.planta_id
  JOIN compras.proveedor  pr ON pr.proveedor_id = pl.proveedor_id
 WHERE pp.vigente_hasta IS NULL OR pp.vigente_hasta >= CURRENT_DATE;

COMMENT ON VIEW analitica.v_comparativo_laboratorios IS 'Sobrecosto de cada laboratorio frente al mas economico para el mismo producto.';


-- =============================================================================
-- CATALOGOS INICIALES
-- =============================================================================

INSERT INTO core.empresa (nombre) VALUES ('Vitalcom'), ('Biobell');

INSERT INTO core.canal (codigo, nombre, prefijo_factura) VALUES
    ('ECOM',      'Ecommerce',       'FV'),
    ('MELI',      'Mercado Libre',   'FML'),
    ('MAQUILA',   'Maquila',         'FMQ'),
    ('MAYORISTA', 'Mayorista',       'FM'),
    ('TIENDAS',   'Tiendas Propias', 'FT'),
    ('COMUNIDAD', 'Comunidad',       'FC'),
    ('OTRO',      'Muestras y minorista', NULL);

INSERT INTO core.plataforma (nombre) VALUES
    ('Dropi'),
    ('EFFI Proveeduria'),
    ('EFFI Tiendas Propias'),
    ('MasterShop'),
    ('Mercado Libre');

COMMIT;
