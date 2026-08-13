-- =====================================================================
--  ALMACÉN MINERO · PERMISOS POR CARGO  (Row Level Security)
--
--  Esconder un botón no es un permiso. Cualquiera con el enlace puede
--  abrir la consola del navegador y llamar a la API igual. Estas reglas
--  corren en el servidor: si un capataz pide la tabla de movimientos,
--  Postgres le devuelve cero filas, no importa qué app use.
--
--  Ejecutar después de 02_triggers.sql
-- =====================================================================

-- ---------------------------------------------------------------------
--  Quién soy y qué puedo
-- ---------------------------------------------------------------------
create or replace function mi_usuario()
returns usuarios
language sql
stable
security definer
as $$ select * from usuarios where auth_uid = auth.uid() and activo and eliminado_en is null $$;

create or replace function mi_rol()
returns rol_app
language sql
stable
security definer
as $$ select rol from usuarios where auth_uid = auth.uid() and activo and eliminado_en is null $$;

create or replace function soy(variadic roles rol_app[])
returns boolean
language sql
stable
as $$ select mi_rol() = any(roles) $$;

create or replace function mi_area()
returns text
language sql
stable
security definer
as $$ select area from usuarios where auth_uid = auth.uid() $$;

-- ---------------------------------------------------------------------
--  Se activa la seguridad en todas las tablas
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'usuarios','personal','materiales','herramientas','consolidado','consolidado_alias',
    'requerimientos','requerimiento_items','requerimiento_historial',
    'despachos','despacho_lineas','recepciones','recepcion_lineas',
    'movimientos','prestamos','entregas','entrega_lineas','epp_entregas',
    'notificaciones','notificaciones_leidas','historial','auditoria',
    'correlativos','configuracion','sync_pendientes'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);
  end loop;
end $$;

-- =====================================================================
--  INVENTARIO
--  Todos lo ven —el capataz entra justamente a eso—, pero solo el
--  almacén y Obra lo tocan.
-- =====================================================================

create policy inv_ver on materiales for select
  using (eliminado_en is null or soy('admin'));

create policy inv_crear on materiales for insert
  with check (soy('almacenero','obra','admin','supervisor'));

create policy inv_editar on materiales for update
  using (soy('almacenero','obra','admin'));

comment on policy inv_crear on materiales is
  'El supervisor puede crear material al armar su requerimiento —lo que pide muchas
   veces no está en el catálogo—, pero no puede tocar el stock de nada.';

-- =====================================================================
--  MOVIMIENTOS  ·  el kardex
--  Solo se insertan a través de update_add_stock(). Nadie los edita ni
--  los borra: un error se corrige con otro movimiento que lo anula.
-- =====================================================================

create policy mov_ver on movimientos for select
  using (soy('almacenero','obra','jefatura','admin','compras'));

create policy mov_nadie_edita on movimientos for update using (false);
create policy mov_nadie_borra on movimientos for delete using (false);

comment on policy mov_nadie_edita on movimientos is
  'El kardex es de solo lectura una vez escrito. Es lo que lo hace auditable.';

-- =====================================================================
--  REQUERIMIENTOS
--  El supervisor ve los suyos. El resto de la cadena los ve todos.
-- =====================================================================

create policy req_ver on requerimientos for select
  using (
    soy('almacenero','obra','jefatura','compras','admin')
    or solicitante_id = (select id from mi_usuario())
    or levantado_por  = (select id from mi_usuario())
  );

create policy req_crear on requerimientos for insert
  with check (soy('supervisor','almacenero','obra','admin'));

create policy req_editar on requerimientos for update
  using (
    soy('obra','admin','jefatura','compras')
    or (soy('almacenero') and estado in ('pendiente','solicitado'))
    or (solicitante_id = (select id from mi_usuario()) and estado = 'pendiente')
  );

comment on policy req_editar on requerimientos is
  'El almacenero puede corregir su pedido mientras Obra no lo haya tocado. Después
   ya no: si no, alguien podría cambiar cantidades después del visto bueno.';

create policy req_items_ver on requerimiento_items for select
  using (exists (select 1 from requerimientos r where r.id = requerimiento_id));

create policy req_items_escribir on requerimiento_items for all
  using (soy('supervisor','almacenero','obra','admin'))
  with check (soy('supervisor','almacenero','obra','admin'));

create policy req_hist_ver on requerimiento_historial for select using (true);

-- =====================================================================
--  CONSOLIDADO
--  Todos lo consultan; lo modifican Obra, almacén y logística —y solo
--  a través de update_add_consolidado(), nunca escribiendo el total.
-- =====================================================================

create policy cons_ver on consolidado for select
  using (eliminado_en is null or soy('admin'));

create policy cons_editar on consolidado for update
  using (soy('almacenero','obra','compras','jefatura','admin'));

create policy cons_crear on consolidado for insert
  with check (soy('obra','admin'));

comment on policy cons_crear on consolidado is
  'Agregar un renglón nuevo al alcance es decisión de Obra. Si cualquiera pudiera,
   el porcentaje de avance dejaría de significar algo.';

create policy alias_ver on consolidado_alias for select using (true);
create policy alias_escribir on consolidado_alias for all
  using (soy('almacenero','obra','admin')) with check (soy('almacenero','obra','admin'));

-- =====================================================================
--  DESPACHOS Y GUÍAS
-- =====================================================================

create policy desp_ver on despachos for select
  using (soy('almacenero','obra','compras','jefatura','admin'));

create policy desp_crear on despachos for insert
  with check (soy('compras','jefatura','admin'));

