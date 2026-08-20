-- =====================================================================
--  ALMACÉN CPQ · COLUMBITO
--  PASO 2 · LAS TABLAS DEL ALMACÉN
--
--  Los perfiles y el acceso ya quedaron en 01_acceso.sql. Aquí van las
--  tablas del trabajo: consolidado, materiales, pedidos, guías,
--  herramientas y kardex.
--
--  Cada tabla lleva:
--     eliminado_en  → la lápida: nada se borra de verdad
--     version       → sube en cada cambio; sirve para traer solo lo nuevo
--     actualizado_en / actualizado_por
--
--  Ejecutar después de 01_acceso.sql
-- =====================================================================
do $$ begin
  create type estado_req as enum
    ('pendiente','en_logistica','aprobado','comprado','despachado','cerrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_mov as enum ('ingreso','salida','ajuste');
exception when duplicate_object then null; end $$;

-- =====================================================================
--  2. UNIDADES DE MEDIDA
--     El Excel de la obra traía 37 formas de escribir 8 unidades:
--     und, Und, UND, und., U... Esta tabla las unifica.
-- =====================================================================
create table if not exists unidades (
  codigo     text primary key,          -- und, m, mll, paq...
  nombre     text not null,             -- Unidad, Metro, Millar, Paquete
  creado_en  timestamptz not null default now()
);

create table if not exists unidad_alias (
  alias      text primary key,          -- ya normalizado: sin tildes, minúsculas
  codigo     text not null references unidades(codigo) on delete cascade
);
comment on table unidad_alias is
  'Cada forma rara que aparece en un Excel se apunta aquí una sola vez. La próxima
   carga la reconoce sola.';

create or replace function unidad_buena(t text)
returns text language plpgsql stable as $$
declare k text; r text;
begin
  k := regexp_replace(sin_tildes(coalesce(t,'')), '[^a-z0-9]', '', 'g');
  if k = '' then return 'und'; end if;
  select codigo into r from unidad_alias where alias = k;
  if r is not null then return r; end if;
  select codigo into r from unidades where lower(codigo) = k;
  return coalesce(r, t);
end $$;

-- =====================================================================
--  3. CONSOLIDADO  ·  el alcance de la obra
-- =====================================================================
create table if not exists consolidado (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null,              -- R01-001
  descripcion     text not null,
  busqueda        text generated always as
                    (regexp_replace(sin_tildes(descripcion), '[^a-z0-9]+', ' ', 'g')) stored,
  unidad          text not null default 'und' references unidades(codigo),
  requerido       numeric(14,3) not null default 0,
  comprado        numeric(14,3) not null default 0,
  entregado       numeric(14,3) not null default 0,
  adicional       boolean not null default false,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references perfiles(id),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint consolidado_codigo_unico unique (codigo),
  constraint consolidado_no_negativos check (requerido >= 0 and comprado >= 0 and entregado >= 0),
  constraint consolidado_entregado_le_comprado check (entregado <= comprado)
);
comment on column consolidado.adicional is
  'Lo que se pidió y no estaba en el alcance original. Se cuenta aparte para que un
   extra no baje el porcentaje de avance de la obra.';
comment on constraint consolidado_entregado_le_comprado on consolidado is
  'No se puede entregar al frente más de lo que se compró.';

create index if not exists ix_cons_busqueda on consolidado using gin (busqueda gin_trgm_ops);
create index if not exists ix_cons_falta on consolidado (codigo)
  where eliminado_en is null and comprado < requerido;

-- =====================================================================
--  4. MATERIALES  ·  lo que hay en el almacén
-- =====================================================================
create table if not exists materiales (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  busqueda        text generated always as
                    (regexp_replace(sin_tildes(nombre), '[^a-z0-9]+', ' ', 'g')) stored,
  unidad          text not null default 'und' references unidades(codigo),
  stock           numeric(14,3) not null default 0,
  consolidado_id  uuid references consolidado(id),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references perfiles(id),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint materiales_stock_no_negativo check (stock >= 0)
);
comment on constraint materiales_stock_no_negativo on materiales is
  'Red de seguridad: si una salida dejaría el stock bajo cero, la transacción entera
   se cae y el celular recibe el error. Pasa cuando dos personas entregan a la vez.';
comment on column materiales.consolidado_id is
  'El puente entre las dos vistas. Mismo material, mismo renglón del alcance: por eso
   40 comprados menos 28 entregados dan las 12 que hay en el almacén.';

create index if not exists ix_mat_busqueda on materiales using gin (busqueda gin_trgm_ops);

-- =====================================================================
--  5. REQUERIMIENTOS
-- =====================================================================
create table if not exists requerimientos (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null,
  fecha            date not null default current_date,
  solicitante      text not null,
  levantado_por    uuid references perfiles(id),
  area             text,
  frente           text,
  estado           estado_req not null default 'pendiente',
  registrado_en    timestamptz not null default now(),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid references perfiles(id),
  eliminado_en     timestamptz,
  version          bigint not null default 1,

  constraint req_codigo_unico unique (codigo),
  constraint req_fecha_no_futura check (fecha <= (registrado_en::date + 1))
);
comment on column requerimientos.solicitante is
  'Quién lo pidió. Distinto de levantado_por cuando el almacenero teclea el pedido
   que un supervisor le encargó de palabra.';
comment on constraint req_fecha_no_futura on requerimientos is
  'La fecha se puede mover hacia atrás —el supervisor lo pidió ayer en campo— pero
   nunca hacia adelante.';

create index if not exists ix_req_estado on requerimientos (estado, fecha desc)
  where eliminado_en is null;

create table if not exists requerimiento_items (
  id                uuid primary key default gen_random_uuid(),
  requerimiento_id  uuid not null references requerimientos(id) on delete cascade,
  orden             int not null default 1,
  descripcion       text not null,
  unidad            text not null default 'und' references unidades(codigo),
  cantidad          numeric(14,3) not null,
  frente            text,
  observaciones     text,
  consolidado_id    uuid references consolidado(id),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  eliminado_en      timestamptz,
  version           bigint not null default 1,

  constraint req_items_cantidad_positiva check (cantidad > 0)
);
comment on column requerimiento_items.consolidado_id is
  'Null significa que el material no está en el alcance: es un adicional.';

-- =====================================================================
--  6. GUÍAS DE REMISIÓN
-- =====================================================================
create table if not exists guias (
  id              uuid primary key default gen_random_uuid(),
  serie           text not null default 'EG07',
  correlativo     bigint not null,
  numero          text generated always as (serie || ' - ' || lpad(correlativo::text, 8, '0')) stored,
  fecha           date not null default current_date,
  transportista   text,
  peso_bruto_kgm  numeric(14,3) default 0,
  punto_partida   text,
  punto_llegada   text,
  motivo          text default 'OTROS',
  numero_sunat    text,
  estado          text not null default 'en_camino',
  emitida_por     uuid references perfiles(id),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references perfiles(id),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint guias_serie_correlativo unique (serie, correlativo),
  constraint guias_estado_ok check (estado in ('en_camino','parcial','recibida','anulada'))
);
comment on column guias.numero_sunat is
  'El documento que genera la app NO es la guía electrónica de la SUNAT, que solo se
   emite desde su sistema con firma digital. Aquí se anota el número oficial cuando
   SUNAT lo devuelve, y así quedan las dos numeraciones juntas.';

create table if not exists guia_lineas (
  id              uuid primary key default gen_random_uuid(),
  guia_id         uuid not null references guias(id) on delete cascade,
  orden           int not null default 1,
  descripcion     text not null,
  unidad          text not null default 'und' references unidades(codigo),
  cantidad        numeric(14,3) not null,
  consolidado_id  uuid references consolidado(id),
  contado         numeric(14,3),
  resultado       text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint guia_lineas_cantidad_positiva check (cantidad > 0),
  constraint guia_lineas_contado_ok check (contado is null or contado >= 0),
  constraint guia_lineas_resultado_ok
    check (resultado is null or resultado in ('conforme','incompleto','no_llego','de_mas'))
);
comment on column guia_lineas.contado is
  'Lo que el almacén contó de verdad. Null = todavía sin verificar, que no es lo
   mismo que cero: cero significa «lo busqué y no vino».';

-- =====================================================================
--  7. HERRAMIENTAS Y PRÉSTAMOS
-- =====================================================================
create table if not exists herramientas (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  marca           text,
  modelo          text,
  serie           text,
  estado          text not null default 'disponible',
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references perfiles(id),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint herramientas_estado_ok
    check (estado in ('disponible','prestada','mantenimiento','baja'))
);

create table if not exists prestamos (
  id                 uuid primary key default gen_random_uuid(),
  herramienta_id     uuid not null references herramientas(id),
  responsable        text not null,
  lote               uuid,                    -- une las que salieron juntas
  salida             timestamptz not null default now(),
  devolucion_pactada date,
  retorno            timestamptz,
  dias_retraso       int,
  entregado_por      uuid references perfiles(id),
  recibido_por       uuid references perfiles(id),
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  eliminado_en       timestamptz,
  version            bigint not null default 1,

  constraint prestamos_retorno_posterior check (retorno is null or retorno >= salida)
);
comment on column prestamos.lote is
  'Casi nadie se lleva una sola herramienta: el que viene por la amoladora se lleva
   también el disco y la llave. El lote las agrupa para devolverlas juntas.';

create index if not exists ix_prestamos_abiertos on prestamos (devolucion_pactada)
  where retorno is null and eliminado_en is null;

-- =====================================================================
--  8. MOVIMIENTOS  ·  el kardex
--     Solo se inserta. Nunca se edita ni se borra: un error se corrige
--     con otro movimiento que lo anula. Eso es lo que lo hace auditable.
-- =====================================================================
create table if not exists movimientos (
  id              uuid primary key default gen_random_uuid(),
  fecha           timestamptz not null default now(),
  tipo            tipo_mov not null,
  material_id     uuid not null references materiales(id),
  item            text not null,
  cantidad        numeric(14,3) not null,
  unidad          text not null default 'und' references unidades(codigo),
  saldo           numeric(14,3),
  persona         text,
  frente          text,
  documento       text,
  guia_id         uuid references guias(id),
  requerimiento_id uuid references requerimientos(id),
  observaciones   text,
  idempotencia    text unique,
  usuario_id      uuid references perfiles(id),
  anula_a         uuid references movimientos(id),
  creado_en       timestamptz not null default now(),

  constraint mov_cantidad_positiva check (cantidad > 0)
);
comment on column movimientos.saldo is
  'Saldo del material después de este movimiento. Lo calcula el disparador dentro de
   la misma transacción; si lo mandara el celular, dos registros a la vez guardarían
   saldos falsos.';
comment on column movimientos.idempotencia is
  'La genera el celular. Si la señal se corta justo después de subir, el reintento
   trae la misma clave y la base lo ignora en vez de duplicar el movimiento.';

create index if not exists ix_mov_material on movimientos (material_id, fecha desc);
create index if not exists ix_mov_fecha on movimientos (fecha desc);

-- =====================================================================
--  9. COLA DE LO QUE SE HIZO SIN SEÑAL
-- =====================================================================
create table if not exists sync_cola (
  id            uuid primary key default gen_random_uuid(),
  idempotencia  text not null unique,
  usuario_id    uuid references perfiles(id),
  tabla         text not null,
  operacion     text not null,          -- insert | update_add | tombstone
  carga         jsonb not null,
  creado_en     timestamptz not null default now(),
  aplicado_en   timestamptz,
  error         text
);
