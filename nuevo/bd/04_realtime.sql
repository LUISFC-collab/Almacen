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
