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
