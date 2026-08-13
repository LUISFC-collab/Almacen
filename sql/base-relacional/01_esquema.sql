-- =====================================================================
--  ALMACÉN MINERO · ESQUEMA DE BASE DE DATOS
--  Consorcio CPQ · Mina Columbito
--
--  PostgreSQL 15+ (probado sobre Supabase).
--  Orden de ejecución:
--     01_esquema.sql  →  02_triggers.sql  →  03_seguridad_rls.sql
--                     →  04_realtime.sql  →  05_datos_iniciales.sql
--
--  Tres decisiones que atraviesan todo el modelo:
--
--  1) LÁPIDA (tombstone). Nada se borra físicamente. Al eliminar se
--     marca `eliminado_en` y la fila se queda. Si se borrara de verdad,
--     el celular que estuvo sin señal nunca se enteraría de la baja y
--     el registro reviviría en la próxima sincronización.
--
--  2) VERSIÓN. Cada fila lleva un contador que sube en cada cambio.
--     Sirve para dos cosas: pedir "lo que cambió desde X" sin traerse
--     toda la tabla, y detectar que dos personas editaron lo mismo.
--
--  3) SUMA ATÓMICA (update_add). El stock nunca se escribe con un valor
--     calculado en el celular. Se manda el delta y la base hace
--     `stock = stock + delta` dentro de la transacción. Es la única
--     forma de que dos almaceneros registrando a la vez no se pisen.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------
--  unaccent() de fábrica no es inmutable, y Postgres exige inmutabilidad
--  para usarla en una columna generada. Esta envoltura lo resuelve.
--  Sirve para que «válvula» y «valvula» sean el mismo material.
-- ---------------------------------------------------------------------
create or replace function unaccent_inmutable(texto text)
returns text
language sql
immutable
parallel safe
as $$ select public.unaccent('public.unaccent', coalesce(texto, '')) $$;

