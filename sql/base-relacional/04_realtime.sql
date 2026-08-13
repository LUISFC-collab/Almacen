-- =====================================================================
--  ALMACÉN MINERO · TIEMPO REAL Y SINCRONIZACIÓN
--
--  Lo que hace que el ingreso que usted registra en el almacén aparezca
--  en el celular de la Administradora de Obra sin que ella recargue nada.
--
--  Y lo que hace que funcione en mina sin señal: el celular guarda
--  local, y cuando vuelve la cobertura sube solo lo que cambió.
--
--  Ejecutar después de 03_seguridad_rls.sql
-- =====================================================================

-- =====================================================================
--  1. QUÉ SE TRANSMITE EN VIVO
--     No todo: la auditoría y el historial son miles de filas al día y
--     nadie los mira en el momento. Se consultan cuando hacen falta.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'materiales','herramientas','consolidado',
    'requerimientos','requerimiento_items',
    'despachos','despacho_lineas','recepciones','recepcion_lineas',
    'movimientos','prestamos','entregas','notificaciones'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table %I;', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Para que el evento de baja llegue con la fila completa y no solo con
-- el id: sin esto, el celular recibe "se borró algo" sin saber qué.
do $$
declare t text;
begin
  foreach t in array array[
    'materiales','herramientas','consolidado','requerimientos',
    'despachos','recepciones','prestamos','notificaciones'
  ] loop
    execute format('alter table %I replica identity full;', t);
  end loop;
end $$;

-- =====================================================================
--  2. TRAER SOLO LO QUE CAMBIÓ
--     El celular guarda la última versión que vio de cada tabla y pide
--     de ahí en adelante. Trae también las lápidas, que es como se
--     entera de las bajas ocurridas mientras estuvo sin señal.
-- =====================================================================

