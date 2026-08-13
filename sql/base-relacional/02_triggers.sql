-- =====================================================================
--  ALMACÉN MINERO · DISPARADORES Y VALIDACIÓN EN LA BASE
--
--  Todo lo que no puede quedar en manos del celular vive aquí. Las
--  validaciones del navegador se pueden saltar —basta abrir la consola—
--  y además dos celulares sin señal no se ven entre sí. Estas reglas
--  corren dentro de la transacción, en el servidor, siempre.
--
--  Ejecutar después de 01_esquema.sql
-- =====================================================================

-- =====================================================================
--  1. SELLO DE CAMBIO  ·  actualizado_en + version
--     Cada escritura sube el contador. El celular pide después
--     "dame todo lo que tenga version > la última que vi" y se trae
--     solo lo nuevo, en vez de la tabla entera.
-- =====================================================================

create or replace function fn_sellar_cambio()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  new.version := coalesce(old.version, 0) + 1;

  -- quién lo tocó, tomado de la sesión de Supabase
  if to_jsonb(new) ? 'actualizado_por' and auth.uid() is not null then
    new.actualizado_por := (select id from usuarios where auth_uid = auth.uid());
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'usuarios','personal','materiales','herramientas','consolidado','consolidado_alias',
    'requerimientos','requerimiento_items','despachos','despacho_lineas',
    'recepciones','recepcion_lineas','prestamos','entregas','epp_entregas',
    'notificaciones'
  ] loop
    execute format(
      'drop trigger if exists trg_sellar on %I;
       create trigger trg_sellar before update on %I
       for each row execute function fn_sellar_cambio();', t, t);
  end loop;
end $$;

-- =====================================================================
--  2. LÁPIDA  ·  tombstone
--     Un DELETE de verdad rompe la sincronización: el celular que estuvo
--     sin señal nunca se entera y en la próxima subida revive la fila.
--     Aquí el DELETE se intercepta y se convierte en marca.
-- =====================================================================

create or replace function fn_lapida()
returns trigger
language plpgsql
as $$
begin
  if old.eliminado_en is not null then
    return old;   -- ya estaba enterrada; no hacemos nada
  end if;

  execute format(
    'update %I set eliminado_en = now(), version = version + 1, actualizado_en = now()
     where id = $1', tg_table_name)
  using old.id;

  insert into auditoria (usuario_id, modulo, accion, tabla, fila_id, estado_anterior)
  values ((select id from usuarios where auth_uid = auth.uid()),
          tg_table_name, 'Baja lógica', tg_table_name, old.id, to_jsonb(old));

  return null;    -- se cancela el borrado físico
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'usuarios','personal','materiales','herramientas','consolidado',
    'requerimientos','requerimiento_items','despachos','recepciones',
    'prestamos','entregas','epp_entregas','notificaciones'
  ] loop
    execute format(
      'drop trigger if exists trg_lapida on %I;
       create trigger trg_lapida before delete on %I
       for each row execute function fn_lapida();', t, t);
  end loop;
end $$;

comment on function fn_lapida is
  'Convierte cualquier DELETE en una marca de eliminado. Para borrar de verdad
   —solo en mantenimiento— hay que desactivar el disparador a propósito.';

-- =====================================================================
--  3. SUMA ATÓMICA  ·  update_add
--     El corazón del asunto. El stock jamás se escribe con un número
--     calculado en el celular: se manda el delta y la base suma.
--
--     Mal:  UPDATE materiales SET stock = 64      ← si dos suben a la vez,
--                                                   uno pisa al otro
--     Bien: SELECT update_add_stock(id, +40, ...) ← los dos suman
-- =====================================================================

create or replace function update_add_stock(
  p_material_id  uuid,
  p_delta        numeric,
  p_tipo         tipo_mov,
  p_documento    text default null,
  p_persona      text default null,
  p_area         text default null,
  p_obs          text default null,
  p_idempotencia text default null
)
returns movimientos
language plpgsql
security definer
as $$
declare
  m materiales%rowtype;
  mov movimientos%rowtype;
  u usuarios%rowtype;
begin
  if p_delta = 0 then
    raise exception 'El movimiento no puede ser de cero.';
  end if;

  -- Idempotencia: si el celular reintenta tras cortarse la señal, se
  -- devuelve el movimiento ya grabado en vez de duplicarlo.
  if p_idempotencia is not null then
    select * into mov from movimientos where obs = p_idempotencia limit 1;
    if found then return mov; end if;
  end if;

  select * into u from usuarios where auth_uid = auth.uid();

  -- El bloqueo de fila es lo que serializa a los dos almaceneros.
  select * into m from materiales where id = p_material_id for update;
  if not found then
    raise exception 'El material % no existe.', p_material_id;
  end if;
  if m.eliminado_en is not null then
    raise exception 'El material % está dado de baja.', m.nombre;
  end if;

  if m.stock + p_delta < 0 then
    raise exception 'No alcanza el stock de %: hay % % y se piden %.',
      m.nombre, m.stock, m.unidad, abs(p_delta);
  end if;

  update materiales
     set stock = stock + p_delta,
         actualizado_en = now(),
         version = version + 1
   where id = p_material_id
  returning * into m;

  insert into movimientos (
    tipo, material_id, item_nombre, cantidad, unidad, saldo,
    persona, area, documento, obs, usuario_id, usuario_nombre)
  values (
    p_tipo, m.id, m.nombre, abs(p_delta), m.unidad, m.stock,
    p_persona, p_area, p_documento, coalesce(p_idempotencia, p_obs), u.id, u.nombre)
  returning * into mov;

  return mov;
end $$;

comment on function update_add_stock is
  'Única puerta para mover stock. Bloquea la fila, valida que no quede negativo,
   suma el delta y deja el movimiento con su saldo, todo en una transacción.';

-- El mismo patrón para el consolidado: comprado y entregado se suman,
-- nunca se reemplazan, y no pueden pasarse de lo requerido.
create or replace function update_add_consolidado(
  p_consolidado_id uuid,
  p_campo          text,          -- 'comprado' | 'entregado'
  p_delta          numeric
)
returns consolidado
language plpgsql
as $$
declare c consolidado%rowtype;
begin
  if p_campo not in ('comprado','entregado') then
    raise exception 'Campo % no permitido. Solo comprado o entregado.', p_campo;
  end if;

  select * into c from consolidado where id = p_consolidado_id for update;
  if not found then
    raise exception 'El renglón % no está en el consolidado.', p_consolidado_id;
  end if;

  execute format(
    'update consolidado
        set %I = least(requerido, greatest(0, %I + $1)),
            actualizado_en = now(), version = version + 1
      where id = $2 returning *', p_campo, p_campo)
  into c using p_delta, p_consolidado_id;

  -- lo entregado no puede superar a lo comprado
  if c.entregado > c.comprado then
    update consolidado set comprado = entregado where id = c.id returning * into c;
  end if;

  return c;
end $$;

-- =====================================================================
--  4. CORRELATIVOS
--     El número lo da la base, no el celular. Dos equipos sin señal
--     generarían el mismo REQ-2026-012.
-- =====================================================================

create or replace function siguiente_correlativo(p_prefijo text)
returns text
language plpgsql
as $$
declare c correlativos%rowtype;
begin
  insert into correlativos (prefijo, valor) values (p_prefijo, 0)
  on conflict (prefijo) do nothing;

  update correlativos
     set valor = valor + 1, actualizado_en = now()
   where prefijo = p_prefijo
  returning * into c;

  if p_prefijo = 'REQ' then
    return 'REQ-' || extract(year from now())::text || '-' || lpad(c.valor::text, 3, '0');
  elsif p_prefijo like 'EG%' then
    return p_prefijo || ' - ' || lpad(c.valor::text, 8, '0');
  end if;
  return p_prefijo || '-' || lpad(c.valor::text, 4, '0');
end $$;

create or replace function fn_codigo_automatico()
returns trigger
language plpgsql
as $$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := siguiente_correlativo(
      case tg_table_name
        when 'materiales'     then 'MAT'
        when 'herramientas'   then 'HER'
        when 'requerimientos' then 'REQ'
        else upper(left(tg_table_name, 3))
      end);
  end if;
  return new;
end $$;

drop trigger if exists trg_codigo on materiales;
create trigger trg_codigo before insert on materiales
for each row execute function fn_codigo_automatico();

drop trigger if exists trg_codigo on herramientas;
create trigger trg_codigo before insert on herramientas
for each row execute function fn_codigo_automatico();

drop trigger if exists trg_codigo on requerimientos;
create trigger trg_codigo before insert on requerimientos
for each row execute function fn_codigo_automatico();

-- =====================================================================
--  5. LA ADMINISTRADORA DE OBRA, PRIMER FILTRO
--     Esconder el botón no basta: la regla se aplica en la base.
-- =====================================================================

create or replace function fn_obra_primer_filtro()
returns trigger
language plpgsql
as $$
declare quien usuarios%rowtype;
begin
  if new.estado = old.estado then return new; end if;

  select * into quien from usuarios where auth_uid = auth.uid();

  if new.estado = 'enviado_logistica'
     and quien.rol not in ('obra','admin') then
    raise exception 'Solo la Administradora de Obra envía los pedidos a logística.';
  end if;

  if new.estado = 'aprobado'
     and quien.rol not in ('obra','admin')
     and not exists (select 1 from requerimiento_historial
                      where requerimiento_id = new.id
                        and estado in ('enviado_logistica','consolidado')) then
    raise exception 'El pedido % todavía no pasó por la Administradora de Obra.', new.codigo;
  end if;

  return new;
end $$;

drop trigger if exists trg_obra_filtro on requerimientos;
create trigger trg_obra_filtro before update on requerimientos
for each row execute function fn_obra_primer_filtro();

-- Cada cambio de estado deja su rastro, sin que nadie tenga que acordarse.
create or replace function fn_historial_estado()
returns trigger
language plpgsql
as $$
declare quien usuarios%rowtype;
begin
  if tg_op = 'UPDATE' and new.estado = old.estado then return new; end if;
  select * into quien from usuarios where auth_uid = auth.uid();
  insert into requerimiento_historial (requerimiento_id, estado, usuario_id, usuario_nombre)
  values (new.id, new.estado, quien.id, quien.nombre);
  return new;
end $$;

drop trigger if exists trg_historial_estado on requerimientos;
create trigger trg_historial_estado after insert or update on requerimientos
for each row execute function fn_historial_estado();

-- =====================================================================
--  6. RECEPCIÓN  ·  entra lo contado, no lo declarado
-- =====================================================================

create or replace function fn_recepcion_ingresa()
returns trigger
language plpgsql
as $$
declare r recepciones%rowtype;
begin
  if new.contado <= 0 then return new; end if;
  if new.material_id is null then return new; end if;

  select * into r from recepciones where id = new.recepcion_id;

  -- update_add: nunca se escribe el stock, se suma lo que se contó
  perform update_add_stock(
    new.material_id, new.contado, 'ingreso',
    coalesce(r.guia_tardia, (select numero from despachos where id = r.despacho_id), 'SIN GUÍA'),
    null, null,
    case when r.sin_guia then 'Recepción sin guía' else 'Recepción de guía' end);

  new.resultado := case
    when new.declarado is null or new.declarado = 0 then 'de_mas'
    when new.contado >= new.declarado then 'conforme'
    else 'incompleto' end;

  return new;
end $$;

drop trigger if exists trg_recepcion_ingresa on recepcion_lineas;
create trigger trg_recepcion_ingresa before insert on recepcion_lineas
for each row execute function fn_recepcion_ingresa();

comment on function fn_recepcion_ingresa is
  'Si la guía dice 13 escobas y llegaron 12, entran 12. El faltante queda marcado
   como incompleto y logística recibe el aviso.';

-- Vincular la guía que llegó tarde NO vuelve a mover el stock:
-- solo le pone el número a lo que ya se registró.
create or replace function vincular_guia_tardia(
  p_recepcion_id uuid,
  p_numero       text,
  p_despacho_id  uuid default null
)
returns recepciones
language plpgsql
as $$
declare r recepciones%rowtype;
begin
  select * into r from recepciones where id = p_recepcion_id for update;
  if not found then raise exception 'Recepción % no encontrada.', p_recepcion_id; end if;
  if not r.sin_guia then
    raise exception 'Esa recepción ya tenía guía. Vincular otra duplicaría el ingreso.';
  end if;

  update recepciones
     set guia_tardia = p_numero,
         vinculada_en = now(),
         vinculada_por = (select id from usuarios where auth_uid = auth.uid()),
         version = version + 1
   where id = p_recepcion_id
  returning * into r;

  update movimientos
     set documento = p_numero,
         obs = coalesce(obs || ' · ', '') || 'Guía recibida después de la descarga'
   where recepcion_id = p_recepcion_id;

  if p_despacho_id is not null then
    update despachos set estado = 'recibido', version = version + 1
     where id = p_despacho_id;
  end if;

  return r;
end $$;

-- =====================================================================
--  7. PRÉSTAMOS  ·  la herramienta se marca sola
-- =====================================================================

create or replace function fn_prestamo_estado()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from herramientas
                where id = new.herramienta_id and estado = 'prestada') then
      raise exception 'Esa herramienta ya está prestada y no ha vuelto.';
    end if;
    update herramientas set estado = 'prestada', version = version + 1
     where id = new.herramienta_id;

  elsif tg_op = 'UPDATE' and old.retorno is null and new.retorno is not null then
    new.dias_fuera := greatest(0, (new.retorno::date - new.salida::date));
    new.retraso_dias := case
      when new.devolucion_pactada is null then 0
      else greatest(0, (new.retorno::date - new.devolucion_pactada::date)) end;
    update herramientas
       set estado = case when new.estado_retorno = 'Con daños'
                         then 'mantenimiento' else 'disponible' end,
           version = version + 1
     where id = new.herramienta_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_prestamo_estado on prestamos;
create trigger trg_prestamo_estado before insert or update on prestamos
for each row execute function fn_prestamo_estado();

-- =====================================================================
--  8. AUDITORÍA GENERAL
--     Guarda el antes y el después en jsonb. Es lo que se muestra
--     cuando alguien pregunta quién cambió qué.
-- =====================================================================

create or replace function fn_auditar()
returns trigger
language plpgsql
as $$
declare quien usuarios%rowtype;
begin
  select * into quien from usuarios where auth_uid = auth.uid();
  insert into auditoria (
    usuario_id, usuario_nombre, cargo, modulo, accion, tabla, fila_id,
    estado_anterior, estado_nuevo)
  values (
    quien.id, quien.nombre, quien.cargo, tg_table_name,
    lower(tg_op), tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'usuarios','materiales','consolidado','requerimientos','despachos',
    'recepciones','prestamos','entregas'
  ] loop
    execute format(
      'drop trigger if exists trg_auditar on %I;
       create trigger trg_auditar after insert or update on %I
       for each row execute function fn_auditar();', t, t);
  end loop;
end $$;

-- =====================================================================
--  9. AVISOS QUE SALEN SOLOS
-- =====================================================================

create or replace function fn_avisar_stock_bajo()
returns trigger
language plpgsql
as $$
begin
  if new.minimo > 0 and new.stock < new.minimo and coalesce(old.stock, 0) >= new.minimo then
    insert into notificaciones (titulo, cuerpo, roles, ref_tipo, ref_id, prioridad)
    values ('Stock bajo el mínimo: ' || new.nombre,
            'Quedan ' || new.stock || ' ' || new.unidad ||
            ' y el mínimo es ' || new.minimo || '.',
            array['almacenero','obra','admin']::rol_app[],
            'material', new.id, 'Alta');
  end if;
  return new;
end $$;

drop trigger if exists trg_stock_bajo on materiales;
create trigger trg_stock_bajo after update of stock on materiales
for each row execute function fn_avisar_stock_bajo();

-- Herramientas que se pasaron de la hora. Se llama una vez al día
-- desde pg_cron; no es un disparador porque depende del reloj, no de un cambio.
create or replace function avisar_prestamos_vencidos()
returns int
language plpgsql
as $$
declare n int := 0; p record;
begin
  for p in
    select pr.*, h.nombre as herramienta
      from prestamos pr join herramientas h on h.id = pr.herramienta_id
     where pr.retorno is null
       and pr.devolucion_pactada < now()
       and (pr.avisado_en is null or pr.avisado_en < current_date)
       and pr.eliminado_en is null
  loop
    insert into notificaciones (titulo, cuerpo, roles, ref_tipo, ref_id, prioridad)
    values ('Herramienta sin devolver: ' || p.herramienta,
            p.responsable || ' debía devolverla el ' ||
            to_char(p.devolucion_pactada, 'DD/MM/YYYY HH24:MI') || '.',
            array['almacenero','obra','admin']::rol_app[],
            'prestamo', p.id, 'Alta');
    update prestamos set avisado_en = current_date where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;