-- ---------------------------------------------------------------------
--  Tipos
-- ---------------------------------------------------------------------
do $$ begin
  create type rol_app as enum
    ('admin','almacenero','obra','compras','jefatura','supervisor','capataz');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_req as enum
    ('pendiente','solicitado','revisado','en_preparacion','entrega_parcial',
     'sin_stock','enviado_logistica','consolidado','aprobado','compra_aprobada',
     'en_compra','compra_proceso','despachado','material_recibido','observado',
     'entregado','cerrado','rechazado','devuelto');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_mov as enum ('ingreso','salida','ajuste','devolucion','prestamo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type prioridad_req as enum ('Baja','Media','Alta','Urgente');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
--  Columnas comunes
--  Se repiten a mano en cada tabla en lugar de heredar, para que cada
--  una pueda indexarse y comentarse por separado.
-- ---------------------------------------------------------------------
--    id              uuid    clave primaria
--    creado_en       timestamptz
--    actualizado_en  timestamptz   ← lo pone el trigger, no el cliente
--    actualizado_por uuid          ← quién tocó la fila por última vez
--    eliminado_en    timestamptz   ← lápida; null = viva
--    version         bigint        ← sube en cada cambio

-- =====================================================================
--  1. PERSONAS
-- =====================================================================

create table if not exists usuarios (
  id              uuid primary key default gen_random_uuid(),
  usuario         text not null,
  nombre          text not null,
  fotocheck       text,
  cargo           text,
  area            text,
  rol             rol_app not null default 'supervisor',
  es_admin        boolean not null default false,
  activo          boolean not null default true,
  dni             text,
  celular         text,
  correo          text,
  foto_url        text,
  permisos_extra  text[] not null default '{}',
  ultimo_acceso   timestamptz,
  auth_uid        uuid unique,          -- enlaza con auth.users de Supabase
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid,
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint usuarios_usuario_unico unique (usuario),
  constraint usuarios_fotocheck_unico unique (fotocheck),
  constraint usuarios_dni_ok check (dni is null or dni ~ '^[0-9]{8}$'),
  constraint usuarios_correo_ok check (correo is null or correo ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$')
);
comment on column usuarios.fotocheck is
  'Número de fotocheck. Es el usuario con el que la gente entra en obra.';

create index if not exists ix_usuarios_vivos on usuarios (rol) where eliminado_en is null;
create index if not exists ix_usuarios_version on usuarios (version);

create table if not exists personal (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  dni             text,
  cargo           text,
  area            text,
  celular         text,
  foto_url        text,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references usuarios(id),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint personal_dni_ok check (dni is null or dni ~ '^[0-9]{8}$')
);
comment on table personal is
  'Trabajadores que reciben material o se llevan herramientas. No entran a la app.';

create index if not exists ix_personal_vivos on personal (nombre) where eliminado_en is null;

-- =====================================================================
--  2. CATÁLOGO
-- =====================================================================

create table if not exists materiales (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null,
  nombre          text not null,
  clave_busqueda  text generated always as
                    (lower(regexp_replace(unaccent_inmutable(nombre), '[^a-z0-9]+', ' ', 'g'))) stored,
  categoria       text,
  unidad          text not null default 'und',
  stock           numeric(14,3) not null default 0,
  minimo          numeric(14,3) not null default 0,
  obs             text,
  foto_url        text,
  alta_desde      text,                 -- 'requerimiento', 'recepcion', 'manual'
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references usuarios(id),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint materiales_codigo_unico unique (codigo),
  constraint materiales_stock_no_negativo check (stock >= 0),
  constraint materiales_minimo_no_negativo check (minimo >= 0)
);
comment on constraint materiales_stock_no_negativo on materiales is
  'El stock nunca puede quedar negativo. Si una salida lo dejaría bajo cero, la
   transacción entera se cae y el celular recibe el error. Es la red de seguridad
   cuando dos personas entregan el mismo material a la vez.';

create index if not exists ix_materiales_busqueda on materiales using gin (clave_busqueda gin_trgm_ops);
create index if not exists ix_materiales_bajos on materiales (codigo)
  where eliminado_en is null and stock < minimo;

create table if not exists herramientas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null,
  nombre          text not null,
  marca           text,
  modelo          text,
  serie           text,
  categoria       text,
  estado          text not null default 'disponible',   -- disponible | prestada | baja
  foto_url        text,
  obs             text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references usuarios(id),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint herramientas_codigo_unico unique (codigo),
  constraint herramientas_estado_ok check (estado in ('disponible','prestada','baja','mantenimiento'))
);

-- =====================================================================
--  3. CONSOLIDADO DE OBRA
--     Es el alcance aprobado. Todo lo que se pide fuera de él es un
--     adicional y se cuenta aparte, para que un extra no baje el avance.
-- =====================================================================

create table if not exists consolidado (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null,             -- R01-001
  descripcion     text not null,
  clave_busqueda  text generated always as
                    (lower(regexp_replace(unaccent_inmutable(descripcion), '[^a-z0-9]+', ' ', 'g'))) stored,
  unidad          text not null default 'und',
  requerido       numeric(14,3) not null default 0,
  comprado        numeric(14,3) not null default 0,
  entregado       numeric(14,3) not null default 0,
  n_requerimiento text,
  categoria       text,
  origen          text,
  adicional       boolean not null default false,
  material_id     uuid references materiales(id),
  archivo_origen  text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references usuarios(id),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint consolidado_codigo_unico unique (codigo),
  constraint consolidado_comprado_ok check (comprado >= 0),
  constraint consolidado_entregado_ok check (entregado >= 0),
  constraint consolidado_entregado_no_supera_comprado check (entregado <= comprado)
);
comment on constraint consolidado_entregado_no_supera_comprado on consolidado is
  'No se puede entregar al frente más de lo que se compró. Si el número no cuadra,
   es que alguien registró mal y hay que corregirlo antes de seguir.';

create index if not exists ix_consolidado_busqueda on consolidado using gin (clave_busqueda gin_trgm_ops);
create index if not exists ix_consolidado_pendiente on consolidado (codigo)
  where eliminado_en is null and comprado < requerido;

-- Nombres alternativos: «válvula check» que en realidad es «válvula mariposa».
create table if not exists consolidado_alias (
  id              uuid primary key default gen_random_uuid(),
  consolidado_id  uuid not null references consolidado(id) on delete cascade,
  alias           text not null,
  clave_alias     text generated always as
                    (lower(regexp_replace(unaccent_inmutable(alias), '[^a-z0-9]+', ' ', 'g'))) stored,
  confirmado_por  uuid references usuarios(id),
  creado_en       timestamptz not null default now(),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint alias_unico unique (consolidado_id, alias)
);
comment on table consolidado_alias is
  'Cada vez que alguien empareja a mano un nombre distinto, queda aquí. La próxima
   vez que logística escriba ese nombre, la app lo reconoce sola.';

-- =====================================================================
--  4. REQUERIMIENTOS
-- =====================================================================

create table if not exists requerimientos (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null,
  fecha              timestamptz not null default now(),
  solicitante_id     uuid references usuarios(id),
  solicitante_nombre text not null,
  solicitante_cargo  text,
  levantado_por      uuid references usuarios(id),
  area               text,
  obra               text,
  frente             text,
  prioridad          prioridad_req not null default 'Media',
  necesario_para     date,
  estado             estado_req not null default 'pendiente',
  obs                text,
  justificacion      text,
  enviado_logistica  timestamptz,
  enviado_por        uuid references usuarios(id),
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  actualizado_por    uuid references usuarios(id),
  eliminado_en       timestamptz,
  version            bigint not null default 1,

  constraint requerimientos_codigo_unico unique (codigo)
);
comment on column requerimientos.levantado_por is
  'Quién lo tecleó. Distinto del solicitante cuando el almacenero levanta el pedido
   que un supervisor le encargó de palabra.';

create index if not exists ix_req_abiertos on requerimientos (estado, fecha desc)
  where eliminado_en is null;
create index if not exists ix_req_solicitante on requerimientos (solicitante_id, fecha desc);

create table if not exists requerimiento_items (
  id                uuid primary key default gen_random_uuid(),
  requerimiento_id  uuid not null references requerimientos(id) on delete cascade,
  orden             int not null default 1,
  descripcion       text not null,
  unidad            text not null default 'und',
  cantidad          numeric(14,3) not null,
  material_id       uuid references materiales(id),
  consolidado_id    uuid references consolidado(id),
  frente            text,
  obs               text,
  es_nuevo          boolean not null default false,
  entregado         numeric(14,3) not null default 0,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  actualizado_por   uuid references usuarios(id),
  eliminado_en      timestamptz,
  version           bigint not null default 1,

  constraint req_items_cantidad_positiva check (cantidad > 0),
  constraint req_items_entregado_ok check (entregado >= 0 and entregado <= cantidad)
);
comment on column requerimiento_items.consolidado_id is
  'Null significa que el material no está en el alcance: es un adicional.';

create index if not exists ix_req_items_req on requerimiento_items (requerimiento_id);
create index if not exists ix_req_items_adicionales on requerimiento_items (requerimiento_id)
  where eliminado_en is null and consolidado_id is null;

create table if not exists requerimiento_historial (
  id                uuid primary key default gen_random_uuid(),
  requerimiento_id  uuid not null references requerimientos(id) on delete cascade,
  fecha             timestamptz not null default now(),
  estado            estado_req not null,
  nota              text,
  usuario_id        uuid references usuarios(id),
  usuario_nombre    text
);

-- =====================================================================
--  5. DESPACHOS Y GUÍAS
-- =====================================================================

create table if not exists despachos (
  id               uuid primary key default gen_random_uuid(),
  numero           text not null,          -- EG07 - 00000276
  serie            text not null default 'EG07',
  correlativo      bigint not null,
  fecha            timestamptz not null default now(),
  emision          timestamptz not null default now(),
  inicio_traslado  date not null default current_date,
  motivo           text not null default 'OTROS',
  punto_partida    text,
  punto_llegada    text,
  modalidad        text default 'Privado',
  transportista    text,
  peso_bruto_kgm   numeric(14,3) default 0,
  observaciones    text,
  numero_sunat     text,                   -- el oficial, cuando SUNAT lo devuelve
  estado           text not null default 'en_camino',
  enviado_por      uuid references usuarios(id),
  automatica       boolean not null default true,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid references usuarios(id),
  eliminado_en     timestamptz,
  version          bigint not null default 1,

  constraint despachos_numero_unico unique (numero),
  constraint despachos_serie_correlativo unique (serie, correlativo),
  constraint despachos_estado_ok check (estado in ('en_camino','recibido','anulado','parcial'))
);
comment on column despachos.numero_sunat is
  'La guía que genera la app NO es la electrónica de SUNAT. Aquí se anota el número
   oficial cuando SUNAT lo devuelve, para que queden las dos numeraciones juntas.';

create table if not exists despacho_lineas (
  id              uuid primary key default gen_random_uuid(),
  despacho_id     uuid not null references despachos(id) on delete cascade,
  orden           int not null default 1,
  descripcion     text not null,
  unidad          text not null default 'und',
  cantidad        numeric(14,3) not null,
  codigo          text,
  consolidado_id  uuid references consolidado(id),
  material_id     uuid references materiales(id),
  recibido        numeric(14,3) not null default 0,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint despacho_lineas_cantidad_positiva check (cantidad > 0),
  constraint despacho_lineas_recibido_ok check (recibido >= 0)
);

-- =====================================================================
--  6. RECEPCIONES
-- =====================================================================

create table if not exists recepciones (
  id              uuid primary key default gen_random_uuid(),
  despacho_id     uuid references despachos(id),
  fecha           timestamptz not null default now(),
  recibido_por    uuid references usuarios(id),
  sin_guia        boolean not null default false,
  guia_tardia     text,                  -- número que se vinculó después
  vinculada_en    timestamptz,
  vinculada_por   uuid references usuarios(id),
  conforme        boolean not null default false,
  foto_url        text,
  obs             text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references usuarios(id),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint recepciones_sin_guia_coherente
    check ((sin_guia and despacho_id is null) or (not sin_guia and despacho_id is not null))
);
comment on constraint recepciones_sin_guia_coherente on recepciones is
  'O viene con guía, o es sin guía. No las dos cosas: si no, al vincular el documento
   más tarde el stock entraría dos veces.';

create table if not exists recepcion_lineas (
  id              uuid primary key default gen_random_uuid(),
  recepcion_id    uuid not null references recepciones(id) on delete cascade,
  descripcion     text not null,
  unidad          text not null default 'und',
  declarado       numeric(14,3) default 0,
  contado         numeric(14,3) not null default 0,
  material_id     uuid references materiales(id),
  despacho_linea_id uuid references despacho_lineas(id),
  resultado       text,                  -- conforme | incompleto | no_llego | de_mas
  creado_en       timestamptz not null default now(),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint recepcion_lineas_contado_ok check (contado >= 0),
  constraint recepcion_lineas_resultado_ok
    check (resultado is null or resultado in ('conforme','incompleto','no_llego','de_mas'))
);

-- =====================================================================
--  7. MOVIMIENTOS · el kardex
--     Tabla de solo-inserción. Nunca se edita ni se borra un movimiento:
--     si hubo error se registra otro que lo corrige. Es lo que hace
--     auditable el almacén.
-- =====================================================================

create table if not exists movimientos (
  id              uuid primary key default gen_random_uuid(),
  fecha           timestamptz not null default now(),
  tipo            tipo_mov not null,
  material_id     uuid not null references materiales(id),
  item_nombre     text not null,
  cantidad        numeric(14,3) not null,
  unidad          text not null default 'und',
  saldo           numeric(14,3),          -- lo escribe el trigger, no el cliente
  persona         text,
  persona_id      uuid references personal(id),
  area            text,
  documento       text,
  requerimiento_id uuid references requerimientos(id),
  recepcion_id    uuid references recepciones(id),
  obs             text,
  foto1_url       text,
  foto2_url       text,
  firma_url       text,
  usuario_id      uuid references usuarios(id),
  usuario_nombre  text,
  anula_a         uuid references movimientos(id),
  creado_en       timestamptz not null default now(),
  version         bigint not null default 1,

  constraint movimientos_cantidad_positiva check (cantidad > 0)
);
comment on column movimientos.saldo is
  'Saldo del material después de este movimiento. Lo calcula el trigger dentro de la
   misma transacción; si lo mandara el celular, dos registros simultáneos guardarían
   saldos falsos.';
comment on column movimientos.anula_a is
  'Un movimiento no se borra: se anula con otro que apunta al original.';

create index if not exists ix_mov_material on movimientos (material_id, fecha desc);
create index if not exists ix_mov_fecha on movimientos (fecha desc);
create index if not exists ix_mov_documento on movimientos (documento);

-- =====================================================================
--  8. PRÉSTAMOS DE HERRAMIENTA
-- =====================================================================

create table if not exists prestamos (
  id                uuid primary key default gen_random_uuid(),
  herramienta_id    uuid not null references herramientas(id),
  personal_id       uuid references personal(id),
  responsable       text not null,
  dni               text,
  celular           text,
  area              text,
  salida            timestamptz not null default now(),
  devolucion_pactada timestamptz,
  retorno            timestamptz,
  dias_fuera        int,
  retraso_dias      int,
  estado_retorno    text,                -- Operativa | Con daños | No devuelta
  marca             text,
  modelo            text,
  serie             text,
  foto_salida_url   text,
  foto_retorno_url  text,
  sin_foto          boolean not null default false,
  obs               text,
  avisado_en        date,
  entregado_por     uuid references usuarios(id),
  recibido_por      uuid references usuarios(id),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  actualizado_por   uuid references usuarios(id),
  eliminado_en      timestamptz,
  version           bigint not null default 1,

  constraint prestamos_retorno_posterior check (retorno is null or retorno >= salida)
);

create index if not exists ix_prestamos_abiertos on prestamos (devolucion_pactada)
  where retorno is null and eliminado_en is null;

-- =====================================================================
--  9. ENTREGAS AL FRENTE  (vales)
-- =====================================================================

create table if not exists entregas (
  id               uuid primary key default gen_random_uuid(),
  fecha            timestamptz not null default now(),
  requerimiento_id uuid references requerimientos(id),
  recibe           text not null,
  personal_id      uuid references personal(id),
  area             text,
  frente           text,
  firma_url        text,
  foto_url         text,
  tipo             text,                 -- Entrega total | Entrega parcial
  entregado_por    uuid references usuarios(id),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  eliminado_en     timestamptz,
  version          bigint not null default 1
);

create table if not exists entrega_lineas (
  id            uuid primary key default gen_random_uuid(),
  entrega_id    uuid not null references entregas(id) on delete cascade,
  material_id   uuid not null references materiales(id),
  descripcion   text not null,
  unidad        text not null default 'und',
  cantidad      numeric(14,3) not null,
  movimiento_id uuid references movimientos(id),
  creado_en     timestamptz not null default now(),

  constraint entrega_lineas_cantidad_positiva check (cantidad > 0)
);

-- =====================================================================
-- 10. EPP
-- =====================================================================

create table if not exists epp_entregas (
  id             uuid primary key default gen_random_uuid(),
  fecha          timestamptz not null default now(),
  personal_id    uuid references personal(id),
  trabajador     text not null,
  dni            text,
  material_id    uuid references materiales(id),
  descripcion    text not null,
  cantidad       numeric(14,3) not null default 1,
  talla          text,
  motivo         text,                   -- primera entrega | reposición | desgaste
  firma_url      text,
  entregado_por  uuid references usuarios(id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en   timestamptz,
  version        bigint not null default 1
);

-- =====================================================================
-- 11. AVISOS, BITÁCORA Y AUDITORÍA
-- =====================================================================

create table if not exists notificaciones (
  id           uuid primary key default gen_random_uuid(),
  fecha        timestamptz not null default now(),
  titulo       text not null,
  cuerpo       text,
  roles        rol_app[] not null default '{}',
  usuarios     uuid[] not null default '{}',
  ref_tipo     text,
  ref_id       uuid,
  prioridad    prioridad_req default 'Media',
  emisor_id    uuid references usuarios(id),
  creado_en    timestamptz not null default now(),
  eliminado_en timestamptz,
  version      bigint not null default 1
);

create table if not exists notificaciones_leidas (
  notificacion_id uuid not null references notificaciones(id) on delete cascade,
  usuario_id      uuid not null references usuarios(id) on delete cascade,
  leida_en        timestamptz not null default now(),
  primary key (notificacion_id, usuario_id)
);

create table if not exists historial (
  id             uuid primary key default gen_random_uuid(),
  fecha          timestamptz not null default now(),
  modulo         text not null,
  accion         text not null,
  detalle        text,
  ref_id         uuid,
  usuario_id     uuid references usuarios(id),
  usuario_nombre text
);

create index if not exists ix_historial_fecha on historial (fecha desc);

-- La auditoría no lleva lápida ni versión: es un registro inmutable.
create table if not exists auditoria (
  id              uuid primary key default gen_random_uuid(),
  fecha           timestamptz not null default now(),
  usuario_id      uuid references usuarios(id),
  usuario_nombre  text,
  cargo           text,
  modulo          text not null,
  accion          text not null,
  tabla           text,
  fila_id         uuid,
  estado_anterior jsonb,
  estado_nuevo    jsonb,
  comentario      text,
  ip              inet,
  dispositivo     text
);

create index if not exists ix_auditoria_fila on auditoria (tabla, fila_id, fecha desc);

-- =====================================================================
-- 12. CORRELATIVOS Y CONFIGURACIÓN
--     Los números de MAT, HER, REQ y de guía se piden a la base, nunca
--     se calculan en el celular: dos equipos sin señal generarían el
--     mismo número.
-- =====================================================================

create table if not exists correlativos (
  prefijo    text primary key,          -- MAT | HER | REQ | EG07
  valor      bigint not null default 0,
  formato    text not null default '%s-%04s',
  actualizado_en timestamptz not null default now()
);

create table if not exists configuracion (
  clave      text primary key,
  valor      jsonb not null,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references usuarios(id)
);

-- =====================================================================
-- 13. COLA DE SINCRONIZACIÓN
--     Lo que el celular guardó sin señal y todavía no subió.
--     Se sube en orden y con clave de idempotencia, para que reintentar
--     no duplique.
-- =====================================================================

create table if not exists sync_pendientes (
  id             uuid primary key default gen_random_uuid(),
  idempotencia   text not null unique,
  usuario_id     uuid references usuarios(id),
  tabla          text not null,
  operacion      text not null,        -- insert | update_add | tombstone
  carga          jsonb not null,
  creado_en      timestamptz not null default now(),
  aplicado_en    timestamptz,
  error          text
);
comment on column sync_pendientes.idempotencia is
  'Lo genera el celular. Si la señal se corta justo después de subir, el reintento
   trae la misma clave y la base lo ignora en vez de duplicar el movimiento.';