create or replace function cambios_desde(
  p_tabla   text,
  p_version bigint default 0,
  p_limite  int default 500
)
returns setof jsonb
language plpgsql
stable
security invoker            -- respeta las políticas del que pregunta
as $$
begin
  if p_tabla not in (
    'materiales','herramientas','consolidado','requerimientos','requerimiento_items',
    'despachos','despacho_lineas','recepciones','recepcion_lineas',
    'prestamos','entregas','notificaciones','personal','usuarios') then
    raise exception 'Tabla % no está habilitada para sincronizar.', p_tabla;
  end if;

  return query execute format(
    'select to_jsonb(t) from %I t
      where t.version > $1
      order by t.version asc
      limit $2', p_tabla)
  using p_version, p_limite;
end $$;

comment on function cambios_desde is
  'Sincronización incremental. Devuelve las filas con version mayor a la que el
   celular ya tiene, incluidas las que llevan lápida, para que borre las suyas.';

-- Marca de agua por dispositivo: hasta dónde llegó cada equipo.
create table if not exists sync_marcas (
  usuario_id   uuid not null references usuarios(id) on delete cascade,
  dispositivo  text not null,
  tabla        text not null,
  version      bigint not null default 0,
  ultima_vez   timestamptz not null default now(),
  primary key (usuario_id, dispositivo, tabla)
);

alter table sync_marcas enable row level security;
create policy marcas_propias on sync_marcas for all
  using (usuario_id = (select id from mi_usuario()))
  with check (usuario_id = (select id from mi_usuario()));

-- =====================================================================
--  3. SUBIR LO QUE SE HIZO SIN SEÑAL
--     El celular manda su cola en orden. Cada operación lleva una clave
--     de idempotencia: si la señal se corta justo después de subir, el
--     reintento no duplica el movimiento.
-- =====================================================================

create or replace function aplicar_pendiente(
  p_idempotencia text,
  p_tabla        text,
  p_operacion    text,
  p_carga        jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
  existente sync_pendientes%rowtype;
  resultado jsonb;
begin
  select * into existente from sync_pendientes where idempotencia = p_idempotencia;
  if found and existente.aplicado_en is not null then
    return jsonb_build_object('estado','ya_aplicado','id',existente.id);
  end if;

  insert into sync_pendientes (idempotencia, usuario_id, tabla, operacion, carga)
  values (p_idempotencia, (select id from mi_usuario()), p_tabla, p_operacion, p_carga)
  on conflict (idempotencia) do nothing;

  begin
    if p_operacion = 'update_add' then
      -- el caso importante: sumar stock, nunca escribirlo
      resultado := to_jsonb(update_add_stock(
        (p_carga->>'material_id')::uuid,
        (p_carga->>'delta')::numeric,
        (p_carga->>'tipo')::tipo_mov,
        p_carga->>'documento',
        p_carga->>'persona',
        p_carga->>'area',
        p_carga->>'obs',
        p_idempotencia));

    elsif p_operacion = 'tombstone' then
      execute format('update %I set eliminado_en = now(), version = version + 1 where id = $1',
                     p_tabla)
      using (p_carga->>'id')::uuid;
      resultado := jsonb_build_object('estado','enterrado');

    elsif p_operacion = 'insert' then
      execute format('insert into %I select * from jsonb_populate_record(null::%I, $1)',
                     p_tabla, p_tabla)
      using p_carga;
      resultado := jsonb_build_object('estado','insertado');

    else
      raise exception 'Operación % no reconocida.', p_operacion;
    end if;

    update sync_pendientes set aplicado_en = now(), error = null
     where idempotencia = p_idempotencia;
    return resultado;

  exception when others then
    update sync_pendientes set error = sqlerrm where idempotencia = p_idempotencia;
    raise;
  end;
end $$;

comment on function aplicar_pendiente is
  'Puerta de entrada de todo lo que se hizo sin señal. Si la operación falla —por
   ejemplo, el stock ya no alcanza porque otro entregó primero— el error queda
   guardado y el almacenero lo ve en su pantalla en vez de perderse.';

-- =====================================================================
--  4. CHOQUES
--     Dos personas editan la misma fila. Gana quien llegó primero y el
--     segundo recibe el error con la versión que ya existe, para que la
--     app le muestre las dos y elija.
-- =====================================================================

create or replace function guardar_con_version(
  p_tabla   text,
  p_id      uuid,
  p_version bigint,
  p_cambios jsonb
)
returns jsonb
language plpgsql
as $$
declare v_actual bigint; fila jsonb;
begin
  execute format('select version from %I where id = $1 for update', p_tabla)
    into v_actual using p_id;

  if v_actual is null then
    raise exception 'La fila % ya no existe en %.', p_id, p_tabla;
  end if;

  if v_actual <> p_version then
    execute format('select to_jsonb(t) from %I t where t.id = $1', p_tabla)
      into fila using p_id;
    raise exception 'CHOQUE: alguien lo cambió antes que usted. Versión suya %, actual %. %',
      p_version, v_actual, fila
      using errcode = '40001';
  end if;

  execute format(
    'update %I set (%s) = (select %s from jsonb_populate_record(null::%I, $1))
      where id = $2',
    p_tabla,
    (select string_agg(quote_ident(k), ',') from jsonb_object_keys(p_cambios) k),
    (select string_agg(quote_ident(k), ',') from jsonb_object_keys(p_cambios) k),
    p_tabla)
  using p_cambios, p_id;

  execute format('select to_jsonb(t) from %I t where t.id = $1', p_tabla)
    into fila using p_id;
  return fila;
end $$;

-- =====================================================================
--  5. TAREAS DE RELOJ  (pg_cron)
--     Lo que no depende de que alguien toque algo, sino de la hora.
-- =====================================================================

create extension if not exists pg_cron;

-- Herramientas vencidas: todos los días a las 7 de la mañana
select cron.schedule('avisos-prestamos', '0 12 * * *',
  $$ select avisar_prestamos_vencidos(); $$);

-- Guías que llevan más de siete días sin llegar
create or replace function avisar_guias_demoradas(p_dias int default 7)
returns int
language plpgsql
as $$
declare n int := 0; d record;
begin
  for d in
    select * from despachos
     where estado = 'en_camino'
       and fecha < now() - (p_dias || ' days')::interval
       and eliminado_en is null
  loop
    insert into notificaciones (titulo, cuerpo, roles, ref_tipo, ref_id, prioridad)
    values ('Guía sin llegar: ' || d.numero,
            'Despachada hace ' || extract(day from now() - d.fecha)::int ||
            ' días y el almacén todavía no la recibe.',
            array['almacenero','obra','compras','jefatura','admin']::rol_app[],
            'despacho', d.id, 'Alta');
    n := n + 1;
  end loop;
  return n;
end $$;

select cron.schedule('avisos-guias', '0 13 * * *',
  $$ select avisar_guias_demoradas(7); $$);

-- Limpieza de lápidas viejas. Se conservan 180 días: más que suficiente
-- para que cualquier celular se haya sincronizado al menos una vez.
create or replace function limpiar_lapidas(p_dias int default 180)
returns int
language plpgsql
as $$
declare n int := 0; t text; borradas int;
begin
  foreach t in array array[
    'materiales','herramientas','consolidado','requerimientos','requerimiento_items',
    'despachos','recepciones','prestamos','entregas','epp_entregas','notificaciones'
  ] loop
    execute format(
      'alter table %I disable trigger trg_lapida;
       delete from %I where eliminado_en < now() - ($1 || '' days'')::interval;
       alter table %I enable trigger trg_lapida;', t, t, t)
    using p_dias;
    get diagnostics borradas = row_count;
    n := n + borradas;
  end loop;
  return n;
end $$;

select cron.schedule('limpiar-lapidas', '0 8 1 * *',
  $$ select limpiar_lapidas(180); $$);

-- =====================================================================
--  6. VISTAS PARA LOS TABLEROS
--     Cálculos que si se hicieran en el celular tardarían y darían
--     números distintos según quién mire.
-- =====================================================================

create or replace view v_avance_obra as
select
  count(*) filter (where not adicional)                          as renglones_alcance,
  count(*) filter (where adicional)                              as renglones_adicionales,
  round(100.0 * sum(comprado)  filter (where not adicional) /
        nullif(sum(requerido)  filter (where not adicional), 0), 1) as pct_comprado,
  round(100.0 * sum(entregado) filter (where not adicional) /
        nullif(sum(requerido)  filter (where not adicional), 0), 1) as pct_entregado
from consolidado
where eliminado_en is null;

comment on view v_avance_obra is
  'El avance se calcula sobre el alcance original. Los adicionales se cuentan aparte
   para que un extra no haga parecer que la obra va más atrasada de lo que va.';

create or replace view v_pendiente_por_llegar as
select d.id, d.numero, d.fecha, d.transportista,
       extract(day from now() - d.fecha)::int as dias,
       count(dl.id)                            as lineas,
       sum(dl.cantidad - dl.recibido)          as faltante
from despachos d
join despacho_lineas dl on dl.despacho_id = d.id
where d.estado in ('en_camino','parcial') and d.eliminado_en is null
group by d.id
having sum(dl.cantidad - dl.recibido) > 0;

create or replace view v_reporte_diario as
select
  current_date                                                    as dia,
  (select count(*) from movimientos
    where tipo = 'ingreso' and fecha::date = current_date)         as ingresos,
  (select count(*) from movimientos
    where tipo = 'salida'  and fecha::date = current_date)         as salidas,
  (select count(*) from prestamos
    where salida::date = current_date)                             as prestamos,
  (select count(*) from prestamos
    where retorno::date = current_date)                            as devoluciones,
  (select count(*) from requerimientos
    where fecha::date = current_date)                              as pedidos,
  (select count(*) from requerimiento_items ri
     join requerimientos r on r.id = ri.requerimiento_id
    where r.fecha::date = current_date and ri.consolidado_id is null) as adicionales,
  (select count(*) from prestamos
    where retorno is null and devolucion_pactada < now())          as herramientas_vencidas,
  (select count(*) from materiales
    where minimo > 0 and stock < minimo and eliminado_en is null)  as bajo_minimo;