create policy desp_editar on despachos for update
  using (soy('compras','jefatura','admin')
         or (soy('almacenero') and estado in ('en_camino','parcial')));

comment on policy desp_editar on despachos is
  'El almacenero solo puede cerrar la guía al recibirla. No puede cambiar lo que
   dice que trae.';

create policy desp_lineas_ver on despacho_lineas for select using (true);
create policy desp_lineas_escribir on despacho_lineas for all
  using (soy('compras','jefatura','admin')) with check (soy('compras','jefatura','admin'));

-- =====================================================================
--  RECEPCIONES  ·  el almacén
-- =====================================================================

create policy rec_ver on recepciones for select
  using (soy('almacenero','obra','compras','jefatura','admin'));

create policy rec_escribir on recepciones for all
  using (soy('almacenero','obra','admin')) with check (soy('almacenero','obra','admin'));

create policy rec_lineas_ver on recepcion_lineas for select using (true);
create policy rec_lineas_escribir on recepcion_lineas for all
  using (soy('almacenero','obra','admin')) with check (soy('almacenero','obra','admin'));

-- =====================================================================
--  HERRAMIENTAS, PRÉSTAMOS, ENTREGAS Y EPP  ·  el almacén
-- =====================================================================

create policy her_ver on herramientas for select using (true);
create policy her_escribir on herramientas for all
  using (soy('almacenero','obra','admin')) with check (soy('almacenero','obra','admin'));

create policy pre_ver on prestamos for select
  using (soy('almacenero','obra','jefatura','admin'));
create policy pre_escribir on prestamos for all
  using (soy('almacenero','obra','admin')) with check (soy('almacenero','obra','admin'));

create policy ent_ver on entregas for select
  using (soy('almacenero','obra','jefatura','admin'));
create policy ent_escribir on entregas for all
  using (soy('almacenero','obra','admin')) with check (soy('almacenero','obra','admin'));

create policy ent_lineas_ver on entrega_lineas for select using (true);
create policy ent_lineas_escribir on entrega_lineas for all
  using (soy('almacenero','obra','admin')) with check (soy('almacenero','obra','admin'));

create policy epp_ver on epp_entregas for select
  using (soy('almacenero','obra','jefatura','admin'));
create policy epp_escribir on epp_entregas for all
  using (soy('almacenero','obra','admin')) with check (soy('almacenero','obra','admin'));

create policy per_ver on personal for select using (true);
create policy per_escribir on personal for all
  using (soy('almacenero','obra','admin')) with check (soy('almacenero','obra','admin'));

-- =====================================================================
--  AVISOS
--  Cada uno ve los suyos: los dirigidos a su cargo o a su nombre.
-- =====================================================================

create policy noti_ver on notificaciones for select
  using (
    mi_rol() = any(roles)
    or (select id from mi_usuario()) = any(usuarios)
    or soy('admin')
  );

create policy noti_crear on notificaciones for insert with check (true);

create policy leidas_propias on notificaciones_leidas for all
  using (usuario_id = (select id from mi_usuario()))
  with check (usuario_id = (select id from mi_usuario()));

-- =====================================================================
--  BITÁCORA Y AUDITORÍA  ·  solo el administrador de la aplicación
-- =====================================================================

create policy hist_solo_admin on historial for select using (soy('admin'));
create policy hist_insertar on historial for insert with check (true);

create policy audi_solo_admin on auditoria for select using (soy('admin'));
create policy audi_insertar on auditoria for insert with check (true);
create policy audi_nadie_edita on auditoria for update using (false);
create policy audi_nadie_borra on auditoria for delete using (false);

comment on policy audi_nadie_borra on auditoria is
  'Ni el administrador puede borrar la auditoría. Una auditoría que se puede borrar
   no sirve de nada.';

-- =====================================================================
--  USUARIOS
-- =====================================================================

create policy usu_ver on usuarios for select
  using (soy('admin','obra','jefatura') or auth_uid = auth.uid());

create policy usu_crear on usuarios for insert with check (true);   -- alta con fotocheck

create policy usu_editarme on usuarios for update
  using (auth_uid = auth.uid() or soy('admin'))
  with check (
    soy('admin')
    or (auth_uid = auth.uid()
        and rol = (select rol from usuarios where auth_uid = auth.uid())
        and es_admin = (select es_admin from usuarios where auth_uid = auth.uid()))
  );

comment on policy usu_editarme on usuarios is
  'Cada uno corrige su nombre o su celular, pero no puede ascenderse solo: el rol y
   la marca de administrador solo los cambia el administrador.';

-- =====================================================================
--  CORRELATIVOS, CONFIGURACIÓN Y COLA
-- =====================================================================

create policy corr_ver on correlativos for select using (true);
create policy corr_nadie_escribe on correlativos for all using (false) with check (false);
comment on policy corr_nadie_escribe on correlativos is
  'Solo se tocan desde siguiente_correlativo(), que es security definer.';

create policy cfg_ver on configuracion for select using (true);
create policy cfg_editar on configuracion for update using (soy('admin','obra'));

create policy sync_propia on sync_pendientes for all
  using (usuario_id = (select id from mi_usuario()) or soy('admin'))
  with check (usuario_id = (select id from mi_usuario()));

-- =====================================================================
--  CAPATAZ
--  Su único permiso es ver qué material hay. Ya está cubierto por
--  inv_ver; no aparece en ninguna otra política, así que el resto de
--  las tablas le devuelven cero filas.
-- =====================================================================
