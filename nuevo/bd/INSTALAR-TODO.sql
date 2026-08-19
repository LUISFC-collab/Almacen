-- =====================================================================
--  ALMACÉN CPQ · INSTALACIÓN COMPLETA EN UN SOLO PASO
--
--  Los cinco archivos del paquete, en el orden en que deben correr.
--  Se pega entero en:  Supabase → SQL Editor → New query → Run
--
--  Se puede volver a correr sin miedo: las tablas se crean con
--  "if not exists", las funciones con "create or replace" y los datos
--  con "on conflict do nothing". Nada de lo que ya existe se pisa.
--
--  IMPORTANTE — esto NO toca las tablas alm_*_create_110826 que usa
--  hoy la app en obra. Son tablas nuevas, al lado de las de siempre.
-- =====================================================================


-- =====================================================================
--  01_esquema.sql
-- =====================================================================
-- =====================================================================
--  ALMACÉN CPQ · COLUMBITO · ESQUEMA
--  Para la app de dos paneles (la simple, no la grande de 25 tablas)
--
--  PostgreSQL 15+ · probado sobre Supabase
--  Orden: 01_esquema → 02_triggers → 03_permisos_rls → 04_realtime → 05_datos
--
--  Once tablas, ni una más. Cada una lleva:
--     eliminado_en  → la lápida: nada se borra de verdad
--     version       → sube en cada cambio; sirve para traer solo lo nuevo
--     actualizado_en / actualizado_por
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";
create extension if not exists "pg_trgm";

-- unaccent() de fábrica no es inmutable y Postgres la exige así para
-- columnas generadas. Con esto «válvula» y «valvula» son el mismo material.
create or replace function sin_tildes(t text)
returns text language sql immutable parallel safe as
$$ select lower(public.unaccent('public.unaccent', coalesce(t,''))) $$;

