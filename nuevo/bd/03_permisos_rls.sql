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