do $$ begin
  create type puesto_app as enum
    ('almacenero','obra','jefatura','compras','supervisor','capataz','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_req as enum
    ('pendiente','en_logistica','aprobado','comprado','despachado','cerrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_mov as enum ('ingreso','salida','ajuste');
exception when duplicate_object then null; end $$;

-- =====================================================================
--  1. QUIÉN ENTRA
-- =====================================================================
create table if not exists usuarios (
  id              uuid primary key default gen_random_uuid(),
  fotocheck       text not null,
  nombre          text not null,
  celular         text,
  puesto          puesto_app not null,
  activo          boolean not null default true,
  auth_uid        uuid unique,               -- lo enlaza con el acceso de Supabase
  ultimo_acceso   timestamptz,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid,
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint usuarios_fotocheck_unico unique (fotocheck),
  constraint usuarios_fotocheck_ok check (fotocheck ~ '^[0-9]{3,}$')
);
comment on column usuarios.fotocheck is
  'El número del fotocheck es el usuario. El puesto queda amarrado a la cuenta:
   nadie elige con qué puesto entra.';
comment on table usuarios is
  'La contraseña NO va aquí. La maneja el servicio de autenticación, que guarda
   solo su huella. Guardarla en una columna sería regalarla ante cualquier fuga.';

create index if not exists ix_usuarios_vivos on usuarios (puesto) where eliminado_en is null;

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
  actualizado_por uuid references usuarios(id),
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
  actualizado_por uuid references usuarios(id),
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
  levantado_por    uuid references usuarios(id),
  area             text,
  frente           text,
  estado           estado_req not null default 'pendiente',
  registrado_en    timestamptz not null default now(),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid references usuarios(id),
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
  emitida_por     uuid references usuarios(id),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references usuarios(id),
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
  actualizado_por uuid references usuarios(id),
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
  entregado_por      uuid references usuarios(id),
  recibido_por       uuid references usuarios(id),
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
  usuario_id      uuid references usuarios(id),
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
  usuario_id    uuid references usuarios(id),
  tabla         text not null,
  operacion     text not null,          -- insert | update_add | tombstone
  carga         jsonb not null,
  creado_en     timestamptz not null default now(),
  aplicado_en   timestamptz,
  error         text
);


-- =====================================================================
--  02_triggers.sql
-- =====================================================================
-- =====================================================================
--  ALMACÉN CPQ · DISPARADORES Y VALIDACIÓN
--
--  Lo que no puede quedar en manos del celular vive aquí. Las validaciones
--  del navegador se saltan abriendo la consola, y dos celulares sin señal
--  no se ven entre sí. Esto corre en el servidor, dentro de la transacción.
--
--  Ejecutar después de 01_esquema.sql
-- =====================================================================

-- =====================================================================
--  1. SELLO DE CAMBIO  ·  actualizado_en + version
--     El celular pide después «dame lo que tenga version mayor a la que
--     ya vi» y se trae solo lo nuevo, no la tabla entera.
-- =====================================================================
create or replace function fn_sellar()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  new.version := coalesce(old.version, 0) + 1;
  if to_jsonb(new) ? 'actualizado_por' and auth.uid() is not null then
    new.actualizado_por := (select id from usuarios where auth_uid = auth.uid());
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['usuarios','consolidado','materiales','requerimientos',
    'requerimiento_items','guias','guia_lineas','herramientas','prestamos'] loop
    execute format('drop trigger if exists trg_sellar on %I;
      create trigger trg_sellar before update on %I
      for each row execute function fn_sellar();', t, t);
  end loop;
end $$;

-- =====================================================================
--  2. LÁPIDA  ·  tombstone
--     Un DELETE de verdad rompe la sincronización: el celular que estuvo
--     sin señal nunca se entera de la baja y en la próxima subida revive
--     la fila. Aquí el DELETE se intercepta y se convierte en marca.
-- =====================================================================
create or replace function fn_lapida()
returns trigger language plpgsql as $$
begin
  if old.eliminado_en is not null then return old; end if;
  execute format('update %I set eliminado_en = now(), version = version + 1,
                  actualizado_en = now() where id = $1', tg_table_name)
  using old.id;
  return null;      -- se cancela el borrado físico
end $$;

do $$ declare t text; begin
  foreach t in array array['usuarios','consolidado','materiales','requerimientos',
    'requerimiento_items','guias','guia_lineas','herramientas','prestamos'] loop
    execute format('drop trigger if exists trg_lapida on %I;
      create trigger trg_lapida before delete on %I
      for each row execute function fn_lapida();', t, t);
  end loop;
end $$;

comment on function fn_lapida is
  'Convierte cualquier DELETE en marca de eliminado. Para borrar de verdad —solo en
   mantenimiento— hay que desactivar el disparador a propósito.';

-- =====================================================================
--  3. SUMA ATÓMICA  ·  update_add
--     El corazón del asunto. El stock jamás se escribe con un número
--     calculado en el celular: se manda el cambio y la base suma.
--
--     Mal:  update materiales set stock = 64   ← si dos suben a la vez,
--                                                 uno pisa al otro
--     Bien: select update_add_stock(id, +40, ...)  ← los dos suman
-- =====================================================================
create or replace function update_add_stock(
  p_material_id  uuid,
  p_delta        numeric,
  p_tipo         tipo_mov,
  p_documento    text default null,
  p_persona      text default null,
  p_frente       text default null,
  p_guia_id      uuid default null,
  p_idempotencia text default null
) returns movimientos
language plpgsql security definer as $$
declare m materiales%rowtype; mov movimientos%rowtype; u usuarios%rowtype;
begin
  if p_delta = 0 then raise exception 'El movimiento no puede ser de cero.'; end if;

  -- si el celular reintenta tras cortarse la señal, se devuelve lo ya grabado
  if p_idempotencia is not null then
    select * into mov from movimientos where idempotencia = p_idempotencia;
    if found then return mov; end if;
  end if;

  select * into u from usuarios where auth_uid = auth.uid();

  -- el bloqueo de fila es lo que serializa a los dos almaceneros
  select * into m from materiales where id = p_material_id for update;
  if not found then raise exception 'El material % no existe.', p_material_id; end if;
  if m.eliminado_en is not null then raise exception 'El material % está de baja.', m.nombre; end if;

  if m.stock + p_delta < 0 then
    raise exception 'No alcanza el stock de %: hay % % y se piden %.',
      m.nombre, m.stock, m.unidad, abs(p_delta);
  end if;

  update materiales set stock = stock + p_delta, actualizado_en = now(), version = version + 1
   where id = p_material_id returning * into m;

  insert into movimientos (tipo, material_id, item, cantidad, unidad, saldo,
    persona, frente, documento, guia_id, idempotencia, usuario_id)
  values (p_tipo, m.id, m.nombre, abs(p_delta), m.unidad, m.stock,
    p_persona, p_frente, p_documento, p_guia_id, p_idempotencia, u.id)
  returning * into mov;

  -- el consolidado se mueve en el mismo acto: lo que entra suma a comprado,
  -- lo que sale suma a entregado
  if m.consolidado_id is not null then
    if p_tipo = 'ingreso' then
      update consolidado set comprado = least(requerido, comprado + abs(p_delta)),
             actualizado_en = now(), version = version + 1
       where id = m.consolidado_id;
    elsif p_tipo = 'salida' then
      update consolidado set entregado = least(comprado, entregado + abs(p_delta)),
             actualizado_en = now(), version = version + 1
       where id = m.consolidado_id;
    end if;
  end if;

  return mov;
end $$;

comment on function update_add_stock is
  'Única puerta para mover stock. Bloquea la fila, valida que no quede negativo, suma
   el cambio, escribe el movimiento con su saldo y actualiza el consolidado. Todo en
   una transacción.';

-- =====================================================================
--  4. CORRELATIVOS
--     El número lo da la base. Dos equipos sin señal generarían el mismo.
-- =====================================================================
create table if not exists correlativos (
  prefijo text primary key,
  valor   bigint not null default 0
);

create or replace function siguiente_correlativo(p text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into correlativos (prefijo, valor) values (p, 0) on conflict do nothing;
  update correlativos set valor = valor + 1 where prefijo = p returning valor into v;
  return v;
end $$;

create or replace function fn_codigo_req()
returns trigger language plpgsql as $$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := 'REQ-' || lpad(siguiente_correlativo('REQ')::text, 3, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_codigo_req on requerimientos;
create trigger trg_codigo_req before insert on requerimientos
for each row execute function fn_codigo_req();

create or replace function fn_correlativo_guia()
returns trigger language plpgsql as $$
begin
  if new.correlativo is null or new.correlativo = 0 then
    new.correlativo := siguiente_correlativo(new.serie);
  end if;
  return new;
end $$;

drop trigger if exists trg_correlativo_guia on guias;
create trigger trg_correlativo_guia before insert on guias
for each row execute function fn_correlativo_guia();

-- =====================================================================
--  5. LA ADMINISTRADORA DE OBRA, PRIMER FILTRO
--     Esconder el botón no es un permiso: la regla vive en la base.
-- =====================================================================
create or replace function fn_flujo_pedido()
returns trigger language plpgsql as $$
declare quien usuarios%rowtype;
begin
  if new.estado = old.estado then return new; end if;
  select * into quien from usuarios where auth_uid = auth.uid();

  if new.estado = 'en_logistica' and quien.puesto not in ('obra','admin') then
    raise exception 'Solo la Administradora de Obra pasa los pedidos a logística.';
  end if;
  if new.estado = 'aprobado' and quien.puesto not in ('jefatura','admin') then
    raise exception 'El visto bueno lo da el Jefe de Logística.';
  end if;
  if new.estado = 'aprobado' and old.estado <> 'en_logistica' then
    raise exception 'El pedido % todavía no pasó por la Administradora de Obra.', new.codigo;
  end if;
  return new;
end $$;

drop trigger if exists trg_flujo on requerimientos;
create trigger trg_flujo before update on requerimientos
for each row execute function fn_flujo_pedido();

-- =====================================================================
--  6. RECEPCIÓN  ·  entra lo contado, no lo declarado
-- =====================================================================
create or replace function fn_contar_guia()
returns trigger language plpgsql as $$
declare m materiales%rowtype; g guias%rowtype;
begin
  if new.contado is null or new.contado = old.contado then return new; end if;

  new.resultado := case
    when new.contado >= new.cantidad then 'conforme'
    when new.contado > 0 then 'incompleto'
    else 'no_llego' end;

  if new.contado > 0 then
    select * into g from guias where id = new.guia_id;
    select * into m from materiales where sin_tildes(nombre) = sin_tildes(new.descripcion);
    if not found then
      insert into materiales (nombre, unidad, consolidado_id)
      values (new.descripcion, new.unidad, new.consolidado_id) returning * into m;
    end if;
    perform update_add_stock(m.id, new.contado, 'ingreso', g.numero, null, null, g.id, null);
  end if;
  return new;
end $$;

drop trigger if exists trg_contar on guia_lineas;
create trigger trg_contar before update on guia_lineas
for each row execute function fn_contar_guia();

comment on function fn_contar_guia is
  'Si la guía dice 13 escobas y llegaron 12, entran 12. El faltante queda marcado como
   incompleto y sigue pendiente en el consolidado.';

-- La guía se cierra sola según lo que se contó
create or replace function fn_estado_guia()
returns trigger language plpgsql as $$
declare pend int;
begin
  select count(*) into pend from guia_lineas
   where guia_id = new.guia_id and eliminado_en is null
     and (contado is null or contado < cantidad);
  update guias set estado = case when pend = 0 then 'recibida' else 'parcial' end,
         version = version + 1
   where id = new.guia_id and estado in ('en_camino','parcial');
  return null;
end $$;

drop trigger if exists trg_estado_guia on guia_lineas;
create trigger trg_estado_guia after update of contado on guia_lineas
for each row execute function fn_estado_guia();

-- =====================================================================
--  7. HERRAMIENTAS  ·  se marcan solas
-- =====================================================================
create or replace function fn_prestamo()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from herramientas where id = new.herramienta_id and estado = 'prestada') then
      raise exception 'Esa herramienta ya está prestada y no ha vuelto.';
    end if;
    update herramientas set estado = 'prestada', version = version + 1
     where id = new.herramienta_id;
  elsif tg_op = 'UPDATE' and old.retorno is null and new.retorno is not null then
    new.dias_retraso := case when new.devolucion_pactada is null then 0
      else greatest(0, new.retorno::date - new.devolucion_pactada) end;
    update herramientas set estado = 'disponible', version = version + 1
     where id = new.herramienta_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_prestamo on prestamos;
create trigger trg_prestamo before insert or update on prestamos
for each row execute function fn_prestamo();

-- =====================================================================
--  8. UNIDADES  ·  se normalizan al escribir
-- =====================================================================
create or replace function fn_unidad()
returns trigger language plpgsql as $$
declare b text;
begin
  b := unidad_buena(new.unidad);
  if not exists (select 1 from unidades where codigo = b) then
    insert into unidades (codigo, nombre) values (b, b) on conflict do nothing;
    insert into unidad_alias (alias, codigo)
    values (regexp_replace(sin_tildes(new.unidad), '[^a-z0-9]', '', 'g'), b)
    on conflict do nothing;
  end if;
  new.unidad := b;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['consolidado','materiales','requerimiento_items','guia_lineas'] loop
    execute format('drop trigger if exists trg_unidad on %I;
      create trigger trg_unidad before insert or update of unidad on %I
      for each row execute function fn_unidad();', t, t);
  end loop;
end $$;

comment on function fn_unidad is
  'El Excel de la obra traía 37 formas de escribir 8 unidades. Cada forma rara se
   apunta una vez como alias y a partir de ahí se reconoce sola.';

-- =====================================================================
--  9. AVISOS QUE SALEN SOLOS
-- =====================================================================
create or replace function prestamos_vencidos()
returns table(herramienta text, responsable text, dias int)
language sql stable as $$
  select h.nombre, p.responsable, (current_date - p.devolucion_pactada)::int
    from prestamos p join herramientas h on h.id = p.herramienta_id
   where p.retorno is null and p.devolucion_pactada < current_date
     and p.eliminado_en is null
   order by 3 desc
$$;

create or replace function guias_demoradas(p_dias int default 7)
returns table(numero text, dias int, lineas bigint)
language sql stable as $$
  select g.numero, (current_date - g.fecha)::int, count(l.id)
    from guias g join guia_lineas l on l.guia_id = g.id
   where g.estado in ('en_camino','parcial') and g.eliminado_en is null
     and g.fecha < current_date - p_dias
   group by g.numero, g.fecha
$$;


-- =====================================================================
--  03_permisos_rls.sql
-- =====================================================================
-- =====================================================================
--  ALMACÉN CPQ · PERMISOS POR PUESTO  (Row Level Security)
--
--  Esconder un botón no es un permiso. Cualquiera con el enlace abre la
--  consola del navegador y llama a la API igual. Estas reglas corren en
--  el servidor: si un capataz pide los movimientos, Postgres le devuelve
--  cero filas, no importa qué app use.
--
--  Ejecutar después de 02_triggers.sql
-- =====================================================================

create or replace function mi_puesto()
returns puesto_app language sql stable security definer as
$$ select puesto from usuarios where auth_uid = auth.uid() and activo and eliminado_en is null $$;

create or replace function yo()
returns uuid language sql stable security definer as
$$ select id from usuarios where auth_uid = auth.uid() $$;

create or replace function soy(variadic p puesto_app[])
returns boolean language sql stable as $$ select mi_puesto() = any(p) $$;

do $$ declare t text; begin
  foreach t in array array['usuarios','unidades','unidad_alias','consolidado','materiales',
    'requerimientos','requerimiento_items','guias','guia_lineas','herramientas',
    'prestamos','movimientos','correlativos','sync_cola'] loop
    execute format('alter table %I enable row level security; alter table %I force row level security;', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  INVENTARIO Y CONSOLIDADO
--  Todos los ven —el capataz entra justamente a eso—, pero pocos los tocan.
-- ---------------------------------------------------------------------
create policy inv_ver on materiales for select using (eliminado_en is null or soy('admin'));
create policy inv_crear on materiales for insert
  with check (soy('almacenero','obra','supervisor','admin'));
create policy inv_editar on materiales for update using (soy('almacenero','obra','admin'));
comment on policy inv_crear on materiales is
  'El supervisor puede crear material al armar su pedido —lo que pide muchas veces no
   está en el catálogo— pero no puede tocar el stock de nada.';

create policy cons_ver on consolidado for select using (eliminado_en is null or soy('admin'));
create policy cons_crear on consolidado for insert with check (soy('obra','admin'));
create policy cons_editar on consolidado for update
  using (soy('almacenero','obra','jefatura','compras','admin'));
comment on policy cons_crear on consolidado is
  'Agregar un renglón al alcance es decisión de Obra. Si cualquiera pudiera, el
   porcentaje de avance dejaría de significar algo.';

create policy und_ver on unidades for select using (true);
create policy und_crear on unidades for insert with check (true);
create policy alias_ver on unidad_alias for select using (true);
create policy alias_crear on unidad_alias for insert with check (true);

-- ---------------------------------------------------------------------
--  MOVIMIENTOS  ·  el kardex
--  Solo se insertan por update_add_stock(). Nadie los edita ni los borra.
-- ---------------------------------------------------------------------
create policy mov_ver on movimientos for select
  using (soy('almacenero','obra','jefatura','compras','admin'));
create policy mov_nadie_edita on movimientos for update using (false);
create policy mov_nadie_borra on movimientos for delete using (false);
comment on policy mov_nadie_edita on movimientos is
  'El kardex es de solo lectura una vez escrito. Eso es lo que lo hace auditable: un
   error se corrige con otro movimiento que lo anula, no borrando el anterior.';

-- ---------------------------------------------------------------------
--  REQUERIMIENTOS
--  El supervisor ve los suyos. La cadena ve todos.
-- ---------------------------------------------------------------------
create policy req_ver on requerimientos for select
  using (soy('almacenero','obra','jefatura','compras','admin')
         or levantado_por = yo());
create policy req_crear on requerimientos for insert
  with check (soy('supervisor','almacenero','obra','admin'));
create policy req_editar on requerimientos for update
  using (soy('obra','jefatura','compras','admin')
         or (soy('almacenero','supervisor') and estado = 'pendiente'));
comment on policy req_editar on requerimientos is
  'Se puede corregir mientras Obra no lo haya tocado. Después ya no: si no, alguien
   podría cambiar cantidades después del visto bueno.';

create policy req_items_ver on requerimiento_items for select using (true);
create policy req_items_escribir on requerimiento_items for all
  using (soy('supervisor','almacenero','obra','admin'))
  with check (soy('supervisor','almacenero','obra','admin'));

-- ---------------------------------------------------------------------
--  GUÍAS
--  Las emite logística. El almacén solo cuenta lo que llegó.
-- ---------------------------------------------------------------------
create policy guia_ver on guias for select
  using (soy('almacenero','obra','jefatura','compras','admin'));
create policy guia_crear on guias for insert with check (soy('jefatura','compras','admin'));
create policy guia_editar on guias for update
  using (soy('jefatura','compras','admin')
         or (soy('almacenero') and estado in ('en_camino','parcial')));
comment on policy guia_editar on guias is
  'El almacenero solo puede cerrarla al recibirla. No puede cambiar lo que dice que trae.';

create policy gl_ver on guia_lineas for select using (true);
create policy gl_crear on guia_lineas for insert with check (soy('jefatura','compras','admin'));
create policy gl_contar on guia_lineas for update
  using (soy('almacenero','obra','admin') or soy('jefatura','compras'));

-- ---------------------------------------------------------------------
--  HERRAMIENTAS  ·  el almacén
-- ---------------------------------------------------------------------
create policy her_ver on herramientas for select using (true);
create policy her_escribir on herramientas for all
  using (soy('almacenero','obra','admin')) with check (soy('almacenero','obra','admin'));

create policy pre_ver on prestamos for select using (soy('almacenero','obra','jefatura','admin'));
create policy pre_escribir on prestamos for all
  using (soy('almacenero','obra','admin')) with check (soy('almacenero','obra','admin'));

-- ---------------------------------------------------------------------
--  USUARIOS
-- ---------------------------------------------------------------------
create policy usu_ver on usuarios for select
  using (soy('admin','obra','jefatura') or auth_uid = auth.uid());
create policy usu_alta on usuarios for insert with check (true);
create policy usu_editarme on usuarios for update
  using (auth_uid = auth.uid() or soy('admin'))
  with check (soy('admin') or (auth_uid = auth.uid()
              and puesto = (select puesto from usuarios where auth_uid = auth.uid())));
comment on policy usu_editarme on usuarios is
  'Cada uno corrige su nombre o su celular, pero no puede ascenderse solo: el puesto
   solo lo cambia el administrador.';

-- ---------------------------------------------------------------------
--  CORRELATIVOS Y COLA
-- ---------------------------------------------------------------------
create policy corr_ver on correlativos for select using (true);
create policy corr_nadie on correlativos for all using (false) with check (false);
comment on policy corr_nadie on correlativos is
  'Solo se tocan desde siguiente_correlativo(), que es security definer.';

create policy cola_propia on sync_cola for all
  using (usuario_id = yo() or soy('admin')) with check (usuario_id = yo());

-- ---------------------------------------------------------------------
--  CAPATAZ
--  Su único permiso es ver el material. Ya está cubierto por inv_ver y
--  cons_ver; no aparece en ninguna otra política, así que el resto de las
--  tablas le devuelven cero filas.
-- ---------------------------------------------------------------------


-- =====================================================================
--  04_realtime.sql
-- =====================================================================
-- =====================================================================
--  ALMACÉN CPQ · TIEMPO REAL Y SINCRONIZACIÓN
--
--  Lo que hace que el ingreso que usted registra en el almacén aparezca
--  en el celular de la Administradora de Obra sin que ella recargue nada.
--  Y lo que hace que siga funcionando cuando en la mina no hay señal.
--
--  Ejecutar después de 03_permisos_rls.sql
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. QUÉ SE TRANSMITE EN VIVO
--     No todo: la cola de sincronización son miles de filas y nadie las
--     mira en el momento.
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['consolidado','materiales','requerimientos','requerimiento_items',
    'guias','guia_lineas','movimientos','herramientas','prestamos'] loop
    begin execute format('alter publication supabase_realtime add table %I;', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- Para que el evento de baja llegue con la fila completa y no solo con el id:
-- sin esto el celular recibe «se borró algo» sin saber qué.
do $$ declare t text; begin
  foreach t in array array['consolidado','materiales','requerimientos','guias',
    'herramientas','prestamos'] loop
    execute format('alter table %I replica identity full;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  2. TRAER SOLO LO QUE CAMBIÓ
--     El celular guarda la última version que vio y pide de ahí en
--     adelante. Trae también las lápidas: así se entera de las bajas
--     ocurridas mientras estuvo sin señal.
-- ---------------------------------------------------------------------
create or replace function cambios_desde(p_tabla text, p_version bigint default 0,
                                         p_limite int default 500)
returns setof jsonb language plpgsql stable security invoker as $$
begin
  if p_tabla not in ('consolidado','materiales','requerimientos','requerimiento_items',
    'guias','guia_lineas','herramientas','prestamos','usuarios') then
    raise exception 'Tabla % no está habilitada para sincronizar.', p_tabla;
  end if;
  return query execute format(
    'select to_jsonb(t) from %I t where t.version > $1 order by t.version limit $2', p_tabla)
  using p_version, p_limite;
end $$;

comment on function cambios_desde is
  'Sincronización incremental: devuelve las filas con version mayor a la que el celular
   ya tiene, incluidas las que llevan lápida, para que borre las suyas.';

create table if not exists sync_marcas (
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  dispositivo text not null,
  tabla       text not null,
  version     bigint not null default 0,
  ultima_vez  timestamptz not null default now(),
  primary key (usuario_id, dispositivo, tabla)
);
alter table sync_marcas enable row level security;
create policy marcas_propias on sync_marcas for all
  using (usuario_id = yo()) with check (usuario_id = yo());

-- ---------------------------------------------------------------------
--  3. SUBIR LO QUE SE HIZO SIN SEÑAL
--     Cada operación lleva su clave de idempotencia: si la señal se corta
--     justo después de subir, el reintento no duplica el movimiento.
-- ---------------------------------------------------------------------
create or replace function aplicar_pendiente(p_idempotencia text, p_tabla text,
                                             p_operacion text, p_carga jsonb)
returns jsonb language plpgsql security definer as $$
declare ya sync_cola%rowtype; res jsonb;
begin
  select * into ya from sync_cola where idempotencia = p_idempotencia;
  if found and ya.aplicado_en is not null then
    return jsonb_build_object('estado','ya_aplicado');
  end if;

  insert into sync_cola (idempotencia, usuario_id, tabla, operacion, carga)
  values (p_idempotencia, yo(), p_tabla, p_operacion, p_carga)
  on conflict (idempotencia) do nothing;

  begin
    if p_operacion = 'update_add' then
      res := to_jsonb(update_add_stock(
        (p_carga->>'material_id')::uuid, (p_carga->>'delta')::numeric,
        (p_carga->>'tipo')::tipo_mov, p_carga->>'documento', p_carga->>'persona',
        p_carga->>'frente', (p_carga->>'guia_id')::uuid, p_idempotencia));
    elsif p_operacion = 'tombstone' then
      execute format('update %I set eliminado_en = now(), version = version + 1 where id = $1',
                     p_tabla) using (p_carga->>'id')::uuid;
      res := jsonb_build_object('estado','enterrado');
    elsif p_operacion = 'insert' then
      execute format('insert into %I select * from jsonb_populate_record(null::%I, $1)',
                     p_tabla, p_tabla) using p_carga;
      res := jsonb_build_object('estado','insertado');
    else
      raise exception 'Operación % no reconocida.', p_operacion;
    end if;
    update sync_cola set aplicado_en = now(), error = null where idempotencia = p_idempotencia;
    return res;
  exception when others then
    update sync_cola set error = sqlerrm where idempotencia = p_idempotencia;
    raise;
  end;
end $$;

comment on function aplicar_pendiente is
  'Puerta de entrada de todo lo que se hizo sin señal. Si la operación falla —por
   ejemplo, el stock ya no alcanza porque otro entregó primero— el error queda guardado
   y el almacenero lo ve en su pantalla en vez de perderse.';

-- ---------------------------------------------------------------------
--  4. CHOQUES
--     Dos personas editan la misma fila. Gana quien llegó primero; el
--     segundo recibe el error con la versión actual para que la app le
--     muestre las dos y elija.
-- ---------------------------------------------------------------------
create or replace function guardar_con_version(p_tabla text, p_id uuid,
                                               p_version bigint, p_cambios jsonb)
returns jsonb language plpgsql as $$
declare v bigint; fila jsonb;
begin
  execute format('select version from %I where id = $1 for update', p_tabla) into v using p_id;
  if v is null then raise exception 'La fila ya no existe en %.', p_tabla; end if;
  if v <> p_version then
    execute format('select to_jsonb(t) from %I t where t.id = $1', p_tabla) into fila using p_id;
    raise exception 'CHOQUE: alguien lo cambió antes. Su versión %, la actual %. %',
      p_version, v, fila using errcode = '40001';
  end if;
  execute format('update %I set (%s) = (select %s from jsonb_populate_record(null::%I,$1)) where id=$2',
    p_tabla,
    (select string_agg(quote_ident(k), ',') from jsonb_object_keys(p_cambios) k),
    (select string_agg(quote_ident(k), ',') from jsonb_object_keys(p_cambios) k),
    p_tabla) using p_cambios, p_id;
  execute format('select to_jsonb(t) from %I t where t.id = $1', p_tabla) into fila using p_id;
  return fila;
end $$;

-- ---------------------------------------------------------------------
--  5. VISTAS PARA LOS PANELES
--     Cálculos que en el celular tardarían y darían números distintos
--     según quién mire.
-- ---------------------------------------------------------------------
create or replace view v_avance as
select count(*) filter (where not adicional)                         as renglones,
       count(*) filter (where adicional)                             as adicionales,
       round(sum(requerido - comprado) filter (where not adicional), 2) as falta_comprar,
       round(100.0 * sum(comprado) filter (where not adicional) /
             nullif(sum(requerido) filter (where not adicional), 0), 1) as pct_comprado
from consolidado where eliminado_en is null;

comment on view v_avance is
  'El avance se calcula sobre el alcance original. Los adicionales se cuentan aparte
   para que un extra no haga parecer que la obra va más atrasada de lo que va.';

create or replace view v_panel_obra as
select (select count(*) from requerimientos where estado = 'pendiente'
          and eliminado_en is null)                                   as esperan_visto_bueno,
       (select count(*) from requerimientos where estado in ('en_logistica','aprobado')
          and eliminado_en is null)                                   as en_logistica,
       (select falta_comprar from v_avance)                           as falta_comprar,
       (select pct_comprado from v_avance)                            as pct_comprado;

create or replace view v_panel_almacen as
select (select count(*) from guias where estado in ('en_camino','parcial')
          and eliminado_en is null)                                   as guias_por_recibir,
       (select count(*) from prestamos where retorno is null
          and devolucion_pactada < current_date and eliminado_en is null) as herramientas_vencidas,
       (select count(*) from materiales where stock > 0 and eliminado_en is null) as con_stock,
       (select count(*) from materiales where stock = 0 and eliminado_en is null) as en_cero;


-- =====================================================================
--  05_datos.sql
-- =====================================================================
-- =====================================================================
--  ALMACÉN CPQ · DATOS INICIALES
--  Mina Columbito · exportado de la app el 15/08/2026
--
--  Ejecutar después de 04_realtime.sql
-- =====================================================================

begin;
set session_replication_role = replica;   -- los disparadores no corren al cargar


-- ---------- UNIDADES DE MEDIDA ----------

insert into unidades (codigo, nombre) values ('und', 'Unidad') on conflict do nothing;
insert into unidades (codigo, nombre) values ('par', 'Par') on conflict do nothing;
insert into unidades (codigo, nombre) values ('jgo', 'Juego') on conflict do nothing;
insert into unidades (codigo, nombre) values ('doc', 'Docena') on conflict do nothing;
insert into unidades (codigo, nombre) values ('mll', 'Millar') on conflict do nothing;
insert into unidades (codigo, nombre) values ('m', 'Metro') on conflict do nothing;
insert into unidades (codigo, nombre) values ('m2', 'Metro cuadrado') on conflict do nothing;
insert into unidades (codigo, nombre) values ('m3', 'Metro cúbico') on conflict do nothing;
insert into unidades (codigo, nombre) values ('rll', 'Rollo') on conflict do nothing;
insert into unidades (codigo, nombre) values ('var', 'Varilla') on conflict do nothing;
insert into unidades (codigo, nombre) values ('pln', 'Plancha') on conflict do nothing;
insert into unidades (codigo, nombre) values ('kg', 'Kilogramo') on conflict do nothing;
insert into unidades (codigo, nombre) values ('t', 'Tonelada') on conflict do nothing;
insert into unidades (codigo, nombre) values ('L', 'Litro') on conflict do nothing;
insert into unidades (codigo, nombre) values ('gal', 'Galón') on conflict do nothing;
insert into unidades (codigo, nombre) values ('cja', 'Caja') on conflict do nothing;
insert into unidades (codigo, nombre) values ('bls', 'Bolsa') on conflict do nothing;
insert into unidades (codigo, nombre) values ('paq', 'Paquete') on conflict do nothing;
insert into unidades (codigo, nombre) values ('bld', 'Balde') on conflict do nothing;
insert into unidades (codigo, nombre) values ('sac', 'Saco') on conflict do nothing;
insert into unidades (codigo, nombre) values ('tbo', 'Tubo') on conflict do nothing;

-- Las formas raras que trae el Excel de la obra. Cada una apunta a su
-- unidad buena, así «Mts», «MTS» y «mtr» dejan de ser tres unidades.
insert into unidad_alias (alias, codigo) values ('u', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('un', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('uni', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('unid', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('unidad', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('unidades', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('pza', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('pzas', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('pares', 'par') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('jgos', 'jgo') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('jgs', 'jgo') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('juego', 'jgo') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('juegos', 'jgo') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('docena', 'doc') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('docenas', 'doc') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('millar', 'mll') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('millares', 'mll') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('mt', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('mtr', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('mtrs', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('mts', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('metro', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('metros', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('ml', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('metrocuadrado', 'm2') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('metrocubico', 'm3') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('rollo', 'rll') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('rollos', 'rll') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('varilla', 'var') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('varillas', 'var') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('plancha', 'pln') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('planchas', 'pln') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('kilo', 'kg') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('kilos', 'kg') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('kilogramo', 'kg') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('kilogramos', 'kg') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('tn', 't') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('tonelada', 't') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('toneladas', 't') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('lt', 'L') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('lts', 'L') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('litro', 'L') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('litros', 'L') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('galon', 'gal') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('galones', 'gal') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('caja', 'cja') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('cajas', 'cja') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('bolsa', 'bls') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('bolsas', 'bls') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('paquete', 'paq') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('paquetes', 'paq') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('pack', 'paq') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('packs', 'paq') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('pq', 'paq') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('balde', 'bld') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('baldes', 'bld') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('saco', 'sac') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('sacos', 'sac') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('tubo', 'tbo') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('tubos', 'tbo') on conflict do nothing;

-- ---------- CONSOLIDADO · 12 renglones ----------

insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-001', 'Contenedores de 20 pies', 'und', 3) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-002', 'Radio de comunicación con señal interna de MY', 'und', 1) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-003', 'Escritorios', 'und', 5) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-004', 'Sillas para escritorios', 'und', 5) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-005', 'Martillo para demolición, marca HILTI', 'und', 1) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-006', 'Parihuela de madera', 'und', 4) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-007', 'Cilindro negro con tapa de geomembrana', 'und', 1) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-008', 'Separadores Artesco index', 'und', 7) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-009', 'Armella cerrada de 1/2', 'und', 20) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-010', 'Candado de 20 mm', 'und', 3) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-011', 'Escoba', 'und', 3) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-012', 'Recogedor', 'und', 3) on conflict (codigo) do nothing;

-- ---------- MATERIALES EN EL ALMACÉN · 3 ----------

insert into materiales (nombre, unidad, stock, consolidado_id) values ('Escoba', 'und', 2, (select id from consolidado where sin_tildes(descripcion) = sin_tildes('Escoba') limit 1));
insert into materiales (nombre, unidad, stock, consolidado_id) values ('Recogedor', 'und', 1, (select id from consolidado where sin_tildes(descripcion) = sin_tildes('Recogedor') limit 1));
insert into materiales (nombre, unidad, stock, consolidado_id) values ('Candado de 20 mm', 'und', 0, (select id from consolidado where sin_tildes(descripcion) = sin_tildes('Candado de 20 mm') limit 1));

-- ---------- HERRAMIENTAS · 3 ----------

insert into herramientas (nombre) values ('Amoladora 7"');
insert into herramientas (nombre) values ('Taladro percutor');
insert into herramientas (nombre) values ('Llave de torque 1/2"');

-- ---------- LA GUÍA EN CAMINO · EG07-282 ----------

insert into guias (serie, correlativo, fecha, punto_partida, punto_llegada, peso_bruto_kgm, estado) values ('EG07', 282, '2026-08-13', 'AV. 13 DE JULIO NRO. 322 - CAJAMARCA - CAJAMARCA - CAJAMARCA', 'SEDE PRODUCTIVA MINERA YANACOCHA - ENCAÑADA - CAJAMARCA - CAJAMARCA', 15, 'en_camino');
insert into guia_lineas (guia_id, orden, descripcion, unidad, cantidad, consolidado_id) values ((select id from guias where correlativo = 282), 1, 'Separadores Artesco index', 'und', 7, (select id from consolidado where codigo = 'R01-008'));
insert into guia_lineas (guia_id, orden, descripcion, unidad, cantidad, consolidado_id) values ((select id from guias where correlativo = 282), 2, 'Armella cerrada de 1/2', 'und', 20, (select id from consolidado where codigo = 'R01-009'));
insert into guia_lineas (guia_id, orden, descripcion, unidad, cantidad, consolidado_id) values ((select id from guias where correlativo = 282), 3, 'Candado de 20 mm', 'und', 3, (select id from consolidado where codigo = 'R01-010'));
insert into guia_lineas (guia_id, orden, descripcion, unidad, cantidad, consolidado_id) values ((select id from guias where correlativo = 282), 4, 'Escoba', 'und', 3, (select id from consolidado where codigo = 'R01-011'));
insert into guia_lineas (guia_id, orden, descripcion, unidad, cantidad, consolidado_id) values ((select id from guias where correlativo = 282), 5, 'Recogedor', 'und', 3, (select id from consolidado where codigo = 'R01-012'));

-- ---------- CORRELATIVOS ----------
insert into correlativos (prefijo, valor) values ('EG07', 282), ('REQ', 0)
on conflict (prefijo) do update set valor = greatest(correlativos.valor, excluded.valor);

set session_replication_role = default;
commit;

-- =====================================================================
--  Comprobación
-- =====================================================================
--  select 'unidades' t, count(*) from unidades
--  union all select 'alias', count(*) from unidad_alias
--  union all select 'consolidado', count(*) from consolidado
--  union all select 'materiales', count(*) from materiales
--  union all select 'herramientas', count(*) from herramientas
--  union all select 'guia_lineas', count(*) from guia_lineas;

